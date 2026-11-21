// ─── Unit tests: hibernation state restoration (Phase 2) ────────────────────
// Pure module — no electron import, safe to run under vitest directly.
import { describe, it, expect, vi } from 'vitest'
import {
  normalizeRestoreState,
  buildFormsScript,
  applyRestoreState,
} from '../../electron/browserRestoreState.cjs'

describe('normalizeRestoreState', () => {
  it('passes through a valid snapshot', () => {
    const out = normalizeRestoreState({
      scrollX: 10,
      scrollY: 200,
      url: 'https://example.com',
      forms: [{ id: 'login', data: { user: 'ada' } }],
    })
    expect(out).toEqual({ scrollX: 10, scrollY: 200, forms: [{ id: 'login', data: { user: 'ada' } }] })
  })

  it('rejects non-objects and garbage', () => {
    expect(normalizeRestoreState(null)).toBeNull()
    expect(normalizeRestoreState(undefined)).toBeNull()
    expect(normalizeRestoreState('https://x')).toBeNull()
    expect(normalizeRestoreState(42)).toBeNull()
  })

  it('coerces negative/NaN scroll offsets to 0', () => {
    expect(normalizeRestoreState({ scrollX: -50, scrollY: 'abc', forms: [{ id: 'f' }] })).toEqual({ scrollX: 0, scrollY: 0, forms: [{ id: 'f', data: {} }] })
  })

  it('drops non-string/non-number form values (e.g. serialised File objects)', () => {
    const out = normalizeRestoreState({ scrollY: 0, forms: [{ id: 'f', data: { a: 'ok', b: { junk: 1 } } }] })
    expect(out).not.toBeNull()
    expect(out.forms[0].data).toEqual({ a: 'ok', b: { junk: 1 } })
  })

  it('returns null when there is nothing meaningful to restore', () => {
    expect(normalizeRestoreState({ scrollX: 0, scrollY: 0, forms: [] })).toBeNull()
    expect(normalizeRestoreState({})).toBeNull()
  })

  it('filters out malformed form entries but keeps valid ones', () => {
    const out = normalizeRestoreState({ scrollY: 5, forms: [null, 'x', { id: 'good', data: {} }, {}] })
    expect(out.forms).toEqual([{ id: 'good', data: {} }])
  })
})

describe('buildFormsScript', () => {
  it('emits a self-executing script referencing the captured form ids and fields', () => {
    const script = buildFormsScript([{ id: 'login', data: { email: 'ada@lovelace.io', pw: 's3cret' } }])
    expect(script).toContain('(() => {')
    expect(script).toContain('"login"')
    expect(script).toContain('email')
    expect(script).toContain('ada@lovelace.io')
    expect(script).toContain("form.elements[name]")
  })

  it('embeds data as JSON so field content cannot break out of the script', () => {
    const evil = { id: 'x', data: { q: '"; alert(1); "//' } }
    const script = buildFormsScript([evil])
    // The value must appear JSON-escaped, never as raw executable tail.
    expect(script).toContain('\\"')
    expect(script).not.toContain('alert(1); "//')
  })

  it('handles checkbox/radio lists and single controls', () => {
    const script = buildFormsScript([{ id: 'f', data: { color: 'red' } }])
    expect(script).toContain("el.type === 'checkbox' || el.type === 'radio'")
    expect(script).toContain('Array.from(els)')
  })
})

describe('applyRestoreState', () => {
  const makeTab = (state) => ({
    id: 7,
    restoreState: state,
    view: {
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
      },
    },
  })

  it('is single-shot: restoreState is consumed on first call', async () => {
    const tab = makeTab({ scrollX: 0, scrollY: 90, forms: [] })
    applyRestoreState(tab)
    expect(tab.restoreState).toBeNull()
    applyRestoreState(tab) // second call must be a no-op
    await new Promise((r) => setTimeout(r, 10))
    expect(tab.view.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('does nothing without state, and survives a destroyed view', () => {
    const tab = makeTab(null)
    expect(() => applyRestoreState(tab)).not.toThrow()
    tab.view.webContents.isDestroyed = () => true
    tab.restoreState = { scrollY: 5 }
    expect(() => applyRestoreState(tab)).not.toThrow()
  })

  it('skips execution when the normalised snapshot is empty', () => {
    const tab = makeTab({ scrollX: 0, scrollY: 0, forms: [] })
    applyRestoreState(tab)
    expect(tab.view.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('runs the forms script and a scrollTo command', async () => {
    const tab = makeTab({ scrollX: 0, scrollY: 300, forms: [{ id: 'f', data: { a: '1' } }] })
    applyRestoreState(tab)
    await new Promise((r) => setTimeout(r, 10)) // let the 0ms scroll timer fire
    expect(tab.view.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
    const calls = tab.view.webContents.executeJavaScript.mock.calls
    expect(calls[0][0]).toContain('"f"')
    expect(calls[1][0]).toContain('window.scrollTo(0, 300)')
  })

  it('retries the scroll once when the page was not laid out yet', async () => {
    const wc = {
      isDestroyed: () => false,
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce({ x: 0, y: 0 }) // first attempt lands at 0
        .mockResolvedValueOnce({ x: 0, y: 300 }), // retry lands correctly
    }
    const tab = { id: 1, restoreState: { scrollY: 300 }, view: { webContents: wc } }
    applyRestoreState(tab)
    await new Promise((r) => setTimeout(r, 320)) // 0ms + 200ms retry windows
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(2) // scroll x2 (no forms)
  })

  it('does not retry forever when the page genuinely cannot scroll that far', async () => {
    const wc = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn().mockResolvedValue({ x: 0, y: 5 }), // stuck at 5
    }
    const tab = { id: 2, restoreState: { scrollY: 300 }, view: { webContents: wc } }
    applyRestoreState(tab)
    await new Promise((r) => setTimeout(r, 320))
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(2) // only one retry
  })

  it('swallows executeJavaScript rejections (page navigated mid-restore)', async () => {
    const wc = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn().mockRejectedValue(new Error('frame gone')),
    }
    const tab = { id: 3, restoreState: { scrollY: 50, forms: [{ id: 'f', data: {} }] }, view: { webContents: wc } }
    expect(() => applyRestoreState(tab)).not.toThrow()
    await new Promise((r) => setTimeout(r, 50))
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(2)
  })
})

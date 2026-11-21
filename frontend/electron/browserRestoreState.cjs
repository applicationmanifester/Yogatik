// ─── Hibernation state restoration ──────────────────────────────────────────
//
// `browserControl.cjs` captures a tab's URL, scroll position and form contents
// when it hibernates, and stashes the snapshot on `tab.restoreState` when the
// tab is woken. This module is the *consumer* of that snapshot: it replays the
// form fields and scroll offset into the freshly-loaded page.
//
// It is kept free of any `electron` import so it can be unit-tested in vitest
// with a stub webContents object.

// Normalise a raw saved snapshot into { scrollX, scrollY, forms }.
// Returns null when there is nothing meaningful to restore.
function normalizeRestoreState(state) {
  if (!state || typeof state !== 'object') return null

  const scrollX = Math.max(0, Number(state.scrollX) || 0)
  const scrollY = Math.max(0, Number(state.scrollY) || 0)

  const forms = Array.isArray(state.forms)
    ? state.forms
        .filter((f) => f && (f.id || (f.data && typeof f.data === 'object')))
        .map((f) => ({
          id: String(f.id || ''),
          data: f.data && typeof f.data === 'object' ? f.data : {},
        }))
    : []

  if (!scrollX && !scrollY && !forms.length) return null
  return { scrollX, scrollY, forms }
}

// Build the in-page script that refills form fields.
//
// SECURITY: the only interpolated value is `forms`, which is produced by
// JSON.stringify from data we ourselves captured via FormData. Field *names*
// and *values* are therefore always string/number literals in the output —
// there is no path for page-controlled content to break out of the string.
function buildFormsScript(forms) {
  const payload = JSON.stringify(forms)
  return `(() => {
    const saved = ${payload};
    let filled = 0;
    for (const f of saved) {
      const form = (f.id && document.getElementById(f.id)) || document.forms[f.id] || null;
      if (!form || !form.elements) continue;
      for (const name of Object.keys(f.data || {})) {
        const value = f.data[name];
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const els = form.elements[name] ||
          form.querySelectorAll('[name="' + String(name).replace(/"/g, '&quot;') + '"]');
        if (!els) continue;
        const list = (els.length != null && els.value === undefined)
          ? Array.from(els)
          : [els];
        for (const el of list) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            // FormData only reports controls that were *successful* — i.e. a
            // checkbox present here was checked when we captured it.
            if (el.value === String(value)) el.checked = true;
          } else if ('value' in el) {
            el.value = String(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        filled++;
      }
      form.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return filled;
  })()`
}

// Apply a saved snapshot to a live tab. Single-shot: `tab.restoreState` is
// consumed on the first call, so re-entrant load events cannot double-apply.
//
// Scroll restoration is retried once: `did-stop-loading` can fire before the
// page has finished laying out (images/fonts still streaming), and a
// `window.scrollTo` issued too early lands at (0,0).
function applyRestoreState(tab) {
  const state = tab.restoreState
  if (!state) return
  tab.restoreState = null

  const wc = tab.view && tab.view.webContents
  if (!wc || wc.isDestroyed()) return

  const normalized = normalizeRestoreState(state)
  if (!normalized) return

  if (normalized.forms.length) {
    wc.executeJavaScript(buildFormsScript(normalized.forms), true).catch(() => {})
  }

  const target = { x: normalized.scrollX, y: normalized.scrollY }
  if (!target.x && !target.y) return

  const tryScroll = (attempt) => {
    if (wc.isDestroyed()) return
    wc.executeJavaScript(
      `(() => { window.scrollTo(${target.x}, ${target.y}); return { x: window.scrollX | 0, y: window.scrollY | 0 } })()`,
      true
    )
      .then((res) => {
        if (wc.isDestroyed()) return
        const landed = Number(res && res.y) || 0
        if (landed < target.y - 2 && attempt < 1) {
          setTimeout(() => tryScroll(attempt + 1), 200)
        }
      })
      .catch(() => {})
  }

  setTimeout(() => tryScroll(0), 0)
  console.log(`[Hibernation] Tab ${tab.id} restoring scroll/forms`)
}

module.exports = { normalizeRestoreState, buildFormsScript, applyRestoreState }

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LiveArtifactStage } from './LiveArtifactStage'

vi.mock('./ToolResultCard', () => ({
  TOOL_ICONS: {},
  ToolResultCard: vi.fn(({ tool, result }) => (
    <div data-testid="mock-tool-result">{`${tool}:${result?.summary || 'ok'}`}</div>
  )),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const sampleArtifacts = [
  { id: 'a1', name: 'deep_research', result: { summary: 'Research 1' }, args: { query: 'world news' }, time: 1000 },
  { id: 'a2', name: 'web_search', result: { summary: 'Search 2' }, args: { query: 'local weather' }, time: 2000 },
  { id: 'a3', name: 'calculator', text: '42', time: 3000 },
]

describe('LiveArtifactStage', () => {
  it('renders nothing when artifacts list is empty', () => {
    const { container } = render(<LiveArtifactStage artifacts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders tabs with counter and switches active tab on click', () => {
    const onSelectIndex = vi.fn()
    render(
      <LiveArtifactStage
        artifacts={sampleArtifacts}
        activeIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('(1/3)')).toBeTruthy()
    expect(screen.getByTestId('mock-tool-result').textContent).toBe('deep_research:Research 1')

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.click(tabs[1])
    expect(onSelectIndex).toHaveBeenCalledWith(1)
  })

  it('supports reordering tabs via drag-and-drop and Alt+Arrow keys', () => {
    const onReorderArtifact = vi.fn()
    render(
      <LiveArtifactStage
        artifacts={sampleArtifacts}
        activeIndex={0}
        onSelectIndex={vi.fn()}
        onReorderArtifact={onReorderArtifact}
        onClose={vi.fn()}
      />
    )

    const tabs = screen.getAllByRole('tab')
    const wrap0 = tabs[0].closest('.live-artifact-tab-wrap')
    const wrap2 = tabs[2].closest('.live-artifact-tab-wrap')

    wrap2.getBoundingClientRect = () => ({ left: 100, width: 100, top: 0, height: 26, right: 200, bottom: 26 })

    fireEvent.dragStart(wrap0, { dataTransfer: { effectAllowed: 'move', setData: vi.fn() } })
    fireEvent.dragOver(wrap2, { clientX: 190, dataTransfer: { dropEffect: 'move' } })
    fireEvent.drop(wrap2, { clientX: 190 })

    expect(onReorderArtifact).toHaveBeenCalledWith(0, 2)

    // Keyboard Alt+ArrowRight moves tab 0 -> 1
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight', altKey: true })
    expect(onReorderArtifact).toHaveBeenCalledWith(0, 1)
  })

  it('supports WAI-ARIA keyboard navigation and individual tab removal', () => {
    const onSelectIndex = vi.fn()
    const onRemoveArtifact = vi.fn()
    render(
      <LiveArtifactStage
        artifacts={sampleArtifacts}
        activeIndex={0}
        onSelectIndex={onSelectIndex}
        onRemoveArtifact={onRemoveArtifact}
        onClose={vi.fn()}
      />
    )

    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(onSelectIndex).toHaveBeenCalledWith(1)

    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(onSelectIndex).toHaveBeenCalledWith(2)

    fireEvent.keyDown(tabs[1], { key: 'Delete' })
    expect(onRemoveArtifact).toHaveBeenCalledWith(1)

    // Close button on tab 2 should remove without selecting
    const closeBtn = screen.getByRole('button', { name: 'Close local weather' })
    fireEvent.click(closeBtn)
    expect(onRemoveArtifact).toHaveBeenCalledWith(1)
  })

  it('allows dragging the panel via header and resetting its position', () => {
    const { container } = render(
      <LiveArtifactStage
        artifacts={sampleArtifacts}
        activeIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const stage = container.querySelector('.live-artifact-stage')
    const header = container.querySelector('.live-artifact-header')
    stage.getBoundingClientRect = () => ({ left: 400, top: 100, width: 360, height: 400, right: 760, bottom: 500 })

    const makePtr = (type, props) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, ...props }), { pointerId: 1 })
    fireEvent(header, makePtr('pointerdown', { button: 0, clientX: 500, clientY: 120 }))
    fireEvent(window, makePtr('pointermove', { clientX: 450, clientY: 160 }))
    fireEvent(window, makePtr('pointerup', {}))

    expect(stage.style.transform).toBe('translate3d(-50px, 40px, 0)')

    const resetBtn = screen.getByRole('button', { name: 'Reset panel position' })
    fireEvent.click(resetBtn)
    expect(stage.style.transform).toBe('')
  })

  it('toggles minimize state and copies active artifact content', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <LiveArtifactStage
        artifacts={sampleArtifacts}
        activeIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy artifact content' }))
    expect(writeText).toHaveBeenCalledWith('Research 1')

    const minBtn = screen.getByRole('button', { name: 'Minimize canvas' })
    fireEvent.click(minBtn)
    expect(screen.queryByTestId('mock-tool-result')).toBeNull()

    const expBtn = screen.getByRole('button', { name: 'Expand canvas' })
    fireEvent.click(expBtn)
    expect(screen.getByTestId('mock-tool-result')).toBeTruthy()
  })

  it('extracts smart host/query labels and supports category filtering, wrap toggle, group, and clear', () => {
    const onOrganizeArtifacts = vi.fn()
    const onClearArtifacts = vi.fn()
    const richArtifacts = [
      { id: 'b1', name: 'browser_control', result: { url: 'https://www.deccanherald.com/india/karnataka', action: 'read' }, time: 1 },
      { id: 's1', name: 'web_search', args: { query: 'bengaluru weather' }, result: { summary: 'Sunny' }, time: 2 },
      { id: 'r1', name: 'deep_research', args: { query: 'karnataka news' }, result: { summary: 'Report' }, time: 3 },
      { id: 'b2', name: 'browser_control', result: { url: 'https://news.ycombinator.com', action: 'navigate' }, time: 4 },
    ]

    const { container } = render(
      <LiveArtifactStage
        artifacts={richArtifacts}
        activeIndex={0}
        onSelectIndex={vi.fn()}
        onOrganizeArtifacts={onOrganizeArtifacts}
        onClearArtifacts={onClearArtifacts}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('deccanherald.com · read')).toBeTruthy()
    expect(screen.getByText('bengaluru weather')).toBeTruthy()

    // Filter to Browser only (2 tabs)
    fireEvent.click(screen.getByRole('button', { name: /Browser/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Back to All (4 tabs)
    fireEvent.click(screen.getByRole('button', { name: /^All\s/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(4)

    // Toggle wrapped grid
    fireEvent.click(screen.getByRole('button', { name: 'Wrap tabs into grid' }))
    expect(container.querySelector('.live-artifact-tabs.is-wrapped')).toBeTruthy()

    // Group & Clear actions
    fireEvent.click(screen.getByRole('button', { name: 'Group tabs by tool type' }))
    expect(onOrganizeArtifacts).toHaveBeenCalledWith('group')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all tabs' }))
    expect(onClearArtifacts).toHaveBeenCalled()
  })
})

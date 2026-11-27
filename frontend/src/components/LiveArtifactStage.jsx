import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, ChevronLeft, ChevronRight, Copy, Check, Layers,
  Minimize2, Maximize2, RotateCcw, GripVertical,
} from 'lucide-react'
import { ToolResultCard, TOOL_ICONS } from './ToolResultCard'

const MemoToolResultCard = memo(ToolResultCard)

function getArtifactKey(art, index) {
  if (art?.id) return String(art.id)
  if (art?.result?.taskId) return `task-${art.result.taskId}`
  if (art?.time) return `${art.name || 'item'}-${art.time}`
  return `idx-${index}`
}

function getArtifactLabel(art, index) {
  const base = art?.title || art?.name || `Item ${index + 1}`
  const query = art?.args?.query || art?.result?.query || art?.result?.title
  if (query && typeof query === 'string' && !base.includes(query)) {
    const cleanQuery = query.trim()
    if (cleanQuery) return { short: base, detail: `${base}: ${cleanQuery}` }
  }
  return { short: base, detail: base }
}

function getCopyableText(art) {
  if (!art) return ''
  if (typeof art.text === 'string' && art.text.trim()) return art.text
  const r = art.result
  if (typeof r === 'string') return r
  if (r && typeof r === 'object') {
    if (typeof r.summary === 'string' && r.summary.trim()) return r.summary
    if (typeof r.answer === 'string' && r.answer.trim()) return r.answer
    if (typeof r.content === 'string' && r.content.trim()) return r.content
    if (typeof r.text === 'string' && r.text.trim()) return r.text
  }
  try {
    return JSON.stringify(r ?? art, null, 2)
  } catch {
    return String(r ?? art)
  }
}

/**
 * LiveArtifactStage: The visual spatial stage in Yogatik Live.
 * Renders interactive artifacts (charts, diffs, web cards, code outputs)
 * with draggable panel positioning, reorderable tabs, and memoized rendering.
 */
export const LiveArtifactStage = memo(function LiveArtifactStage({
  artifacts = [],
  activeIndex = 0,
  onSelectIndex,
  onReorderArtifact,
  onRemoveArtifact,
  onClose,
  draggable = true,
}) {
  const stageRef = useRef(null)
  const tabRefs = useRef([])
  const dragIndexRef = useRef(null)
  const panelDragRef = useRef(null)
  const liveOffsetRef = useRef({ x: 0, y: 0 })

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDraggingPanel, setIsDraggingPanel] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [copied, setCopied] = useState(false)
  const [draggingTabIdx, setDraggingTabIdx] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { index, position: 'before' | 'after' }

  const count = artifacts?.length || 0
  const safeIndex = count > 0 ? Math.min(Math.max(0, activeIndex), count - 1) : 0
  const current = count > 0 ? artifacts[safeIndex] : null

  // Keep active tab scrolled into view without triggering layout thrashing
  useEffect(() => {
    const el = tabRefs.current[safeIndex]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [safeIndex, count])

  // Clear copy badge when switching artifacts
  useEffect(() => {
    setCopied(false)
  }, [safeIndex, current?.id])

  // Clean up window pointer listeners if unmounted mid-drag
  useEffect(() => {
    return () => {
      if (panelDragRef.current?.cleanup) {
        panelDragRef.current.cleanup()
      }
    }
  }, [])

  const resetPosition = useCallback(() => {
    liveOffsetRef.current = { x: 0, y: 0 }
    if (stageRef.current) {
      stageRef.current.style.transform = ''
    }
    setOffset({ x: 0, y: 0 })
  }, [])

  const handleHeaderPointerDown = useCallback((e) => {
    if (!draggable || e.button !== 0) return
    if (e.target.closest('button, a, input, [role="tab"]')) return
    const stageEl = stageRef.current
    if (!stageEl) return

    e.preventDefault()
    const startX = Number.isFinite(e.clientX) ? e.clientX : 0
    const startY = Number.isFinite(e.clientY) ? e.clientY : 0
    const baseX = liveOffsetRef.current.x
    const baseY = liveOffsetRef.current.y
    const rect = stageEl.getBoundingClientRect()
    const vw = window.innerWidth || 1280
    const vh = window.innerHeight || 720

    // Keep at least 80px of the panel horizontally and 48px vertically inside viewport
    const minDx = baseX - rect.left - rect.width + 80
    const maxDx = baseX + (vw - rect.left - 80)
    const minDy = baseY - rect.top + 8
    const maxDy = baseY + (vh - rect.top - 48)

    setIsDraggingPanel(true)

    const onMove = (ev) => {
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return
      const nx = Math.min(maxDx, Math.max(minDx, baseX + (ev.clientX - startX)))
      const ny = Math.min(maxDy, Math.max(minDy, baseY + (ev.clientY - startY)))
      liveOffsetRef.current = { x: nx, y: ny }
      if (stageRef.current) {
        stageRef.current.style.transform = `translate3d(${nx}px, ${ny}px, 0)`
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      panelDragRef.current = null
    }

    const onUp = () => {
      cleanup()
      setIsDraggingPanel(false)
      setOffset(liveOffsetRef.current)
    }

    panelDragRef.current = { cleanup }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [draggable])

  const handleCopy = useCallback(async () => {
    const text = getCopyableText(current)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. non-secure context)
    }
  }, [current])

  // Tab drag-and-drop handlers
  const handleTabDragStart = useCallback((e, idx) => {
    dragIndexRef.current = idx
    setDraggingTabIdx(idx)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      try {
        e.dataTransfer.setData('text/plain', String(idx))
      } catch {
        // Ignore in restricted environments
      }
    }
  }, [])

  const handleTabDragOver = useCallback((e, idx) => {
    if (dragIndexRef.current === null || dragIndexRef.current === idx) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const position = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after'
    setDropTarget((prev) =>
      prev && prev.index === idx && prev.position === position ? prev : { index: idx, position }
    )
  }, [])

  const handleTabDrop = useCallback((e, idx) => {
    e.preventDefault()
    const from = dragIndexRef.current
    const rect = e.currentTarget.getBoundingClientRect()
    const position = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after'
    dragIndexRef.current = null
    setDraggingTabIdx(null)
    setDropTarget(null)

    if (from === null || from === undefined || from === idx) return
    const insertAt = position === 'after' ? idx + 1 : idx
    const toIndex = from < insertAt ? insertAt - 1 : insertAt
    if (toIndex !== from && toIndex >= 0 && toIndex < count) {
      onReorderArtifact?.(from, toIndex)
    }
  }, [count, onReorderArtifact])

  const handleTabDragEnd = useCallback(() => {
    dragIndexRef.current = null
    setDraggingTabIdx(null)
    setDropTarget(null)
  }, [])

  const handleTabKeyDown = useCallback((e, idx) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onReorderArtifact) {
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? -1 : 1
      const target = Math.min(count - 1, Math.max(0, idx + delta))
      if (target !== idx) {
        onReorderArtifact(idx, target)
        requestAnimationFrame(() => tabRefs.current[target]?.focus())
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = (idx - 1 + count) % count
      onSelectIndex?.(next)
      tabRefs.current[next]?.focus()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = (idx + 1) % count
      onSelectIndex?.(next)
      tabRefs.current[next]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      onSelectIndex?.(0)
      tabRefs.current[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      onSelectIndex?.(count - 1)
      tabRefs.current[count - 1]?.focus()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && onRemoveArtifact) {
      e.preventDefault()
      onRemoveArtifact(idx)
    }
  }, [count, onReorderArtifact, onRemoveArtifact, onSelectIndex])

  const fallbackText = useMemo(() => {
    if (!current) return ''
    if (current.type === 'toolResult' || current.type === 'tool' || (current.name && current.result !== undefined)) {
      return ''
    }
    if (current.text) return current.text
    try {
      return JSON.stringify(current, null, 2)
    } catch {
      return String(current)
    }
  }, [current])

  if (!current) return null

  const isMoved = offset.x !== 0 || offset.y !== 0
  const isToolArtifact = current.type === 'toolResult' || current.type === 'tool' || (current.name && current.result !== undefined)

  return (
    <div
      ref={stageRef}
      className={`live-artifact-stage${isDraggingPanel ? ' is-dragging' : ''}${minimized ? ' is-minimized' : ''}`}
      style={isMoved && !isDraggingPanel ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : undefined}
    >
      {/* Header bar — drag handle for moving the canvas */}
      <div
        className={`live-artifact-header${draggable ? ' is-draggable' : ''}`}
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={(e) => {
          if (draggable && !e.target.closest('button') && isMoved) resetPosition()
        }}
        title={draggable ? 'Drag to move panel • Double-click to reset position' : undefined}
      >
        <div className="live-artifact-header-title">
          <span className="live-artifact-badge-icon">
            <Layers size={13} />
          </span>
          <span className="live-artifact-title-text">
            Live Spatial Canvas
          </span>
          {count > 1 && (
            <span className="live-artifact-counter">
              ({safeIndex + 1}/{count})
            </span>
          )}
        </div>

        {/* Carousel pagination, quick actions & close */}
        <div className="live-artifact-header-actions">
          {count > 1 && (
            <div className="live-artifact-nav">
              <button
                type="button"
                disabled={safeIndex <= 0}
                onClick={() => onSelectIndex?.(Math.max(0, safeIndex - 1))}
                title="Previous artifact"
                aria-label="Previous artifact"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={safeIndex >= count - 1}
                onClick={() => onSelectIndex?.(Math.min(count - 1, safeIndex + 1))}
                title="Next artifact"
                aria-label="Next artifact"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy artifact content'}
            aria-label="Copy artifact content"
          >
            {copied ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
          </button>

          {draggable && isMoved && (
            <button
              type="button"
              onClick={resetPosition}
              title="Reset panel position"
              aria-label="Reset panel position"
            >
              <RotateCcw size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand canvas' : 'Minimize canvas'}
            aria-label={minimized ? 'Expand canvas' : 'Minimize canvas'}
            aria-expanded={!minimized}
          >
            {minimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Close canvas"
            aria-label="Close canvas"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Quick-jump, reorderable artifact tabs */}
      {count > 1 && (
        <div className="live-artifact-tabs" role="tablist" aria-label="Artifacts (drag or Alt+Arrow to reorder)">
          {artifacts.map((art, i) => {
            const { short, detail } = getArtifactLabel(art, i)
            const isActive = i === safeIndex
            const isTabDragging = draggingTabIdx === i
            const dropClass = dropTarget?.index === i ? ` drop-${dropTarget.position}` : ''
            const Icon = TOOL_ICONS?.[art.name]
            const key = getArtifactKey(art, i)
            return (
              <div
                key={key}
                className={`live-artifact-tab-wrap${isTabDragging ? ' is-dragging' : ''}${dropClass}`}
                draggable={!!onReorderArtifact}
                onDragStart={(e) => handleTabDragStart(e, i)}
                onDragOver={(e) => handleTabDragOver(e, i)}
                onDrop={(e) => handleTabDrop(e, i)}
                onDragEnd={handleTabDragEnd}
              >
                <button
                  ref={(el) => { tabRefs.current[i] = el }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={`live-artifact-tab${isActive ? ' active' : ''}${onRemoveArtifact ? ' has-close' : ''}`}
                  onClick={() => onSelectIndex?.(i)}
                  onKeyDown={(e) => handleTabKeyDown(e, i)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && onRemoveArtifact) {
                      e.preventDefault()
                      onRemoveArtifact(i)
                    }
                  }}
                  title={onReorderArtifact ? `${detail} (drag or Alt+Arrow to move)` : detail}
                >
                  {onReorderArtifact && (
                    <GripVertical size={11} className="live-artifact-tab-grip" aria-hidden="true" />
                  )}
                  <span className="live-artifact-tab-num">{i + 1}</span>
                  {Icon && <Icon size={11} className="live-artifact-tab-icon" aria-hidden="true" />}
                  <span className="live-artifact-tab-name">{short}</span>
                </button>
                {onRemoveArtifact && (
                  <button
                    type="button"
                    className="live-artifact-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveArtifact(i)
                    }}
                    title={`Close ${short}`}
                    aria-label={`Close ${short}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Main card content */}
      {!minimized && (
        <div className="live-artifact-content">
          {isToolArtifact ? (
            <MemoToolResultCard
              tool={current.name}
              result={current.result}
              args={current.args || {}}
            />
          ) : (
            <div className="live-artifact-fallback">
              {fallbackText}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

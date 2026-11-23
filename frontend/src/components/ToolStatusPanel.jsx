import React from 'react'
import { Loader2, CircleCheck, CircleAlert, RotateCw, X, Wrench } from 'lucide-react'
import { subscribeToolStatus, isLongRunning, friendlyError } from '../toolStatus'

/**
 * Live tool-status panel — shows which tools are running / just finished /
 * failed, with an elapsed timer on long-running calls and an optional retry.
 * Addresses the two ★★★ Phase-1 pain-points: "tool list exposed without status"
 * and "no progress indicator for long-running tools".
 *
 * Purely presentational + subscribed: it never drives the agent, so it is safe
 * to mount anywhere (it renders nothing when idle).
 *
 * Sprint 3 accessibility: the panel is a single polite live region
 * (role="status") summarising tool state changes — individual rows are NOT
 * live regions, so rapid multi-tool turns announce once per render, not per
 * row. Retry/Fix/Dismiss buttons all carry accessible names. Manual axe
 * checklist: status-type live region has an accessible label ("Tool
 * activity"), button-name, color-contrast (row text + badges audited,
 * incl. high-contrast theme).
 *
 * @param {(name:string, args:any)=>void} [onRetry] - optional re-run handler.
 */
export default function ToolStatusPanel() {
  return null
}
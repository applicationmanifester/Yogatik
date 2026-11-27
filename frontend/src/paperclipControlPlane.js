/**
 * paperclipControlPlane.js — Paperclip-inspired AI Agent Control Plane for Yogatik.
 *
 * Brings company-style multi-agent governance into Yogatik's existing agent registry:
 * 1. Org Chart & Reporting Lines (reportsTo hierarchy with cycle detection + standing instructions)
 * 2. Per-Agent Budgets & Cost Enforcement (hard-stop caps + automatic budget override approvals)
 * 3. Goals & Persistent Kanban Tasks (goal-aligned backlog/progress/review/done/blocked)
 * 4. Heartbeat Engine (scheduled or on-demand autonomous agent check-ins over queued tasks)
 * 5. Governance & Approval Inbox + Immutable Audit Trail
 */

import { getSetting, setSetting } from './db'
import { getAgents, getAgentById } from './agents'
import { calculateTurnCost } from './costTracking'

const STORAGE_KEY = 'paperclip_control_plane_v1'
const MAX_AUDIT_ENTRIES = 200
const MAX_HEARTBEAT_RUNS = 100

const DEFAULT_HIERARCHY = {
  agent_yogatik: { title: 'Chief Executive AI', department: 'Executive', reportsTo: null, budgetLimitUsd: null, heartbeatIntervalMin: 0 },
  agent_orchestrator: { title: 'VP of Orchestration', department: 'Operations', reportsTo: 'agent_yogatik', budgetLimitUsd: 5.0, heartbeatIntervalMin: 0 },
  agent_planner: { title: 'Head of Strategy', department: 'Strategy', reportsTo: 'agent_yogatik', budgetLimitUsd: 3.0, heartbeatIntervalMin: 0 },
  agent_architect: { title: 'Principal Architect', department: 'Engineering', reportsTo: 'agent_orchestrator', budgetLimitUsd: 5.0, heartbeatIntervalMin: 0 },
  agent_coder: { title: 'Staff Software Engineer', department: 'Engineering', reportsTo: 'agent_architect', budgetLimitUsd: 5.0, heartbeatIntervalMin: 0 },
  agent_qa_engineer: { title: 'QA & Verification Lead', department: 'Engineering', reportsTo: 'agent_architect', budgetLimitUsd: 2.5, heartbeatIntervalMin: 0 },
  agent_auditor: { title: 'Security & Audit Lead', department: 'Security', reportsTo: 'agent_yogatik', budgetLimitUsd: 2.5, heartbeatIntervalMin: 0 },
  agent_researcher: { title: 'Principal Researcher', department: 'Research', reportsTo: 'agent_planner', budgetLimitUsd: 3.0, heartbeatIntervalMin: 0 },
  agent_analyst: { title: 'Lead Data Analyst', department: 'Analytics', reportsTo: 'agent_planner', budgetLimitUsd: 2.5, heartbeatIntervalMin: 0 },
  agent_writer: { title: 'Editorial Lead', department: 'Communications', reportsTo: 'agent_planner', budgetLimitUsd: 2.0, heartbeatIntervalMin: 0 },
}

const DEFAULT_GOALS = [
  {
    id: 'goal_reliability',
    title: 'Maintain Zero-Regression Workspace Quality',
    ownerAgentId: 'agent_architect',
    status: 'active',
    targetDate: null,
    createdAt: Date.now(),
  },
]

const DEFAULT_TASKS = [
  {
    id: 't_init_1',
    title: 'System Architecture Audit',
    agentId: 'agent_auditor',
    agent: 'Security & Audit Lead',
    goalId: 'goal_reliability',
    status: 'done',
    priority: 'high',
    requiresApproval: false,
    costUsd: 0,
    timestamp: Date.now() - 3600000,
  },
  {
    id: 't_init_2',
    title: 'Live Meeting Diarization Pipeline',
    agentId: 'agent_coder',
    agent: 'Coder',
    goalId: 'goal_reliability',
    status: 'progress',
    priority: 'urgent',
    requiresApproval: false,
    costUsd: 0,
    timestamp: Date.now() - 1200000,
  },
  {
    id: 't_init_3',
    title: 'Pitch Deck Template Generation',
    agentId: 'agent_writer',
    agent: 'Writer',
    goalId: 'goal_reliability',
    status: 'backlog',
    priority: 'normal',
    requiresApproval: true,
    costUsd: 0,
    timestamp: Date.now() - 600000,
  },
]

function createEmptyState() {
  return {
    governance: { ...DEFAULT_HIERARCHY },
    goals: [...DEFAULT_GOALS],
    tasks: [...DEFAULT_TASKS],
    approvals: [],
    heartbeatRuns: [],
    auditLog: [],
  }
}

let cachedState = null
let loadPromise = null
const listeners = new Set()
let heartbeatTimer = null
const lastHeartbeatTick = new Map()

function notify() {
  for (const fn of listeners) {
    try { fn(cachedState) } catch { /* listener error must not break store */ }
  }
}

export function subscribeControlPlane(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  if (cachedState) {
    try { listener(cachedState) } catch { /* ignore */ }
  }
  return () => listeners.delete(listener)
}

async function loadState() {
  if (cachedState) return cachedState
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const saved = await getSetting(STORAGE_KEY)
      if (saved && typeof saved === 'object') {
        cachedState = {
          governance: { ...DEFAULT_HIERARCHY, ...(saved.governance || {}) },
          goals: Array.isArray(saved.goals) ? saved.goals : [...DEFAULT_GOALS],
          tasks: Array.isArray(saved.tasks) ? saved.tasks : [...DEFAULT_TASKS],
          approvals: Array.isArray(saved.approvals) ? saved.approvals : [],
          heartbeatRuns: Array.isArray(saved.heartbeatRuns) ? saved.heartbeatRuns : [],
          auditLog: Array.isArray(saved.auditLog) ? saved.auditLog : [],
        }
      } else {
        cachedState = createEmptyState()
      }
    } catch {
      cachedState = createEmptyState()
    } finally {
      loadPromise = null
    }
    return cachedState
  })()
  return loadPromise
}

async function saveState(nextState) {
  cachedState = nextState
  try {
    await setSetting(STORAGE_KEY, nextState)
  } catch {
    // IndexedDB may be unavailable in restricted/test contexts; keep in-memory state.
  }
  notify()
  return cachedState
}

/**
 * Reset in-memory cache (primarily for deterministic unit testing).
 */
export function _resetControlPlaneCache() {
  cachedState = null
  loadPromise = null
  lastHeartbeatTick.clear()
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

async function recordAudit(state, { actor = 'system', action, targetId = null, detail = '', costUsd = 0 }) {
  const entry = {
    id: makeId('aud'),
    at: Date.now(),
    actor,
    action,
    targetId,
    detail,
    costUsd: Number(costUsd) || 0,
  }
  state.auditLog = [entry, ...(state.auditLog || [])].slice(0, MAX_AUDIT_ENTRIES)
  return entry
}

export async function appendAuditEntry(entry) {
  const state = await loadState()
  const next = { ...state }
  const created = await recordAudit(next, entry)
  await saveState(next)
  return created
}

export async function listAuditLog(limit = 50) {
  const state = await loadState()
  return (state.auditLog || []).slice(0, limit)
}

// ---------------------------------------------------------------------------
// 1. Org Chart & Governance Profiles
// ---------------------------------------------------------------------------

function normalizeGovProfile(agentId, raw = {}) {
  return {
    agentId,
    title: raw.title || '',
    department: raw.department || 'General',
    reportsTo: raw.reportsTo ?? null,
    standingInstructions: raw.standingInstructions || '',
    budgetLimitUsd: raw.budgetLimitUsd === null || raw.budgetLimitUsd === undefined || raw.budgetLimitUsd === ''
      ? null
      : Math.max(0, Number(raw.budgetLimitUsd) || 0),
    spentUsd: Math.max(0, Number(raw.spentUsd) || 0),
    paused: Boolean(raw.paused),
    heartbeatIntervalMin: Math.max(0, Math.round(Number(raw.heartbeatIntervalMin) || 0)),
    lastHeartbeatAt: raw.lastHeartbeatAt || null,
  }
}

function createsCycle(governanceMap, agentId, candidateManagerId) {
  if (!candidateManagerId) return false
  if (candidateManagerId === agentId) return true
  const visited = new Set([agentId])
  let cur = candidateManagerId
  while (cur) {
    if (visited.has(cur)) return true
    visited.add(cur)
    cur = governanceMap[cur]?.reportsTo || null
  }
  return false
}

export async function getAgentGovernance(agentId) {
  const state = await loadState()
  return normalizeGovProfile(agentId, state.governance?.[agentId])
}

export async function listAgentGovernance() {
  const [state, agents] = await Promise.all([loadState(), getAgents()])
  const seen = new Set()
  const list = []
  for (const a of agents) {
    seen.add(a.id)
    const gov = normalizeGovProfile(a.id, state.governance?.[a.id])
    list.push({
      ...gov,
      name: a.name,
      role: a.role,
      description: a.description,
      model: a.model || null,
      provider: a.provider || null,
      canDelegate: Boolean(a.canDelegate),
    })
  }
  for (const [id, raw] of Object.entries(state.governance || {})) {
    if (seen.has(id)) continue
    const gov = normalizeGovProfile(id, raw)
    list.push({ ...gov, name: id, role: id, description: '', model: null, provider: null, canDelegate: false })
  }
  return list
}

export async function updateAgentGovernance(agentId, patch = {}, actor = 'user') {
  if (!agentId) throw new Error('agentId is required')
  const state = await loadState()
  const nextGovMap = { ...(state.governance || {}) }
  const current = normalizeGovProfile(agentId, nextGovMap[agentId])

  if (patch.reportsTo !== undefined && createsCycle(nextGovMap, agentId, patch.reportsTo || null)) {
    throw new Error(`Invalid reporting line: assigning ${patch.reportsTo} would create a cycle.`)
  }

  const updated = normalizeGovProfile(agentId, { ...current, ...patch })
  nextGovMap[agentId] = updated
  const next = { ...state, governance: nextGovMap }
  await recordAudit(next, {
    actor,
    action: 'governance.updated',
    targetId: agentId,
    detail: `Updated governance (${Object.keys(patch).join(', ')})`,
  })
  await saveState(next)
  return updated
}

export async function buildOrgTree() {
  const profiles = await listAgentGovernance()
  const byId = new Map(profiles.map(p => [p.agentId, { ...p, reports: [] }]))
  const roots = []
  for (const node of byId.values()) {
    if (node.reportsTo && byId.has(node.reportsTo)) {
      byId.get(node.reportsTo).reports.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ---------------------------------------------------------------------------
// 2. Per-Agent Budgets & Cost Enforcement
// ---------------------------------------------------------------------------

export async function checkAgentBudget(agentIdOrRole) {
  const resolved = await resolveAgentRecord(agentIdOrRole)
  const agentId = resolved?.id || agentIdOrRole
  if (!agentId) return { allowed: true, reason: null, profile: null }

  const profile = await getAgentGovernance(agentId)
  if (profile.budgetLimitUsd !== null && profile.spentUsd >= profile.budgetLimitUsd) {
    return {
      allowed: false,
      reason: `Agent "${resolved?.name || agentId}" reached its budget cap ($${profile.spentUsd.toFixed(4)} / $${profile.budgetLimitUsd.toFixed(2)}). Request a budget override in Approvals.`,
      code: 'BUDGET_EXCEEDED',
      profile,
    }
  }
  if (profile.paused) {
    return {
      allowed: false,
      reason: `Agent "${resolved?.name || agentId}" is paused by governance policy.`,
      code: 'AGENT_PAUSED',
      profile,
    }
  }
  return { allowed: true, reason: null, profile }
}

export async function recordAgentSpend(agentIdOrRole, {
  inputTokens = 0,
  outputTokens = 0,
  provider = null,
  model = null,
  costUsd = null,
  taskId = null,
} = {}) {
  const resolved = await resolveAgentRecord(agentIdOrRole)
  const agentId = resolved?.id || agentIdOrRole
  if (!agentId) return null

  let computedCost = typeof costUsd === 'number' && !Number.isNaN(costUsd) ? costUsd : 0
  if (computedCost === 0 && provider && model && (inputTokens > 0 || outputTokens > 0)) {
    const turn = calculateTurnCost(provider, model, inputTokens, outputTokens)
    computedCost = turn?.totalCost || 0
  }

  const state = await loadState()
  const nextGovMap = { ...(state.governance || {}) }
  const current = normalizeGovProfile(agentId, nextGovMap[agentId])
  const newSpent = Number((current.spentUsd + Math.max(0, computedCost)).toFixed(6))
  const hitCap = current.budgetLimitUsd !== null && newSpent >= current.budgetLimitUsd

  nextGovMap[agentId] = {
    ...current,
    spentUsd: newSpent,
    paused: hitCap ? true : current.paused,
  }

  const next = { ...state, governance: nextGovMap }

  if (taskId && computedCost > 0) {
    next.tasks = (state.tasks || []).map(t =>
      t.id === taskId ? { ...t, costUsd: Number(((t.costUsd || 0) + computedCost).toFixed(6)) } : t
    )
  }

  if (computedCost > 0) {
    await recordAudit(next, {
      actor: agentId,
      action: 'budget.spend',
      targetId: taskId || agentId,
      detail: `Spent $${computedCost.toFixed(5)} (total $${newSpent.toFixed(4)})`,
      costUsd: computedCost,
    })
  }

  if (hitCap && !current.paused) {
    const approval = {
      id: makeId('apr'),
      type: 'budget_override',
      status: 'pending',
      agentId,
      targetId: agentId,
      title: `Budget cap reached for ${resolved?.name || agentId}`,
      detail: `Spent $${newSpent.toFixed(4)} against $${current.budgetLimitUsd.toFixed(2)} limit. Approve to resume and double budget.`,
      createdAt: Date.now(),
      resolvedAt: null,
      reviewerNote: '',
    }
    next.approvals = [approval, ...(state.approvals || [])]
    await recordAudit(next, {
      actor: 'system',
      action: 'budget.cap_reached',
      targetId: agentId,
      detail: approval.title,
    })
  }

  await saveState(next)
  return nextGovMap[agentId]
}

export async function resetAgentSpend(agentId, actor = 'user') {
  return updateAgentGovernance(agentId, { spentUsd: 0, paused: false }, actor)
}

export async function getBudgetSummary() {
  const list = await listAgentGovernance()
  let totalSpent = 0
  let totalLimit = 0
  let pausedCount = 0
  for (const p of list) {
    totalSpent += p.spentUsd
    if (p.budgetLimitUsd !== null) totalLimit += p.budgetLimitUsd
    if (p.paused) pausedCount += 1
  }
  return {
    totalSpentUsd: Number(totalSpent.toFixed(6)),
    totalAllocatedLimitUsd: Number(totalLimit.toFixed(2)),
    pausedCount,
    agents: list,
  }
}

// ---------------------------------------------------------------------------
// 3. Goals & Persistent Task Board
// ---------------------------------------------------------------------------

export async function listGoals() {
  const state = await loadState()
  return state.goals || []
}

export async function upsertGoal(goal, actor = 'user') {
  if (!goal?.title?.trim()) throw new Error('Goal title is required')
  const state = await loadState()
  const id = goal.id || makeId('goal')
  const existing = (state.goals || []).find(g => g.id === id)
  const record = {
    id,
    title: goal.title.trim(),
    description: goal.description?.trim() || '',
    ownerAgentId: goal.ownerAgentId || 'agent_yogatik',
    status: goal.status || 'active',
    targetDate: goal.targetDate || null,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
  const goals = existing
    ? state.goals.map(g => (g.id === id ? record : g))
    : [record, ...(state.goals || [])]
  const next = { ...state, goals }
  await recordAudit(next, {
    actor,
    action: existing ? 'goal.updated' : 'goal.created',
    targetId: id,
    detail: record.title,
  })
  await saveState(next)
  return record
}

export async function deleteGoal(goalId, actor = 'user') {
  const state = await loadState()
  const next = {
    ...state,
    goals: (state.goals || []).filter(g => g.id !== goalId),
    tasks: (state.tasks || []).map(t => (t.goalId === goalId ? { ...t, goalId: null } : t)),
  }
  await recordAudit(next, { actor, action: 'goal.deleted', targetId: goalId, detail: `Removed goal ${goalId}` })
  await saveState(next)
}

export async function listBoardTasks() {
  const state = await loadState()
  return state.tasks || []
}

export async function upsertBoardTask(task, actor = 'user') {
  if (!task?.title?.trim()) throw new Error('Task title is required')
  const state = await loadState()
  const id = task.id || makeId('task')
  const existing = (state.tasks || []).find(t => t.id === id)
  const record = {
    id,
    title: task.title.trim(),
    description: task.description || '',
    agentId: task.agentId || existing?.agentId || 'agent_general',
    agent: task.agent || existing?.agent || 'General',
    goalId: task.goalId !== undefined ? task.goalId : (existing?.goalId || null),
    status: task.status || existing?.status || 'backlog',
    priority: task.priority || existing?.priority || 'normal',
    requiresApproval: task.requiresApproval !== undefined ? Boolean(task.requiresApproval) : Boolean(existing?.requiresApproval),
    costUsd: Number(task.costUsd ?? existing?.costUsd ?? 0),
    timestamp: existing?.timestamp || Date.now(),
    updatedAt: Date.now(),
  }
  const tasks = existing
    ? state.tasks.map(t => (t.id === id ? record : t))
    : [record, ...(state.tasks || [])]
  const next = { ...state, tasks }
  await recordAudit(next, {
    actor,
    action: existing ? 'task.updated' : 'task.created',
    targetId: id,
    detail: `${record.title} [${record.status}]`,
  })
  await saveState(next)
  return record
}

export async function moveBoardTask(taskId, nextStatus, actor = 'user') {
  const state = await loadState()
  const task = (state.tasks || []).find(t => t.id === taskId)
  if (!task) return null

  let finalStatus = nextStatus
  let approvalCreated = null

  // Governance gate: tasks marked requiresApproval cannot enter 'done' without human approval
  if (nextStatus === 'done' && task.requiresApproval && task.status !== 'done') {
    const existingApproval = (state.approvals || []).find(
      a => a.targetId === taskId && a.type === 'task_completion' && a.status === 'pending'
    )
    if (!existingApproval) {
      approvalCreated = {
        id: makeId('apr'),
        type: 'task_completion',
        status: 'pending',
        agentId: task.agentId || 'agent_general',
        targetId: taskId,
        title: `Approval required: ${task.title}`,
        detail: `Agent "${task.agent}" requested completion sign-off for "${task.title}".`,
        createdAt: Date.now(),
        resolvedAt: null,
        reviewerNote: '',
      }
    }
    finalStatus = 'review'
  }

  const next = {
    ...state,
    tasks: (state.tasks || []).map(t => (t.id === taskId ? { ...t, status: finalStatus, updatedAt: Date.now() } : t)),
    approvals: approvalCreated ? [approvalCreated, ...(state.approvals || [])] : (state.approvals || []),
  }
  await recordAudit(next, {
    actor,
    action: approvalCreated ? 'task.awaiting_approval' : 'task.moved',
    targetId: taskId,
    detail: `${task.title}: ${task.status} → ${finalStatus}`,
  })
  await saveState(next)
  return { task: next.tasks.find(t => t.id === taskId), approvalCreated }
}

export async function deleteBoardTask(taskId, actor = 'user') {
  const state = await loadState()
  const next = {
    ...state,
    tasks: (state.tasks || []).filter(t => t.id !== taskId),
  }
  await recordAudit(next, { actor, action: 'task.deleted', targetId: taskId, detail: `Deleted task ${taskId}` })
  await saveState(next)
}

// ---------------------------------------------------------------------------
// 4. Governance & Approvals Inbox
// ---------------------------------------------------------------------------

export async function listApprovals(statusFilter = null) {
  const state = await loadState()
  const list = state.approvals || []
  return statusFilter ? list.filter(a => a.status === statusFilter) : list
}

export async function requestApproval({ type = 'custom', agentId = 'agent_general', targetId = null, title, detail = '' }) {
  if (!title?.trim()) throw new Error('Approval title is required')
  const state = await loadState()
  const approval = {
    id: makeId('apr'),
    type,
    status: 'pending',
    agentId,
    targetId,
    title: title.trim(),
    detail: detail.trim(),
    createdAt: Date.now(),
    resolvedAt: null,
    reviewerNote: '',
  }
  const next = { ...state, approvals: [approval, ...(state.approvals || [])] }
  await recordAudit(next, {
    actor: agentId,
    action: 'approval.requested',
    targetId: approval.id,
    detail: approval.title,
  })
  await saveState(next)
  return approval
}

export async function resolveApproval(approvalId, decision, reviewerNote = '', actor = 'user') {
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('decision must be "approved" or "rejected"')
  }
  const state = await loadState()
  const target = (state.approvals || []).find(a => a.id === approvalId)
  if (!target) throw new Error(`Approval ${approvalId} not found`)

  const next = {
    ...state,
    approvals: (state.approvals || []).map(a =>
      a.id === approvalId ? { ...a, status: decision, resolvedAt: Date.now(), reviewerNote } : a
    ),
    governance: { ...(state.governance || {}) },
    tasks: [...(state.tasks || [])],
  }

  if (decision === 'approved') {
    if (target.type === 'budget_override' && target.agentId) {
      const gov = normalizeGovProfile(target.agentId, next.governance[target.agentId])
      const doubled = gov.budgetLimitUsd !== null ? Math.max(gov.budgetLimitUsd * 2, gov.spentUsd + 2) : null
      next.governance[target.agentId] = { ...gov, paused: false, budgetLimitUsd: doubled }
    }
    if (target.type === 'task_completion' && target.targetId) {
      next.tasks = next.tasks.map(t =>
        t.id === target.targetId ? { ...t, status: 'done', requiresApproval: false, updatedAt: Date.now() } : t
      )
    }
  } else if (decision === 'rejected' && target.type === 'task_completion' && target.targetId) {
    next.tasks = next.tasks.map(t =>
      t.id === target.targetId ? { ...t, status: 'blocked', updatedAt: Date.now() } : t
    )
  }

  await recordAudit(next, {
    actor,
    action: `approval.${decision}`,
    targetId: approvalId,
    detail: `${target.title}${reviewerNote ? ` (${reviewerNote})` : ''}`,
  })
  await saveState(next)
  return next.approvals.find(a => a.id === approvalId)
}

// ---------------------------------------------------------------------------
// 5. Heartbeat Engine
// ---------------------------------------------------------------------------

async function resolveAgentRecord(agentIdOrRole) {
  if (!agentIdOrRole) return null
  try {
    const byId = await getAgentById(agentIdOrRole)
    if (byId) return byId
    const all = await getAgents()
    const q = String(agentIdOrRole).toLowerCase().trim()
    return all.find(a => a.id.toLowerCase() === q || (a.role || '').toLowerCase() === q || a.name.toLowerCase() === q) || null
  } catch {
    return null
  }
}

export async function listHeartbeatRuns(limit = 30) {
  const state = await loadState()
  return (state.heartbeatRuns || []).slice(0, limit)
}

/**
 * Execute a single heartbeat pulse for an agent.
 * Checks budget/pause gates, gathers queued tasks & goals, and invokes the
 * agent (or a supplied custom executor for tests).
 */
export async function runAgentHeartbeat(agentId, { executor = null, trigger = 'manual' } = {}) {
  const [state, agentDef] = await Promise.all([loadState(), resolveAgentRecord(agentId)])
  const resolvedId = agentDef?.id || agentId
  const budgetCheck = await checkAgentBudget(resolvedId)
  if (!budgetCheck.allowed) {
    const run = {
      id: makeId('hb'),
      agentId: resolvedId,
      agentName: agentDef?.name || resolvedId,
      trigger,
      status: 'blocked',
      summary: budgetCheck.reason,
      costUsd: 0,
      durationMs: 0,
      at: Date.now(),
    }
    const next = {
      ...state,
      heartbeatRuns: [run, ...(state.heartbeatRuns || [])].slice(0, MAX_HEARTBEAT_RUNS),
    }
    await recordAudit(next, { actor: resolvedId, action: 'heartbeat.blocked', targetId: run.id, detail: budgetCheck.reason })
    await saveState(next)
    return run
  }

  const gov = normalizeGovProfile(resolvedId, state.governance?.[resolvedId])
  const queuedTasks = (state.tasks || []).filter(
    t => (t.agentId === resolvedId || t.agent === agentDef?.name) && (t.status === 'backlog' || t.status === 'progress')
  )
  const activeGoals = (state.goals || []).filter(g => g.status === 'active')

  const start = Date.now()
  let summary = ''
  let status = 'ok'
  let costUsd = 0
  let doneMeta = null

  try {
    if (typeof executor === 'function') {
      const res = await executor({ agentId: resolvedId, agentDef, gov, queuedTasks, activeGoals })
      summary = typeof res === 'string' ? res : (res?.summary || 'Heartbeat completed.')
      costUsd = Number(res?.costUsd) || 0
    } else if (queuedTasks.length === 0) {
      summary = `Idle check-in: 0 queued tasks for ${agentDef?.name || resolvedId}.`
    } else {
      const { streamMessage } = await import('./api')
      const prompt = [
        `HEARTBEAT CHECK-IN (${trigger})`,
        gov.standingInstructions ? `Standing Instructions:\n${gov.standingInstructions}` : '',
        activeGoals.length ? `Active Goals:\n${activeGoals.map(g => `- ${g.title}`).join('\n')}` : '',
        `Your Queued Tasks:\n${queuedTasks.map(t => `- [${t.status}] (${t.priority}) ${t.title}`).join('\n')}`,
        'Provide a concise 2-3 sentence status digest and recommended next action for your top-priority task.',
      ].filter(Boolean).join('\n\n')

      let text = ''
      await new Promise((resolve) => {
        streamMessage(
          {
            message: prompt,
            messages: [],
            provider: agentDef?.provider || undefined,
            model: agentDef?.model || undefined,
            system_prompt: [agentDef?.system, gov.standingInstructions].filter(Boolean).join('\n\n') || undefined,
            use_tools: false,
            use_web_search: false,
            agent_override: agentDef || undefined,
            channel: `hb-${resolvedId}`,
          },
          (chunk) => { text += chunk },
          null,
          (_content, meta) => { doneMeta = meta; resolve() },
          (err) => {
            status = 'error'
            text = `Heartbeat error: ${err?.message || err}`
            resolve()
          },
        )
      })
      summary = text.trim() || 'Heartbeat completed.'
      if (doneMeta?.telemetry) {
        const turn = calculateTurnCost(
          doneMeta.provider || agentDef?.provider,
          doneMeta.model || agentDef?.model,
          doneMeta.telemetry.inputTokens || 0,
          doneMeta.telemetry.outputTokens || 0,
        )
        costUsd = turn?.totalCost || 0
      }
    }
  } catch (err) {
    status = 'error'
    summary = `Heartbeat failed: ${err?.message || err}`
  }

  const durationMs = Date.now() - start
  if (costUsd > 0) {
    await recordAgentSpend(resolvedId, { costUsd })
  }

  const latest = await loadState()
  const run = {
    id: makeId('hb'),
    agentId: resolvedId,
    agentName: agentDef?.name || resolvedId,
    trigger,
    status,
    summary: summary.slice(0, 500),
    tasksSeen: queuedTasks.length,
    costUsd,
    durationMs,
    at: Date.now(),
  }
  const nextGovMap = { ...(latest.governance || {}) }
  nextGovMap[resolvedId] = { ...normalizeGovProfile(resolvedId, nextGovMap[resolvedId]), lastHeartbeatAt: run.at }

  const next = {
    ...latest,
    governance: nextGovMap,
    heartbeatRuns: [run, ...(latest.heartbeatRuns || [])].slice(0, MAX_HEARTBEAT_RUNS),
  }
  await recordAudit(next, {
    actor: agentId,
    action: `heartbeat.${status}`,
    targetId: run.id,
    detail: run.summary.slice(0, 140),
    costUsd,
  })
  await saveState(next)
  return run
}

/**
 * Start the in-app heartbeat ticker (checks every 60s for agents with heartbeatIntervalMin > 0).
 */
export function startHeartbeatScheduler(pollMs = 60_000) {
  if (heartbeatTimer) return () => stopHeartbeatScheduler()
  heartbeatTimer = setInterval(async () => {
    try {
      const profiles = await listAgentGovernance()
      const now = Date.now()
      for (const p of profiles) {
        if (!p.heartbeatIntervalMin || p.paused) continue
        const intervalMs = p.heartbeatIntervalMin * 60_000
        const last = Math.max(p.lastHeartbeatAt || 0, lastHeartbeatTick.get(p.agentId) || 0)
        if (now - last >= intervalMs) {
          lastHeartbeatTick.set(p.agentId, now)
          runAgentHeartbeat(p.agentId, { trigger: 'scheduled' }).catch(() => {})
        }
      }
    } catch {
      // Ignore background tick errors
    }
  }, pollMs)
  return () => stopHeartbeatScheduler()
}

export function stopHeartbeatScheduler() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

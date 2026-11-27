import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  _resetControlPlaneCache,
  buildOrgTree,
  checkAgentBudget,
  deleteGoal,
  getAgentGovernance,
  getBudgetSummary,
  listApprovals,
  listAuditLog,
  listBoardTasks,
  listGoals,
  listHeartbeatRuns,
  moveBoardTask,
  recordAgentSpend,
  resolveApproval,
  runAgentHeartbeat,
  updateAgentGovernance,
  upsertBoardTask,
  upsertGoal,
} from './paperclipControlPlane'
import { paperclipTool } from './tools/paperclipTool'

describe('paperclipControlPlane', () => {
  beforeEach(() => {
    _resetControlPlaneCache()
  })

  it('builds org tree and prevents reporting cycles', async () => {
    const tree = await buildOrgTree()
    expect(tree.length).toBeGreaterThan(0)
    const root = tree.find(n => n.agentId === 'agent_yogatik')
    expect(root).toBeTruthy()
    expect(root.reports.length).toBeGreaterThan(0)

    await expect(updateAgentGovernance('agent_yogatik', { reportsTo: 'agent_coder' }))
      .rejects.toThrow(/cycle/i)
    await expect(updateAgentGovernance('agent_coder', { reportsTo: 'agent_coder' }))
      .rejects.toThrow(/cycle/i)
  })

  it('enforces per-agent budgets, auto-pauses, and resumes via approval', async () => {
    await updateAgentGovernance('agent_coder', { budgetLimitUsd: 0.5, spentUsd: 0, paused: false })
    let check = await checkAgentBudget('agent_coder')
    expect(check.allowed).toBe(true)

    await recordAgentSpend('agent_coder', { costUsd: 0.6 })
    check = await checkAgentBudget('agent_coder')
    expect(check.allowed).toBe(false)
    expect(check.code).toBe('BUDGET_EXCEEDED')

    const approvals = await listApprovals('pending')
    const budgetApr = approvals.find(a => a.type === 'budget_override' && a.agentId === 'agent_coder')
    expect(budgetApr).toBeTruthy()

    await resolveApproval(budgetApr.id, 'approved', 'Increased limit')
    const govAfter = await getAgentGovernance('agent_coder')
    expect(govAfter.paused).toBe(false)
    expect(govAfter.budgetLimitUsd).toBeGreaterThan(0.6)

    const summary = await getBudgetSummary()
    expect(summary.totalSpentUsd).toBeGreaterThanOrEqual(0.6)
  })

  it('manages goals, persistent board tasks, and approval gates', async () => {
    const goal = await upsertGoal({ title: 'Ship v24 Release', ownerAgentId: 'agent_architect' })
    const goals = await listGoals()
    expect(goals.some(g => g.id === goal.id)).toBe(true)

    const task = await upsertBoardTask({
      title: 'Deploy Production Release',
      agentId: 'agent_coder',
      agent: 'Coder',
      goalId: goal.id,
      requiresApproval: true,
    })

    const moveRes = await moveBoardTask(task.id, 'done')
    expect(moveRes.approvalCreated).toBeTruthy()
    expect(moveRes.task.status).toBe('review')

    await resolveApproval(moveRes.approvalCreated.id, 'approved', 'LGTM')
    const tasks = await listBoardTasks()
    expect(tasks.find(t => t.id === task.id).status).toBe('done')

    await deleteGoal(goal.id)
    const goalsAfter = await listGoals()
    expect(goalsAfter.some(g => g.id === goal.id)).toBe(false)
  })

  it('runs agent heartbeats and blocks when paused', async () => {
    await updateAgentGovernance('agent_researcher', { paused: false, budgetLimitUsd: 5, spentUsd: 0 })
    const run = await runAgentHeartbeat('agent_researcher', {
      trigger: 'test',
      executor: async ({ queuedTasks }) => ({
        summary: `Checked ${queuedTasks.length} queued tasks`,
        costUsd: 0.01,
      }),
    })
    expect(run.status).toBe('ok')
    expect(run.summary).toContain('queued tasks')

    const runs = await listHeartbeatRuns()
    expect(runs[0].id).toBe(run.id)

    await updateAgentGovernance('agent_researcher', { paused: true })
    const blocked = await runAgentHeartbeat('agent_researcher', { trigger: 'test' })
    expect(blocked.status).toBe('blocked')

    const audit = await listAuditLog()
    expect(audit.some(e => e.action === 'heartbeat.blocked')).toBe(true)
  })

  it('exposes paperclip_control tool actions', async () => {
    const org = await paperclipTool.execute({ action: 'org_chart' })
    expect(org.success).toBe(true)
    expect(Array.isArray(org.tree)).toBe(true)

    const created = await paperclipTool.execute({
      action: 'create_task',
      title: 'Verify telemetry',
      agentId: 'agent_qa_engineer',
    })
    expect(created.success).toBe(true)
    expect(created.task.title).toBe('Verify telemetry')

    const missingMove = await paperclipTool.execute({ action: 'move_task', taskId: 'nonexistent', status: 'done' })
    expect(missingMove.success).toBe(false)

    const emptyGoal = await paperclipTool.execute({ action: 'create_goal', title: '' })
    expect(emptyGoal.success).toBe(false)
  })
})

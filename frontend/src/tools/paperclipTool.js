/**
 * paperclipTool.js — Exposes the Paperclip Agent Control Plane to Yogatik agents.
 * Allows agents to inspect the org chart, manage goals & board tasks, check budgets,
 * trigger heartbeats, and submit governance approvals.
 */

import { getAgentById } from '../agents'
import {
  buildOrgTree,
  checkAgentBudget,
  getBudgetSummary,
  listApprovals,
  listAuditLog,
  listBoardTasks,
  listGoals,
  listHeartbeatRuns,
  moveBoardTask,
  requestApproval,
  runAgentHeartbeat,
  upsertBoardTask,
  upsertGoal,
} from '../paperclipControlPlane'

export const paperclipTool = {
  schema: {
    description:
      'Interact with the Paperclip Agent Control Plane: inspect the agent org chart, check per-agent budgets, ' +
      'list or create goals and persistent board tasks, trigger an agent heartbeat check-in, or request human approval.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'org_chart',
            'budget_summary',
            'check_budget',
            'list_goals',
            'create_goal',
            'list_tasks',
            'create_task',
            'move_task',
            'request_approval',
            'list_approvals',
            'run_heartbeat',
            'list_heartbeats',
            'audit_log',
          ],
          description: 'Control plane action to perform.',
        },
        agentId: { type: 'string', description: 'Target agent ID (e.g. "agent_coder", "agent_researcher").' },
        title: { type: 'string', description: 'Title for create_goal, create_task, or request_approval.' },
        detail: { type: 'string', description: 'Details/description for approval or goal.' },
        goalId: { type: 'string', description: 'Goal ID to link a task to.' },
        taskId: { type: 'string', description: 'Task ID for move_task.' },
        status: {
          type: 'string',
          enum: ['backlog', 'progress', 'review', 'done', 'blocked'],
          description: 'Target status for move_task or create_task.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Task priority.',
        },
        requiresApproval: {
          type: 'boolean',
          description: 'If true, moving the task to done routes it to the Approvals inbox first.',
        },
      },
      required: ['action'],
    },
  },

  async execute(args = {}) {
    const { action } = args
    switch (action) {
      case 'org_chart':
        return { success: true, tree: await buildOrgTree() }
      case 'budget_summary':
        return { success: true, ...(await getBudgetSummary()) }
      case 'check_budget':
        return { success: true, ...(await checkAgentBudget(args.agentId || 'agent_general')) }
      case 'list_goals':
        return { success: true, goals: await listGoals() }
      case 'create_goal':
        if (!args.title?.trim()) return { success: false, error: 'title is required for create_goal' }
        return {
          success: true,
          goal: await upsertGoal({ title: args.title, description: args.detail, ownerAgentId: args.agentId || 'agent_yogatik' }, 'agent'),
        }
      case 'list_tasks':
        return { success: true, tasks: await listBoardTasks() }
      case 'create_task': {
        if (!args.title?.trim()) return { success: false, error: 'title is required for create_task' }
        const agentId = args.agentId || 'agent_general'
        const resolved = await getAgentById(agentId).catch(() => null)
        return {
          success: true,
          task: await upsertBoardTask({
            title: args.title,
            agentId,
            agent: resolved?.name || agentId,
            goalId: args.goalId || null,
            status: args.status || 'backlog',
            priority: args.priority || 'normal',
            requiresApproval: Boolean(args.requiresApproval),
          }, 'agent'),
        }
      }
      case 'move_task': {
        if (!args.taskId) return { success: false, error: 'taskId is required for move_task' }
        const result = await moveBoardTask(args.taskId, args.status || 'progress', 'agent')
        if (!result) return { success: false, error: `Task ${args.taskId} not found` }
        return { success: true, result }
      }
      case 'request_approval':
        if (!args.title?.trim()) return { success: false, error: 'title is required for request_approval' }
        return {
          success: true,
          approval: await requestApproval({
            type: 'custom',
            agentId: args.agentId || 'agent_general',
            targetId: args.taskId || null,
            title: args.title,
            detail: args.detail || '',
          }),
        }
      case 'list_approvals':
        return { success: true, approvals: await listApprovals() }
      case 'run_heartbeat':
        return { success: true, run: await runAgentHeartbeat(args.agentId || 'agent_yogatik', { trigger: 'agent' }) }
      case 'list_heartbeats':
        return { success: true, runs: await listHeartbeatRuns() }
      case 'audit_log':
        return { success: true, entries: await listAuditLog() }
      default:
        return { success: false, error: `Unknown action: ${action}` }
    }
  },
}

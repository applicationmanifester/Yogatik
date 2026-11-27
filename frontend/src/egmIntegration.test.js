import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PRESET_AGENTS, YOGATIK_AGENT } from './agents'
import { PRESET_SKILLS } from './skills'
import { AUTONOMOUS_WORKFLOWS, AWESOME_SKILLS_CATALOG, resolveSkillMentions } from './skillsCatalog'
import { spawnAgentsTool } from './tools/spawnAgents'
import { getSessionBlackboard } from './agentBlackboard'

const mockStreamMessage = vi.fn()
vi.mock('./api', () => ({
  streamMessage: (...args) => mockStreamMessage(...args),
}))

describe('Elephant-Goldfish Model (EGM) integration', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset()
  })

  it('registers all 5 read-only Goldfish personas in PRESET_AGENTS and YOGATIK_AGENT.subAgents', () => {
    const ids = [
      'agent_egm_zoom_out',
      'agent_egm_comprehension',
      'agent_egm_design_critic',
      'agent_egm_readiness',
      'agent_egm_drift',
    ]
    const writeTools = new Set(['fs_write', 'fs_edit', 'fs_replace_content', 'fs_patch', 'spawn_agents'])

    for (const id of ids) {
      const def = PRESET_AGENTS.find(a => a.id === id)
      expect(def, `Missing preset agent ${id}`).toBeDefined()
      expect(YOGATIK_AGENT.subAgents).toContain(id)
      for (const t of def.tools) {
        expect(writeTools.has(t), `${id} must be read-only (found ${t})`).toBe(false)
      }
    }
  })

  it('registers preset_egm skill, wf_egm_spec_review workflow, and @egm-* catalog skills', () => {
    expect(PRESET_SKILLS.some(s => s.id === 'preset_egm')).toBe(true)
    expect(AUTONOMOUS_WORKFLOWS.some(w => w.id === 'wf_egm_spec_review')).toBe(true)

    const catalogIds = [
      'egm-brainstorm',
      'egm-draft',
      'egm-review',
      'egm-resolve',
      'egm-lite',
      'egm-bootstrap',
      'egm-drift-report',
    ]
    for (const cid of catalogIds) {
      const entry = AWESOME_SKILLS_CATALOG.find(s => s.id === cid)
      expect(entry, `Missing catalog skill ${cid}`).toBeDefined()
      expect(entry.enforceTools).toBe(true)
    }

    const mentioned = resolveSkillMentions('Please run @egm-review, @egm-resolve, and @egm-drift-report')
    expect(mentioned.map(m => m.id)).toEqual(['egm-review', 'egm-resolve', 'egm-drift-report'])
  })

  it('exposes fresh_context in spawn_agents schema and skips blackboard when true', async () => {
    expect(spawnAgentsTool.schema.parameters.properties.fresh_context?.type).toBe('boolean')
    expect(spawnAgentsTool.schema.parameters.properties.tasks.items.properties.fresh_context?.type).toBe('boolean')

    const bb = getSessionBlackboard('chat')
    bb.appendNote('SECRET_PRIOR_BRAINSTORM_CONTEXT', 'elephant')

    mockStreamMessage.mockImplementation((req, onToken, _onTool, onDone) => {
      onToken('Goldfish finding')
      onDone()
    })

    const res = await spawnAgentsTool.execute({
      fresh_context: true,
      tasks: [{ agent: 'agent_egm_comprehension', task: 'Review docs/designs/demo.md' }],
    })

    expect(res.success).toBe(true)
    expect(mockStreamMessage).toHaveBeenCalledTimes(1)
    const sentReq = mockStreamMessage.mock.calls[0][0]
    expect(sentReq.message).toBe('Review docs/designs/demo.md')
    expect(sentReq.message).not.toContain('SECRET_PRIOR_BRAINSTORM_CONTEXT')
    expect(sentReq.messages).toEqual([])
    expect(sentReq.use_web_search).toBe(false)
  })
})

/**
 * spawn_agents — sub-agent delegation. The main assistant hands focused
 * sub-tasks to specialist agents (Researcher, Coder, Writer, …) that each run
 * the full agent loop in parallel, then their results are merged and returned.
 *
 * Guards: sub-agents cannot spawn further agents (no infinite recursion), and
 * each is tool-scoped to its agent definition. Concurrency runs through the
 * shared global agent pool — by default as many sub-agents at once as there are
 * tasks (chat_prefs.max_parallel_agents overrides), a rolling window so a slow
 * sub-agent no longer stalls the rest, and this fan-out shares one budget with
 * crew_orchestrator so the two together can't storm the provider's rate limit.
 * Dynamic imports break the tools ↔ api ↔ agent cycle.
 */

export const spawnAgentsTool = {
  schema: {
    description:
      'Delegate focused sub-tasks to specialist sub-agents that run concurrently, then get their merged results. ' +
      'Use for complex, multi-part tasks (e.g. research + code + writing). Each sub-agent is one of: ' +
      'researcher, coder, writer, analyst, planner, or any specialist agent id/role. Do NOT use for simple single-step tasks.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'The sub-tasks to delegate, run concurrently or in DAG dependency waves under a shared budget. Provide as many independent sub-tasks as the work needs.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional identifier for DAG dependency referencing (e.g. "research", "coder").' },
              agent: { type: 'string', description: 'Specialist to use: researcher | coder | writer | analyst | planner, or a custom agent id/role.' },
              task: { type: 'string', description: 'A clear, self-contained instruction for that specialist.' },
              depends_on: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of task IDs that must finish before this task starts, receiving upstream context.',
              },
              fresh_context: {
                type: 'boolean',
                description: 'Goldfish isolation mode: when true, omits shared session blackboard context so the sub-agent reviews with fresh eyes and zero prior conversation bias.',
              },
            },
            required: ['agent', 'task'],
          },
        },
        isolate_workspace: {
          type: 'boolean',
          description: 'Give each sub-agent its OWN working-folder binding so parallel agents cannot overwrite one another’s files. Off by default; an isolated agent starts with no folders until one is bound to it.',
        },
        fresh_context: {
          type: 'boolean',
          description: 'Default Goldfish isolation mode for all tasks in this batch (omit shared session blackboard context). Individual tasks can override this.',
        },
      },
      required: ['tasks'],
    },
  },

  async execute({ tasks, isolate_workspace: isolateWorkspace = false, fresh_context: defaultFreshContext = false }, opts = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { success: false, error: 'Provide a non-empty tasks array.' }
    }
    const [{ streamMessage }, { getAgentById }, { getToolNames }, { runAgentPool }, isolation, localFs, { getSessionBlackboard }, { resolveTaskWaves, enrichTaskWithUpstream }, controlPlane] = await Promise.all([
      import('../api'), import('../agents'), import('./index'), import('../agentPool'),
      import('../agentIsolation'), import('./localFs'), import('../agentBlackboard'),
      import('./dagResolver'), import('../paperclipControlPlane'),
    ])
    const allNames = getToolNames()

    // The parent is the chat that spawned these agents, not whichever chat is
    // active right now. It decides the isolation plan, the workspace slot each
    // sub-agent gets and which blackboard they share — so resolving it from the
    // ambient slot would hand a whole team to the wrong conversation.
    const parentId = localFs.getWorkspaceCtx(opts?.ctx)?.conversationId ?? 'chat'
    const plan = isolation.planIsolation(parentId, tasks.map(t => t.agent), { isolate: !!isolateWorkspace })
    const blackboard = getSessionBlackboard(parentId)

    const runOne = async ({ agent, task, fresh_context: taskFreshContext }, index) => {
      const def = (await getAgentById(agent)) || null
      const govId = def?.id || agent
      const budgetCheck = await controlPlane.checkAgentBudget(govId)
      if (!budgetCheck.allowed) {
        return {
          agent: def?.name || agent,
          role: def?.role || agent,
          result: `[Governance blocked: ${budgetCheck.reason}]`,
          durationMs: 0,
          blocked: true,
        }
      }
      const govProfile = budgetCheck.profile
      // Scope tools to the agent's allowlist and forbid re-delegation.
      const slot = plan[index] || { conversationId: parentId, isolated: false }
      const disabled = new Set(isolation.mergeIsolatedDisabled([], { isolated: slot.isolated }))
      if (def?.tools?.length) {
        const allow = new Set(def.tools)
        for (const n of allNames) if (!allow.has(n)) disabled.add(n)
      }

      // Goldfish isolation: skip shared blackboard context when fresh_context is enabled
      const isFreshContext = Boolean(taskFreshContext ?? defaultFreshContext)
      const sharedContext = isFreshContext ? '' : blackboard.formatContextPrompt()
      const enrichedTask = sharedContext ? `${task}\n\n${sharedContext}` : task

      const baseSystem = def?.system || `You are a focused specialist. Complete this sub-task precisely and return only the result.`
      const systemWithGov = govProfile?.standingInstructions
        ? `${baseSystem}\n\n[Standing Instructions]\n${govProfile.standingInstructions}`
        : baseSystem

      const startTime = Date.now()
      let text = ''
      let doneMeta = null
      await new Promise((resolve) => {
        streamMessage(
          {
            message: enrichedTask,
            messages: [],
            provider: def?.provider || undefined,
            model: def?.model || undefined,
            system_prompt: systemWithGov,
            use_tools: true,
            use_web_search: !isFreshContext && (!def?.tools?.length || def.tools.includes('web_search')),
            disabledTools: [...disabled],
            agent_override: def || undefined,
            channel: `subagent-${Math.random().toString(36).slice(2, 8)}`,
            workspace_id: slot.conversationId,
          },
          (t) => { text += t },
          null,
          (_content, meta) => { doneMeta = meta; resolve() },
          (err) => {
            if (!text.trim()) text = `[Sub-agent error: ${err?.message || err}]`
            resolve()
          },        // a failed sub-agent returns its error text, never rejects the batch
        )
      })

      if (doneMeta?.telemetry) {
        await controlPlane.recordAgentSpend(govId, {
          inputTokens: doneMeta.telemetry.inputTokens || 0,
          outputTokens: doneMeta.telemetry.outputTokens || 0,
          provider: doneMeta.provider || def?.provider,
          model: doneMeta.model || def?.model,
        })
      }

      const durationMs = Date.now() - startTime
      const trimmedResult = text.trim() || '(no output)'

      // Publish short summary note to the shared blackboard for downstream agents (unless fresh_context)
      if (!isFreshContext && trimmedResult.length > 0 && !trimmedResult.startsWith('[Sub-agent error')) {
        const snippet = trimmedResult.slice(0, 240).replace(/\n+/g, ' ')
        blackboard.appendNote(snippet, def?.name || agent)
      }

      return {
        agent: def?.name || agent,
        role: def?.role || agent,
        result: trimmedResult,
        durationMs,
      }
    }

    // Resolve topological execution waves for DAG dependencies
    const waves = resolveTaskWaves(tasks)
    const resultsById = new Map()
    const finalOrderedResults = new Array(tasks.length)

    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w]
      const waveTasks = wave.map(node => ({
        ...node.item,
        task: enrichTaskWithUpstream(node.item, node.dependsOn, resultsById),
        _origIndex: node.index,
        _id: node.id,
      }))

      const pooledWave = await runAgentPool(waveTasks, (t) => runOne(t, t._origIndex), parentId)

      pooledWave.forEach((res, idx) => {
        const origIdx = waveTasks[idx]._origIndex
        const taskId = waveTasks[idx]._id
        const safeRes = (res && res.error && !res.result)
          ? { agent: waveTasks[idx]?.agent || 'agent', role: waveTasks[idx]?.agent || 'agent', result: `(failed: ${res.error})`, error: res.error }
          : res
        resultsById.set(taskId, safeRes)
        finalOrderedResults[origIdx] = safeRes
      })
    }

    return {
      success: true,
      delegated: finalOrderedResults.length,
      wavesCount: waves.length,
      results: finalOrderedResults,
      note: 'Synthesize these specialist results into one coherent answer for the user.',
    }
  },
}

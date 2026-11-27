/**
 * Core pure logic for Local CLI Agent Drivers (Claude Code, Codex, Grok CLI).
 * Normalizes each CLI's native output stream into a single canonical event stream.
 * Kept pure (no Electron imports) so it can be unit-tested directly under Vitest.
 */

const DRIVER_SPECS = {
  claude: {
    id: 'claude',
    label: 'Claude Code CLI',
    defaultBinary: 'claude',
    protocol: 'stream-json',
    description: 'Local Anthropic Claude Code CLI using your existing login/subscription.',
  },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    defaultBinary: 'codex',
    protocol: 'json-rpc',
    description: 'Local OpenAI Codex CLI using your existing ChatGPT/API login.',
  },
  grok: {
    id: 'grok',
    label: 'Grok CLI',
    defaultBinary: 'grok',
    protocol: 'acp',
    description: 'Local xAI Grok CLI using your existing SuperGrok/xAI login.',
  },
}

const VALID_ENGINES = Object.keys(DRIVER_SPECS)

/**
 * Validates that an engine id is supported.
 * @param {string} engine
 */
function assertEngine(engine) {
  const id = String(engine || '').toLowerCase().trim()
  if (!VALID_ENGINES.includes(id)) {
    throw new Error(`Unsupported CLI driver engine "${engine}". Expected one of: ${VALID_ENGINES.join(', ')}`)
  }
  return id
}

/**
 * Builds safe spawn arguments (no shell interpolation) for a given CLI engine.
 * @param {string} engine
 * @param {{ prompt?: string, model?: string, sessionId?: string, autoApprove?: boolean }} opts
 */
function buildCliArgs(engine, opts = {}) {
  const id = assertEngine(engine)
  const prompt = String(opts.prompt || '')
  const model = opts.model ? String(opts.model).trim() : ''

  if (id === 'claude') {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']
    if (model) args.push('--model', model)
    if (opts.sessionId) args.push('--resume', String(opts.sessionId))
    if (opts.autoApprove) args.push('--dangerously-skip-permissions')
    return args
  }

  if (id === 'codex') {
    const args = ['exec', '--json']
    if (model) args.push('--model', model)
    if (opts.autoApprove) args.push('--full-auto')
    args.push(prompt)
    return args
  }

  // grok
  const args = ['--prompt', prompt, '--json']
  if (model) args.push('--model', model)
  return args
}

/**
 * Normalizes a single stdout line from a CLI driver into one or more canonical events.
 * Canonical event shapes:
 *   { type: 'text', text: string }
 *   { type: 'tool_use', id?: string, name: string, input?: any }
 *   { type: 'tool_result', id?: string, output: string, isError?: boolean }
 *   { type: 'permission_request', id: string, tool: string, description: string, args?: any }
 *   { type: 'status', message: string }
 *   { type: 'error', message: string }
 *   { type: 'done', sessionId?: string }
 */
function normalizeCliLine(engine, rawLine) {
  const line = String(rawLine || '').trim()
  if (!line) return []

  let parsed = null
  try {
    parsed = JSON.parse(line)
  } catch {
    return [{ type: 'text', text: line + '\n', raw: true }]
  }

  if (!parsed || typeof parsed !== 'object') {
    return [{ type: 'text', text: line + '\n', raw: true }]
  }

  // Claude stream-json format
  if (engine === 'claude') {
    if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
      const events = []
      for (const block of parsed.message.content) {
        if (block.type === 'text' && block.text) {
          events.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          events.push({ type: 'tool_use', id: block.id, name: block.name || 'tool', input: block.input })
        }
      }
      return events
    }
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      return [{ type: 'text', text: parsed.delta.text }]
    }
    if (parsed.type === 'result') {
      const out = []
      if (typeof parsed.result === 'string' && parsed.result) {
        out.push({ type: 'text', text: parsed.result })
      }
      out.push({ type: 'done', sessionId: parsed.session_id || undefined })
      return out
    }
    if (parsed.type === 'error' || parsed.is_error) {
      return [{ type: 'error', message: parsed.error?.message || parsed.message || 'Claude CLI error' }]
    }
  }

  // Codex exec --json format
  if (engine === 'codex') {
    if (parsed.type === 'item.completed' && parsed.item) {
      const item = parsed.item
      if (item.type === 'agent_message' && item.text) {
        return [{ type: 'text', text: item.text }]
      }
      if (item.type === 'command_execution' || item.type === 'mcp_tool_call') {
        return [{
          type: 'tool_use',
          id: item.id,
          name: item.name || 'shell',
          input: item.command || item.arguments,
        }]
      }
    }
    if (parsed.type === 'turn.completed') {
      return [{ type: 'done', sessionId: parsed.thread_id || undefined }]
    }
    if (parsed.type === 'error' || parsed.type === 'turn.failed') {
      return [{ type: 'error', message: parsed.message || parsed.error?.message || 'Codex CLI error' }]
    }
  }

  // Generic JSON / Grok ACP fallback
  if (parsed.type === 'permission_request') {
    return [{
      type: 'permission_request',
      id: String(parsed.id || Date.now()),
      tool: String(parsed.tool || 'command'),
      description: String(parsed.description || 'Approve action?'),
      args: parsed.args || {},
    }]
  }
  if (typeof parsed.text === 'string') {
    return [{ type: 'text', text: parsed.text }]
  }
  if (typeof parsed.content === 'string') {
    return [{ type: 'text', text: parsed.content }]
  }
  if (parsed.type === 'done' || parsed.done === true) {
    return [{ type: 'done', sessionId: parsed.sessionId }]
  }
  if (parsed.error) {
    return [{ type: 'error', message: typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || 'CLI error') }]
  }

  return []
}

module.exports = {
  DRIVER_SPECS,
  VALID_ENGINES,
  assertEngine,
  buildCliArgs,
  normalizeCliLine,
}

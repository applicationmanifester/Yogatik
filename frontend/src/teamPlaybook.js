/**
 * Portable Team Playbook Import / Export (Markdown + YAML frontmatter).
 * Inspired by OpenMausBot's FORMAT.md portable team packages:
 * - Exports bots, Chief of Staff, #channels, routines (paused), and connector names.
 * - Never exports API keys, credentials, transcripts, or host computer access.
 * - Imports routines paused by default and connectors disabled until approved.
 */

function yamlScalar(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  if (s === '' || /[:#\n\r"'{}\[\],&*?|>!%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s)
  }
  return s
}

function unquoteYaml(raw) {
  const s = String(raw || '').trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s.startsWith('"')) {
      try {
        return JSON.parse(s)
      } catch {
        return s.slice(1, -1)
      }
    }
    return s.slice(1, -1)
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(part => unquoteYaml(part))
  }
  return s
}

/**
 * Exports a complete team configuration to a portable Markdown string with YAML frontmatter.
 */
export function exportTeamMarkdown({
  name = 'Yogatik Team',
  description = 'Portable multi-agent team playbook',
  chiefOfStaff = null,
  bots = [],
  channels = [],
  routines = [],
  connectors = [],
} = {}) {
  const lines = ['---']
  lines.push(`yogatik_team: 1`)
  lines.push(`name: ${yamlScalar(name)}`)
  lines.push(`description: ${yamlScalar(description)}`)
  if (chiefOfStaff) lines.push(`chief_of_staff: ${yamlScalar(chiefOfStaff)}`)

  lines.push('bots:')
  if (!bots.length) {
    lines.push('  []')
  } else {
    for (const b of bots) {
      lines.push(`  - id: ${yamlScalar(b.id || '')}`)
      lines.push(`    name: ${yamlScalar(b.name || 'Bot')}`)
      lines.push(`    role: ${yamlScalar(b.role || 'assistant')}`)
      if (b.engine) lines.push(`    engine: ${yamlScalar(b.engine)}`)
      if (b.model) lines.push(`    model: ${yamlScalar(b.model)}`)
      if (b.description) lines.push(`    description: ${yamlScalar(b.description)}`)
      if (b.system) lines.push(`    system: ${yamlScalar(b.system)}`)
    }
  }

  lines.push('channels:')
  if (!channels.length) {
    lines.push('  []')
  } else {
    for (const c of channels) {
      lines.push(`  - id: ${yamlScalar(c.id || '')}`)
      lines.push(`    name: ${yamlScalar(c.name || '#general')}`)
      lines.push(`    routing: ${yamlScalar(c.routingMode || 'auto')}`)
      if (c.leadBotId) lines.push(`    lead_bot: ${yamlScalar(c.leadBotId)}`)
      lines.push(`    bots: [${(c.botIds || []).map(yamlScalar).join(', ')}]`)
      if (c.sharedInstructions) lines.push(`    instructions: ${yamlScalar(c.sharedInstructions)}`)
    }
  }

  lines.push('routines:')
  if (!routines.length) {
    lines.push('  []')
  } else {
    for (const r of routines) {
      lines.push(`  - name: ${yamlScalar(r.name || 'Routine')}`)
      lines.push(`    schedule: ${yamlScalar(r.schedule || '0 9 * * 1-5')}`)
      lines.push(`    paused: true`)
      if (r.prompt) lines.push(`    prompt: ${yamlScalar(r.prompt)}`)
    }
  }

  lines.push('connectors:')
  if (!connectors.length) {
    lines.push('  []')
  } else {
    for (const conn of connectors) {
      const label = typeof conn === 'string' ? conn : (conn.name || conn.id || 'connector')
      lines.push(`  - name: ${yamlScalar(label)}`)
      lines.push(`    enabled: false`)
    }
  }

  lines.push('---', '')
  lines.push(`# ${name}`, '')
  if (description) lines.push(description, '')

  if (bots.length) {
    lines.push('## Roster', '')
    for (const b of bots) {
      lines.push(`- **${b.name}** (\`${b.role || 'assistant'}\`): ${b.description || 'Specialist agent'}`)
    }
    lines.push('')
  }

  if (channels.length) {
    lines.push('## Channels', '')
    for (const c of channels) {
      lines.push(`- **${c.name}** (routing: ${c.routingMode || 'auto'}): ${c.sharedInstructions || 'Shared team channel'}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Parses a portable team Markdown file with YAML frontmatter.
 * Enforces safe defaults: routines are forced paused=true and connectors enabled=false.
 */
export function parseTeamMarkdown(mdText) {
  const text = String(mdText || '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    throw new Error('Not a valid team playbook: missing YAML frontmatter (---).')
  }

  const yamlLines = match[1].split(/\r?\n/)
  const body = match[2] || ''

  const root = {
    name: '',
    description: '',
    chiefOfStaff: null,
    bots: [],
    channels: [],
    routines: [],
    connectors: [],
    playbookMarkdown: body.trim(),
  }

  let currentSection = null
  let currentItem = null
  let blockTarget = null // { obj, key, indent, lines }

  const flushBlock = () => {
    if (!blockTarget) return
    blockTarget.obj[blockTarget.key] = blockTarget.lines.join('\n').trimEnd()
    blockTarget = null
  }

  for (const rawLine of yamlLines) {
    if (blockTarget) {
      const trimmed = rawLine.trim()
      const indentMatch = rawLine.match(/^(\s*)/)
      const indent = indentMatch ? indentMatch[1].length : 0
      if (!trimmed || indent > blockTarget.indent) {
        blockTarget.lines.push(trimmed ? rawLine.slice(Math.min(indent, blockTarget.indent + 2)) : '')
        continue
      }
      flushBlock()
    }

    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue

    const topMatch = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (topMatch) {
      const [, key, val] = topMatch
      currentItem = null
      if (['bots', 'channels', 'routines', 'connectors'].includes(key)) {
        currentSection = key
        continue
      }
      currentSection = null
      if (val === '|' || val === '>') {
        blockTarget = { obj: root, key: key === 'chief_of_staff' ? 'chiefOfStaff' : key, indent: 0, lines: [] }
        continue
      }
      const parsedVal = unquoteYaml(val)
      if (key === 'name') root.name = String(parsedVal || '')
      else if (key === 'description') root.description = String(parsedVal || '')
      else if (key === 'chief_of_staff') root.chiefOfStaff = parsedVal ? String(parsedVal) : null
      continue
    }

    if (currentSection && rawLine.trim() === '[]') {
      continue
    }

    const itemStart = rawLine.match(/^(\s*)-\s+([A-Za-z0-9_]+):\s*(.*)$/)
    if (itemStart && currentSection) {
      const [, indentStr, key, val] = itemStart
      currentItem = {}
      root[currentSection].push(currentItem)
      if (val === '|' || val === '>') {
        blockTarget = { obj: currentItem, key, indent: indentStr.length + 2, lines: [] }
      } else {
        currentItem[key] = unquoteYaml(val)
      }
      continue
    }

    const itemProp = rawLine.match(/^(\s+)([A-Za-z0-9_]+):\s*(.*)$/)
    if (itemProp && currentItem) {
      const [, indentStr, key, val] = itemProp
      if (val === '|' || val === '>') {
        blockTarget = { obj: currentItem, key, indent: indentStr.length, lines: [] }
      } else {
        currentItem[key] = unquoteYaml(val)
      }
    }
  }
  flushBlock()

  if (!root.name) {
    throw new Error('Team playbook is missing a team "name" in frontmatter.')
  }

  // Normalize & enforce safety boundaries
  root.bots = root.bots.map((b, idx) => ({
    id: String(b.id || `team_bot_${idx + 1}`),
    name: String(b.name || `Bot ${idx + 1}`),
    role: String(b.role || 'assistant'),
    engine: b.engine ? String(b.engine) : null,
    model: b.model ? String(b.model) : null,
    description: String(b.description || ''),
    system: String(b.system || `You are ${b.name || 'a specialist assistant'}, acting as ${b.role || 'assistant'}.`),
  }))

  root.channels = root.channels.map((c, idx) => ({
    id: String(c.id || `ch_${idx + 1}`),
    name: String(c.name || `#channel-${idx + 1}`),
    routingMode: ['auto', 'lead', 'broadcast'].includes(c.routing) ? c.routing : 'auto',
    leadBotId: c.lead_bot ? String(c.lead_bot) : (root.bots[0]?.id || null),
    botIds: Array.isArray(c.bots) ? c.bots.map(String) : root.bots.map(b => b.id),
    sharedInstructions: String(c.instructions || ''),
  }))

  root.routines = root.routines.map((r) => ({
    name: String(r.name || 'Routine'),
    schedule: String(r.schedule || '0 9 * * 1-5'),
    prompt: String(r.prompt || ''),
    paused: true, // Always arrive paused for safety
  }))

  root.connectors = root.connectors.map((c) => ({
    name: String(c.name || 'connector'),
    enabled: false, // Always disabled until user approves
  }))

  return root
}

/**
 * Applies a parsed team playbook into Yogatik's agent registry and channels store.
 */
export async function importTeamIntoYogatik(parsed, { upsertAgent, saveChannel }) {
  const createdBots = []
  for (const bot of parsed.bots || []) {
    const saved = await upsertAgent({
      id: bot.id,
      name: bot.name,
      role: bot.role,
      description: bot.description,
      system: bot.system,
      model: bot.model || null,
      provider: bot.engine ? `cli:${bot.engine}` : null,
      tools: [],
      canDelegate: true,
    })
    createdBots.push(saved)
  }

  const createdChannels = []
  for (const ch of parsed.channels || []) {
    const saved = await saveChannel(ch)
    createdChannels.push(saved)
  }

  return {
    name: parsed.name,
    botsCount: createdBots.length,
    channelsCount: createdChannels.length,
    routinesPaused: (parsed.routines || []).length,
    connectorsPending: (parsed.connectors || []).length,
  }
}

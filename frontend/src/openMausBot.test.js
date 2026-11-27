import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { exportTeamMarkdown, parseTeamMarkdown } from './teamPlaybook'
import { routeMessageToBot, generateBotAvatarSvg } from './botChannels'

const require = createRequire(import.meta.url)
const cliCore = require('../electron/cliDriversCore.cjs')
const harnessCore = require('../electron/harnessServerCore.cjs')

describe('OpenMausBot integration: CLI Drivers Core', () => {
  it('builds safe spawn args for claude, codex, and grok', () => {
    expect(cliCore.buildCliArgs('claude', { prompt: 'hello', model: 'sonnet' }))
      .toEqual(['-p', 'hello', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet'])
    expect(cliCore.buildCliArgs('codex', { prompt: 'fix tests', autoApprove: true }))
      .toEqual(['exec', '--json', '--full-auto', 'fix tests'])
    expect(cliCore.buildCliArgs('grok', { prompt: 'summarize' }))
      .toEqual(['--prompt', 'summarize', '--json'])
    expect(() => cliCore.buildCliArgs('unknown', { prompt: 'x' })).toThrow()
  })

  it('normalizes claude stream-json and codex json-rpc lines', () => {
    const claudeEvents = cliCore.normalizeCliLine('claude', JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'bash', input: { cmd: 'ls' } }] },
    }))
    expect(claudeEvents).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'bash', input: { cmd: 'ls' } },
    ])

    const codexDone = cliCore.normalizeCliLine('codex', JSON.stringify({ type: 'turn.completed', thread_id: 'th_1' }))
    expect(codexDone).toEqual([{ type: 'done', sessionId: 'th_1' }])
  })
})

describe('OpenMausBot integration: Harness Server Core', () => {
  it('generates and verifies pairing tokens and formats SSE + NDJSON', () => {
    const token = harnessCore.generatePairingToken()
    const code = harnessCore.generatePairingCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(harnessCore.verifyToken(token, token)).toBe(true)
    expect(harnessCore.verifyToken('wrong', token)).toBe(false)

    const url = harnessCore.createPairingUrl({ port: 8799, token })
    expect(url).toContain('http://127.0.0.1:8799/pair?token=')

    const sse = harnessCore.formatSseEvent('bot_event', { ok: true }, 42)
    expect(sse).toContain('id: 42\n')
    expect(sse).toContain('event: bot_event\n')
    expect(sse).toContain('data: {"ok":true}\n')

    const ndjson = harnessCore.serializeNdjsonEntry({ role: 'user', text: 'ping' })
    const parsed = harnessCore.parseNdjsonTranscript(ndjson)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].text).toBe('ping')
  })
})

describe('OpenMausBot integration: Team Markdown Playbook', () => {
  it('round-trips bots, channels, and enforces paused routines / disabled connectors', () => {
    const md = exportTeamMarkdown({
      name: 'Launch Squad',
      description: 'Product launch team',
      chiefOfStaff: 'Lead Bot',
      bots: [{ id: 'b1', name: 'Coder', role: 'coder', engine: 'claude', description: 'Writes code', system: 'Write clean code.' }],
      channels: [{ id: 'c1', name: '#launch', routingMode: 'auto', leadBotId: 'b1', botIds: ['b1'], sharedInstructions: 'Ship fast.' }],
      routines: [{ name: 'Daily standup', schedule: '0 9 * * *', paused: false }],
      connectors: ['GitHub', 'Slack'],
    })

    const parsed = parseTeamMarkdown(md)
    expect(parsed.name).toBe('Launch Squad')
    expect(parsed.chiefOfStaff).toBe('Lead Bot')
    expect(parsed.bots[0].engine).toBe('claude')
    expect(parsed.channels[0].name).toBe('#launch')
    expect(parsed.routines[0].paused).toBe(true)
    expect(parsed.connectors[0].enabled).toBe(false)
  })

  it('parses YAML multiline block scalars and 0-indent lists', () => {
    const md = `---
name: Multiline Team
bots:
- id: b_multi
  name: Architect
  role: architect
  system: |
    Line one
    Line two
---
# Multiline Team`
    const parsed = parseTeamMarkdown(md)
    expect(parsed.bots).toHaveLength(1)
    expect(parsed.bots[0].system).toBe('Line one\nLine two')
  })

  it('rejects malformed playbooks without frontmatter or team name', () => {
    expect(() => parseTeamMarkdown('# Plain markdown')).toThrow()
    expect(() => parseTeamMarkdown('---\ndescription: No name\n---')).toThrow()
  })
})

describe('OpenMausBot integration: Bot Channels & Avatars', () => {
  const bots = [
    { id: 'b_lead', name: 'Yogatik AI', role: 'generalist', description: 'General lead' },
    { id: 'b_code', name: 'Coder', role: 'coder', description: 'TypeScript React debugging specialist' },
    { id: 'b_res', name: 'Researcher', role: 'researcher', description: 'Deep web research and citations' },
  ]
  const channel = { id: 'ch_work', name: '#work', botIds: ['b_lead', 'b_code', 'b_res'], leadBotId: 'b_lead', routingMode: 'auto' }

  it('routes @mentions immediately and auto-routes by keyword overlap', () => {
    expect(routeMessageToBot('Hey @researcher check this', channel, bots).botIds).toEqual(['b_res'])
    expect(routeMessageToBot('Fix this TypeScript React debugging bug', channel, bots).botIds).toEqual(['b_code'])
    expect(routeMessageToBot('hello there', channel, bots).botIds).toEqual(['b_lead'])
    expect(routeMessageToBot('hello', { ...channel, routingMode: 'lead' }, bots).botIds).toEqual(['b_lead'])
    expect(routeMessageToBot('hello', { ...channel, routingMode: 'broadcast' }, bots).botIds).toEqual(['b_lead', 'b_code', 'b_res'])
  })

  it('generates deterministic SVG data URIs', () => {
    const a = generateBotAvatarSvg('Coder', 'coder')
    const b = generateBotAvatarSvg('Coder', 'coder')
    expect(a).toBe(b)
    expect(a.startsWith('data:image/svg+xml;utf8,')).toBe(true)
  })
})

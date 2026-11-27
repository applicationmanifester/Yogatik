/**
 * Bot Channels & Fast Auto-Router (inspired by OpenMausBot #channels + Jev routing).
 * - Keeps Work, Personal, and project contexts in separate #channels with their own
 *   shared instructions, working folder, bot roster, and routing mode.
 * - Deterministic SVG avatar generator for bot contacts.
 */

import { getSetting, setSetting } from './db'

const CHANNELS_KEY = 'bot_channels'

export const DEFAULT_CHANNELS = [
  {
    id: 'ch_work',
    name: '#work',
    topic: 'Engineering, architecture, code review, and project delivery',
    botIds: ['agent_yogatik', 'agent_coder', 'agent_researcher', 'agent_auditor'],
    leadBotId: 'agent_yogatik',
    routingMode: 'auto',
    sharedInstructions: 'Prioritize accuracy, testability, and concise technical answers.',
    workingFolder: '',
  },
  {
    id: 'ch_personal',
    name: '#personal',
    topic: 'Writing, planning, research, and daily tasks',
    botIds: ['agent_general', 'agent_writer', 'agent_planner'],
    leadBotId: 'agent_general',
    routingMode: 'auto',
    sharedInstructions: 'Keep responses practical, clear, and well-structured.',
    workingFolder: '',
  },
]

export async function getChannels() {
  const stored = await getSetting(CHANNELS_KEY, null)
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_CHANNELS
  return stored
}

export async function saveChannel(channel) {
  const list = await getChannels()
  const cleanName = String(channel.name || '#general').trim()
  const normalizedName = cleanName.startsWith('#') ? cleanName : `#${cleanName}`
  const id = channel.id || `ch_${normalizedName.slice(1).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`
  const clean = {
    id,
    name: normalizedName,
    topic: String(channel.topic || '').trim(),
    botIds: Array.isArray(channel.botIds) ? channel.botIds.filter(Boolean) : [],
    leadBotId: channel.leadBotId || (channel.botIds?.[0] || 'agent_yogatik'),
    routingMode: ['auto', 'lead', 'broadcast'].includes(channel.routingMode) ? channel.routingMode : 'auto',
    sharedInstructions: String(channel.sharedInstructions || '').trim(),
    workingFolder: String(channel.workingFolder || '').trim(),
  }
  const next = [...list.filter(c => c.id !== id), clean]
  await setSetting(CHANNELS_KEY, next)
  return clean
}

export async function deleteChannel(id) {
  const list = await getChannels()
  const next = list.filter(c => c.id !== id)
  await setSetting(CHANNELS_KEY, next)
  return next
}

/**
 * Fast intent router for #channels:
 * 1. Explicit @mention (@coder, @researcher, @"Bot Name") wins immediately.
 * 2. If routingMode === 'lead', returns leadBotId.
 * 3. If routingMode === 'broadcast', returns all channel botIds.
 * 4. In 'auto' mode, scores each bot in the channel by role/name/description token overlap,
 *    falling back to leadBotId when no bot has a strong match.
 */
export function routeMessageToBot(text, channel, allBots = []) {
  const msg = String(text || '').trim()
  const memberIds = Array.isArray(channel?.botIds) && channel.botIds.length
    ? channel.botIds
    : allBots.map(b => b.id)

  const members = memberIds
    .map(id => allBots.find(b => b.id === id))
    .filter(Boolean)

  const leadId = channel?.leadBotId || members[0]?.id || allBots[0]?.id || null

  // 1. Explicit @mention check
  const mentionMatch = msg.match(/@([A-Za-z0-9_-]+)/)
  if (mentionMatch) {
    const q = mentionMatch[1].toLowerCase()
    const mentioned = members.find(b =>
      b.id.toLowerCase() === q ||
      (b.role || '').toLowerCase() === q ||
      b.name.toLowerCase().replace(/\s+/g, '') === q ||
      b.name.toLowerCase().includes(q)
    )
    if (mentioned) return { botIds: [mentioned.id], reason: `mention:@${mentionMatch[1]}` }
  }

  if (channel?.routingMode === 'broadcast') {
    return { botIds: members.map(m => m.id), reason: 'broadcast' }
  }

  if (channel?.routingMode === 'lead' || members.length <= 1) {
    return { botIds: leadId ? [leadId] : [], reason: 'lead' }
  }

  // 2. Fast keyword/role scoring
  const tokens = msg.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3)
  let bestBot = null
  let bestScore = 0

  for (const bot of members) {
    const haystack = `${bot.name} ${bot.role || ''} ${bot.description || ''}`.toLowerCase()
    let score = 0
    for (const tok of tokens) {
      if (haystack.includes(tok)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestBot = bot
    }
  }

  if (bestBot && bestScore > 0) {
    return { botIds: [bestBot.id], reason: `auto:score=${bestScore}` }
  }

  return { botIds: leadId ? [leadId] : [], reason: 'lead-fallback' }
}

/**
 * Generates a deterministic, lightweight SVG avatar data URI for a bot contact.
 */
export function generateBotAvatarSvg(seed = 'bot', role = 'assistant') {
  const str = `${seed}:${role}`
  let hash = 0
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  const palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1']
  const bg = palette[Math.abs(hash) % palette.length]
  const bg2 = palette[Math.abs(hash >> 3) % palette.length]
  const initials = String(seed || 'B')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || 'B'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><text x="32" y="39" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-size="22" font-weight="700">${initials}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

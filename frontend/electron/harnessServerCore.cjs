/**
 * Pure core helpers for the local OpenMausBot-style HTTP+SSE Harness Server:
 * - Pairing token & 6-digit pairing code generation + constant-time verification
 * - SSE event formatting
 * - NDJSON transcript line serialization/parsing
 */

const crypto = require('crypto')

function generatePairingToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function generatePairingCode() {
  const num = crypto.randomInt(100000, 999999)
  return String(num)
}

function verifyToken(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided), 'utf8')
  const b = Buffer.from(String(expected), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function createPairingUrl({ host = '127.0.0.1', port = 8799, token, publicUrl = '' }) {
  const base = publicUrl ? String(publicUrl).replace(/\/+$/, '') : `http://${host}:${port}`
  return `${base}/pair?token=${encodeURIComponent(String(token || ''))}`
}

function formatSseEvent(eventName, data, id) {
  const lines = []
  if (id !== undefined && id !== null) lines.push(`id: ${id}`)
  if (eventName) lines.push(`event: ${eventName}`)
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  for (const part of json.split(/\r?\n/)) {
    lines.push(`data: ${part}`)
  }
  lines.push('', '')
  return lines.join('\n')
}

function serializeNdjsonEntry(entry) {
  return JSON.stringify({
    ts: entry.ts || Date.now(),
    ...entry,
  }) + '\n'
}

function parseNdjsonTranscript(raw) {
  if (!raw) return []
  const items = []
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      items.push(JSON.parse(trimmed))
    } catch {
      // skip malformed line
    }
  }
  return items
}

module.exports = {
  generatePairingToken,
  generatePairingCode,
  verifyToken,
  createPairingUrl,
  formatSseEvent,
  serializeNdjsonEntry,
  parseNdjsonTranscript,
}

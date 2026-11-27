'use strict'

/**
 * ttsDaemon.cjs — local text-to-speech / voice-over via Piper, MeloTTS, or Fish Speech.
 *
 * Same daemon pattern: probe HTTP first (user may already run a TTS service),
 * spawn managed process only when configured and nothing answers.
 *
 * Models/voices must be installed by the user into the configured root folder.
 * This daemon never bundles model weights.
 *
 * IPC surface:
 *   tts:status            → { running, port, voices }
 *   tts:speak             { text, voiceId, speed, pitch, ssml }
 *                         → { success, bytes (base64 WAV), mime, filename }
 *   tts:clone-voice       { sampleAudioBytes, text, voiceId }
 *                         → { success, bytes (base64 WAV), mime, filename }
 *   tts:set-root          { root }
 *   tts:start
 */

const { ipcMain } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { safeSend } = require('./safeWindow.cjs')

const DEFAULT_PORT = 7762
const TTS_TIMEOUT_MS = 3 * 60 * 1000

function log(msg) { console.log(`[tts] ${msg}`) }

/* ── config persistence ─────────────────────────────────────────────────── */

let configPath = null
let _config = { root: null, port: DEFAULT_PORT }
let _daemonProcess = null

function loadConfig(userDataDir) {
  configPath = path.join(userDataDir, 'tts-config.json')
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    _config = { root: raw.root || null, port: Number(raw.port) || DEFAULT_PORT }
  } catch { /* no config yet */ }
}

function saveConfig() {
  if (!configPath) return
  try { fs.writeFileSync(configPath, JSON.stringify(_config, null, 2)) } catch { /* best effort */ }
}

/* ── HTTP helpers ───────────────────────────────────────────────────────── */

function port() { return _config.port || DEFAULT_PORT }

function httpJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request({
      host: '127.0.0.1', port: port(), path: urlPath, method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : undefined,
    }, (res) => {
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`TTS service ${method} ${urlPath} → ${res.statusCode}: ${buf.slice(0, 500)}`)); return }
        try { resolve(buf ? JSON.parse(buf) : null) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(new Error('TTS service request timed out')) })
    if (payload) req.write(payload)
    req.end()
  })
}

function probeHttp(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: port(), path: '/health', method: 'GET' }, () => resolve(true))
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

/* ── status ─────────────────────────────────────────────────────────────── */

async function buildStatus() {
  const running = await probeHttp()
  let voices = []
  if (running) {
    try {
      const info = await httpJson('GET', '/voices')
      voices = Array.isArray(info?.voices) ? info.voices : []
    } catch { /* server up but /voices failed */ }
  }
  return { running, port: port(), voices }
}

/* ── IPC ────────────────────────────────────────────────────────────────── */

function registerTtsIpc(getWindow) {
  ipcMain.handle('tts:status', async () => buildStatus())

  ipcMain.handle('tts:speak', async (_e, args = {}) => {
    const win = getWindow?.()
    try {
      if (!await probeHttp()) throw new Error('TTS service is not running. Start it first (tts:start).')
      if (!args.text || !String(args.text).trim()) throw new Error('text is required')
      safeSend(win, 'tts:progress', { phase: 'queued', kind: 'tts' })
      const res = await httpJson('POST', '/speak', {
        text: String(args.text),
        voiceId: args.voiceId || '',
        speed: args.speed != null ? Number(args.speed) : 1.0,
        pitch: args.pitch != null ? Number(args.pitch) : 1.0,
        ssml: args.ssml || false,
      }, TTS_TIMEOUT_MS)
      safeSend(win, 'tts:progress', { phase: 'done', kind: 'tts' })
      return {
        success: true,
        bytes: res.bytes || '',
        mime: res.mime || 'audio/wav',
        filename: res.filename || `yogatik-tts-${Date.now()}.wav`,
        voiceId: args.voiceId || '',
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('tts:clone-voice', async (_e, args = {}) => {
    const win = getWindow?.()
    try {
      if (!await probeHttp()) throw new Error('TTS service is not running.')
      if (!args.text || !String(args.text).trim()) throw new Error('text is required')
      if (!args.sampleAudioBytes) throw new Error('sampleAudioBytes (base64) is required for voice cloning')
      safeSend(win, 'tts:progress', { phase: 'queued', kind: 'tts' })
      const res = await httpJson('POST', '/clone-voice', {
        text: String(args.text),
        voiceId: args.voiceId || `cloned-${Date.now()}`,
        sampleAudioBytes: args.sampleAudioBytes,
        speed: args.speed != null ? Number(args.speed) : 1.0,
      }, TTS_TIMEOUT_MS)
      safeSend(win, 'tts:progress', { phase: 'done', kind: 'tts' })
      return {
        success: true,
        bytes: res.bytes || '',
        mime: res.mime || 'audio/wav',
        filename: res.filename || `yogatik-tts-clone-${Date.now()}.wav`,
        voiceId: args.voiceId || '',
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('tts:set-root', async (_e, { root } = {}) => {
    if (!root || typeof root !== 'string') return { ok: false, error: 'root is required' }
    _config.root = root
    saveConfig()
    return { ok: true, status: await buildStatus() }
  })

  ipcMain.handle('tts:start', async () => {
    if (await probeHttp()) return { ok: true, already: true }
    if (!_config.root) return { ok: false, error: 'No TTS service root configured.' }
    return { ok: false, error: 'Spawning TTS service not yet implemented for this root layout.' }
  })

  log('IPC registered')
}

function destroyTtsDaemon() {
  if (_daemonProcess) {
    try { _daemonProcess.kill('SIGTERM') } catch { /* already gone */ }
    _daemonProcess = null
  }
}

module.exports = { loadConfig, registerTtsIpc, destroyTtsDaemon }

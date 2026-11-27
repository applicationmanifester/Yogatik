'use strict'

/**
 * musicDaemon.cjs — local music generation via MusicGen (Meta) or Stable Audio Open.
 *
 * Same daemon pattern as comfyDaemon.cjs: probe HTTP, spawn managed process
 * only when nothing answers, never bundle multi-GB model weights.
 *
 * The user supplies models via ComfyUI custom nodes (e.g. ComfyUI-MusicGen,
 * Stable Audio Open integration) OR a separate local Python HTTP service.
 * This daemon talks to whichever answers first.
 *
 * IPC surface:
 *   music:status        → { running, port, models, genres, sampleRate }
 *   music:generate      { prompt, durationSeconds, genre, bpm, seed }
 *                       → { success, bytes (base64 WAV), mime, filename }
 *   music:extend        { audioBytes, prompt }
 *                       → { success, bytes (base64 WAV), mime, filename }
 */

const { ipcMain } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { safeSend } = require('./safeWindow.cjs')

const DEFAULT_PORT = 7760
const MUSIC_TIMEOUT_MS = 8 * 60 * 1000

function log(msg) { console.log(`[music] ${msg}`) }

/* ── config persistence ─────────────────────────────────────────────────── */

let configPath = null
let _config = { root: null, port: DEFAULT_PORT }
let _daemonProcess = null

function loadConfig(userDataDir) {
  configPath = path.join(userDataDir, 'music-config.json')
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
        if (res.statusCode >= 400) { reject(new Error(`Music service ${method} ${urlPath} → ${res.statusCode}: ${buf.slice(0, 500)}`)); return }
        try { resolve(buf ? JSON.parse(buf) : null) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(new Error('Music service request timed out')) })
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
  let models = [], genres = [], sampleRate = 32000
  if (running) {
    try {
      const info = await httpJson('GET', '/models')
      models = Array.isArray(info?.models) ? info.models : []
      genres = Array.isArray(info?.genres) ? info.genres : []
      sampleRate = Number(info?.sampleRate) || 32000
    } catch { /* server up but /models failed */ }
  }
  return {
    running, port: port(), models, genres, sampleRate,
  }
}

/* ── IPC ────────────────────────────────────────────────────────────────── */

function registerMusicIpc(getWindow) {
  ipcMain.handle('music:status', async () => buildStatus())

  ipcMain.handle('music:generate', async (_e, args = {}) => {
    const win = getWindow?.()
    try {
      if (!await probeHttp()) throw new Error('Music service is not running. Start it first (music:start) or point music:set-root at it.')
      safeSend(win, 'music:progress', { phase: 'queued', kind: 'music' })
      const res = await httpJson('POST', '/generate', {
        prompt: args.prompt || '',
        durationSeconds: Math.max(1, Math.min(120, Math.round(Number(args.durationSeconds) || 15))),
        genre: args.genre || '',
        bpm: args.bpm ? Math.round(Number(args.bpm)) : undefined,
        seed: args.seed != null ? Math.round(Number(args.seed)) : undefined,
      }, MUSIC_TIMEOUT_MS)
      safeSend(win, 'music:progress', { phase: 'done', kind: 'music' })
      return {
        success: true,
        bytes: res.bytes || '',
        mime: res.mime || 'audio/wav',
        filename: res.filename || `yogatik-music-${Date.now()}.wav`,
        durationSeconds: args.durationSeconds || 15,
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('music:extend', async (_e, args = {}) => {
    const win = getWindow?.()
    try {
      if (!await probeHttp()) throw new Error('Music service is not running.')
      if (!args.audioBytes) throw new Error('audioBytes (base64) is required for extension')
      safeSend(win, 'music:progress', { phase: 'queued', kind: 'music' })
      const res = await httpJson('POST', '/extend', {
        audioBytes: args.audioBytes,
        prompt: args.prompt || '',
        durationSeconds: Math.max(1, Math.min(120, Math.round(Number(args.durationSeconds) || 15))),
      }, MUSIC_TIMEOUT_MS)
      safeSend(win, 'music:progress', { phase: 'done', kind: 'music' })
      return {
        success: true,
        bytes: res.bytes || '',
        mime: res.mime || 'audio/wav',
        filename: res.filename || `yogatik-music-ext-${Date.now()}.wav`,
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('music:set-root', async (_e, { root } = {}) => {
    if (!root || typeof root !== 'string') return { ok: false, error: 'root is required' }
    _config.root = root
    saveConfig()
    return { ok: true, status: await buildStatus() }
  })

  ipcMain.handle('music:start', async () => {
    if (await probeHttp()) return { ok: true, already: true }
    if (!_config.root) return { ok: false, error: 'No music service root configured.' }
    return { ok: false, error: 'Spawning music service not yet implemented for this root layout.' }
  })

  log('IPC registered')
}

function destroyMusicDaemon() {
  if (_daemonProcess) {
    try { _daemonProcess.kill('SIGTERM') } catch { /* already gone */ }
    _daemonProcess = null
  }
}

module.exports = { loadConfig, registerMusicIpc, destroyMusicDaemon }

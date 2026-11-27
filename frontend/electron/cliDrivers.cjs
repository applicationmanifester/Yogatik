/**
 * Electron main-process manager for Local CLI Agent Drivers (claude, codex, grok).
 * Spawns local CLI binaries with shell: false, normalizes stdout into canonical
 * runtime events, and forwards them to the renderer via IPC.
 */

const { ipcMain, app } = require('electron')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { DRIVER_SPECS, VALID_ENGINES, assertEngine, buildCliArgs, normalizeCliLine } = require('./cliDriversCore.cjs')

const activeRuns = new Map() // runId -> { proc, engine, botId, startedAt }
const customBinaryPaths = new Map() // engine -> string
let pathsLoaded = false

function configFilePath() {
  return path.join(app.getPath('userData'), 'cli-drivers.json')
}

function loadSavedPaths() {
  if (pathsLoaded) return
  pathsLoaded = true
  try {
    const file = configFilePath()
    if (!fs.existsSync(file)) return
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(data || {})) {
      if (VALID_ENGINES.includes(k) && typeof v === 'string' && v.trim()) {
        customBinaryPaths.set(k, v.trim())
      }
    }
  } catch {
    // ignore corrupt config
  }
}

function savePaths() {
  try {
    const obj = {}
    for (const [k, v] of customBinaryPaths.entries()) obj[k] = v
    fs.writeFileSync(configFilePath(), JSON.stringify(obj, null, 2), 'utf8')
  } catch {
    // ignore disk errors
  }
}

function probeBinary(bin) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, [bin], { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] })
    const first = String(out || '').split(/\r?\n/).map(s => s.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

function detectDrivers() {
  loadSavedPaths()
  return VALID_ENGINES.map((id) => {
    const spec = DRIVER_SPECS[id]
    const configuredPath = customBinaryPaths.get(id) || null
    const bin = configuredPath || spec.defaultBinary
    const resolvedPath = probeBinary(bin)
    return {
      ...spec,
      configuredPath,
      resolvedPath,
      available: Boolean(resolvedPath),
    }
  })
}

function emitEvent(getWindow, payload) {
  try {
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli-drivers:event', payload)
    }
  } catch {
    // ignore closed window
  }
}

function startCliRun({ runId, engine, botId, prompt, model, cwd, sessionId, autoApprove }, getWindow) {
  const id = assertEngine(engine)
  const rid = String(runId || `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
  if (activeRuns.has(rid)) {
    throw new Error(`CLI run "${rid}" is already active.`)
  }

  const bin = customBinaryPaths.get(id) || DRIVER_SPECS[id].defaultBinary
  const args = buildCliArgs(id, { prompt, model, sessionId, autoApprove })

  const proc = spawn(bin, args, {
    cwd: cwd || process.cwd(),
    shell: false,
    windowsHide: true,
    env: { ...process.env },
  })

  activeRuns.set(rid, { proc, engine: id, botId: botId || null, startedAt: Date.now() })
  emitEvent(getWindow, { runId: rid, botId, engine: id, event: { type: 'status', message: `Started ${DRIVER_SPECS[id].label}` } })

  let stdoutBuf = ''
  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8')
    const lines = stdoutBuf.split(/\r?\n/)
    stdoutBuf = lines.pop() || ''
    for (const line of lines) {
      const events = normalizeCliLine(id, line)
      for (const event of events) {
        emitEvent(getWindow, { runId: rid, botId, engine: id, event })
      }
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) {
      emitEvent(getWindow, { runId: rid, botId, engine: id, event: { type: 'status', message: text } })
    }
  })

  proc.on('error', (err) => {
    activeRuns.delete(rid)
    emitEvent(getWindow, {
      runId: rid,
      botId,
      engine: id,
      event: { type: 'error', message: `Failed to launch ${bin}: ${err.message}` },
    })
  })

  proc.on('close', (code) => {
    if (stdoutBuf.trim()) {
      for (const event of normalizeCliLine(id, stdoutBuf)) {
        emitEvent(getWindow, { runId: rid, botId, engine: id, event })
      }
    }
    activeRuns.delete(rid)
    emitEvent(getWindow, {
      runId: rid,
      botId,
      engine: id,
      event: { type: 'done', exitCode: code },
    })
  })

  return { success: true, runId: rid }
}

function stopCliRun(runId) {
  const entry = activeRuns.get(String(runId || ''))
  if (!entry) return { success: false, error: 'Run not found' }
  try {
    entry.proc.kill()
  } catch {
    // ignore
  }
  activeRuns.delete(String(runId))
  return { success: true }
}

function killAllCliDrivers() {
  for (const [rid, entry] of activeRuns.entries()) {
    try {
      entry.proc.kill()
    } catch {
      // ignore
    }
    activeRuns.delete(rid)
  }
}

function registerCliDriversIpc(getWindow) {
  ipcMain.handle('cli-drivers:detect', async () => ({
    success: true,
    drivers: detectDrivers(),
  }))

  ipcMain.handle('cli-drivers:set-path', async (_e, { engine, binaryPath } = {}) => {
    loadSavedPaths()
    const id = assertEngine(engine)
    const trimmed = String(binaryPath || '').trim()
    if (trimmed) customBinaryPaths.set(id, trimmed)
    else customBinaryPaths.delete(id)
    savePaths()
    return { success: true, drivers: detectDrivers() }
  })

  ipcMain.handle('cli-drivers:run', async (_e, opts = {}) => {
    try {
      return startCliRun(opts, getWindow)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('cli-drivers:stop', async (_e, runId) => stopCliRun(runId))

  ipcMain.handle('cli-drivers:list', async () => ({
    success: true,
    runs: Array.from(activeRuns.entries()).map(([runId, r]) => ({
      runId,
      engine: r.engine,
      botId: r.botId,
      startedAt: r.startedAt,
    })),
  }))
}

module.exports = {
  registerCliDriversIpc,
  killAllCliDrivers,
  detectDrivers,
}

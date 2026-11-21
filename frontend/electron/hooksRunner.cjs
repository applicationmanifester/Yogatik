// Yogatik Hooks Runner
// Executes .yogatik/hooks.json commands only for user-trusted roots.

const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')
const hooksCore = require('./hooksCore.cjs')

let trustedRoots = new Set()
exports.isTrustedRoot = function(rootPath) { return trustedRoots.has(rootPath) }
exports.trustRoot = function(rootPath) { trustedRoots.add(rootPath) }
exports.untrustRoot = function(rootPath) { trustedRoots.delete(rootPath) }
exports.listTrustedRoots = function() { return Array.from(trustedRoots) }

function runCommand(command, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var child = exec(command, { timeout: timeoutMs }, function(error, stdout, stderr) {
      if (error) {
        resolve({ ok: false, error: error.message, stdout: stdout || '', stderr: stderr || '' })
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' })
      }
    })
    child.on('timeout', function() {
      child.kill()
      resolve({ ok: false, error: 'Command timed out after ' + timeoutMs + 'ms', stdout: '', stderr: '' })
    })
  })
}
exports.registerHooksIPC = function(ipcMain, getRootStateFn) {
  ipcMain.handle('hooks:parse', async function(_e, p) {
    var rootPath = p && p.rootPath ? p.rootPath : ''
    var hooksFile = path.join(rootPath, '.yogatik', 'hooks.json')
    var text = ''
    try { text = fs.readFileSync(hooksFile, 'utf8') } catch (e) { return { ok: true, hooks: [] } }
    try { var hooks = hooksCore.parseHooksFile(text); return { ok: true, hooks: hooks } } catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('hooks:match', async function(_e, p) {
    var rootPath = p && p.rootPath ? p.rootPath : ''
    var event = p && p.event ? p.event : ''
    var toolName = p && p.toolName ? p.toolName : ''
    if (!hooksCore.hooksEnabledFor({ trustedHookRoots: Array.from(trustedRoots) }, rootPath)) {
      return { ok: true, hooks: [], reason: 'Root not trusted' }
    }
    var hooksFile = path.join(rootPath, '.yogatik', 'hooks.json')
    var text = ''
    try { text = fs.readFileSync(hooksFile, 'utf8') } catch (e) { return { ok: true, hooks: [] } }
    var hooks = hooksCore.parseHooksFile(text)
    var matched = hooksCore.matchHooks(hooks, event, toolName)
    return { ok: true, hooks: matched }
  })
  ipcMain.handle('hooks:run', async function(_e, p) {
    var rootPath = p && p.rootPath ? p.rootPath : ''
    var event = p && p.event ? p.event : ''
    var toolName = p && p.toolName ? p.toolName : ''
    if (!hooksCore.hooksEnabledFor({ trustedHookRoots: Array.from(trustedRoots) }, rootPath)) {
      return { ok: false, error: 'Root not trusted for hooks' }
    }
    var hooksFile = path.join(rootPath, '.yogatik', 'hooks.json')
    var text = ''
    try { text = fs.readFileSync(hooksFile, 'utf8') } catch (e) { return { ok: false, error: 'No hooks file found' } }
    var hooks = hooksCore.parseHooksFile(text)
    var matched = hooksCore.matchHooks(hooks, event, toolName)
    var results = []
    for (var i = 0; i < matched.length; i++) {
      var h = matched[i]
      var res = await runCommand(h.command, h.timeout || 30000)
      results.push({ command: h.command, event: h.event, result: res })
    }
    return { ok: true, results: results }
  })
  ipcMain.handle('hooks:trust', async function(_e, p) {
    var rootPath = p && p.rootPath ? p.rootPath : ''
    var trust = p && p.trust !== undefined ? p.trust : true
    if (trust) exports.trustRoot(rootPath)
    else exports.untrustRoot(rootPath)
    return { ok: true, trustedRoots: Array.from(trustedRoots) }
  })
  ipcMain.handle('hooks:list', async function() {
    return { ok: true, trustedRoots: Array.from(trustedRoots) }
  })
}
/**
 * Local HTTP + SSE Harness Server (inspired by OpenMausBot's 127.0.0.1:8799 harness).
 * Owns canonical runtime event broadcasting, NDJSON per-thread transcripts,
 * and mobile/remote pairing over HTTP + SSE.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { ipcMain, app } = require('electron')
const {
  generatePairingToken,
  generatePairingCode,
  verifyToken,
  createPairingUrl,
  formatSseEvent,
  serializeNdjsonEntry,
  parseNdjsonTranscript,
} = require('./harnessServerCore.cjs')

let server = null
let activePort = 8799
let activeHost = '127.0.0.1'
let pairingToken = generatePairingToken()
let pairingCode = generatePairingCode()
let publicBaseUrl = ''
let eventSeq = 0

const sseClients = new Set()
let cachedSnapshot = { bots: [], channels: [], pendingApprovals: [] }

function transcriptsDir() {
  const dir = path.join(app.getPath('userData'), 'harness-transcripts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeThreadFile(threadId) {
  const clean = String(threadId || 'default').replace(/[^A-Za-z0-9_-]/g, '_')
  return path.join(transcriptsDir(), `${clean}.ndjson`)
}

function appendTranscript(threadId, entry) {
  try {
    fs.appendFileSync(safeThreadFile(threadId), serializeNdjsonEntry(entry), 'utf8')
  } catch {
    // ignore disk errors
  }
}

function readThreadTranscript(threadId) {
  try {
    const file = safeThreadFile(threadId)
    if (!fs.existsSync(file)) return []
    return parseNdjsonTranscript(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function broadcastEvent(eventName, payload) {
  eventSeq += 1
  const frame = formatSseEvent(eventName, payload, eventSeq)
  for (const res of sseClients) {
    try {
      res.write(frame)
    } catch {
      sseClients.delete(res)
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8')
      if (raw.length > 1024 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function isAuthorized(req, urlObj) {
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const queryToken = urlObj.searchParams.get('token') || ''
  return verifyToken(bearer || queryToken, pairingToken)
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

function pairHtmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Yogatik Remote Companion</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    select, input, button { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; margin-top: 8px; }
    button { background: #2563eb; border-color: #2563eb; font-weight: 600; cursor: pointer; }
    pre { background: #020617; padding: 10px; border-radius: 8px; overflow: auto; max-height: 260px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Yogatik Remote Companion</h1>
    <div id="status">Connecting to harness SSE…</div>
    <select id="bot"></select>
    <input id="msg" placeholder="Message a bot..." />
    <button id="send">Send</button>
    <pre id="log"></pre>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get('token') || '';
    const log = document.getElementById('log');
    const botSel = document.getElementById('bot');
    const append = (t) => { log.textContent += t + '\\n'; log.scrollTop = log.scrollHeight; };
    Promise.all([
      fetch('/api/channels?token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({})),
      fetch('/api/bots?token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({}))
    ]).then(([chData, botData]) => {
      (chData.channels || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name + ' (channel)';
        botSel.appendChild(opt);
      });
      (botData.bots || []).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id; opt.textContent = b.name + ' (' + (b.role || 'bot') + ')';
        botSel.appendChild(opt);
      });
    }).catch(() => {});
    const es = new EventSource('/events?token=' + encodeURIComponent(token));
    es.onopen = () => { document.getElementById('status').textContent = 'Connected (SSE live)'; };
    es.onmessage = (e) => append(e.data);
    es.addEventListener('bot_event', (e) => append(e.data));
    document.getElementById('send').onclick = async () => {
      const id = botSel.value || 'agent_yogatik';
      const text = document.getElementById('msg').value.trim();
      if (!text) return;
      document.getElementById('msg').value = '';
      append('You: ' + text);
      await fetch('/api/bots/' + encodeURIComponent(id) + '/message?token=' + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
      });
    };
  </script>
</body>
</html>`
}

function startHarnessServer({ port = 8799, host = '127.0.0.1', publicUrl = '' } = {}, getWindow) {
  if (server) {
    return Promise.resolve(getHarnessStatus())
  }
  activePort = Number(port) || 8799
  activeHost = host || '127.0.0.1'
  publicBaseUrl = publicUrl || ''

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const urlObj = new URL(req.url || '/', `http://${activeHost}:${activePort}`)
        const pathname = urlObj.pathname

        if (pathname === '/health' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, port: activePort, clients: sseClients.size })
        }

        if (pathname === '/pair' && req.method === 'GET') {
          if (!isAuthorized(req, urlObj)) {
            res.writeHead(401, { 'Content-Type': 'text/plain' })
            return res.end('Invalid or missing pairing token.')
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          return res.end(pairHtmlPage())
        }

        if (!isAuthorized(req, urlObj)) {
          return sendJson(res, 401, { error: 'Unauthorized' })
        }

        if (pathname === '/events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })
          res.write(formatSseEvent('connected', { ts: Date.now() }))
          sseClients.add(res)
          req.on('close', () => sseClients.delete(res))
          return
        }

        if (pathname === '/api/bots' && req.method === 'GET') {
          return sendJson(res, 200, { bots: cachedSnapshot.bots || [] })
        }

        if (pathname === '/api/channels' && req.method === 'GET') {
          return sendJson(res, 200, { channels: cachedSnapshot.channels || [] })
        }

        const txMatch = pathname.match(/^\/api\/transcripts\/([^/]+)$/)
        if (txMatch && req.method === 'GET') {
          const threadId = decodeURIComponent(txMatch[1])
          return sendJson(res, 200, { entries: readThreadTranscript(threadId).slice(-50) })
        }

        const msgMatch = pathname.match(/^\/api\/bots\/([^/]+)\/message$/)
        if (msgMatch && req.method === 'POST') {
          const botId = decodeURIComponent(msgMatch[1])
          const body = await readJsonBody(req)
          const text = String(body.text || '').trim()
          if (!text) return sendJson(res, 400, { error: 'text is required' })
          appendTranscript(botId, { role: 'user', botId, text, source: 'harness' })
          broadcastEvent('bot_event', { type: 'inbound_message', botId, text })
          const win = typeof getWindow === 'function' ? getWindow() : null
          if (win && !win.isDestroyed()) {
            win.webContents.send('harness:inbound', { type: 'message', botId, text })
          }
          return sendJson(res, 202, { accepted: true, botId })
        }

        const appMatch = pathname.match(/^\/api\/approvals\/([^/]+)$/)
        if (appMatch && req.method === 'POST') {
          const approvalId = decodeURIComponent(appMatch[1])
          const body = await readJsonBody(req)
          const decision = body.allow ? 'allow' : 'deny'
          broadcastEvent('bot_event', { type: 'approval_decision', approvalId, decision })
          const win = typeof getWindow === 'function' ? getWindow() : null
          if (win && !win.isDestroyed()) {
            win.webContents.send('harness:inbound', { type: 'approval', approvalId, allow: !!body.allow })
          }
          return sendJson(res, 200, { ok: true, approvalId, decision })
        }

        sendJson(res, 404, { error: 'Not found' })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
    })

    srv.on('error', (err) => {
      server = null
      reject(err)
    })

    srv.listen(activePort, activeHost, () => {
      server = srv
      resolve(getHarnessStatus())
    })
  })
}

function stopHarnessServer() {
  for (const res of sseClients) {
    try { res.end() } catch { /* ignore */ }
  }
  sseClients.clear()
  if (server) {
    try { server.close() } catch { /* ignore */ }
    server = null
  }
  return getHarnessStatus()
}

function getHarnessStatus() {
  return {
    running: Boolean(server),
    host: activeHost,
    port: activePort,
    clients: sseClients.size,
    pairingCode,
    pairingUrl: createPairingUrl({
      host: activeHost,
      port: activePort,
      token: pairingToken,
      publicUrl: publicBaseUrl,
    }),
  }
}

function registerHarnessIpc(getWindow) {
  ipcMain.handle('harness:start', async (_e, opts = {}) => {
    try {
      return { success: true, ...(await startHarnessServer(opts, getWindow)) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('harness:stop', async () => ({
    success: true,
    ...stopHarnessServer(),
  }))

  ipcMain.handle('harness:status', async () => ({
    success: true,
    ...getHarnessStatus(),
  }))

  ipcMain.handle('harness:rotate-pairing', async (_e, { publicUrl } = {}) => {
    pairingToken = generatePairingToken()
    pairingCode = generatePairingCode()
    if (publicUrl !== undefined) publicBaseUrl = String(publicUrl || '')
    return { success: true, ...getHarnessStatus() }
  })

  ipcMain.handle('harness:publish', async (_e, { event = 'bot_event', payload = {}, threadId } = {}) => {
    if (threadId) appendTranscript(threadId, payload)
    broadcastEvent(event, payload)
    return { success: true }
  })

  ipcMain.handle('harness:sync-snapshot', async (_e, snapshot = {}) => {
    cachedSnapshot = {
      bots: Array.isArray(snapshot.bots) ? snapshot.bots : cachedSnapshot.bots,
      channels: Array.isArray(snapshot.channels) ? snapshot.channels : cachedSnapshot.channels,
      pendingApprovals: Array.isArray(snapshot.pendingApprovals) ? snapshot.pendingApprovals : cachedSnapshot.pendingApprovals,
    }
    return { success: true }
  })

  ipcMain.handle('harness:read-transcript', async (_e, threadId) => ({
    success: true,
    entries: readThreadTranscript(threadId),
  }))
}

module.exports = {
  registerHarnessIpc,
  stopHarnessServer,
}

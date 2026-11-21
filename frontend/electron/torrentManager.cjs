// Background BitTorrent Engine for Yogatik Desktop
// Uses WebTorrent to manage P2P swarms, DHT, trackers, and disk piece storage.
// Runs purely inside Electron Node.js main process with Turbo P2P optimizations.

const { ipcMain, app, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { safeSend } = require('./safeWindow.cjs')

let client = null
let WebTorrentClass = null
let statusTimer = null
let broadcastTick = 0

// Map of infoHash -> { torrent, paused, autoStoppedOnDone, userManuallyResumed, customPath, addedAt, error }
const activeTorrents = new Map()

// High-speed public Tier-1 trackers to maximize swarm peer discovery across firewalls
const HIGH_SPEED_PUBLIC_TRACKERS = [
  // Tier-1 Ultra-Reliable UDP Trackers (Opentrackr, OpenBitTorrent, Stealth, Torrent.eu.org, etc.)
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://tracker.altrosky.nl:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker.skyts.net:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  // HTTP / HTTPS Trackers
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'https://tracker.tamersunion.org:443/announce',
  'http://torrent.ubuntu.com:6969/announce',
  // WebSocket / WebRTC Trackers (Crucial for hybrid web/desktop peer discovery)
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce'
]

async function getWebTorrentClient() {
  if (client) return client
  if (!WebTorrentClass) {
    const mod = await import('webtorrent')
    WebTorrentClass = mod.default || mod
  }
  client = new WebTorrentClass({
    // Standard TCP BitTorrent & UDP Trackers + DHT enabled
    dht: true,
    tracker: true,
    lsd: true,
    utp: true,                   // Micro Transport Protocol (UDP-based peer connection for low latency)
    utPex: true,                 // Peer Exchange for fast peer gossiping without waiting for tracker
    natUpnp: true,               // Automatic UPnP router port forwarding
    natPmp: true,                // NAT-PMP router port mapping
    maxConns: 300,               // Saturated 300 global connections (default was 55)
    downloadLimit: -1,           // Unlimited blazing download throughput
    uploadLimit: -1,             // Reciprocal upload for tit-for-tat peer unchoking
    seedOutgoingConnections: true
  })

  client.on('error', (err) => {
    console.error('[Yogatik BitTorrent] Client error:', err?.message || err)
  })

  return client
}

function stopTorrentSeeding(record) {
  if (!record || !record.torrent) return
  record.paused = true
  record.autoStoppedOnDone = true
  try {
    record.torrent.pause()
  } catch (err) {
    console.error('[Yogatik BitTorrent] Error pausing torrent:', err?.message || err)
  }
  // Disconnect all upload/download peer connections so network traffic ceases immediately
  if (Array.isArray(record.torrent.wires)) {
    for (const wire of [...record.torrent.wires]) {
      try {
        wire.destroy()
      } catch {}
    }
  }
}

/**
 * Configure low-level wire socket and event optimizations for maximum throughput
 */
function setupTorrentOptimizations(torrent, record) {
  if (!torrent || torrent._yogatikOptimized) return
  torrent._yogatikOptimized = true

  // Fast socket tuning when peers connect
  torrent.on('wire', (wire) => {
    try {
      // 1. Disable TCP delay (Nagle's algorithm) so piece request/cancel packets aren't queued
      const sock = wire._conn || wire.conn
      if (sock) {
        if (typeof sock.setNoDelay === 'function') sock.setNoDelay(true)
        if (typeof sock.setKeepAlive === 'function') sock.setKeepAlive(true, 10000)
      }
    } catch {}

    // 2. Immediately mark interest to start block pipeline
    try {
      if (typeof wire.interested === 'function' && !wire.amInterested) {
        wire.interested()
      }
    } catch {}

    // Record wire activity timestamp for stalled peer recycling
    wire._lastActiveTime = Date.now()
    wire.on('download', () => {
      wire._lastActiveTime = Date.now()
    })
  })

  // Catch any piece read/write or socket errors on this torrent
  torrent.on('error', (err) => {
    console.error('[Yogatik BitTorrent] Torrent error:', err?.message || err)
    record.error = err?.message || String(err)
  })

  // Auto-stop downloading and uploading peers once download is complete
  torrent.on('done', () => {
    console.log(`[Yogatik BitTorrent] Torrent ${torrent.name || torrent.infoHash} reached 100%. Auto-stopping seeding & disconnecting peers.`)
    stopTorrentSeeding(record)
  })

  if (torrent.done || (torrent.progress != null && torrent.progress >= 1)) {
    stopTorrentSeeding(record)
  }
}

/**
 * Actively boosts swarm connections: re-announces to Tier-1 trackers, triggers DHT lookups,
 * and purges dead choked connections so waiting peers can connect immediately.
 */
function boostSwarm(record) {
  if (!record || !record.torrent || record.paused) {
    return { success: false, error: 'Torrent is paused or inactive' }
  }
  const t = record.torrent
  let trackerCount = 0
  let dhtTriggered = false
  let recycledPeers = 0

  // 1. Force instant tracker re-announcements across all trackers
  try {
    if (t.discovery && t.discovery.tracker) {
      if (typeof t.discovery.tracker.update === 'function') {
        t.discovery.tracker.update()
        trackerCount = Array.isArray(t.discovery._announce) ? t.discovery._announce.length : 1
      } else if (typeof t.discovery.tracker._announce === 'function') {
        t.discovery.tracker._announce()
      }
    }
  } catch (err) {
    console.warn('[Yogatik BitTorrent] Tracker update warning:', err?.message)
  }

  // 2. Force DHT re-announce and peer lookup
  try {
    if (t.discovery) {
      if (typeof t.discovery._dhtAnnounce === 'function') {
        t.discovery._dhtAnnounce()
        dhtTriggered = true
      }
      if (t.discovery.dht && typeof t.discovery.dht.lookup === 'function') {
        t.discovery.dht.lookup(t.infoHash)
        dhtTriggered = true
      }
    }
  } catch (err) {
    console.warn('[Yogatik BitTorrent] DHT boost warning:', err?.message)
  }

  // 3. Stalled / choked peer recycling: disconnect dead wires to allow queued peers to connect
  try {
    if (Array.isArray(t.wires) && t._queue && t._queue.length > 0) {
      const now = Date.now()
      for (const wire of [...t.wires]) {
        // If wire has been choking us and hasn't downloaded anything for > 35s
        const isStalled = wire.peerChoking && (wire.downloadSpeed ? wire.downloadSpeed() === 0 : true)
        const idleDuration = now - (wire._lastActiveTime || now)
        if (isStalled && idleDuration > 35000) {
          try {
            wire.destroy()
            recycledPeers++
          } catch {}
        }
      }
    }
    // Trigger drain to immediately connect to next waiting peers
    if (typeof t._drain === 'function') {
      t._drain()
    }
  } catch (err) {
    console.warn('[Yogatik BitTorrent] Peer recycle warning:', err?.message)
  }

  return {
    success: true,
    numPeers: t.numPeers || 0,
    trackerCount,
    dhtTriggered,
    recycledPeers
  }
}

function formatTorrentData(t, isPaused = false, error = null) {
  if (!t) return null
  const isDone = Boolean(t.done || (t.progress != null && t.progress >= 1))
  return {
    name: t.name || 'Retrieving metadata...',
    infoHash: t.infoHash,
    magnetURI: t.magnetURI,
    progress: Math.min(1, Math.max(0, t.progress || 0)),
    downloaded: t.downloaded || 0,
    uploaded: t.uploaded || 0,
    downloadSpeed: isPaused ? 0 : (t.downloadSpeed || 0),
    uploadSpeed: isPaused ? 0 : (t.uploadSpeed || 0),
    numPeers: isPaused ? 0 : (t.numPeers || 0),
    length: t.length || 0,
    timeRemaining: isDone ? 0 : (isPaused ? Infinity : (t.timeRemaining || 0)),
    done: isDone,
    paused: Boolean(isPaused),
    path: t.path || '',
    error: error || null,
    strategy: t.strategy || 'rarest',
    wiresCount: Array.isArray(t.wires) ? t.wires.length : 0,
    maxConns: t.client?.maxConns || 300,
    files: (t.files || []).map(f => ({
      name: f.name,
      path: f.path,
      length: f.length,
      downloaded: f.downloaded,
      progress: f.progress
    }))
  }
}

function startBroadcasting(getWindow) {
  if (statusTimer) return
  statusTimer = setInterval(() => {
    if (!activeTorrents.size) return
    const win = getWindow?.()
    if (!win || win.isDestroyed()) return

    broadcastTick++

    // Swarm auto-maintenance every 12 seconds: auto-boost low peer or stalled downloads
    if (broadcastTick % 12 === 0) {
      for (const [, record] of activeTorrents.entries()) {
        if (record.torrent && !record.paused && !record.torrent.done) {
          const peers = record.torrent.numPeers || 0
          const speed = record.torrent.downloadSpeed || 0
          if (peers < 30 || speed < 128 * 1024) {
            boostSwarm(record)
          }
        }
      }
    }

    const list = []
    for (const [, record] of activeTorrents.entries()) {
      if (record.torrent) {
        // Auto-stop completed torrents from uploading to peers
        const isDone = Boolean(record.torrent.done || (record.torrent.progress != null && record.torrent.progress >= 1))
        if (isDone && !record.autoStoppedOnDone && !record.userManuallyResumed && !record.paused) {
          stopTorrentSeeding(record)
        }
        list.push(formatTorrentData(record.torrent, record.paused, record.error))
      }
    }
    safeSend(win, 'torrent:update', list)
  }, 1000)
}

function registerTorrentIpc(getWindow) {
  ipcMain.handle('torrent:getDefaultPath', () => {
    try {
      return app.getPath('downloads')
    } catch {
      return path.join(app.getPath('home'), 'Downloads')
    }
  })

  ipcMain.handle('torrent:add', async (_e, { uri, downloadPath, strategy = 'rarest' } = {}) => {
    if (!uri || typeof uri !== 'string') {
      return { success: false, error: 'A valid Magnet URI or .torrent file path is required.' }
    }

    const trimmed = uri.trim()
    const targetDir = downloadPath && typeof downloadPath === 'string' && downloadPath.trim()
      ? path.resolve(downloadPath.trim())
      : app.getPath('downloads')

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
    } catch (err) {
      return { success: false, error: `Failed to access target folder: ${err.message}` }
    }

    try {
      const torrentClient = await getWebTorrentClient()

      return new Promise((resolve) => {
        let settled = false

        // Turbo high-speed BitTorrent download parameters
        const addOpts = {
          path: targetDir,
          announce: HIGH_SPEED_PUBLIC_TRACKERS,
          strategy: strategy === 'sequential' ? 'sequential' : 'rarest', // Rarest-first piece selection for maximal concurrent peer saturation
          storeCacheSlots: 512,       // 512-slot chunk RAM cache to eliminate synchronous disk I/O bottlenecks
          maxWebConns: 24,            // High web-seed mirror concurrency
          uploads: 25,                // Reciprocal upload slots to trigger tit-for-tat seeder reciprocation
          alwaysChokeSeeders: true,   // Conserve upload slots for peers that trade data
        }

        torrentClient.add(trimmed, addOpts, (torrent) => {
          const record = {
            torrent,
            paused: false,
            autoStoppedOnDone: false,
            userManuallyResumed: false,
            customPath: targetDir,
            addedAt: Date.now(),
            error: null
          }
          activeTorrents.set(torrent.infoHash, record)
          setupTorrentOptimizations(torrent, record)

          startBroadcasting(getWindow)

          if (!settled) {
            settled = true
            resolve({
              success: true,
              infoHash: torrent.infoHash,
              torrent: formatTorrentData(torrent, record.paused, record.error)
            })
          }
        })

        torrentClient.on('error', (err) => {
          if (!settled) {
            settled = true
            resolve({ success: false, error: err.message || 'BitTorrent client error' })
          }
        })

        // Timeout fallback if metadata resolution takes a few seconds
        setTimeout(() => {
          if (!settled) {
            settled = true
            const found = torrentClient.torrents.find(t =>
              trimmed.includes(t.infoHash) || (t.magnetURI && t.magnetURI === trimmed)
            )
            if (found) {
              const record = {
                torrent: found,
                paused: false,
                autoStoppedOnDone: false,
                userManuallyResumed: false,
                customPath: targetDir,
                addedAt: Date.now(),
                error: null
              }
              activeTorrents.set(found.infoHash, record)
              setupTorrentOptimizations(found, record)

              startBroadcasting(getWindow)
              resolve({
                success: true,
                infoHash: found.infoHash,
                torrent: formatTorrentData(found, record.paused, record.error),
                note: 'Torrent added; connecting to high-speed swarm in background.'
              })
            } else {
              resolve({
                success: true,
                note: 'Torrent queued in background; connecting to swarm trackers.'
              })
            }
          }
        }, 3500)
      })
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('torrent:list', async () => {
    const list = []
    for (const [, record] of activeTorrents.entries()) {
      if (record.torrent) {
        list.push(formatTorrentData(record.torrent, record.paused, record.error))
      }
    }
    return { success: true, torrents: list }
  })

  ipcMain.handle('torrent:pause', async (_e, { infoHash } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    if (!record || !record.torrent) return { success: false, error: 'Torrent not found' }

    try {
      stopTorrentSeeding(record)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('torrent:resume', async (_e, { infoHash } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    if (!record || !record.torrent) return { success: false, error: 'Torrent not found' }

    try {
      record.userManuallyResumed = true
      record.paused = false
      record.torrent.resume()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('torrent:boost', async (_e, { infoHash } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    if (!record || !record.torrent) return { success: false, error: 'Torrent not found' }
    return boostSwarm(record)
  })

  ipcMain.handle('torrent:setStrategy', async (_e, { infoHash, strategy } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    if (!record || !record.torrent) return { success: false, error: 'Torrent not found' }
    const validStrategy = strategy === 'sequential' ? 'sequential' : 'rarest'
    record.torrent.strategy = validStrategy
    return { success: true, strategy: validStrategy }
  })

  ipcMain.handle('torrent:remove', async (_e, { infoHash, deleteFiles = false } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    if (!record || !record.torrent) return { success: false, error: 'Torrent not found' }

    try {
      const torrentPath = record.torrent.path
      const torrentName = record.torrent.name

      record.torrent.destroy({ destroyStore: Boolean(deleteFiles) }, () => {
        activeTorrents.delete(infoHash)
      })

      if (deleteFiles && torrentPath && torrentName) {
        const fullPath = path.join(torrentPath, torrentName)
        try {
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true })
          }
        } catch {
          // ignore
        }
      }

      activeTorrents.delete(infoHash)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('torrent:openFolder', async (_e, { infoHash } = {}) => {
    if (!infoHash) return { success: false, error: 'infoHash is required' }
    const record = activeTorrents.get(infoHash)
    const targetPath = record?.torrent?.path || record?.customPath || app.getPath('downloads')

    try {
      if (fs.existsSync(targetPath)) {
        shell.openPath(targetPath)
        return { success: true }
      }
      return { success: false, error: 'Directory does not exist' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

function destroyTorrentManager() {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
  if (client) {
    try {
      client.destroy()
    } catch {
      // ignore
    }
    client = null
  }
  activeTorrents.clear()
}

module.exports = {
  registerTorrentIpc,
  destroyTorrentManager
}

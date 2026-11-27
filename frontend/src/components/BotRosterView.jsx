import React from 'react'
import {
  Hash, Bot, Send, Monitor, Smartphone, Cpu, Download, Upload,
  Plus, RefreshCw, Play, Square, ExternalLink, Terminal
} from 'lucide-react'
import { getAgents, upsertAgent } from '../agents'
import { streamMessage } from '../api'
import { getSetting, setSetting } from '../db'
import { getChannels, saveChannel, routeMessageToBot, generateBotAvatarSvg } from '../botChannels'
import { exportTeamMarkdown, parseTeamMarkdown, importTeamIntoYogatik } from '../teamPlaybook'

const THREADS_KEY = 'bot_roster_threads'

/**
 * OpenMausBot-style Bot Contacts, #Channels, Local CLI Engines,
 * HTTP+SSE Phone Pairing, Team Markdown Playbooks, and Per-Bot Computer Preview.
 */
export function BotRosterView({ onToast }) {
  const [bots, setBots] = React.useState([])
  const [channels, setChannels] = React.useState([])
  const [selection, setSelection] = React.useState({ type: 'channel', id: 'ch_work' })
  const [messagesByTarget, setMessagesByTarget] = React.useState({})
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [activeCliRunId, setActiveCliRunId] = React.useState(null)

  // Right-side drawer: 'computer' | 'engines' | 'pairing' | null
  const [drawer, setDrawer] = React.useState('computer')

  // Local CLI drivers
  const [drivers, setDrivers] = React.useState([])
  const [botEngineOverrides, setBotEngineOverrides] = React.useState({}) // botId -> 'builtin' | 'claude' | 'codex' | 'grok'
  const [customPaths, setCustomPaths] = React.useState({})

  // Harness server & phone pairing
  const [harness, setHarness] = React.useState({ running: false, port: 8799, clients: 0, pairingCode: '', pairingUrl: '' })

  // Computer / browser preview
  const [previewUrl, setPreviewUrl] = React.useState('https://example.com')
  const [previewShot, setPreviewShot] = React.useState(null)

  // New channel inline creator
  const [newChanName, setNewChanName] = React.useState('')
  const playbookInputRef = React.useRef(null)
  const messagesRef = React.useRef(messagesByTarget)
  messagesRef.current = messagesByTarget

  const updateThreads = React.useCallback((updater) => {
    setMessagesByTarget(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      setSetting(THREADS_KEY, next).catch(() => {})
      return next
    })
  }, [])

  const reload = React.useCallback(async () => {
    const [b, c] = await Promise.all([getAgents(), getChannels()])
    setBots(b)
    setChannels(c)
    if (window.__YOGATIK_HARNESS__?.syncSnapshot) {
      window.__YOGATIK_HARNESS__.syncSnapshot({
        bots: b.map(x => ({ id: x.id, name: x.name, role: x.role })),
        channels: c.map(x => ({ id: x.id, name: x.name, routingMode: x.routingMode })),
      }).catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    reload()
    getSetting(THREADS_KEY, {}).then(saved => {
      if (saved && typeof saved === 'object') setMessagesByTarget(saved)
    }).catch(() => {})
    if (window.__YOGATIK_CLI_DRIVERS__?.detect) {
      window.__YOGATIK_CLI_DRIVERS__.detect().then(r => {
        if (r?.success) setDrivers(r.drivers || [])
      }).catch(() => {})
    }
    if (window.__YOGATIK_HARNESS__?.status) {
      window.__YOGATIK_HARNESS__.status().then(r => {
        if (r?.success) setHarness(r)
      }).catch(() => {})
    }
  }, [reload])

  const sendToBot = React.useCallback(async (targetKey, bot, promptText, sharedInstructions = '') => {
    const engine = botEngineOverrides[bot.id] || (bot.provider?.startsWith('cli:') ? bot.provider.slice(4) : 'builtin')
    const systemPrompt = [bot.system, sharedInstructions].filter(Boolean).join('\n\n')

    if (engine !== 'builtin' && window.__YOGATIK_CLI_DRIVERS__?.run) {
      const res = await window.__YOGATIK_CLI_DRIVERS__.run({
        engine,
        botId: targetKey,
        prompt: `${systemPrompt ? `[Instructions: ${systemPrompt}]\n\n` : ''}${promptText}`,
        model: bot.model || undefined,
      })
      if (res?.success) {
        setActiveCliRunId(res.runId)
      } else {
        updateThreads(prev => ({
          ...prev,
          [targetKey]: [...(prev[targetKey] || []), { id: `err_${Date.now()}`, role: 'system', text: res?.error || `Failed to run ${engine} CLI` }],
        }))
        setSending(false)
      }
      return 'cli'
    }

    // Build recent thread history for memory
    const prior = (messagesRef.current[targetKey] || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map(m => ({ role: m.role, content: m.text }))

    let reply = ''
    const msgId = `ai_${Date.now()}_${bot.id}`
    updateThreads(prev => ({
      ...prev,
      [targetKey]: [...(prev[targetKey] || []), { id: msgId, role: 'assistant', author: bot.name, text: '…' }],
    }))

    await new Promise((resolve) => {
      streamMessage(
        {
          message: promptText,
          messages: prior,
          system_prompt: systemPrompt,
          model: bot.model || undefined,
          provider: bot.provider && !bot.provider.startsWith('cli:') ? bot.provider : undefined,
          use_tools: false,
          use_web_search: false,
          channel: 'roster',
        },
        (tok) => {
          reply += tok
          updateThreads(prev => ({
            ...prev,
            [targetKey]: (prev[targetKey] || []).map(m => (m.id === msgId ? { ...m, text: reply } : m)),
          }))
        },
        null,
        () => resolve(),
        (err) => {
          updateThreads(prev => ({
            ...prev,
            [targetKey]: (prev[targetKey] || []).map(m => (m.id === msgId ? { ...m, text: `Error: ${err?.message || err}` } : m)),
          }))
          resolve()
        }
      )
    })

    if (window.__YOGATIK_HARNESS__?.publish) {
      window.__YOGATIK_HARNESS__.publish({
        event: 'bot_event',
        threadId: targetKey,
        payload: { role: 'assistant', botId: bot.id, author: bot.name, text: reply },
      }).catch(() => {})
    }
    return 'builtin'
  }, [botEngineOverrides, updateThreads])

  // Subscribe to CLI driver stream events
  React.useEffect(() => {
    const bridge = window.__YOGATIK_CLI_DRIVERS__
    if (!bridge?.onEvent) return undefined
    return bridge.onEvent((payload) => {
      const targetId = payload.botId || 'ch_work'
      const ev = payload.event || {}
      if (ev.type === 'text' && ev.text) {
        updateThreads(prev => {
          const list = prev[targetId] || []
          const last = list[list.length - 1]
          if (last && last.runId === payload.runId && last.role === 'assistant') {
            return { ...prev, [targetId]: [...list.slice(0, -1), { ...last, text: last.text + ev.text }] }
          }
          return {
            ...prev,
            [targetId]: [...list, { id: `m_${Date.now()}`, role: 'assistant', author: payload.engine, text: ev.text, runId: payload.runId }],
          }
        })
      } else if (ev.type === 'permission_request') {
        updateThreads(prev => ({
          ...prev,
          [targetId]: [...(prev[targetId] || []), {
            id: `perm_${ev.id || Date.now()}`,
            role: 'approval',
            approvalId: ev.id,
            tool: ev.tool,
            text: ev.description || `Approve ${ev.tool}?`,
            status: 'pending',
          }],
        }))
      } else if (ev.type === 'error') {
        onToast?.(ev.message || 'CLI driver error')
        setActiveCliRunId(null)
        setSending(false)
      } else if (ev.type === 'done') {
        setActiveCliRunId(null)
        setSending(false)
      }
    })
  }, [onToast, updateThreads])

  // Subscribe to remote phone/harness inbound messages and dispatch to channel or bot
  React.useEffect(() => {
    const h = window.__YOGATIK_HARNESS__
    if (!h?.onInbound) return undefined
    return h.onInbound((msg) => {
      if (msg?.type === 'message' && msg.botId && msg.text) {
        updateThreads(prev => ({
          ...prev,
          [msg.botId]: [...(prev[msg.botId] || []), { id: `rem_${Date.now()}`, role: 'user', author: 'Phone', text: msg.text }],
        }))
        const ch = channels.find(c => c.id === msg.botId)
        if (ch) {
          const routed = routeMessageToBot(msg.text, ch, bots)
          const target = bots.find(b => b.id === routed.botIds[0]) || bots[0]
          if (target) sendToBot(msg.botId, target, msg.text, ch.sharedInstructions).catch(() => {})
        } else {
          const bot = bots.find(b => b.id === msg.botId) || bots[0]
          if (bot) sendToBot(msg.botId, bot, msg.text).catch(() => {})
        }
      }
    })
  }, [bots, channels, sendToBot, updateThreads])

  const activeChannel = selection.type === 'channel' ? channels.find(c => c.id === selection.id) : null
  const activeBot = selection.type === 'bot' ? bots.find(b => b.id === selection.id) : null
  const threadKey = selection.id
  const threadMessages = messagesByTarget[threadKey] || []

  const appendMsg = (key, msg) => {
    updateThreads(prev => ({ ...prev, [key]: [...(prev[key] || []), msg] }))
  }

  const handleSend = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setSending(true)

    appendMsg(threadKey, { id: `u_${Date.now()}`, role: 'user', author: 'You', text })

    let dispatchedCli = false
    try {
      if (activeChannel) {
        const routed = routeMessageToBot(text, activeChannel, bots)
        const targets = routed.botIds.map(id => bots.find(b => b.id === id)).filter(Boolean)
        if (!targets.length) {
          appendMsg(threadKey, { id: `sys_${Date.now()}`, role: 'system', text: 'No bots assigned to this channel.' })
        } else {
          appendMsg(threadKey, {
            id: `rt_${Date.now()}`,
            role: 'system',
            text: `Routed to ${targets.map(t => t.name).join(', ')} (${routed.reason})`,
          })
          for (const b of targets) {
            const mode = await sendToBot(threadKey, b, text, activeChannel.sharedInstructions)
            if (mode === 'cli') dispatchedCli = true
          }
        }
      } else if (activeBot) {
        const mode = await sendToBot(threadKey, activeBot, text)
        if (mode === 'cli') dispatchedCli = true
      }
    } finally {
      if (!dispatchedCli) setSending(false)
    }
  }

  const handleStopCli = async () => {
    if (!activeCliRunId || !window.__YOGATIK_CLI_DRIVERS__?.stop) return
    await window.__YOGATIK_CLI_DRIVERS__.stop(activeCliRunId)
    setActiveCliRunId(null)
    setSending(false)
  }

  const handleCreateChannel = async (e) => {
    e.preventDefault()
    if (!newChanName.trim()) return
    const created = await saveChannel({
      name: newChanName.trim(),
      botIds: bots.slice(0, 3).map(b => b.id),
      leadBotId: bots[0]?.id,
      routingMode: 'auto',
    })
    setNewChanName('')
    await reload()
    setSelection({ type: 'channel', id: created.id })
    onToast?.(`Channel ${created.name} created`)
  }

  const handleRoutingModeChange = async (mode) => {
    if (!activeChannel) return
    await saveChannel({ ...activeChannel, routingMode: mode })
    await reload()
    onToast?.(`${activeChannel.name} routing set to ${mode}`)
  }

  const handleExportTeam = () => {
    const md = exportTeamMarkdown({
      name: 'Yogatik Team',
      description: 'Exported Yogatik bot roster & channels',
      chiefOfStaff: bots[0]?.name || 'Yogatik AI',
      bots: bots.slice(0, 12),
      channels,
    })
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'yogatik-team.md'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    onToast?.('Exported yogatik-team.md')
  }

  const handleImportTeam = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed = parseTeamMarkdown(await file.text())
      const summary = await importTeamIntoYogatik(parsed, { upsertAgent, saveChannel })
      await reload()
      onToast?.(`Imported "${summary.name}": ${summary.botsCount} bots, ${summary.channelsCount} channels`)
    } catch (err) {
      onToast?.(`Playbook import failed: ${err.message}`)
    }
    e.target.value = ''
  }

  const toggleHarness = async () => {
    const h = window.__YOGATIK_HARNESS__
    if (!h) return onToast?.('Harness server is available in the Electron desktop app.')
    const res = harness.running ? await h.stop() : await h.start({ port: 8799 })
    if (res?.success) setHarness(res)
    else onToast?.(res?.error || 'Harness toggle failed')
  }

  const rotatePairing = async () => {
    const h = window.__YOGATIK_HARNESS__
    if (!h?.rotatePairing) return
    const res = await h.rotatePairing()
    if (res?.success) {
      setHarness(res)
      onToast?.('Pairing token rotated')
    }
  }

  const refreshComputerPreview = async () => {
    const b = window.__YOGATIK_BROWSER__
    if (!b?.navigate || !b?.screenshot) {
      return onToast?.('Live computer/browser preview requires the Electron desktop app.')
    }
    try {
      await b.navigate({ url: previewUrl, sessionId: threadKey })
      const shot = await b.screenshot({ sessionId: threadKey })
      const img = shot?.dataUrl || shot?.screenshot || (shot?.base64 ? `data:image/png;base64,${shot.base64}` : null)
      if (img) setPreviewShot(img)
      else onToast?.('Navigated sandboxed browser session')
    } catch (err) {
      onToast?.(err.message)
    }
  }

  const openComputerWindow = async () => {
    const b = window.__YOGATIK_BROWSER__
    if (!b?.setDetached) return onToast?.('Desktop takeover requires the Electron desktop app.')
    await b.setDetached({ sessionId: threadKey, detached: true })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: drawer ? '220px 1fr 270px' : '220px 1fr', gap: 12, minHeight: 460 }}>
      {/* Left Sidebar: #Channels + Bot Contacts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderRight: '1px solid var(--border-color, rgba(255,255,255,0.08))', paddingRight: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', opacity: 0.7 }}>Channels</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => setSelection({ type: 'channel', id: ch.id })}
              className="small-btn"
              style={{
                justifyContent: 'flex-start',
                background: selection.type === 'channel' && selection.id === ch.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              }}
            >
              <Hash size={12} /> {ch.name.replace(/^#/, '')}
            </button>
          ))}
        </div>
        <form onSubmit={handleCreateChannel} style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="#new-channel"
            value={newChanName}
            onChange={e => setNewChanName(e.target.value)}
            style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
          />
          <button type="submit" className="small-btn" disabled={!newChanName.trim()}><Plus size={11} /></button>
        </form>

        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', opacity: 0.7, marginTop: 6 }}>
          Bot Contacts ({bots.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: 260 }}>
          {bots.slice(0, 20).map(b => (
            <button
              key={b.id}
              onClick={() => setSelection({ type: 'bot', id: b.id })}
              className="small-btn"
              style={{
                justifyContent: 'flex-start',
                gap: 7,
                background: selection.type === 'bot' && selection.id === b.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              }}
            >
              <img src={generateBotAvatarSvg(b.name, b.role)} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Center: Chat & Toolbar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeChannel ? <Hash size={15} /> : <Bot size={15} />}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{activeChannel ? activeChannel.name : (activeBot?.name || 'Select a bot')}</div>
              <div style={{ fontSize: 11, opacity: 0.65, display: 'flex', alignItems: 'center', gap: 6 }}>
                {activeChannel ? (
                  <>
                    <span>{activeChannel.botIds?.length || 0} bots · Routing:</span>
                    <select
                      value={activeChannel.routingMode || 'auto'}
                      onChange={e => handleRoutingModeChange(e.target.value)}
                      style={{ fontSize: 10.5, padding: '1px 4px', background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }}
                    >
                      <option value="auto">Auto</option>
                      <option value="lead">Lead</option>
                      <option value="broadcast">Broadcast</option>
                    </select>
                  </>
                ) : (activeBot?.role || '')}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className="small-btn" onClick={handleExportTeam} title="Export Team Playbook (.md)"><Download size={12} /> Export .md</button>
            <button className="small-btn" onClick={() => playbookInputRef.current?.click()} title="Import Team Playbook (.md)"><Upload size={12} /> Import .md</button>
            <input ref={playbookInputRef} type="file" accept=".md,.markdown,text/markdown" hidden onChange={handleImportTeam} />
            <button
              className="small-btn"
              onClick={() => updateThreads(prev => ({ ...prev, [threadKey]: [] }))}
              title="Clear this thread"
              disabled={threadMessages.length === 0}
            >
              Clear
            </button>
            <button className={`small-btn ${drawer === 'computer' ? 'active' : ''}`} onClick={() => setDrawer(d => d === 'computer' ? null : 'computer')}><Monitor size={12} /> Computer</button>
            <button className={`small-btn ${drawer === 'engines' ? 'active' : ''}`} onClick={() => setDrawer(d => d === 'engines' ? null : 'engines')}><Terminal size={12} /> CLIs</button>
            <button className={`small-btn ${drawer === 'pairing' ? 'active' : ''}`} onClick={() => setDrawer(d => d === 'pairing' ? null : 'pairing')}><Smartphone size={12} /> Phone</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 6, background: 'rgba(0,0,0,0.16)', borderRadius: 8, minHeight: 280, maxHeight: 380 }}>
          {threadMessages.length === 0 ? (
            <div style={{ opacity: 0.5, fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              {activeChannel
                ? `Message ${activeChannel.name} or @mention a bot (e.g. @coder) to auto-route.`
                : 'Send a direct message to this bot contact.'}
            </div>
          ) : (
            threadMessages.map(m => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : m.role === 'system' ? 'center' : 'flex-start',
                  maxWidth: m.role === 'system' ? '95%' : '82%',
                  background: m.role === 'user' ? 'rgba(59,130,246,0.22)' : m.role === 'system' ? 'transparent' : 'rgba(255,255,255,0.06)',
                  borderRadius: 8,
                  padding: m.role === 'system' ? '2px 8px' : '7px 10px',
                  fontSize: m.role === 'system' ? 11 : 12.5,
                  opacity: m.role === 'system' ? 0.65 : 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.author && m.role !== 'system' && <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>{m.author}</div>}
                {m.text}
                {m.role === 'approval' && m.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      className="small-btn"
                      onClick={() => updateThreads(prev => ({
                        ...prev,
                        [threadKey]: (prev[threadKey] || []).map(x => (x.id === m.id ? { ...x, status: 'allowed', text: `${x.text} (Allowed)` } : x)),
                      }))}
                    >
                      Allow
                    </button>
                    <button
                      className="small-btn"
                      onClick={() => updateThreads(prev => ({
                        ...prev,
                        [threadKey]: (prev[threadKey] || []).map(x => (x.id === m.id ? { ...x, status: 'denied', text: `${x.text} (Denied)` } : x)),
                      }))}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSend} style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={activeChannel ? `Message ${activeChannel.name} (tip: @coder, @researcher)...` : `Message ${activeBot?.name || 'bot'}...`}
            style={{ flex: 1, padding: '7px 10px', fontSize: 12.5 }}
          />
          {activeCliRunId ? (
            <button type="button" className="small-btn" onClick={handleStopCli}><Square size={13} /> Stop</button>
          ) : (
            <button type="submit" className="small-btn" disabled={sending || !draft.trim()}>
              <Send size={13} /> {sending ? 'Working…' : 'Send'}
            </button>
          )}
        </form>
      </div>

      {/* Right Drawer: Computer Preview | Local CLI Engines | Phone Pairing */}
      {drawer && (
        <div style={{ borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.08))', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drawer === 'computer' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}><Monitor size={12} /> Bot Computer</span>
                <button className="small-btn" onClick={refreshComputerPreview} title="Refresh preview"><RefreshCw size={11} /></button>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  value={previewUrl}
                  onChange={e => setPreviewUrl(e.target.value)}
                  style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
                />
                <button className="small-btn" onClick={openComputerWindow} title="Open desktop window"><ExternalLink size={11} /></button>
              </div>
              <div style={{ background: '#020617', borderRadius: 8, minHeight: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                {previewShot ? (
                  <img src={previewShot} alt="Bot screen" style={{ width: '100%', height: 'auto', display: 'block' }} />
                ) : (
                  <span style={{ fontSize: 11, opacity: 0.5, padding: 12, textAlign: 'center' }}>
                    Click refresh to preview the bot&apos;s sandboxed browser/desktop session.
                  </span>
                )}
              </div>
            </>
          )}

          {drawer === 'engines' && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12 }}><Cpu size={12} /> Local CLI Engines</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Run bots on locally installed <code>claude</code>, <code>codex</code>, or <code>grok</code> CLIs.
              </div>
              {(drivers.length ? drivers : [
                { id: 'claude', label: 'Claude Code CLI', available: false },
                { id: 'codex', label: 'OpenAI Codex CLI', available: false },
                { id: 'grok', label: 'Grok CLI', available: false },
              ]).map(d => (
                <div key={d.id} style={{ padding: 8, borderRadius: 6, background: 'rgba(255,255,255,0.04)', fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                    <span>{d.label}</span>
                    <span style={{ color: d.available ? '#34d399' : '#94a3b8' }}>{d.available ? 'Ready' : 'Not found'}</span>
                  </div>
                  {d.resolvedPath && <div style={{ fontSize: 10, opacity: 0.6, wordBreak: 'break-all' }}>{d.resolvedPath}</div>}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="text"
                      placeholder="Custom binary path..."
                      value={customPaths[d.id] ?? d.configuredPath ?? ''}
                      onChange={e => setCustomPaths(prev => ({ ...prev, [d.id]: e.target.value }))}
                      style={{ flex: 1, fontSize: 10.5, padding: '3px 5px' }}
                    />
                    <button
                      className="small-btn"
                      onClick={() => {
                        window.__YOGATIK_CLI_DRIVERS__?.setPath(d.id, customPaths[d.id] || '').then(r => {
                          if (r?.success) setDrivers(r.drivers || [])
                        })
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
              {activeBot && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Engine for {activeBot.name}:</div>
                  <select
                    value={botEngineOverrides[activeBot.id] || 'builtin'}
                    onChange={e => setBotEngineOverrides(prev => ({ ...prev, [activeBot.id]: e.target.value }))}
                    style={{ width: '100%', fontSize: 11.5, padding: 5 }}
                  >
                    <option value="builtin">Yogatik Built-in API / Ollama</option>
                    <option value="claude">Local claude CLI</option>
                    <option value="codex">Local codex CLI</option>
                    <option value="grok">Local grok CLI</option>
                  </select>
                </div>
              )}
            </>
          )}

          {drawer === 'pairing' && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12 }}><Smartphone size={12} /> Harness &amp; Phone Pairing</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Local HTTP + SSE server (127.0.0.1:{harness.port}) for mobile companion &amp; remote control.
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="small-btn" onClick={toggleHarness}>
                  {harness.running ? <><Square size={11} /> Stop Harness</> : <><Play size={11} /> Start Harness</>}
                </button>
                {harness.running && (
                  <button className="small-btn" onClick={rotatePairing}><RefreshCw size={11} /> Rotate</button>
                )}
              </div>
              {harness.running && (
                <div style={{ fontSize: 11, background: 'rgba(255,255,255,0.04)', padding: 8, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><strong>Code:</strong> {harness.pairingCode}</div>
                  <div><strong>SSE Clients:</strong> {harness.clients}</div>
                  <div style={{ wordBreak: 'break-all', fontSize: 10, opacity: 0.8 }}>{harness.pairingUrl}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

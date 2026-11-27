import React from 'react'
import {
  Bot, Plus, Trash2, Check, Download, Upload, X, Play, Square,
  Users, Target, GitBranch, LayoutGrid, CheckCircle2, Clock, PlayCircle, ArrowRight, Building2
} from 'lucide-react'
import { Modal } from './Modal'
import { BotRosterView } from './BotRosterView'
import { PaperclipControlPanel } from './PaperclipControlPanel'
import {
  getAgents, upsertAgent, deleteAgent, getActiveAgentId, setActiveAgent, exportAgent, parseAgent,
} from '../agents'
import {
  listBoardTasks, listGoals, upsertBoardTask, moveBoardTask, deleteBoardTask, subscribeControlPlane,
} from '../paperclipControlPlane'
import { autonomousAgent } from '../autonomousAgent'
import { CopyButton } from './ToolResultCard'
import { subscribeCrewTraces } from '../crewTrace'

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/**
 * Agents — named specialists (pick one per chat), plus the autonomous task
 * runner (goal → plan → execute → report). Sub-agent delegation happens
 * automatically via the spawn_agents tool; this panel manages the roster.
 */
export function AgentsPanel({ onClose, onToast, conversationId = null, embedded = false }) {
  const [tab, setTab] = React.useState('agents')
  const [agents, setAgents] = React.useState([])
  const [activeId, setActiveId] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  const fileRef = React.useRef(null)
  const [importError, setImportError] = React.useState('')

  // Autonomous run state
  const [goal, setGoal] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [plan, setPlan] = React.useState([])
  const [stepStatus, setStepStatus] = React.useState({})   // index -> 'run' | 'done'
  const [report, setReport] = React.useState('')
  const abortRef = React.useRef(null)

  // Persistent Kanban board tasks state (backed by Paperclip Control Plane)
  const [customTasks, setCustomTasks] = React.useState([])
  const [boardGoals, setBoardGoals] = React.useState([])
  const [newTaskTitle, setNewTaskTitle] = React.useState('')
  const [newTaskAgentId, setNewTaskAgentId] = React.useState('agent_general')
  const [newTaskGoalId, setNewTaskGoalId] = React.useState('')
  const [newTaskRequiresApproval, setNewTaskRequiresApproval] = React.useState(false)

  React.useEffect(() => {
    let mounted = true
    const loadTasks = async () => {
      const [list, goals] = await Promise.all([listBoardTasks(), listGoals()])
      if (mounted) {
        setCustomTasks(list)
        setBoardGoals(goals)
      }
    }
    loadTasks()
    const unsub = subscribeControlPlane(() => { loadTasks() })
    return () => { mounted = false; unsub() }
  }, [])

  // Scoped to THIS chat, inheriting the global default. Without the id the
  // panel read and wrote the single global key, so activating an agent here
  // changed the agent answering in every other open conversation.
  const reload = async () => { setAgents(await getAgents()); setActiveId(await getActiveAgentId(conversationId)) }
  React.useEffect(() => { reload() }, [conversationId])

  const activate = async (id) => { await setActiveAgent(id === activeId ? null : id, conversationId); reload() }

  const saveAgent = async () => {
    if (!editing?.name?.trim() || !editing?.system?.trim()) return
    await upsertAgent({
      ...editing,
      tools: (editing.toolsText || '').split(',').map(s => s.trim()).filter(Boolean),
      subAgents: (editing.subText || '').split(',').map(s => s.trim()).filter(Boolean),
    })
    setEditing(null); reload()
  }

  const importFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    try { await upsertAgent(parseAgent(await f.text())); reload(); onToast?.('Agent imported') }
    catch (err) { setImportError(`Import failed: ${err.message}`) }
    e.target.value = ''
  }

  const runGoal = async () => {
    if (!goal.trim() || running) return
    setRunning(true); setPlan([]); setStepStatus({}); setReport('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { report: out } = await autonomousAgent(goal.trim(), {
        signal: controller.signal,
        onPlan: (steps) => setPlan(steps),
        onStepStart: (i) => setStepStatus(s => ({ ...s, [i]: 'run' })),
        onStepDone: (i) => setStepStatus(s => ({ ...s, [i]: 'done' })),
      })
      setReport(out || '(no result)')
    } catch (e) {
      setReport(`Failed: ${e?.message || e}`)
    } finally {
      setRunning(false); abortRef.current = null
    }
  }
  const stopGoal = () => { abortRef.current?.abort() }

  // crew_orchestrator traces — subscribed for the panel's lifetime, not just
  // while the "Crew traces" tab is open, so a run that finishes while the
  // user is on another tab is still there when they switch to it.
  const [crewTraces, setCrewTraces] = React.useState([])
  React.useEffect(() => subscribeCrewTraces(setCrewTraces), [])

  const moveTask = async (taskId, nextStatus) => {
    const res = await moveBoardTask(taskId, nextStatus)
    if (res?.approvalCreated) {
      onToast?.('Task routed to Control Plane Approvals inbox')
    }
  }

  const addTask = async (e) => {
    e?.preventDefault?.()
    if (!newTaskTitle.trim()) return
    const picked = agents.find(a => a.id === newTaskAgentId)
    await upsertBoardTask({
      title: newTaskTitle.trim(),
      agentId: picked?.id || newTaskAgentId || 'agent_general',
      agent: picked?.name || 'General',
      goalId: newTaskGoalId || null,
      requiresApproval: newTaskRequiresApproval,
      status: 'backlog',
      priority: 'normal',
    })
    setNewTaskTitle('')
  }

  // Combine autonomous plan steps into board dynamically
  const allBoardTasks = React.useMemo(() => {
    const tasks = [...customTasks]
    plan.forEach((s, idx) => {
      const isDone = stepStatus[idx] === 'done'
      const isRun = stepStatus[idx] === 'run'
      tasks.push({
        id: `plan_step_${idx}`,
        title: s,
        agent: 'Autonomous Planner',
        status: isDone ? 'done' : isRun ? 'progress' : 'backlog',
        priority: 'high',
        timestamp: Date.now(),
        isAutoStep: true,
      })
    })
    return tasks
  }, [customTasks, plan, stepStatus])

  return (
    <Modal title="Agents" icon={<Bot size={16} />} onClose={onClose} embedded={embedded}>
      <div className="tab-row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}><LayoutGrid size={12} /> Board</button>
        <button className={tab === 'control' ? 'active' : ''} onClick={() => setTab('control')}><Building2 size={12} /> Control Plane</button>
        <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}><Bot size={12} /> Roster &amp; Channels</button>
        <button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}><Users size={12} /> Agents</button>
        <button className={tab === 'auto' ? 'active' : ''} onClick={() => setTab('auto')}><Target size={12} /> Autonomous</button>
        <button className={tab === 'crew' ? 'active' : ''} onClick={() => setTab('crew')}><GitBranch size={12} /> Crew traces{crewTraces.length ? ` (${crewTraces.length})` : ''}</button>
      </div>

      {tab === 'control' && (
        <PaperclipControlPanel onToast={onToast} />
      )}

      {tab === 'roster' && (
        <BotRosterView onToast={onToast} />
      )}

      {tab === 'board' && (
        <div className="personalise-group" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <p className="personalise-hint" style={{ margin: 0 }}>
              Multi-Agent Collaboration Board — Real-time synchronization of sub-agents, autonomous planning steps, and team tasks.
            </p>
            <form onSubmit={addTask} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
              <input
                type="text"
                placeholder="New multi-agent task..."
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                style={{ flex: 1, minWidth: 160, padding: '4px 8px', fontSize: '12px' }}
              />
              <select
                value={newTaskAgentId}
                onChange={e => setNewTaskAgentId(e.target.value)}
                style={{ padding: '4px 6px', fontSize: '11px', background: 'var(--bg-input, #1e1e2e)', color: 'inherit', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: 4 }}
              >
                {agents.length > 0 ? agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                )) : (
                  <option value="agent_general">General</option>
                )}
              </select>
              {boardGoals.length > 0 && (
                <select
                  value={newTaskGoalId}
                  onChange={e => setNewTaskGoalId(e.target.value)}
                  style={{ padding: '4px 6px', fontSize: '11px', background: 'var(--bg-input, #1e1e2e)', color: 'inherit', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: 4 }}
                >
                  <option value="">No goal</option>
                  {boardGoals.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', opacity: 0.85, cursor: 'pointer' }} title="Require human approval in Control Plane before marking Done">
                <input
                  type="checkbox"
                  checked={newTaskRequiresApproval}
                  onChange={e => setNewTaskRequiresApproval(e.target.checked)}
                />
                Gate
              </label>
              <button type="submit" className="small-btn" disabled={!newTaskTitle.trim()}>
                <Plus size={12} /> Add
              </button>
            </form>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            marginTop: 4,
            overflowX: 'auto',
            paddingBottom: 4
          }}>
            {[
              { key: 'backlog', title: 'Backlog / Queue', color: '#38bdf8', icon: Clock },
              { key: 'progress', title: 'In Progress', color: '#fb923c', icon: PlayCircle },
              { key: 'review', title: 'Review / Validating', color: '#a855f7', icon: Target },
              { key: 'done', title: 'Completed', color: '#34d399', icon: CheckCircle2 }
            ].map(col => {
              const colTasks = allBoardTasks.filter(t => t.status === col.key)
              const ColIcon = col.icon
              return (
                <div
                  key={col.key}
                  style={{
                    background: 'var(--bg-card, rgba(255, 255, 255, 0.03))',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    borderRadius: 8,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    minHeight: 220,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 6,
                    borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.06))',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', fontWeight: 700, color: col.color }}>
                      <ColIcon size={12} /> {col.title}
                    </span>
                    <span style={{
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      padding: '1px 6px',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}>
                      {colTasks.length}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto', maxHeight: 320 }}>
                    {colTasks.length === 0 ? (
                      <div style={{ fontSize: '11px', opacity: 0.4, textAlign: 'center', padding: '24px 0', fontStyle: 'italic' }}>
                        Empty
                      </div>
                    ) : (
                      colTasks.map(task => {
                        const nextMap = {
                          backlog: 'progress',
                          progress: 'review',
                          review: 'done',
                          done: 'backlog'
                        }
                        return (
                          <div
                            key={task.id}
                            style={{
                              background: 'var(--bg-secondary, rgba(30, 30, 46, 0.7))',
                              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.07))',
                              borderRadius: 6,
                              padding: '7px 8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 5,
                              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                            }}
                          >
                            <div style={{ fontSize: '12px', fontWeight: 500, lineHeight: 1.35, color: '#f1f5f9' }}>
                              {task.title}
                            </div>
                            {(task.requiresApproval || task.costUsd > 0 || task.goalId) && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {task.requiresApproval && (
                                  <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 4, background: 'rgba(251,146,60,0.16)', color: '#fb923c', fontWeight: 600 }}>
                                    Approval Gate
                                  </span>
                                )}
                                {task.costUsd > 0 && (
                                  <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 4, background: 'rgba(52,211,153,0.14)', color: '#34d399' }}>
                                    ${task.costUsd.toFixed(4)}
                                  </span>
                                )}
                                {task.goalId && boardGoals.find(g => g.id === task.goalId) && (
                                  <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 4, background: 'rgba(56,189,248,0.14)', color: '#38bdf8' }}>
                                    {boardGoals.find(g => g.id === task.goalId).title.slice(0, 24)}
                                  </span>
                                )}
                              </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                              <span style={{
                                fontSize: '9.5px',
                                background: 'rgba(99, 102, 241, 0.15)',
                                color: '#a5b4fc',
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                                borderRadius: 4,
                                padding: '1px 5px',
                                fontWeight: 600,
                              }}>
                                {task.agent}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                {!task.isAutoStep && (
                                  <button
                                    className="icon-btn"
                                    title="Advance status"
                                    onClick={() => moveTask(task.id, nextMap[task.status])}
                                    style={{ padding: '2px 4px', fontSize: '9.5px', display: 'flex', alignItems: 'center', gap: 2 }}
                                  >
                                    <ArrowRight size={10} />
                                  </button>
                                )}
                                {!task.isAutoStep && (
                                  <button
                                    className="icon-btn"
                                    title="Delete task"
                                    onClick={() => deleteBoardTask(task.id)}
                                    style={{ padding: '2px 4px' }}
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'agents' && (
        <div className="personalise-group">
          <p className="personalise-hint">Pick an agent to specialise the assistant for this chat — its role and tools apply to every message. The General agent can also delegate to specialists automatically.</p>
          {agents.map(a => (
            <div className="toggle-row" key={a.id}>
              <label title={a.description}>
                {a.name}{a.id === activeId && <span className="personalise-sub">● active</span>}
                <span className="personalise-sub">{a.description || a.role}</span>
              </label>
              <span style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" title={a.id === activeId ? 'Deactivate' : 'Use for this chat'} onClick={() => activate(a.id)}><Check size={13} /></button>
                <button className="icon-btn" title="Export" onClick={() => download(`${a.name}.agent.json`, exportAgent(a))}><Download size={13} /></button>
                <button className="icon-btn" title="Edit" onClick={() => setEditing({ ...a, toolsText: (a.tools || []).join(', '), subText: (a.subAgents || []).join(', ') })}><Bot size={13} /></button>
                <button className="icon-btn" title="Delete" onClick={async () => { await deleteAgent(a.id); reload() }}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
          {editing ? (
            <div className="skill-editor" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              <input placeholder="Agent name" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              <input placeholder="Role (e.g. researcher)" value={editing.role || ''} onChange={e => setEditing({ ...editing, role: e.target.value })} />
              <input placeholder="Short description" value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} />
              <textarea placeholder="System instructions — how this agent behaves" rows={4} value={editing.system || ''} onChange={e => setEditing({ ...editing, system: e.target.value })} />
              <input placeholder="Allowed tools (comma-separated, blank = all)" value={editing.toolsText || ''} onChange={e => setEditing({ ...editing, toolsText: e.target.value })} />
              <input placeholder="Model to pin (optional, blank = current chat model)" value={editing.model || ''} onChange={e => setEditing({ ...editing, model: e.target.value })} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={!!editing.canDelegate} onChange={e => setEditing({ ...editing, canDelegate: e.target.checked })} />
                Can delegate to sub-agents
              </label>
              {editing.canDelegate && (
                <input placeholder="Sub-agent roles it may spawn (comma-separated)" value={editing.subText || ''} onChange={e => setEditing({ ...editing, subText: e.target.value })} />
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="small-btn" onClick={saveAgent}><Check size={12} /> Save</button>
                <button className="small-btn" onClick={() => setEditing(null)}><X size={12} /> Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="small-btn" onClick={() => setEditing({ name: '', system: '', canDelegate: false })}><Plus size={12} /> New agent</button>
                <button className="small-btn" onClick={() => fileRef.current?.click()}><Upload size={12} /> Import</button>
                <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
              </div>
              {importError && (
                <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}
                  onClick={() => setImportError('')} title="Click to dismiss">{importError}</div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'auto' && (
        <div className="personalise-group">
          <p className="personalise-hint">Give the agent a goal. It plans the steps, executes each one with tools, then writes a final synthesized answer.</p>
          <textarea
            placeholder="e.g. Research the top 3 note-taking apps and recommend one for a student, with reasons."
            rows={3} value={goal} disabled={running}
            onChange={e => setGoal(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {running
              ? <button className="small-btn" onClick={stopGoal}><Square size={12} /> Stop</button>
              : <button className="small-btn" onClick={runGoal} disabled={!goal.trim()}><Play size={12} /> Run goal</button>}
          </div>

          {plan.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="personalise-sub" style={{ marginBottom: 6 }}>Plan</div>
              {plan.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '3px 0' }}>
                  <span style={{ opacity: .7, minWidth: 18 }}>
                    {stepStatus[i] === 'done' ? '✅' : stepStatus[i] === 'run' ? '⏳' : '•'}
                  </span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}

          {report && (
            <div style={{ marginTop: 14, position: 'relative' }}>
              <div className="personalise-sub" style={{ marginBottom: 6 }}>Final answer</div>
              <div className="code-output" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', padding: 12, position: 'relative' }}>
                <CopyButton text={report} title="Copy" style={{
                  position: 'absolute', top: 6, right: 6, background: 'var(--bg-input)',
                  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
                }} />
                {report}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'crew' && (
        <div className="personalise-group">
          <p className="personalise-hint">
            Every crew_orchestrator run (sequential / hierarchical / reflexion / map_reduce / best_of_n / auto),
            newest first — which specialists ran, how long each took, and whether it succeeded.
          </p>
          {crewTraces.length === 0 && (
            <p className="tool-detail" style={{ opacity: 0.7 }}>No crew runs yet this session.</p>
          )}
          {crewTraces.map(t => (
            <div key={t.id} className="toggle-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12.5 }}>
                  <span style={{
                    background: t.success ? 'rgba(16,185,129,0.15)' : 'rgba(248,113,113,0.15)',
                    color: t.success ? '#10b981' : '#f87171',
                    padding: '1px 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                  }}>
                    {t.workflow}
                  </span>
                  {t.goal || '(no goal recorded)'}
                </span>
                <span className="personalise-sub">{(t.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {t.error && <div className="tool-detail" style={{ color: '#f87171', fontSize: 11.5 }}>{t.error}</div>}
              {t.steps.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {t.steps.map((s, i) => (
                    <span key={i} style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, fontSize: 10.5, color: '#a6adc8' }}>
                      {s.agent}{typeof s.durationMs === 'number' ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  ))}
                </div>
              )}
              <span className="personalise-sub" style={{ fontSize: 10, opacity: 0.6 }}>{new Date(t.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

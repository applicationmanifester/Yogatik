import React, { useState, useEffect, useCallback } from 'react'
import {
  Building2, Target, Activity, ShieldCheck, Pause, Play,
  DollarSign, Check, X, Plus, Trash2, Edit3, RefreshCw, AlertTriangle
} from 'lucide-react'
import {
  buildOrgTree,
  getBudgetSummary,
  listApprovals,
  listAuditLog,
  listBoardTasks,
  listGoals,
  listHeartbeatRuns,
  resetAgentSpend,
  resolveApproval,
  runAgentHeartbeat,
  subscribeControlPlane,
  updateAgentGovernance,
  upsertGoal,
  deleteGoal,
} from '../paperclipControlPlane'

function OrgNode({ node, depth = 0, onEdit, onTogglePause, onPulse, onResetSpend, pulsingId }) {
  const limit = node.budgetLimitUsd
  const pct = limit ? Math.min(100, (node.spentUsd / limit) * 100) : 0
  const barColor = pct >= 95 ? '#f87171' : pct >= 75 ? '#fb923c' : '#34d399'

  return (
    <div style={{ marginLeft: depth * 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          background: 'var(--bg-card, rgba(255,255,255,0.03))',
          border: `1px solid ${node.paused ? 'rgba(248,113,113,0.4)' : 'var(--border-color, rgba(255,255,255,0.08))'}`,
          borderRadius: 8,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>{node.name}</span>
            {node.title && (
              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.16)', color: '#a5b4fc' }}>
                {node.title}
              </span>
            )}
            <span className="personalise-sub" style={{ fontSize: 10.5 }}>{node.department}</span>
            {node.paused && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'rgba(248,113,113,0.18)', color: '#f87171', fontWeight: 700 }}>
                PAUSED
              </span>
            )}
            {node.heartbeatIntervalMin > 0 && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'rgba(52,211,153,0.14)', color: '#34d399' }}>
                ♥ {node.heartbeatIntervalMin}m
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="icon-btn"
              title="Run heartbeat check-in now"
              disabled={pulsingId === node.agentId}
              onClick={() => onPulse(node.agentId)}
            >
              <Activity size={12} />
            </button>
            <button
              className="icon-btn"
              title={node.paused ? 'Resume agent' : 'Pause agent'}
              onClick={() => onTogglePause(node)}
            >
              {node.paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
            <button className="icon-btn" title="Edit governance & budget" onClick={() => onEdit(node)}>
              <Edit3 size={12} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
          <span style={{ opacity: 0.8 }}>
            Spend: <strong>${node.spentUsd.toFixed(4)}</strong>
            {limit !== null ? ` / $${limit.toFixed(2)}` : ' (unlimited)'}
          </span>
          {limit !== null && (
            <div style={{ flex: 1, maxWidth: 140, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
            </div>
          )}
          {node.spentUsd > 0 && (
            <button className="icon-btn" title="Reset spend counter" onClick={() => onResetSpend(node.agentId)} style={{ fontSize: 10 }}>
              <RefreshCw size={10} />
            </button>
          )}
          {node.lastHeartbeatAt && (
            <span className="personalise-sub" style={{ fontSize: 10 }}>
              Last pulse: {new Date(node.lastHeartbeatAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {node.standingInstructions && (
          <div className="personalise-sub" style={{ fontSize: 11, opacity: 0.8 }}>
            Standing: {node.standingInstructions.slice(0, 120)}{node.standingInstructions.length > 120 ? '…' : ''}
          </div>
        )}
      </div>

      {Array.isArray(node.reports) && node.reports.map(child => (
        <OrgNode
          key={child.agentId}
          node={child}
          depth={depth + 1}
          onEdit={onEdit}
          onTogglePause={onTogglePause}
          onPulse={onPulse}
          onResetSpend={onResetSpend}
          pulsingId={pulsingId}
        />
      ))}
    </div>
  )
}

export function PaperclipControlPanel({ onToast }) {
  const [subTab, setSubTab] = useState('org')
  const [tree, setTree] = useState([])
  const [budget, setBudget] = useState({ totalSpentUsd: 0, totalAllocatedLimitUsd: 0, pausedCount: 0, agents: [] })
  const [goals, setGoals] = useState([])
  const [tasks, setTasks] = useState([])
  const [approvals, setApprovals] = useState([])
  const [heartbeats, setHeartbeats] = useState([])
  const [audit, setAudit] = useState([])
  const [editing, setEditing] = useState(null)
  const [editError, setEditError] = useState('')
  const [pulsingId, setPulsingId] = useState(null)
  const [newGoalTitle, setNewGoalTitle] = useState('')
  const [newGoalOwner, setNewGoalOwner] = useState('agent_yogatik')
  const [reviewNote, setReviewNote] = useState('')

  const reload = useCallback(async () => {
    const [t, b, g, tk, ap, hb, au] = await Promise.all([
      buildOrgTree(),
      getBudgetSummary(),
      listGoals(),
      listBoardTasks(),
      listApprovals(),
      listHeartbeatRuns(25),
      listAuditLog(40),
    ])
    setTree(t)
    setBudget(b)
    setGoals(g)
    setTasks(tk)
    setApprovals(ap)
    setHeartbeats(hb)
    setAudit(au)
  }, [])

  useEffect(() => {
    reload()
    return subscribeControlPlane(() => { reload() })
  }, [reload])

  const pendingApprovals = approvals.filter(a => a.status === 'pending')

  const handleSaveGov = async () => {
    if (!editing) return
    setEditError('')
    try {
      await updateAgentGovernance(editing.agentId, {
        title: editing.title,
        department: editing.department,
        reportsTo: editing.reportsTo || null,
        budgetLimitUsd: editing.budgetLimitUsd === '' ? null : Number(editing.budgetLimitUsd),
        heartbeatIntervalMin: Number(editing.heartbeatIntervalMin) || 0,
        standingInstructions: editing.standingInstructions || '',
      })
      setEditing(null)
      onToast?.('Agent governance updated')
    } catch (err) {
      const msg = err?.message || 'Failed to update governance'
      setEditError(msg)
      onToast?.(msg)
    }
  }

  const handlePulse = async (agentId) => {
    setPulsingId(agentId)
    try {
      const run = await runAgentHeartbeat(agentId, { trigger: 'manual' })
      onToast?.(`Heartbeat (${run.status}): ${run.summary.slice(0, 80)}`)
    } finally {
      setPulsingId(null)
    }
  }

  const handleAddGoal = async (e) => {
    e.preventDefault()
    if (!newGoalTitle.trim()) return
    await upsertGoal({ title: newGoalTitle.trim(), ownerAgentId: newGoalOwner })
    setNewGoalTitle('')
    onToast?.('Goal created')
  }

  const handleResolve = async (id, decision) => {
    await resolveApproval(id, decision, reviewNote)
    setReviewNote('')
    onToast?.(`Approval ${decision}`)
  }

  return (
    <div className="personalise-group" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Summary Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8,
        padding: 8,
        borderRadius: 8,
        background: 'var(--bg-card, rgba(255,255,255,0.03))',
        border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
      }}>
        <div style={{ fontSize: 11.5 }}>
          <div className="personalise-sub">Total Spend</div>
          <strong><DollarSign size={11} style={{ verticalAlign: 'middle' }} />{budget.totalSpentUsd.toFixed(4)}</strong>
        </div>
        <div style={{ fontSize: 11.5 }}>
          <div className="personalise-sub">Allocated Caps</div>
          <strong>${budget.totalAllocatedLimitUsd.toFixed(2)}</strong>
        </div>
        <div style={{ fontSize: 11.5 }}>
          <div className="personalise-sub">Active Goals</div>
          <strong>{goals.filter(g => g.status === 'active').length}</strong>
        </div>
        <div style={{ fontSize: 11.5 }}>
          <div className="personalise-sub">Pending Approvals</div>
          <strong style={{ color: pendingApprovals.length ? '#fb923c' : 'inherit' }}>{pendingApprovals.length}</strong>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="tab-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={subTab === 'org' ? 'active' : ''} onClick={() => setSubTab('org')}>
          <Building2 size={12} /> Org Chart
        </button>
        <button className={subTab === 'goals' ? 'active' : ''} onClick={() => setSubTab('goals')}>
          <Target size={12} /> Goals ({goals.length})
        </button>
        <button className={subTab === 'heartbeats' ? 'active' : ''} onClick={() => setSubTab('heartbeats')}>
          <Activity size={12} /> Heartbeats ({heartbeats.length})
        </button>
        <button className={subTab === 'approvals' ? 'active' : ''} onClick={() => setSubTab('approvals')}>
          <ShieldCheck size={12} /> Approvals{pendingApprovals.length ? ` (${pendingApprovals.length})` : ''}
        </button>
      </div>

      {/* 1. ORG CHART */}
      {subTab === 'org' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="personalise-hint" style={{ margin: 0 }}>
            Reporting hierarchy, per-agent spend caps, standing instructions, and heartbeat cadence.
          </p>

          {editing && (
            <div className="skill-editor" style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 8, border: '1px solid var(--border-color, rgba(255,255,255,0.12))' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>Edit Governance: {editing.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input placeholder="Title (e.g. Staff Engineer)" value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} />
                <input placeholder="Department" value={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                <select
                  value={editing.reportsTo || ''}
                  onChange={e => setEditing({ ...editing, reportsTo: e.target.value || null })}
                  style={{ padding: '4px 6px', fontSize: 12, background: 'var(--bg-input)', color: 'inherit', border: '1px solid var(--border-color)' }}
                >
                  <option value="">Reports to: (Root / Top)</option>
                  {budget.agents.filter(a => a.agentId !== editing.agentId).map(a => (
                    <option key={a.agentId} value={a.agentId}>{a.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="Budget USD (blank = unlimited)"
                  value={editing.budgetLimitUsd ?? ''}
                  onChange={e => setEditing({ ...editing, budgetLimitUsd: e.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Heartbeat (min, 0=manual)"
                  value={editing.heartbeatIntervalMin ?? 0}
                  onChange={e => setEditing({ ...editing, heartbeatIntervalMin: e.target.value })}
                />
              </div>
              <textarea
                rows={3}
                placeholder="Standing instructions injected into every run of this role..."
                value={editing.standingInstructions || ''}
                onChange={e => setEditing({ ...editing, standingInstructions: e.target.value })}
              />
              {editError && (
                <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '4px 8px', borderRadius: 4 }}>
                  {editError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="small-btn" onClick={handleSaveGov}><Check size={12} /> Save</button>
                <button className="small-btn" onClick={() => { setEditing(null); setEditError('') }}><X size={12} /> Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
            {tree.map(root => (
              <OrgNode
                key={root.agentId}
                node={root}
                onEdit={(n) => setEditing({ ...n, budgetLimitUsd: n.budgetLimitUsd ?? '' })}
                onTogglePause={(n) => updateAgentGovernance(n.agentId, { paused: !n.paused })}
                onPulse={handlePulse}
                onResetSpend={(id) => resetAgentSpend(id)}
                pulsingId={pulsingId}
              />
            ))}
          </div>
        </div>
      )}

      {/* 2. GOALS */}
      {subTab === 'goals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <form onSubmit={handleAddGoal} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="New company/workspace goal..."
              value={newGoalTitle}
              onChange={e => setNewGoalTitle(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <select
              value={newGoalOwner}
              onChange={e => setNewGoalOwner(e.target.value)}
              style={{ padding: '4px 6px', fontSize: 12, background: 'var(--bg-input)', color: 'inherit', border: '1px solid var(--border-color)' }}
            >
              {budget.agents.map(a => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
            </select>
            <button type="submit" className="small-btn" disabled={!newGoalTitle.trim()}><Plus size={12} /> Add Goal</button>
          </form>

          {goals.map(g => {
            const linked = tasks.filter(t => t.goalId === g.id)
            const done = linked.filter(t => t.status === 'done').length
            const pct = linked.length ? Math.round((done / linked.length) * 100) : 0
            return (
              <div key={g.id} className="toggle-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{g.title}</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="personalise-sub">{done}/{linked.length} tasks ({pct}%)</span>
                    <button className="icon-btn" title="Delete goal" onClick={() => deleteGoal(g.id)}><Trash2 size={12} /></button>
                  </div>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#34d399' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 3. HEARTBEATS */}
      {subTab === 'heartbeats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="personalise-hint" style={{ margin: 0 }}>
            Autonomous agent check-ins over queued tasks and goals. Configure intervals in Org Chart or pulse manually.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {budget.agents.slice(0, 6).map(a => (
              <button
                key={a.agentId}
                className="small-btn"
                disabled={pulsingId === a.agentId}
                onClick={() => handlePulse(a.agentId)}
              >
                <Activity size={11} /> Pulse {a.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {heartbeats.length === 0 ? (
              <div className="personalise-sub" style={{ opacity: 0.7 }}>No heartbeat runs recorded yet.</div>
            ) : heartbeats.map(hb => (
              <div key={hb.id} className="toggle-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>
                    <strong>{hb.agentName || hb.agentId}</strong>{' '}
                    <span style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: hb.status === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                      color: hb.status === 'ok' ? '#34d399' : '#f87171',
                    }}>{hb.status}</span>
                  </span>
                  <span className="personalise-sub">{new Date(hb.at).toLocaleTimeString()} · {hb.trigger}</span>
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.9 }}>{hb.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. APPROVALS & AUDIT */}
      {subTab === 'approvals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="text"
            placeholder="Optional reviewer note for next approval/rejection..."
            value={reviewNote}
            onChange={e => setReviewNote(e.target.value)}
          />
          {approvals.length === 0 ? (
            <div className="personalise-sub" style={{ opacity: 0.7 }}>No approval requests in queue.</div>
          ) : approvals.map(ap => (
            <div key={ap.id} className="toggle-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12 }}>
                  {ap.status === 'pending' && <AlertTriangle size={12} color="#fb923c" />}
                  {ap.title}
                </span>
                <span className="personalise-sub" style={{ textTransform: 'uppercase', fontSize: 10 }}>{ap.status}</span>
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.85 }}>{ap.detail}</div>
              {ap.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button className="small-btn" onClick={() => handleResolve(ap.id, 'approved')}><Check size={11} /> Approve</button>
                  <button className="small-btn" onClick={() => handleResolve(ap.id, 'rejected')}><X size={11} /> Reject</button>
                </div>
              )}
            </div>
          ))}

          <div className="personalise-sub" style={{ marginTop: 4, fontWeight: 700 }}>Audit Trail</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {audit.map(entry => (
              <div key={entry.id} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, opacity: 0.85 }}>
                <span><strong>{entry.action}</strong> · {entry.detail}</span>
                <span style={{ opacity: 0.65, whiteSpace: 'nowrap' }}>{new Date(entry.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

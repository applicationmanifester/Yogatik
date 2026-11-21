// Yogatik Permission Broker
// Risk-tiered access control: asks BEFORE mutating operations;
// integrates with diff preview so approval cards show actual patches.

const path = require('path')
const fs = require('fs')

let diffPreviewMod = null
function loadDiffPreview() {
  if (!diffPreviewMod) {
    try {
      diffPreviewMod = require(path.join(__dirname, '../src/diffPreview'))
    } catch (e) {
      diffPreviewMod = { unifiedDiff: function(before, after, opts) { return before === after ? 'No changes.' : 'Changes detected.' } }
    }
  }
  return diffPreviewMod
}

const TOOL_RISK = {
  'fs:read': 'LOW', 'fs:search': 'LOW', 'proc:list': 'LOW',
  'browser:get-tabs': 'LOW', 'browser:get-cookies': 'LOW', 'browser:get-storage': 'LOW',
  'browser:get-downloads': 'LOW', 'terminal:list': 'LOW',
  'fs:write': 'MEDIUM', 'fs:edit': 'MEDIUM', 'fs:mkdir': 'MEDIUM',
  'browser:set-storage': 'MEDIUM', 'browser:set-cookies': 'MEDIUM',
  'fs:delete': 'HIGH', 'proc:start': 'HIGH', 'proc:kill': 'HIGH',
  'terminal:exec': 'HIGH'
}
exports.TOOL_RISK = TOOL_RISK

const trustedRoots = new Set()
exports.isTrustedRoot = function(rp) { return trustedRoots.has(rp) }
exports.trustRoot = function(rp) { trustedRoots.add(rp) }
exports.untrustRoot = function(rp) { trustedRoots.delete(rp) }
exports.riskOf = function(tool) { return TOOL_RISK[tool] || 'MEDIUM' }
exports.buildDiffPreview = function(before, after, opts) {
  return loadDiffPreview().unifiedDiff(before || '', after || '', opts || {})
}
exports.decide = function(tool, args, ctx) {
  args = args || {}
  ctx = ctx || {}
  const risk = exports.riskOf(tool)
  const rootPath = ctx.rootPath || args.rootPath || ''
  let allow = false
  let reason = ''
  switch (risk) {
    case 'LOW':
      allow = true
      reason = 'Read-only operation'
      break
    case 'MEDIUM':
      if (trustedRoots.has(rootPath)) {
        allow = true
        reason = 'Trusted root'
      } else {
        allow = false
        reason = 'Mutating write on ' + (rootPath || 'unnamed root') + ' — confirmation required'
      }
      break
    case 'HIGH':
      allow = false
      reason = 'High-risk operation ' + tool + ' — explicit confirmation required'
      break
    default:
      allow = false
      reason = 'Unknown risk level for ' + tool
  }
  let diffPreview = null
  if (!allow && risk === 'MEDIUM' && args.path && ctx.beforeContent !== undefined && ctx.afterContent !== undefined) {
    diffPreview = exports.buildDiffPreview(ctx.beforeContent, ctx.afterContent)
  }
  return { allow: allow, reason: reason, risk: risk, diffPreview: diffPreview }
}
exports.requestPermission = function(tool, args, ctx) {
  args = args || {}
  ctx = ctx || {}
  const decision = exports.decide(tool, args, ctx)
  if (decision.allow) return Promise.resolve({ allowed: true, reason: decision.reason })
  if (process.env.YOGATIK_HEADLESS === 'true') {
    return Promise.resolve({ allowed: false, reason: decision.reason, diffPreview: decision.diffPreview })
  }
  var requestId = 'perm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  return Promise.resolve({
    allowed: null,
    pending: true,
    requestId: requestId,
    reason: decision.reason,
    diffPreview: decision.diffPreview,
    tool: tool,
    args: args,
    ctx: ctx
  })
}
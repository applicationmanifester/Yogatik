// Built-in Brave-style ad and tracker blocker for Yogatik Browser and Electron views.
// IMPROVED: EasyList-style filter parser, TTL+LRU URL decision cache,
// cosmetic element hiding, stealth mode, resource-type filtering,
// third-party rules, user allow/block lists, custom filters,
// YouTube ad skip, and telemetry via IPC.

const { session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { EventEmitter } = require('events')

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ╞──────────────────────────────────────────────────────────────
const DEFAULT_MAX_CACHE = 20000
const DEFAULT_BLOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes TTL for block decisions
const DEFAULT_ALLOW_TTL_MS = 10 * 60 * 1000 // 10 minutes TTL for allow decisions

const RESOURCE_TYPES = new Set([
  'script', 'image', 'stylesheet', 'font', 'xhr', 'fetch',
  'websocket', 'media', 'webview', 'other'
])

const DATA_DIR = path.join(os.homedir(), '.yogatik', 'adblock')
const USER_ALLOW_PATH = path.join(DATA_DIR, 'user-allow.json')
const USER_BLOCK_PATH = path.join(DATA_DIR, 'user-block.json')
const CUSTOM_FILTERS_PATH = path.join(DATA_DIR, 'custom-filters.txt')

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&')
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

// ══════╈─────────────────────────────────────────────────────────
// FILTER RULE PARSER (EasyList-style)
// ╞──────────────────────────────────────────────────────────────
// Supported formats:
//   ||example.com^             -> block example.com + subdomains
//   @@||example.com^           -> exception / allowlist
//   example.com##.ad-banner    -> cosmetic element hide
//   example.com#?#.ad-banner   -> cosmetic hide (JS fallback)
//   ||tracker.com^$script,third-party -> script-only, third-party only

class FilterRule {
  constructor(raw) {
    this.raw = raw
    this.enabled = true
    this.exception = false   // @@ prefix = allowlist exception
    this.cosmetic = false    // ## / #?# = element hiding
    this.selector = null
    this.host = null
    this.hostRegex = null
    this.pathPrefix = null
    this.pathRegex = null
    this.queryRegex = null
    this.resourceTypes = new Set()
    this.thirdPartyOnly = false
    this.options = new Set()
    this._parse(raw)
  }

  _parse(raw) {
    let s = raw.trim()
    if (!s || s.startsWith('!') || s.startsWith('[')) {
      this.enabled = false
      return
    }
    // Exception rule: @@...
    if (s.startsWith('@@')) {
      this.exception = true
      s = s.slice(2).trim()
    }
    // Cosmetic rules: ## or #?#
    const hashIdx = s.indexOf('#?#')
    if (hashIdx !== -1) {
      this.cosmetic = true
      this.selector = s.slice(hashIdx + 3).trim()
      s = s.slice(0, hashIdx).trim()
    } else {
      const idx2 = s.indexOf('##')
      if (idx2 !== -1) {
        this.cosmetic = true
        this.selector = s.slice(idx2 + 2).trim()
        s = s.slice(0, idx2).trim()
      }
    }
    // Options after $...
    const dollarIdx = s.indexOf('$')
    if (dollarIdx !== -1 && !this.cosmetic) {
      const opts = s.slice(dollarIdx + 1).split(',').map(o => o.trim()).filter(Boolean)
      s = s.slice(0, dollarIdx).trim()
      for (const o of opts) {
        if (RESOURCE_TYPES.has(o)) this.resourceTypes.add(o)
        else if (o === 'third-party') this.thirdPartyOnly = true
        else this.options.add(o)
      }
    }
    // Anchor rules:
    //   ||host^      -> domain + subdomains
    //   ||host/path* -> domain + path prefix wildcard
    //   |http://..   -> exact URL prefix
    //   plain        -> substring match on host/path
    if (s.startsWith('||')) {
      let rest = s.slice(2)
      if (rest.endsWith('^')) {
        rest = rest.slice(0, -1)
      } else if (rest.endsWith('*')) {
        rest = rest.slice(0, -1)
      }
      if (rest.includes('/')) {
        const slashIdx = rest.indexOf('/')
        const host = rest.slice(0, slashIdx).toLowerCase()
        const pathPart = rest.slice(slashIdx)
        this.host = host
        this.hostRegex = new RegExp('(?:^|\\.)' + escapeRegExp(host) + '$', 'i')
        this.pathPrefix = pathPart
      } else if (rest) {
        const host = rest.toLowerCase()
        this.host = host
        this.hostRegex = new RegExp('(?:^|\\.)' + escapeRegExp(host) + '$', 'i')
      }
    } else if (s.startsWith('|') && !s.startsWith('||')) {
      this.pathPrefix = s.slice(1)
    } else {
      this.host = s.toLowerCase()
      this.hostRegex = new RegExp(escapeRegExp(this.host), 'i')
    }
  }

  matchesUrl(urlObj, isThirdParty, resourceType) {
    if (!this.enabled) return false
    const hostname = urlObj.hostname.toLowerCase()
    const pathname = urlObj.pathname || ''
    const search = urlObj.search || ''
    if (this.hostRegex && !this.hostRegex.test(hostname)) return false
    if (this.pathPrefix && !pathname.startsWith(this.pathPrefix)) return false
    if (this.pathRegex && !this.pathRegex.test(pathname)) return false
    if (this.queryRegex && !this.queryRegex.test(search)) return false
    if (this.options.has('adformat') && !search.includes('adformat') && !search.includes('ctier')) return false
    if (this.thirdPartyOnly && !isThirdParty) return false
    if (this.resourceTypes.size > 0 && resourceType && !this.resourceTypes.has(resourceType)) return false
    return true
  }
}

// ══════╈─────────────────────────────────────────────────────────
// TTL + LRU CACHE FOR URL DECISIONS
// ╞──────────────────────────────────────────────────────────────
class TTLLRUCache {
  constructor(maxSize = DEFAULT_MAX_CACHE, ttlMs = DEFAULT_BLOCK_TTL_MS) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
    this.cache = new Map()
    this.hits = 0
    this.misses = 0
  }

  _now() { return Date.now() }

  get(key) {
    const entry = this.cache.get(key)
    if (!entry) { this.misses++; return undefined }
    if (this._now() - entry.ts > entry.ttl) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hits++
    return entry.value
  }

  set(key, value, ttlMs) {
    if (this.cache.has(key)) { this.cache.delete(key); }
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, { ts: Date.now(), value, ttl: ttlMs || this.ttlMs })
  }

  clear() { this.cache.clear() }
}

const blockCache = new TTLLRUCache(DEFAULT_MAX_CACHE, DEFAULT_BLOCK_TTL_MS)
const allowCache = new TTLLRUCache(5000, DEFAULT_ALLOW_TTL_MS)

// ══════╈─────────────────────────────────────────────────────────
// STATE
// ╞──────────────────────────────────────────────────────────────
let adShieldEnabled = true
let blockedCount = 0
let allowCount = 0
let exceptionCount = 0
let stealthMode = true
let customFiltersVersion = Date.now()
let networkRules = []
let cosmeticRules = []
let userBlockHosts = new Set()
let userAllowHosts = new Set()

// ══════╈─────────────────────────────────────────────────────────
// DEFAULT FILTER LISTS (bundled; extensible by user)
// ╞──────────────────────────────────────────────────────────────
const DEFAULT_NETWORK_RULES = [
  // Google / DoubleClick ad infrastructure
  '||doubleclick.net^',
  '||googleadservices.com^',
  '||googlesyndication.com^',
  '||adservice.google.com^',
  '||pagead2.googlesyndication.com^',
  '||pubads.g.doubleclick.net^',
  '||securepubads.g.doubleclick.net^',
  '||google-analytics.com^$third-party',
  '||analytics.google.com^$third-party',

  // Major ad networks & DSPs
  '||adnxs.com^',
  '||criteo.com^',
  '||criteo.net^',
  '||outbrain.com^',
  '||taboola.com^',
  '||moatads.com^',
  '||rubiconproject.com^',
  '||openx.net^',
  '||adroll.com^',
  '||casalemedia.com^',
  '||advertising.com^',
  '||amazon-adsystem.com^',
  '||popads.net^',
  '||popcash.net^',
  '||zergnet.com^',
  '||trafficjunky.com^',
  '||revcontent.com^',
  '||adform.net^',
  '||adblade.com^',
  '||bidswitch.net^',
  '||smartadserver.com^',
  '||yieldmo.com^',
  '||adtechus.com^',
  '||serving-sys.com^',
  '||exponential.com^',
  '||adsafeprotected.com^',

  // Trackers & telemetry (third-party only)
  '||hotjar.com^$third-party',
  '||clarity.ms^$third-party',
  '||scorecardresearch.com^$third-party',
  '||quantserve.com^$third-party',

  // YouTube ad endpoints
  '||youtube.com/pagead/*$third-party',
  '||youtube.com/api/stats/ads*$third-party',
  '||youtube.com/get_midroll_info*$third-party',
  '||youtube.com/ptracking*$third-party',

  // googlevideo ad playback streams
  '||googlevideo.com/*$third-party,adformat',
]

const DEFAULT_COSMETIC_RULES = [
  // YouTube ads & promoted sections
  'youtube.com##ytd-ad-slot-renderer',
  'youtube.com##ytd-promoted-video-renderer',
  'youtube.com##ytd-banner-promo-renderer',
  'youtube.com##ytd-player-legacy-desktop-watch-ads-renderer',
  'youtube.com###masthead-ad',
  'youtube.com###player-ads',
  'youtube.com##.ytp-ad-module',
  'youtube.com##.ytp-ad-overlay-container',
  'youtube.com##.video-ads',

  // General banner ads
  '*##ins.adsbygoogle',
  '*##div[id^="google_ads_"]',
  '*##div[id*="_ad_container"]',
  '*##.ad-banner',
  '*##.advertisement'
]
// ══════╈─────────────────────────────────────────────────────────
// RULE COMPILATION & PERSISTENCE
// ╞──────────────────────────────────────────────────────────────

function compileRules(rawRules) {
  const rules = []
  for (const raw of rawRules) {
    const rule = new FilterRule(raw)
    if (rule.enabled) rules.push(rule)
  }
  // Exceptions (@@) first so allowlist takes precedence
  return rules.sort((a, b) => (a.exception ? -1 : b.exception ? 1 : 0))
}

function loadDefaultRules() {
  networkRules = compileRules(DEFAULT_NETWORK_RULES)
  cosmeticRules = DEFAULT_COSMETIC_RULES.map(r => {
    const rule = new FilterRule(r)
    return { host: rule.host, selector: rule.selector, raw: r }
  }).filter(c => c.selector)
}

function loadUserLists() {
  ensureDataDir()
  try {
    if (fs.existsSync(USER_ALLOW_PATH)) {
      const data = JSON.parse(fs.readFileSync(USER_ALLOW_PATH, 'utf8'))
      userAllowHosts = new Set(data || [])
    }
  } catch (e) { userAllowHosts = new Set() }
  try {
    if (fs.existsSync(USER_BLOCK_PATH)) {
      const data = JSON.parse(fs.readFileSync(USER_BLOCK_PATH, 'utf8'))
      userBlockHosts = new Set(data || [])
    }
  } catch (e) { userBlockHosts = new Set() }
}

function saveUserLists() {
  ensureDataDir()
  fs.writeFileSync(USER_ALLOW_PATH, JSON.stringify([...userAllowHosts], null, 2))
  fs.writeFileSync(USER_BLOCK_PATH, JSON.stringify([...userBlockHosts], null, 2))
}

function loadCustomFilters() {
  ensureDataDir()
  try {
    if (fs.existsSync(CUSTOM_FILTERS_PATH)) {
      const lines = fs.readFileSync(CUSTOM_FILTERS_PATH, 'utf8').split('\n')
      const extra = compileRules(lines.filter(l => l.trim() && !l.startsWith('!')))
      networkRules = [...networkRules, ...extra]
      customFiltersVersion = Date.now()
    }
  } catch (e) { /* ignore */ }
}

function addCustomFilter(raw) {
  ensureDataDir()
  fs.appendFileSync(CUSTOM_FILTERS_PATH, raw + '\n')
  const rule = new FilterRule(raw)
  if (rule.cosmetic) {
    cosmeticRules.push({ host: rule.host, selector: rule.selector, raw })
  } else {
    networkRules.push(rule)
  }
  customFiltersVersion = Date.now()
}

function addUserBlockHost(host) {
  host = host.toLowerCase()
  userBlockHosts.add(host)
  saveUserLists()
}

function addUserAllowHost(host) {
  host = host.toLowerCase()
  userAllowHosts.add(host)
  saveUserLists()
}

function removeUserBlockHost(host) {
  userBlockHosts.delete(host.toLowerCase())
  saveUserLists()
}

function removeUserAllowHost(host) {
  userAllowHosts.delete(host.toLowerCase())
  saveUserLists()
}

// Initialize on load
loadDefaultRules()
loadUserLists()
loadCustomFilters()

// ══════╈─────────────────────────────────────────────────────────
// CORE MATCHING LOGIC
// ╞──────────────────────────────────────────────────────────────

function parseUrl(urlString) {
  try { return new URL(urlString) } catch (e) { return null }
}

function isThirdParty(requestUrl, topFrameUrl) {
  if (!topFrameUrl) return false
  const a = parseUrl(requestUrl)
  const b = parseUrl(topFrameUrl)
  if (!a || !b) return false
  return a.hostname !== b.hostname
}

function cacheKey(urlString, resourceType, isThirdParty) {
  return urlString + '|' + (resourceType || 'other') + '|' + isThirdParty
}

function shouldBlockUrl(urlString, topFrameUrl = null, resourceType = 'other') {
  if (!adShieldEnabled) return false
  if (!urlString || typeof urlString !== 'string') return false

  const urlObj = parseUrl(urlString)
  if (!urlObj) return false

  const hostname = urlObj.hostname.toLowerCase()

  // User allowlist always wins
  if (userAllowHosts.has(hostname)) return false

  const tp = topFrameUrl ? isThirdParty(urlString, topFrameUrl) : true
  const key = cacheKey(urlString, resourceType, tp)

  // Check allow cache first (recently allowed)
  const cachedAllow = allowCache.get(key)
  if (cachedAllow === true) return false

  // Check block cache (recently blocked)
  const cachedBlock = blockCache.get(key)
  if (cachedBlock === true) {
    blockedCount++
    return true
  }

  // User blocklist
  if (userBlockHosts.has(hostname)) {
    blockCache.set(key, true)
    blockedCount++
    return true
  }

  // Evaluate network rules (exceptions first due to sort)
  for (const rule of networkRules) {
    if (rule.exception && rule.matchesUrl(urlObj, tp, resourceType)) {
      exceptionCount++
      allowCache.set(key, true)
      return false // exception = allow
    }
    if (!rule.exception && rule.matchesUrl(urlObj, tp, resourceType)) {
      blockCache.set(key, true)
      blockedCount++
      return true
    }
  }

  // No match → allow
  allowCache.set(key, false)
  return false
}

function shouldAllowUrl(urlString, topFrameUrl = null, resourceType = 'other') {
  return !shouldBlockUrl(urlString, topFrameUrl, resourceType)
}

// ══════╈─────────────────────────────────────────────────────────
// COSMETIC ELEMENT HIDING
// ╞──────────────────────────────────────────────────────────────

function getCosmeticCss() {
  let css = ''
  for (const rule of cosmeticRules) {
    const hostPart = rule.host ? rule.host + ' ' : ''
    css += hostPart + rule.selector + ' { display: none !important; visibility: hidden !important; }\n'
  }
  return css
}

const COSMETIC_AD_CSS = getCosmeticCss()

// ══════╈─────────────────────────────────────────────────────────
// YOUTUBE AD SKIP & FAST-FORWARD (injected into renderer)
// ╞──────────────────────────────────────────────────────────────

const YOUTUBE_AD_SKIP_SCRIPT = `(function(){
  'use strict';
  const selectors = ['.ytp-ad-skip-button','.ytp-ad-overlay-close-button','.ytp-ad-dismiss-button','.ytp-ad-text','.ytp-ad-module','.ad-showing'];
  function skip(){
    const video = document.querySelector('video');
    if(video && video.paused===false){
      const ad = document.querySelector('.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-video-container');
      if(ad){
        document.querySelectorAll(selectors.join(',')).forEach(b=>{if(b.offsetParent!==null)b.click();});
        video.playbackRate = 16.0;
      } else {
        video.playbackRate = 1.0;
      }
    }
  }
  setInterval(skip, 300);
  const mo = new MutationObserver(skip);
  mo.observe(document.body||document.documentElement, {childList:true, subtree:true});
})();`

// ══════╈─────────────────────────────────────────────────────────
// ELECTRON SESSION INTEGRATION (network request interception)
// ╞──────────────────────────────────────────────────────────────

let registeredSession = null
let webRequestListenerAttached = false

function registerAdBlockerOnSession(sess) {
  if (!sess || !sess.webRequest) return false
  registeredSession = sess
  if (webRequestListenerAttached) return true

  sess.webRequest.onBeforeRequest(
    (details, callback) => {
      try {
        if (!adShieldEnabled) { callback({ cancel: false }); return }
        const url = details.url || ''
        const resourceType = details.resourceType || 'other'
        const topFrameUrl = details.topFrameUrl || null
        const blocked = shouldBlockUrl(url, topFrameUrl, resourceType)
        callback({ cancel: blocked })
        if (blocked) blockedCount++
      } catch (e) {
        callback({ cancel: false })
      }
    },
    { urls: ['<all_urls>'] }
  )

  webRequestListenerAttached = true
  return true
}

function enableAdBlocker(sess) {
  adShieldEnabled = true
  return registerAdBlockerOnSession(sess)
}

function disableAdBlocker() {
  adShieldEnabled = false
}

function isAdBlockerEnabled() {
  return adShieldEnabled
}

function toggleAdBlocker() {
  adShieldEnabled = !adShieldEnabled
  return adShieldEnabled
}

// ══════╈─────────────────────────────────────────────────────────
// TELEMETRY & STATS
// ╞──────────────────────────────────────────────────────────────

function getStats() {
  return {
    enabled: adShieldEnabled,
    blockedCount,
    allowCount,
    exceptionCount,
    stealthMode,
    customFiltersVersion,
    networkRules: networkRules.length,
    cosmeticRules: cosmeticRules.length,
    userBlockHosts: userBlockHosts.size,
    userAllowHosts: userAllowHosts.size,
    blockCacheHits: blockCache.hits,
    blockCacheMisses: blockCache.misses,
    blockCacheSize: blockCache.cache.size,
    allowCacheHits: allowCache.hits,
    allowCacheMisses: allowCache.misses,
    allowCacheSize: allowCache.cache.size
  }
}

function resetStats() {
  blockedCount = 0
  allowCount = 0
  exceptionCount = 0
  blockCache.hits = 0
  blockCache.misses = 0
  allowCache.hits = 0
  allowCache.misses = 0
}

function clearCaches() {
  blockCache.clear()
  allowCache.clear()
}

// ══════╈─────────────────────────────────────────────────────────
// ADSHIELD INJECTION & STATS
// ╞──────────────────────────────────────────────────────────────

function isAdShieldEnabled() {
  return adShieldEnabled
}

function setAdShieldEnabled(enabled) {
  adShieldEnabled = Boolean(enabled)
  return adShieldEnabled
}

function getAdShieldStats() {
  const s = getStats()
  return {
    blockedCount: s.blockedCount || 0,
    lifetimeBlocked: s.blockedCount || 0,
    patternsLoaded: (s.networkRules || 0) + (s.cosmeticRules || 0),
    rulesLoaded: (s.networkRules || 0) + (s.cosmeticRules || 0),
    enabled: adShieldEnabled,
    ...s
  }
}

function extractHost(urlOrHost) {
  if (!urlOrHost) return ''
  try {
    return new URL(urlOrHost).hostname.toLowerCase()
  } catch {
    return String(urlOrHost).toLowerCase().trim()
  }
}

function isSiteAllowed(urlOrHost) {
  const host = extractHost(urlOrHost)
  return !!host && userAllowHosts.has(host)
}

function injectAdShield(wc) {
  if (!wc || typeof wc.on !== 'function') return
  wc.on('did-finish-load', () => {
    if (wc.isDestroyed() || !isAdShieldEnabled()) return
    const url = (typeof wc.getURL === 'function' ? wc.getURL() : '') || ''
    if (isSiteAllowed(url)) return
    wc.insertCSS(COSMETIC_AD_CSS).catch(() => {})
    if (url.includes('youtube.com')) {
      wc.executeJavaScript(YOUTUBE_AD_SKIP_SCRIPT).catch(() => {})
    }
    if (url.includes('newtab.html')) {
      const stats = getAdShieldStats()
      wc.executeJavaScript(`window.__setShieldStats && window.__setShieldStats(${JSON.stringify({
        blockedCount: stats.blockedCount,
        lifetimeBlocked: stats.lifetimeBlocked,
        rulesLoaded: stats.rulesLoaded,
        enabled: stats.enabled,
      })})`).catch(() => {})
    }
  })
}

// ══════╈─────────────────────────────────────────────────────────
// EXPORTS
// ╞──────────────────────────────────────────────────────────────

module.exports = {
  FilterRule,
  TTLLRUCache,
  shouldBlockUrl,
  shouldAllowUrl,
  getCosmeticCss,
  COSMETIC_AD_CSS,
  YOUTUBE_AD_SKIP_SCRIPT,
  enableAdBlocker,
  disableAdBlocker,
  toggleAdBlocker,
  isAdBlockerEnabled,
  isAdShieldEnabled,
  setAdShieldEnabled,
  getAdShieldStats,
  injectAdShield,
  registerAdBlockerOnSession,
  addCustomFilter,
  addUserBlockHost,
  addUserAllowHost,
  removeUserBlockHost,
  removeUserAllowHost,
  isSiteAllowed,
  getStats,
  resetStats,
  clearCaches,
  blockCache,
  allowCache,
  adShieldEnabled,
  stealthMode
}
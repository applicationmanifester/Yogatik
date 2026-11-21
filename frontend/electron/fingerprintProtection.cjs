// frontend/electron/fingerprintProtection.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint protection with per-session deterministic seeding.
//
// Why per-session seeds?  A fingerprint that changes on every navigation is
// itself a strong detection signal ("canvas fingerprint churn"), and a fresh
// random value per page-load makes sites flag the browser as automated.  We
// therefore derive a stable seed from the session key and reuse it for every
// tab in that session.  When protection is disabled we restore the original
// property values so the page sees the real environment again.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')

// Stable 32-bit PRNG (mulberry32) so the same seed yields the same values
// across navigations within a session.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(str) {
  return crypto.createHash('sha256').update(String(str)).digest().readUInt32BE(0)
}

/**
 * Build the protection script for one tab.  `seed` is a string (usually the
 * session key) and `opts` mirrors CONFIG.fingerprint.
 * Returns the JS source to run in the page.
 */
function buildProtectionScript(seed, opts = {}) {
  const rng = mulberry32(hashSeed(seed))
  const dpr = (1.0 + Math.round(rng() * 3) / 10).toFixed(2)           // 1.0–1.3
  const langs = ['en-US', 'en', 'en-GB', 'fr-FR', 'de-DE', 'es-ES']
  const language = langs[Math.floor(rng() * langs.length)]
  const languages = [language, 'en-US', 'en']
  const plugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: '' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ].slice(0, 1 + Math.floor(rng() * 3))
  const hardwareConcurrency = 4 + Math.floor(rng() * 8)                 // 4–11
  const deviceMemory = [2, 4, 8][Math.floor(rng() * 3)]
  const maxTouchPoints = rng() > 0.7 ? Math.floor(rng() * 5) : 0
  const platform = rng() > 0.5 ? 'Win32' : 'Linux x86_64'
  const vendor = 'Google Inc.'
  const productSub = '20030107'

  return `
(() => {
  // Guard: never double-inject, and remember originals for restore.
  if (window.__yogatikFpActive) return
  if (!window.__yogatikFpOriginals) {
    try {
      window.__yogatikFpOriginals = {
        dpr: window.devicePixelRatio,
        languages: navigator.languages,
        language: navigator.language,
        plugins: navigator.plugins,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        maxTouchPoints: navigator.maxTouchPoints,
        platform: navigator.platform,
        vendor: navigator.vendor,
        productSub: navigator.productSub,
      }
    } catch { window.__yogatikFpOriginals = {} }
  }
  try {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => ${dpr}, configurable: true })
    Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(languages)}, configurable: true })
    Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(language)}, configurable: true })
    Object.defineProperty(navigator, 'plugins', { get: () => ${JSON.stringify(plugins)}, configurable: true })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${hardwareConcurrency}, configurable: true })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${deviceMemory}, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => ${maxTouchPoints}, configurable: true })
    Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(platform)}, configurable: true })
    Object.defineProperty(navigator, 'vendor', { get: () => ${JSON.stringify(vendor)}, configurable: true })
    Object.defineProperty(navigator, 'productSub', { get: () => ${JSON.stringify(productSub)}, configurable: true })
    window.__yogatikFpActive = true
  } catch (e) { /* ignore */ }
})()
`
}

/**
 * Script that restores the original values captured at injection time.
 * Runs in the page; safe even if protection was never injected.
 */
const RESTORE_SCRIPT = `
(() => {
  try {
    const o = window.__yogatikFpOriginals
    if (!o) return
    Object.defineProperty(window, 'devicePixelRatio', { get: () => o.dpr, configurable: true })
    Object.defineProperty(navigator, 'languages', { get: () => o.languages, configurable: true })
    Object.defineProperty(navigator, 'language', { get: () => o.language, configurable: true })
    Object.defineProperty(navigator, 'plugins', { get: () => o.plugins, configurable: true })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => o.hardwareConcurrency, configurable: true })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => o.deviceMemory, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => o.maxTouchPoints, configurable: true })
    Object.defineProperty(navigator, 'platform', { get: () => o.platform, configurable: true })
    Object.defineProperty(navigator, 'vendor', { get: () => o.vendor, configurable: true })
    Object.defineProperty(navigator, 'productSub', { get: () => o.productSub, configurable: true })
    delete window.__yogatikFpActive
    delete window.__yogatikFpOriginals
  } catch (e) { /* ignore */ }
})()
`

/**
 * Inject deterministic fingerprint protection for one tab.
 * @param {Electron.WebContents} webContents
 * @param {string} seed          stable session key
 * @param {object} [opts]        CONFIG.fingerprint
 */
function applyFingerprintProtection(webContents, seed, opts = {}) {
  if (!webContents || webContents.isDestroyed()) return
  try {
    webContents.executeJavaScript(buildProtectionScript(seed, opts), true).catch(() => {})
  } catch { /* view may be destroyed */ }
}

/**
 * Restore original property values for one tab.
 * @param {Electron.WebContents} webContents
 */
function clearFingerprintProtection(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  try {
    webContents.executeJavaScript(RESTORE_SCRIPT, true).catch(() => {})
  } catch { /* view may be destroyed */ }
}

module.exports = {
  applyFingerprintProtection,
  clearFingerprintProtection,
  buildProtectionScript,
  RESTORE_SCRIPT,
  mulberry32,
  hashSeed,
}

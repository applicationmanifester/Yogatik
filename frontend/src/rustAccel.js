/**
 * Native Rust Accelerator Bridge (`yogatik-accel`)
 *
 * Uses the persistent Rust stdio sidecar when running inside Electron Desktop,
 * and falls back transparently to pure JS implementations on Web/Mobile.
 */

import { estimateTokensFromText } from './tokenEstimator'

function rustBridge() {
  return typeof window !== 'undefined' ? window.__YOGATIK_RUST__ : null
}

export function isRustAccelAvailable() {
  return !!rustBridge()
}

/** Fast token estimation using native Rust UTF-8/CJK counter on desktop. */
export async function estimateTokensFast(text) {
  const s = String(text || '')
  if (!s) return { tokens: 0, chars: 0, cjkChars: 0, engine: 'js' }
  const bridge = rustBridge()
  if (bridge?.tokens) {
    try {
      const res = await bridge.tokens(s)
      if (res && typeof res.tokens === 'number') {
        return { ...res, engine: 'rust' }
      }
    } catch { /* fallback to JS */ }
  }
  return {
    tokens: estimateTokensFromText(s),
    chars: s.length,
    cjkChars: 0,
    engine: 'js',
  }
}

/** Fast query intent classification using native Rust on desktop. */
export async function routeQueryFast(query, hasVisual = false) {
  const q = String(query || '')
  const bridge = rustBridge()
  if (bridge?.route) {
    try {
      const res = await bridge.route(q, !!hasVisual)
      if (res?.intent) return { intent: res.intent, engine: 'rust' }
    } catch { /* fallback to JS */ }
  }
  const lower = q.trim().toLowerCase()
  if (!lower) return { intent: 'chat', engine: 'js' }
  if (lower.includes('deep research') || lower.includes('in depth')) {
    return { intent: 'deep_research', engine: 'js' }
  }
  if (hasVisual && /(see|look|camera|screen|holding|this|what is in front)/i.test(lower)) {
    return { intent: 'visual', engine: 'js' }
  }
  if (/(news|weather|price|score|today|latest|search|who won)/i.test(lower)) {
    return { intent: 'search', engine: 'js' }
  }
  if (/(```|function |debug|refactor|compile|typescript|rust|python)/i.test(lower)) {
    return { intent: 'code', engine: 'js' }
  }
  return { intent: 'chat', engine: 'js' }
}

/** Fast top-K cosine similarity ranking for RAG vectors. */
export async function topKSimilarityFast(queryVec, docVecs, k = 5) {
  if (!Array.isArray(queryVec) || !queryVec.length || !Array.isArray(docVecs) || !docVecs.length || k <= 0) {
    return { indices: [], scores: [], engine: 'js' }
  }
  const bridge = rustBridge()
  if (bridge?.topk) {
    try {
      const res = await bridge.topk(queryVec, docVecs, k)
      if (Array.isArray(res?.indices)) {
        return { indices: res.indices, scores: res.scores || [], engine: 'rust' }
      }
    } catch { /* fallback to JS */ }
  }
  const scored = docVecs.map((d, idx) => {
    const n = Math.min(queryVec.length, d.length)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) {
      dot += queryVec[i] * d[i]
      na += queryVec[i] * queryVec[i]
      nb += d[i] * d[i]
    }
    const denom = Math.sqrt(na * nb)
    return { idx, score: denom > 1e-9 ? dot / denom : 0 }
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, k)
  return {
    indices: top.map(x => x.idx),
    scores: top.map(x => x.score),
    engine: 'js',
  }
}

/** Fast acoustic VAD + pitch + emotion + SNR analysis. */
export async function analyzeAudioFast(samples, sampleRate = 16000) {
  if (!samples || !samples.length) {
    return { rms: 0, zcr: 0, pitchHz: 0, snrDb: 0, speechActive: false, emotion: 'calm', confidence: 0, engine: 'js' }
  }
  const bridge = rustBridge()
  if (bridge?.audio) {
    try {
      const res = await bridge.audio(Array.from(samples), sampleRate)
      if (res && typeof res.rms === 'number') return { ...res, engine: 'rust' }
    } catch { /* fallback to JS */ }
  }
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  const rmsVal = Math.sqrt(sumSq / samples.length)
  return {
    rms: rmsVal,
    zcr: 0,
    pitchHz: 0,
    snrDb: rmsVal > 1e-6 ? Math.min(60, Math.max(0, 20 * Math.log10(rmsVal / 0.008))) : 0,
    speechActive: rmsVal > 0.015,
    emotion: 'neutral',
    confidence: 0.5,
    engine: 'js',
  }
}

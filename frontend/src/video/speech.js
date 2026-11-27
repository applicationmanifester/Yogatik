/**
 * Narration for rendered video.
 *
 * The obvious approach — `speechSynthesis` — is a dead end: the Web Speech API
 * writes straight to the audio device and exposes no MediaStream, no buffer,
 * no way to capture what it said. You cannot mux a sound you are not allowed
 * to hold.
 *
 * So the narrator is a real TTS model running on-device: Kokoro-82M (ONNX,
 * Apache-2.0) via kokoro-js, WebGPU with a wasm fallback. It hands back raw
 * Float32 PCM at 24 kHz, which is exactly what an AudioEncoder wants, so the
 * voice can be muxed into the MP4 as a proper AAC track.
 *
 * ~90MB quantised, cached by the browser after the first render.
 */

import { webgpuDevice } from '../gpu'

const KOKORO_CDN = 'https://esm.run/kokoro-js@1.2.1'
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export const SAMPLE_RATE = 24000

/** A useful spread rather than all 28 — the model picks from these. */export const VOICES = {
  af_heart: 'Warm American female (default)',
  af_nova: 'Bright American female',
  af_sky: 'Sky — calm, female',
  af_bella: 'Bella — lively, female',
  af_sarah: 'Sarah — warm, female',
  af_alloy: 'Alloy — warm',
  af_aoede: 'Aoede — expressive',
  af_jessica: 'Jessica — clear',
  af_kore: 'Kore — balanced',
  af_nicole: 'Nicole — warm',
  af_river: 'River — calm',
  am_michael: 'Steady American male',
  am_puck: 'Lively American male',
  am_adam: 'Adam — steady, male',
  am_ryan: 'Ryan — friendly, male',
  am_echo: 'Echo — steady',
  am_fenrir: 'Fenrir — lively',
  am_liam: 'Liam — friendly',
  am_onyx: 'Onyx — deep',
  am_santa: 'Santa — cheerful',
  bf_emma: 'British female',
  bf_lily: 'Lily — British, female',
  bm_george: 'British male',
  bm_lewis: 'Lewis — British, male',
}

/** Short labels for the settings picker. */export const VOICE_LABELS = {
  af_heart: 'Heart — warm, female',
  af_nova: 'Nova — bright, female',
  af_sky: 'Sky — calm, female',
  af_bella: 'Bella — lively, female',
  af_sarah: 'Sarah — warm, female',
  af_alloy: 'Alloy — warm',
  af_aoede: 'Aoede — expressive',
  af_jessica: 'Jessica — clear',
  af_kore: 'Kore — balanced',
  af_nicole: 'Nicole — warm',
  af_river: 'River — calm',
  am_michael: 'Michael — calm, male',
  am_puck: 'Puck — lively, male',
  am_adam: 'Adam — steady, male',
  am_ryan: 'Ryan — friendly, male',
  am_echo: 'Echo — steady',
  am_fenrir: 'Fenrir — lively',
  am_liam: 'Liam — friendly',
  am_onyx: 'Onyx — deep',
  am_santa: 'Santa — cheerful',
  bf_emma: 'Emma — British, female',
  bf_lily: 'Lily — British, female',
  bm_george: 'George — British, male',
  bm_lewis: 'Lewis — British, male',
}

export const DEFAULT_VOICE = 'af_heart'

let tts = null
let loading = null

const CACHE_FLAG = 'yogatik.narrator.cached'

/**
 * Has this browser downloaded the voice before? The weights live in the
 * browser's HTTP cache, which we cannot inspect, so a flag is dropped after the
 * first successful load. Callers use it to decide whether waiting for the
 * neural voice is reasonable (~1-2s from cache) or rude (~90MB cold).
 */
export function narratorCached() {
  try { return localStorage.getItem(CACHE_FLAG) === '1' } catch { return false }
}

export function isNarratorReady() { return !!tts }

export { webgpuDevice }

/** Download + compile. ~90MB on first call, then served from browser cache. */export async function loadNarrator(onProgress) {
  if (tts) return tts
  if (loading) return loading

  loading = (async () => {
    const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO_CDN)
    const device = await webgpuDevice()
    // fp32 on GPU is 4x the download for no audible gain at 24kHz.
    const load = (dev) => KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: dev === 'webgpu' ? 'fp32' : 'q8',
      device: dev,
      progress_callback: onProgress,
    })
    try {
      tts = await load(device)
    } catch (e) {
      // An adapter that exists but cannot compile the graph is common enough
      // (old drivers, virtualised GPUs) that it must not mean "no voice".
      if (device !== 'webgpu') throw e
      tts = await load('wasm')
    }
    try { localStorage.setItem(CACHE_FLAG, '1') } catch { /* private mode */ }
    return tts
  })()

  try { return await loading } finally { loading = null }
}

export function unloadNarrator() { tts = null }

/** Pre-warm the neural narrator in the background during idle time. */export function prewarmNarrator() {
  if (!tts && !loading && narratorCached()) {
    loadNarrator().catch(() => {})
  }
}

/**
 * Speak one line.
 * @returns {Promise<{pcm: Float32Array, sampleRate: number, seconds: number}>}
 */
export async function synthesize(text, { voice = DEFAULT_VOICE, speed = 1, onProgress } = {}) {
  const clean = cleanForSpeech(text)
  if (!clean) return { pcm: new Float32Array(0), sampleRate: SAMPLE_RATE, seconds: 0 }

  const engine = await loadNarrator(onProgress)
  const audio = await engine.generate(clean, {
    voice: VOICES[voice] ? voice : DEFAULT_VOICE,
    speed: Math.min(1.5, Math.max(0.6, speed)),
  })
  const pcm = audio.audio instanceof Float32Array ? audio.audio : new Float32Array(audio.audio)
  const sampleRate = audio.sampling_rate || SAMPLE_RATE
  return { pcm, sampleRate, seconds: pcm.length / sampleRate }
}

/**
 * Split narration into Kokoro-safe chunks (~220 chars max) at sentence then
 * clause boundaries so long paragraphs never hit the 510-phoneme cap or lose
 * prosody.
 * @returns {{text: string, pauseAfterSec: number}[]}
 */
export function splitSpeechChunks(text, maxChars = 220) {
  const clean = cleanForSpeech(text)
  if (!clean) return []

  const sentences = clean
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)

  const chunks = []
  for (const sent of sentences) {
    if (sent.length <= maxChars) {
      chunks.push({ text: sent, pauseAfterSec: 0.14 })
      continue
    }
    // Break long sentences at clause punctuation first, then words.
    const clauses = sent.split(/(?<=[,;:])\s+/).filter(Boolean)
    let buf = ''
    for (const clause of clauses) {
      if (buf && buf.length + 1 + clause.length <= maxChars) {
        buf += ` ${clause}`
      } else {
        if (buf) chunks.push({ text: buf, pauseAfterSec: 0.06 })
        if (clause.length <= maxChars) {
          buf = clause
        } else {
          // Hard word-wrap as last resort
          const words = clause.split(/\s+/)
          let line = ''
          for (const w of words) {
            if (line && line.length + 1 + w.length > maxChars) {
              chunks.push({ text: line, pauseAfterSec: 0.04 })
              line = w
            } else {
              line = line ? `${line} ${w}` : w
            }
          }
          buf = line
        }
      }
    }
    if (buf) chunks.push({ text: buf, pauseAfterSec: 0.14 })
  }

  if (chunks.length) chunks[chunks.length - 1].pauseAfterSec = 0
  return chunks
}

/**
 * Synthesize a full scene's narration chunk-by-chunk, returning stitched PCM
 * and exact measured subtitle cues for each chunk.
 * @returns {Promise<{pcm: Float32Array, sampleRate: number, seconds: number, cues: {text:string, start:number, end:number}[]}>}
 */
export async function synthesizeScene(text, { voice = DEFAULT_VOICE, speed = 1, onProgress, _synthFn } = {}) {
  const chunks = splitSpeechChunks(text)
  if (!chunks.length) {
    return { pcm: new Float32Array(0), sampleRate: SAMPLE_RATE, seconds: 0, cues: [] }
  }

  const synth = _synthFn || synthesize
  const parts = []
  const cues = []
  let sampleRate = SAMPLE_RATE
  let cursorSamples = 0

  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, pauseAfterSec } = chunks[i]
    const res = await synth(chunkText, { voice, speed, onProgress: i === 0 ? onProgress : undefined })
    if (!res?.pcm?.length) continue
    sampleRate = res.sampleRate || sampleRate

    // Apply short 10ms edge fades to prevent clicks at stitch points.
    const fadeN = Math.min(Math.round(0.01 * sampleRate), Math.floor(res.pcm.length / 2))
    const clip = new Float32Array(res.pcm)
    for (let k = 0; k < fadeN; k++) {
      const g = k / fadeN
      clip[k] *= g
      clip[clip.length - 1 - k] *= g
    }

    const startSec = cursorSamples / sampleRate
    const endSec = (cursorSamples + clip.length) / sampleRate
    cues.push({ text: chunkText, start: startSec, end: endSec })
    parts.push(clip)
    cursorSamples += clip.length

    if (pauseAfterSec > 0) {
      const pauseSamples = Math.round(pauseAfterSec * sampleRate)
      if (pauseSamples > 0) {
        parts.push(new Float32Array(pauseSamples))
        cursorSamples += pauseSamples
      }
    }
  }

  const total = new Float32Array(cursorSamples)
  let offset = 0
  for (const p of parts) {
    total.set(p, offset)
    offset += p.length
  }
  return { pcm: total, sampleRate, seconds: cursorSamples / sampleRate, cues }
}

/**
 * Markdown and URLs are unlistenable — the model writes for the eye, so strip
 * what only makes sense on a page before handing it to a voice.
 */
export function cleanForSpeech(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+&\s+/g, ' and ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How long a line will take to say, before we have said it. Used to size
 * scenes when narration is planned but the model has not downloaded yet.
 * ~2.6 words/second is a measured average for Kokoro at speed 1.
 */
export function estimateSpeechSeconds(text, speed = 1) {
  const words = cleanForSpeech(text).split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return (words / 2.6) / (speed || 1)
}
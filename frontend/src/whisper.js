/**
 * On-device speech-to-text via Whisper (Transformers.js). Open (MIT), keyless,
 * offline after the first load. Used as a cross-browser fallback for the Web
 * Speech API, which only exists in Chrome/Edge — this brings dictation to
 * Firefox/Safari too. ~40MB (whisper-base) cached after first use.
 */
import { webgpuDevice } from './gpu'

const CDN = 'https://esm.run/@huggingface/transformers@3.7.6'
const MODEL = 'Xenova/whisper-base'
const TARGET_RATE = 16000

let lib = null
let asr = null
let asrDevice = null
let loading = null
let forceWasm = false

export function isWhisperReady() { return !!asr }

export function isWebGpuError(err) {
  const msg = String(err?.message || err || '')
  return /GPUDevice|GPUBuffer|createBuffer|mappedAtCreation|WebGPU|device lost/i.test(msg)
}

async function getASR(onProgress, { forceCpu = false } = {}) {
  if (forceCpu) {
    forceWasm = true
    if (asr && asrDevice !== 'wasm') {
      asr = null
      asrDevice = null
    }
  }
  if (asr) return asr
  if (loading) return loading
  loading = (async () => {
    if (!lib) lib = await import(/* @vite-ignore */ CDN)
    const preferred = (forceWasm || forceCpu)
      ? 'wasm'
      : ((await webgpuDevice()) === 'webgpu' ? 'webgpu' : 'wasm')
    const loadPipeline = async (dev) => {
      const pipe = await lib.pipeline('automatic-speech-recognition', MODEL, {
        device: dev, dtype: dev === 'webgpu' ? 'fp32' : 'q8', progress_callback: onProgress,
      })
      asrDevice = dev
      return pipe
    }
    try {
      asr = await loadPipeline(preferred)
    } catch (err) {
      if (preferred !== 'webgpu') throw err
      forceWasm = true
      asr = await loadPipeline('wasm')
    }
    return asr
  })()
  try { return await loading } finally { loading = null }
}

/** Decode an audio Blob to mono Float32 at 16 kHz (what Whisper expects). */
export async function blobToPcm(blob) {
  const buf = await blob.arrayBuffer()
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const tmp = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await tmp.decodeAudioData(buf)
  tmp.close?.()
  // Resample to 16k mono via an OfflineAudioContext.
  const frames = Math.ceil(decoded.duration * TARGET_RATE)
  const off = new Ctx(1, frames, TARGET_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0)
}

let queuePromise = Promise.resolve()

/** Transcribe an audio Blob to text, entirely on-device. */
export function transcribe(blob, { lang, onProgress } = {}) {
  const task = async () => {
    const pcm = await blobToPcm(blob)
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: lang && !/^en/i.test(lang) ? lang.split('-')[0] : undefined,
    }
    let engine = await getASR(onProgress)
    try {
      const out = await engine(pcm, opts)
      return (out?.text || '').trim()
    } catch (err) {
      if (asrDevice === 'webgpu' && isWebGpuError(err)) {
        engine = await getASR(onProgress, { forceCpu: true })
        const out = await engine(pcm, opts)
        return (out?.text || '').trim()
      }
      throw err
    }
  }

  // Chain sequentially to guarantee ONNX/WebGPU sessions never run concurrently
  const next = queuePromise.then(task, task)
  queuePromise = next.catch(() => {})
  return next
}

/**
 * Object detection and zero-shot labelling, on device.
 *
 * Two models, loaded from esm.run exactly like localVLM.js so that a user who
 * never turns this on pays nothing for it:
 *
 *   CLIP  — answers "what KIND of thing is this?" against any list of labels
 *           you hand it. There is no training step and no fixed vocabulary, so
 *           "a screenshot of a video player" is as answerable as "a dog".
 *   DETR  — answers "what things are in it and where?" with boxes and counts.
 *
 * Downloads are a decision, not a fallback: nothing here runs until the user
 * has switched it on, the same rule localVLM learned the hard way when the
 * blind-model path started pulling 230MB with nothing on screen to say so.
 */

import { webgpuDevice } from '../gpu'

const CDN = 'https://esm.run/@huggingface/transformers@3.7.6'

export const DETECTORS = {
  clip: {
    id: 'Xenova/clip-vit-base-patch32',
    task: 'zero-shot-image-classification',
    label: 'CLIP (zero-shot labels)',
    sizeMB: 90,
    note: 'Names what kind of image it is against any labels you supply.',
  },
  detr: {
    id: 'Xenova/detr-resnet-50',
    task: 'object-detection',
    label: 'DETR (object detection)',
    sizeMB: 40,
    note: 'Finds and counts objects, with positions.',
  },
}

/**
 * The default question put to CLIP. Deliberately covers the SURFACES this app
 * meets — screenshots of software — as well as ordinary photo subjects,
 * because "screenshot of a video player" is exactly the answer that was
 * missing when a video-player screenshot produced "10 » | 41 PLEY".
 */
export const DEFAULT_LABELS = [
  'a screenshot of a video player or streaming service',
  'a screenshot of a code editor or terminal',
  'a screenshot of a web browser',
  'a screenshot of a chat or messaging app',
  'a screenshot of a spreadsheet or data table',
  'a screenshot of a settings or configuration screen',
  'a screenshot of an error message or crash dialog',
  'a chart, graph or data visualisation',
  'a diagram, flowchart or architecture drawing',
  'a scanned document or page of printed text',
  'a handwritten note',
  'a photograph of people',
  'a photograph of an outdoor scene or landscape',
  'a photograph of food',
  'a photograph of a product or object on a plain background',
  'a photograph of an animal',
  'a map',
  'a poster, book cover or album art',
  'a user interface mockup or design',
  'a meme or image with overlaid caption text',
]

let lib = null
const pipes = new Map()
const loading = new Map()
let consented = false
let forceWasm = false

export function isWebGpuError(err) {
  const msg = String(err?.message || err || '')
  return /GPUDevice|GPUBuffer|createBuffer|mappedAtCreation|WebGPU|device lost/i.test(msg)
}

/** App mirrors the `localVision` feature toggle in here, as for the VLM. */
export function setDetectorConsent(v) { consented = !!v }
export function hasDetectorConsent() { return consented }

async function getLib() {
  if (!lib) lib = await import(/* @vite-ignore */ CDN)
  return lib
}

/** True once the weights are in the Transformers.js cache — then it is free. */
export async function isDetectorCached(key) {
  const spec = DETECTORS[key]
  if (!spec || typeof caches === 'undefined') return false
  try {
    for (const name of await caches.keys()) {
      if (!/transformers/i.test(name)) continue
      const cache = await caches.open(name)
      if ((await cache.keys()).some(r => r.url.includes(spec.id))) return true
    }
  } catch { /* opaque storage: assume not cached */ }
  return false
}

async function getPipeline(key, { onProgress, forceCpu = false } = {}) {
  const spec = DETECTORS[key]
  if (!spec) throw new Error(`Unknown detector: ${key}`)
  if (forceCpu) {
    forceWasm = true
    pipes.delete(key)
  }
  if (pipes.has(key)) return pipes.get(key)
  if (loading.has(key)) return loading.get(key)

  if (!consented && !(await isDetectorCached(key))) {
    throw new Error(
      `On-device ${spec.label} needs a one-time ${spec.sizeMB}MB download. ` +
      'Turn on "On-device vision" in Personalise to allow it.',
    )
  }

  const job = (async () => {
    const { pipeline } = await getLib()
    const preferred = (forceWasm || forceCpu)
      ? 'wasm'
      : ((await webgpuDevice()) === 'webgpu' ? 'webgpu' : 'wasm')
    const load = async (dev) => pipeline(spec.task, spec.id, {
      device: dev,
      dtype: dev === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: onProgress,
    })
    let pipe
    try {
      pipe = await load(preferred)
    } catch (err) {
      if (preferred !== 'webgpu') throw err
      forceWasm = true
      pipe = await load('wasm')
    }
    pipes.set(key, pipe)
    return pipe
  })()
  loading.set(key, job)
  try { return await job } finally { loading.delete(key) }
}

/** Maximum pixel length of the long edge sent to DETR/CLIP. */
export const INFERENCE_MAX_EDGE = 320

/**
 * Compute the target canvas dimensions so the longest edge ≤ maxEdge,
 * preserving aspect ratio and rounding to even numbers (JPEG chroma).
 */
export function fitInferenceDimensions(w, h, maxEdge = INFERENCE_MAX_EDGE) {
  if (!w || !h || w <= 0 || h <= 0) return { width: 0, height: 0, scaled: false }
  const longEdge = Math.max(w, h)
  if (longEdge <= maxEdge) return { width: w, height: h, scaled: false }
  const ratio = maxEdge / longEdge
  return {
    width: Math.max(2, Math.round(w * ratio / 2) * 2),
    height: Math.max(2, Math.round(h * ratio / 2) * 2),
    scaled: true,
  }
}

/**
 * Return a small JPEG data URL (≤ INFERENCE_MAX_EDGE px on the long edge) ready
 * for DETR/CLIP inference, or the original value unchanged if it cannot be
 * decoded (tainted canvas, non-image object, server-side render). The helper
 * is intentionally bullet-proof: it must never turn a working detection call
 * into a failing one; worst case it simply does nothing.
 *
 * @returns {Promise<unknown>} a small JPEG data URL, or the input unchanged
 */
export async function downscaleForInference(image, maxEdge = INFERENCE_MAX_EDGE) {
  if (!image || typeof document === 'undefined') return image

  let source
  try {
    if (typeof image === 'string') {
      // Only attempt things that look like loadable images; leave RawImage
      // JSON strings and stray values alone.
      if (!/^(data:|blob:|https?:|\/)/i.test(image)) return image
      source = await loadImageElement(image)
    } else if (
      (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
      (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
      (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) ||
      (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
    ) {
      source = image
    } else {
      return image
    }

    const width = source.naturalWidth || source.videoWidth || source.width || 0
    const height = source.naturalHeight || source.videoHeight || source.height || 0
    const fit = fitInferenceDimensions(width, height, maxEdge)
    if (!fit.width || !fit.height) return image

    const canvas = document.createElement('canvas')
    canvas.width = fit.width
    canvas.height = fit.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return image
    ctx.drawImage(source, 0, 0, fit.width, fit.height)

    const out = canvas.toDataURL('image/jpeg', 0.8)
    return out || image
  } catch {
    // A tainted canvas or an undecodable source is not worth failing the turn over.
    return image
  }
}

async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for detection: ' + String(src).slice(0, 80)))
    img.src = src
  })
}

/**
 * "What kind of image is this?" — scored against a label list.
 * @returns {Promise<Array<{label, score}>>} best first
 */
export async function classifyZeroShot(image, labels = DEFAULT_LABELS, opts = {}) {
  const pipe = await getPipeline('clip', opts)
  const prepared = await downscaleForInference(image)
  const out = await pipe(prepared, labels)
  return (Array.isArray(out) ? out : [])
    .map(r => ({ label: r.label, score: Number(r.score) }))
    .sort((a, b) => b.score - a.score)
}

function boxArea(box) {
  if (!box) return 0
  return Math.max(0, (box.xmax ?? 0) - (box.xmin ?? 0)) * Math.max(0, (box.ymax ?? 0) - (box.ymin ?? 0))
}

function boxOverlap(a, b) {
  if (!a || !b) return { iou: 0, containment: 0 }
  const ix1 = Math.max(a.xmin ?? 0, b.xmin ?? 0)
  const iy1 = Math.max(a.ymin ?? 0, b.ymin ?? 0)
  const ix2 = Math.min(a.xmax ?? 0, b.xmax ?? 0)
  const iy2 = Math.min(a.ymax ?? 0, b.ymax ?? 0)
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  if (inter <= 0) return { iou: 0, containment: 0 }
  const areaA = boxArea(a)
  const areaB = boxArea(b)
  const union = areaA + areaB - inter
  const minArea = Math.min(areaA, areaB)
  return {
    iou: union > 0 ? inter / union : 0,
    containment: minArea > 0 ? inter / minArea : 0,
  }
}

/**
 * Per-class Non-Maximum Suppression (NMS) for DETR detections.
 * Suppresses overlapping or nested duplicate boxes for the same label so the
 * Object HUD never stacks 3-4 identical "COUCH" tags on one object.
 */
export function deduplicateDetections(objects = [], { iouThreshold = 0.45, containmentThreshold = 0.8, maxDetections = 8 } = {}) {
  if (!Array.isArray(objects) || objects.length === 0) return []
  const sorted = [...objects].sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))
  const kept = []
  for (const det of sorted) {
    if (!det || !det.box) continue
    const label = String(det.label || '').toLowerCase()
    const duplicate = kept.some((existing) => {
      if (String(existing.label || '').toLowerCase() !== label) return false
      const { iou, containment } = boxOverlap(existing.box, det.box)
      return iou >= iouThreshold || containment >= containmentThreshold
    })
    if (!duplicate) {
      kept.push(det)
      if (kept.length >= maxDetections) break
    }
  }
  return kept
}

/**
 * Normalize a detection bounding box to clamped [0, 1] coordinates.
 * Handles both 0..1 fractions and 0..100 percentages from Transformers.js.
 */
export function normalizeBox(box) {
  if (!box || typeof box !== 'object') return { xmin: 0, ymin: 0, xmax: 0, ymax: 0 }
  let { xmin = 0, ymin = 0, xmax = 0, ymax = 0 } = box
  const maxVal = Math.max(xmin, ymin, xmax, ymax)
  if (maxVal > 1.05) {
    xmin /= 100
    ymin /= 100
    xmax /= 100
    ymax /= 100
  }
  const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  const nx1 = clamp(xmin)
  const ny1 = clamp(ymin)
  const nx2 = clamp(xmax)
  const ny2 = clamp(ymax)
  return {
    xmin: Math.min(nx1, nx2),
    ymin: Math.min(ny1, ny2),
    xmax: Math.max(nx1, nx2),
    ymax: Math.max(ny1, ny2),
  }
}

/**
 * Temporal box smoothing + hysteresis for live HUD detections.
 * Smooths jittering coordinates via EMA and retains briefly missed boxes
 * for `maxMissed` ticks so the HUD stays steady.
 */
export function smoothDetections(
  prev = [],
  next = [],
  { alpha = 0.65, iouThreshold = 0.3, maxMissed = 1 } = {},
) {
  const prevList = Array.isArray(prev) ? prev : []
  const nextList = Array.isArray(next) ? next : []
  const matchedPrev = new Set()
  const out = []

  for (const det of nextList) {
    if (!det || !det.box) continue
    const label = String(det.label || '').toLowerCase()
    let bestIdx = -1
    let bestIou = iouThreshold
    for (let i = 0; i < prevList.length; i++) {
      if (matchedPrev.has(i)) continue
      const p = prevList[i]
      if (!p?.box || String(p.label || '').toLowerCase() !== label) continue
      const { iou } = boxOverlap(p.box, det.box)
      if (iou >= bestIou) {
        bestIou = iou
        bestIdx = i
      }
    }
    if (bestIdx !== -1) {
      matchedPrev.add(bestIdx)
      const pBox = prevList[bestIdx].box
      const nBox = det.box
      out.push({
        ...det,
        box: {
          xmin: pBox.xmin + alpha * (nBox.xmin - pBox.xmin),
          ymin: pBox.ymin + alpha * (nBox.ymin - pBox.ymin),
          xmax: pBox.xmax + alpha * (nBox.xmax - pBox.xmax),
          ymax: pBox.ymax + alpha * (nBox.ymax - pBox.ymax),
        },
        _missed: 0,
      })
    } else {
      out.push({ ...det, _missed: 0 })
    }
  }

  for (let i = 0; i < prevList.length; i++) {
    if (matchedPrev.has(i)) continue
    const p = prevList[i]
    const missed = (p?._missed || 0) + 1
    if (p?.box && missed <= maxMissed) {
      out.push({ ...p, score: (p.score ?? 0.5) * 0.9, _missed: missed })
    }
  }

  return deduplicateDetections(out)
}

/**
 * "What is in it, and where?"
 * @returns {Promise<Array<{label, score, box}>>}
 */
export async function detectObjects(image, { threshold = 0.5, ...opts } = {}) {
  let pipe = await getPipeline('detr', opts)
  // Downscale first: boxes are percentages, so they still map to the full frame.
  const prepared = await downscaleForInference(image)
  let out
  try {
    out = await pipe(prepared, { threshold, percentage: true })
  } catch (err) {
    if (!forceWasm && isWebGpuError(err)) {
      pipe = await getPipeline('detr', { ...opts, forceCpu: true })
      out = await pipe(prepared, { threshold, percentage: true })
    } else {
      throw err
    }
  }
  const mapped = (Array.isArray(out) ? out : []).map(r => ({
    label: r.label,
    score: Number(r.score),
    box: normalizeBox(r.box),
  }))
  return deduplicateDetections(mapped)
}

/** Group detections into "3 people, 1 laptop" — what a person would say. */
export function summariseDetections(objects = []) {
  if (!objects.length) return ''
  const counts = new Map()
  for (const o of objects) counts.set(o.label, (counts.get(o.label) || 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => (n === 1 ? `a ${label}` : `${n} ${label}s`))
    .join(', ')
}

/** Where in the frame something sits, in words rather than coordinates. */
export function describePosition(box) {
  if (!box) return ''
  const cx = ((box.xmin ?? 0) + (box.xmax ?? 0)) / 2
  const cy = ((box.ymin ?? 0) + (box.ymax ?? 0)) / 2
  const h = cx < 0.33 ? 'left' : cx > 0.66 ? 'right' : 'centre'
  const v = cy < 0.33 ? 'top' : cy > 0.66 ? 'bottom' : 'middle'
  return v === 'middle' && h === 'centre' ? 'centre' : `${v} ${h}`
}

export function _resetDetectors() { pipes.clear(); loading.clear(); consented = false; forceWasm = false }

export {
  createSessionObjectMemory,
  recordDetections,
  getActiveObjects,
  resolveReference,
  formatSpatialContext,
  clearSessionObjectMemory,
} from './sessionObjectMemory'

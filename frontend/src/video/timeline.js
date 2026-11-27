/**
 * Video timeline — pure geometry and timing, no canvas, no encoder.
 *
 * Everything here is deterministic and unit-testable: the renderer asks
 * "what should frame N look like" and gets back a scene plus its progress.
 * That is what makes offline (faster-than-realtime) encoding possible.
 */

export const LIMITS = {
  minEdge: 256, maxEdge: 1920,
  minFps: 12, maxFps: 60,
  minSceneSec: 0.5, maxSceneSec: 30,
  maxTotalSec: 180,
  maxScenes: 40,
}

export const THEME = {
  bg: '#0e1116',
  bgAlt: '#161b22',
  fg: '#f2f4f8',
  dim: '#9aa4b2',
  accent: '#ff6b35',
  accent2: '#3b82f6',
  font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
}

export const THEMES = {
  dark: THEME,
  light: {
    bg: '#f8fafc',
    bgAlt: '#e2e8f0',
    fg: '#0f172a',
    dim: '#475569',
    accent: '#2563eb',
    accent2: '#7c3aed',
    font: THEME.font,
  },
  ocean: {
    bg: '#071426',
    bgAlt: '#0d2137',
    fg: '#f0f9ff',
    dim: '#7dd3fc',
    accent: '#06b6d4',
    accent2: '#3b82f6',
    font: THEME.font,
  },
  emerald: {
    bg: '#061812',
    bgAlt: '#0d281f',
    fg: '#ecfdf5',
    dim: '#6ee7b7',
    accent: '#10b981',
    accent2: '#14b8a6',
    font: THEME.font,
  },
  sunset: {
    bg: '#1a0f18',
    bgAlt: '#2d1624',
    fg: '#fff1f2',
    dim: '#fda4af',
    accent: '#f97316',
    accent2: '#ec4899',
    font: THEME.font,
  },
  midnight: {
    bg: '#09090b',
    bgAlt: '#18181b',
    fg: '#fafafa',
    dim: '#a1a1aa',
    accent: '#8b5cf6',
    accent2: '#ec4899',
    font: THEME.font,
  },
  cyberpunk: {
    bg: '#090014',
    bgAlt: '#1a0333',
    fg: '#f8fafc',
    dim: '#e879f9',
    accent: '#00f5d4',
    accent2: '#f72585',
    font: THEME.font,
  },
  pastel: {
    bg: '#fef6e4',
    bgAlt: '#f3d2c1',
    fg: '#172c66',
    dim: '#5c6b9c',
    accent: '#f582ae',
    accent2: '#8bd3dd',
    font: THEME.font,
  },
  retro: {
    bg: '#1c1917',
    bgAlt: '#292524',
    fg: '#fef3c7',
    dim: '#d6d3d1',
    accent: '#f59e0b',
    accent2: '#ef4444',
    font: THEME.font,
  },
  forest: {
    bg: '#071a0e',
    bgAlt: '#11331e',
    fg: '#f0fdf4',
    dim: '#86efac',
    accent: '#4ade80',
    accent2: '#facc15',
    font: THEME.font,
  },
  crimson: {
    bg: '#16070a',
    bgAlt: '#2b0b12',
    fg: '#fff1f2',
    dim: '#fda4af',
    accent: '#f43f5e',
    accent2: '#fb923c',
    font: THEME.font,
  },
  gold: {
    bg: '#0c0a09',
    bgAlt: '#1c1917',
    fg: '#fefce8',
    dim: '#d6d3d1',
    accent: '#eab308',
    accent2: '#f59e0b',
    font: THEME.font,
  },
}

export const ASPECT_FORMATS = {
  '16:9': { width: 1280, height: 720 },
  landscape: { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  shorts: { width: 720, height: 1280 },
  vertical: { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  square: { width: 1080, height: 1080 },
  '4:3': { width: 1024, height: 768 },
  '21:9': { width: 1344, height: 576 },
  cinema: { width: 1344, height: 576 },
}

export const ANIMATION_STYLES = ['flat', 'neon', 'cartoon', 'blueprint', 'retro', 'sketch']
export const TRANSITION_TYPES = ['fade', 'cut', 'slide-left', 'slide-up', 'wipe', 'zoom']

const DEFAULT_SECONDS = {
  title: 3,
  text: 4.5,
  image: 4,
  split: 5,
  steps: 5,
  animation: 6,
  bars: 5,
  outro: 2.5,
  quote: 4,
  metric: 3.5,
}
export const SCENE_TYPES = Object.keys(DEFAULT_SECONDS)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** Encoders want even dimensions; odd ones fail on H.264 chroma subsampling. */
const even = (n) => Math.round(n / 2) * 2

/** Normalise, clamp and validate an author-supplied spec. Throws on garbage. */
// Fields a scene may legitimately carry. Anything else is a model guessing at
// the shape, and naming it back is far more useful than ignoring it.
const KNOWN_SCENE_FIELDS = new Set([
  'type', 'duration', 'narration', 'voice', 'speed', 'text', 'subtitle', 'heading',
  'bullets', 'steps', 'image_url', 'url', 'caption', 'motion', 'align', 'data',
  'quote', 'author', 'metric', 'label',
  'environment', 'actors', 'particles', 'gravity', 'style',
])
const CONTENT_FIELDS = [
  'text', 'subtitle', 'heading', 'bullets', 'steps', 'image_url', 'url', 'caption', 'data',
  'quote', 'author', 'metric', 'label', 'actors', 'particles', 'environment',
]

export function normalizeSpec(spec = {}) {
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : []
  if (!scenes.length) throw new Error('A video needs at least one scene.')
  if (scenes.length > LIMITS.maxScenes) throw new Error(`Too many scenes (max ${LIMITS.maxScenes}).`)

  const fps = clamp(Math.round(spec.fps || 30), LIMITS.minFps, LIMITS.maxFps)
  const ratioPreset = ASPECT_FORMATS[String(spec.aspect_ratio || spec.ratio || spec.preset || '').toLowerCase()]
    || (spec.format && spec.format !== 'mp4' && spec.format !== 'webm' ? ASPECT_FORMATS[String(spec.format).toLowerCase()] : null)
  const width = even(clamp(Math.round(spec.width || ratioPreset?.width || 1280), LIMITS.minEdge, LIMITS.maxEdge))
  const height = even(clamp(Math.round(spec.height || ratioPreset?.height || 720), LIMITS.minEdge, LIMITS.maxEdge))

  let cursor = 0
  const out = []
  for (const [i, raw] of scenes.entries()) {
    // A scene with neither a type nor any content used to default to an empty
    // "text" scene: it rendered BLANK, reported success, and taught a guessing
    // model nothing — which is how one field-reported render turned into ten
    // rounds of increasingly desperate arguments. Fail loudly and say what a
    // scene actually looks like.
    const hasType = raw?.type != null && String(raw.type).trim() !== ''
    const hasContent = CONTENT_FIELDS.some((k) => {
      const v = raw?.[k]
      return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ''
    })
    if (!hasType && !hasContent) {
      const unknown = Object.keys(raw || {}).filter((k) => !KNOWN_SCENE_FIELDS.has(k))
      const named = unknown.length
        ? ` Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`
        : ''
      throw new Error(
        `Scene ${i + 1}: nothing to show.${named} Every scene needs a type ` +
        `(${SCENE_TYPES.join(', ')}) and its own content — for example ` +
        `{"type":"title","text":"Hello"} or {"type":"text","heading":"Why","bullets":["a","b"]}.`,
      )
    }

    const type = String(raw?.type || 'text').toLowerCase()
    if (!SCENE_TYPES.includes(type)) {
      throw new Error(`Scene ${i + 1}: unknown type "${type}". Use one of ${SCENE_TYPES.join(', ')}.`)
    }
    if (type === 'image' && !raw.image_url && !raw.url) {
      throw new Error(`Scene ${i + 1}: an image scene needs image_url.`)
    }
    if (type === 'bars' && !Array.isArray(raw.data)) {
      throw new Error(`Scene ${i + 1}: a bars scene needs data: [{label, value}].`)
    }

    const seconds = clamp(
      Number(raw.duration) || DEFAULT_SECONDS[type],
      LIMITS.minSceneSec, LIMITS.maxSceneSec,
    )
    const frames = Math.max(1, Math.round(seconds * fps))
    if ((cursor + frames) / fps > LIMITS.maxTotalSec) {
      throw new Error(`Video is longer than ${LIMITS.maxTotalSec}s — split it into parts.`)
    }
    out.push({
      ...raw,
      type,
      seconds: frames / fps,
      frames,
      startFrame: cursor,
      endFrame: cursor + frames,   // exclusive
    })
    cursor += frames
  }

  const resolvedTheme = typeof spec.theme === 'string'
    ? (THEMES[spec.theme] || THEME)
    : { ...THEME, ...(spec.theme || {}) }

  const transition = TRANSITION_TYPES.includes(spec.transition) ? spec.transition : 'fade'
  const style = ANIMATION_STYLES.includes(spec.style) ? spec.style : 'flat'

  return {
    width, height, fps,
    format: spec.format === 'webm' ? 'webm' : 'mp4',
    theme: resolvedTheme,
    style,
    transition,
    fade: transition === 'cut' ? 0 : clamp(Number(spec.fade ?? 0.35), 0, 1),
    progressBar: spec.progress !== false,
    scenes: out,
    totalFrames: cursor,
    durationSec: cursor / fps,
  }
}

/**
 * Which scene is on screen at this frame, how far through it we are, and how
 * much to dim it for the cross-fade at the seam.
 * @returns {{scene:object, index:number, t:number, alpha:number, prev?:{scene:object, index:number, t:number}}}
 */
export function frameAt(spec, frame) {
  const f = clamp(frame, 0, spec.totalFrames - 1)
  let index = spec.scenes.findIndex(s => f >= s.startFrame && f < s.endFrame)
  if (index < 0) index = spec.scenes.length - 1
  const scene = spec.scenes[index]
  const local = f - scene.startFrame
  const t = scene.frames <= 1 ? 1 : local / (scene.frames - 1)

  let alpha = 1
  let prev = null
  const fadeFrames = Math.round(spec.fade * spec.fps)
  if (fadeFrames > 0) {
    // Fade in at the start of every scene, out at the end of the last one.
    if (local < fadeFrames) {
      alpha = local / fadeFrames
      if (index > 0) {
        const prevScene = spec.scenes[index - 1]
        prev = { scene: prevScene, index: index - 1, t: 1 }
      }
    }
    const tail = scene.frames - 1 - local
    if (index === spec.scenes.length - 1 && tail < fadeFrames) {
      alpha = Math.min(alpha, tail / fadeFrames)
    }
  }
  return prev ? { scene, index, t, alpha: clamp(alpha, 0, 1), prev } : { scene, index, t, alpha: clamp(alpha, 0, 1) }
}

// ─── Easing ───
export const ease = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
}

/**
 * Progress of the k-th item when items appear one after another over `span`
 * of the scene, each taking `hold` to arrive.
 */
export function stagger(t, index, count, { span = 0.6, hold = 0.25 } = {}) {
  if (count <= 0) return 1
  const step = count > 1 ? span / count : 0
  return clamp((t - index * step) / hold, 0, 1)
}

/**
 * Greedy word wrap. `measure` is injected so this stays testable without a
 * canvas, and so it works identically for any font.
 */
export function wrapText(text, maxWidth, measure) {
  const out = []
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = words[0]
    for (const w of words.slice(1)) {
      if (measure(`${line} ${w}`) <= maxWidth) line += ` ${w}`
      else { out.push(line); line = w }
    }
    out.push(line)
  }
  return out
}

/** Ken Burns: a slow push and drift, so a still image does not look frozen. */
export function kenBurns(t, motion = 'in') {
  const e = ease.inOut(t)
  switch (motion) {
    case 'none': return { scale: 1, dx: 0, dy: 0 }
    case 'out': return { scale: 1.1 - 0.1 * e, dx: 0, dy: 0 }
    case 'left': return { scale: 1.08, dx: -0.04 + 0.08 * e, dy: 0 }
    case 'right': return { scale: 1.08, dx: 0.04 - 0.08 * e, dy: 0 }
    case 'up': return { scale: 1.08, dx: 0, dy: 0.04 - 0.08 * e }
    default: return { scale: 1 + 0.1 * e, dx: 0, dy: 0.02 * e }
  }
}

/** Cover-fit a source rect into a destination rect, then scale/pan it. */
export function coverFit(sw, sh, dw, dh, { scale = 1, dx = 0, dy = 0 } = {}) {
  const s = Math.max(dw / sw, dh / sh) * scale
  const w = sw * s
  const h = sh * s
  return { x: (dw - w) / 2 + dx * dw, y: (dh - h) / 2 + dy * dh, w, h }
}

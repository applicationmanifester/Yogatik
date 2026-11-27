/**
 * Audio timeline — pure Float32 PCM arithmetic, no AudioContext.
 *
 * Every clip comes from the same engine at the same sample rate, so laying the
 * narration onto the video's timeline is a copy at an offset. Keeping it pure
 * (no Web Audio) means it is unit-testable and works inside a worker.
 */

/**
 * Lay clips onto a silent bed of `durationSec`.
 * @param {{pcm: Float32Array, startSec: number}[]} clips
 * @returns {Float32Array}
 */
export function mixPcm(clips, sampleRate, durationSec) {
  const total = Math.max(0, Math.ceil(durationSec * sampleRate))
  const out = new Float32Array(total)
  for (const { pcm, startSec } of clips) {
    if (!pcm?.length) continue
    const start = Math.max(0, Math.round((startSec || 0) * sampleRate))
    const n = Math.min(pcm.length, total - start)
    for (let i = 0; i < n; i++) out[start + i] += pcm[i]
  }
  // Only touch the gain if summed clips actually clipped.
  let peak = 0
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a }
  if (peak > 1) { const g = 1 / peak; for (let i = 0; i < out.length; i++) out[i] *= g }
  return out
}

/** Short fades so a clip does not begin or end on a click. */
export function applyEdgeFades(pcm, sampleRate, ms = 12) {
  const n = Math.min(Math.round((ms / 1000) * sampleRate), Math.floor(pcm.length / 2))
  for (let i = 0; i < n; i++) {
    const g = i / n
    pcm[i] *= g
    pcm[pcm.length - 1 - i] *= g
  }
  return pcm
}

/**
 * Normalize active speech loudness to a consistent target RMS with a smooth
 * soft-knee peak limiter so different voices sit evenly above background music.
 */
export function normalizeSpeechPcm(pcm, { targetRms = 0.18, maxGain = 3.5, ceiling = 0.92 } = {}) {
  if (!pcm?.length) return pcm
  let sumSq = 0
  let active = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    if (Math.abs(v) > 0.01) {
      sumSq += v * v
      active++
    }
  }
  if (!active) return new Float32Array(pcm)

  const rms = Math.sqrt(sumSq / active)
  const gain = Math.min(maxGain, Math.max(0.25, targetRms / Math.max(rms, 1e-5)))
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i] * gain
    const ax = Math.abs(x)
    if (ax <= ceiling) {
      out[i] = x
    } else {
      // Soft-knee saturation above ceiling up to 0.99
      const excess = ax - ceiling
      const head = 0.99 - ceiling
      out[i] = Math.sign(x) * (ceiling + head * Math.tanh(excess / head))
    }
  }
  return out
}

/**
 * Where each scene's narration starts, and how long the scenes must be to fit
 * it. Pure: the renderer calls this with measured clip lengths, the planner
 * calls it with estimates.
 *
 * @param {{seconds:number, speechSec:number}[]} scenes
 * @param {{lead?:number, tail?:number}} pad silence before/after each line
 * @returns {{durations:number[], starts:number[], totalSec:number}}
 */
export function planNarration(scenes, { lead = 0.35, tail = 0.45 } = {}) {
  const durations = []
  const starts = []
  let cursor = 0
  for (const s of scenes) {
    const speech = s.speechSec || 0
    // A scene never gets shorter than the author asked, only longer, and only
    // by as much as the voice needs.
    const seconds = speech > 0 ? Math.max(s.seconds || 0, lead + speech + tail) : (s.seconds || 0)
    starts.push(speech > 0 ? cursor + lead : null)
    durations.push(seconds)
    cursor += seconds
  }
  return { durations, starts, totalSec: cursor }
}

/**
 * Split narration into caption-sized chunks and give each one the slice of the
 * scene it is spoken in — burnt-in subtitles, since the MP4 carries no
 * subtitle track and the audio alone leaves deaf viewers nothing.
 */
export function captionCues(text, seconds) {
  const parts = String(text ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
  if (!parts.length || !(seconds > 0)) return []

  const weights = parts.map(p => Math.max(1, p.length))
  const total = weights.reduce((a, b) => a + b, 0)
  let t = 0
  return parts.map((text, i) => {
    const dur = (weights[i] / total) * seconds
    const cue = { text, start: t, end: t + dur }
    t += dur
    return cue
  })
}

/** The cue visible at `t` seconds into the scene. */
export function cueAt(cues, t) {
  return cues.find(c => t >= c.start && t < c.end) || cues[cues.length - 1] || null
}

/**
 * Synthesize a lightweight procedural background music bed (pure Float32 PCM,
 * no Web Audio). Supports 'ambient' (warm harmonic pad) and 'march' (rhythmic
 * story-short pulse inspired by claude-animated-shorts).
 */
export function synthesizeBed(durationSec, sampleRate, { style = 'ambient', gain = 0.14 } = {}) {
  const total = Math.max(0, Math.ceil(durationSec * sampleRate))
  const out = new Float32Array(total)
  if (!total || !(sampleRate > 0)) return out

  const isMarch = style === 'march'
  const isUpbeat = style === 'upbeat'
  const bpm = isMarch ? 112 : isUpbeat ? 124 : 76
  const beatSec = 60 / bpm
  // C major / A minor warm triad progression (Hz)
  const chords = isMarch
    ? [[130.81, 196.0, 261.63], [146.83, 220.0, 293.66], [164.81, 246.94, 329.63], [130.81, 196.0, 261.63]]
    : isUpbeat
      ? [[130.81, 164.81, 196.0, 261.63], [174.61, 220.0, 261.63, 349.23], [196.0, 246.94, 293.66, 392.0], [164.81, 196.0, 246.94, 329.63]]
      : [[130.81, 164.81, 196.0], [110.0, 164.81, 220.0], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]]

  for (let i = 0; i < total; i++) {
    const t = i / sampleRate
    const barIdx = Math.floor(t / (beatSec * 4)) % chords.length
    const chord = chords[barIdx]
    let pad = 0
    for (let k = 0; k < chord.length; k++) {
      pad += Math.sin(2 * Math.PI * chord[k] * t) * (k === 0 ? 0.45 : 0.22)
      // Subtle 2nd harmonic warmth
      pad += Math.sin(2 * Math.PI * chord[k] * 2 * t) * 0.06
    }
    const beatPhase = (t % beatSec) / beatSec
    if (isUpbeat) {
      // Gentle arpeggiated pluck on eighth notes
      const eighthIdx = Math.floor((t % (beatSec * 2)) / (beatSec * 0.5)) % chord.length
      const eighthPhase = (t % (beatSec * 0.5)) / (beatSec * 0.5)
      const pluck = Math.sin(2 * Math.PI * chord[eighthIdx] * 2 * t) * Math.exp(-eighthPhase * 5) * 0.35
      pad = pad * 0.65 + pluck
    }
    const pulse = isMarch
      ? Math.exp(-beatPhase * 7) * 0.45 + 0.55
      : isUpbeat
        ? Math.exp(-beatPhase * 4) * 0.3 + 0.7
        : 0.78 + 0.22 * Math.sin(2 * Math.PI * (t / (beatSec * 2)))
    out[i] = pad * pulse * gain
  }
  return applyEdgeFades(out, sampleRate, 250)
}

/**
 * Synthesize a short, soft transition chime/whoosh for scene cuts.
 */
export function synthesizeTransitionSfx(sampleRate, { durationSec = 0.24, gain = 0.16 } = {}) {
  const n = Math.max(1, Math.round(durationSec * sampleRate))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i / n
    const env = Math.sin(Math.PI * p) * (1 - p * 0.4)
    const freq = 520 + 260 * p
    out[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate)) * env * gain
  }
  return applyEdgeFades(out, sampleRate, 15)
}

/**
 * Duck a background PCM bed smoothly during active speech windows.
 * @param {Float32Array} bed
 * @param {{startSec:number, endSec:number}[]} speechRanges
 * @param {number} sampleRate
 * @param {{duckGain?:number, fadeSec?:number}} opts
 */
export function duckPcm(bed, speechRanges, sampleRate, { duckGain = 0.25, fadeSec = 0.18 } = {}) {
  const out = new Float32Array(bed)
  if (!out.length || !speechRanges?.length) return out

  const fadeSamples = Math.max(1, Math.round(fadeSec * sampleRate))
  const gains = new Float32Array(out.length).fill(1)

  for (const { startSec, endSec } of speechRanges) {
    const s0 = Math.max(0, Math.round(startSec * sampleRate) - fadeSamples)
    const s1 = Math.max(s0, Math.round(startSec * sampleRate))
    const e0 = Math.min(out.length, Math.round(endSec * sampleRate))
    const e1 = Math.min(out.length, e0 + fadeSamples)

    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / Math.max(1, s1 - s0)
      const g = 1 - (1 - duckGain) * (0.5 - 0.5 * Math.cos(Math.PI * t))
      if (g < gains[i]) gains[i] = g
    }
    for (let i = s1; i < e0; i++) {
      if (duckGain < gains[i]) gains[i] = duckGain
    }
    for (let i = e0; i < e1; i++) {
      const t = (i - e0) / Math.max(1, e1 - e0)
      const g = duckGain + (1 - duckGain) * (0.5 - 0.5 * Math.cos(Math.PI * t))
      if (g < gains[i]) gains[i] = g
    }
  }

  for (let i = 0; i < out.length; i++) out[i] *= gains[i]
  return out
}

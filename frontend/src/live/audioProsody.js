/**
 * Real-time Voice Prosody, VAD & Acoustic Emotion Analyzer.
 *
 * Mirrors the `yogatik-accel` Rust DSP kernel in pure TypedArray math for
 * zero-latency browser/Electron renderer execution (sub-millisecond per 1024-sample frame).
 */

/**
 * Analyze an f32 PCM audio buffer for speech activity, pitch (F0), energy, and tone.
 * @param {Float32Array|number[]} samples
 * @param {number} [sampleRate=16000]
 * @returns {{ rms: number, zcr: number, pitchHz: number, speechActive: boolean, emotion: string, confidence: number }}
 */
export function analyzeVoiceProsody(samples, sampleRate = 16000) {
  if (!samples || samples.length === 0 || !sampleRate) {
    return { rms: 0, zcr: 0, pitchHz: 0, speechActive: false, emotion: 'calm', confidence: 0 }
  }

  const n = samples.length
  let sumSq = 0
  let crossings = 0
  let prev = samples[0]

  for (let i = 0; i < n; i++) {
    const s = samples[i]
    sumSq += s * s
    if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) crossings++
    prev = s
  }

  const rms = Math.sqrt(sumSq / n)
  const zcr = crossings / n
  const speechActive = rms > 0.015 && zcr < 0.45

  let pitchHz = 0
  if (speechActive && n > 256) {
    const minLag = Math.max(2, (sampleRate / 400) | 0)
    const maxLag = Math.min((n / 2) | 0, (sampleRate / 80) | 0)
    const win = Math.min(n, 1024)
    let bestCorr = 0
    let bestLag = 0

    for (let lag = minLag; lag <= maxLag; lag++) {
      const limit = win - lag
      if (limit < 32) break
      let num = 0
      let denA = 0
      let denB = 0
      for (let i = 0; i < limit; i++) {
        const a = samples[i]
        const b = samples[i + lag]
        num += a * b
        denA += a * a
        denB += b * b
      }
      const denom = Math.sqrt(denA * denB)
      if (denom > 1e-6) {
        const corr = num / denom
        if (corr > bestCorr) {
          bestCorr = corr
          bestLag = lag
        } else if (bestCorr > 0.85 && corr < bestCorr - 0.02) {
          break
        }
      }
    }
    if (bestCorr > 0.45 && bestLag > 0) {
      pitchHz = sampleRate / bestLag
    }
  }

  let emotion = 'neutral'
  let confidence = 0.65
  if (!speechActive) {
    emotion = 'calm'
    confidence = 0.5
  } else if (rms > 0.14 && pitchHz > 210) {
    emotion = 'excited'
    confidence = 0.78
  } else if (rms > 0.12 && zcr > 0.16) {
    emotion = 'urgent'
    confidence = 0.74
  } else if (pitchHz > 185) {
    emotion = 'curious'
    confidence = 0.68
  } else if (rms < 0.045 && pitchHz > 0 && pitchHz < 135) {
    emotion = 'calm'
    confidence = 0.72
  }

  return { rms, zcr, pitchHz, speechActive, emotion, confidence }
}

/**
 * Smooth prosody emotion across recent speech frames using majority/weighted vote.
 * @param {Array<{emotion:string, confidence:number}>} history
 * @returns {{ emotion: string, confidence: number } | null}
 */
export function summarizeVoiceEmotion(history = []) {
  if (!history || history.length === 0) return null
  const scores = Object.create(null)
  for (const item of history) {
    if (!item?.emotion) continue
    scores[item.emotion] = (scores[item.emotion] || 0) + (item.confidence || 0.5)
  }
  let best = null
  let bestScore = -1
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      best = emotion
    }
  }
  if (!best) return null
  return { emotion: best, confidence: Math.min(0.95, bestScore / history.length) }
}

/**
 * Adaptive ambient noise-floor tracker for cleaner VAD and barge-in gating.
 * Slowly tracks background room noise when speech is inactive and provides
 * a dynamic RMS threshold above the room floor.
 */
export function createAdaptiveNoiseGate({ initialFloor = 0.012, margin = 2.2 } = {}) {
  let noiseFloor = initialFloor
  return {
    update(rms, isSpeech = false) {
      if (!isSpeech && Number.isFinite(rms) && rms >= 0) {
        noiseFloor = noiseFloor * 0.92 + Math.min(rms, 0.08) * 0.08
      }
      const threshold = Math.max(0.014, noiseFloor * margin)
      return {
        noiseFloor,
        threshold,
        isAboveGate: rms > threshold,
      }
    },
    get floor() {
      return noiseFloor
    },
  }
}

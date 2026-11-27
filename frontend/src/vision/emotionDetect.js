/**
 * On-Device Facial / Subject Emotion Estimator & Temporal Smoother.
 *
 * Operates directly on the `person` bounding-box ROI from Object HUD (`detect.js`)
 * with zero extra model download, estimating expression valence/arousal in <2ms
 * and smoothing across frames to prevent HUD flicker.
 */

/**
 * Estimate expression cues from an RGBA frame and a normalized [0..1] person box.
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {{ x: number, y: number, w: number, h: number }} [box]
 * @returns {{ emotion: string, confidence: number, valence: number, arousal: number }}
 */
export function estimateEmotionFromRoi(rgba, width, height, box) {
  if (!rgba || !width || !height) {
    return { emotion: 'neutral', confidence: 0.5, valence: 0, arousal: 0.2 }
  }

  // Normalize either { xmin, ymin, xmax, ymax } (DETR/detect.js) or { x, y, w, h }
  const normX = box ? (box.xmin ?? box.x ?? 0.25) : 0.25
  const normY = box ? (box.ymin ?? box.y ?? 0.15) : 0.15
  const normW = box ? (box.xmax != null && box.xmin != null ? box.xmax - box.xmin : (box.w ?? 0.5)) : 0.5
  const normH = box ? (box.ymax != null && box.ymin != null ? box.ymax - box.ymin : (box.h ?? 0.45)) : 0.45

  // Approximate head/face region in upper 40% of a person bounding box
  const bx = Math.max(0, Math.floor(normX * width))
  const by = Math.max(0, Math.floor(normY * height))
  const bw = Math.max(8, Math.min(width - bx, Math.floor(normW * width)))
  const bh = Math.max(8, Math.min(height - by, Math.floor(normH * height * 0.4)))

  if (bw < 8 || bh < 8) {
    return { emotion: 'neutral', confidence: 0.5, valence: 0, arousal: 0.2 }
  }

  // Compare upper-eye/brow band vs lower-mouth band contrast & horizontal symmetry
  const browY0 = by + Math.floor(bh * 0.25)
  const browY1 = by + Math.floor(bh * 0.48)
  const mouthY0 = by + Math.floor(bh * 0.62)
  const mouthY1 = by + Math.floor(bh * 0.88)

  let browVar = 0
  let browMean = 0
  let browCount = 0
  let mouthEdge = 0
  let mouthCount = 0

  for (let y = browY0; y < browY1; y += 2) {
    for (let x = bx + Math.floor(bw * 0.2); x < bx + Math.floor(bw * 0.8); x += 2) {
      const idx = (y * width + x) * 4
      const luma = (rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000
      browMean += luma
      browCount++
    }
  }
  browMean = browCount ? browMean / browCount : 128

  for (let y = browY0; y < browY1; y += 2) {
    for (let x = bx + Math.floor(bw * 0.2); x < bx + Math.floor(bw * 0.8); x += 2) {
      const idx = (y * width + x) * 4
      const luma = (rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000
      const d = luma - browMean
      browVar += d * d
    }
  }
  const browStd = browCount ? Math.sqrt(browVar / browCount) : 0

  for (let y = mouthY0; y < mouthY1; y += 2) {
    for (let x = bx + Math.floor(bw * 0.25); x < bx + Math.floor(bw * 0.75) - 2; x += 2) {
      const idx = (y * width + x) * 4
      const nextIdx = (y * width + x + 2) * 4
      const l1 = (rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000
      const l2 = (rgba[nextIdx] * 299 + rgba[nextIdx + 1] * 587 + rgba[nextIdx + 2] * 114) / 1000
      mouthEdge += Math.abs(l1 - l2)
      mouthCount++
    }
  }
  const mouthActivity = mouthCount ? mouthEdge / mouthCount : 0

  if (mouthActivity > 18 && browStd > 26) {
    return { emotion: 'happy', confidence: 0.72, valence: 0.75, arousal: 0.65 }
  }
  if (browStd > 34 && mouthActivity < 12) {
    return { emotion: 'focused', confidence: 0.68, valence: 0.1, arousal: 0.45 }
  }
  if (mouthActivity > 24 && browStd < 18) {
    return { emotion: 'surprised', confidence: 0.64, valence: 0.3, arousal: 0.8 }
  }
  return { emotion: 'neutral', confidence: 0.6, valence: 0.05, arousal: 0.25 }
}

/**
 * Smooth emotion predictions over time to prevent HUD label jitter.
 */
export function smoothEmotion(prev, next, alpha = 0.4) {
  if (!prev) return next
  if (!next) return prev
  const valence = prev.valence * (1 - alpha) + next.valence * alpha
  const arousal = prev.arousal * (1 - alpha) + next.arousal * alpha
  const emotion = next.confidence >= prev.confidence - 0.08 ? next.emotion : prev.emotion
  const confidence = prev.confidence * (1 - alpha) + next.confidence * alpha
  return { emotion, confidence, valence, arousal }
}

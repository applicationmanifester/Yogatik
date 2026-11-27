import { describe, it, expect } from 'vitest'
import { estimateEmotionFromRoi, smoothEmotion } from './emotionDetect'

describe('emotionDetect', () => {
  it('returns neutral fallback for empty input', () => {
    const res = estimateEmotionFromRoi(null, 0, 0)
    expect(res.emotion).toBe('neutral')
  })

  it('estimates emotion from synthetic RGBA ROI and smooths across frames', () => {
    const w = 80
    const h = 80
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const v = ((x + y) % 4 === 0) ? 220 : 40
        rgba[i] = v
        rgba[i + 1] = v
        rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    const e1 = estimateEmotionFromRoi(rgba, w, h, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(e1.confidence).toBeGreaterThan(0.5)
    const smoothed = smoothEmotion({ emotion: 'neutral', confidence: 0.6, valence: 0, arousal: 0.2 }, e1, 0.5)
    expect(smoothed.emotion).toBe(e1.emotion)
  })
})

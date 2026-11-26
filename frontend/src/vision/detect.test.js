/**
 * Guards for the inference downscale added to vision/detect.js.
 *
 * The DETR/CLIP path used to receive a full 768px live frame on every tick;
 * INTERNAL_TECH_DEBT P0 #3 asked for a 320px cap. These tests pin the geometry
 * and — critically — the guarantee that the helper is SAFE: it must never throw
 * and must hand back anything it cannot decode, so a working detection call can
 * never be broken by it.
 */
import { describe, it, expect } from 'vitest'
import {
  fitInferenceDimensions,
  downscaleForInference,
  summariseDetections,
  deduplicateDetections,
  INFERENCE_MAX_EDGE,
} from './detect'

describe('fitInferenceDimensions', () => {
  it('leaves an already-small image untouched', () => {
    expect(fitInferenceDimensions(320, 240)).toEqual({ width: 320, height: 240, scaled: false })
    expect(fitInferenceDimensions(100, 80)).toEqual({ width: 100, height: 80, scaled: false })
  })

  it('caps the long edge at maxEdge for a landscape frame', () => {
    const r = fitInferenceDimensions(768, 576)
    expect(r.scaled).toBe(true)
    expect(r.width).toBe(320)
    expect(Math.abs(r.height - 240)).toBeLessThanOrEqual(1)
    expect(Math.max(r.width, r.height)).toBe(320)
  })

  it('caps the long edge for a portrait frame', () => {
    const r = fitInferenceDimensions(480, 640)
    expect(r.height).toBe(320)
    expect(r.width).toBe(240)
  })

  it('always returns even dimensions (JPEG chroma subsampling)', () => {
    const r = fitInferenceDimensions(1001, 777)
    expect(r.width % 2).toBe(0)
    expect(r.height % 2).toBe(0)
  })

  it('never collapses an extreme aspect ratio to zero height', () => {
    const r = fitInferenceDimensions(4000, 3)
    expect(r.width).toBeLessThanOrEqual(320)
    expect(r.height).toBeGreaterThanOrEqual(2)
  })

  it('returns a zero box for degenerate input rather than NaN', () => {
    expect(fitInferenceDimensions(0, 0)).toEqual({ width: 0, height: 0, scaled: false })
    expect(fitInferenceDimensions(-5, 10)).toEqual({ width: 0, height: 0, scaled: false })
  })

  it('honours a custom maxEdge', () => {
    const r = fitInferenceDimensions(1000, 500, 100)
    expect(r.width).toBe(100)
    expect(r.height).toBe(50)
  })

  it('exports a sane default edge', () => {
    expect(INFERENCE_MAX_EDGE).toBe(320)
  })
})

describe('downscaleForInference', () => {
  it('passes through non-image values untouched', async () => {
    const raw = { rawImage: true }
    expect(await downscaleForInference(raw)).toBe(raw)
    expect(await downscaleForInference(null)).toBe(null)
    expect(await downscaleForInference(123)).toBe(123)
  })

  it('passes through strings that are not loadable image URLs', async () => {
    expect(await downscaleForInference('not-a-url')).toBe('not-a-url')
    expect(await downscaleForInference('')).toBe('')
  })

  it('never throws on junk input', async () => {
    await expect(downscaleForInference([1, 2, 3])).resolves.toEqual([1, 2, 3])
    await expect(downscaleForInference(true)).resolves.toBe(true)
  })
})

describe('summariseDetections', () => {
  it('reads like a person would say it', () => {
    expect(summariseDetections([
      { label: 'person' }, { label: 'person' }, { label: 'laptop' },
    ])).toBe('2 persons, a laptop')
  })

  it('is empty for no detections', () => {
    expect(summariseDetections([])).toBe('')
  })
})

describe('deduplicateDetections', () => {
  it('suppresses overlapping same-label boxes while keeping the highest confidence', () => {
    const out = deduplicateDetections([
      { label: 'couch', score: 0.87, box: { xmin: 0.1, ymin: 0.5, xmax: 0.5, ymax: 0.9 } },
      { label: 'couch', score: 0.89, box: { xmin: 0.11, ymin: 0.51, xmax: 0.52, ymax: 0.91 } },
      { label: 'couch', score: 0.72, box: { xmin: 0.15, ymin: 0.55, xmax: 0.45, ymax: 0.85 } },
      { label: 'person', score: 0.95, box: { xmin: 0.3, ymin: 0.2, xmax: 0.7, ymax: 0.95 } },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ label: 'person', score: 0.95 })
    expect(out[1]).toMatchObject({ label: 'couch', score: 0.89 })
  })

  it('keeps distinct non-overlapping objects of the same class', () => {
    const out = deduplicateDetections([
      { label: 'chair', score: 0.9, box: { xmin: 0.05, ymin: 0.4, xmax: 0.25, ymax: 0.8 } },
      { label: 'chair', score: 0.85, box: { xmin: 0.7, ymin: 0.4, xmax: 0.9, ymax: 0.8 } },
    ])
    expect(out).toHaveLength(2)
  })
})

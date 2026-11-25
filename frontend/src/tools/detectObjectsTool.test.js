import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDetectObjects = vi.fn()
const mockClassifyZeroShot = vi.fn()
const mockOcrExecute = vi.fn()

vi.mock('../vision/detect', () => ({
  detectObjects: (...args) => mockDetectObjects(...args),
  classifyZeroShot: (...args) => mockClassifyZeroShot(...args),
  summariseDetections: (objs) => objs.map(o => `a ${o.label}`).join(', '),
  describePosition: () => 'centre',
}))

vi.mock('./ocr', () => ({
  ocrTool: {
    execute: (...args) => mockOcrExecute(...args),
  },
}))

import { detectObjectsTool } from './detectObjectsTool'

describe('detectObjectsTool', () => {
  beforeEach(() => {
    mockDetectObjects.mockReset()
    mockClassifyZeroShot.mockReset()
    mockOcrExecute.mockReset()
  })

  it('requires image_url', async () => {
    const res = await detectObjectsTool.execute({})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/image_url/i)
  })

  it('runs DETR object detection and optional CLIP + OCR together', async () => {
    mockDetectObjects.mockResolvedValue([
      { label: 'laptop', score: 0.94, box: { xmin: 0.2, ymin: 0.2, xmax: 0.8, ymax: 0.8 } },
    ])
    mockClassifyZeroShot.mockResolvedValue([
      { label: 'desk setup', score: 0.88 },
    ])
    mockOcrExecute.mockResolvedValue({
      success: true,
      reliable: true,
      text: 'Hello World',
      confidence: 92,
    })

    const res = await detectObjectsTool.execute({
      image_url: 'data:image/png;base64,abc',
      labels: ['desk setup', 'kitchen'],
      include_ocr: true,
    })

    expect(res.success).toBe(true)
    expect(res.via).toBe('detr')
    expect(res.object_count).toBe(1)
    expect(res.objects[0]).toMatchObject({ label: 'laptop', position: 'centre' })
    expect(res.classifications[0].label).toBe('desk setup')
    expect(res.ocr).toBe('Hello World')
    expect(res.ocr_reliable).toBe(true)
  })

  it('returns an honest error when DETR fails and blob fallback is disabled', async () => {
    mockDetectObjects.mockRejectedValue(new Error('On-device DETR needs a one-time 40MB download'))

    const res = await detectObjectsTool.execute({
      image_url: 'data:image/png;base64,abc',
      fallback_blobs: false,
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/40MB download/i)
  })
})

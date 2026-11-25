/**
 * `detect_objects` — Semantic object detection, zero-shot scene labelling,
 * and optional OCR in a single tool call.
 *
 * Uses DETR (`vision/detect.js`) for bounding boxes + class labels + counts,
 * optional CLIP zero-shot classification against caller-supplied labels, and
 * optional Tesseract OCR (`tools/ocr.js`) when `include_ocr` is true.
 *
 * All heavy vision/OCR modules are dynamically imported inside `execute()` so
 * they never ride the initial bundle (see `heavyTools.test.js`).
 */

export const detectObjectsTool = {
  schema: {
    name: 'detect_objects',
    description:
      'Detect and count semantic objects (with bounding boxes and spatial positions) in an image using on-device DETR, ' +
      'optionally classify the image against custom labels (CLIP), and optionally extract text (OCR) in the same pass.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL or data URL of the image to inspect',
        },
        threshold: {
          type: 'number',
          description: 'Minimum detection confidence between 0 and 1 (default 0.5)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional zero-shot classification labels to score the image against',
        },
        include_ocr: {
          type: 'boolean',
          description: 'Also run OCR to extract legible text from the image (default false)',
        },
        fallback_blobs: {
          type: 'boolean',
          description: 'If ML object detection is not enabled/cached, fall back to connected-component foreground blobs (default true)',
        },
      },
      required: ['image_url'],
    },
  },

  async execute({
    image_url,
    threshold = 0.5,
    labels = null,
    include_ocr = false,
    fallback_blobs = true,
  } = {}) {
    if (typeof image_url !== 'string' || !image_url.trim()) {
      return { success: false, error: 'image_url is required' }
    }

    const clampedThreshold = Math.min(0.99, Math.max(0.05, Number.isFinite(Number(threshold)) ? Number(threshold) : 0.5))

    const [detectMod, ocrMod] = await Promise.all([
      import('../vision/detect'),
      include_ocr ? import('./ocr') : Promise.resolve(null),
    ])

    const { detectObjects, classifyZeroShot, summariseDetections, describePosition } = detectMod

    let detections = null
    let detectionError = null
    let zeroShot = null

    const [detResult, clipResult, ocrResult] = await Promise.all([
      detectObjects(image_url, { threshold: clampedThreshold }).catch((e) => {
        detectionError = e?.message || String(e)
        return null
      }),
      Array.isArray(labels) && labels.length
        ? classifyZeroShot(image_url, labels).catch(() => null)
        : Promise.resolve(null),
      ocrMod
        ? ocrMod.ocrTool.execute({ image_url }).catch((e) => ({ success: false, error: e?.message || String(e) }))
        : Promise.resolve(null),
    ])

    detections = detResult
    zeroShot = clipResult

    // Honest fallback to connected-component blobs when DETR is unconsented or unavailable
    if (detections === null && fallback_blobs) {
      try {
        const [{ loadImageData }, { connectedComponents }] = await Promise.all([
          import('../vision/imageStats'),
          import('../vision/objectScan'),
        ])
        const loaded = await loadImageData(image_url)
        if (loaded) {
          const { blobs, count, background } = connectedComponents(loaded.rgba, loaded.width, loaded.height, {
            minArea: 100,
            maxBlobs: 30,
          })
          return {
            success: true,
            tool: 'detect_objects',
            via: 'connected-components-fallback',
            note: detectionError
              ? `ML object detection unavailable (${detectionError}); fell back to pixel connected-component regions.`
              : 'Fell back to pixel connected-component regions.',
            object_count: count,
            background,
            objects: blobs.map((b) => ({
              id: b.id,
              label: b.type || 'region',
              box_2d: b.box_2d,
              area: b.area,
              dominantColor: b.dominantColor?.hex,
            })),
            ...(ocrResult ? {
              ocr: ocrResult.reliable ? ocrResult.text : '',
              ocr_confidence: ocrResult.confidence,
              ocr_reliable: !!ocrResult.reliable,
            } : {}),
          }
        }
      } catch { /* fall through to honest error */ }
    }

    if (detections === null) {
      return {
        success: false,
        tool: 'detect_objects',
        error: detectionError || 'Object detection could not process this image.',
        ...(ocrResult ? {
          ocr: ocrResult.reliable ? ocrResult.text : '',
          ocr_confidence: ocrResult.confidence,
          ocr_reliable: !!ocrResult.reliable,
        } : {}),
      }
    }

    const objects = detections.map((d) => ({
      label: d.label,
      score: Math.round(Number(d.score) * 1000) / 1000,
      position: describePosition(d.box),
      box: d.box,
    }))

    return {
      success: true,
      tool: 'detect_objects',
      via: 'detr',
      object_count: objects.length,
      summary: summariseDetections(objects) || 'No objects detected above threshold.',
      objects,
      ...(zeroShot ? { classifications: zeroShot.slice(0, 5) } : {}),
      ...(ocrResult ? {
        ocr: ocrResult.reliable ? ocrResult.text : '',
        ocr_confidence: ocrResult.confidence,
        ocr_reliable: !!ocrResult.reliable,
        ...(ocrResult.low_confidence_text ? { ocr_low_confidence_text: ocrResult.low_confidence_text } : {}),
      } : {}),
    }
  },
}

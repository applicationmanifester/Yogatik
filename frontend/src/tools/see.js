/**
 * `see` — let any model look through the camera (or at the last uploaded image).
 *
 * Four fallbacks, tried in order, so vision is never a single vendor's feature:
 *   1. the active model, if it can take images  -> the frame is handed to it directly
 *   2. Tesseract OCR, for "read this" questions -> exact text beats a small VLM
 *   3. the on-device VLM (SmolVLM, WebGPU)      -> a text observation
 *   4. an honest error
 *
 * Path 1 is decided by the agent, not here: this tool returns the frame and the
 * agent attaches it to the next turn when the model can see.
 */

import { createCamera } from '../live/video'
import {
  getSharedVisualSource, captureProfile, needsMotion, describeWithoutModel,
} from '../vision/source'

let camera = null
let idleTimer = null

/**
 * One shared camera. If a Live call already owns the stream we borrow it —
 * opening a second stream fails on most phones.
 */
async function getSource(facingMode) {
  const live = getSharedVisualSource()
  if (live) return live
  if (!camera || camera.stopped) camera = await createCamera({ facingMode })
  clearTimeout(idleTimer)
  // Release the camera (and its light) when nobody has looked for a while.
  idleTimer = setTimeout(releaseCamera, 60000)
  return camera
}

export function releaseCamera() {
  clearTimeout(idleTimer)
  camera?.close()
  camera = null
}

/** Set by the app when the user attaches an image, so `see` can read that instead. Scoped per conversationId. */
const pendingImages = new Map()
export function setPendingImage(dataUrl, conversationId = 'default') {
  const key = conversationId || 'default'
  if (dataUrl) pendingImages.set(key, dataUrl)
  else pendingImages.delete(key)
}
export function getPendingImage(conversationId = 'default') {
  const key = conversationId || 'default'
  return pendingImages.get(key) || (key !== 'default' ? pendingImages.get('default') : null) || null
}

/**
 * Runtime context the agent injects: whether the chat model itself can see.
 * Scoped per conversationId so concurrent chats on different models (e.g. a
 * vision model in Chat A and a text-only model in Chat B) never overwrite
 * each other.
 */
const DEFAULT_VISION_CTX = { modelCanSee: false, allowLocal: true }
const visionContexts = new Map()
export function setVisionContext(next, conversationId = 'default') {
  const key = conversationId || 'default'
  const prev = visionContexts.get(key) || DEFAULT_VISION_CTX
  visionContexts.set(key, { ...prev, ...next })
}
function getVisionContext(conversationId = 'default') {
  const key = conversationId || 'default'
  return visionContexts.get(key) || visionContexts.get('default') || DEFAULT_VISION_CTX
}

export const seeTool = {
  schema: {
    description:
      'Look through the user\'s camera and answer a question about what is visible. ' +
      'Use for "what am I holding", "what does this say", "how do I look", "what is in front of me". ' +
      'Asks permission the first time. Do not call it for questions that are not about the here and now.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What you want to know about the scene' },
        camera: { type: 'string', enum: ['front', 'back'], description: 'Which camera to use. Default front.' },
      },
      required: ['question'],
    },
  },

  async execute({ question, camera: which = 'front' }, opts = {}) {
    const convId = opts?.ctx?.conversationId || 'default'
    const activeCtx = getVisionContext(convId)
    const images = []
    let image = pendingImages.get(convId) || null
    if (image) {
      // An attached image answers the question it was attached for, once.
      // Leaving it set made every later look return the same stale picture.
      pendingImages.delete(convId)
      images.push(image)
    } else if (convId !== 'default' && pendingImages.has('default')) {
      image = pendingImages.get('default')
      pendingImages.delete('default')
      images.push(image)
    } else {
      try {
        const src = await getSource(which === 'back' ? 'environment' : 'user')
        // force: an explicit request must always produce a frame, even if the
        // scene has not changed since the last look.
        const b64 = src.grab(true, captureProfile(question))
        if (!b64) return { success: false, error: 'The camera returned no frame. It may still be warming up — try once more.' }
        image = `data:image/jpeg;base64,${b64}`
        // "What am I doing / what changed" is not answerable from one still.
        const prev = needsMotion(question) ? src.previousFrame?.() : null
        if (prev) images.push(`data:image/jpeg;base64,${prev}`)
        images.push(image)
      } catch (e) {
        return {
          success: false,
          error: e?.name === 'NotAllowedError'
            ? 'Camera access was denied. Allow it in the browser address bar to let me see.'
            // No mediaDevices at all (insecure origin, or a webview without one)
            // surfaced as a raw "Cannot read properties of undefined".
            : (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)
              ? 'No camera is available here. A camera needs a secure (https) page and a device with one attached.'
              : `Could not open the camera: ${e?.message || e}`,
        }
      }
    }

    // Path 1 — the chat model can see it itself. Hand the pixels up.
    if (activeCtx.modelCanSee) {
      return {
        success: true, tool: 'see', via: 'model',
        image, images, question,
        note: images.length > 1
          ? 'Two frames captured, oldest first — answer from what differs between them.'
          : 'Image captured — answer the question from the image that follows.',
      }
    }

    // Paths 2 and 3 — resolve it without the chat model and pass text up.
    if (activeCtx.allowLocal) {
      try {
        const { via, text, model } = await describeWithoutModel(image, question)
        return {
          success: true, tool: 'see', via,
          image, question, observation: text, model,
          note: via === 'ocr'
            ? 'Text read from the image by OCR. It is verbatim; layout may be scrambled.'
            : 'Observed by the on-device vision model. It is small — trust the broad description more than fine detail.',
        }
      } catch (e) {
        return {
          success: false, image,
          error: `The active model cannot see images, and on-device vision failed: ${e?.message || e}`,
        }
      }
    }

    return {
      success: false, image,
      error: 'No vision available: the current model cannot take images and on-device vision is turned off.',
    }
  },
}

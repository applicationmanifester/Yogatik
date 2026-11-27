/**
 * `video_render` — compose an actual video file in the browser.
 *
 * No key, no backend, no cost: scenes are painted with Canvas2D and encoded
 * with WebCodecs (MP4/H.264), falling back to MediaRecorder (WebM). Pairs with
 * `image_generate` — generate stills, then cut them together with titles,
 * captions and animated charts.
 */

import { normalizeSpec, frameAt, LIMITS, SCENE_TYPES, THEMES } from '../video/timeline'
// NOTE: everything heavy (draw, encode, audio, speech/Kokoro-90MB, image
// fetching, db) is dynamically imported INSIDE execute() so none of it rides
// the initial bundle — first paint pays nothing for a video never rendered.
// VOICES labels are needed for the schema; speech.js's engine itself stays lazy.
import { VOICES, DEFAULT_VOICE } from '../video/speech'

/**
 * Load an image so the canvas stays untainted. A tainted canvas cannot be
 * read back, which fails the encode with an opaque SecurityError. Image-host
 * URLs (Pollinations) go through the rate-gated fetchImage so a multi-scene
 * render doesn't burst into 429s; other URLs try a direct CORS <img> first,
 * then the proxy.
 */
async function loadImage(url) {
  // Dynamic: image fetching rides the render call, not the initial bundle.
  const [{ proxyFetch }] = await Promise.all([import('./http')]).catch(() => [{ proxyFetch: fetch }])
  const { fetchImage } = await import('./imageGen').catch(() => ({}))
  const isImageHost = /(^|\.)pollinations\.ai/i.test((() => { try { return new URL(url).hostname } catch { return '' } })())

  if (isImageHost) {
    // Rate-gated + retried; hand the bytes to the canvas as a blob.
    const resp = await fetchImage(url)
    if (!resp.ok) throw new Error(`Could not load image (${resp.status}): ${url}`)
    const blobUrl = URL.createObjectURL(await resp.blob())
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Unreadable image: ${url}`))
        img.src = blobUrl
      })
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
    }
  }

  const direct = await new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
  if (direct) return direct

  const resp = await proxyFetch(url)
  if (!resp.ok) throw new Error(`Could not load image (${resp.status}): ${url}`)
  const blobUrl = URL.createObjectURL(await resp.blob())
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Unreadable image: ${url}`))
      img.src = blobUrl
    })
  } finally {
    // The decoded bitmap outlives the object URL.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
  }
}

/**
 * Build a Canvas2D draw function for a sprite from its declarative draw type.
 * Painted in body-local space (translate already applied by Sprite.paint).
 */
function makeSpriteDrawFn(type, label, color, fontSize) {
  return (ctx, sprite) => {
    const b = sprite.body
    const r = (b?.radius ?? 20) * sprite.scale
    ctx.fillStyle = color || '#ff6b35'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    switch (type) {
      case 'circle':
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'rect': {
        const w = (b?.width ?? 40) * sprite.scale
        const h = (b?.height ?? 40) * sprite.scale
        ctx.fillRect(-w / 2, -h / 2, w, h)
        break
      }
      case 'text':
        ctx.font = `${fontSize || 24}px sans-serif`
        ctx.fillText(label || sprite.id, 0, 0)
        break
      case 'particle':
        ctx.beginPath()
        ctx.arc(0, 0, 4 * sprite.scale, 0, Math.PI * 2)
        ctx.fill()
        break
      default:
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
    }
  }
}

/**
 * Draw a single sprite onto ctx in canvas/world space.
 * Applies translate(position) -> rotate(rotation) -> scale(scale) then
 * delegates to makeSpriteDrawFn for body-local painting.
 */
function drawSprite(ctx, sprite) {
  if (!sprite || sprite.visible === false) return
  const draw = makeSpriteDrawFn(sprite.drawType ?? 'circle', sprite.label, sprite.color, sprite.fontSize)
  ctx.save()
  ctx.translate(sprite.x ?? 0, sprite.y ?? 0)
  if (sprite.rotation) ctx.rotate(sprite.rotation)
  if (sprite.scale) ctx.scale(sprite.scale, sprite.scale)
  if (sprite.alpha !== undefined) { ctx.globalAlpha = sprite.alpha }
  draw(ctx, sprite)
  ctx.restore()
}

/**
 * Draw many sprites in one pass, skipping hidden ones.
 */
function drawSprites(ctx, sprites) {
  if (!Array.isArray(sprites)) return
  for (const sprite of sprites) {
    if (!sprite || sprite.visible === false) continue
    drawSprite(ctx, sprite)
  }
}

/**
 * Factory for building a declarative sprite descriptor consumed by drawSprite/drawSprites.
 */
function createSprite({ id, x = 0, y = 0, rotation = 0, scale = 1,
                        alpha = 1, visible = true,
                        drawType = 'circle', label,
                        color = '#ff6b35', fontSize = 24,
                        body = {} } = {}) {
  return {
    id: id ?? `sprite-${Math.random().toString(36).slice(2, 9)}`,
    x, y, rotation, scale,
    alpha,
    visible: visible !== false,
    drawType,
    label,
    color,
    fontSize,
    body: { radius: body.radius ?? 20,
            width: body.width ?? 40,
            height: body.height ?? 40 },
  }
}

export const videoRenderTool = {
  schema: {
    description:
      'Render a real video file (MP4) in the browser from a scene list — 2D animations (actors, keyframes, orbits, physics, particles), ' +
      'titles, bullet slides, images with Ken Burns motion, split layouts, numbered steps, and animated bar charts, with cross-dissolves and spoken narration. ' +
      'Free, no API key, runs entirely on the device. IMPORTANT: When the user asks for an animation, cartoon, motion scene, or physics simulation ' +
      '(e.g. bouncing balls, rockets, planets, walking characters), use scene type "animation" with environment, actors, and particles — do NOT just make PPT bullet slides. ' +
      'Give each scene a "narration" line and it is spoken by an on-device voice, subtitled, and stretched to fit.',
    parameters: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          description:
            'Ordered scenes. Each: {type, duration (seconds)} plus its own fields. ' +
            'animation: environment (space|sky|ground|grid|stage), actors[{shape (circle|rect|roundedRect|star|triangle|ring|arrow|line|planet|rocket|stickFigure|car|bird|cloud|wave|text), x, y (0-1 normalized), size, color, label, keyframes[{t, x, y, scale, rotation, opacity}], orbit{cx, cy, radius, speed}, physics:true, vx, vy, bounciness, trail:true, spin, bob{amp, freq}}], particles{type (stars|spark|snow|rain|confetti|bubbles), count, color}. ' +
            'title/outro: text, subtitle. text: heading, bullets[]. ' +
            'image: image_url, caption, motion (in|out|left|right|up|none). ' +
            'split: image_url, heading, bullets[], align (left|right). ' +
            'steps: heading, steps[]. ' +
            'bars: heading, data[{label, value}]. quote: quote, author. metric: metric, label. ' +
            'Any scene may also set voice and speed to override the narrator per scene.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: SCENE_TYPES },
              duration: { type: 'number', description: 'Minimum seconds on screen (0.5-30); grows to fit narration' },
              narration: {
                type: 'string',
                description: 'Spoken narration for this scene. Long text is automatically chunked at sentence boundaries. Plain prose, no markdown.',
              },
              voice: { type: 'string', enum: Object.keys(VOICES), description: 'Optional per-scene voice override for multi-speaker videos' },
              speed: { type: 'number', description: 'Optional per-scene speaking speed (0.6-1.5)' },
              text: { type: 'string' },
              subtitle: { type: 'string' },
              heading: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              steps: { type: 'array', items: { type: 'string' } },
              image_url: { type: 'string' },
              caption: { type: 'string' },
              motion: { type: 'string', enum: ['in', 'out', 'left', 'right', 'up', 'none'] },
              align: { type: 'string', enum: ['left', 'right'], description: 'Image side for split scenes (default left)' },
              quote: { type: 'string' },
              author: { type: 'string' },
              metric: { type: 'string' },
              label: { type: 'string' },
              environment: { type: 'string', enum: ['space', 'sky', 'ground', 'grid', 'stage'] },
              gravity: { type: 'number', description: 'Gravity in px/s^2 for physics actors (default 980)' },
              particles: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['stars', 'spark', 'snow', 'rain', 'confetti', 'bubbles'] },
                  count: { type: 'number' },
                  color: { type: 'string' },
                },
              },
              actors: {
                type: 'array',
                description: 'Animated actors for animation scenes (use normalized 0-1 coordinates for x/y)',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    shape: { type: 'string', enum: ['circle', 'rect', 'roundedRect', 'triangle', 'star', 'ring', 'arrow', 'line', 'planet', 'rocket', 'stickFigure', 'car', 'bird', 'cloud', 'wave', 'text'] },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    size: { type: 'number' },
                    color: { type: 'string' },
                    label: { type: 'string' },
                    text: { type: 'string' },
                    rings: { type: 'boolean' },
                    trail: { type: 'boolean' },
                    physics: { type: 'boolean' },
                    vx: { type: 'number' },
                    vy: { type: 'number' },
                    bounciness: { type: 'number' },
                    spin: { type: 'number' },
                    keyframes: { type: 'array', items: { type: 'object' } },
                    orbit: { type: 'object' },
                    bob: { type: 'object' },
                    pulse: { type: 'object' },
                  },
                },
              },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, value: { type: 'number' } },
                  required: ['label', 'value'],
                },
              },
              /** Physics bodies that persist across frames in this scene. */
              objects: {
                type: 'array',
                description: 'Rigid bodies with mass/velocity that collide and bounce.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    type: { type: 'string', enum: ['circle', 'rect'] },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    radius: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                    mass: { type: 'number' },
                    gravityScale: { type: 'number' },
                    vx: { type: 'number' },
                    vy: { type: 'number' },
                    bounciness: { type: 'number' },
                    friction: { type: 'number' },
                    static: { type: 'boolean' },
                    color: { type: 'string' },
                  },
                  required: ['id', 'x', 'y'],
                },
              },
              /** Sprites bound to bodies; drawn each frame from body state. */
              sprites: {
                type: 'array',
                description: 'Renderable entities bound to a physics body.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    body: { type: 'string' },
                    draw: { type: 'string', enum: ['circle', 'rect', 'text', 'particle'] },
                    label: { type: 'string' },
                    color: { type: 'string' },
                    fontSize: { type: 'number' },
                    alpha: { type: 'number' },
                    scale: { type: 'number' },
                    ttl: { type: 'number', description: 'Seconds before auto-removal' },
                  },
                  required: ['id', 'body', 'draw'],
                },
              },
              /** Action -> reaction -> response event rules for this scene. */
              events: {
                type: 'array',
                description: 'Rules like {on:"collision", if:{bodyA:"ball",bodyB:"floor"}, then:[{type:"applyForce",target:"ball",fy:-400}]}',
                items: {
                  type: 'object',
                  properties: {
                    on: { type: 'string', enum: ['collision', 'wall', 'impulse', 'frame'] },
                    if: { type: 'object' },
                    then: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['applyForce', 'setVelocity', 'spawn', 'remove', 'sleep', 'wake'] },
                          target: { type: 'string' },
                          fx: { type: 'number' },
                          fy: { type: 'number' },
                          vx: { type: 'number' },
                          vy: { type: 'number' },
                          spriteId: { type: 'string' },
                          bodyId: { type: 'string' },
                          atFrame: { type: 'number' },
                        },
                        required: ['type'],
                      },
                    },
                  },
                  required: ['on', 'then'],
                },
              },
            },
            required: ['type'],
          },
        },
        width: { type: 'number', description: 'Default 1280' },
        height: { type: 'number', description: 'Default 720' },
        fps: { type: 'number', description: 'Default 30' },
        quality: {
          type: 'string',
          description: "Encoding quality: 'draft' (small), 'standard' (default), 'high' (sharp text/detail, 1080p) or 'max'. Use 'high' when the video contains text or fine detail.",
        },
        theme: {
          type: 'string',
          enum: Object.keys(THEMES),
          description: `Visual color theme preset (${Object.keys(THEMES).join(', ')}). Default dark.`,
        },
        transition: { type: 'string', enum: ['fade', 'cut'], description: 'Default fade (cross-dissolve between scenes)' },
        voice: {
          type: 'string', enum: Object.keys(VOICES),
          description: `Narrator voice. ${Object.entries(VOICES).map(([k, v]) => `${k}: ${v}`).join('; ')}`,
        },
        speed: { type: 'number', description: 'Speaking speed 0.6-1.5, default 1' },
        narrate: { type: 'boolean', description: 'Set false to render silent even if scenes have narration' },
        soundtrack: {
          type: 'string', enum: ['none', 'ambient', 'march', 'upbeat'],
          description: "Optional procedural background score ('ambient', 'march', or 'upbeat'), automatically ducked under narration. Default 'none'.",
        },
        sfx: { type: 'boolean', description: 'Add subtle transition chimes on scene cuts. Default false.' },
      },
      required: ['scenes'],
    },
  },

  async execute(args) {
    // ─── Narration first: the voice decides how long each scene must be ───
    // Rendering to a fixed duration and hoping the line fits is how you get a
    // sentence cut in half at the cut.
    // Heavy engines load HERE, on first render — never in the initial bundle.
    const [{ paintFrame }, { encodeVideo }, {
      mixPcm, applyEdgeFades, normalizeSpeechPcm, planNarration, captionCues,
      synthesizeBed, synthesizeTransitionSfx, duckPcm,
    }, { synthesizeScene, cleanForSpeech, SAMPLE_RATE }, { saveMedia },
    { World, Body }, { Sprite, WorldSpriteGroup }] = await Promise.all([
      import('../video/draw'),
      import('../video/encode'),
      import('../video/audio'),
      import('../video/speech'),
      import('../db'),
      import('../video/physics'),
      import('../video/sprites'),
    ])
    const wantsSpeech = args.narrate !== false &&
      (args.scenes || []).some(s => cleanForSpeech(s?.narration))
    let clips = []
    let voiceError = null
    const t = { narration_ms: 0, images_ms: 0, encode_ms: 0 }
    const mark = performance.now()

    if (wantsSpeech) {
      try {
        for (const scene of args.scenes) {
          const line = cleanForSpeech(scene?.narration)
          if (!line) { clips.push(null); continue }
          const { pcm, sampleRate, cues } = await synthesizeScene(scene.narration, {
            voice: scene.voice || args.voice,
            speed: scene.speed ?? args.speed,
          })
          const normalized = applyEdgeFades(normalizeSpeechPcm(pcm), sampleRate)
          clips.push({ pcm: normalized, sampleRate, seconds: normalized.length / sampleRate, cues })
        }
      } catch (e) {
        // A voice that will not load must not cost the user their video.
        voiceError = e?.message || String(e)
        clips = []
      }
    }

    t.narration_ms = Math.round(performance.now() - mark)

    const plan = clips.length
      ? planNarration(args.scenes.map((s, i) => ({
        seconds: Number(s.duration) || 0,
        speechSec: clips[i]?.seconds || 0,
      })))
      : null

    let spec
    try {
      spec = normalizeSpec(plan
        ? { ...args, scenes: args.scenes.map((s, i) => ({ ...s, duration: plan.durations[i] })) }
        : args)
    } catch (e) {
      return { success: false, error: e.message }
    }

    // Subtitles are cued against the scene's final length, so they track the
    // voice even after the scene was stretched to fit it.
    let audio = null
    const mixClips = []
    const speechRanges = []
    if (plan) {
      const LEAD = 0.35   // matches planNarration's lead-in
      spec.scenes.forEach((scene, i) => {
        const clip = clips[i]
        if (!clip?.pcm.length) return
        const startSec = scene.startFrame / spec.fps + LEAD
        mixClips.push({ pcm: clip.pcm, startSec })
        speechRanges.push({ startSec, endSec: startSec + clip.seconds })
        // Cues are scene-relative, and the voice starts after the lead-in.
        const rawCues = clip.cues?.length ? clip.cues : captionCues(args.scenes[i].narration, clip.seconds)
        scene._cues = rawCues.map(c => ({ ...c, start: c.start + LEAD, end: c.end + LEAD }))
      })
    }
    const soundtrack = args.soundtrack && args.soundtrack !== 'none' ? args.soundtrack : null
    if (soundtrack) {
      const rawBed = synthesizeBed(spec.durationSec, SAMPLE_RATE, { style: soundtrack })
      const ducked = duckPcm(rawBed, speechRanges, SAMPLE_RATE)
      mixClips.push({ pcm: ducked, startSec: 0 })
    }
    if (args.sfx && spec.scenes.length > 1) {
      const chime = synthesizeTransitionSfx(SAMPLE_RATE)
      for (let i = 1; i < spec.scenes.length; i++) {
        mixClips.push({ pcm: chime, startSec: spec.scenes[i].startFrame / spec.fps })
      }
    }
    if (mixClips.length) {
      audio = {
        pcm: mixPcm(mixClips, SAMPLE_RATE, spec.durationSec),
        sampleRate: SAMPLE_RATE,
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = spec.width
    canvas.height = spec.height
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) return { success: false, error: 'Canvas 2D is unavailable in this browser.' }

    // Decode every image up front: the draw loop is synchronous, and awaiting
    // inside it would stall the encoder queue between frames.
    const imagesAt = performance.now()
    await Promise.all(spec.scenes.map(async (s) => {
      const url = s.image_url || s.url
      if ((s.type === 'image' || s.type === 'split') && url) {
        try {
          s._image = await loadImage(url)
        } catch (imgErr) {
          console.warn('[video_render] Could not load image for scene:', url, imgErr?.message || imgErr)
          s._image = null
        }
      }
    }))

    t.images_ms = Math.round(performance.now() - imagesAt)

    // ── Physics / sprite groups: one WorldSpriteGroup per scene that declares bodies or sprites ──
    const sceneGroups = new Map()
    spec.scenes.forEach((scene, i) => {
      const bodies = scene.bodies || []
      const sprites = scene.sprites || []
      if (!bodies.length && !sprites.length) return
      const world = new World({ boundsW: spec.width, boundsH: spec.height, gravityX: scene.gravityX ?? 0, gravityY: scene.gravityY ?? 980 })
      const group = new WorldSpriteGroup(world)
      world.subSteps = scene.subSteps ?? 8
      // Register event rules (action -> reaction -> response)
      ;(scene.events || []).forEach(rule => group.on(rule))
      // Spawn callback for 'spawn' actions
      group.onSpawn = (action, ev) => {
        if (!action.spriteId && !action.bodyId) return null
        const body = action.bodyId ? world.get(action.bodyId) : null
        const spriteBody = body ?? new Body(action.spriteId ?? `spawn-${i}-${group.frame}`, {
          x: action.x ?? (ev?.bodyA ? world.get(ev.bodyA)?.pos.x : spec.width / 2),
          y: action.y ?? (ev?.bodyA ? world.get(ev.bodyA)?.pos.y : spec.height / 2),
          vx: action.vx ?? 0,
          vy: action.vy ?? 0,
          radius: action.radius ?? 12,
          color: action.color ?? '#ff6b35',
          static: action.static ?? false,
        })
        if (!world.get(spriteBody.id)) world.add(spriteBody)
        return new Sprite(action.spriteId ?? spriteBody.id, spriteBody, makeSpriteDrawFn(action.draw ?? 'circle', action.label ?? spriteBody.id, action.color ?? '#ff6b35', action.fontSize), {
          alpha: action.alpha ?? 1,
          scale: action.scale ?? 1,
          ttl: action.ttl ?? Infinity,
        })
      }
      // Add bodies from scene spec
      bodies.forEach(bdef => {
        const body = new Body(bdef.id, {
          type: bdef.type, x: bdef.x, y: bdef.y, vx: bdef.vx, vy: bdef.vy,
          mass: bdef.mass, gravityScale: bdef.gravityScale, friction: bdef.friction,
          bounciness: bdef.bounciness, static: bdef.static, collidable: bdef.collidable,
          radius: bdef.radius, width: bdef.width, height: bdef.height, color: bdef.color,
        })
        world.add(body)
      })
      // Add sprites bound to bodies
      sprites.forEach(sdef => {
        const body = world.get(sdef.body) || new Body(sdef.body, { x: spec.width / 2, y: spec.height / 2 })
        if (!world.get(sdef.body)) world.add(body)
        group.add(new Sprite(sdef.id, body, makeSpriteDrawFn(sdef.draw, sdef.label, sdef.color, sdef.fontSize), {
          alpha: sdef.alpha, scale: sdef.scale, zIndex: sdef.zIndex ?? 0, ttl: sdef.ttl,
        }))
      })
      sceneGroups.set(i, group)
    })

    const started = performance.now()
    let result
    try {
      result = await encodeVideo({
        canvas,
        totalFrames: spec.totalFrames,
        fps: spec.fps,
        quality: args.quality,
        audio,
        drawFrame: (i) => {
          const sceneIdx = spec.scenes.findIndex(s => i >= s.startFrame && i < s.endFrame)
          const group = sceneIdx >= 0 ? sceneGroups.get(sceneIdx) : null
          const frameTime = frameAt(spec, i)
          if (group) {
            const dt = 1 / spec.fps
            group.step(dt)
            // Apply per-frame impulse forces from event rules marked 'frame'
            ;(spec.scenes[sceneIdx].events || []).filter(e => e.on === 'frame' && e.atFrame == null).forEach(rule => {
              group.runActions(rule.then, { type: 'frame', frame: group.frame })
            })
          }
          paintFrame(ctx, spec, frameTime)
          if (group) group.paint(ctx, frameTime, THEMES[args.theme] || THEMES.dark)
        },
      })
    } catch (e) {
      return {
        success: false,
        error: e?.name === 'AbortError' ? 'Stopped' : `Video encoding failed: ${e?.message || e}`,
      }
    }

    t.encode_ms = Math.round(performance.now() - started)

    const filename = `yogatik-${Date.now()}.${result.mime.includes('mp4') ? 'mp4' : 'webm'}`
    // Store the bytes: a blob: URL is dead after a reload, and the video the
    // user just waited for should still be there tomorrow.
    let mediaId = null
    try {
      mediaId = await saveMedia({ blob: result.blob, mime: result.mime, filename })
    } catch (e) {
      console.warn('Could not store the rendered video:', e)
    }

    return {
      success: true,
      tool: 'video_render',
      media_id: mediaId,
      // Playable now; the card re-creates it from media_id after a reload.
      video_url: URL.createObjectURL(result.blob),
      filename,
      mime: result.mime,
      encoder: result.encoder,
      duration_sec: Number(spec.durationSec.toFixed(2)),
      frames: spec.totalFrames,
      resolution: `${spec.width}x${spec.height}`,
      fps: spec.fps,
      bytes: result.blob.size,
      render_ms: t.encode_ms,
      timings: t,
      scenes: spec.scenes.map(s => ({ type: s.type, seconds: Number(s.seconds.toFixed(2)) })),
      narrated: !!result.audio,
      audio_codec: result.audio || null,
      voice: result.audio ? (VOICES[args.voice] ? args.voice : DEFAULT_VOICE) : null,
      ...(voiceError ? { warning: `Narration unavailable, rendered silent: ${voiceError}` } : {}),
      // The app renders a player and a download button from media_id; the model
      // has no URL to quote and must not invent one.
      display: 'The video is already shown to the user with a player and a download button. Do not print a link.',
      note: `Rendered on-device (${result.encoder}). Max ${LIMITS.maxTotalSec}s per video.` +
        (result.audio
          ? ' Narrated by the on-device voice, with burnt-in subtitles; scene lengths were stretched to fit each line.'
          : ' Silent — add a narration field to a scene to have it spoken.'),
    }
  },
}

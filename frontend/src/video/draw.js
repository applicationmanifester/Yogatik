/**
 * Scene painters — everything is drawn with Canvas2D, once per frame, from the
 * timeline's (scene, t) pair. No DOM, no animation loop: the encoder decides
 * when frames happen, so a 60s video can render in a few seconds.
 */

import { ease, stagger, wrapText, kenBurns, coverFit } from './timeline'
import { cueAt } from './audio'
import { drawAnimation } from './animate'

const px = (n) => `${Math.round(n)}px`

function fitFont(ctx, text, { max, min, weight, family, maxWidth, maxLines = 3 }) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${px(size)} ${family}`
    const lines = wrapText(text, maxWidth, (s) => ctx.measureText(s).width)
    if (lines.length <= maxLines) return { size, lines }
  }
  ctx.font = `${weight} ${px(min)} ${family}`
  return { size: min, lines: wrapText(text, maxWidth, (s) => ctx.measureText(s).width).slice(0, maxLines) }
}

function background(ctx, W, H, theme, t) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, theme.bg)
  g.addColorStop(1, theme.bgAlt)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // A slow accent glow keeps flat colour from looking like a broken player.
  const cx = W * (0.25 + 0.5 * ease.inOut(t))
  const glow = ctx.createRadialGradient(cx, H * 0.15, 0, cx, H * 0.15, Math.max(W, H) * 0.7)
  glow.addColorStop(0, `${theme.accent}22`)
  glow.addColorStop(1, '#00000000')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Secondary drifting orb for subtle depth
  const bx = W * (0.78 - 0.25 * ease.inOut(t))
  const by = H * (0.75 + 0.08 * Math.sin(t * Math.PI))
  const orb = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(W, H) * 0.45)
  orb.addColorStop(0, `${theme.accent2}1a`)
  orb.addColorStop(1, '#00000000')
  ctx.fillStyle = orb
  ctx.fillRect(0, 0, W, H)

  // Faint geometric corner ring
  ctx.strokeStyle = `${theme.dim}0d`
  ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.002)
  ctx.beginPath()
  ctx.arc(W * 0.92, H * 0.12, Math.min(W, H) * (0.18 + 0.02 * Math.sin(t * Math.PI)), 0, Math.PI * 2)
  ctx.stroke()
}

function drawTitle(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const pad = W * 0.1
  const rise = (1 - ease.out(Math.min(1, t * 3))) * H * 0.04

  const { size, lines } = fitFont(ctx, scene.text || '', {
    max: S * 0.13, min: S * 0.055, weight: '700', family: theme.font, maxWidth: W - pad * 2, maxLines: 3,
  })
  const lh = size * 1.18
  const subSize = size * 0.36
  const blockH = lines.length * lh + (scene.subtitle ? subSize * 2 : 0)
  let y = (H - blockH) / 2 + size * 0.8 + rise

  ctx.textAlign = 'center'
  ctx.fillStyle = theme.fg
  ctx.font = `700 ${px(size)} ${theme.font}`
  for (const line of lines) { ctx.fillText(line, W / 2, y); y += lh }

  if (scene.subtitle) {
    const sub = fitFont(ctx, scene.subtitle, {
      max: subSize, min: Math.max(14, S * 0.028), weight: '400', family: theme.font, maxWidth: W - pad * 2, maxLines: 2,
    })
    ctx.fillStyle = theme.dim
    ctx.font = `400 ${px(sub.size)} ${theme.font}`
    let sy = y + sub.size * 0.6
    for (const line of sub.lines) { ctx.fillText(line, W / 2, sy); sy += sub.size * 1.25 }
  }

  // Accent rule that draws itself in.
  const w = W * 0.18 * ease.out(Math.min(1, t * 2.5))
  ctx.fillStyle = theme.accent
  ctx.fillRect((W - w) / 2, (H - blockH) / 2 - size * 0.6, w, Math.max(3, S * 0.006))
}

function drawText(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const pad = W * 0.09
  let y = H * 0.22

  if (scene.heading) {
    const { size, lines } = fitFont(ctx, scene.heading, {
      max: S * 0.09, min: S * 0.048, weight: '700', family: theme.font, maxWidth: W - pad * 2, maxLines: 2,
    })
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    ctx.font = `700 ${px(size)} ${theme.font}`
    for (const line of lines) { ctx.fillText(line, pad, y); y += size * 1.2 }
    ctx.fillStyle = theme.accent
    ctx.fillRect(pad, y - size * 0.5, W * 0.12, Math.max(3, S * 0.005))
    y += size * 0.5
  }

  const items = (Array.isArray(scene.bullets) ? scene.bullets : String(scene.text || '').split('\n'))
    .map(s => String(s).trim()).filter(Boolean)

  const bodySize = Math.min(S * 0.058, (H * 0.62 - (y - H * 0.22)) / Math.max(items.length, 1) * 0.55)
  ctx.font = `400 ${px(bodySize)} ${theme.font}`

  items.forEach((item, i) => {
    const p = ease.out(stagger(t, i, items.length))
    if (p <= 0) return
    ctx.globalAlpha = p
    const dx = (1 - p) * W * 0.02
    const lines = wrapText(item, W - pad * 2 - bodySize * 1.6, (s) => ctx.measureText(s).width)

    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(pad + bodySize * 0.35 + dx, y - bodySize * 0.3, bodySize * 0.16, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = theme.fg
    for (const line of lines) {
      ctx.fillText(line, pad + bodySize * 1.4 + dx, y)
      y += bodySize * 1.28
    }
    y += bodySize * 0.45
    ctx.globalAlpha = 1
  })
}

function drawImage(ctx, scene, t, { W, H, theme }) {
  const img = scene._image
  if (img) {
    const box = coverFit(img.width, img.height, W, H, kenBurns(t, scene.motion))
    ctx.drawImage(img, box.x, box.y, box.w, box.h)
  } else {
    background(ctx, W, H, theme, t)
    const S = Math.min(W, H)
    ctx.strokeStyle = `${theme.dim}26`
    ctx.lineWidth = Math.max(2, S * 0.004)
    ctx.strokeRect(W * 0.15, H * 0.2, W * 0.7, H * 0.55)
  }

  if (scene.caption) {
    const S = Math.min(W, H)
    const size = S * 0.048
    const band = size * 3
    const g = ctx.createLinearGradient(0, H - band, 0, H)
    g.addColorStop(0, '#00000000')
    g.addColorStop(1, '#000000d9')
    ctx.fillStyle = g
    ctx.fillRect(0, H - band, W, band)

    ctx.font = `500 ${px(size)} ${theme.font}`
    ctx.textAlign = 'center'
    ctx.fillStyle = theme.fg
    const lines = wrapText(scene.caption, W * 0.84, (s) => ctx.measureText(s).width).slice(0, 2)
    let y = H - band * 0.42
    for (const line of lines) { ctx.fillText(line, W / 2, y); y += size * 1.25 }
  }
}

function drawBars(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const data = scene.data.slice(0, 12).map(d => ({
    label: String(d.label ?? ''),
    value: Number(d.value) || 0,
  }))
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1)
  const pad = W * 0.09
  const top = H * (scene.heading ? 0.3 : 0.2)
  const bottom = H * 0.82
  const plotH = bottom - top
  const slot = (W - pad * 2) / data.length
  const barW = slot * 0.56

  if (scene.heading) {
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    const size = S * 0.075
    ctx.font = `700 ${px(size)} ${theme.font}`
    ctx.fillText(scene.heading, pad, H * 0.18)
  }

  ctx.strokeStyle = `${theme.dim}44`
  ctx.lineWidth = Math.max(1, S * 0.002)
  ctx.beginPath()
  ctx.moveTo(pad, bottom)
  ctx.lineTo(W - pad, bottom)
  ctx.stroke()

  const labelSize = Math.min(S * 0.038, slot * 0.28)
  data.forEach((d, i) => {
    const p = ease.out(stagger(t, i, data.length, { span: 0.5, hold: 0.35 }))
    const h = (Math.abs(d.value) / max) * plotH * 0.92 * p
    const x = pad + slot * i + (slot - barW) / 2

    const g = ctx.createLinearGradient(0, bottom - h, 0, bottom)
    g.addColorStop(0, theme.accent)
    g.addColorStop(1, theme.accent2)
    ctx.fillStyle = g
    const r = Math.min(barW * 0.18, h)
    ctx.beginPath()
    ctx.roundRect?.(x, bottom - h, barW, h, [r, r, 0, 0])
    if (ctx.roundRect) ctx.fill()
    else ctx.fillRect(x, bottom - h, barW, h)

    ctx.textAlign = 'center'
    ctx.font = `600 ${px(labelSize)} ${theme.font}`
    ctx.fillStyle = theme.fg
    if (p > 0.15) ctx.fillText(String(d.value), x + barW / 2, bottom - h - labelSize * 0.5)
    ctx.fillStyle = theme.dim
    ctx.font = `400 ${px(labelSize)} ${theme.font}`
    ctx.fillText(d.label, x + barW / 2, bottom + labelSize * 1.5)
  })
}

function drawQuote(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const pad = W * 0.12
  const text = scene.quote || scene.text || ''
  const author = scene.author || scene.subtitle || ''

  const p = ease.out(Math.min(1, t * 2.2))
  ctx.globalAlpha = p

  // Elegant large quotation mark background icon
  ctx.fillStyle = `${theme.accent}1f`
  ctx.font = `italic 900 ${px(S * 0.38)} serif`
  ctx.textAlign = 'left'
  ctx.fillText('“', pad - W * 0.04, H * 0.38)

  const { size, lines } = fitFont(ctx, `"${text}"`, {
    max: S * 0.08, min: S * 0.042, weight: '500', family: theme.font, maxWidth: W - pad * 2, maxLines: 4,
  })
  const lh = size * 1.3
  let y = H * 0.4 - (lines.length * lh) / 2 + size

  ctx.textAlign = 'center'
  ctx.fillStyle = theme.fg
  ctx.font = `500 italic ${px(size)} ${theme.font}`
  for (const line of lines) { ctx.fillText(line, W / 2, y); y += lh }

  if (author) {
    y += size * 0.4
    ctx.fillStyle = theme.accent
    ctx.font = `600 ${px(size * 0.48)} ${theme.font}`
    ctx.fillText(`— ${author}`, W / 2, y)
  }
  ctx.globalAlpha = 1
}

function drawMetric(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const metric = scene.metric || scene.heading || scene.text || '100%'
  const label = scene.label || scene.subtitle || scene.caption || ''
  const p = ease.out(Math.min(1, t * 2.5))

  ctx.textAlign = 'center'
  const metricSize = S * 0.22
  const labelSize = S * 0.055

  // Metric value with glowing accent
  ctx.globalAlpha = p
  ctx.fillStyle = theme.accent
  ctx.font = `800 ${px(metricSize)} ${theme.font}`
  ctx.fillText(metric, W / 2, H * 0.5)

  // Label card
  if (label) {
    ctx.fillStyle = theme.fg
    ctx.font = `500 ${px(labelSize)} ${theme.font}`
    ctx.fillText(label, W / 2, H * 0.5 + labelSize * 1.6)
  }

  // Accent underline
  const barW = W * 0.16 * p
  ctx.fillStyle = theme.accent2
  ctx.fillRect((W - barW) / 2, H * 0.5 + labelSize * 2.2, barW, Math.max(3, S * 0.006))
  ctx.globalAlpha = 1
}

/**
 * Burnt-in subtitles for the narration. The MP4 carries no subtitle track, and
 * a spoken video with no on-screen text is unusable muted or deaf.
 */
function drawSubtitle(ctx, scene, t, { W, H, theme }) {
  const cue = cueAt(scene._cues, t * scene.seconds)
  if (!cue?.text) return

  const S = Math.min(W, H)
  const size = Math.max(16, S * 0.045)
  ctx.font = `500 ${px(size)} ${theme.font}`
  const lines = wrapText(cue.text, W * 0.8, (s) => ctx.measureText(s).width).slice(0, 3)
  const boxH = lines.length * size * 1.3 + size * 0.7
  const bottom = H * 0.955
  const top = bottom - boxH

  ctx.fillStyle = '#000000bf'
  const w = Math.min(W * 0.88, Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 1.4)
  const x = (W - w) / 2
  if (ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(x, top, w, boxH, size * 0.35)
    ctx.fill()
    ctx.strokeStyle = '#ffffff22'
    ctx.lineWidth = 1
    ctx.stroke()
  } else ctx.fillRect(x, top, w, boxH)

  ctx.textAlign = 'center'
  ctx.fillStyle = theme.fg
  let y = top + size * 1.15
  for (const line of lines) { ctx.fillText(line, W / 2, y); y += size * 1.3 }
}

function drawSplit(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const pad = W * 0.06
  const imgRight = scene.align === 'right'
  const mediaW = W * 0.42
  const mediaH = H * 0.68
  const mediaX = imgRight ? W - pad - mediaW : pad
  const mediaY = (H - mediaH) / 2
  const textX = imgRight ? pad : pad + mediaW + W * 0.05
  const textW = W - pad * 2 - mediaW - W * 0.05

  // Image panel with rounded clip and Ken Burns motion
  const imgP = ease.out(Math.min(1, t * 2.8))
  ctx.save()
  ctx.globalAlpha = imgP
  const radius = Math.max(10, S * 0.025)
  if (ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(mediaX, mediaY, mediaW, mediaH, radius)
    ctx.clip()
  }
  const img = scene._image
  if (img) {
    const box = coverFit(img.width, img.height, mediaW, mediaH, kenBurns(t, scene.motion || 'in'))
    ctx.drawImage(img, mediaX + box.x, mediaY + box.y, box.w, box.h)
  } else {
    const g = ctx.createLinearGradient(mediaX, mediaY, mediaX + mediaW, mediaY + mediaH)
    g.addColorStop(0, `${theme.accent}33`)
    g.addColorStop(1, `${theme.accent2}33`)
    ctx.fillStyle = g
    ctx.fillRect(mediaX, mediaY, mediaW, mediaH)
  }
  ctx.restore()

  // Text column
  let y = H * 0.24
  if (scene.heading) {
    const { size, lines } = fitFont(ctx, scene.heading, {
      max: S * 0.075, min: S * 0.042, weight: '700', family: theme.font, maxWidth: textW, maxLines: 2,
    })
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    ctx.font = `700 ${px(size)} ${theme.font}`
    for (const line of lines) { ctx.fillText(line, textX, y); y += size * 1.2 }
    ctx.fillStyle = theme.accent
    ctx.fillRect(textX, y - size * 0.45, Math.min(textW * 0.35, W * 0.1), Math.max(3, S * 0.005))
    y += size * 0.5
  }

  const items = (Array.isArray(scene.bullets) ? scene.bullets : String(scene.text || '').split('\n'))
    .map(s => String(s).trim()).filter(Boolean).slice(0, 5)
  const bodySize = Math.min(S * 0.048, (H * 0.65 - (y - H * 0.24)) / Math.max(items.length, 1) * 0.58)
  ctx.font = `400 ${px(bodySize)} ${theme.font}`
  ctx.textAlign = 'left'

  items.forEach((item, i) => {
    const p = ease.out(stagger(t, i, items.length))
    if (p <= 0) return
    ctx.globalAlpha = p
    const dx = (1 - p) * W * 0.018
    const lines = wrapText(item, textW - bodySize * 1.4, (s) => ctx.measureText(s).width)

    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(textX + bodySize * 0.35 + dx, y - bodySize * 0.3, bodySize * 0.15, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = theme.fg
    for (const line of lines) {
      ctx.fillText(line, textX + bodySize * 1.2 + dx, y)
      y += bodySize * 1.28
    }
    y += bodySize * 0.4
    ctx.globalAlpha = 1
  })
}

function drawSteps(ctx, scene, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const pad = W * 0.09
  let topY = H * 0.2

  if (scene.heading) {
    const { size, lines } = fitFont(ctx, scene.heading, {
      max: S * 0.08, min: S * 0.045, weight: '700', family: theme.font, maxWidth: W - pad * 2, maxLines: 2,
    })
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    ctx.font = `700 ${px(size)} ${theme.font}`
    for (const line of lines) { ctx.fillText(line, pad, topY); topY += size * 1.2 }
    topY += size * 0.3
  }

  const items = (Array.isArray(scene.steps) ? scene.steps : (Array.isArray(scene.bullets) ? scene.bullets : String(scene.text || '').split('\n')))
    .map(s => String(s).trim()).filter(Boolean).slice(0, 5)
  if (!items.length) return

  const availH = H * 0.84 - topY
  const rowH = availH / items.length
  const badgeR = Math.min(S * 0.036, rowH * 0.32)
  const lineX = pad + badgeR

  // Animated vertical connector line
  if (items.length > 1) {
    const lineStart = topY + badgeR
    const lineEnd = topY + rowH * (items.length - 1) + badgeR
    const prog = ease.out(Math.min(1, t * 1.6))
    ctx.strokeStyle = `${theme.accent}55`
    ctx.lineWidth = Math.max(2, S * 0.004)
    ctx.beginPath()
    ctx.moveTo(lineX, lineStart)
    ctx.lineTo(lineX, lineStart + (lineEnd - lineStart) * prog)
    ctx.stroke()
  }

  const textSize = Math.min(S * 0.048, rowH * 0.45)
  items.forEach((step, i) => {
    const p = ease.out(stagger(t, i, items.length))
    if (p <= 0) return
    ctx.globalAlpha = p
    const cy = topY + rowH * i + badgeR
    const dx = (1 - p) * W * 0.02

    // Numbered circle badge
    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(lineX + dx, cy, badgeR, 0, Math.PI * 2)
    ctx.fill()

    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${px(badgeR * 1.05)} ${theme.font}`
    ctx.fillText(String(i + 1), lineX + dx, cy + badgeR * 0.36)

    // Step label
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    ctx.font = `500 ${px(textSize)} ${theme.font}`
    const lines = wrapText(step, W - pad * 2 - badgeR * 2.8, (s) => ctx.measureText(s).width).slice(0, 2)
    let ty = cy + textSize * 0.35 - ((lines.length - 1) * textSize * 0.6)
    for (const line of lines) {
      ctx.fillText(line, lineX + badgeR * 1.8 + dx, ty)
      ty += textSize * 1.25
    }
    ctx.globalAlpha = 1
  })
}

const PAINTERS = {
  title: drawTitle,
  outro: drawTitle,
  text: drawText,
  image: drawImage,
  split: drawSplit,
  steps: drawSteps,
  animation: drawAnimation,
  bars: drawBars,
  quote: drawQuote,
  metric: drawMetric,
}

function paintSceneLayer(ctx, spec, scene, t) {
  const { width: W, height: H, theme } = spec
  if (scene.type !== 'image' && scene.type !== 'animation') background(ctx, W, H, theme, t)
  ;(PAINTERS[scene.type] || drawText)(ctx, scene, t, { W, H, theme })
  if (scene._cues?.length) drawSubtitle(ctx, scene, t, { W, H, theme })
}

function getTransitionCtx(spec, W, H) {
  if (spec._transitionCtx && spec._transitionCanvas?.width === W && spec._transitionCanvas?.height === H) {
    return spec._transitionCtx
  }
  let canvas = null
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(W, H)
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
  }
  if (!canvas) return null
  spec._transitionCanvas = canvas
  spec._transitionCtx = canvas.getContext('2d', { alpha: false })
  return spec._transitionCtx
}

/** Paint one frame of the whole video. */
export function paintFrame(ctx, spec, { scene, t, alpha, prev }) {
  const { width: W, height: H, theme } = spec
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  if (prev && alpha < 1) {
    const tCtx = getTransitionCtx(spec, W, H)
    if (tCtx) {
      // Real cross-dissolve: paint outgoing scene onto main canvas, incoming onto offscreen, then blend.
      paintSceneLayer(ctx, spec, prev.scene, prev.t)
      tCtx.save()
      tCtx.clearRect(0, 0, W, H)
      tCtx.textBaseline = 'alphabetic'
      paintSceneLayer(tCtx, spec, scene, t)
      tCtx.restore()
      ctx.globalAlpha = alpha
      ctx.drawImage(spec._transitionCanvas, 0, 0)
      ctx.globalAlpha = 1
    } else {
      paintSceneLayer(ctx, spec, scene, t)
      ctx.globalAlpha = 1 - alpha
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
    }
  } else {
    paintSceneLayer(ctx, spec, scene, t)
    // Fade from/to black at very start/end of video.
    if (alpha < 1) {
      ctx.globalAlpha = 1 - alpha
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
    }
  }

  if (spec.progressBar) {
    const done = (scene.startFrame + t * (scene.frames - 1)) / Math.max(1, spec.totalFrames - 1)
    const h = Math.max(3, H * 0.006)
    ctx.globalAlpha = 1
    ctx.fillStyle = `${theme.dim}33`
    ctx.fillRect(0, H - h, W, h)
    ctx.fillStyle = theme.accent
    ctx.fillRect(0, H - h, W * done, h)

    // Subtle scene boundary ticks
    if (spec.scenes.length > 1 && spec.totalFrames > 0) {
      ctx.fillStyle = `${theme.bg}aa`
      for (let i = 1; i < spec.scenes.length; i++) {
        const tx = (spec.scenes[i].startFrame / spec.totalFrames) * W
        ctx.fillRect(tx - 1, H - h, 2, h)
      }
    }
  }

  ctx.restore()
}


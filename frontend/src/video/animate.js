/**
 * 2D Canvas Animation Engine for Yogatik `video_render`.
 *
 * Enables true frame-by-frame animated videos (cartoons, physics simulations,
 * orbits, keyframed characters, particles) on-device with zero backend.
 */

import { ease } from './timeline'
import { World, Body } from './physics'

const px = (n) => `${Math.round(n)}px`

/** Resolve normalized (0..1.5) or pixel (>1.5) coordinate against dimension. */
export function resolveCoord(val, dim, fallback = 0.5) {
  const n = Number(val)
  if (!Number.isFinite(n)) return fallback * dim
  return Math.abs(n) <= 1.5 ? n * dim : n
}

/** Deterministic pseudo-random helper in [0, 1) from integer seed. */
function hash01(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Draw animated scene environment/backdrop. */
export function drawEnvironment(ctx, env, t, { W, H, theme }) {
  const S = Math.min(W, H)
  const kind = String(env || 'stage').toLowerCase()

  if (kind === 'space') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#030712')
    g.addColorStop(1, '#0f172a')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Nebula glow
    const neb = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.55)
    neb.addColorStop(0, `${theme.accent2}24`)
    neb.addColorStop(1, '#00000000')
    ctx.fillStyle = neb
    ctx.fillRect(0, 0, W, H)

    // Twinkling stars
    for (let i = 0; i < 65; i++) {
      const sx = hash01(i * 3 + 1) * W
      const sy = hash01(i * 3 + 2) * H
      const r = 0.8 + hash01(i * 3 + 3) * 2
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4 + i * 1.7))
      ctx.globalAlpha = twinkle
      ctx.fillStyle = '#f8fafc'
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    return
  }

  if (kind === 'sky' || kind === 'ground') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0ea5e9')
    g.addColorStop(1, '#bae6fd')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Glowing sun
    const sunX = W * 0.82
    const sunY = H * 0.18
    const sunGlow = ctx.createRadialGradient(sunX, sunY, S * 0.04, sunX, sunY, S * 0.2)
    sunGlow.addColorStop(0, '#fef08a')
    sunGlow.addColorStop(0.4, '#fde04788')
    sunGlow.addColorStop(1, '#fde04700')
    ctx.fillStyle = sunGlow
    ctx.beginPath()
    ctx.arc(sunX, sunY, S * 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fef08a'
    ctx.beginPath()
    ctx.arc(sunX, sunY, S * 0.065, 0, Math.PI * 2)
    ctx.fill()

    // Drifting clouds
    for (let i = 0; i < 4; i++) {
      const baseX = hash01(i + 10) * W
      const cx = ((baseX + t * W * (0.08 + i * 0.03)) % (W + 200)) - 100
      const cy = H * (0.14 + hash01(i + 20) * 0.22)
      drawCloudShape(ctx, cx, cy, S * (0.09 + i * 0.015), 'rgba(255,255,255,0.85)')
    }

    if (kind === 'ground') {
      const horizon = H * 0.76
      const gg = ctx.createLinearGradient(0, horizon, 0, H)
      gg.addColorStop(0, '#22c55e')
      gg.addColorStop(1, '#15803d')
      ctx.fillStyle = gg
      ctx.fillRect(0, horizon, W, H - horizon)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(0, horizon, W, 3)
    }
    return
  }

  if (kind === 'grid') {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, theme.bg)
    g.addColorStop(1, theme.bgAlt)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    const step = Math.max(32, Math.round(S * 0.07))
    ctx.strokeStyle = `${theme.dim}1c`
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()
    return
  }

  if (kind === 'underwater') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0284c7')
    g.addColorStop(0.55, '#0369a1')
    g.addColorStop(1, '#082f49')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Animated caustic light rays from surface
    for (let i = 0; i < 5; i++) {
      const rx = W * (0.15 + i * 0.18) + Math.sin(t * 2 + i) * W * 0.03
      ctx.fillStyle = 'rgba(186, 230, 253, 0.08)'
      ctx.beginPath()
      ctx.moveTo(rx - S * 0.05, 0)
      ctx.lineTo(rx + S * 0.05, 0)
      ctx.lineTo(rx + S * 0.22, H)
      ctx.lineTo(rx - S * 0.12, H)
      ctx.closePath()
      ctx.fill()
    }
    // Sandy seabed
    ctx.fillStyle = '#0c4a6e'
    ctx.fillRect(0, H * 0.86, W, H * 0.14)
    return
  }

  if (kind === 'city') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#090d16')
    g.addColorStop(0.7, '#1e1b4b')
    g.addColorStop(1, '#312e81')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Skyline buildings
    const count = 14
    const bw = W / count
    for (let i = 0; i < count; i++) {
      const bh = H * (0.2 + hash01(i + 50) * 0.38)
      const bx = i * bw
      const by = H - bh
      ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#1e293b'
      ctx.fillRect(bx, by, bw + 1, bh)
      // Lit windows
      ctx.fillStyle = '#fde04788'
      for (let wy = by + 14; wy < H - 20; wy += 22) {
        for (let wx = bx + 8; wx < bx + bw - 10; wx += 16) {
          if (hash01(wx * 7 + wy * 13) > 0.45) {
            ctx.fillRect(wx, wy, 7, 10)
          }
        }
      }
    }
    return
  }

  if (kind === 'sunset') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#311042')
    g.addColorStop(0.45, '#be185d')
    g.addColorStop(0.78, '#f97316')
    g.addColorStop(1, '#fde047')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    const sunY = H * (0.62 + t * 0.06)
    ctx.fillStyle = '#fef08a'
    ctx.beginPath()
    ctx.arc(W * 0.5, sunY, S * 0.14, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#1e1b4b'
    ctx.fillRect(0, H * 0.78, W, H * 0.22)
    return
  }

  if (kind === 'forest') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0f172a')
    g.addColorStop(0.6, '#064e3b')
    g.addColorStop(1, '#022c22')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Layered pine trees
    for (let i = 0; i < 12; i++) {
      const tx = (i / 11) * W
      const th = H * (0.24 + hash01(i + 90) * 0.18)
      const tw = S * 0.11
      ctx.fillStyle = i % 2 === 0 ? '#065f46' : '#047857'
      ctx.beginPath()
      ctx.moveTo(tx, H - th)
      ctx.lineTo(tx + tw, H)
      ctx.lineTo(tx - tw, H)
      ctx.closePath()
      ctx.fill()
    }
    return
  }

  if (kind === 'chalkboard') {
    ctx.fillStyle = '#143326'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#78350f'
    ctx.lineWidth = Math.max(8, S * 0.02)
    ctx.strokeRect(0, 0, W, H)
    return
  }

  // Default 'stage' / 'dark'
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, theme.bg)
  g.addColorStop(1, theme.bgAlt)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function drawCloudShape(ctx, x, y, size, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, size * 0.42, 0, Math.PI * 2)
  ctx.arc(x - size * 0.35, y + size * 0.1, size * 0.3, 0, Math.PI * 2)
  ctx.arc(x + size * 0.38, y + size * 0.08, size * 0.32, 0, Math.PI * 2)
  ctx.fill()
}

/** Deterministic particle overlay. */
export function drawParticles(ctx, particles, t, { W, H, theme }) {
  if (!particles) return
  const kind = String(particles.type || particles || 'spark').toLowerCase()
  const count = Math.min(120, Math.max(5, Number(particles.count) || 40))
  const color = particles.color || (kind === 'snow' ? '#ffffff' : kind === 'rain' ? '#60a5fa' : theme.accent)

  ctx.save()
  for (let i = 0; i < count; i++) {
    const rx = hash01(i * 5 + 1)
    const ry = hash01(i * 5 + 2)
    const sp = 0.4 + hash01(i * 5 + 3) * 0.8
    const sz = 2 + hash01(i * 5 + 4) * 4

    if (kind === 'snow') {
      const x = ((rx * W + Math.sin(t * 6 + i) * 20) + W) % W
      const y = ((ry + t * sp * 0.9) % 1) * H
      ctx.globalAlpha = 0.75
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, sz, 0, Math.PI * 2)
      ctx.fill()
    } else if (kind === 'rain') {
      const x = rx * W
      const y = ((ry + t * sp * 2.2) % 1) * H
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 4, y + 14)
      ctx.stroke()
    } else if (kind === 'bubbles') {
      const x = ((rx * W + Math.sin(t * 5 + i) * 16) + W) % W
      const y = ((1 - ((ry + t * sp * 0.7) % 1)) * H)
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, sz * 1.4, 0, Math.PI * 2)
      ctx.stroke()
    } else if (kind === 'confetti') {
      const palette = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7']
      const x = ((rx * W + Math.sin(t * 7 + i) * 25) + W) % W
      const y = ((ry + t * sp * 1.1) % 1) * H
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 8 + i)
      ctx.fillStyle = palette[i % palette.length]
      ctx.globalAlpha = 0.85
      ctx.fillRect(-sz, -sz * 0.5, sz * 2, sz)
      ctx.restore()
    } else {
      // 'spark' / 'stars'
      const x = ((rx * W + Math.cos(t * 3 + i) * 18) + W) % W
      const y = ((ry * H + Math.sin(t * 3 + i * 1.3) * 18) + H) % H
      ctx.globalAlpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 10 + i))
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, sz * 0.7, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Evaluate actor transform at normalized scene progress `t` (0..1). */
export function evalActorState(actor, t, sceneSec, { W, H, theme }) {
  const S = Math.min(W, H)
  let x = resolveCoord(actor.x ?? 0.5, W, 0.5)
  let y = resolveCoord(actor.y ?? 0.5, H, 0.5)
  let scale = Number(actor.scale ?? 1)
  let rotation = Number(actor.rotation ?? 0)
  let opacity = Number(actor.opacity ?? 1)
  let color = actor.color || theme.accent

  const kfs = Array.isArray(actor.keyframes) && actor.keyframes.length
    ? [...actor.keyframes].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
    : null

  if (kfs) {
    if (t <= (kfs[0].t ?? 0)) {
      const k = kfs[0]
      if (k.x != null) x = resolveCoord(k.x, W)
      if (k.y != null) y = resolveCoord(k.y, H)
      if (k.scale != null) scale = k.scale
      if (k.rotation != null) rotation = k.rotation
      if (k.opacity != null) opacity = k.opacity
      if (k.color) color = k.color
    } else if (t >= (kfs[kfs.length - 1].t ?? 1)) {
      const k = kfs[kfs.length - 1]
      if (k.x != null) x = resolveCoord(k.x, W)
      if (k.y != null) y = resolveCoord(k.y, H)
      if (k.scale != null) scale = k.scale
      if (k.rotation != null) rotation = k.rotation
      if (k.opacity != null) opacity = k.opacity
      if (k.color) color = k.color
    } else {
      let i = 0
      while (i < kfs.length - 2 && t > (kfs[i + 1].t ?? 1)) i++
      const a = kfs[i]
      const b = kfs[i + 1]
      const span = Math.max(1e-5, (b.t ?? 1) - (a.t ?? 0))
      const u = ease.inOut(Math.min(1, Math.max(0, (t - (a.t ?? 0)) / span)))
      const ax = a.x != null ? resolveCoord(a.x, W) : x
      const ay = a.y != null ? resolveCoord(a.y, H) : y
      const bx = b.x != null ? resolveCoord(b.x, W) : ax
      const by = b.y != null ? resolveCoord(b.y, H) : ay
      x = lerp(ax, bx, u)
      y = lerp(ay, by, u)
      scale = lerp(a.scale ?? scale, b.scale ?? (a.scale ?? scale), u)
      rotation = lerp(a.rotation ?? rotation, b.rotation ?? (a.rotation ?? rotation), u)
      opacity = lerp(a.opacity ?? opacity, b.opacity ?? (a.opacity ?? opacity), u)
      if (u >= 0.5 && b.color) color = b.color
      else if (a.color) color = a.color
    }
  } else {
    // Velocity motion if no keyframes
    if (actor.vx) x += Number(actor.vx) * t * sceneSec
    if (actor.vy) y += Number(actor.vy) * t * sceneSec
  }

  if (actor.orbit) {
    const o = actor.orbit
    const cx = resolveCoord(o.cx ?? 0.5, W)
    const cy = resolveCoord(o.cy ?? 0.5, H)
    const rx = resolveCoord(o.rx ?? o.radius ?? 0.22, S)
    const ry = resolveCoord(o.ry ?? o.radius ?? 0.22, S)
    const angle = ((o.startAngle ?? 0) * Math.PI) / 180 + t * (o.speed ?? 1) * Math.PI * 2
    x = cx + Math.cos(angle) * rx
    y = cy + Math.sin(angle) * ry
  }

  if (actor.bob) {
    const amp = resolveCoord(actor.bob.amp ?? 0.02, H)
    const freq = Number(actor.bob.freq ?? 2)
    y += Math.sin(t * Math.PI * 2 * freq) * amp
  }
  if (actor.spin) {
    rotation += Number(actor.spin) * t * sceneSec
  }
  if (actor.pulse) {
    const amp = Number(actor.pulse.amp ?? 0.12)
    const freq = Number(actor.pulse.freq ?? 2)
    scale *= 1 + Math.sin(t * Math.PI * 2 * freq) * amp
  }

  return { x, y, scale, rotation, opacity, color }
}

function getPhysicsWorld(scene, W, H) {
  const bodies = (scene.actors || []).filter(a => a.physics)
  if (!bodies.length) return null
  if (!scene._physWorld || scene._physW !== W || scene._physH !== H) {
    const world = new World({
      gravityY: Number(scene.gravity ?? 980),
      boundsW: W,
      boundsH: H,
    })
    bodies.forEach((a, idx) => {
      const S = Math.min(W, H)
      const r = a.size ? resolveCoord(a.size, S) * 0.5 : (a.radius ? resolveCoord(a.radius, S) : S * 0.045)
      world.add(new Body(a.id || `body_${idx}`, {
        x: resolveCoord(a.x ?? 0.5, W),
        y: resolveCoord(a.y ?? 0.3, H),
        vx: Number(a.vx ?? 160),
        vy: Number(a.vy ?? 0),
        radius: r,
        mass: Number(a.mass ?? 1),
        gravityScale: a.gravityScale ?? 1,
        bounciness: Number(a.bounciness ?? 0.82),
        friction: Number(a.friction ?? 0.995),
        static: !!a.static,
        color: a.color,
      }))
    })
    scene._physWorld = world
    scene._physW = W
    scene._physH = H
    scene._physLastT = 0
  }
  return scene._physWorld
}

function drawActorShape(ctx, actor, state, t, { W, H, theme, style = 'flat' }) {
  const S = Math.min(W, H)
  const shape = String(actor.shape || 'circle').toLowerCase()
  const size = actor.size ? resolveCoord(actor.size, S) : S * 0.09
  const w = actor.width ? resolveCoord(actor.width, W) : size * 1.4
  const h = actor.height ? resolveCoord(actor.height, H) : size

  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity))
  ctx.translate(state.x, state.y)
  if (state.rotation) ctx.rotate((state.rotation * Math.PI) / 180)
  if (state.scale !== 1) ctx.scale(state.scale, state.scale)

  if (style === 'neon') {
    ctx.shadowColor = state.color
    ctx.shadowBlur = Math.max(12, S * 0.03)
  } else if (style === 'blueprint') {
    ctx.strokeStyle = '#38bdf8'
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)'
  }

  if (style !== 'blueprint') {
    ctx.fillStyle = state.color
    ctx.strokeStyle = actor.stroke || (style === 'cartoon' ? '#0f172a' : state.color)
  }

  if (shape === 'circle' || shape === 'ball') {
    const r = size * 0.5
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r)
    g.addColorStop(0, '#ffffff55')
    g.addColorStop(0.35, state.color)
    g.addColorStop(1, state.color)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'rect' || shape === 'roundedrect') {
    const r = shape === 'roundedrect' ? Math.min(w, h) * 0.2 : 0
    if (r > 0 && ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(-w / 2, -h / 2, w, h, r)
      ctx.fill()
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h)
    }
  } else if (shape === 'triangle') {
    const r = size * 0.58
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(r * 0.86, r * 0.6)
    ctx.lineTo(-r * 0.86, r * 0.6)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'star') {
    const outer = size * 0.55
    const inner = outer * 0.45
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2
      const rad = i % 2 === 0 ? outer : inner
      if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad)
      else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad)
    }
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'ring') {
    ctx.lineWidth = Math.max(3, size * 0.12)
    ctx.beginPath()
    ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'arrow' || shape === 'line') {
    const len = w
    ctx.lineWidth = Math.max(3, S * 0.008)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-len / 2, 0)
    ctx.lineTo(len / 2, 0)
    ctx.stroke()
    if (shape === 'arrow') {
      const head = Math.min(len * 0.3, S * 0.03)
      ctx.beginPath()
      ctx.moveTo(len / 2, 0)
      ctx.lineTo(len / 2 - head, -head * 0.65)
      ctx.lineTo(len / 2 - head, head * 0.65)
      ctx.closePath()
      ctx.fill()
    }
  } else if (shape === 'planet') {
    const r = size * 0.5
    if (actor.rings) {
      ctx.save()
      ctx.rotate(-0.32)
      ctx.strokeStyle = `${state.color}88`
      ctx.lineWidth = Math.max(3, r * 0.18)
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 1.85, r * 0.45, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r)
    g.addColorStop(0, '#ffffff66')
    g.addColorStop(0.4, state.color)
    g.addColorStop(1, '#09090b')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'rocket') {
    const r = size * 0.65
    // Animated exhaust flame
    const flicker = 0.8 + 0.4 * Math.sin(t * 45)
    ctx.fillStyle = '#f97316'
    ctx.beginPath()
    ctx.moveTo(-r * 0.22, r * 0.5)
    ctx.lineTo(0, r * (0.95 + 0.35 * flicker))
    ctx.lineTo(r * 0.22, r * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fde047'
    ctx.beginPath()
    ctx.moveTo(-r * 0.12, r * 0.5)
    ctx.lineTo(0, r * (0.75 + 0.2 * flicker))
    ctx.lineTo(r * 0.12, r * 0.5)
    ctx.closePath()
    ctx.fill()

    // Fins
    ctx.fillStyle = theme.accent2
    ctx.beginPath()
    ctx.moveTo(-r * 0.28, r * 0.2)
    ctx.lineTo(-r * 0.55, r * 0.6)
    ctx.lineTo(-r * 0.24, r * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(r * 0.28, r * 0.2)
    ctx.lineTo(r * 0.55, r * 0.6)
    ctx.lineTo(r * 0.24, r * 0.5)
    ctx.closePath()
    ctx.fill()

    // Fuselage
    ctx.fillStyle = state.color
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.85)
    ctx.quadraticCurveTo(r * 0.36, -r * 0.2, r * 0.26, r * 0.5)
    ctx.lineTo(-r * 0.26, r * 0.5)
    ctx.quadraticCurveTo(-r * 0.36, -r * 0.2, 0, -r * 0.85)
    ctx.fill()

    // Porthole
    ctx.fillStyle = '#38bdf8'
    ctx.beginPath()
    ctx.arc(0, -r * 0.15, r * 0.14, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'stickfigure') {
    const r = size * 0.65
    const swing = Math.sin(t * 14) * 0.45
    ctx.strokeStyle = state.color
    ctx.lineWidth = Math.max(3, r * 0.09)
    ctx.lineCap = 'round'
    // Head
    ctx.beginPath()
    ctx.arc(0, -r * 0.65, r * 0.22, 0, Math.PI * 2)
    ctx.stroke()
    // Torso
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.43)
    ctx.lineTo(0, r * 0.18)
    ctx.stroke()
    // Arms
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.28)
    ctx.lineTo(-r * 0.38, -r * 0.05 + swing * r * 0.25)
    ctx.moveTo(0, -r * 0.28)
    ctx.lineTo(r * 0.38, -r * 0.05 - swing * r * 0.25)
    ctx.stroke()
    // Legs
    ctx.beginPath()
    ctx.moveTo(0, r * 0.18)
    ctx.lineTo(-r * 0.3 * Math.cos(swing) - r * 0.1, r * 0.68)
    ctx.moveTo(0, r * 0.18)
    ctx.lineTo(r * 0.3 * Math.cos(swing) + r * 0.1, r * 0.68)
    ctx.stroke()
  } else if (shape === 'car') {
    const cw = size * 1.6
    const ch = size * 0.65
    ctx.fillStyle = state.color
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(-cw * 0.5, -ch * 0.2, cw, ch * 0.6, ch * 0.2)
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(-cw * 0.3, -ch * 0.65, cw * 0.56, ch * 0.5, ch * 0.2)
      ctx.fill()
    } else {
      ctx.fillRect(-cw * 0.5, -ch * 0.2, cw, ch * 0.6)
    }
    // Wheels
    const wr = ch * 0.28
    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.arc(-cw * 0.28, ch * 0.4, wr, 0, Math.PI * 2)
    ctx.arc(cw * 0.28, ch * 0.4, wr, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'bird') {
    const r = size * 0.45
    const flap = Math.sin(t * 20) * r * 0.55
    ctx.strokeStyle = state.color
    ctx.lineWidth = Math.max(3, r * 0.16)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-r, -flap)
    ctx.quadraticCurveTo(-r * 0.45, -r * 0.45 - flap * 0.5, 0, 0)
    ctx.quadraticCurveTo(r * 0.45, -r * 0.45 - flap * 0.5, r, -flap)
    ctx.stroke()
  } else if (shape === 'cloud') {
    drawCloudShape(ctx, 0, 0, size, state.color)
  } else if (shape === 'wave') {
    const ww = actor.width ? resolveCoord(actor.width, W) : W * 0.9
    const amp = size * 0.4
    ctx.strokeStyle = state.color
    ctx.lineWidth = Math.max(3, S * 0.008)
    ctx.beginPath()
    for (let i = 0; i <= 60; i++) {
      const px0 = -ww / 2 + (i / 60) * ww
      const py0 = Math.sin((i / 60) * Math.PI * 4 + t * Math.PI * 4) * amp
      if (i === 0) ctx.moveTo(px0, py0)
      else ctx.lineTo(px0, py0)
    }
    ctx.stroke()
  } else if (shape === 'text') {
    const fontSize = Math.max(14, size * 0.55)
    ctx.font = `700 ${px(fontSize)} ${theme.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(actor.text || actor.label || ''), 0, 0)
  }

  ctx.restore()

  // Optional label underneath
  if (actor.label && shape !== 'text') {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity))
    const lSize = Math.max(12, S * 0.032)
    ctx.font = `600 ${px(lSize)} ${theme.font}`
    ctx.textAlign = 'center'
    ctx.fillStyle = theme.fg
    ctx.fillText(String(actor.label), state.x, state.y + size * 0.72 + lSize * 0.6)
    ctx.restore()
  }
}

/** Paint an `animation` scene at progress `t` (0..1). */
export function drawAnimation(ctx, scene, t, { W, H, theme, style: specStyle }) {
  const style = String(scene.style || specStyle || 'flat').toLowerCase()
  const env = scene.environment || (style === 'blueprint' ? 'grid' : 'stage')
  drawEnvironment(ctx, env, t, { W, H, theme })
  if (scene.particles) drawParticles(ctx, scene.particles, t, { W, H, theme })

  const sceneSec = scene.seconds || 6
  const actors = Array.isArray(scene.actors) ? scene.actors : []

  // Step physics world if any actor uses physics
  const world = getPhysicsWorld(scene, W, H)
  if (world) {
    const dt = Math.max(0, (t - (scene._physLastT || 0)) * sceneSec)
    if (dt > 0) {
      world.step(Math.min(0.1, dt))
      scene._physLastT = t
    }
  }

  actors.forEach((actor, idx) => {
    let state
    if (actor.physics && world) {
      const b = world.get(actor.id || `body_${idx}`)
      state = {
        x: b ? b.pos.x : resolveCoord(actor.x ?? 0.5, W),
        y: b ? b.pos.y : resolveCoord(actor.y ?? 0.5, H),
        scale: Number(actor.scale ?? 1),
        rotation: Number(actor.rotation ?? 0) + (actor.spin ? Number(actor.spin) * t * sceneSec : 0),
        opacity: Number(actor.opacity ?? 1),
        color: actor.color || theme.accent,
      }
    } else {
      state = evalActorState(actor, t, sceneSec, { W, H, theme })
    }

    // Optional fading motion trail
    if (actor.trail) {
      if (!actor._trailPts) actor._trailPts = []
      actor._trailPts.push({ x: state.x, y: state.y })
      if (actor._trailPts.length > 24) actor._trailPts.shift()
      if (actor._trailPts.length > 1) {
        ctx.save()
        ctx.strokeStyle = state.color
        ctx.lineCap = 'round'
        for (let k = 1; k < actor._trailPts.length; k++) {
          ctx.globalAlpha = (k / actor._trailPts.length) * 0.45 * state.opacity
          ctx.lineWidth = Math.max(2, (k / actor._trailPts.length) * Math.min(W, H) * 0.012)
          ctx.beginPath()
          ctx.moveTo(actor._trailPts[k - 1].x, actor._trailPts[k - 1].y)
          ctx.lineTo(actor._trailPts[k].x, actor._trailPts[k].y)
          ctx.stroke()
        }
        ctx.restore()
      }
    }

    drawActorShape(ctx, actor, state, t, { W, H, theme, style })
  })

  // Optional retro CRT scanline overlay
  if (style === 'retro') {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.5)
    ctx.restore()
  }

  // Optional subtle title/heading pill at top-left
  const title = scene.heading || scene.title
  if (title) {
    const S = Math.min(W, H)
    const size = Math.max(16, S * 0.045)
    ctx.save()
    ctx.font = `700 ${px(size)} ${theme.font}`
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.fg
    ctx.globalAlpha = Math.min(1, t * 4)
    ctx.fillText(String(title), W * 0.05, H * 0.09)
    ctx.restore()
  }
}

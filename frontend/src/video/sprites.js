/**
 * Sprite layer for Yogatik video rendering.
 *
 * Sprites bind a Canvas2D draw function to a physics Body.
 * State-driven painting: every frame the renderer advances the physics World once,
 * then paints sprites from body position/velocity.
 *
 * Event chains give real action -> reaction -> response:
 *   { on: 'collision', if: { bodyA: 'ball', bodyB: 'floor' },
 *     then: [{ type: 'applyForce', target: 'ball', fx: 0, fy: -400 },
 *           { type: 'spawn', sprite: 'spark', x: ..., y: ... }] }
 */

import { World, Body, Vec2 } from './physics'

/** A renderable entity bound to a physics Body. */
export class Sprite {
  constructor(id, body, drawFn, opts = {}) {
    this.id = id;
    this.body = body;
    this.drawFn = drawFn;
    this.alpha = opts.alpha ?? 1;
    this.scale = opts.scale ?? 1;
    this.rotation = opts.rotation ?? 0;
    this.visible = opts.visible ?? true;
    this.zIndex = opts.zIndex ?? 0;
    this.tint = opts.tint ?? null;
    this.label = opts.label ?? id;
    this.fontSize = opts.fontSize ?? null;
    this.textAlign = opts.textAlign ?? 'center';
    this.userData = opts.userData ?? {};
    this.age = 0;
    this.ttl = opts.ttl ?? Infinity;
  }

  /** Advance sprite lifetime; returns false if sprite should be removed. */
  tick(dt) {
    this.age += dt;
    return this.age < this.ttl;
  }

  /** Paint sprite into ctx at current body position. */
  paint(ctx, sceneTime, theme) {
    if (!this.visible || !this.body) return;
    const b = this.body;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(b.pos.x, b.pos.y);
    if (this.rotation) ctx.rotate(this.rotation);
    if (this.scale !== 1) ctx.scale(this.scale, this.scale);
    if (this.tint) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = this.tint;
      ctx.fillRect(-5000, -5000, 10000, 10000);
      ctx.restore();
    }
    this.drawFn(ctx, this, sceneTime, theme);
    ctx.restore();
  }
}

/**
 * WorldSpriteGroup owns a physics World + sprites.
 * Advances physics per frame, runs event rules (action -> reaction -> response),
 * handles spawn/removal queues.
 */
export class WorldSpriteGroup {
  constructor(world) {
    this.world = world;
    this.sprites = new Map();
    this.bodyBySpriteId = new Map();
    this.eventRules = [];
    this.pendingSpawns = [];
    this.pendingRemovals = new Set();
    this.frame = 0;
    this.onSpawn = null;
  }

  /** Register a sprite with its body already added to the world. */
  add(sprite) {
    if (!this.world.get(sprite.body.id)) this.world.add(sprite.body);
    this.sprites.set(sprite.id, sprite);
    this.bodyBySpriteId.set(sprite.id, sprite.body.id);
    return sprite;
  }

  /** Remove sprite by id (queued until end of step). */
  remove(id) { this.pendingRemovals.add(id); }

  /** Queue a new sprite to spawn next step. */
  queueSpawn(sprite) { this.pendingSpawns.push(sprite); }

  /** Add an event rule.
   * rule.on: 'collision' | 'wall' | 'impulse' | 'frame'
   * rule.if: optional filter { body, bodyA, bodyB, wall }
   * rule.then: array of actions to run when rule fires
   */
  on(rule) { this.eventRules.push(rule); }

  /** Advance physics by dt seconds, run event rules, apply spawns/removals. */
  step(dt) {
    this.frame++;

    // Integrate physics
    const events = this.world.step(dt);

    // Run event rules against physics events
    for (const ev of events) {
      for (const rule of this.eventRules) {
        if (rule.on !== ev.type) continue;
        if (rule.if && !matchesFilter(ev, rule.if)) continue;
        this.runActions(rule.then, ev);
      }
    }

    // Frame-based rules
    for (const rule of this.eventRules) {
      if (rule.on === 'frame' && rule.atFrame == null) continue;
      if (rule.on === 'frame' && this.frame === rule.atFrame) {
        this.runActions(rule.then, { type: 'frame', frame: this.frame });
      }
    }

    // Apply pending spawns
    for (const sprite of this.pendingSpawns) {
      this.add(sprite);
    }
    this.pendingSpawns = [];

    // Apply pending removals
    for (const id of this.pendingRemovals) {
      const s = this.sprites.get(id);
      if (s) {
        const bid = this.bodyBySpriteId.get(id);
        if (bid) this.world.remove(bid);
        this.bodyBySpriteId.delete(id);
        this.sprites.delete(id);
      }
    }
    this.pendingRemovals.clear();

    // Tick sprite lifetimes
    for (const [id, s] of this.sprites) {
      if (!s.tick(dt)) {
        const bid = this.bodyBySpriteId.get(id);
        if (bid) this.world.remove(bid);
        this.bodyBySpriteId.delete(id);
        this.sprites.delete(id);
      }
    }

    return events;
  }

  /** Paint all sprites sorted by zIndex. */
  paint(ctx, sceneTime, theme) {
    const ordered = [...this.sprites.values()].sort((a, b) => a.zIndex - b.zIndex);
    for (const s of ordered) s.paint(ctx, sceneTime, theme);
  }

  runActions(actions, ev) {
    for (const a of actions || []) {
      switch (a.type) {
        case 'applyForce': {
          const b = resolveBody(a.target, ev, this);
          if (b) b.applyForce(a.fx ?? 0, a.fy ?? 0);
          break;
        }
        case 'setVelocity': {
          const b = resolveBody(a.target, ev, this);
          if (b) { b.vel = new Vec2(a.vx ?? 0, a.vy ?? 0); b.sleeping = false; }
          break;
        }
        case 'spawn': {
          if (this.onSpawn) {
            const spawned = this.onSpawn(a, ev);
            if (spawned) this.queueSpawn(spawned);
          }
          break;
        }
        case 'remove': {
          const target = a.target ?? (ev.bodyA ? ev.bodyA : ev.body);
          const sid = spriteIdByBody(target, this);
          if (sid) this.remove(sid);
          break;
        }
        case 'sleep': {
          const b = resolveBody(a.target, ev, this);
          if (b) b.sleeping = true;
          break;
        }
        case 'wake': {
          const b = resolveBody(a.target, ev, this);
          if (b) b.sleeping = false;
          break;
        }
      }
    }
  }
}

function matchesFilter(ev, f) {
  if (!f) return true;
  if (f.body && ev.body && ev.body !== f.body) return false;
  if (f.bodyA && ev.bodyA && ev.bodyA !== f.bodyA) return false;
  if (f.bodyB && ev.bodyB && ev.bodyB !== f.bodyB) return false;
  if (f.wall && ev.wall && ev.wall !== f.wall) return false;
  return true;
}

function resolveBody(target, ev, group) {
  if (!target) return null;
  const b = group.world.get(target);
  if (b) return b;
  if (target === 'ev.body' && ev.body) return group.world.get(ev.body);
  if (target === 'ev.bodyA' && ev.bodyA) return group.world.get(ev.bodyA);
  if (target === 'ev.bodyB' && ev.bodyB) return group.world.get(ev.bodyB);
  return null;
}

function spriteIdByBody(bodyId, group) {
  for (const [sid, bid] of group.bodyBySpriteId) {
    if (bid === bodyId) return sid;
  }
  return null;
}
export {};
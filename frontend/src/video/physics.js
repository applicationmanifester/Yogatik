/**
 * Tiny deterministic physics engine for Yogatik video rendering.
 *
 * Bodies carry position/velocity/acceleration across frames.
 * Forces accumulate per step; collisions resolve impulses.
 * All state lives on the World so rendering is deterministic given a frame index.
 */

/** Tiny 2D vector with immutable math helpers. */
export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(s) { return new Vec2(this.x * s, this.y * s); }
  mag() { return Math.hypot(this.x, this.y); }
  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
  normalize() { const m = this.mag(); return m > 0 ? new Vec2(this.x / m, this.y / m) : new Vec2(0, 0); }
}

/** Physical body — persists state across frames inside a World. */
export class Body {
  constructor(id, opts = {}) {
    this.id = id;
    this.type = opts.type ?? 'circle';
    this.pos = new Vec2(opts.x ?? 0, opts.y ?? 0);
    this.vel = new Vec2(opts.vx ?? (Math.random() - 0.5) * 60, opts.vy ?? (Math.random() - 0.5) * 60);
    this.acc = new Vec2(0, 0);
    this.mass = opts.mass ?? 1;
    this.gravityScale = opts.gravityScale ?? 1;
    this.friction = opts.friction ?? 0.985;
    this.bounciness = opts.bounciness ?? 0.6;
    this.static = !!opts.static;
    this.collidable = opts.collidable ?? true;
    this.sleeping = false;
    this.zIndex = opts.zIndex ?? 0;
    this.radius = opts.radius ?? Math.max(opts.width ?? 40, opts.height ?? 40) / 2;
    this.width = opts.width ?? (this.radius * 2);
    this.height = opts.height ?? (this.radius * 2);
    this.color = opts.color ?? opts.fill ?? '#ff6b35';
    Object.assign(this, opts.userData ?? {});
  }

  applyForce(fx, fy) {
    if (this.static || this.sleeping) return;
    this.acc.x += fx / this.mass;
    this.acc.y += fy / this.mass;
  }

  /** Advance one substep. Returns wall-collision events for this body. */
  integrate(dt, boundsW, boundsH) {
    if (this.static || this.sleeping) return [];
    const events = [];

    // Gravity
    if (this.gravityScale !== 0) {
      this.vel.y += 980 * this.gravityScale * dt;
    }

    // Apply accumulated forces
    this.vel = this.vel.add(this.acc.mul(dt));
    this.acc = new Vec2(0, 0);

    // Friction damping
    this.vel = this.vel.mul(Math.pow(this.friction, dt * 60));

    const next = this.pos.add(this.vel.mul(dt));

    const r = this.radius;

    // Left wall
    if (next.x - r < 4) {
      next.x = 4 + r;
      if (this.vel.x < 0) { this.vel.x *= -this.bounciness; events.push({ type: 'wall', wall: 'left', body: this.id }); }
      if (Math.abs(this.vel.x) < 2) this.sleeping = true;
    }
    // Right wall
    else if (next.x + r > boundsW - 4) {
      next.x = boundsW - 4 - r;
      if (this.vel.x > 0) { this.vel.x *= -this.bounciness; events.push({ type: 'wall', wall: 'right', body: this.id }); }
      if (Math.abs(this.vel.x) < 2) this.sleeping = true;
    }

    // Top wall
    if (next.y - r < 4) {
      next.y = 4 + r;
      if (this.vel.y < 0) { this.vel.y *= -this.bounciness; events.push({ type: 'wall', wall: 'top', body: this.id }); }
      if (Math.abs(this.vel.y) < 2) this.sleeping = true;
    }
    // Bottom wall
    else if (next.y + r > boundsH - 4) {
      next.y = boundsH - 4 - r;
      if (this.vel.y > 0) {
        this.vel.y *= -this.bounciness;
        events.push({ type: 'wall', wall: 'bottom', body: this.id });
        if (Math.abs(this.vel.y) < 6) { this.sleeping = true; }
      } else {
        events.push({ type: 'wall', wall: 'bottom', body: this.id });
      }
    }

    // Kill near-zero velocity
    if (this.vel.mag() < 1.5 && !this.static) {
      this.vel = new Vec2(0, 0);
      this.sleeping = true;
    }

    this.pos = next;
    return events;
  }

  overlaps(other) {
    if (!this.collidable || !other.collidable || this === other) return false;
    const r1 = this.radius;
    const r2 = other.radius;
    return this.pos.dist(other.pos) < r1 + r2 - 4;
  }

  resolveCollision(other) {
    if (!this.overlaps(other)) return [];
    const normal = other.pos.sub(this.pos).normalize();
    const relVel = other.vel.sub(this.vel);
    const velAlongNormal = relVel.x * normal.x + relVel.y * normal.y;
    if (velAlongNormal > 0) return []; // already separating

    const e = Math.min(this.bounciness, other.bounciness);
    const j = -(1 + e) * velAlongNormal;
    const invMassSum = (this.static ? 0 : 1 / this.mass) + (other.static ? 0 : 1 / other.mass);
    const impulseScalar = j / invMassSum;
    const impulse = normal.mul(impulseScalar);

    const events = [];
    if (!this.static) { this.vel = this.vel.sub(impulse.mul(1 / this.mass)); events.push({ type: 'impulse', body: this.id }); }
    if (!other.static) { other.vel = other.vel.add(impulse.mul(1 / other.mass)); events.push({ type: 'impulse', body: other.id }); }

    const overlap = r1 + r2 - this.pos.dist(other.pos);
    const correction = normal.mul(overlap * 0.5);
    if (!this.static) this.pos = this.pos.sub(correction);
    if (!other.static) other.pos = other.pos.add(correction);

    events.push({ type: 'collision', bodyA: this.id, bodyB: other.id });
    return events;
  }
}

/** World holds bodies and advances them deterministically per frame step. */
export class World {
  constructor({ gravityX = 0, gravityY = 980, boundsW = 1280, boundsH = 720 } = {}) {
    this.gravity = new Vec2(gravityX, gravityY);
    this.boundsW = boundsW;
    this.boundsH = boundsH;
    this.bodies = [];
    this.subSteps = 8;
  }

  add(body) { this.bodies.push(body); return body; }

  get(id) { return this.bodies.find(b => b.id === id); }

  remove(id) { this.bodies = this.bodies.filter(b => b.id !== id); }

  /** Advance world by dt seconds.
   * Returns an array of all events generated during the step.
   */
  step(dt) {
    const subDt = dt / Math.max(1, this.subSteps);
    const events = [];

    for (let s = 0; s < Math.max(1, this.subSteps); s++) {
      // Integrate every active body against walls
      for (const b of this.bodies) {
        const wallEvts = b.integrate(subDt, this.boundsW, this.boundsH);
        events.push(...wallEvts);
      }

      // Pairwise body collisions (simple O(n^2), fine for small object counts)
      for (let i = 0; i < this.bodies.length; i++) {
        for (let j = i + 1; j < this.bodies.length; j++) {
          const evts = this.bodies[i].resolveCollision(this.bodies[j]);
          events.push(...evts);
        }
      }
    }

    return events;
  }
}
export {};
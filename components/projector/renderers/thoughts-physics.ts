/**
 * Intrusive Thoughts — Physics Engine for Projector Canvas
 *
 * Module-level state (same pattern as finale renderer). Manages particle simulation
 * for falling/piling thought text, with AABB collision resolution.
 *
 * All constants are tunable at the top of the file.
 */

// ============================================================================
// Tunable Constants
// ============================================================================

const GRAVITY = 150;              // px/s² (low gravity feel)
const DAMPING = 0.65;             // velocity multiplier on collision
const FRICTION = 0.985;           // per-frame velocity decay
const SETTLE_THRESHOLD = 2;       // velocity below which particle is "settled"
const SPAWN_STAGGER_MS = 50;      // ms between each particle spawn
const FLING_SPEED = 1200;         // px/s for dismissed particles
const FLING_VY = -200;            // slight upward arc on fling
const PARTICLE_HEIGHT = 28;       // fixed height per particle (font + padding)
const PARTICLE_PADDING_X = 16;    // horizontal padding for text
const FONT_SIZE = 14;             // px
const FONT = `${FONT_SIZE}px monospace`;
const MAX_ROTATION = 0.15;        // radians — max rotation for settled particles
const ROTATION_DAMPING = 0.92;    // rotational velocity decay

// Visual
const BG_COLOR = 'rgba(20, 8, 8, 0.82)';
const TEXT_COLOR = 'rgba(255, 180, 180, 0.7)';
const BORDER_COLOR = 'rgba(200, 60, 60, 0.2)';
const BORDER_RADIUS = 5;

// ============================================================================
// Types
// ============================================================================

interface Particle {
  id: string;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  vRotation: number;
  settled: boolean;
  flung: boolean;
  opacity: number;
  measured: boolean;   // whether width has been measured via ctx.measureText
}

// ============================================================================
// Module-level state
// ============================================================================

let particles: Particle[] = [];
let floorY = 0;
let canvasW = 0;
let canvasH = 0;
let spawnQueue: { id: string; text: string }[] = [];
let spawnTimer = 0;

// ============================================================================
// Public API
// ============================================================================

/** Initialize with a batch of thoughts. Queues them for staggered spawning. */
export function initThoughts(thoughts: { id: string; text: string }[]): void {
  // Don't reset existing particles — allow incremental adds on reconnect
  const existingIds = new Set(particles.map(p => p.id));
  const newThoughts = thoughts.filter(t => !existingIds.has(t.id));
  spawnQueue = [...spawnQueue, ...newThoughts.map(t => ({ id: t.id, text: t.text }))];
  spawnTimer = 0;
}

/** Dismiss a specific thought — fling it off-screen. */
export function dismissThought(id: string, direction: 'left' | 'right'): void {
  const p = particles.find(p => p.id === id);
  if (!p || p.flung) return;
  p.flung = true;
  p.settled = false;
  p.vx = direction === 'right' ? FLING_SPEED : -FLING_SPEED;
  p.vy = FLING_VY;
  p.vRotation = (direction === 'right' ? 1 : -1) * 3;
}

/** Clear all thoughts (on phase change). */
export function clearThoughts(): void {
  particles = [];
  spawnQueue = [];
  spawnTimer = 0;
}

/** Get current particle count (for debugging/metrics). */
export function getParticleCount(): number {
  return particles.length + spawnQueue.length;
}

// ============================================================================
// Physics Update (called each frame)
// ============================================================================

export function updatePhysics(dt: number, cw: number, ch: number): void {
  canvasW = cw;
  canvasH = ch;
  floorY = ch * 0.88;

  // Process spawn queue
  spawnTimer += dt * 1000;
  while (spawnQueue.length > 0 && spawnTimer >= SPAWN_STAGGER_MS) {
    spawnTimer -= SPAWN_STAGGER_MS;
    const item = spawnQueue.shift()!;
    particles.push(createParticle(item.id, item.text));
  }

  // Update each particle
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    if (p.flung) {
      // Flung particles: move fast, fade out, remove when off-screen
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vRotation * dt;
      p.opacity -= dt * 2.5;
      if (p.opacity <= 0 || p.x < -p.width * 2 || p.x > canvasW + p.width * 2) {
        particles.splice(i, 1);
      }
      continue;
    }

    if (p.settled) continue;

    // Apply gravity
    p.vy += GRAVITY * dt;

    // Apply friction
    p.vx *= FRICTION;
    p.vy *= FRICTION;
    p.vRotation *= ROTATION_DAMPING;

    // Move
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.vRotation * dt;

    // Clamp rotation
    if (Math.abs(p.rotation) > MAX_ROTATION) {
      p.rotation = Math.sign(p.rotation) * MAX_ROTATION;
      p.vRotation = 0;
    }

    // Floor collision
    if (p.y + p.height / 2 > floorY) {
      p.y = floorY - p.height / 2;
      p.vy = -p.vy * DAMPING;
      p.vRotation += (Math.random() - 0.5) * 0.5;
      if (Math.abs(p.vy) < SETTLE_THRESHOLD) {
        p.vy = 0;
      }
    }

    // Wall collision
    if (p.x - p.width / 2 < 0) {
      p.x = p.width / 2;
      p.vx = -p.vx * DAMPING;
    } else if (p.x + p.width / 2 > canvasW) {
      p.x = canvasW - p.width / 2;
      p.vx = -p.vx * DAMPING;
    }

    // Check if settled
    if (Math.abs(p.vx) < SETTLE_THRESHOLD && Math.abs(p.vy) < SETTLE_THRESHOLD && p.y + p.height / 2 >= floorY - 1) {
      p.vx = 0;
      p.vy = 0;
      p.settled = true;
    }
  }

  // Inter-particle AABB collision (O(n²) — fine for ≤200 particles)
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    if (a.flung) continue;

    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      if (b.flung) continue;

      resolveCollision(a, b);
    }
  }
}

// ============================================================================
// Rendering (called each frame)
// ============================================================================

export function renderParticles(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = FONT;

  for (const p of particles) {
    // Measure text width on first render
    if (!p.measured) {
      const metrics = ctx.measureText(p.text);
      p.width = metrics.width + PARTICLE_PADDING_X * 2;
      p.measured = true;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, p.opacity);

    // Background
    const hw = p.width / 2;
    const hh = p.height / 2;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, p.width, p.height, BORDER_RADIUS);
    ctx.fillStyle = BG_COLOR;
    ctx.fill();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, 0, 1); // +1 for visual centering with monospace

    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// Helpers
// ============================================================================

function createParticle(id: string, text: string): Particle {
  // Estimate width (will be corrected on first render via measureText)
  const estimatedWidth = text.length * FONT_SIZE * 0.6 + PARTICLE_PADDING_X * 2;

  return {
    id,
    text,
    x: Math.random() * (canvasW * 0.6) + canvasW * 0.2,  // spawn in middle 60%
    y: -PARTICLE_HEIGHT - Math.random() * 60,               // above viewport
    vx: (Math.random() - 0.5) * 40,
    vy: Math.random() * 30 + 10,                            // slight initial downward
    width: estimatedWidth,
    height: PARTICLE_HEIGHT,
    rotation: (Math.random() - 0.5) * 0.1,
    vRotation: (Math.random() - 0.5) * 0.3,
    settled: false,
    flung: false,
    opacity: 1,
    measured: false,
  };
}

function resolveCollision(a: Particle, b: Particle): void {
  // AABB overlap check
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const aTop = a.y - a.height / 2;
  const aBottom = a.y + a.height / 2;

  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  const bTop = b.y - b.height / 2;
  const bBottom = b.y + b.height / 2;

  const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
  const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);

  if (overlapX <= 0 || overlapY <= 0) return; // No overlap

  // Push apart along axis of least overlap
  if (overlapX < overlapY) {
    // Separate horizontally
    const sign = a.x < b.x ? -1 : 1;
    const push = overlapX / 2 + 0.5;
    a.x += sign * push;
    b.x -= sign * push;

    // Swap horizontal velocities with damping
    if (!a.settled || !b.settled) {
      const tempVx = a.vx;
      a.vx = b.vx * DAMPING;
      b.vx = tempVx * DAMPING;
      a.settled = false;
      b.settled = false;
    }
  } else {
    // Separate vertically
    const sign = a.y < b.y ? -1 : 1;
    const push = overlapY / 2 + 0.5;
    a.y += sign * push;
    b.y -= sign * push;

    // Swap vertical velocities with damping
    if (!a.settled || !b.settled) {
      const tempVy = a.vy;
      a.vy = b.vy * DAMPING;
      b.vy = tempVy * DAMPING;
      a.settled = false;
      b.settled = false;
    }
  }

  // Add slight rotational response
  a.vRotation += (Math.random() - 0.5) * 0.2;
  b.vRotation += (Math.random() - 0.5) * 0.2;
}

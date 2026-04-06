/**
 * Intrusive Thoughts — Physics Engine for Projector Canvas
 *
 * Organic thought bubbles rendered as membrane shapes (matching the pentagon
 * skeleton aesthetic). Circle-based collision produces smooth sliding behavior.
 *
 * Module-level state (same pattern as finale renderer).
 * All constants are tunable at the top of the file.
 */

import { smoothNoise, rgb } from './shared';
import type { RGB } from './shared';

// ============================================================================
// Tunable Constants
// ============================================================================

// Physics
const GRAVITY_BASE = 380;         // px/s² — base gravity (scaled by size)
const GRAVITY_SIZE_SCALE = 0.4;   // how much size affects fall speed (0 = none, 1 = fully proportional)
const DAMPING = 0.4;              // velocity retained on collision (low = soft/sliding)
const FRICTION = 0.97;            // per-frame velocity decay
const SETTLE_THRESHOLD = 1.5;     // velocity below which particle is "settled"
const SETTLE_FLOOR_MARGIN = 2;    // px proximity to floor to consider settled
const COLLISION_OVERLAP = 0.25;   // fraction of combined radii that can overlap (0 = no overlap, 1 = full)
const SPAWN_STAGGER_MS = 40;      // ms between each particle spawn
const FLING_SPEED = 1400;         // px/s for dismissed particles
const FLING_VY = -150;            // slight upward arc on fling

// Sizing — oval bubbles (radiusX > radiusY)
const MIN_RADIUS_X = 30;         // minimum horizontal radius
const RADIUS_X_PER_CHAR = 3.2;   // additional horizontal radius per character
const MAX_RADIUS_X = 80;         // cap
const RADIUS_Y = 30;             // fixed vertical radius
const FONT_SIZE = 12;             // px
const FONT = `${FONT_SIZE}px monospace`;

// Membrane rendering
const MEMBRANE_SEGMENTS = 24;     // path segments per bubble (lower than skeleton's 48)
const MEMBRANE_NOISE_SETTLED = 0.06;  // subtle breathing when at rest
const MEMBRANE_NOISE_AIRBORNE = 0.12; // more wobble while falling
const MEMBRANE_NOISE_FLUNG = 0.20;    // stretchy distortion during fling
const MEMBRANE_SPEED_SETTLED = 0.6;   // slow breathing
const MEMBRANE_SPEED_AIRBORNE = 1.4;  // faster wobble

// Thought-bubble tail (sub-bubble)
const TAIL_RADIUS_RATIO = 0.22;    // sub-bubble radius relative to radiusY
const TAIL_OFFSET_X = 0.7;         // horizontal offset as ratio of radiusX (from center)
const TAIL_OFFSET_Y = 1.1;         // vertical offset as ratio of radiusY (below center)
const TAIL_SEGMENTS = 12;

// Colors
const BUBBLE_COLOR: RGB = { r: 180, g: 50, b: 50 };   // dark red membrane
const BUBBLE_FILL_ALPHA = 0.12;
const BUBBLE_STROKE_ALPHA = 0.35;
const TEXT_COLOR = 'rgba(255, 170, 170, 0.65)';
const TEXT_COLOR_FLUNG = 'rgba(255, 170, 170, 0.3)';

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
  radiusX: number;
  radiusY: number;
  settled: boolean;
  flung: boolean;
  opacity: number;
  seed: number;        // unique noise seed for membrane variation
  age: number;         // seconds since spawn (for animation phase)
  measured: boolean;
  tailSide: 'left' | 'right';  // which side the thought-bubble tail appears
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
let globalTime = 0;

// ============================================================================
// Public API
// ============================================================================

export function initThoughts(thoughts: { id: string; text: string }[]): void {
  const existingIds = new Set(particles.map(p => p.id));
  const newThoughts = thoughts.filter(t => !existingIds.has(t.id));
  spawnQueue = [...spawnQueue, ...newThoughts.map(t => ({ id: t.id, text: t.text }))];
  spawnTimer = 0;
}

export function dismissThought(id: string, direction: 'left' | 'right'): void {
  const p = particles.find(p => p.id === id);
  if (!p || p.flung) return;
  p.flung = true;
  p.settled = false;
  p.vx = direction === 'right' ? FLING_SPEED : -FLING_SPEED;
  p.vy = FLING_VY;
}

export function clearThoughts(): void {
  particles = [];
  spawnQueue = [];
  spawnTimer = 0;
}

export function getParticleCount(): number {
  return particles.length + spawnQueue.length;
}

// ============================================================================
// Physics Update
// ============================================================================

export function updatePhysics(dt: number, cw: number, ch: number): void {
  canvasW = cw;
  canvasH = ch;
  floorY = ch * 0.88;
  globalTime += dt;

  // Process spawn queue
  spawnTimer += dt * 1000;
  while (spawnQueue.length > 0 && spawnTimer >= SPAWN_STAGGER_MS) {
    spawnTimer -= SPAWN_STAGGER_MS;
    const item = spawnQueue.shift()!;
    particles.push(createParticle(item.id, item.text));
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;

    if (p.flung) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += GRAVITY_BASE * 0.5 * dt;
      p.opacity -= dt * 2.0;
      if (p.opacity <= 0 || p.x < -p.radiusX * 4 || p.x > canvasW + p.radiusX * 4) {
        particles.splice(i, 1);
      }
      continue;
    }

    if (p.settled) continue;

    // Gravity — larger bubbles fall slightly faster
    const sizeRatio = (p.radiusX + p.radiusY) / (MAX_RADIUS_X + RADIUS_Y);
    const gravity = GRAVITY_BASE * (1 + (sizeRatio - 0.5) * GRAVITY_SIZE_SCALE);
    p.vy += gravity * dt;

    // Friction
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    // Move
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Floor collision (use radiusY for vertical)
    if (p.y + p.radiusY > floorY) {
      p.y = floorY - p.radiusY;
      p.vy = -Math.abs(p.vy) * DAMPING;
      p.vx += (Math.random() - 0.5) * 15;
      if (Math.abs(p.vy) < SETTLE_THRESHOLD) {
        p.vy = 0;
      }
    }

    // Wall collision (use radiusX for horizontal)
    if (p.x - p.radiusX < 0) {
      p.x = p.radiusX;
      p.vx = Math.abs(p.vx) * DAMPING;
    } else if (p.x + p.radiusX > canvasW) {
      p.x = canvasW - p.radiusX;
      p.vx = -Math.abs(p.vx) * DAMPING;
    }

    // Settle check
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed < SETTLE_THRESHOLD && p.y + p.radiusY >= floorY - SETTLE_FLOOR_MARGIN) {
      p.vx = 0;
      p.vy = 0;
      p.settled = true;
    }
  }

  // Oval collision uses average radius for distance checks
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    if (a.flung) continue;

    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      if (b.flung) continue;

      resolveOvalCollision(a, b);
    }
  }
}

// ============================================================================
// Rendering
// ============================================================================

export function renderParticles(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = FONT;

  for (const p of particles) {
    // Measure text on first render to adjust radiusX
    if (!p.measured) {
      const metrics = ctx.measureText(p.text);
      p.radiusX = Math.min(Math.max(MIN_RADIUS_X, metrics.width / 2 + 14), MAX_RADIUS_X);
      p.measured = true;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.opacity);

    let noiseIntensity: number;
    let timeScale: number;
    if (p.flung) {
      noiseIntensity = MEMBRANE_NOISE_FLUNG;
      timeScale = MEMBRANE_SPEED_AIRBORNE * 2;
    } else if (p.settled) {
      noiseIntensity = MEMBRANE_NOISE_SETTLED;
      timeScale = MEMBRANE_SPEED_SETTLED;
    } else {
      noiseIntensity = MEMBRANE_NOISE_AIRBORNE;
      timeScale = MEMBRANE_SPEED_AIRBORNE;
    }

    // Draw oval membrane + tail sub-bubble
    drawThoughtMembrane(ctx, p.x, p.y, p.radiusX, p.radiusY, noiseIntensity, globalTime * timeScale, p.seed, p.tailSide);

    // Text centered inside
    ctx.fillStyle = p.flung ? TEXT_COLOR_FLUNG : TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, p.x, p.y + 1);

    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// Oval Membrane Drawing
// ============================================================================

function drawThoughtMembrane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  noiseIntensity: number,
  time: number,
  seed: number,
  tailSide: 'left' | 'right',
): void {
  // Main bubble
  ctx.beginPath();
  for (let i = 0; i <= MEMBRANE_SEGMENTS; i++) {
    const angle = (i / MEMBRANE_SEGMENTS) * Math.PI * 2;
    const noise = smoothNoise(
      Math.cos(angle) * 3,
      Math.sin(angle) * 3,
      time + seed,
    );
    const noiseMul = 1 + noise * noiseIntensity;
    const px = x + Math.cos(angle) * rx * noiseMul;
    const py = y + Math.sin(angle) * ry * noiseMul;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.fillStyle = rgb(BUBBLE_COLOR, BUBBLE_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = rgb(BUBBLE_COLOR, BUBBLE_STROKE_ALPHA);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Sub-bubble tail
  const tailSign = tailSide === 'right' ? 1 : -1;
  const tailX = x + rx * TAIL_OFFSET_X * tailSign;
  const tailY = y + ry * TAIL_OFFSET_Y;
  const tailR = ry * TAIL_RADIUS_RATIO;

  ctx.beginPath();
  for (let i = 0; i <= TAIL_SEGMENTS; i++) {
    const angle = (i / TAIL_SEGMENTS) * Math.PI * 2;
    const noise = smoothNoise(
      Math.cos(angle) * 4,
      Math.sin(angle) * 4,
      time * 1.5 + seed + 50,
    );
    const noiseMul = 1 + noise * noiseIntensity * 0.6;
    const px = tailX + Math.cos(angle) * tailR * noiseMul;
    const py = tailY + Math.sin(angle) * tailR * noiseMul;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.fillStyle = rgb(BUBBLE_COLOR, BUBBLE_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = rgb(BUBBLE_COLOR, BUBBLE_STROKE_ALPHA);
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ============================================================================
// Helpers
// ============================================================================

function createParticle(id: string, text: string): Particle {
  const estRadiusX = Math.min(
    Math.max(MIN_RADIUS_X, text.length * RADIUS_X_PER_CHAR + 12),
    MAX_RADIUS_X,
  );

  return {
    id,
    text,
    x: Math.random() * (canvasW * 0.6) + canvasW * 0.2,
    y: -RADIUS_Y - Math.random() * 80,
    vx: (Math.random() - 0.5) * 30,
    vy: Math.random() * 20 + 5,
    radiusX: estRadiusX,
    radiusY: RADIUS_Y,
    settled: false,
    flung: false,
    opacity: 1,
    seed: Math.random() * 100,
    age: 0,
    measured: false,
    tailSide: Math.random() > 0.5 ? 'right' : 'left',
  };
}

/** Collision using average of the two ovals' mean radii, with allowed overlap. */
function resolveOvalCollision(a: Particle, b: Particle): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const avgRadiusA = (a.radiusX + a.radiusY) / 2;
  const avgRadiusB = (b.radiusX + b.radiusY) / 2;
  // Allow some overlap — only push apart when closer than (1 - overlap) of combined radii
  const minDist = (avgRadiusA + avgRadiusB) * (1 - COLLISION_OVERLAP);

  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const overlap = minDist - dist;

  const nx = dx / dist;
  const ny = dy / dist;

  const push = overlap / 2 + 0.5;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;

  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const relVelNormal = dvx * nx + dvy * ny;

  if (relVelNormal <= 0) return;

  const impulse = relVelNormal * DAMPING;
  if (!a.settled) {
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    a.settled = false;
  }
  if (!b.settled) {
    b.vx += impulse * nx;
    b.vy += impulse * ny;
    b.settled = false;
  }

  if (a.settled && Math.abs(relVelNormal) > SETTLE_THRESHOLD * 3) a.settled = false;
  if (b.settled && Math.abs(relVelNormal) > SETTLE_THRESHOLD * 3) b.settled = false;
}

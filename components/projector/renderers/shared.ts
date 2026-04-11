/**
 * Projector Canvas — Shared drawing utilities
 *
 * Pure functions for membrane rendering, noise, color helpers, and layout constants.
 * No React, no state — just drawing primitives.
 */

// ============================================================================
// Types
// ============================================================================

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface NodeDef {
  id: string;
  symbol: string;
  label: string;
  angle: number;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface LayoutMetrics {
  centerX: number;
  centerY: number;
  orbitRadius: number;
  nodeRadius: number;
  seedRadius: number;
  positions: Record<string, NodePosition>;
}

// ============================================================================
// Constants
// ============================================================================

export const BG_COLOR = '#090909';
export const EMPTY_COLOR: RGB = { r: 60, g: 60, b: 55 };       // #3c3c37
export const COLLAPSED_COLOR: RGB = { r: 80, g: 30, b: 30 };   // #501e1e

/** Chapter colors for the projector pentagon — primary + per-option variants. */
export const FINALE_CHAPTER_COLORS: Record<string, { primary: RGB; A: RGB; B: RGB }> = {
  ambition: {
    primary: { r: 224, g: 96,  b: 112 },   // coral/rose
    A:       { r: 255, g: 107, b: 107 },   // warm coral
    B:       { r: 194, g: 24,  b: 91  },   // deep magenta
  },
  love: {
    primary: { r: 232, g: 167, b: 53  },   // amber/gold
    A:       { r: 255, g: 204, b: 128 },   // light peach
    B:       { r: 230, g: 81,  b: 0   },   // burnt orange
  },
  acceptance: {
    primary: { r: 69,  g: 176, b: 144 },   // teal/green
    A:       { r: 100, g: 181, b: 246 },   // sky blue
    B:       { r: 26,  g: 35,  b: 126 },   // deep indigo
  },
};

/** Pentagon node definitions — 5 nodes arranged clockwise from top. */
export const PENTAGON_NODES: NodeDef[] = [
  { id: 'bass',    symbol: '\u25A0', label: 'BASS',    angle: -Math.PI / 2 },                      // top
  { id: 'drums',   symbol: '\u25B2', label: 'DRUMS',   angle: -Math.PI / 2 + (2 * Math.PI / 5) },  // upper right
  { id: 'pad',     symbol: '\u25C6', label: 'PAD',     angle: -Math.PI / 2 + (4 * Math.PI / 5) },  // lower right
  { id: 'harmony', symbol: '\u25CF', label: 'HARMONY', angle: -Math.PI / 2 + (6 * Math.PI / 5) },  // lower left
  { id: 'fx',      symbol: '~',      label: 'FX',      angle: -Math.PI / 2 + (8 * Math.PI / 5) },  // upper left
];

/** Which granular types belong to each layer group. */
export const LAYER_GROUP_NODES: Record<string, string[]> = {
  bones: ['bass', 'drums'],
  flesh: ['harmony', 'pad'],
  spark: ['fx'],
};

// ============================================================================
// Color helpers
// ============================================================================

export function rgb(color: RGB, alpha: number): string {
  return `rgba(${color.r},${color.g},${color.b},${Math.max(0, Math.min(1, alpha))})`;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ============================================================================
// Math helpers
// ============================================================================

/** Clamp value to 0–1 range. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Linear interpolation between a and b. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation between two RGB colors. */
export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const c = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * c,
    g: a.g + (b.g - a.g) * c,
    b: a.b + (b.b - a.b) * c,
  };
}

/** Ease in-out (clamped 0–1). */
export function ease(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/** Sinusoidal pseudo-noise for membrane displacement. */
export function smoothNoise(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.7 + t * 0.8) * 0.3 +
    Math.sin(y * 2.3 + t * 0.6) * 0.3 +
    Math.sin((x + y) * 1.1 + t * 1.2) * 0.2 +
    Math.sin(x * 3.1 - t * 0.4) * 0.2
  );
}

// ============================================================================
// Layout computation
// ============================================================================

export function computeLayout(canvasW: number, canvasH: number): LayoutMetrics {
  const centerX = canvasW / 2;
  const centerY = canvasH * 0.44;
  const orbitRadius = Math.min(canvasW, canvasH) * 0.22;
  const nodeRadius = orbitRadius * 0.22;
  const seedRadius = nodeRadius * 1.4;

  const positions: Record<string, NodePosition> = {};
  for (const node of PENTAGON_NODES) {
    positions[node.id] = {
      x: centerX + Math.cos(node.angle) * orbitRadius,
      y: centerY + Math.sin(node.angle) * orbitRadius,
    };
  }

  return { centerX, centerY, orbitRadius, nodeRadius, seedRadius, positions };
}

// ============================================================================
// Membrane drawing
// ============================================================================

export function drawMembrane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRadius: number,
  color: RGB,
  alpha: number,
  noiseIntensity: number,
  amplitude: number,
  time: number,
  seed: number,
): void {
  const ampScale = 1 + amplitude * 0.15;
  const ampNoise = noiseIntensity + amplitude * 0.1;
  const effectiveRadius = baseRadius * ampScale;

  const segments = 48;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const noise = smoothNoise(
      Math.cos(angle) * 3,
      Math.sin(angle) * 3,
      time * 1.2 + seed,
    );
    const dist = effectiveRadius * (1 + noise * ampNoise);
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const ampAlpha = alpha * (1 + amplitude * 0.3);
  ctx.fillStyle = rgb(color, ampAlpha * 0.15);
  ctx.fill();
  ctx.strokeStyle = rgb(color, ampAlpha * 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

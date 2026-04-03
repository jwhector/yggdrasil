/**
 * Projector Canvas — Finale renderer
 *
 * Draws the pentagon skeleton in finale live mix mode:
 * - Each node independently colored by its active fragment's chapter
 * - Color crossfades over 1.5s when active fragment changes
 * - No bundle arcs (nodes are independent)
 * - Higher membrane displacement + independent breathing rates
 * - Center seed becomes "THE LEAD" in white
 * - Loop position ring around the pentagon orbit
 */

import type { ProjectorVisualState } from '../useProjectorState';
import {
  PENTAGON_NODES,
  EMPTY_COLOR,
  computeLayout,
  drawMembrane,
  rgb,
  lerpRgb,
  clamp01,
} from './shared';
import type { RGB } from './shared';
import { drawRadialLines } from './skeleton';

// ============================================================================
// Crossfade state (module-level, persists across frames)
// ============================================================================

const CROSSFADE_DURATION = 1500; // ms

interface CrossfadeEntry {
  fromColor: RGB;
  toColor: RGB;
  startTime: number;
}

const crossfadeState = new Map<string, CrossfadeEntry>();

function colorsEqual(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function getDisplayColor(nodeId: string, targetColor: RGB): RGB {
  const now = performance.now();
  const entry = crossfadeState.get(nodeId);

  if (!entry || !colorsEqual(entry.toColor, targetColor)) {
    // Target changed — start new crossfade from current display color
    let currentDisplay = targetColor;
    if (entry) {
      const progress = clamp01((now - entry.startTime) / CROSSFADE_DURATION);
      currentDisplay = lerpRgb(entry.fromColor, entry.toColor, progress);
    }
    crossfadeState.set(nodeId, { fromColor: currentDisplay, toColor: targetColor, startTime: now });
    return currentDisplay;
  }

  const progress = clamp01((now - entry.startTime) / CROSSFADE_DURATION);
  if (progress >= 1) return targetColor;
  return lerpRgb(entry.fromColor, entry.toColor, progress);
}

/** Clear crossfade state (call when leaving finale mode). */
export function resetCrossfadeState(): void {
  crossfadeState.clear();
}

// ============================================================================
// Loop position interpolation (module-level, persists across frames)
// ============================================================================

/**
 * Smoothly interpolates the loop position ring between server updates (~4 Hz).
 * Tracks the last received position + timestamp, estimates velocity from
 * consecutive updates, and extrapolates forward each frame.
 */
let loopInterp = {
  lastServerPos: 0,
  lastServerTime: 0,
  velocity: 0,         // position units per ms (estimated from server updates)
};

function getInterpolatedLoopPosition(serverPos: number): number {
  const now = performance.now();

  // Detect new server update (position changed)
  if (serverPos !== loopInterp.lastServerPos) {
    const dt = now - loopInterp.lastServerTime;
    if (loopInterp.lastServerTime > 0 && dt > 0 && dt < 2000) {
      // Estimate velocity, handling wrap-around (1.0 → 0.0)
      let delta = serverPos - loopInterp.lastServerPos;
      if (delta < -0.5) delta += 1; // wrapped
      loopInterp.velocity = delta / dt;
    }
    loopInterp.lastServerPos = serverPos;
    loopInterp.lastServerTime = now;
  }

  // Extrapolate from last server update
  const elapsed = now - loopInterp.lastServerTime;
  if (loopInterp.velocity <= 0 || elapsed > 1000) {
    // No velocity estimate yet or stale — just use server value
    return serverPos;
  }

  const extrapolated = loopInterp.lastServerPos + loopInterp.velocity * elapsed;
  return extrapolated % 1;
}

// ============================================================================
// Node seed values for independent breathing rates
// ============================================================================

const NODE_SEEDS: Record<string, number> = {
  bass: 0,
  drums: 1,
  pad: 2,
  harmony: 3,
  fx: 4,
};

// ============================================================================
// Main draw function
// ============================================================================

export function drawFinale(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
  alpha: number,
): void {
  if (alpha <= 0) return;

  const layout = computeLayout(state.canvasWidth, state.canvasHeight);
  const W = state.canvasWidth;
  const H = state.canvasHeight;

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;

  // Radial lines (all bright in finale — every node is active)
  drawRadialLines(ctx, layout, state);

  // Pentagon nodes
  for (const nodeDef of PENTAGON_NODES) {
    const pos = layout.positions[nodeDef.id];
    const nodeState = state.nodes[nodeDef.id];
    if (!nodeState) continue;

    const targetColor = nodeState.color;
    const displayColor = getDisplayColor(nodeDef.id, targetColor);
    const seed = NODE_SEEDS[nodeDef.id] ?? 0;

    // Independent breathing rate per node
    const breathingTime = t * (1.8 + seed * 0.3);

    // High-intensity membrane
    drawMembrane(
      ctx, pos.x, pos.y,
      layout.nodeRadius * 1.5,
      displayColor,
      1.0,       // full alpha
      0.18,      // high noise intensity (vs 0.04 filled, 0.12 active)
      0,         // amplitude (Phase 4 will wire this)
      breathingTime,
      seed * 7,  // phase offset
    );

    // Circle stroke
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, layout.nodeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(displayColor, 0.85);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();

    // Symbol
    ctx.fillStyle = rgb(displayColor, 0.9);
    ctx.font = `${layout.nodeRadius * 0.7}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nodeDef.symbol, pos.x, pos.y);

    // Label below node
    ctx.fillStyle = rgb(displayColor, 0.5);
    ctx.font = `${layout.nodeRadius * 0.35}px system-ui, sans-serif`;
    ctx.fillText(nodeDef.label, pos.x, pos.y + layout.nodeRadius + layout.nodeRadius * 0.5);
  }

  // Seed node — "THE LEAD", colored by active seed fragment's chapter
  const seedState = state.nodes['seed'];
  const seedTargetColor = seedState?.color ?? WHITE;
  const seedDisplayColor = getDisplayColor('seed', seedTargetColor);
  drawFinaleSeedNode(ctx, layout.centerX, layout.centerY, layout.seedRadius, seedDisplayColor, t);

  // Loop position ring
  drawLoopRing(ctx, layout.centerX, layout.centerY, layout.orbitRadius, layout.nodeRadius, state.loopPosition);

  // Finale header
  drawFinaleHeader(ctx, W, H);

  ctx.restore();
}

// ============================================================================
// Seed node (THE LEAD)
// ============================================================================

const WHITE: RGB = { r: 255, g: 255, b: 255 };

function drawFinaleSeedNode(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: RGB,
  t: number,
): void {
  // Membrane colored by active seed fragment's chapter
  drawMembrane(ctx, cx, cy, radius * 1.4, color, 0.6, 0.08, 0, t, 999);

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = rgb(color, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Symbol (✦)
  ctx.fillStyle = rgb(color, 0.9);
  ctx.font = `${radius * 0.8}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2726', cx, cy);

  // Label
  ctx.fillStyle = rgb(color, 0.5);
  ctx.font = `${radius * 0.35}px system-ui, sans-serif`;
  ctx.fillText('THE LEAD', cx, cy + radius + radius * 0.5);
}

// ============================================================================
// Loop position ring
// ============================================================================

function drawLoopRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  orbitRadius: number,
  nodeRadius: number,
  loopPosition: number,
): void {
  const ringRadius = orbitRadius + nodeRadius * 2.5;
  const startAngle = -Math.PI / 2; // top

  // Dim full-circle track
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bright progress arc
  if (loopPosition > 0) {
    const endAngle = startAngle + loopPosition * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Leading dot
    const dotX = cx + Math.cos(endAngle) * ringRadius;
    const dotY = cy + Math.sin(endAngle) * ringRadius;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }
}

// ============================================================================
// Finale header
// ============================================================================

function drawFinaleHeader(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  const topY = H * 0.06;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = `${W * 0.009}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '0.15em';
  ctx.fillText('LIVE MIX', W / 2, topY);
  ctx.letterSpacing = '0em';
}

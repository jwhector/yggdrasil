/**
 * Projector Canvas — Skeleton renderer
 *
 * Draws the pentagon skeleton: 5 granular-type nodes, center seed node,
 * radial connectors, and bundle arcs.
 */

import type { ProjectorVisualState } from '../useProjectorState';
import {
  PENTAGON_NODES,
  LAYER_GROUP_NODES,
  EMPTY_COLOR,
  COLLAPSED_COLOR,
  computeLayout,
  drawMembrane,
  rgb,
  smoothNoise,
} from './shared';
import type { RGB, LayoutMetrics } from './shared';

// ============================================================================
// Main skeleton draw
// ============================================================================

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
  alpha: number,
): void {
  if (alpha <= 0) return;

  const layout = computeLayout(state.canvasWidth, state.canvasHeight);

  ctx.save();
  ctx.globalAlpha = alpha;

  drawRadialLines(ctx, layout, state);
  drawBundleArcs(ctx, layout, state, t);

  for (const nodeDef of PENTAGON_NODES) {
    const pos = layout.positions[nodeDef.id];
    const nodeState = state.nodes[nodeDef.id];
    if (!nodeState) continue;

    drawNode(ctx, pos.x, pos.y, layout.nodeRadius, nodeDef, nodeState, t);
  }

  drawSeedNode(ctx, layout.centerX, layout.centerY, layout.seedRadius, state.chapterColor, t);

  ctx.restore();
}

// ============================================================================
// Node rendering
// ============================================================================

interface NodeState {
  state: 'empty' | 'active' | 'filled' | 'collapsed' | 'finale';
  color: RGB;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  nodeDef: { id: string; symbol: string; label: string },
  nodeState: NodeState,
  t: number,
): void {
  const { state: nState, color } = nodeState;

  // Membrane (only for active and filled)
  if (nState === 'active') {
    const pulseAlpha = 0.7 + 0.3 * Math.sin(t * 2.5);
    drawMembrane(ctx, x, y, radius * 1.5, color, pulseAlpha, 0.12, 0, t, hashSeed(nodeDef.id));
  } else if (nState === 'filled') {
    drawMembrane(ctx, x, y, radius * 1.5, color, 0.8, 0.04, 0, t, hashSeed(nodeDef.id));
  }

  // Circle stroke
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  switch (nState) {
    case 'empty':
      ctx.strokeStyle = rgb(EMPTY_COLOR, 0.5);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      break;
    case 'active': {
      const pulseAlpha = 0.7 + 0.3 * Math.sin(t * 2.5);
      ctx.strokeStyle = rgb(color, pulseAlpha);
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      break;
    }
    case 'filled':
      ctx.strokeStyle = rgb(color, 0.8);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      break;
    case 'collapsed':
      ctx.strokeStyle = rgb(COLLAPSED_COLOR, 0.4);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      break;
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // Symbol
  const symbolAlpha = nState === 'empty' ? 0.5 : nState === 'collapsed' ? 0.4 : 0.9;
  const symbolColor = nState === 'empty' ? EMPTY_COLOR
    : nState === 'collapsed' ? COLLAPSED_COLOR
    : color;

  ctx.fillStyle = rgb(symbolColor, symbolAlpha);
  ctx.font = `${radius * 0.7}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nodeDef.symbol, x, y);

  // Label below node
  ctx.fillStyle = rgb(symbolColor, symbolAlpha * 0.6);
  ctx.font = `${radius * 0.35}px system-ui, sans-serif`;
  ctx.fillText(nodeDef.label, x, y + radius + radius * 0.5);
}

function drawSeedNode(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  chapterColor: RGB,
  t: number,
): void {
  // Subtle membrane
  drawMembrane(ctx, cx, cy, radius * 1.4, chapterColor, 0.6, 0.05, 0, t, 999);

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = rgb(chapterColor, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Symbol
  ctx.fillStyle = rgb(chapterColor, 0.9);
  ctx.font = `${radius * 0.8}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2726', cx, cy); // ✦

  // Label
  ctx.fillStyle = rgb(chapterColor, 0.5);
  ctx.font = `${radius * 0.35}px system-ui, sans-serif`;
  ctx.fillText('MELODY', cx, cy + radius + radius * 0.5);
}

// ============================================================================
// Connectors
// ============================================================================

export function drawRadialLines(
  ctx: CanvasRenderingContext2D,
  layout: LayoutMetrics,
  state: ProjectorVisualState,
): void {
  for (const nodeDef of PENTAGON_NODES) {
    const pos = layout.positions[nodeDef.id];
    const nodeState = state.nodes[nodeDef.id];
    const isActive = nodeState?.state === 'active' || nodeState?.state === 'filled';
    const lineAlpha = isActive ? 0.15 : 0.08;

    ctx.beginPath();
    ctx.moveTo(layout.centerX, layout.centerY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBundleArcs(
  ctx: CanvasRenderingContext2D,
  layout: LayoutMetrics,
  state: ProjectorVisualState,
  t: number,
): void {
  const arcGroups: [string, string][] = [
    ['bass', 'drums'],     // bones
    ['harmony', 'pad'],    // flesh
  ];

  for (const [idA, idB] of arcGroups) {
    const posA = layout.positions[idA];
    const posB = layout.positions[idB];
    const stateA = state.nodes[idA];
    const stateB = state.nodes[idB];
    if (!stateA || !stateB) continue;

    const isActive = stateA.state === 'active' && stateB.state === 'active';
    const isFilled = stateA.state === 'filled' && stateB.state === 'filled';

    if (!isActive && !isFilled) continue;

    // Curved arc — quadratic bezier through a control point offset toward center
    const midX = (posA.x + posB.x) / 2;
    const midY = (posA.y + posB.y) / 2;
    const dx = midX - layout.centerX;
    const dy = midY - layout.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cpOffset = dist * 0.4;
    const cpX = midX - (dx / dist) * cpOffset;
    const cpY = midY - (dy / dist) * cpOffset;

    const color = stateA.color;

    if (isActive) {
      // Pulsing arc
      const arcAlpha = 0.2 + 0.15 * Math.sin(t * 3);
      ctx.beginPath();
      ctx.moveTo(posA.x, posA.y);
      ctx.quadraticCurveTo(cpX, cpY, posB.x, posB.y);
      ctx.strokeStyle = rgb(color, arcAlpha);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Traveling dot
      const dotT = (t * 0.5) % 1;
      const dotX = quadBezierPoint(posA.x, cpX, posB.x, dotT);
      const dotY = quadBezierPoint(posA.y, cpY, posB.y, dotT);
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fillStyle = rgb(color, 0.6);
      ctx.fill();
    } else {
      // Static subtle arc
      ctx.beginPath();
      ctx.moveTo(posA.x, posA.y);
      ctx.quadraticCurveTo(cpX, cpY, posB.x, posB.y);
      ctx.strokeStyle = rgb(color, 0.12);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function quadBezierPoint(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return h;
}

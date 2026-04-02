/**
 * Projector Canvas — Audition renderer
 *
 * Draws A/B option labels, "NOW PLAYING" indicator, sound descriptors,
 * and the header (layer group name, layer counter).
 */

import type { ProjectorVisualState } from '../useProjectorState';
import { computeLayout, rgb } from './shared';
import type { RGB } from './shared';

// ============================================================================
// Header
// ============================================================================

export function drawHeader(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
): void {
  if (state.mode === 'dark') return;

  const W = state.canvasWidth;
  const cx = W / 2;
  const topY = state.canvasHeight * 0.06;
  const color = state.chapterColor;

  // "SEQUENCE STATE" — small dim label
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = `${W * 0.01}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const statusText = state.currentAuditionOption
    ? 'AUDITIONING'
    : 'SONG ' + (state.currentAttemptIndex + 1);
  ctx.fillText(statusText, cx, topY);

  // Layer group label — large, chapter color
  ctx.fillStyle = rgb(color, 0.9);
  ctx.font = `bold ${W * 0.028}px system-ui, sans-serif`;
  ctx.fillText(state.layerGroupLabel.toUpperCase(), cx, topY + W * 0.032);

  // "LAYER X OF Y" — small dim
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = `${W * 0.01}px system-ui, sans-serif`;
  ctx.fillText(
    `LAYER ${state.currentLayerIndex + 1} OF ${state.totalLayers}`,
    cx,
    topY + W * 0.055,
  );
}

// ============================================================================
// A/B Labels
// ============================================================================

export function drawABLabels(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
): void {
  if (state.mode !== 'skeleton') return;
  if (!state.currentAuditionOption) return;

  const W = state.canvasWidth;
  const H = state.canvasHeight;
  const layout = computeLayout(W, H);
  const cx = layout.centerX;
  const labelY = layout.centerY;

  const aX = cx - W * 0.36;
  const bX = cx + W * 0.36;

  const isAActive = state.currentAuditionOption === 'A';
  const isBActive = state.currentAuditionOption === 'B';

  drawOptionLabel(ctx, 'A', aX, labelY, W, state.chapterColor, isAActive, state.labelA, t);
  drawOptionLabel(ctx, 'B', bX, labelY, W, state.chapterColor, isBActive, state.labelB, t);
}

function drawOptionLabel(
  ctx: CanvasRenderingContext2D,
  letter: string,
  x: number,
  y: number,
  canvasW: number,
  color: RGB,
  isActive: boolean,
  descriptor: string,
  t: number,
): void {
  const alpha = isActive ? 0.85 : 0.12;
  const letterSize = canvasW * 0.06;
  const descSize = canvasW * 0.012;

  // Pulsing glow for active
  if (isActive) {
    const glowAlpha = 0.08 + 0.05 * Math.sin(t * 3);
    const glowRadius = letterSize * 1.2;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    grad.addColorStop(0, rgb(color, glowAlpha));
    grad.addColorStop(1, rgb(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x - glowRadius, y - glowRadius, glowRadius * 2, glowRadius * 2);
  }

  // "NOW PLAYING" micro-label
  if (isActive) {
    ctx.fillStyle = rgb(color, 0.4);
    ctx.font = `${canvasW * 0.007}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOW PLAYING', x, y - letterSize * 0.7);
  }

  // Letter
  ctx.fillStyle = rgb(color, alpha);
  ctx.font = `bold ${letterSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y);

  // Sound descriptor below
  ctx.fillStyle = rgb(color, alpha * 0.6);
  ctx.font = `${descSize}px system-ui, sans-serif`;
  ctx.fillText(descriptor.toUpperCase(), x, y + letterSize * 0.6);
}

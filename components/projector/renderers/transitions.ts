/**
 * Projector Canvas — Transition renderers
 *
 * Smooth animated transitions between projector visual modes:
 * - Lock-in: verdict crossfades back to skeleton (next layer)
 * - Collapse to dark: verdict fades, collapsed skeleton flashes, fades to black
 * - Complete to dark: verdict fades, full skeleton flashes, fades to black
 */

import type { ProjectorVisualState } from '../useProjectorState';
import { BG_COLOR, ease, clamp01 } from './shared';
import { drawSkeleton } from './skeleton';
import { drawHeader, drawABLabels } from './audition';
import { drawVerdict } from './reveal';

// ============================================================================
// Types
// ============================================================================

export interface TransitionState {
  fromState: ProjectorVisualState;
  fromRevealElapsed: number;
  startTime: number;
  type: 'lockin' | 'collapse_to_dark' | 'complete_to_dark';
}

/** Duration in ms for each transition type. */
export const TRANSITION_DURATIONS: Record<TransitionState['type'], number> = {
  lockin: 1200,
  collapse_to_dark: 2200,
  complete_to_dark: 2000,
};

// ============================================================================
// Lock-in transition: verdict → skeleton (next layer)
// ============================================================================

/**
 * Crossfade from verdict to the new skeleton state.
 *
 * 0–800ms:   Verdict fades out
 * 400–1200ms: Skeleton + header + labels fade in
 */
export function drawLockinTransition(
  ctx: CanvasRenderingContext2D,
  fromState: ProjectorVisualState,
  toState: ProjectorVisualState,
  t: number,
  elapsed: number,
  fromRevealElapsed: number,
): void {
  const W = toState.canvasWidth;
  const H = toState.canvasHeight;

  // Outgoing verdict (0–800ms fade out)
  const verdictAlpha = 1 - ease(clamp01(elapsed / 800));
  if (verdictAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = verdictAlpha;
    drawVerdict(ctx, fromState, t, fromRevealElapsed);
    ctx.restore();
  }

  // Incoming skeleton (400–1200ms fade in)
  const skelAlpha = ease(clamp01((elapsed - 400) / 800));
  if (skelAlpha > 0) {
    drawHeader(ctx, toState, t);
    drawSkeleton(ctx, toState, t, skelAlpha);
    drawABLabels(ctx, toState, t);
  }
}

// ============================================================================
// Collapse transition: verdict → collapsed skeleton flash → dark
// ============================================================================

/**
 * Verdict fades, collapsed skeleton briefly visible with tremor, then dark.
 *
 * 0–800ms:    Verdict fades out
 * 600–1600ms: Collapsed skeleton appears with decaying tremor
 * 1600–2200ms: Everything fades to black
 */
export function drawCollapseTransition(
  ctx: CanvasRenderingContext2D,
  fromState: ProjectorVisualState,
  t: number,
  elapsed: number,
  fromRevealElapsed: number,
): void {
  const W = fromState.canvasWidth;

  // Outgoing verdict (0–800ms fade out)
  const verdictAlpha = 1 - ease(clamp01(elapsed / 800));
  if (verdictAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = verdictAlpha;
    drawVerdict(ctx, fromState, t, fromRevealElapsed);
    ctx.restore();
  }

  // Collapsed skeleton flash (600–1600ms)
  if (elapsed > 600 && elapsed < 2200) {
    // Bell curve alpha: fade in 600-1000, hold 1000-1400, fade out 1400-2200
    let skelAlpha: number;
    if (elapsed < 1000) {
      skelAlpha = ease(clamp01((elapsed - 600) / 400));
    } else if (elapsed < 1400) {
      skelAlpha = 1;
    } else {
      skelAlpha = 1 - ease(clamp01((elapsed - 1400) / 800));
    }

    // Decaying tremor
    const tremorDecay = 1 - clamp01((elapsed - 600) / 1000);
    const tremor = Math.sin(t * 25) * W * 0.003 * tremorDecay;

    ctx.save();
    ctx.translate(tremor, 0);
    drawSkeleton(ctx, fromState, t, skelAlpha);
    ctx.restore();
  }
}

// ============================================================================
// Complete transition: verdict → full skeleton flash → dark
// ============================================================================

/**
 * Verdict fades, fully filled skeleton appears, then fades to dark.
 *
 * 0–800ms:    Verdict fades out
 * 400–1400ms: Skeleton appears (all nodes filled)
 * 1400–2000ms: Everything fades to black
 */
export function drawCompleteTransition(
  ctx: CanvasRenderingContext2D,
  fromState: ProjectorVisualState,
  t: number,
  elapsed: number,
  fromRevealElapsed: number,
): void {
  // Outgoing verdict (0–800ms fade out)
  const verdictAlpha = 1 - ease(clamp01(elapsed / 800));
  if (verdictAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = verdictAlpha;
    drawVerdict(ctx, fromState, t, fromRevealElapsed);
    ctx.restore();
  }

  // Filled skeleton flash (400–2000ms)
  if (elapsed > 400) {
    let skelAlpha: number;
    if (elapsed < 1400) {
      skelAlpha = ease(clamp01((elapsed - 400) / 600));
    } else {
      skelAlpha = 1 - ease(clamp01((elapsed - 1400) / 600));
    }

    if (skelAlpha > 0) {
      drawSkeleton(ctx, fromState, t, skelAlpha);
    }
  }
}

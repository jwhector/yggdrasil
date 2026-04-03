/**
 * Projector Canvas — Reveal renderer
 *
 * Two-beat reveal animation:
 * Beat 1 (stakes): skeleton fades, A/B slide to center, threshold line appears
 * Beat 2 (verdict): bars grow to vote proportions, pass/fail verdict text
 */

import type { ProjectorVisualState } from '../useProjectorState';
import { computeLayout, rgb, ease, clamp01, lerp } from './shared';
import type { RGB } from './shared';

// ============================================================================
// Bar geometry helpers
// ============================================================================

interface BarLayout {
  aX: number;
  bX: number;
  labelY: number;
  barBottom: number;
  barTop: number;
  barMaxHeight: number;
  barWidth: number;
}

function computeBarLayout(W: number, H: number): BarLayout {
  const cx = W / 2;
  const gap = W * 0.13;
  const aX = cx - gap / 2;
  const bX = cx + gap / 2;
  const labelY = H * 0.84;
  const barBottom = labelY - W * 0.032;
  const barTop = H * 0.16;
  const barMaxHeight = barBottom - barTop;
  const barWidth = W * 0.038;

  return { aX, bX, labelY, barBottom, barTop, barMaxHeight, barWidth };
}

// ============================================================================
// Beat 1: Stakes
// ============================================================================

export function drawStakes(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
  elapsed: number,
): void {
  const W = state.canvasWidth;
  const H = state.canvasHeight;
  const layout = computeLayout(W, H);
  const bars = computeBarLayout(W, H);
  const color = state.chapterColor;

  // A/B label positions: slide from sides to center bottom
  const slideProgress = ease(clamp01((elapsed - 400) / 800));
  const sideAX = layout.centerX - W * 0.36;
  const sideBX = layout.centerX + W * 0.36;
  const aX = lerp(sideAX, bars.aX, slideProgress);
  const bX = lerp(sideBX, bars.bX, slideProgress);
  const labelStartY = layout.centerY;
  const labelY = lerp(labelStartY, bars.labelY, slideProgress);

  // Draw A/B labels at interpolated positions
  const labelAlpha = 0.85;
  const letterSize = W * 0.06;

  ctx.fillStyle = rgb(color, labelAlpha);
  ctx.font = `bold ${letterSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', aX, labelY);
  ctx.fillText('B', bX, labelY);

  // Sound descriptors below labels
  const descAlpha = slideProgress * 0.5;
  const descSize = W * 0.012;
  ctx.fillStyle = rgb(color, descAlpha);
  ctx.font = `${descSize}px system-ui, sans-serif`;
  ctx.fillText(state.labelA.toUpperCase(), aX, labelY + letterSize * 0.6);
  ctx.fillText(state.labelB.toUpperCase(), bX, labelY + letterSize * 0.6);

  // Empty bar tracks (fade in 400–1200ms)
  const trackAlpha = ease(clamp01((elapsed - 400) / 800)) * 0.08;
  if (trackAlpha > 0) {
    ctx.fillStyle = `rgba(255,255,255,${trackAlpha})`;
    ctx.fillRect(aX - bars.barWidth / 2, bars.barTop, bars.barWidth, bars.barMaxHeight);
    ctx.fillRect(bX - bars.barWidth / 2, bars.barTop, bars.barWidth, bars.barMaxHeight);
  }

  // Threshold line (animate upward 1000–1800ms)
  if (elapsed > 1000 && state.thresholdCheck) {
    const lineProgress = ease(clamp01((elapsed - 1000) / 800));
    const threshold = state.thresholdCheck.threshold;
    const targetY = bars.barBottom - threshold * bars.barMaxHeight;
    const currentY = lerp(bars.barBottom, targetY, lineProgress);

    // Line spanning both bars
    const lineLeft = Math.min(aX, bX) - bars.barWidth;
    const lineRight = Math.max(aX, bX) + bars.barWidth;

    ctx.beginPath();
    ctx.moveTo(lineLeft, currentY);
    ctx.lineTo(lineRight, currentY);
    ctx.strokeStyle = `rgba(255,255,255,${0.6 * lineProgress})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Percentage label
    if (lineProgress > 0.5) {
      const labelFade = ease((lineProgress - 0.5) / 0.5);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * labelFade})`;
      ctx.font = `bold ${W * 0.014}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(
        `${Math.round(threshold * 100)}%`,
        lineLeft - W * 0.01,
        currentY + 1,
      );
      ctx.textAlign = 'center';
    }
  }
}

// ============================================================================
// Beat 2: Verdict
// ============================================================================

export function drawVerdict(
  ctx: CanvasRenderingContext2D,
  state: ProjectorVisualState,
  t: number,
  elapsed: number,
): void {
  const W = state.canvasWidth;
  const H = state.canvasHeight;
  const bars = computeBarLayout(W, H);
  const color = state.chapterColor;

  const vr = state.voteResult;
  const tc = state.thresholdCheck;
  if (!vr || !tc) {
    // No data — draw stakes end state as fallback
    drawStakes(ctx, state, t, 2000);
    return;
  }

  const totalVotes = vr.votesA + vr.votesB;
  const propA = totalVotes > 0 ? vr.votesA / totalVotes : 0.5;
  const propB = totalVotes > 0 ? vr.votesB / totalVotes : 0.5;
  const isAWinner = vr.winner === 'A';
  const passed = tc.passed;

  // Labels at final positions
  const letterSize = W * 0.06;
  const descSize = W * 0.012;

  // Winner/loser label brightness (800ms transition)
  const labelBrightness = ease(clamp01(elapsed / 800));
  const winnerAlpha = 0.85;
  const loserAlpha = lerp(0.85, 0.25, labelBrightness);

  // A label
  ctx.fillStyle = rgb(color, isAWinner ? winnerAlpha : loserAlpha);
  ctx.font = `bold ${letterSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', bars.aX, bars.labelY);

  // B label
  ctx.fillStyle = rgb(color, isAWinner ? loserAlpha : winnerAlpha);
  ctx.fillText('B', bars.bX, bars.labelY);

  // Descriptor labels
  ctx.font = `${descSize}px system-ui, sans-serif`;
  ctx.fillStyle = rgb(color, (isAWinner ? winnerAlpha : loserAlpha) * 0.6);
  ctx.fillText(state.labelA.toUpperCase(), bars.aX, bars.labelY + letterSize * 0.6);
  ctx.fillStyle = rgb(color, (isAWinner ? loserAlpha : winnerAlpha) * 0.6);
  ctx.fillText(state.labelB.toUpperCase(), bars.bX, bars.labelY + letterSize * 0.6);

  // Empty bar tracks
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(bars.aX - bars.barWidth / 2, bars.barTop, bars.barWidth, bars.barMaxHeight);
  ctx.fillRect(bars.bX - bars.barWidth / 2, bars.barTop, bars.barWidth, bars.barMaxHeight);

  // Bar growth (0–1600ms)
  const growProgress = ease(clamp01(elapsed / 1600));
  const barHeightA = propA * bars.barMaxHeight * growProgress;
  const barHeightB = propB * bars.barMaxHeight * growProgress;
  const winnerBarAlpha = 0.4;
  const loserBarAlpha = 0.12;

  // A bar
  ctx.fillStyle = rgb(color, isAWinner ? winnerBarAlpha : loserBarAlpha);
  ctx.fillRect(
    bars.aX - bars.barWidth / 2,
    bars.barBottom - barHeightA,
    bars.barWidth,
    barHeightA,
  );

  // B bar
  ctx.fillStyle = rgb(color, isAWinner ? loserBarAlpha : winnerBarAlpha);
  ctx.fillRect(
    bars.bX - bars.barWidth / 2,
    bars.barBottom - barHeightB,
    bars.barWidth,
    barHeightB,
  );

  // Percentage labels above bars (fade in from 500ms)
  if (elapsed > 500) {
    const pctFade = ease(clamp01((elapsed - 500) / 500));
    const pctSize = W * 0.013;
    ctx.font = `bold ${pctSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    ctx.fillStyle = rgb(color, (isAWinner ? 0.8 : 0.3) * pctFade);
    ctx.fillText(
      `${Math.round(propA * 100)}%`,
      bars.aX,
      bars.barBottom - barHeightA - W * 0.008,
    );

    ctx.fillStyle = rgb(color, (isAWinner ? 0.3 : 0.8) * pctFade);
    ctx.fillText(
      `${Math.round(propB * 100)}%`,
      bars.bX,
      bars.barBottom - barHeightB - W * 0.008,
    );
  }

  // Threshold line
  const thresholdY = bars.barBottom - tc.threshold * bars.barMaxHeight;
  const lineLeft = Math.min(bars.aX, bars.bX) - bars.barWidth;
  const lineRight = Math.max(bars.aX, bars.bX) + bars.barWidth;

  // Line turns red on fail after bars reach height
  const lineColor = elapsed > 1600 && !passed
    ? 'rgba(239,68,68,0.8)'
    : 'rgba(255,255,255,0.6)';

  ctx.beginPath();
  ctx.moveTo(lineLeft, thresholdY);
  ctx.lineTo(lineRight, thresholdY);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Threshold percentage label
  ctx.fillStyle = lineColor;
  ctx.font = `bold ${W * 0.014}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${Math.round(tc.threshold * 100)}%`,
    lineLeft - W * 0.01,
    thresholdY + 1,
  );

  // Verdict text (1600–2100ms)
  if (elapsed > 1600) {
    const verdictFade = ease(clamp01((elapsed - 1600) / 500));
    const verdictSize = W * 0.022;
    const verdictY = bars.barTop - W * 0.03;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (passed) {
      // "THRESHOLD MET" — amber, pulsing
      const pulse = 0.7 + 0.3 * Math.sin(t * 4);
      ctx.fillStyle = `rgba(232,167,53,${verdictFade * pulse})`;
      ctx.font = `bold ${verdictSize}px system-ui, sans-serif`;
      ctx.fillText('THRESHOLD MET', W / 2, verdictY);
    } else {
      // "DOUBT OVERWHELMS" — red, trembling
      const tremble = Math.sin(t * 20) * W * 0.002;
      ctx.fillStyle = `rgba(239,68,68,${verdictFade * 0.9})`;
      ctx.font = `bold ${verdictSize}px system-ui, sans-serif`;
      ctx.fillText('DOUBT OVERWHELMS', W / 2 + tremble, verdictY);
    }
  }
}


/**
 * Doubt Threshold — Per-layer pass/fail consensus check.
 *
 * Each layer has a threshold (configured per song in default-show.json).
 * If the winning proportion < threshold, the song collapses.
 * No cumulative state — each vote is independent.
 */

export function checkThreshold(
  votesA: number,
  votesB: number,
  threshold: number
): { passed: boolean; winningProportion: number } {
  const total = votesA + votesB;
  if (total === 0) return { passed: false, winningProportion: 0 };
  const winningProportion = Math.max(votesA, votesB) / total;
  return {
    passed: winningProportion >= threshold,
    winningProportion,
  };
}

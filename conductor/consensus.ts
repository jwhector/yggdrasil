/**
 * Consensus — Vote Tallying & Doubt Threshold
 *
 * Pure functions for calculating vote results and checking doubt thresholds.
 * No I/O, no state mutation.
 */

import type { LayerVote, VoteResult } from './types';

/**
 * Calculate consensus from a set of votes for a single layer.
 *
 * Consensus = max(votesA, votesB) / totalVotes
 * Winner is the option with more votes (A wins ties).
 */
export function calculateConsensus(votes: LayerVote[]): {
  consensus: number;
  winner: 'A' | 'B';
  votesA: number;
  votesB: number;
  totalVotes: number;
} {
  const votesA = votes.filter(v => v.choice === 'A').length;
  const votesB = votes.filter(v => v.choice === 'B').length;
  const total = votesA + votesB;

  if (total === 0) {
    return { consensus: 0, winner: 'A', votesA: 0, votesB: 0, totalVotes: 0 };
  }

  const winner: 'A' | 'B' = votesA >= votesB ? 'A' : 'B';
  const consensus = Math.max(votesA, votesB) / total;

  return { consensus, winner, votesA, votesB, totalVotes: total };
}

/**
 * Check whether consensus meets the doubt threshold and produce a full VoteResult.
 *
 * @param votes - All votes for the layer
 * @param doubtThreshold - The threshold to beat, or null for simple majority
 * @returns Full vote result including threshold check
 */
export function resolveVote(
  votes: LayerVote[],
  doubtThreshold: number | null
): VoteResult {
  const { consensus, winner, votesA, votesB, totalVotes } = calculateConsensus(votes);

  const thresholdMet = doubtThreshold === null || consensus >= doubtThreshold;

  return {
    winner,
    consensus,
    votesA,
    votesB,
    totalVotes,
    thresholdMet,
    doubtThreshold,
  };
}

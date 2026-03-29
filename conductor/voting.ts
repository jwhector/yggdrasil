/**
 * Voting — Blind vote tallying
 *
 * Pure functions for calculating vote results.
 * Threshold checking is handled in threshold.ts (Phase 2).
 *
 * No I/O, no state mutation.
 */

import type { LayerVote, VoteResult } from './types';

/**
 * Calculate consensus from a set of votes for a single layer.
 *
 * winningProportion = max(votesA, votesB) / totalVotes
 * Winner is the option with more votes (A wins ties).
 */
export function calculateConsensus(votes: LayerVote[]): {
  winningProportion: number;
  winner: 'A' | 'B';
  votesA: number;
  votesB: number;
  totalVotes: number;
} {
  const votesA = votes.filter(v => v.choice === 'A').length;
  const votesB = votes.filter(v => v.choice === 'B').length;
  const total = votesA + votesB;

  if (total === 0) {
    return { winningProportion: 0, winner: 'A', votesA: 0, votesB: 0, totalVotes: 0 };
  }

  const winner: 'A' | 'B' = votesA >= votesB ? 'A' : 'B';
  const winningProportion = Math.max(votesA, votesB) / total;

  return { winningProportion, winner, votesA, votesB, totalVotes: total };
}

/**
 * Calculate the full vote result for a layer.
 *
 * Returns VoteResult with winner, winningProportion, and vote counts.
 * Threshold check is performed separately in the conductor after this.
 */
export function calculateVoteResult(votes: LayerVote[]): VoteResult {
  const { winningProportion, winner, votesA, votesB, totalVotes } = calculateConsensus(votes);
  return { winner, consensus: winningProportion, votesA, votesB, totalVotes };
}

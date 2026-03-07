/**
 * Voting — Blind vote tallying and health bar drain calculation
 *
 * Pure functions for calculating vote results and associated health bar drain.
 * Replaces the old consensus.ts which included per-layer doubt threshold logic.
 *
 * No I/O, no state mutation.
 */

import type { LayerVote, VoteResult } from './types';
import { calculateDrain } from './health-bar';
import type { HealthBarDrain } from './types';

/**
 * Calculate consensus from a set of votes for a single layer.
 *
 * consensus = max(votesA, votesB) / totalVotes
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
 * Calculate the full vote result for a layer, including health bar drain.
 *
 * Returns the VoteResult (winner, consensus, counts) and a HealthBarDrain
 * (with healthAfter=0 as placeholder — call applyDrain to finalize).
 */
export function calculateVoteResult(
  votes: LayerVote[],
  drainFactor: number,
  layerMultiplier: number,
  layerIndex: number,
): {
  voteResult: VoteResult;
  drain: HealthBarDrain;
} {
  const { consensus, winner, votesA, votesB, totalVotes } = calculateConsensus(votes);
  const drain = calculateDrain(votesA, votesB, drainFactor, layerMultiplier, layerIndex);

  return {
    voteResult: { winner, consensus, votesA, votesB, totalVotes },
    drain,
  };
}

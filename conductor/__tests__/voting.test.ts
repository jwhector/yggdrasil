/**
 * Voting — Unit Tests
 */

import { describe, test, expect } from '@jest/globals';
import { calculateConsensus, calculateVoteResult } from '../voting';
import type { LayerVote } from '../types';

function makeVote(choice: 'A' | 'B', userId = `user-${Math.random()}`): LayerVote {
  return { userId, attemptIndex: 0, layerIndex: 0, choice, timestamp: Date.now() };
}

// ============================================================================
// calculateConsensus
// ============================================================================

describe('calculateConsensus', () => {
  test('returns zero consensus and A as winner when there are no votes', () => {
    const result = calculateConsensus([]);
    expect(result.consensus).toBe(0);
    expect(result.winner).toBe('A');
    expect(result.totalVotes).toBe(0);
  });

  test('returns 100% consensus when all votes are for A', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A')];
    const result = calculateConsensus(votes);
    expect(result.consensus).toBe(1.0);
    expect(result.winner).toBe('A');
    expect(result.votesA).toBe(3);
    expect(result.votesB).toBe(0);
  });

  test('returns 100% consensus when all votes are for B', () => {
    const votes = [makeVote('B'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.consensus).toBe(1.0);
    expect(result.winner).toBe('B');
  });

  test('returns 50% consensus for an even split and A wins ties', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.consensus).toBe(0.5);
    expect(result.winner).toBe('A');
  });

  test('correctly calculates consensus for a 3:1 split', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.consensus).toBe(0.75);
    expect(result.winner).toBe('A');
    expect(result.votesA).toBe(3);
    expect(result.votesB).toBe(1);
    expect(result.totalVotes).toBe(4);
  });

  test('correctly identifies B as winner when B has more votes', () => {
    const votes = [makeVote('A'), makeVote('B'), makeVote('B'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.consensus).toBe(0.75);
    expect(result.winner).toBe('B');
  });

  test('majority wins regardless of margin', () => {
    // 6:4 split — A wins by just 2 votes
    const votes = [
      makeVote('A'), makeVote('A'), makeVote('A'),
      makeVote('A'), makeVote('A'), makeVote('A'),
      makeVote('B'), makeVote('B'), makeVote('B'), makeVote('B'),
    ];
    const result = calculateConsensus(votes);
    expect(result.winner).toBe('A');
    expect(result.consensus).toBeCloseTo(0.6);
  });
});

// ============================================================================
// calculateVoteResult
// ============================================================================

describe('calculateVoteResult', () => {
  test('vote result includes drain calculation with layer multiplier', () => {
    // 7A, 3B: losingProportion = 0.3, drain = 0.3 * 100 * 0.5 * 1.0 = 15
    const votes = Array.from({ length: 7 }, () => makeVote('A'))
      .concat(Array.from({ length: 3 }, () => makeVote('B')));

    const { voteResult, drain } = calculateVoteResult(votes, 0.5, 1.0, 0);

    expect(voteResult.winner).toBe('A');
    expect(voteResult.votesA).toBe(7);
    expect(voteResult.votesB).toBe(3);
    expect(voteResult.totalVotes).toBe(10);
    expect(drain.drainAmount).toBeCloseTo(15);
    expect(drain.layerIndex).toBe(0);
    expect(drain.layerMultiplier).toBe(1.0);
  });

  test('layer multiplier scales the drain proportionally', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A'), makeVote('B')];
    // drainFactor=0.5, multiplier=2.0 → drain = 0.25 * 100 * 0.5 * 2.0 = 25

    const { drain } = calculateVoteResult(votes, 0.5, 2.0, 3);

    expect(drain.drainAmount).toBeCloseTo(25);
    expect(drain.layerIndex).toBe(3);
    expect(drain.layerMultiplier).toBe(2.0);
  });

  test('tie defaults to Option A as winner', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const { voteResult } = calculateVoteResult(votes, 0.5, 1.0, 0);
    expect(voteResult.winner).toBe('A');
  });

  test('unanimous vote produces zero drain', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A')];
    const { drain } = calculateVoteResult(votes, 0.5, 1.0, 0);
    expect(drain.drainAmount).toBe(0);
  });

  test('higher layer index uses correct multiplier', () => {
    // 50/50 split, factor=0.5, multiplier for layer 6 = 2.0
    const votes = [makeVote('A'), makeVote('B')];
    const { drain: lowDrain } = calculateVoteResult(votes, 0.5, 0.5, 0);
    const { drain: highDrain } = calculateVoteResult(votes, 0.5, 2.0, 6);

    expect(highDrain.drainAmount).toBeGreaterThan(lowDrain.drainAmount);
  });

  test('drain healthAfter starts at 0 (placeholder before applyDrain)', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const { drain } = calculateVoteResult(votes, 0.5, 1.0, 0);
    expect(drain.healthAfter).toBe(0);
  });
});

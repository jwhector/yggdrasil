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
    expect(result.winningProportion).toBe(0);
    expect(result.winner).toBe('A');
    expect(result.totalVotes).toBe(0);
  });

  test('returns 100% consensus when all votes are for A', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A')];
    const result = calculateConsensus(votes);
    expect(result.winningProportion).toBe(1.0);
    expect(result.winner).toBe('A');
    expect(result.votesA).toBe(3);
    expect(result.votesB).toBe(0);
  });

  test('returns 100% consensus when all votes are for B', () => {
    const votes = [makeVote('B'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.winningProportion).toBe(1.0);
    expect(result.winner).toBe('B');
  });

  test('returns 50% consensus for an even split and A wins ties', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.winningProportion).toBe(0.5);
    expect(result.winner).toBe('A');
  });

  test('correctly calculates consensus for a 3:1 split', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.winningProportion).toBe(0.75);
    expect(result.winner).toBe('A');
    expect(result.votesA).toBe(3);
    expect(result.votesB).toBe(1);
    expect(result.totalVotes).toBe(4);
  });

  test('correctly identifies B as winner when B has more votes', () => {
    const votes = [makeVote('A'), makeVote('B'), makeVote('B'), makeVote('B')];
    const result = calculateConsensus(votes);
    expect(result.winningProportion).toBe(0.75);
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
    expect(result.winningProportion).toBeCloseTo(0.6);
  });
});

// ============================================================================
// calculateVoteResult
// ============================================================================

describe('calculateVoteResult', () => {
  test('returns winner and vote counts for a majority split', () => {
    const votes = Array.from({ length: 7 }, () => makeVote('A'))
      .concat(Array.from({ length: 3 }, () => makeVote('B')));

    const result = calculateVoteResult(votes);

    expect(result.winner).toBe('A');
    expect(result.votesA).toBe(7);
    expect(result.votesB).toBe(3);
    expect(result.totalVotes).toBe(10);
    expect(result.consensus).toBeCloseTo(0.7);
  });

  test('tie defaults to Option A as winner', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const result = calculateVoteResult(votes);
    expect(result.winner).toBe('A');
  });

  test('unanimous vote has consensus of 1.0', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A')];
    const result = calculateVoteResult(votes);
    expect(result.consensus).toBe(1.0);
    expect(result.winner).toBe('A');
  });

  test('empty votes return A as winner with zero consensus', () => {
    const result = calculateVoteResult([]);
    expect(result.winner).toBe('A');
    expect(result.totalVotes).toBe(0);
  });
});

/**
 * Consensus — Vote Tallying & Doubt Threshold Tests
 */

import { describe, test, expect } from '@jest/globals';
import { calculateConsensus, resolveVote } from '../consensus';
import type { LayerVote } from '../types';

function makeVote(choice: 'A' | 'B', userId = `user-${Math.random()}`): LayerVote {
  return { userId, attemptIndex: 0, layerIndex: 0, choice, timestamp: Date.now() };
}

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
});

describe('resolveVote', () => {
  test('threshold is met when doubt threshold is null (simple majority)', () => {
    const votes = [makeVote('A'), makeVote('B')];
    const result = resolveVote(votes, null);
    expect(result.thresholdMet).toBe(true);
    expect(result.doubtThreshold).toBeNull();
  });

  test('threshold is met when consensus equals the threshold exactly', () => {
    // 3 out of 4 = 75%
    const votes = [makeVote('A'), makeVote('A'), makeVote('A'), makeVote('B')];
    const result = resolveVote(votes, 0.75);
    expect(result.thresholdMet).toBe(true);
    expect(result.consensus).toBe(0.75);
  });

  test('threshold is met when consensus exceeds the threshold', () => {
    const votes = [makeVote('A'), makeVote('A'), makeVote('A'), makeVote('A'), makeVote('B')];
    const result = resolveVote(votes, 0.75);
    expect(result.thresholdMet).toBe(true);
    expect(result.consensus).toBe(0.8);
  });

  test('threshold is NOT met when consensus is below the threshold', () => {
    // 2 out of 4 = 50%, threshold 65%
    const votes = [makeVote('A'), makeVote('A'), makeVote('B'), makeVote('B')];
    const result = resolveVote(votes, 0.65);
    expect(result.thresholdMet).toBe(false);
    expect(result.consensus).toBe(0.5);
    expect(result.doubtThreshold).toBe(0.65);
  });

  test('returns the correct winner and vote counts in the full result', () => {
    const votes = [makeVote('B'), makeVote('B'), makeVote('A')];
    const result = resolveVote(votes, 0.6);
    expect(result.winner).toBe('B');
    expect(result.votesA).toBe(1);
    expect(result.votesB).toBe(2);
    expect(result.totalVotes).toBe(3);
    expect(result.thresholdMet).toBe(true);
  });
});

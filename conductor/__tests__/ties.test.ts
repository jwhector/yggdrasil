/**
 * Tie Detection and Resolution Tests
 */

import { describe, test, expect } from '@jest/globals';
import { detectTie, resolveTie } from '../ties';
import type { FactionResult, FactionId } from '../types';

// Helper to create faction result
function createFactionResult(
  factionId: FactionId,
  rawCoherence: number,
  weightedCoherence: number,
  voteCount: number,
  votedForOption: string
): FactionResult {
  return {
    factionId,
    rawCoherence,
    weightedCoherence,
    voteCount,
    votedForOption,
  };
}

describe('detectTie', () => {
  test('detects a tie when two factions have identical weighted coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 0.8, 0.8, 5, 'optionA'),
      createFactionResult(1, 0.8, 0.8, 6, 'optionB'),
      createFactionResult(2, 0.6, 0.6, 4, 'optionC'),
      createFactionResult(3, 0.5, 0.5, 3, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(true);
    expect(tieInfo.tiedFactionIds).toEqual([0, 1]);
  });

  test('detects a tie when three factions have identical weighted coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 1.0, 1.5, 5, 'optionA'),
      createFactionResult(1, 1.0, 1.5, 5, 'optionB'),
      createFactionResult(2, 1.0, 1.5, 5, 'optionC'),
      createFactionResult(3, 0.9, 0.9, 5, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(true);
    expect(tieInfo.tiedFactionIds).toEqual([0, 1, 2]);
  });

  test('detects no tie when all factions have different coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 1.0, 1.0, 5, 'optionA'),
      createFactionResult(1, 0.9, 0.9, 5, 'optionB'),
      createFactionResult(2, 0.8, 0.8, 5, 'optionC'),
      createFactionResult(3, 0.7, 0.7, 5, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(false);
    expect(tieInfo.tiedFactionIds).toEqual([]);
  });

  test('detects no tie when only one faction has the maximum coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 0.6, 0.6, 3, 'optionA'),
      createFactionResult(1, 0.8, 0.8, 4, 'optionB'),
      createFactionResult(2, 0.7, 0.7, 5, 'optionC'),
      createFactionResult(3, 1.0, 1.0, 6, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(false);
    expect(tieInfo.tiedFactionIds).toEqual([]);
  });

  test('returns no tie for empty results', () => {
    const results: FactionResult[] = [];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(false);
    expect(tieInfo.tiedFactionIds).toEqual([]);
  });

  test('detects tie based on weighted coherence, not raw coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 0.8, 1.2, 5, 'optionA'), // Higher weighted due to multiplier
      createFactionResult(1, 1.0, 1.2, 6, 'optionB'), // Higher raw, same weighted
      createFactionResult(2, 0.7, 0.7, 4, 'optionC'),
      createFactionResult(3, 0.6, 0.6, 3, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(true);
    expect(tieInfo.tiedFactionIds).toEqual([0, 1]);
  });

  test('detects tie when all factions have identical weighted coherence', () => {
    const results: FactionResult[] = [
      createFactionResult(0, 0.5, 0.5, 2, 'optionA'),
      createFactionResult(1, 0.5, 0.5, 3, 'optionB'),
      createFactionResult(2, 0.5, 0.5, 4, 'optionC'),
      createFactionResult(3, 0.5, 0.5, 5, 'optionD'),
    ];

    const tieInfo = detectTie(results);

    expect(tieInfo.occurred).toBe(true);
    expect(tieInfo.tiedFactionIds).toEqual([0, 1, 2, 3]);
  });
});

describe('resolveTie', () => {
  test('returns the only faction when given a single faction', () => {
    const tiedFactions: FactionId[] = [2];

    const winner = resolveTie(tiedFactions);

    expect(winner).toBe(2);
  });

  test('returns one of the tied factions when given two factions', () => {
    const tiedFactions: FactionId[] = [0, 1];

    const winner = resolveTie(tiedFactions);

    expect([0, 1]).toContain(winner);
  });

  test('returns one of the tied factions when given three factions', () => {
    const tiedFactions: FactionId[] = [1, 2, 3];

    const winner = resolveTie(tiedFactions);

    expect([1, 2, 3]).toContain(winner);
  });

  test('returns one of the tied factions when given all four factions', () => {
    const tiedFactions: FactionId[] = [0, 1, 2, 3];

    const winner = resolveTie(tiedFactions);

    expect([0, 1, 2, 3]).toContain(winner);
  });

  test('throws an error when given an empty array', () => {
    const tiedFactions: FactionId[] = [];

    expect(() => resolveTie(tiedFactions)).toThrow('Cannot resolve tie: no factions provided');
  });

  test('randomly selects different winners over multiple calls', () => {
    // This test verifies randomness by running multiple iterations
    // It's probabilistic but with 100 iterations, it's extremely unlikely to fail if random
    const tiedFactions: FactionId[] = [0, 1];
    const results = new Set<FactionId>();

    for (let i = 0; i < 100; i++) {
      const winner = resolveTie(tiedFactions);
      results.add(winner);
    }

    // With 100 iterations, we should see both factions at least once
    // (Probability of seeing only one = (0.5)^100 ≈ 0)
    expect(results.size).toBe(2);
    expect(results.has(0)).toBe(true);
    expect(results.has(1)).toBe(true);
  });
});

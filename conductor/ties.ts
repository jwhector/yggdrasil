/**
 * Tie Detection and Resolution
 *
 * When multiple factions have identical weighted coherence scores,
 * the system randomly selects a winner.
 */

import type { FactionId, FactionResult, TieInfo } from './types';

/**
 * Detect if there is a tie among faction results.
 * A tie occurs when 2+ factions share the highest weighted coherence.
 *
 * @param factionResults - Coherence results for all factions
 * @returns TieInfo indicating if a tie occurred and which factions are tied
 */
export function detectTie(factionResults: FactionResult[]): TieInfo {
  if (factionResults.length === 0) {
    return { occurred: false, tiedFactionIds: [] };
  }

  // Find the maximum weighted coherence
  const maxCoherence = Math.max(...factionResults.map(r => r.weightedCoherence));

  // Find all factions with the maximum coherence
  const tiedFactions = factionResults
    .filter(r => r.weightedCoherence === maxCoherence)
    .map(r => r.factionId);

  // A tie occurs if 2+ factions share the max
  const occurred = tiedFactions.length > 1;

  return {
    occurred,
    tiedFactionIds: occurred ? tiedFactions : [],
  };
}

/**
 * Resolve a tie by randomly selecting one of the tied factions.
 *
 * IMPORTANT: This uses Math.random() for true randomness during live performance.
 * Not seeded - each tie resolution is independent.
 *
 * @param tiedFactionIds - Array of faction IDs that are tied
 * @returns The randomly selected winning faction ID
 * @throws Error if tiedFactionIds is empty
 */
export function resolveTie(tiedFactionIds: FactionId[]): FactionId {
  if (tiedFactionIds.length === 0) {
    throw new Error('Cannot resolve tie: no factions provided');
  }

  if (tiedFactionIds.length === 1) {
    return tiedFactionIds[0];
  }

  // Random selection (not seeded)
  const randomIndex = Math.floor(Math.random() * tiedFactionIds.length);
  return tiedFactionIds[randomIndex];
}

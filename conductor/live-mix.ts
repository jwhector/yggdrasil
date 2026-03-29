/**
 * Live Mix — Continuous Majority Tracking with Recency Tiebreak
 *
 * Core logic for the V3.2 Incredibox-style finale. Each granular type group
 * votes continuously on which fragment to play. The fragment with the most
 * supporters wins. On tie, the most recent vote among tied fragments wins.
 *
 * Pure functions, no I/O.
 */

import type {
  UserId,
  LiveMixVote,
  GranularFragment,
  V32FinaleState,
  AttemptState,
} from './types';

/**
 * Determine which fragment has the majority in a set of votes.
 * On tie, the fragment with the most recent vote wins (recency tiebreak).
 *
 * Returns null if the votes map is empty.
 */
export function getActiveFragment(
  votes: Map<UserId, LiveMixVote>
): string | null {
  if (votes.size === 0) return null;

  // Count votes per fragment
  const counts = new Map<string, number>();
  for (const vote of votes.values()) {
    counts.set(vote.fragmentId, (counts.get(vote.fragmentId) ?? 0) + 1);
  }

  // Find max count
  const maxCount = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, c]) => c === maxCount);

  if (leaders.length === 1) return leaders[0][0];

  // Tiebreak: most recent vote among the tied fragments
  const leaderIds = new Set(leaders.map(([id]) => id));
  let latestTimestamp = -1;
  let winner = leaders[0][0];

  for (const vote of votes.values()) {
    if (leaderIds.has(vote.fragmentId) && vote.timestamp > latestTimestamp) {
      latestTimestamp = vote.timestamp;
      winner = vote.fragmentId;
    }
  }

  return winner;
}

/**
 * Recalculate active fragments for all granular types.
 * Skips locked types (preserves current active fragment).
 * Uses performer overrides when set.
 *
 * Returns a new Map<granularTypeId, fragmentId>.
 */
export function recalculateActiveFragments(
  finaleState: V32FinaleState
): Map<string, string> {
  const result = new Map<string, string>();
  const { votes, lockedTypes, performerOverrides, activeFragments } = finaleState.liveMix;

  for (const [granularType, userVotes] of votes) {
    // Locked types keep their current active fragment
    if (lockedTypes.includes(granularType)) {
      const current = activeFragments.get(granularType);
      if (current) result.set(granularType, current);
      continue;
    }

    // Performer override takes precedence
    const override = performerOverrides.get(granularType);
    if (override) {
      result.set(granularType, override);
      continue;
    }

    // Calculate from votes
    const active = getActiveFragment(userVotes);
    if (active) result.set(granularType, active);
  }

  return result;
}

/**
 * Compute initial fragment selection for when live_mix begins.
 * For each granular type, picks the fragment whose song-building vote
 * had the highest winning proportion.
 *
 * Falls back to the first available fragment if no vote data is available.
 */
export function computeInitialFragments(
  availableFragments: GranularFragment[],
  attempts: AttemptState[],
): Map<string, string> {
  const result = new Map<string, string>();

  // Build a map of winning proportions by fragment granular key
  const proportions = new Map<string, number>();
  for (const attempt of attempts) {
    for (const lr of attempt.layerResults) {
      if (lr.winningProportion !== null && lr.chosenOption !== null) {
        // Map the winning proportion to all granular fragments from this layer result
        const key = `${attempt.index}-${lr.layerIndex}-${lr.chosenOption}`;
        proportions.set(key, lr.winningProportion);
      }
    }
  }

  // Group available fragments by granular type
  const byType = new Map<string, GranularFragment[]>();
  for (const frag of availableFragments) {
    const list = byType.get(frag.granularType) ?? [];
    list.push(frag);
    byType.set(frag.granularType, list);
  }

  // For each granular type, pick the fragment with the highest winning proportion
  for (const [granularType, fragments] of byType) {
    let bestFragment = fragments[0];
    let bestProportion = -1;

    for (const frag of fragments) {
      // Match fragment back to its layer result
      const key = `${frag.songIndex}-${frag.layerGroupId}`;
      // Find matching layer result
      let proportion = 0;
      for (const attempt of attempts) {
        if (attempt.index !== frag.songIndex) continue;
        for (const lr of attempt.layerResults) {
          if (lr.group === frag.layerGroupId && lr.chosenOption === frag.option && lr.winningProportion !== null) {
            proportion = lr.winningProportion;
          }
        }
      }

      if (proportion > bestProportion) {
        bestProportion = proportion;
        bestFragment = frag;
      }
    }

    if (bestFragment) {
      result.set(granularType, bestFragment.id);
    }
  }

  return result;
}

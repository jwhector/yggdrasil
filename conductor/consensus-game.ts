/**
 * Consensus Game — Finale Consensus Voting Logic
 *
 * Pure functions for the consensus game in the finale phase. The audience
 * collectively activates fragments by achieving convergence above a threshold.
 *
 * Convergence = (votes for leading fragment) / (total votes cast).
 * The distribution is controller-only — audience sees only the scalar convergence value.
 */

import type { UserId, Fragment, LayerType } from './types';

type FragmentId = string;

/**
 * Calculate convergence from a votes map.
 *
 * Convergence = max(vote counts per fragment) / total votes.
 * Returns convergence=0 and empty leadingFragment if no votes cast.
 */
export function calculateConvergence(votes: Map<UserId, FragmentId>): {
  convergence: number;
  leadingFragment: FragmentId;
  distribution: Map<FragmentId, number>;
} {
  if (votes.size === 0) {
    return { convergence: 0, leadingFragment: '', distribution: new Map() };
  }

  const distribution = new Map<FragmentId, number>();
  for (const fragmentId of votes.values()) {
    distribution.set(fragmentId, (distribution.get(fragmentId) ?? 0) + 1);
  }

  let maxCount = 0;
  let leadingFragment = '';
  for (const [fragmentId, count] of distribution) {
    if (count > maxCount || (count === maxCount && fragmentId < leadingFragment)) {
      maxCount = count;
      leadingFragment = fragmentId;
    }
  }

  return {
    convergence: maxCount / votes.size,
    leadingFragment,
    distribution,
  };
}

/**
 * Resolve a consensus round.
 *
 * Success requires:
 * 1. Convergence >= threshold
 * 2. The leading fragment belongs to a layerType not already in lockedRoles
 * 3. The leading fragment exists in availableFragments
 */
export function resolveRound(
  votes: Map<UserId, string>,
  threshold: number,
  availableFragments: Fragment[],
  lockedRoles: Map<LayerType, string>,
): {
  success: boolean;
  winningFragment?: Fragment;
  convergence: number;
} {
  const { convergence, leadingFragment } = calculateConvergence(votes);

  if (convergence < threshold || leadingFragment === '') {
    return { success: false, convergence };
  }

  const fragment = availableFragments.find(f => f.id === leadingFragment);
  if (!fragment) {
    return { success: false, convergence };
  }

  if (lockedRoles.has(fragment.layerType)) {
    return { success: false, convergence };
  }

  return { success: true, winningFragment: fragment, convergence };
}

/**
 * Adjust the consensus threshold based on consecutive failure count.
 *
 * After each failure, threshold decreases by decayPerFailure (floored at minimum).
 * On success the caller resets consecutiveFailures to 0, which naturally returns
 * the original starting threshold on the next call.
 */
export function adjustThreshold(
  current: number,
  consecutiveFailures: number,
  decayPerFailure: number,
  minimum: number,
): number {
  return Math.max(current - consecutiveFailures * decayPerFailure, minimum);
}

/**
 * Deliberation — Group Voting and Ambassador Selection
 *
 * Handles the finale deliberation phase where groups preview fragments,
 * vote on which to activate, and select ambassadors. Pure functions, no I/O.
 */

import type { LayerType, UserId, Fragment, FinaleState, FinaleConfig } from './types';

const ALL_LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

/**
 * Set up per-group voting state from assembly results and available fragments.
 */
export function initializeDeliberation(
  groups: Map<LayerType, UserId[]>,
  availableFragments: Fragment[],
  config: FinaleConfig,
): FinaleState['deliberation'] {
  const groupVotes = new Map<LayerType, Map<UserId, string>>();
  const chosenFragments = new Map<LayerType, string | null>();
  const ambassadorVolunteers = new Map<LayerType, UserId[]>();
  const ambassadors = new Map<LayerType, UserId | null>();

  for (const layerType of ALL_LAYER_TYPES) {
    groupVotes.set(layerType, new Map());
    chosenFragments.set(layerType, null);
    ambassadorVolunteers.set(layerType, []);
    ambassadors.set(layerType, null);
  }

  return {
    groupVotes,
    chosenFragments,
    ambassadorVolunteers,
    ambassadors,
    timerRemaining: config.deliberationTimerMs,
    volunteerTimerRemaining: null,
  };
}

/**
 * Filter available fragments by layer type.
 */
export function getAvailableFragmentsForLayer(
  availableFragments: Fragment[],
  layerType: LayerType,
): Fragment[] {
  return availableFragments.filter(f => f.layerType === layerType);
}

/**
 * Record or change a user's vote. User must be in the correct group.
 */
export function submitGroupVote(
  deliberation: FinaleState['deliberation'],
  groups: Map<LayerType, UserId[]>,
  userId: UserId,
  layerType: LayerType,
  fragmentId: string,
): { deliberation: FinaleState['deliberation']; accepted: boolean } {
  const groupMembers = groups.get(layerType) ?? [];
  if (!groupMembers.includes(userId)) {
    return { deliberation, accepted: false };
  }

  deliberation.groupVotes.get(layerType)!.set(userId, fragmentId);
  return { deliberation, accepted: true };
}

/**
 * Get vote counts for a specific group.
 */
export function getGroupVoteCounts(
  deliberation: FinaleState['deliberation'],
  layerType: LayerType,
): Map<string, number> {
  const votes = deliberation.groupVotes.get(layerType) ?? new Map();
  const counts = new Map<string, number>();
  for (const fragmentId of votes.values()) {
    counts.set(fragmentId, (counts.get(fragmentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Resolve all groups: majority wins, ties broken randomly.
 * Empty groups → null. Single-fragment layers auto-win.
 */
export function resolveDeliberation(
  deliberation: FinaleState['deliberation'],
  groups: Map<LayerType, UserId[]>,
  availableFragments: Fragment[],
): FinaleState['deliberation'] {
  for (const layerType of ALL_LAYER_TYPES) {
    const members = groups.get(layerType) ?? [];
    if (members.length === 0) {
      deliberation.chosenFragments.set(layerType, null);
      continue;
    }

    const layerFragments = getAvailableFragmentsForLayer(availableFragments, layerType);
    if (layerFragments.length === 0) {
      deliberation.chosenFragments.set(layerType, null);
      continue;
    }

    if (layerFragments.length === 1) {
      deliberation.chosenFragments.set(layerType, layerFragments[0].id);
      continue;
    }

    const counts = getGroupVoteCounts(deliberation, layerType);

    if (counts.size === 0) {
      // No votes cast — pick randomly from available
      const winner = layerFragments[Math.floor(Math.random() * layerFragments.length)];
      deliberation.chosenFragments.set(layerType, winner.id);
      continue;
    }

    // Find max vote count
    let maxCount = 0;
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count;
    }

    // Collect all tied leaders
    const tied: string[] = [];
    for (const [fragmentId, count] of counts) {
      if (count === maxCount) tied.push(fragmentId);
    }

    // Pick randomly among tied
    const winner = tied[Math.floor(Math.random() * tied.length)];
    deliberation.chosenFragments.set(layerType, winner);
  }

  return deliberation;
}

/**
 * Add a user to the ambassador volunteer list for their group.
 */
export function volunteerAsAmbassador(
  deliberation: FinaleState['deliberation'],
  groups: Map<LayerType, UserId[]>,
  userId: UserId,
  layerType: LayerType,
): { deliberation: FinaleState['deliberation']; accepted: boolean } {
  const groupMembers = groups.get(layerType) ?? [];
  if (!groupMembers.includes(userId)) {
    return { deliberation, accepted: false };
  }

  const volunteers = deliberation.ambassadorVolunteers.get(layerType)!;
  if (!volunteers.includes(userId)) {
    volunteers.push(userId);
  }

  return { deliberation, accepted: true };
}

/**
 * Resolve ambassadors for all groups.
 * - Single-member group: member is auto-ambassador
 * - 1 volunteer: selected
 * - Multiple volunteers: random pick
 * - 0 volunteers (group has members): forfeited
 * - Empty group: forfeited
 */
export function resolveAmbassadors(
  deliberation: FinaleState['deliberation'],
  groups: Map<LayerType, UserId[]>,
): { deliberation: FinaleState['deliberation']; forfeitedLayers: LayerType[] } {
  const forfeitedLayers: LayerType[] = [];

  for (const layerType of ALL_LAYER_TYPES) {
    const members = groups.get(layerType) ?? [];

    if (members.length === 0) {
      deliberation.ambassadors.set(layerType, null);
      forfeitedLayers.push(layerType);
      continue;
    }

    if (members.length === 1) {
      // Auto-ambassador
      deliberation.ambassadors.set(layerType, members[0]);
      continue;
    }

    const volunteers = deliberation.ambassadorVolunteers.get(layerType) ?? [];

    if (volunteers.length === 0) {
      deliberation.ambassadors.set(layerType, null);
      forfeitedLayers.push(layerType);
    } else if (volunteers.length === 1) {
      deliberation.ambassadors.set(layerType, volunteers[0]);
    } else {
      const selected = volunteers[Math.floor(Math.random() * volunteers.length)];
      deliberation.ambassadors.set(layerType, selected);
    }
  }

  return { deliberation, forfeitedLayers };
}

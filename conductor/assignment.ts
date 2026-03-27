/**
 * Assignment — Granular Type Group Assignment Logic (V3.2)
 *
 * Handles the finale assignment phase where audience members are assigned
 * to granular type groups (bass, drums, melody, etc.) either automatically
 * or via self-selection. Pure functions, no I/O.
 */

import type { UserId, User, GranularType, V32FinaleState } from './types';

/**
 * Fisher-Yates shuffle (in place).
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get connected user IDs from the users map.
 */
function getConnectedUserIds(users: Map<UserId, User>): UserId[] {
  const ids: UserId[] = [];
  for (const [userId, user] of users) {
    if (user.connected) {
      ids.push(userId);
    }
  }
  return ids;
}

/**
 * Auto-assign: shuffle connected users and distribute evenly (round-robin)
 * across the configured granular types.
 */
export function autoAssign(
  users: Map<UserId, User>,
  granularTypes: GranularType[],
): Map<string, UserId[]> {
  const groups = new Map<string, UserId[]>();
  for (const gt of granularTypes) {
    groups.set(gt.id, []);
  }

  if (granularTypes.length === 0) return groups;

  const userIds = shuffle(getConnectedUserIds(users));
  for (let i = 0; i < userIds.length; i++) {
    const typeId = granularTypes[i % granularTypes.length].id;
    groups.get(typeId)!.push(userIds[i]);
  }

  return groups;
}

/**
 * Initialize self-select mode: create empty groups for each granular type
 * with a countdown timer.
 */
export function initializeSelfSelect(
  granularTypes: GranularType[],
  timerMs: number,
): V32FinaleState['assignment'] {
  const groups = new Map<string, UserId[]>();
  for (const gt of granularTypes) {
    groups.set(gt.id, []);
  }

  return {
    mode: 'self_select',
    groups,
    timerRemaining: timerMs,
  };
}

/**
 * Self-select: move a user into a granular type group.
 * Removes from previous group if switching. Mutates in place.
 */
export function selectGranularType(
  assignment: V32FinaleState['assignment'],
  userId: UserId,
  granularType: string,
): void {
  // Remove from any existing group
  for (const [, members] of assignment.groups) {
    const idx = members.indexOf(userId);
    if (idx !== -1) {
      members.splice(idx, 1);
      break;
    }
  }

  // Add to target group
  const targetGroup = assignment.groups.get(granularType);
  if (targetGroup) {
    targetGroup.push(userId);
  }
}

/**
 * Get user IDs not yet assigned to any group.
 */
export function getUndecidedUsers(
  connectedUserIds: UserId[],
  groups: Map<string, UserId[]>,
): UserId[] {
  const assigned = new Set<UserId>();
  for (const [, members] of groups) {
    for (const id of members) {
      assigned.add(id);
    }
  }
  return connectedUserIds.filter(id => !assigned.has(id));
}

/**
 * Distribute all undecided users round-robin across granular types.
 * Used when self-select timer expires. Mutates assignment in place.
 */
export function assignUndecided(
  assignment: V32FinaleState['assignment'],
  connectedUserIds: UserId[],
  granularTypes: GranularType[],
): void {
  if (granularTypes.length === 0) return;

  const undecided = shuffle(getUndecidedUsers(connectedUserIds, assignment.groups));
  for (let i = 0; i < undecided.length; i++) {
    const typeId = granularTypes[i % granularTypes.length].id;
    assignment.groups.get(typeId)!.push(undecided[i]);
  }
}

/**
 * Get sizes of each group.
 */
export function getGroupSizes(
  groups: Map<string, UserId[]>,
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const [typeId, members] of groups) {
    sizes.set(typeId, members.length);
  }
  return sizes;
}

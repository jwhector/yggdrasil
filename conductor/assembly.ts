/**
 * Assembly — Group Self-Selection Logic
 *
 * Handles the finale assembly phase where audience members self-select
 * into 7 layer-type groups. Pure functions, no I/O.
 */

import type { LayerType, UserId, User, FinaleState, FinaleConfig } from './types';

const ALL_LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

/**
 * Initialize assembly state from connected users and config.
 * All connected users start as undecided. Groups start empty.
 */
export function initializeAssembly(
  users: Map<UserId, User>,
  config: FinaleConfig,
): FinaleState['assembly'] {
  const groups = new Map<LayerType, UserId[]>();
  for (const layerType of ALL_LAYER_TYPES) {
    groups.set(layerType, []);
  }

  const undecidedUsers: UserId[] = [];
  for (const [userId, user] of users) {
    if (user.connected) {
      undecidedUsers.push(userId);
    }
  }

  return {
    groups,
    undecidedUsers,
    timerRemaining: config.assemblyTimerMs,
    timerDuration: config.assemblyTimerMs,
  };
}

/**
 * Move a user into a group, removing them from undecided or their current group.
 * Users can switch groups freely.
 */
export function joinGroup(
  assembly: FinaleState['assembly'],
  userId: UserId,
  layerType: LayerType,
): FinaleState['assembly'] {
  // Remove from undecided
  const undecidedIdx = assembly.undecidedUsers.indexOf(userId);
  if (undecidedIdx !== -1) {
    assembly.undecidedUsers.splice(undecidedIdx, 1);
  }

  // Remove from any existing group
  for (const [, members] of assembly.groups) {
    const idx = members.indexOf(userId);
    if (idx !== -1) {
      members.splice(idx, 1);
      break;
    }
  }

  // Add to target group
  const targetGroup = assembly.groups.get(layerType);
  if (targetGroup) {
    targetGroup.push(userId);
  }

  return assembly;
}

/**
 * Randomly distribute all undecided users across 7 groups (uniform random).
 * Distribution is NOT weighted by current group size.
 */
export function assignUndecided(
  assembly: FinaleState['assembly'],
): FinaleState['assembly'] {
  for (const userId of assembly.undecidedUsers) {
    const idx = Math.floor(Math.random() * ALL_LAYER_TYPES.length);
    const layerType = ALL_LAYER_TYPES[idx];
    const group = assembly.groups.get(layerType);
    if (group) {
      group.push(userId);
    }
  }
  assembly.undecidedUsers = [];
  return assembly;
}

/**
 * Get sizes of each group.
 */
export function getGroupSizes(
  assembly: FinaleState['assembly'],
): Map<LayerType, number> {
  const sizes = new Map<LayerType, number>();
  for (const [layerType, members] of assembly.groups) {
    sizes.set(layerType, members.length);
  }
  return sizes;
}

/**
 * Get layer types with 0 members.
 */
export function getEmptyGroups(
  assembly: FinaleState['assembly'],
): LayerType[] {
  const empty: LayerType[] = [];
  for (const [layerType, members] of assembly.groups) {
    if (members.length === 0) {
      empty.push(layerType);
    }
  }
  return empty;
}

/**
 * Conductor Package
 *
 * Pure game logic with no I/O. The conductor receives commands,
 * validates them, updates state, and emits events.
 *
 * Usage:
 *   import { type ShowState, type ConductorCommand } from '@/conductor';
 */

// Re-export all types
export * from './types';

// Export conductor functions
export { createInitialState, processCommand } from './conductor';

// Export voting functions
export { calculateConsensus, calculateVoteResult } from './voting';

// Export threshold functions
export { checkThreshold } from './threshold';

// Export fragment functions
export { generateFragments, generateGranularFragments, extractAttemptResult } from './fragments';
export type { FragmentAvailability } from './fragments';

// Export assignment functions
export {
  autoAssign,
  initializeSelfSelect,
  selectGranularType,
  assignUndecided,
  getUndecidedUsers,
  getGroupSizes,
} from './assignment';

// Export live mix functions
export {
  getActiveFragment,
  recalculateActiveFragments,
  computeInitialFragments,
} from './live-mix';

// Export NPC functions
export { getNpcMessage } from './npc';

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
export { generateFragments, extractAttemptResult } from './fragments';
export type { FragmentAvailability } from './fragments';

// Export performer mix functions
export { queueChange, cancelPending, firePendingChanges } from './performer-mix';

// Export assembly functions
export { initializeAssembly, joinGroup, assignUndecided, getGroupSizes, getEmptyGroups } from './assembly';

// Export deliberation functions
export {
  initializeDeliberation,
  submitGroupVote,
  getGroupVoteCounts,
  resolveDeliberation,
  volunteerAsAmbassador,
  resolveAmbassadors,
  getAvailableFragmentsForLayer,
} from './deliberation';

// Export ceremony functions
export {
  initializeCeremony,
  callNextAmbassador,
  processAltarLockIn,
  isCeremonyComplete,
  forceLockIn,
  forfeitLayer,
  skipToLayer,
} from './ceremony';

// Export NPC functions
export { getNpcMessage } from './npc';

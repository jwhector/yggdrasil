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

// Export assignment functions (V3.3: cell claiming)
export {
  autoAssignCells,
  getConnectedUserIds,
  getUnclaimedUsers,
} from './assignment';

// Export quilt functions (V3.3)
export {
  createQuiltGrid,
  deriveColumnCount,
  claimCell,
  releaseCell,
  setCellSong,
  lockInChoice,
  assignDefaultSongs,
  assignRemainingUsers,
  moveCell,
  changeCellSong,
  reorderColumn,
  swapCells,
  lockCell,
  unlockCell,
  muteCell,
  unmuteCell,
  overrideCellSong,
  resolveTrack,
  buildTrackMap,
  advancePlayhead,
  deriveAvailableSongs,
  findUserCell,
} from './quilt';
export type { QuiltGrid, QuiltResult } from './quilt';

// Export NPC functions
export { getNpcMessage } from './npc';

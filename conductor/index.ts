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

// Export NPC functions
export { getNpcMessage } from './npc';

// Export token pool functions (V3.4)
export { createTokenPool, consumeToken, returnToken, isPoolEmpty, getTotalRemaining } from './token-pool';

// Export question engine functions (V3.4)
export { getNextQuestion, processEmotion } from './question-engine';

// Export remix engine functions (V3.4)
export { queueToken, cancelQueue, advanceNode, processLoopBoundary, toggleAudienceInteraction, resolveTrack as resolveRemixTrack } from './remix-engine';

// Export audience remix functions (V3.4 — Swarm Orbs)
export {
  createUserOrbs,
  placeOrb,
  recallOrb,
  processDecay,
  scatterNode,
  lockNode,
  unlockNode,
  setDecayRate,
  setCrossfadeMode,
  getEffectiveChapter,
  recomputeTallies,
} from './audience-remix';

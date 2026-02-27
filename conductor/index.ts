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

// Export consensus functions
export { calculateConsensus, resolveVote } from './consensus';

// Export fragment functions
export { generateFragments, extractAttemptResult } from './fragments';
export type { FragmentAvailability } from './fragments';

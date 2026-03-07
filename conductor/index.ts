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

// Export health bar functions
export { createHealthBar, calculateDrain, applyDrain, isCollapsed } from './health-bar';

// Export fragment functions
export { generateFragments, extractAttemptResult } from './fragments';
export type { FragmentAvailability } from './fragments';

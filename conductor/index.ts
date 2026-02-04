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
export { calculateCoherence, calculateWeightedCoherence, calculatePopularWinner, getFactionBlocOption } from './coherence';
export { detectTie, resolveTie } from './ties';
export { processCoupVote, triggerCoupManually, canFactionCoup, getCoupProgress, clearCoupVotesForNewRow, resetCoupMultipliers } from './coup';
export { assignFactions, assignLatecomer, NullAdjacencyGraph, TheaterRowsAdjacencyGraph } from './assignment';

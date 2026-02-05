/**
 * Coup Mechanics
 *
 * Each faction has one opportunity per show to "coup" - reset the current row
 * after seeing the reveal. This represents self-sabotage and psychological conflict.
 *
 * Coup requires a threshold fraction of the faction to vote for it during the
 * coup_window phase. When triggered:
 * - Row resets to auditioning phase
 * - Row attempt counter increments
 * - Faction's coupMultiplier increases (e.g., 1.0 → 1.5)
 * - Faction's coupUsed flag is set to true (one-time use)
 */

import type { ShowState, UserId, FactionId, ConductorEvent, Faction } from './types';

/**
 * Check if a faction is eligible to attempt a coup.
 * A faction can coup if:
 * - They haven't already used their coup
 * - The current row is in coup_window phase
 *
 * @param faction - The faction to check
 * @param currentRowPhase - The phase of the current row
 * @returns true if the faction can attempt to coup
 */
export function canFactionCoup(faction: Faction, currentRowPhase: string): boolean {
  return !faction.coupUsed && currentRowPhase === 'coup_window';
}

/**
 * Calculate the current progress toward coup threshold for a faction.
 *
 * @param faction - The faction to check
 * @param state - Current show state
 * @returns Progress from 0 to 1 (0 = no votes, 1 = threshold reached)
 */
export function getCoupProgress(faction: Faction, state: ShowState): number {
  // Count faction members
  let factionMemberCount = 0;
  for (const user of state.users.values()) {
    if (user.faction === faction.id && user.connected) {
      factionMemberCount++;
    }
  }

  if (factionMemberCount === 0) {
    return 0;
  }

  const voteCount = faction.currentRowCoupVotes.size;
  return voteCount / factionMemberCount;
}

/**
 * Process a coup vote from a user.
 * Updates the faction's coup vote set and checks if threshold is reached.
 *
 * @param state - Current show state (will be mutated)
 * @param userId - The user submitting the coup vote
 * @returns Array of events to emit
 */
export function processCoupVote(state: ShowState, userId: UserId): ConductorEvent[] {
  // Find user's faction
  const user = state.users.get(userId);
  if (!user || user.faction === null) {
    return [{ type: 'ERROR', message: 'User not found or not assigned to faction' }];
  }

  const faction = state.factions[user.faction];
  const currentRow = state.rows[state.currentRowIndex];

  // Validate faction can coup
  if (!canFactionCoup(faction, currentRow.phase)) {
    return []; // Silently ignore invalid coup attempts
  }

  // Add user's vote to the coup vote set
  faction.currentRowCoupVotes.add(userId);

  // Calculate progress
  const progress = getCoupProgress(faction, state);

  const events: ConductorEvent[] = [
    { type: 'COUP_METER_UPDATE', factionId: faction.id, progress },
  ];

  // Check if threshold reached
  if (progress >= state.config.coup.threshold) {
    // Trigger the coup
    faction.coupUsed = true;
    faction.coupMultiplier = 1 + state.config.coup.multiplierBonus;
    currentRow.attempts += 1;
    currentRow.phase = 'auditioning';
    currentRow.currentAuditionIndex = 0; // Reset audition to first option

    // Clear coup votes for this row (since we're starting over)
    faction.currentRowCoupVotes.clear();

    events.push({
      type: 'COUP_TRIGGERED',
      factionId: faction.id,
      row: state.currentRowIndex,
    });

    events.push({
      type: 'ROW_PHASE_CHANGED',
      row: state.currentRowIndex,
      phase: 'auditioning',
    });

    // Emit audio cue to uncommit the layer
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'uncommit_layer',
        rowIndex: state.currentRowIndex,
      },
    });
  }

  return events;
}

/**
 * Manually trigger a coup for a faction (controller override for rehearsal/testing).
 *
 * @param state - Current show state (will be mutated)
 * @param factionId - The faction to trigger coup for
 * @returns Array of events to emit
 */
export function triggerCoupManually(state: ShowState, factionId: FactionId): ConductorEvent[] {
  const faction = state.factions[factionId];
  const currentRow = state.rows[state.currentRowIndex];

  // Check if faction has already used coup
  if (faction.coupUsed) {
    return [{ type: 'ERROR', message: 'Faction has already used their coup' }];
  }

  // Trigger the coup regardless of phase or votes
  faction.coupUsed = true;
  faction.coupMultiplier = 1 + state.config.coup.multiplierBonus;
  currentRow.attempts += 1;
  currentRow.phase = 'auditioning';
  currentRow.currentAuditionIndex = 0;

  // Clear coup votes
  faction.currentRowCoupVotes.clear();

  return [
    {
      type: 'COUP_TRIGGERED',
      factionId: faction.id,
      row: state.currentRowIndex,
    },
    {
      type: 'ROW_PHASE_CHANGED',
      row: state.currentRowIndex,
      phase: 'auditioning',
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'uncommit_layer',
        rowIndex: state.currentRowIndex,
      },
    },
  ];
}

/**
 * Clear coup votes for all factions when moving to a new row.
 * This should be called when a row is committed and we move to the next row.
 *
 * @param state - Current show state (will be mutated)
 */
export function clearCoupVotesForNewRow(state: ShowState): void {
  for (const faction of state.factions) {
    faction.currentRowCoupVotes.clear();
  }
}

/**
 * Reset coup multiplier for a faction (used when moving to next row).
 * The multiplier only applies to the row where the coup occurred.
 *
 * @param state - Current show state (will be mutated)
 */
export function resetCoupMultipliers(state: ShowState): void {
  for (const faction of state.factions) {
    faction.coupMultiplier = 1.0;
  }
}

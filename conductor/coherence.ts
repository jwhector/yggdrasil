/**
 * Coherence Calculation
 *
 * Coherence measures how aligned a faction is internally—regardless of which option they align on.
 * A faction wins by having its members vote together, not by "owning" a specific option.
 *
 * Formula: coherence = (largest agreement bloc) / (faction voters)
 * Weighted coherence = raw coherence × coup multiplier (can exceed 1.0)
 */

import type { FactionId, Vote, ShowState, OptionId, UserId } from './types';

/**
 * Calculate raw coherence for a faction on a specific row and attempt.
 *
 * @param factionId - The faction to calculate coherence for
 * @param votes - All votes in the system
 * @param users - Map of userId to faction assignment
 * @param rowIndex - Which row to calculate for
 * @param attempt - Which attempt of the row (increments after coup)
 * @returns Coherence value between 0 and 1 (or 0 if no voters)
 */
export function calculateCoherence(
  factionId: FactionId,
  votes: Vote[],
  users: Map<UserId, FactionId | null>,
  rowIndex: number,
  attempt: number
): number {
  // Filter to faction votes for this row and attempt
  const factionVotes = votes.filter(v => {
    const userFaction = users.get(v.userId);
    return userFaction === factionId &&
           v.rowIndex === rowIndex &&
           v.attempt === attempt;
  });

  // If no votes, coherence is 0
  if (factionVotes.length === 0) {
    return 0;
  }

  // Count how many faction members voted for each option
  const voteCounts = new Map<OptionId, number>();
  for (const vote of factionVotes) {
    const count = voteCounts.get(vote.factionVote) || 0;
    voteCounts.set(vote.factionVote, count + 1);
  }

  // The largest bloc determines coherence
  const largestBloc = Math.max(...voteCounts.values());

  return largestBloc / factionVotes.length;
}

/**
 * Calculate weighted coherence for a faction (applies coup multiplier).
 *
 * @param factionId - The faction to calculate for
 * @param state - Current show state
 * @returns Weighted coherence (can exceed 1.0 if coup multiplier is active)
 */
export function calculateWeightedCoherence(
  factionId: FactionId,
  state: ShowState
): number {
  // Build user faction map
  const userFactionMap = new Map<UserId, FactionId | null>();
  for (const [userId, user] of state.users.entries()) {
    userFactionMap.set(userId, user.faction);
  }

  const currentRow = state.rows[state.currentRowIndex];
  const raw = calculateCoherence(
    factionId,
    state.votes,
    userFactionMap,
    state.currentRowIndex,
    currentRow.attempts
  );

  const multiplier = state.factions[factionId].coupMultiplier;
  return raw * multiplier;
}

/**
 * Calculate the popular vote winner for a row (based on personal votes).
 * Returns the option with the most personal votes across all factions.
 * In case of a tie, returns the first option alphabetically (deterministic).
 *
 * @param votes - All votes in the system
 * @param rowIndex - Which row to calculate for
 * @param attempt - Which attempt of the row
 * @returns The winning option ID, or null if no votes
 */
export function calculatePopularWinner(
  votes: Vote[],
  rowIndex: number,
  attempt: number
): OptionId | null {
  // Filter to votes for this row and attempt
  const rowVotes = votes.filter(v =>
    v.rowIndex === rowIndex && v.attempt === attempt
  );

  if (rowVotes.length === 0) {
    return null;
  }

  // Count personal votes for each option
  const voteCounts = new Map<OptionId, number>();
  for (const vote of rowVotes) {
    const count = voteCounts.get(vote.personalVote) || 0;
    voteCounts.set(vote.personalVote, count + 1);
  }

  // Find the maximum vote count
  const maxVotes = Math.max(...voteCounts.values());

  // Find all options with the maximum votes
  const winners: OptionId[] = [];
  for (const [optionId, count] of voteCounts.entries()) {
    if (count === maxVotes) {
      winners.push(optionId);
    }
  }

  // Sort alphabetically for deterministic tie-breaking
  winners.sort();

  return winners[0];
}

/**
 * Get the option that a faction's largest bloc voted for.
 * Used for determining which option to display as the faction's choice.
 *
 * @param factionId - The faction to check
 * @param votes - All votes
 * @param users - Map of userId to faction assignment
 * @param rowIndex - Which row
 * @param attempt - Which attempt
 * @returns The option ID of the largest bloc, or null if no votes
 */
export function getFactionBlocOption(
  factionId: FactionId,
  votes: Vote[],
  users: Map<UserId, FactionId | null>,
  rowIndex: number,
  attempt: number
): OptionId | null {
  // Filter to faction votes for this row and attempt
  const factionVotes = votes.filter(v => {
    const userFaction = users.get(v.userId);
    return userFaction === factionId &&
           v.rowIndex === rowIndex &&
           v.attempt === attempt;
  });

  if (factionVotes.length === 0) {
    return null;
  }

  // Count how many faction members voted for each option
  const voteCounts = new Map<OptionId, number>();
  for (const vote of factionVotes) {
    const count = voteCounts.get(vote.factionVote) || 0;
    voteCounts.set(vote.factionVote, count + 1);
  }

  // Find the option with the largest bloc
  let maxCount = 0;
  let winningOption: OptionId | null = null;

  for (const [optionId, count] of voteCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      winningOption = optionId;
    } else if (count === maxCount && winningOption !== null) {
      // Tie-break alphabetically for determinism
      if (optionId < winningOption) {
        winningOption = optionId;
      }
    }
  }

  return winningOption;
}

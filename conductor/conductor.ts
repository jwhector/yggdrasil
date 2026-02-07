/**
 * Conductor - Pure State Machine
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O - all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Debug logging: Enable with DEBUG=conductor environment variable
 */

import createDebug from 'debug';

const debug = createDebug('conductor');

import type {
  ShowState,
  ShowConfig,
  ConductorCommand,
  ConductorEvent,
  UserId,
  FactionId,
  OptionId,
  Row,
  PersonalTree,
  User,
  Vote,
  AdjacencyGraph,
} from './types';
import { calculateWeightedCoherence, calculatePopularWinner, getFactionBlocOption } from './coherence';
import { detectTie, resolveTie } from './ties';
import { processCoupVote, triggerCoupManually, clearCoupVotesForNewRow, resetCoupMultipliers } from './coup';
import { assignFactions, assignLatecomer, NullAdjacencyGraph } from './assignment';

/**
 * Create initial show state from configuration.
 *
 * @param config - Show configuration
 * @param showId - Unique identifier for this show
 * @returns Initial show state
 */
export function createInitialState(config: ShowConfig, showId: string): ShowState {
  // Create rows from config
  const rows: Row[] = config.rows.map((rowConfig) => ({
    index: rowConfig.index,
    label: rowConfig.label,
    type: rowConfig.type,
    options: rowConfig.options.map(opt => ({
      id: opt.id,
      index: opt.index,
      audioRef: opt.audioRef,
      harmonicGroup: opt.harmonicGroup,
    })) as [any, any, any, any], // Type assertion for tuple
    phase: 'pending',
    committedOption: null,
    attempts: 0,
    currentAuditionIndex: null,
  }));

  // Create factions from config
  const factions = config.factions.map(factionConfig => ({
    id: factionConfig.id,
    name: factionConfig.name,
    color: factionConfig.color,
    coupUsed: false,
    coupMultiplier: 1.0,
    currentRowCoupVotes: new Set<UserId>(),
  })) as [any, any, any, any]; // Type assertion for tuple of 4

  return {
    id: showId,
    version: 0,
    lastUpdated: Date.now(),
    phase: 'lobby',
    currentRowIndex: 0,
    rows,
    factions,
    users: new Map(),
    votes: [],
    personalTrees: new Map(),
    paths: {
      factionPath: [],
      popularPath: [],
    },
    config,
    pausedPhase: null,
  };
}

/**
 * Process a command and return updated state plus events.
 * This is the main entry point for all state mutations.
 *
 * @param state - Current show state (will be mutated)
 * @param command - Command to process
 * @returns Array of events to emit
 */
export function processCommand(state: ShowState, command: ConductorCommand): ConductorEvent[] {
  debug('Command received: %s', command.type);
  debug('  State before: phase=%s, version=%d, row=%d', state.phase, state.version, state.currentRowIndex);

  // Increment version for every command
  state.version++;
  state.lastUpdated = Date.now();

  let events: ConductorEvent[];

  switch (command.type) {
    case 'USER_CONNECT':
      events = handleUserConnect(state, command.userId, command.seatId, command.existingFaction);
      break;

    case 'USER_DISCONNECT':
      events = handleUserDisconnect(state, command.userId);
      break;

    case 'USER_RECONNECT':
      events = handleUserReconnect(state, command.userId, command.lastVersion);
      break;

    case 'SUBMIT_FIG_TREE_RESPONSE':
      events = handleFigTreeResponse(state, command.userId, command.text);
      break;

    case 'ASSIGN_FACTIONS':
      events = handleAssignFactions(state);
      break;

    case 'START_SHOW':
      events = handleStartShow(state);
      break;

    case 'ADVANCE_PHASE':
      events = handleAdvancePhase(state);
      break;

    case 'SUBMIT_VOTE':
      events = handleSubmitVote(state, command.userId, command.factionVote, command.personalVote);
      break;

    case 'SUBMIT_COUP_VOTE':
      events = processCoupVote(state, command.userId);
      break;

    case 'PAUSE':
      events = handlePause(state);
      break;

    case 'RESUME':
      events = handleResume(state);
      break;

    case 'SKIP_ROW':
      events = handleSkipRow(state);
      break;

    case 'RESTART_ROW':
      events = handleRestartRow(state);
      break;

    case 'TRIGGER_COUP':
      events = triggerCoupManually(state, command.factionId);
      break;

    case 'SET_TIMING':
      events = handleSetTiming(state, command.timing);
      break;

    case 'FORCE_FINALE':
      events = handleForceFinale(state);
      break;

    case 'RESET_TO_LOBBY':
      events = handleResetToLobby(state, command.preserveUsers);
      break;

    case 'IMPORT_STATE':
      events = handleImportState(state, command.state);
      break;

    case 'FORCE_RECONNECT_ALL':
      events = handleForceReconnectAll(state);
      break;

    default:
      events = [{ type: 'ERROR', message: 'Unknown command type', command }];
  }

  debug('  State after: phase=%s, version=%d, row=%d', state.phase, state.version, state.currentRowIndex);
  debug('  Events emitted: %d [%s]', events.length, events.map(e => e.type).join(', '));

  return events;
}

// ============================================================================
// User Connection Management
// ============================================================================

function handleUserConnect(
  state: ShowState,
  userId: UserId,
  seatId?: string,
  existingFaction?: FactionId
): ConductorEvent[] {
  debug('handleUserConnect: userId=%s, seatId=%s, existingFaction=%s', userId, seatId, existingFaction);

  // Check if user already exists
  const existingUser = state.users.get(userId);
  if (existingUser) {
    debug('  User already exists, marking as reconnected');
    existingUser.connected = true;
    return [
      { type: 'USER_RECONNECTED', userId, missedEvents: state.version - 0 },
      { type: 'STATE_SYNC', state, forUserId: userId },
    ];
  }

  // Create new user
  const user: User = {
    id: userId,
    seatId: seatId || null,
    faction: existingFaction !== undefined ? existingFaction : null,
    connected: true,
    joinedAt: Date.now(),
  };

  state.users.set(userId, user);

  // Initialize personal tree
  state.personalTrees.set(userId, {
    userId,
    path: [],
    figTreeResponse: null,
  });

  debug('  New user created, total users: %d', state.users.size);

  // If factions already assigned and user doesn't have a faction, assign as latecomer
  const events: ConductorEvent[] = [
    { type: 'USER_JOINED', userId, faction: user.faction },
  ];

  if (state.phase !== 'lobby' && user.faction === null) {
    debug('  Late joiner detected, assigning faction');
    const graph = createAdjacencyGraph(state);
    const assignedFaction = assignLatecomer(
      { id: userId, seatId: user.seatId },
      state.users,
      graph
    );
    user.faction = assignedFaction;
    debug('  Assigned to faction: %d', assignedFaction);

    events.push({ type: 'FACTION_ASSIGNED', userId, faction: assignedFaction });
  }

  events.push({ type: 'STATE_SYNC', state, forUserId: userId });

  return events;
}

function handleUserDisconnect(state: ShowState, userId: UserId): ConductorEvent[] {
  const user = state.users.get(userId);
  if (!user) {
    return [];
  }

  user.connected = false;

  return [{ type: 'USER_LEFT', userId }];
}

function handleUserReconnect(state: ShowState, userId: UserId, lastVersion: number): ConductorEvent[] {
  const user = state.users.get(userId);
  if (!user) {
    return [{ type: 'ERROR', message: 'User not found for reconnection' }];
  }

  user.connected = true;

  const missedEvents = state.version - lastVersion;

  return [
    { type: 'USER_RECONNECTED', userId, missedEvents },
    { type: 'STATE_SYNC', state, forUserId: userId },
  ];
}

function handleFigTreeResponse(state: ShowState, userId: UserId, text: string): ConductorEvent[] {
  const personalTree = state.personalTrees.get(userId);
  if (!personalTree) {
    return [{ type: 'ERROR', message: 'User not found' }];
  }

  personalTree.figTreeResponse = text;

  return []; // No broadcast event, just stored
}

// ============================================================================
// Faction Assignment
// ============================================================================

function handleAssignFactions(state: ShowState): ConductorEvent[] {
  debug('handleAssignFactions: %d users to assign', state.users.size);

  if (state.phase !== 'lobby') {
    debug('  Error: wrong phase (%s)', state.phase);
    return [{ type: 'ERROR', message: 'Can only assign factions during lobby phase' }];
  }

  // Convert users to assignment format
  const users = Array.from(state.users.values()).map(u => ({
    id: u.id,
    seatId: u.seatId,
  }));

  const graph = createAdjacencyGraph(state);
  const assignments = assignFactions(users, graph);

  // Apply assignments
  const factionCounts = [0, 0, 0, 0];
  for (const [userId, factionId] of assignments) {
    const user = state.users.get(userId);
    if (user) {
      user.faction = factionId;
      factionCounts[factionId]++;
    }
  }
  debug('  Faction distribution: %o', factionCounts);

  state.phase = 'assigning';

  return [
    { type: 'SHOW_PHASE_CHANGED', phase: 'assigning' },
    { type: 'FACTIONS_ASSIGNED', assignments },
  ];
}

// ============================================================================
// Phase Management
// ============================================================================

function handleStartShow(state: ShowState): ConductorEvent[] {
  debug('handleStartShow: current phase=%s', state.phase);

  if (state.phase !== 'assigning') {
    debug('  Error: wrong phase');
    return [{ type: 'ERROR', message: 'Can only start show from assigning phase' }];
  }

  state.phase = 'running';
  state.currentRowIndex = 0;
  state.rows[0].phase = 'auditioning';
  state.rows[0].currentAuditionIndex = 0;
  debug('  Show started, beginning row 0 auditioning');

  return [
    { type: 'SHOW_PHASE_CHANGED', phase: 'running' },
    { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'auditioning' },
    { type: 'AUDITION_OPTION_CHANGED', row: 0, optionIndex: 0 },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'play_option',
        rowIndex: 0,
        optionId: state.rows[0].options[0].id,
      },
    },
  ];
}

function handleAdvancePhase(state: ShowState): ConductorEvent[] {
  const currentRow = state.rows[state.currentRowIndex];
  debug('handleAdvancePhase: row=%d, rowPhase=%s', state.currentRowIndex, currentRow.phase);

  if (state.phase !== 'running') {
    debug('  Error: wrong show phase (%s)', state.phase);
    return [{ type: 'ERROR', message: 'Can only advance phase during running phase' }];
  }

  switch (currentRow.phase) {
    case 'auditioning':
      return advanceFromAuditioning(state, currentRow);

    case 'voting':
      return advanceFromVoting(state, currentRow);

    case 'revealing':
      return advanceFromRevealing(state, currentRow);

    case 'coup_window':
      return advanceFromCoupWindow(state, currentRow);

    case 'committed':
      return advanceToNextRow(state);

    default:
      return [{ type: 'ERROR', message: `Cannot advance from phase: ${currentRow.phase}` }];
  }
}

function advanceFromAuditioning(state: ShowState, currentRow: Row): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const loopsPerRow = state.config.timing.auditionLoopsPerRow ?? 1;

  if (currentRow.currentAuditionIndex === null) {
    currentRow.currentAuditionIndex = 0;
  }

  debug('  advanceFromAuditioning: auditionIndex=%d, loopsPerRow=%d',
    currentRow.currentAuditionIndex, loopsPerRow);

  // Calculate the actual option index (0-3) from the raw audition index
  const currentOptionIndex = currentRow.currentAuditionIndex % 4;

  // Stop current option audio
  events.push({
    type: 'AUDIO_CUE',
    cue: {
      type: 'stop_option',
      rowIndex: currentRow.index,
      optionId: currentRow.options[currentOptionIndex].id,
    },
  });

  // Move to next audition step
  currentRow.currentAuditionIndex++;

  // Calculate total audition steps: 4 options * loopsPerRow
  const totalAuditionSteps = 4 * loopsPerRow;

  if (currentRow.currentAuditionIndex < totalAuditionSteps) {
    // Audition next option
    const nextOptionIndex = currentRow.currentAuditionIndex % 4;
    debug('  Moving to audition step %d (option %d)',
      currentRow.currentAuditionIndex, nextOptionIndex);

    events.push({
      type: 'AUDITION_OPTION_CHANGED',
      row: currentRow.index,
      optionIndex: nextOptionIndex,
    });
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'play_option',
        rowIndex: currentRow.index,
        optionId: currentRow.options[nextOptionIndex].id,
      },
    });
  } else {
    // All loops complete, move to voting
    debug('  All %d audition loops complete, transitioning to voting', loopsPerRow);
    currentRow.phase = 'voting';
    currentRow.currentAuditionIndex = null;
    events.push({
      type: 'ROW_PHASE_CHANGED',
      row: currentRow.index,
      phase: 'voting',
    });
  }

  return events;
}

function advanceFromVoting(state: ShowState, currentRow: Row): ConductorEvent[] {
  currentRow.phase = 'revealing';

  return [
    { type: 'ROW_PHASE_CHANGED', row: currentRow.index, phase: 'revealing' },
    ...performReveal(state, currentRow),
  ];
}

function advanceFromRevealing(state: ShowState, currentRow: Row): ConductorEvent[] {
  currentRow.phase = 'coup_window';

  return [
    { type: 'ROW_PHASE_CHANGED', row: currentRow.index, phase: 'coup_window' },
  ];
}

function advanceFromCoupWindow(state: ShowState, currentRow: Row): ConductorEvent[] {
  currentRow.phase = 'committed';

  // Clear coup votes for next row
  clearCoupVotesForNewRow(state);

  return [
    { type: 'ROW_PHASE_CHANGED', row: currentRow.index, phase: 'committed' },
    {
      type: 'ROW_COMMITTED',
      row: currentRow.index,
      optionId: currentRow.committedOption!,
      popularOptionId: state.paths.popularPath[currentRow.index],
    },
  ];
}

function advanceToNextRow(state: ShowState): ConductorEvent[] {
  debug('advanceToNextRow: currentRow=%d, totalRows=%d', state.currentRowIndex, state.rows.length);

  // Reset coup multipliers (they only apply to the row where coup occurred)
  resetCoupMultipliers(state);

  if (state.currentRowIndex < state.rows.length - 1) {
    // Move to next row
    state.currentRowIndex++;
    const nextRow = state.rows[state.currentRowIndex];
    nextRow.phase = 'auditioning';
    nextRow.currentAuditionIndex = 0;
    debug('  Advancing to row %d', state.currentRowIndex);

    return [
      { type: 'ROW_PHASE_CHANGED', row: nextRow.index, phase: 'auditioning' },
      { type: 'AUDITION_OPTION_CHANGED', row: nextRow.index, optionIndex: 0 },
      {
        type: 'AUDIO_CUE',
        cue: {
          type: 'play_option',
          rowIndex: nextRow.index,
          optionId: nextRow.options[0].id,
        },
      },
    ];
  } else {
    // All rows complete, move to finale
    debug('  All rows complete, entering finale');
    state.phase = 'finale';

    return [
      { type: 'SHOW_PHASE_CHANGED', phase: 'finale' },
      { type: 'FINALE_POPULAR_SONG', path: state.paths.popularPath },
    ];
  }
}

// ============================================================================
// Reveal Logic
// ============================================================================

function performReveal(state: ShowState, currentRow: Row): ConductorEvent[] {
  debug('performReveal: row=%d, attempt=%d', currentRow.index, currentRow.attempts);
  const events: ConductorEvent[] = [];

  // Build user faction map
  const userFactionMap = new Map<UserId, FactionId | null>();
  for (const [userId, user] of state.users.entries()) {
    userFactionMap.set(userId, user.faction);
  }

  // Calculate coherence for each faction
  const factionResults = state.factions.map(faction => {
    const weightedCoherence = calculateWeightedCoherence(faction.id, state);
    const rawCoherence = weightedCoherence / faction.coupMultiplier;

    // Count votes for this faction
    const factionVotes = state.votes.filter(v => {
      const user = state.users.get(v.userId);
      return user?.faction === faction.id &&
             v.rowIndex === currentRow.index &&
             v.attempt === currentRow.attempts;
    });

    const votedForOption = getFactionBlocOption(
      faction.id,
      state.votes,
      userFactionMap,
      currentRow.index,
      currentRow.attempts
    ) || currentRow.options[0].id; // Fallback to first option

    debug('  Faction %d: votes=%d, rawCoherence=%.3f, weightedCoherence=%.3f, option=%s',
      faction.id, factionVotes.length, rawCoherence, weightedCoherence, votedForOption);

    return {
      factionId: faction.id,
      rawCoherence,
      weightedCoherence,
      voteCount: factionVotes.length,
      votedForOption,
    };
  });

  // Detect ties
  const tieInfo = detectTie(factionResults);

  let winningFactionId: FactionId;
  let winningOptionId: OptionId;

  if (tieInfo.occurred) {
    debug('  Tie detected between factions: %o', tieInfo.tiedFactionIds);
    events.push({
      type: 'TIE_DETECTED',
      row: currentRow.index,
      tiedFactionIds: tieInfo.tiedFactionIds,
    });

    winningFactionId = resolveTie(tieInfo.tiedFactionIds);
    debug('  Tie resolved, winner: faction %d', winningFactionId);

    events.push({
      type: 'TIE_RESOLVED',
      row: currentRow.index,
      winningFactionId,
    });
  } else {
    // No tie - find faction with highest weighted coherence
    winningFactionId = factionResults.reduce((max, curr) =>
      curr.weightedCoherence > max.weightedCoherence ? curr : max
    ).factionId;
    debug('  Winning faction: %d (highest coherence)', winningFactionId);
  }

  // Get winning option from winning faction
  winningOptionId = factionResults.find(r => r.factionId === winningFactionId)!.votedForOption;
  debug('  Winning option: %s', winningOptionId);

  // Calculate popular vote
  const popularWinner = calculatePopularWinner(
    state.votes,
    currentRow.index,
    currentRow.attempts
  ) || winningOptionId; // Fallback to faction winner

  const popularVoteCount = state.votes.filter(v =>
    v.rowIndex === currentRow.index &&
    v.attempt === currentRow.attempts &&
    v.personalVote === popularWinner
  ).length;

  const divergedFromFaction = popularWinner !== winningOptionId;
  debug('  Popular vote: %s (%d votes), diverged=%s', popularWinner, popularVoteCount, divergedFromFaction);

  // Update paths
  state.paths.factionPath.push(winningOptionId);
  state.paths.popularPath.push(popularWinner);
  debug('  Paths updated: faction=%o, popular=%o', state.paths.factionPath, state.paths.popularPath);

  // Commit option
  currentRow.committedOption = winningOptionId;

  // Emit reveal event
  events.push({
    type: 'REVEAL',
    payload: {
      rowIndex: currentRow.index,
      factionResults,
      tie: tieInfo,
      winningOptionId,
      winningFactionId,
      popularVote: {
        optionId: popularWinner,
        voteCount: popularVoteCount,
        divergedFromFaction,
      },
    },
  });

  events.push({
    type: 'PATHS_UPDATED',
    paths: state.paths,
  });

  // Audio cue to commit the layer
  events.push({
    type: 'AUDIO_CUE',
    cue: {
      type: 'commit_layer',
      rowIndex: currentRow.index,
      optionId: winningOptionId,
    },
  });

  return events;
}

// ============================================================================
// Vote Processing
// ============================================================================

function handleSubmitVote(
  state: ShowState,
  userId: UserId,
  factionVote: OptionId,
  personalVote: OptionId
): ConductorEvent[] {
  debug('handleSubmitVote: userId=%s, factionVote=%s, personalVote=%s', userId, factionVote, personalVote);

  const user = state.users.get(userId);
  if (!user) {
    debug('  Error: user not found');
    return [{ type: 'ERROR', message: 'User not found, userId=' + userId }];
  }

  if (user.faction === null) {
    debug('  Error: user has no faction');
    return [{ type: 'ERROR', message: 'User not assigned to faction' }];
  }

  const currentRow = state.rows[state.currentRowIndex];
  if (currentRow.phase !== 'voting') {
    debug('  Ignored: wrong phase (%s)', currentRow.phase);
    return []; // Silently ignore votes during wrong phase
  }

  debug('  User faction: %d, row: %d, attempt: %d', user.faction, currentRow.index, currentRow.attempts);

  // Remove any existing vote from this user for this row/attempt
  const previousVoteCount = state.votes.length;
  state.votes = state.votes.filter(v =>
    !(v.userId === userId && v.rowIndex === currentRow.index && v.attempt === currentRow.attempts)
  );
  if (state.votes.length < previousVoteCount) {
    debug('  Replaced existing vote');
  }

  // Add new vote
  const vote: Vote = {
    userId,
    rowIndex: currentRow.index,
    factionVote,
    personalVote,
    timestamp: Date.now(),
    attempt: currentRow.attempts,
  };

  state.votes.push(vote);

  // Count votes for this row
  const rowVotes = state.votes.filter(v => v.rowIndex === currentRow.index && v.attempt === currentRow.attempts);
  debug('  Vote recorded, total votes for row: %d', rowVotes.length);

  // Update personal tree
  const personalTree = state.personalTrees.get(userId);
  if (personalTree) {
    // Ensure path array is long enough
    while (personalTree.path.length <= currentRow.index) {
      personalTree.path.push('' as OptionId);
    }
    personalTree.path[currentRow.index] = personalVote;
  }

  return [{ type: 'VOTE_RECEIVED', userId, row: currentRow.index }];
}

// ============================================================================
// Controller Commands
// ============================================================================

function handlePause(state: ShowState): ConductorEvent[] {
  if (state.phase === 'paused') {
    return [];
  }

  state.pausedPhase = state.phase;
  state.phase = 'paused';

  return [{ type: 'SHOW_PHASE_CHANGED', phase: 'paused' }];
}

function handleResume(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'paused' || state.pausedPhase === null) {
    return [];
  }

  state.phase = state.pausedPhase;
  state.pausedPhase = null;

  return [{ type: 'SHOW_PHASE_CHANGED', phase: state.phase }];
}

function handleSkipRow(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'running') {
    return [{ type: 'ERROR', message: 'Can only skip row during running phase' }];
  }

  const currentRow = state.rows[state.currentRowIndex];
  currentRow.phase = 'committed';
  currentRow.committedOption = currentRow.options[0].id; // Default to first option

  // Update paths with default
  state.paths.factionPath.push(currentRow.options[0].id);
  state.paths.popularPath.push(currentRow.options[0].id);

  return [
    { type: 'ROW_PHASE_CHANGED', row: currentRow.index, phase: 'committed' },
    { type: 'ROW_COMMITTED', row: currentRow.index, optionId: currentRow.options[0].id, popularOptionId: currentRow.options[0].id },
  ];
}

function handleRestartRow(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'running') {
    return [{ type: 'ERROR', message: 'Can only restart row during running phase' }];
  }

  const currentRow = state.rows[state.currentRowIndex];
  currentRow.phase = 'auditioning';
  currentRow.currentAuditionIndex = 0;
  currentRow.attempts++;

  // Clear votes for this row/attempt
  state.votes = state.votes.filter(v => v.rowIndex !== currentRow.index || v.attempt !== currentRow.attempts);

  return [
    { type: 'ROW_PHASE_CHANGED', row: currentRow.index, phase: 'auditioning' },
    { type: 'AUDITION_OPTION_CHANGED', row: currentRow.index, optionIndex: 0 },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'play_option',
        rowIndex: currentRow.index,
        optionId: currentRow.options[0].id,
      },
    },
  ];
}

function handleSetTiming(state: ShowState, timing: Partial<typeof state.config.timing>): ConductorEvent[] {
  Object.assign(state.config.timing, timing);
  return []; // Silent update
}

function handleForceFinale(state: ShowState): ConductorEvent[] {
  state.phase = 'finale';

  return [
    { type: 'SHOW_PHASE_CHANGED', phase: 'finale' },
    { type: 'FINALE_POPULAR_SONG', path: state.paths.popularPath },
  ];
}

function handleResetToLobby(state: ShowState, preserveUsers: boolean): ConductorEvent[] {
  debug('handleResetToLobby: preserveUsers=%s, currentPhase=%s', preserveUsers, state.phase);

  if (preserveUsers) {
    // Keep users but reset their factions and votes
    debug('  Preserving %d users, clearing factions', state.users.size);
    for (const user of state.users.values()) {
      user.faction = null;
    }
  } else {
    // Clear all users
    debug('  Clearing all %d users', state.users.size);
    state.users.clear();
    state.personalTrees.clear();
  }

  // Reset to initial state
  state.phase = 'lobby';
  state.currentRowIndex = 0;
  state.votes = [];
  state.paths = { factionPath: [], popularPath: [] };

  // Reset rows
  for (const row of state.rows) {
    row.phase = 'pending';
    row.committedOption = null;
    row.attempts = 0;
    row.currentAuditionIndex = null;
  }

  // Reset factions
  for (const faction of state.factions) {
    faction.coupUsed = false;
    faction.coupMultiplier = 1.0;
    faction.currentRowCoupVotes.clear();
  }

  return [
    { type: 'SHOW_RESET', preservedUsers: preserveUsers },
    { type: 'SHOW_PHASE_CHANGED', phase: 'lobby' },
  ];
}

function handleImportState(state: ShowState, importedState: ShowState): ConductorEvent[] {
  // Copy all properties from imported state
  Object.assign(state, importedState);

  return [
    { type: 'SHOW_PHASE_CHANGED', phase: state.phase },
  ];
}

function handleForceReconnectAll(state: ShowState): ConductorEvent[] {
  return [{ type: 'FORCE_RECONNECT', reason: 'Manual reconnect triggered' }];
}

// ============================================================================
// Utilities
// ============================================================================

function createAdjacencyGraph(state: ShowState): AdjacencyGraph {
  // For now, return null graph
  // In production, this would create the appropriate graph based on state.config.topology
  return new NullAdjacencyGraph();
}

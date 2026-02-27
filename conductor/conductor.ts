/**
 * Conductor — Pure State Machine (NEW SYSTEM)
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O — all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Show flow:
 *   lobby → opener → (attempt_story → attempt_build) ×3 →
 *   finale_setup → finale_rotating → finale_frozen → ended
 *
 * Song-building layer flow:
 *   locked → auditioning → voting → resolving → locked_in | collapsed
 */

import type {
  ShowState,
  ShowPhase,
  ShowConfig,
  AttemptState,
  LayerPhase,
  LayerResult,
  LayerVote,
  ConductorCommand,
  ConductorEvent,
  UserId,
  SeatId,
  User,
} from './types';
import { calculateConsensus, resolveVote } from './consensus';

// ============================================================================
// State Initialization
// ============================================================================

/**
 * Create initial show state from configuration.
 */
export function createInitialState(config: ShowConfig, showId: string): ShowState {
  const attempts: AttemptState[] = config.attempts.map((attemptConfig, i) => ({
    index: i,
    chapter: attemptConfig.chapter,
    layerPlan: attemptConfig.layers,
    currentLayerIndex: 0,
    currentLayerPhase: 'locked' as LayerPhase,
    layerResults: [],
    votes: [],
    status: 'pending' as const,
    collapsedAtLayer: null,
  }));

  return {
    id: showId,
    phase: 'lobby',
    currentAttemptIndex: 0,
    attempts,
    users: new Map(),
    finaleState: null,
    config,
    version: 0,
    lastUpdated: Date.now(),
    paused: false,
  };
}

// ============================================================================
// Command Processing
// ============================================================================

/**
 * Process a command and return events. State is mutated in place.
 */
export function processCommand(state: ShowState, command: ConductorCommand): ConductorEvent[] {
  // Increment version for every command
  state.version++;
  state.lastUpdated = Date.now();

  switch (command.type) {
    // Show flow
    case 'ADVANCE_PHASE':
      return handleAdvancePhase(state);
    case 'JUMP_TO_PHASE':
      return handleJumpToPhase(state, command.phase, command.attemptIndex);
    case 'PAUSE':
      return handlePause(state);
    case 'RESUME':
      return handleResume(state);

    // Song-building
    case 'START_AUDITION':
      return handleStartAudition(state);
    case 'OPEN_VOTING':
      return handleOpenVoting(state);
    case 'CLOSE_VOTING':
      return handleCloseVoting(state);
    case 'SUBMIT_VOTE':
      return handleSubmitVote(state, command.userId, command.choice);
    case 'FORCE_OPTION':
      return handleForceOption(state, command.choice);
    case 'EXTEND_VOTE_TIMER':
      // Timer extension is handled by the server timing layer; conductor acknowledges
      return [];
    case 'RERUN_VOTE':
      return handleRerunVote(state);
    case 'FORCE_CONTINUE':
      return handleForceContinue(state);
    case 'FORCE_COLLAPSE':
      return handleForceCollapse(state);

    // Doubt
    case 'SET_THRESHOLD':
      return handleSetThreshold(state, command.layerIndex, command.threshold);
    case 'TOGGLE_DOUBT':
      // Doubt toggle is a UI concern; thresholds are per-layer in config.
      // This could toggle all thresholds to null or restore them. For now, no-op.
      return [];

    // Finale (Phase 2 — not implemented yet)
    case 'SETUP_FINALE':
    case 'SELECT_FRAGMENT':
    case 'UPDATE_TRIANGLE':
    case 'UPDATE_STEWARD_PARAM':
    case 'START_ROTATION':
    case 'STOP_ROTATION':
    case 'FREEZE_ROTATION':
    case 'SET_ROTATION_RATE':
    case 'FORCE_ASSIGN_STEWARD':
    case 'FORCE_INSERT_FRAGMENT':
    case 'CLEAR_QUEUE':
    case 'TOGGLE_TRIANGLE':
      return [{ type: 'ERROR', message: `Finale command '${command.type}' not yet implemented (Phase 2)` }];

    // Audio
    case 'AUDIO_TRANSPORT':
      return [{ type: 'AUDIO_CUE', cue: { type: 'transport', action: command.action } }];
    case 'AUDIO_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'panic' } }];
    case 'TRIGGER_COLLAPSE_GESTURE': {
      const attempt = currentAttempt(state);
      if (!attempt) return [{ type: 'ERROR', message: 'No active attempt' }];
      return [{ type: 'AUDIO_CUE', cue: { type: 'collapse_gesture', attemptIndex: attempt.index } }];
    }

    // Connection
    case 'USER_CONNECT':
      return handleUserConnect(state, command.userId, command.seatId);
    case 'USER_DISCONNECT':
      return handleUserDisconnect(state, command.userId);

    // Recovery
    case 'EXPORT_STATE':
      // Handled at server layer; conductor just acknowledges
      return [{ type: 'STATE_UPDATED', version: state.version }];
    case 'IMPORT_STATE':
      return handleImportState(state, command.state);
    case 'FORCE_RECONNECT_ALL':
      return [{ type: 'FORCE_RECONNECT', reason: 'Manual reconnect triggered' }];
    case 'RESET_TO_LOBBY':
      return handleResetToLobby(state, command.preserveUsers);

    default:
      return [{ type: 'ERROR', message: `Unknown command type: ${(command as any).type}`, command }];
  }
}

// ============================================================================
// Show Phase Transitions
// ============================================================================

/**
 * Show phase sequence. ADVANCE_PHASE walks forward through this.
 * attempt_story and attempt_build repeat 3 times (indexed by currentAttemptIndex).
 */
const PHASE_SEQUENCE: ShowPhase[] = [
  'lobby',
  'opener',
  'attempt_story',   // attempt 0
  'attempt_build',   // attempt 0
  'attempt_story',   // attempt 1
  'attempt_build',   // attempt 1
  'attempt_story',   // attempt 2
  'attempt_build',   // attempt 2
  'finale_setup',
  'finale_rotating',
  'finale_frozen',
  'ended',
];

function handleAdvancePhase(state: ShowState): ConductorEvent[] {
  if (state.paused) {
    return [{ type: 'ERROR', message: 'Cannot advance phase while paused' }];
  }

  const currentPhase = state.phase;

  // Find current position in the sequence
  const currentSeqIndex = findPhaseSequenceIndex(currentPhase, state.currentAttemptIndex);
  if (currentSeqIndex === -1 || currentSeqIndex >= PHASE_SEQUENCE.length - 1) {
    return [{ type: 'ERROR', message: `Cannot advance from phase: ${currentPhase}` }];
  }

  const nextSeqIndex = currentSeqIndex + 1;
  const nextPhase = PHASE_SEQUENCE[nextSeqIndex];

  return transitionToPhase(state, nextPhase, nextSeqIndex);
}

function handleJumpToPhase(state: ShowState, phase: ShowPhase, attemptIndex?: number): ConductorEvent[] {
  if (attemptIndex !== undefined) {
    state.currentAttemptIndex = attemptIndex;
  }

  const seqIndex = findPhaseSequenceIndex(phase, state.currentAttemptIndex);

  return transitionToPhase(state, phase, seqIndex);
}

/**
 * Find the index into PHASE_SEQUENCE for the given phase and attempt index.
 */
function findPhaseSequenceIndex(phase: ShowPhase, attemptIndex: number): number {
  switch (phase) {
    case 'lobby': return 0;
    case 'opener': return 1;
    case 'attempt_story': return 2 + attemptIndex * 2;
    case 'attempt_build': return 3 + attemptIndex * 2;
    case 'finale_setup': return 8;
    case 'finale_rotating': return 9;
    case 'finale_frozen': return 10;
    case 'ended': return 11;
    default: return -1;
  }
}

/**
 * Transition to a new phase, handling side effects (attempt index updates, attempt activation).
 */
function transitionToPhase(state: ShowState, nextPhase: ShowPhase, seqIndex: number): ConductorEvent[] {
  const events: ConductorEvent[] = [];

  // Calculate attempt index from sequence position
  if (nextPhase === 'attempt_story' || nextPhase === 'attempt_build') {
    const attemptIndex = Math.floor((seqIndex - 2) / 2);
    state.currentAttemptIndex = attemptIndex;
  }

  state.phase = nextPhase;

  // Phase entry side effects
  if (nextPhase === 'attempt_build') {
    const attempt = currentAttempt(state);
    if (attempt && attempt.status === 'pending') {
      attempt.status = 'in_progress';
      attempt.currentLayerIndex = 0;
      attempt.currentLayerPhase = 'locked';
    }
  }

  events.push({
    type: 'SHOW_PHASE_CHANGED',
    phase: nextPhase,
    attemptIndex: state.currentAttemptIndex,
  });

  return events;
}

/**
 * Auto-advance after collapse: go to next attempt_story, or stay if Song 3
 * (Song 3 → finale transition is manual per R15).
 */
function autoAdvanceAfterCollapse(state: ShowState): ConductorEvent[] {
  if (state.currentAttemptIndex < 2) {
    // Attempts 0, 1: auto-advance to next attempt_story
    const nextAttemptIndex = state.currentAttemptIndex + 1;
    state.currentAttemptIndex = nextAttemptIndex;
    state.phase = 'attempt_story';

    return [{
      type: 'SHOW_PHASE_CHANGED',
      phase: 'attempt_story',
      attemptIndex: nextAttemptIndex,
    }];
  }

  // Attempt 2 (Song 3): stay in attempt_build, manual transition to finale
  // The phase stays as attempt_build but the attempt is collapsed.
  // Controller must manually ADVANCE_PHASE or JUMP_TO_PHASE to proceed.
  return [];
}

// ============================================================================
// Song-Building: Layer Flow
// ============================================================================

function handleStartAudition(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only start audition during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'locked') {
    return [{ type: 'ERROR', message: `Cannot start audition from layer phase: ${attempt.currentLayerPhase}` }];
  }

  attempt.currentLayerPhase = 'auditioning';

  const events: ConductorEvent[] = [
    {
      type: 'LAYER_PHASE_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      phase: 'auditioning',
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: 'A',
      },
    },
  ];

  return events;
}

function handleOpenVoting(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only open voting during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'auditioning') {
    return [{ type: 'ERROR', message: `Cannot open voting from layer phase: ${attempt.currentLayerPhase}` }];
  }

  attempt.currentLayerPhase = 'voting';

  return [
    {
      type: 'LAYER_PHASE_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      phase: 'voting',
    },
  ];
}

function handleCloseVoting(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only close voting during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'voting') {
    return [{ type: 'ERROR', message: `Cannot close voting from layer phase: ${attempt.currentLayerPhase}` }];
  }

  return resolveCurrentLayer(state, attempt);
}

function handleSubmitVote(state: ShowState, userId: UserId, choice: 'A' | 'B'): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return []; // Silently ignore votes outside build phase
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [];
  }

  if (attempt.currentLayerPhase !== 'voting') {
    return []; // Silently ignore votes outside voting window
  }

  const user = state.users.get(userId);
  if (!user) {
    return [{ type: 'ERROR', message: `User not found: ${userId}` }];
  }

  // Remove any existing vote from this user for this layer
  attempt.votes = attempt.votes.filter(v =>
    !(v.userId === userId && v.layerIndex === attempt.currentLayerIndex)
  );

  // Add new vote
  const vote: LayerVote = {
    userId,
    attemptIndex: attempt.index,
    layerIndex: attempt.currentLayerIndex,
    choice,
    timestamp: Date.now(),
  };
  attempt.votes.push(vote);

  return [{
    type: 'VOTE_RECEIVED',
    userId,
    attemptIndex: attempt.index,
    layerIndex: attempt.currentLayerIndex,
  }];
}

function handleForceOption(state: ShowState, choice: 'A' | 'B'): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only force option during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  // Force locks in the layer with the chosen option, bypassing vote/threshold
  return lockInLayer(state, attempt, choice, true);
}

function handleRerunVote(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only rerun vote during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  // Clear votes for current layer
  attempt.votes = attempt.votes.filter(v => v.layerIndex !== attempt.currentLayerIndex);

  // Reset to auditioning
  attempt.currentLayerPhase = 'auditioning';

  return [
    {
      type: 'LAYER_PHASE_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      phase: 'auditioning',
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: 'A',
      },
    },
  ];
}

function handleForceContinue(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only force continue during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'resolving') {
    return [{ type: 'ERROR', message: 'Can only force continue from resolving phase' }];
  }

  // Get the vote result to determine winner, then lock in bypassing threshold
  const layerVotes = attempt.votes.filter(v => v.layerIndex === attempt.currentLayerIndex);
  const { winner } = calculateConsensus(layerVotes);

  return lockInLayer(state, attempt, winner, true);
}

function handleForceCollapse(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only force collapse during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  return collapseAttempt(state, attempt, 0, 0);
}

// ============================================================================
// Doubt Threshold
// ============================================================================

function handleSetThreshold(state: ShowState, layerIndex: number, threshold: number | null): ConductorEvent[] {
  const attempt = currentAttempt(state);
  if (!attempt) {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  const layer = attempt.layerPlan[layerIndex];
  if (!layer) {
    return [{ type: 'ERROR', message: `Layer ${layerIndex} not found in current attempt` }];
  }

  layer.doubtThreshold = threshold;
  return [];
}

// ============================================================================
// Layer Resolution
// ============================================================================

/**
 * Resolve the current layer: calculate vote result, check threshold, lock in or collapse.
 */
function resolveCurrentLayer(state: ShowState, attempt: AttemptState): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerConfig = attempt.layerPlan[layerIndex];

  attempt.currentLayerPhase = 'resolving';

  events.push({
    type: 'LAYER_PHASE_CHANGED',
    attemptIndex: attempt.index,
    layerIndex,
    phase: 'resolving',
  });

  // Calculate vote result
  const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
  const voteResult = resolveVote(layerVotes, layerConfig?.doubtThreshold ?? null);

  events.push({
    type: 'VOTE_RESULT',
    attemptIndex: attempt.index,
    layerIndex,
    result: voteResult,
  });

  if (voteResult.thresholdMet) {
    // Consensus met — lock in
    events.push(...lockInLayer(state, attempt, voteResult.winner, false));
  } else {
    // Consensus below threshold — collapse
    events.push(...collapseAttempt(state, attempt, voteResult.consensus, voteResult.doubtThreshold!));
  }

  return events;
}

/**
 * Lock in the current layer with the winning option and advance to next layer.
 */
function lockInLayer(
  _state: ShowState,
  attempt: AttemptState,
  winner: 'A' | 'B',
  _forced: boolean,
): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerConfig = attempt.layerPlan[layerIndex];

  // Record layer result
  const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
  const { consensus } = calculateConsensus(layerVotes);

  const layerResult: LayerResult = {
    layerIndex,
    type: layerConfig?.type ?? 'foundation',
    status: 'locked_in',
    chosenOption: winner,
    consensus,
  };
  attempt.layerResults.push(layerResult);

  attempt.currentLayerPhase = 'locked_in';

  events.push({
    type: 'LAYER_PHASE_CHANGED',
    attemptIndex: attempt.index,
    layerIndex,
    phase: 'locked_in',
  });

  events.push({
    type: 'LAYER_LOCKED_IN',
    attemptIndex: attempt.index,
    layerIndex,
    winner,
  });

  events.push({
    type: 'AUDIO_CUE',
    cue: {
      type: 'lock_in',
      attemptIndex: attempt.index,
      layerIndex,
      winner,
    },
  });

  // Check if there are more layers
  if (layerIndex < attempt.layerPlan.length - 1) {
    // Advance to next layer
    attempt.currentLayerIndex = layerIndex + 1;
    attempt.currentLayerPhase = 'locked';
  } else {
    // All layers complete — attempt completed successfully
    attempt.status = 'completed';
    // Mark any remaining unreached layers (shouldn't be any if we got here)
    markUnreachedLayers(attempt);

    events.push({ type: 'ATTEMPT_COMPLETED', attemptIndex: attempt.index });
  }

  return events;
}

/**
 * Collapse the current attempt. Mark unreached layers, then auto-advance.
 */
function collapseAttempt(
  state: ShowState,
  attempt: AttemptState,
  consensus: number,
  threshold: number,
): ConductorEvent[] {
  const events: ConductorEvent[] = [];

  attempt.status = 'collapsed';
  attempt.collapsedAtLayer = attempt.currentLayerIndex;
  attempt.currentLayerPhase = 'collapsed';

  // Mark the collapsed layer in results (if not already there)
  const existingResult = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
  if (!existingResult) {
    attempt.layerResults.push({
      layerIndex: attempt.currentLayerIndex,
      type: attempt.layerPlan[attempt.currentLayerIndex]?.type ?? 'foundation',
      status: 'unreached',
      chosenOption: null,
      consensus: null,
    });
  }

  // Mark all remaining layers as unreached
  markUnreachedLayers(attempt);

  events.push({
    type: 'LAYER_PHASE_CHANGED',
    attemptIndex: attempt.index,
    layerIndex: attempt.currentLayerIndex,
    phase: 'collapsed',
  });

  events.push({
    type: 'ATTEMPT_COLLAPSED',
    attemptIndex: attempt.index,
    atLayer: attempt.currentLayerIndex,
    consensus,
    threshold,
  });

  events.push({
    type: 'AUDIO_CUE',
    cue: { type: 'collapse_gesture', attemptIndex: attempt.index },
  });

  // Auto-advance (except Song 3)
  events.push(...autoAdvanceAfterCollapse(state));

  return events;
}

/**
 * Mark all layers that haven't been resolved as unreached.
 */
function markUnreachedLayers(attempt: AttemptState): void {
  for (const layerConfig of attempt.layerPlan) {
    const existing = attempt.layerResults.find(r => r.layerIndex === layerConfig.index);
    if (!existing) {
      attempt.layerResults.push({
        layerIndex: layerConfig.index,
        type: layerConfig.type,
        status: 'unreached',
        chosenOption: null,
        consensus: null,
      });
    }
  }
}

// ============================================================================
// Pause / Resume
// ============================================================================

function handlePause(state: ShowState): ConductorEvent[] {
  if (state.paused) {
    return [];
  }
  state.paused = true;
  return [{ type: 'PAUSED' }];
}

function handleResume(state: ShowState): ConductorEvent[] {
  if (!state.paused) {
    return [];
  }
  state.paused = false;
  return [{ type: 'RESUMED' }];
}

// ============================================================================
// User Connection
// ============================================================================

function handleUserConnect(state: ShowState, userId: UserId, seatId?: SeatId): ConductorEvent[] {
  const existing = state.users.get(userId);
  if (existing) {
    existing.connected = true;
    return [{ type: 'STATE_UPDATED', version: state.version }];
  }

  const user: User = {
    id: userId,
    seatId: seatId || null,
    connected: true,
    joinedAt: Date.now(),
    finaleChapter: null,
  };
  state.users.set(userId, user);

  return [{ type: 'STATE_UPDATED', version: state.version }];
}

function handleUserDisconnect(state: ShowState, userId: UserId): ConductorEvent[] {
  const user = state.users.get(userId);
  if (!user) return [];

  user.connected = false;
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

// ============================================================================
// Recovery
// ============================================================================

function handleResetToLobby(state: ShowState, preserveUsers: boolean): ConductorEvent[] {
  if (!preserveUsers) {
    state.users.clear();
  } else {
    // Keep users but reset finale chapter
    state.users.forEach(user => {
      user.finaleChapter = null;
    });
  }

  state.phase = 'lobby';
  state.currentAttemptIndex = 0;
  state.finaleState = null;
  state.paused = false;

  // Re-initialize attempts
  state.attempts = state.config.attempts.map((attemptConfig, i) => ({
    index: i,
    chapter: attemptConfig.chapter,
    layerPlan: attemptConfig.layers,
    currentLayerIndex: 0,
    currentLayerPhase: 'locked' as LayerPhase,
    layerResults: [],
    votes: [],
    status: 'pending' as const,
    collapsedAtLayer: null,
  }));

  return [
    { type: 'SHOW_RESET', preservedUsers: preserveUsers },
    { type: 'SHOW_PHASE_CHANGED', phase: 'lobby' },
  ];
}

function handleImportState(state: ShowState, importedState: ShowState): ConductorEvent[] {
  Object.assign(state, importedState);
  return [{ type: 'SHOW_PHASE_CHANGED', phase: state.phase }];
}

// ============================================================================
// Utilities
// ============================================================================

/** Get the current attempt, or null if none. */
function currentAttempt(state: ShowState): AttemptState | null {
  return state.attempts[state.currentAttemptIndex] ?? null;
}

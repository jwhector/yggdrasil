/**
 * Conductor — Pure State Machine (V3.2)
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O — all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Show flow:
 *   lobby → opener → (attempt_story → attempt_build → attempt_resolve) ×3 →
 *   finale_elegy → finale_assignment → finale_live_mix → ended
 *
 * Song-building layer flow:
 *   locked → auditioning → revealing → locked_in | collapsed
 *   (voting is open concurrently during auditioning — no separate voting phase)
 *
 * Two song outcomes:
 *   - Collapse: doubt threshold not met → auto-advance to next attempt_story
 *   - Completion: all layers locked in → auto-advance to attempt_resolve
 *     In attempt_resolve the performer triggers TRIGGER_REJECTION to narratively reject the song.
 */

import type {
  ShowState,
  ShowPhase,
  ShowConfig,
  AttemptState,
  LayerPhase,
  LayerVote,
  ConductorCommand,
  ConductorEvent,
  UserId,
  SeatId,
  User,
  V32FinaleState,
  V32LayerConfig,
  TrackBundle,
  GranularType,
} from './types';
import { calculateConsensus, calculateVoteResult } from './voting';
import { checkThreshold } from './threshold';
import { generateGranularFragments } from './fragments';
import { getNpcMessage } from './npc';
import { autoAssign, initializeSelfSelect, selectGranularType, assignUndecided } from './assignment';
import { getActiveFragment } from './live-mix';

// ============================================================================
// State Initialization
// ============================================================================

/** Default gain configuration used when config.timing.gain is absent. */
export const DEFAULT_GAIN_CONFIG = {
  entryGain: 0.25,
  entrySwellBeats: 4,
  holdBars: 6,
  exitFadeBeats: 8,
  lockInFadeBeats: 8,
  collapseFadeBeats: 8,
  ceremonySwellBeats: 4,
  unityGainValue: 0.5,
  stepsPerBeat: 2,
} as const;

/**
 * Create initial show state from configuration.
 */
export function createInitialState(config: ShowConfig, showId: string): ShowState {
  // Apply gain defaults if missing from config
  if (!config.timing.gain) {
    config = {
      ...config,
      timing: { ...config.timing, gain: { ...DEFAULT_GAIN_CONFIG } },
    };
  }
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
    currentAuditionOption: null,
    auditionLoopIndex: 0,
    currentVoteResult: null,
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

  console.log('[Conductor] processCommand: ', command.type);

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
    case 'TOGGLE_AUDITION':
      return handleToggleAudition(state);
    case 'CLOSE_VOTING':
      return handleCloseVoting(state);
    case 'ADVANCE_FROM_REVEAL':
      return handleAdvanceFromReveal(state);
    case 'SUBMIT_VOTE':
      return handleSubmitVote(state, command.userId, command.choice);
    case 'FORCE_OPTION':
      return handleForceOption(state, command.choice);
    case 'EXTEND_VOTE_TIMER':
      // Timer extension is handled by the server timing layer; conductor acknowledges
      return [];
    case 'RERUN_VOTE':
      return handleRerunVote(state);
    case 'FORCE_COLLAPSE':
      return handleForceCollapse(state);

    // Song Rejection
    case 'TRIGGER_REJECTION':
      return handleTriggerRejection(state);

    // Finale
    case 'SETUP_FINALE':
      return handleSetupFinale(state);
    // Assignment
    case 'START_ASSIGNMENT':
      return handleStartAssignment(state);
    case 'SELECT_GRANULAR_TYPE':
      return handleSelectGranularType(state, command.userId, command.granularType);
    case 'ASSIGNMENT_COMPLETE':
      return handleAssignmentComplete(state);
    case 'SEND_NPC_MESSAGE':
      return handleSendNpcMessage(state, command.message);

    // Live Mix
    case 'START_LIVE_MIX':
      return handleStartLiveMix(state);
    case 'SET_LIVE_MIX_PREFERENCE':
      return handleSetLiveMixPreference(state, command.userId, command.granularType, command.fragmentId);
    case 'LOCK_GRANULAR_TYPE':
      return handleLockGranularType(state, command.granularType);
    case 'UNLOCK_GRANULAR_TYPE':
      return handleUnlockGranularType(state, command.granularType);
    case 'OVERRIDE_FRAGMENT':
      return handleOverrideFragment(state, command.granularType, command.fragmentId);
    case 'CLEAR_OVERRIDE':
      return handleClearOverride(state, command.granularType);

    // Audio
    case 'AUDIO_TRANSPORT':
      return [{ type: 'AUDIO_CUE', cue: { type: 'transport', action: command.action } }];
    case 'AUDIO_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'panic' } }];
    case 'MASTER_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'master_panic' } }];
    case 'RESET_UTILITIES':
      return [{ type: 'AUDIO_CUE', cue: { type: 'reset_utilities' } }];

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
    case 'NEW_SHOW':
      return handleResetToLobby(state, false);

    default:
      return [{ type: 'ERROR', message: `Unknown command type: ${(command as any).type}`, command }];
  }
}

// ============================================================================
// Show Phase Transitions
// ============================================================================

/**
 * Show phase sequence. ADVANCE_PHASE walks forward through this.
 * attempt_story, attempt_build, and attempt_resolve repeat 3 times.
 * Note: attempt_resolve is also entered automatically when a song completes.
 * Collapsed songs skip attempt_resolve and auto-advance to the next attempt_story.
 */
const PHASE_SEQUENCE: ShowPhase[] = [
  'lobby',
  'opener',
  'attempt_story',       // attempt 0
  'attempt_build',       // attempt 0
  'attempt_resolve',     // attempt 0
  'attempt_story',       // attempt 1
  'attempt_build',       // attempt 1
  'attempt_resolve',     // attempt 1
  'attempt_story',       // attempt 2
  'attempt_build',       // attempt 2
  'attempt_resolve',     // attempt 2
  'finale_elegy',
  'finale_assignment',
  'finale_live_mix',
  'ended',
];

function handleAdvancePhase(state: ShowState): ConductorEvent[] {
  if (state.paused) {
    return [{ type: 'ERROR', message: 'Cannot advance phase while paused' }];
  }

  const currentPhase = state.phase;
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
 * attempt_story/build/resolve are in triples: (2,3,4), (5,6,7), (8,9,10).
 */
function findPhaseSequenceIndex(phase: ShowPhase, attemptIndex: number): number {
  switch (phase) {
    case 'lobby': return 0;
    case 'opener': return 1;
    case 'attempt_story': return 2 + attemptIndex * 3;
    case 'attempt_build': return 3 + attemptIndex * 3;
    case 'attempt_resolve': return 4 + attemptIndex * 3;
    case 'finale_elegy': return 11;
    case 'finale_assignment': return 12;
    case 'finale_live_mix': return 13;
    case 'ended': return 14;
    default: return -1;
  }
}

/**
 * Transition to a new phase, handling side effects.
 */
function transitionToPhase(state: ShowState, nextPhase: ShowPhase, seqIndex: number): ConductorEvent[] {
  const events: ConductorEvent[] = [];

  // Calculate attempt index from sequence position for attempt phases
  if (
    nextPhase === 'attempt_story' ||
    nextPhase === 'attempt_build' ||
    nextPhase === 'attempt_resolve'
  ) {
    const attemptIndex = Math.floor((seqIndex - 2) / 3);
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
    // Unmute live seed tracks for this attempt
    const attemptConfig = state.config.attempts[state.currentAttemptIndex];
    if (attemptConfig?.liveSeed?.trackIndices?.length) {
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'live_seed_start', attemptIndex: state.currentAttemptIndex, trackIndices: attemptConfig.liveSeed.trackIndices },
      });
    }
  }

  if (nextPhase === 'finale_elegy') {
    // Auto-setup finale state (generate fragments from attempt results)
    console.log('handleAdvancePhase: auto-setup finale state');
    events.push(...handleSetupFinale(state));
  }

  if (nextPhase === 'finale_assignment' && state.finaleState) {
    events.push(...handleStartAssignment(state));
  }

  if (nextPhase === 'finale_live_mix' && state.finaleState) {
    events.push(...handleStartLiveMix(state));
  }

  events.push({
    type: 'SHOW_PHASE_CHANGED',
    phase: nextPhase,
    attemptIndex: state.currentAttemptIndex,
  });

  return events;
}

/**
 * Auto-advance after collapse:
 * - Attempts 0/1: advance to next attempt_story
 * - Attempt 2: stay in attempt_build (manual transition to finale)
 */
function autoAdvanceAfterCollapse(state: ShowState): ConductorEvent[] {
  if (state.currentAttemptIndex < 2) {
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
  attempt.currentAuditionOption = 'A';
  attempt.auditionLoopIndex = 0;

  // Per-layer tempo from config
  const attemptConfig = state.config.attempts[attempt.index];
  const layerTempo = attemptConfig?.tempos?.[attempt.currentLayerIndex] ?? 120;

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
        type: 'set_tempo',
        bpm: layerTempo,
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
      },
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: 'A',
        trackBundle: getLayerTrackBundle(attempt, 'A'),
        otherTrackBundle: getLayerTrackBundle(attempt, 'B'),
      },
    },
    {
      type: 'AUDITION_OPTION_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      option: 'A',
      loopIndex: 0,
      totalLoops: 0, // Managed by timing engine
    },
  ];
}

function handleToggleAudition(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only toggle audition during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'auditioning') {
    return [{ type: 'ERROR', message: `Cannot toggle audition from layer phase: ${attempt.currentLayerPhase}` }];
  }

  const prevOption = attempt.currentAuditionOption ?? 'A';
  const nextOption: 'A' | 'B' = prevOption === 'A' ? 'B' : 'A';
  attempt.currentAuditionOption = nextOption;
  attempt.auditionLoopIndex++;

  return [
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_stop',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: prevOption,
        trackBundle: getLayerTrackBundle(attempt, prevOption),
      },
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: nextOption,
        trackBundle: getLayerTrackBundle(attempt, nextOption),
        otherTrackBundle: getLayerTrackBundle(attempt, prevOption),
      },
    },
    {
      type: 'AUDITION_OPTION_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      option: nextOption,
      loopIndex: attempt.auditionLoopIndex,
      totalLoops: 0, // Managed by timing engine
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

  if (attempt.currentLayerPhase !== 'auditioning') {
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

  if (attempt.currentLayerPhase !== 'auditioning') {
    return []; // Silently ignore votes outside voting window
  }

  const user = state.users.get(userId);
  if (!user) {
    return [{ type: 'ERROR', message: `User not found: ${userId}` }];
  }

  // Remove any existing vote from this user for this layer (allow vote change)
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

  // Force locks in the layer with the chosen option, bypassing threshold check
  return lockInLayer(state, attempt, choice);
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

  // Reset to auditioning, restarting from option A
  attempt.currentLayerPhase = 'auditioning';
  attempt.currentAuditionOption = 'A';
  attempt.auditionLoopIndex = 0;

  // Per-layer tempo from config
  const attemptConfig = state.config.attempts[attempt.index];
  const layerTempo = attemptConfig?.tempos?.[attempt.currentLayerIndex] ?? 120;

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
        type: 'set_tempo',
        bpm: layerTempo,
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
      },
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: 'A',
        trackBundle: getLayerTrackBundle(attempt, 'A'),
        otherTrackBundle: getLayerTrackBundle(attempt, 'B'),
      },
    },
    {
      type: 'AUDITION_OPTION_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      option: 'A',
      loopIndex: 0,
      totalLoops: 0, // Managed by timing engine
    },
  ];
}

function handleForceCollapse(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only force collapse during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  return collapseAttempt(state, attempt);
}

// ============================================================================
// Song Rejection (attempt_resolve)
// ============================================================================

function handleTriggerRejection(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_resolve') {
    return [{ type: 'ERROR', message: 'Can only trigger rejection during attempt_resolve' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt) {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  const events: ConductorEvent[] = [
    { type: 'SONG_REJECTED', attemptIndex: attempt.index },
    { type: 'AUDIO_CUE', cue: { type: 'rejection_gesture', attemptIndex: attempt.index } },
  ];

  // Stop live seed on rejection
  const attemptCfg = state.config.attempts[attempt.index];
  if (attemptCfg?.liveSeed?.trackIndices?.length) {
    events.push({
      type: 'AUDIO_CUE',
      cue: { type: 'live_seed_stop', attemptIndex: attempt.index, trackIndices: attemptCfg.liveSeed.trackIndices },
    });
  }

  return events;
}

// ============================================================================
// Layer Resolution
// ============================================================================

/**
 * Resolve the current layer: calculate vote result, check doubt threshold,
 * then transition to revealing.
 * Phase 2 will wire in threshold.ts; for now the threshold is read directly from config.
 */
function resolveCurrentLayer(state: ShowState, attempt: AttemptState): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerConfig = attempt.layerPlan[layerIndex];

  // 0. Stop audition audio
  if (attempt.currentAuditionOption !== null) {
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_stop',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: attempt.currentAuditionOption,
        trackBundle: getLayerTrackBundle(attempt, attempt.currentAuditionOption),
      },
    });
    attempt.currentAuditionOption = null;
  }

  // 1. Calculate vote result
  const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
  const voteResult = calculateVoteResult(layerVotes);

  // 2. Threshold check
  const attemptConfig = state.config.attempts[attempt.index];
  const threshold = attemptConfig?.thresholds?.[layerIndex] ?? 0;
  const { passed, winningProportion } = checkThreshold(voteResult.votesA, voteResult.votesB, threshold);

  // 3. Record the layer result
  attempt.layerResults.push({
    layerIndex,
    group: layerConfig?.group ?? null,
    status: passed ? 'locked_in' : 'collapsed',
    chosenOption: voteResult.winner,
    winningProportion,
    thresholdRequired: threshold,
    passed,
  });

  // 4. Store vote result on attempt for client access during revealing phase
  attempt.currentVoteResult = voteResult;

  // 5. Transition to revealing
  attempt.currentLayerPhase = 'revealing';
  events.push({
    type: 'LAYER_PHASE_CHANGED',
    attemptIndex: attempt.index,
    layerIndex,
    phase: 'revealing',
  });

  // 6. Emit VOTE_RESULT
  events.push({
    type: 'VOTE_RESULT',
    attemptIndex: attempt.index,
    layerIndex,
    result: voteResult,
  });

  // 7. Emit THRESHOLD_CHECK
  events.push({
    type: 'THRESHOLD_CHECK',
    attemptIndex: attempt.index,
    layerIndex,
    winningProportion,
    threshold,
    passed,
  });

  // The actual lock-in or collapse happens when ADVANCE_FROM_REVEAL is received
  // (scheduled by the timing engine after revealSequenceDurationMs).
  return events;
}

/**
 * Advance from the revealing phase to locked_in or collapsed.
 * Called by the timing engine after the reveal animation completes.
 */
function handleAdvanceFromReveal(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only advance from reveal during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'revealing') {
    return []; // Already advanced; ignore duplicate
  }

  const voteResult = attempt.currentVoteResult;

  // Clear reveal data
  attempt.currentVoteResult = null;

  // Determine pass/collapse from the layer result recorded during resolveCurrentLayer
  const layerResult = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
  const passed = layerResult?.passed ?? true;

  if (!passed) {
    return collapseAttempt(state, attempt);
  } else {
    const winner = voteResult?.winner ?? 'A';
    return lockInLayer(state, attempt, winner);
  }
}

/**
 * Lock in the current layer with the winning option and advance to next layer.
 */
function lockInLayer(
  state: ShowState,
  attempt: AttemptState,
  winner: 'A' | 'B',
): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerConfig = attempt.layerPlan[layerIndex];

  // Layer result is normally recorded in resolveCurrentLayer during revealing phase.
  // For forced lock-ins (FORCE_OPTION) that bypass resolveCurrentLayer, push it now.
  const existingResult = attempt.layerResults.find(r => r.layerIndex === layerIndex);
  if (!existingResult) {
    const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
    const { winningProportion } = calculateConsensus(layerVotes);
    attempt.layerResults.push({
      layerIndex,
      group: layerConfig?.group ?? null,
      status: 'locked_in',
      chosenOption: winner,
      winningProportion,
      thresholdRequired: null,
      passed: true,
    });
  } else {
    existingResult.status = 'locked_in';
    existingResult.chosenOption = winner;
  }

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

  const loser: 'A' | 'B' = winner === 'A' ? 'B' : 'A';
  events.push({
    type: 'AUDIO_CUE',
    cue: {
      type: 'lock_in',
      attemptIndex: attempt.index,
      layerIndex,
      winner,
      winnerTrackBundle: layerConfig?.optionA && layerConfig?.optionB
        ? (winner === 'A' ? layerConfig.optionA : layerConfig.optionB)
        : EMPTY_TRACK_BUNDLE,
      loserTrackBundle: layerConfig?.optionA && layerConfig?.optionB
        ? (loser === 'A' ? layerConfig.optionA : layerConfig.optionB)
        : EMPTY_TRACK_BUNDLE,
    },
  });

  if (layerIndex < attempt.layerPlan.length - 1) {
    // Advance to next layer
    attempt.currentLayerIndex = layerIndex + 1;
    attempt.currentLayerPhase = 'locked';
  } else {
    // All layers complete — song survived! Transition to attempt_resolve.
    attempt.status = 'completed';
    markUnreachedLayers(attempt);

    events.push({ type: 'ATTEMPT_COMPLETED', attemptIndex: attempt.index });

    // Auto-transition to attempt_resolve
    state.phase = 'attempt_resolve';
    events.push({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'attempt_resolve',
      attemptIndex: state.currentAttemptIndex,
    });
  }

  return events;
}

/**
 * Collapse the current attempt. Mark unreached layers, emit events, auto-advance.
 */
function collapseAttempt(state: ShowState, attempt: AttemptState): ConductorEvent[] {
  const events: ConductorEvent[] = [];

  attempt.status = 'collapsed';
  attempt.collapsedAtLayer = attempt.currentLayerIndex;
  attempt.currentLayerPhase = 'collapsed';

  // Mark the collapsed layer in results (if not already there)
  const existingResult = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
  if (!existingResult) {
    attempt.layerResults.push({
      layerIndex: attempt.currentLayerIndex,
      group: attempt.layerPlan[attempt.currentLayerIndex]?.group ?? null,
      status: 'unreached',
      chosenOption: null,
      winningProportion: null,
      thresholdRequired: null,
      passed: null,
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
  });

  events.push({
    type: 'AUDIO_CUE',
    cue: { type: 'collapse_gesture', attemptIndex: attempt.index },
  });

  // Stop live seed on collapse
  const attemptCfg = state.config.attempts[attempt.index];
  if (attemptCfg?.liveSeed?.trackIndices?.length) {
    events.push({
      type: 'AUDIO_CUE',
      cue: { type: 'live_seed_stop', attemptIndex: attempt.index, trackIndices: attemptCfg.liveSeed.trackIndices },
    });
  }

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
        group: layerConfig.group,
        status: 'unreached',
        chosenOption: null,
        winningProportion: null,
        thresholdRequired: null,
        passed: null,
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
  }

  state.phase = 'lobby';
  state.currentAttemptIndex = 0;
  state.finaleState = null;
  state.paused = false;

  // Re-initialize attempts with fresh health bars
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
    currentAuditionOption: null,
    auditionLoopIndex: 0,
    currentVoteResult: null,
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
// Finale Handlers
// ============================================================================

function handleSetupFinale(state: ShowState): ConductorEvent[] {
  const config = state.config.finale;
  const allFragments = generateGranularFragments(
    state.attempts,
    state.config.attempts,
    config.audioPreviewPath,
    config.bothOptionsSurvive,
  );
  const availableFragments = allFragments.filter(f => f.wonVote);

  state.finaleState = {
    phase: 'elegy',
    availableFragments,
    allFragments,
    assignment: {
      mode: config.assignmentMode,
      groups: new Map(),
      timerRemaining: null,
    },
    liveMix: {
      votes: new Map(),
      activeFragments: new Map(),
      lockedTypes: [],
      performerOverrides: new Map(),
      liveTracksActive: [],
      transportStarted: false,
      loopPosition: 0,
      loopCount: 0,
    },
    npc: { currentMessage: null },
  };

  return [{ type: 'FINALE_SETUP_COMPLETE', availableFragments, allFragments }];
}

// ============================================================================
// Assignment Handlers
// ============================================================================

function handleStartAssignment(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const config = state.config.finale;
  const granularTypes = state.config.granularTypes ?? [];

  if (config.assignmentMode === 'auto') {
    const groups = autoAssign(state.users, granularTypes);
    state.finaleState.assignment = { mode: 'auto', groups, timerRemaining: null };
    state.finaleState.phase = 'assignment';

    const events: ConductorEvent[] = [
      { type: 'ASSIGNMENT_STARTED', mode: 'auto' },
      { type: 'GROUPS_ASSIGNED', groups },
    ];
    const npcMsg = getNpcMessage(config.npcMessages, 'assignment_start');
    if (npcMsg) {
      state.finaleState.npc.currentMessage = npcMsg;
      events.push({ type: 'NPC_MESSAGE', message: npcMsg });
    }
    return events;
  } else {
    const assignment = initializeSelfSelect(granularTypes, config.assignmentTimerMs);
    state.finaleState.assignment = assignment;
    state.finaleState.phase = 'assignment';

    const events: ConductorEvent[] = [{ type: 'ASSIGNMENT_STARTED', mode: 'self_select' }];
    const npcMsg = getNpcMessage(config.npcMessages, 'assignment_start');
    if (npcMsg) {
      state.finaleState.npc.currentMessage = npcMsg;
      events.push({ type: 'NPC_MESSAGE', message: npcMsg });
    }
    return events;
  }
}

function handleSelectGranularType(state: ShowState, userId: UserId, granularType: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.assignment.mode !== 'self_select') {
    return [{ type: 'ERROR', message: 'Cannot select type in auto-assignment mode' }];
  }
  selectGranularType(state.finaleState.assignment, userId, granularType);
  return [{ type: 'GROUPS_ASSIGNED', groups: state.finaleState.assignment.groups }];
}

function handleAssignmentComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.assignment.mode === 'self_select') {
    const connectedUserIds: UserId[] = [];
    for (const [userId, user] of state.users) {
      if (user.connected) connectedUserIds.push(userId);
    }
    const granularTypes = state.config.granularTypes ?? [];
    assignUndecided(state.finaleState.assignment, connectedUserIds, granularTypes);
  }
  return [{ type: 'GROUPS_ASSIGNED', groups: state.finaleState.assignment.groups }];
}

function handleSendNpcMessage(state: ShowState, message: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.npc.currentMessage = message;
  return [{ type: 'NPC_MESSAGE', message }];
}

// ============================================================================
// Live Mix Handlers
// ============================================================================

function handleStartLiveMix(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.phase = 'live_mix';

  // Live mix starts muted — no initial fragments, no pre-set votes.
  // Audio begins when a group first reaches majority on a fragment.
  // The very first group to activate triggers Ableton transport.
  state.finaleState.liveMix.activeFragments = new Map();
  state.finaleState.liveMix.transportStarted = false;

  // Initialize empty vote maps per granular type
  for (const [granularType] of state.finaleState.assignment.groups) {
    state.finaleState.liveMix.votes.set(granularType, new Map());
  }

  const events: ConductorEvent[] = [
    { type: 'LIVE_MIX_STARTED', initialFragments: new Map() },
  ];

  const npcMsg = getNpcMessage(state.config.finale.npcMessages, 'live_mix_start');
  if (npcMsg) {
    state.finaleState.npc.currentMessage = npcMsg;
    events.push({ type: 'NPC_MESSAGE', message: npcMsg });
  }

  return events;
}

function handleSetLiveMixPreference(
  state: ShowState,
  userId: UserId,
  granularType: string,
  fragmentId: string,
): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'live_mix') return [{ type: 'ERROR', message: 'Not in live_mix phase' }];

  const fs = state.finaleState;

  // Validate: user is assigned to this granular type
  const members = fs.assignment.groups.get(granularType);
  if (!members || !members.includes(userId)) {
    return [{ type: 'ERROR', message: `User ${userId} is not assigned to ${granularType}` }];
  }

  // Validate: type is not locked
  if (fs.liveMix.lockedTypes.includes(granularType)) {
    return [{ type: 'ERROR', message: `${granularType} is locked` }];
  }

  // Validate: fragment exists in available fragments for this type
  const validFragment = fs.availableFragments.some(f => f.id === fragmentId && f.granularType === granularType)
    || (state.config.finale.bothOptionsSurvive && fs.allFragments.some(f => f.id === fragmentId && f.granularType === granularType));
  if (!validFragment) {
    return [{ type: 'ERROR', message: `Fragment ${fragmentId} not available for ${granularType}` }];
  }

  // Update vote
  let typeVotes = fs.liveMix.votes.get(granularType);
  if (!typeVotes) {
    typeVotes = new Map();
    fs.liveMix.votes.set(granularType, typeVotes);
  }
  typeVotes.set(userId, { fragmentId, timestamp: Date.now() });

  // Recalculate active fragment for this type (skip if overridden)
  if (fs.liveMix.performerOverrides.has(granularType)) {
    return []; // Override takes precedence, vote is recorded but doesn't change audio
  }

  const newActive = getActiveFragment(typeVotes);
  const previousActive = fs.liveMix.activeFragments.get(granularType) ?? null;

  if (newActive && newActive !== previousActive) {
    fs.liveMix.activeFragments.set(granularType, newActive);

    const events: ConductorEvent[] = [
      { type: 'ACTIVE_FRAGMENT_CHANGED', granularType, fragmentId: newActive, previousFragmentId: previousActive ?? '' },
    ];

    // First group to activate triggers Ableton transport
    if (!fs.liveMix.transportStarted && !previousActive) {
      fs.liveMix.transportStarted = true;
      events.push({ type: 'AUDIO_CUE', cue: { type: 'transport', action: 'play' } });
    }

    // Emit audio crossfade cue
    const outFrag = previousActive
      ? (fs.allFragments.find(f => f.id === previousActive))
      : null;
    const inFrag = fs.allFragments.find(f => f.id === newActive);
    if (inFrag) {
      events.push({
        type: 'AUDIO_CUE',
        cue: {
          type: 'live_mix_crossfade',
          granularType,
          incomingTrackIndices: inFrag.trackIndices,
          outgoingTrackIndices: outFrag?.trackIndices ?? [],
        },
      });
    }

    return events;
  }

  return []; // Vote recorded, no majority shift
}

function handleLockGranularType(state: ShowState, granularType: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'live_mix') return [{ type: 'ERROR', message: 'Not in live_mix phase' }];

  const fs = state.finaleState;
  if (fs.liveMix.lockedTypes.includes(granularType)) {
    return []; // Already locked
  }

  fs.liveMix.lockedTypes.push(granularType);
  return [{ type: 'GRANULAR_TYPE_LOCKED', granularType }];
}

function handleUnlockGranularType(state: ShowState, granularType: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'live_mix') return [{ type: 'ERROR', message: 'Not in live_mix phase' }];

  const fs = state.finaleState;
  const idx = fs.liveMix.lockedTypes.indexOf(granularType);
  if (idx === -1) return []; // Not locked

  fs.liveMix.lockedTypes.splice(idx, 1);
  const events: ConductorEvent[] = [{ type: 'GRANULAR_TYPE_UNLOCKED', granularType }];

  // Recalculate — audience votes may have shifted while locked
  if (!fs.liveMix.performerOverrides.has(granularType)) {
    const typeVotes = fs.liveMix.votes.get(granularType);
    if (typeVotes) {
      const newActive = getActiveFragment(typeVotes);
      const previousActive = fs.liveMix.activeFragments.get(granularType) ?? null;

      if (newActive && newActive !== previousActive) {
        fs.liveMix.activeFragments.set(granularType, newActive);
        events.push({ type: 'ACTIVE_FRAGMENT_CHANGED', granularType, fragmentId: newActive, previousFragmentId: previousActive ?? '' });

        const outFrag = previousActive ? fs.allFragments.find(f => f.id === previousActive) : null;
        const inFrag = fs.allFragments.find(f => f.id === newActive);
        if (inFrag) {
          events.push({
            type: 'AUDIO_CUE',
            cue: { type: 'live_mix_crossfade', granularType, incomingTrackIndices: inFrag.trackIndices, outgoingTrackIndices: outFrag?.trackIndices ?? [] },
          });
        }
      }
    }
  }

  return events;
}

function handleOverrideFragment(state: ShowState, granularType: string, fragmentId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'live_mix') return [{ type: 'ERROR', message: 'Not in live_mix phase' }];

  const fs = state.finaleState;
  fs.liveMix.performerOverrides.set(granularType, fragmentId);

  const previousActive = fs.liveMix.activeFragments.get(granularType) ?? null;
  const events: ConductorEvent[] = [];

  if (fragmentId !== previousActive) {
    fs.liveMix.activeFragments.set(granularType, fragmentId);
    events.push({ type: 'ACTIVE_FRAGMENT_CHANGED', granularType, fragmentId, previousFragmentId: previousActive ?? '' });

    const outFrag = previousActive ? fs.allFragments.find(f => f.id === previousActive) : null;
    const inFrag = fs.allFragments.find(f => f.id === fragmentId);
    if (inFrag) {
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'live_mix_crossfade', granularType, incomingTrackIndices: inFrag.trackIndices, outgoingTrackIndices: outFrag?.trackIndices ?? [] },
      });
    }
  }

  return events;
}

function handleClearOverride(state: ShowState, granularType: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'live_mix') return [{ type: 'ERROR', message: 'Not in live_mix phase' }];

  const fs = state.finaleState;
  if (!fs.liveMix.performerOverrides.has(granularType)) return [];

  fs.liveMix.performerOverrides.delete(granularType);

  // Recalculate from votes
  const typeVotes = fs.liveMix.votes.get(granularType);
  const newActive = typeVotes ? getActiveFragment(typeVotes) : null;
  const previousActive = fs.liveMix.activeFragments.get(granularType) ?? null;
  const events: ConductorEvent[] = [];

  if (newActive && newActive !== previousActive) {
    fs.liveMix.activeFragments.set(granularType, newActive);
    events.push({ type: 'ACTIVE_FRAGMENT_CHANGED', granularType, fragmentId: newActive, previousFragmentId: previousActive ?? '' });

    const outFrag = previousActive ? fs.allFragments.find(f => f.id === previousActive) : null;
    const inFrag = fs.allFragments.find(f => f.id === newActive);
    if (inFrag) {
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'live_mix_crossfade', granularType, incomingTrackIndices: inFrag.trackIndices, outgoingTrackIndices: outFrag?.trackIndices ?? [] },
      });
    }
  }

  return events;
}

// ============================================================================
// Utilities
// ============================================================================

/** Get the current attempt, or null if none. */
function currentAttempt(state: ShowState): AttemptState | null {
  return state.attempts[state.currentAttemptIndex] ?? null;
}

/** Get the TrackBundle for the given option on the current layer. */
function getLayerTrackBundle(attempt: AttemptState, option: 'A' | 'B'): TrackBundle {
  const layerConfig = attempt.layerPlan[attempt.currentLayerIndex];
  return option === 'A' ? layerConfig.optionA : layerConfig.optionB;
}

/** Empty TrackBundle fallback for edge cases. */
const EMPTY_TRACK_BUNDLE: TrackBundle = { tracks: [] };

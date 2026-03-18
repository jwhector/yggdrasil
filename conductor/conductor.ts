/**
 * Conductor — Pure State Machine (V3)
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O — all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Show flow:
 *   lobby → opener → (attempt_story → attempt_build → attempt_resolve) ×3 →
 *   finale_elegy → finale_assembly → finale_deliberation → finale_ceremony → finale_performer_mix → ended
 *
 * Song-building layer flow:
 *   locked → auditioning → voting → revealing → locked_in | collapsed
 *
 * Two song outcomes:
 *   - Collapse: health bar reaches 0 → auto-advance to next attempt_story
 *   - Completion: all layers locked in, health bar > 0 → auto-advance to attempt_resolve
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
  AudioReference,
  LayerType,
  FinaleState,
} from './types';
import { calculateConsensus, calculateVoteResult } from './voting';
import { createHealthBar, applyDrain, isCollapsed } from './health-bar';
import { generateFragments } from './fragments';
import { queueChange, cancelPending, firePendingChanges } from './performer-mix';
import { getNpcMessage } from './npc';
import { initializeAssembly, joinGroup, assignUndecided, getEmptyGroups } from './assembly';
import { initializeDeliberation, submitGroupVote, getGroupVoteCounts, resolveDeliberation, volunteerAsAmbassador, resolveAmbassadors } from './deliberation';
import { initializeCeremony, callNextAmbassador, processAltarLockIn, isCeremonyComplete, forceLockIn, forfeitLayer, skipToLayer } from './ceremony';

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
    healthBar: createHealthBar(attemptConfig.drainFactor, attemptConfig.layerMultipliers),
    currentVoteResult: null,
    currentDrain: null,
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
    case 'OPEN_VOTING':
      return handleOpenVoting(state);
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

    // Health Bar
    case 'SET_DRAIN_FACTOR':
      return handleSetDrainFactor(state, command.factor);
    case 'SET_HEALTH':
      return handleSetHealth(state, command.value);
    case 'FORCE_COLLAPSE':
      return handleForceCollapse(state);

    // Song Rejection
    case 'TRIGGER_REJECTION':
      return handleTriggerRejection(state);

    // Finale
    case 'SETUP_FINALE':
      return handleSetupFinale(state);
    // Assembly
    case 'START_ASSEMBLY':
      return handleStartAssembly(state);
    case 'JOIN_GROUP':
      return handleJoinGroup(state, command.userId, command.layerType);
    case 'ASSEMBLY_TIMER_EXPIRED':
      return handleAssemblyTimerExpired(state);
    case 'FORCE_ASSIGN_USER':
      return handleJoinGroup(state, command.userId, command.layerType);
    case 'EXTEND_ASSEMBLY_TIMER':
      return handleExtendAssemblyTimer(state, command.additionalMs);
    case 'FORCE_END_ASSEMBLY':
      return handleAssemblyTimerExpired(state);

    // Deliberation
    case 'START_DELIBERATION':
      return handleStartDeliberation(state);
    case 'SUBMIT_GROUP_VOTE':
      return handleSubmitGroupVote(state, command.userId, command.layerType, command.fragmentId);
    case 'DELIBERATION_TIMER_EXPIRED':
      return handleDeliberationTimerExpired(state);
    case 'VOLUNTEER_AS_AMBASSADOR':
      return handleVolunteerAsAmbassador(state, command.userId, command.layerType);
    case 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED':
      return handleAmbassadorVolunteerTimerExpired(state, command.layerType);
    case 'FORCE_FRAGMENT_SELECTION':
      return handleForceFragmentSelection(state, command.layerType, command.fragmentId);
    case 'EXTEND_DELIBERATION_TIMER':
      return handleExtendDeliberationTimer(state, command.additionalMs);
    case 'FORCE_END_DELIBERATION':
      return handleDeliberationTimerExpired(state);

    // Ceremony
    case 'START_CEREMONY':
      return handleStartCeremony(state);
    case 'CALL_NEXT_AMBASSADOR':
      return handleCallNextAmbassador(state);
    case 'ALTAR_LOCK_IN':
      return handleAltarLockIn(state, command.userId, command.layerType);
    case 'FORCE_LOCK_IN':
      return handleForceLockIn(state, command.layerType);
    case 'FORFEIT_LAYER':
      return handleForfeitLayer(state, command.layerType);
    case 'SKIP_TO_LAYER':
      return handleSkipToLayer(state, command.layerType);
    case 'SEND_NPC_MESSAGE':
      return handleSendNpcMessage(state, command.message);
    case 'START_PERFORMER_MIX':
      return handleStartPerformerMix(state);
    case 'QUEUE_FRAGMENT':
      return handleQueueFragment(state, command.layerType, command.fragmentId);
    case 'CANCEL_PENDING':
      return handleCancelPending(state, command.layerType);
    case 'FIRE_PENDING_CHANGES':
      return handleFirePendingChanges(state);
    case 'LOAD_SNAPSHOT':
      return handleLoadSnapshot(state, command.snapshot);
    case 'TOGGLE_LIVE_TRACK':
      return handleToggleLiveTrack(state, command.trackId);

    // Audio
    case 'AUDIO_TRANSPORT':
      return [{ type: 'AUDIO_CUE', cue: { type: 'transport', action: command.action } }];
    case 'AUDIO_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'panic' } }];
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
  'finale_assembly',
  'finale_deliberation',
  'finale_ceremony',
  'finale_performer_mix',
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
    case 'finale_assembly': return 12;
    case 'finale_deliberation': return 13;
    case 'finale_ceremony': return 14;
    case 'finale_performer_mix': return 15;
    case 'ended': return 16;
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
  }

  if (nextPhase === 'finale_elegy') {
    // Auto-setup finale state (generate fragments from attempt results)
    console.log('handleAdvancePhase: auto-setup finale state');
    events.push(...handleSetupFinale(state));
  }

  if (nextPhase === 'finale_assembly' && state.finaleState) {
    events.push(...handleStartAssembly(state));
  }

  if (nextPhase === 'finale_deliberation' && state.finaleState) {
    events.push(...handleStartDeliberation(state));
  }

  if (nextPhase === 'finale_ceremony' && state.finaleState) {
    events.push(...handleStartCeremony(state));
  }

  if (nextPhase === 'finale_performer_mix' && state.finaleState) {
    events.push(...handleStartPerformerMix(state));
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
        audioRef: getLayerAudioRef(attempt, 'A'),
        otherAudioRef: getLayerAudioRef(attempt, 'B'),
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
        audioRef: getLayerAudioRef(attempt, prevOption),
      },
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_start',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: nextOption,
        audioRef: getLayerAudioRef(attempt, nextOption),
        otherAudioRef: getLayerAudioRef(attempt, prevOption),
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
  attempt.currentAuditionOption = null;

  return [
    {
      type: 'LAYER_PHASE_CHANGED',
      attemptIndex: attempt.index,
      layerIndex: attempt.currentLayerIndex,
      phase: 'voting',
    },
    {
      type: 'AUDIO_CUE',
      cue: {
        type: 'audition_stop',
        attemptIndex: attempt.index,
        layerIndex: attempt.currentLayerIndex,
        option: null,
      },
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

  if (attempt.currentLayerPhase !== 'voting' && attempt.currentLayerPhase !== 'auditioning') {
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

  if (attempt.currentLayerPhase !== 'voting' && attempt.currentLayerPhase !== 'auditioning') {
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

  // Force locks in the layer with the chosen option, bypassing health bar drain
  return lockInLayer(state, attempt, choice, null);
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
        audioRef: getLayerAudioRef(attempt, 'A'),
        otherAudioRef: getLayerAudioRef(attempt, 'B'),
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

// ============================================================================
// Health Bar Commands
// ============================================================================

function handleSetDrainFactor(state: ShowState, factor: number): ConductorEvent[] {
  const attempt = currentAttempt(state);
  if (!attempt) {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  attempt.healthBar.drainFactor = factor;
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

function handleSetHealth(state: ShowState, value: number): ConductorEvent[] {
  const attempt = currentAttempt(state);
  if (!attempt) {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  attempt.healthBar.current = Math.max(0, Math.min(100, value));
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

function handleForceCollapse(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only force collapse during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  // Force health bar to zero regardless of current value
  attempt.healthBar.current = 0;

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

  return [
    { type: 'SONG_REJECTED', attemptIndex: attempt.index },
    { type: 'AUDIO_CUE', cue: { type: 'rejection_gesture', attemptIndex: attempt.index } },
  ];
}

// ============================================================================
// Layer Resolution
// ============================================================================

/**
 * Resolve the current layer: calculate vote result, apply health bar drain,
 * then either collapse or lock in.
 */
function resolveCurrentLayer(state: ShowState, attempt: AttemptState): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerMultiplier = attempt.healthBar.layerMultipliers[layerIndex] ?? 1.0;

  // 1. Calculate vote result and drain
  const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
  const { voteResult, drain } = calculateVoteResult(
    layerVotes,
    attempt.healthBar.drainFactor,
    layerMultiplier,
    layerIndex,
  );

  // 2. Apply drain to health bar (also sets drain.healthAfter)
  applyDrain(attempt.healthBar, drain);

  // 3. For non-collapse paths: record the layer result early (during revealing)
  //    so the UI can display it before lock-in. For collapse paths, collapseAttempt
  //    handles the result with status='unreached'/drainAmount=null.
  if (!isCollapsed(attempt.healthBar)) {
    const { consensus } = calculateConsensus(layerVotes);
    const layerConfig = attempt.layerPlan[layerIndex];
    attempt.layerResults.push({
      layerIndex,
      type: layerConfig?.type ?? 'melody',
      status: 'locked_in',
      chosenOption: voteResult.winner,
      consensus,
      drainAmount: drain.drainAmount,
    });
  }

  // 4. Store reveal data on attempt for client access during revealing phase
  attempt.currentVoteResult = voteResult;
  attempt.currentDrain = drain;

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

  // 7. Emit HEALTH_BAR_DRAINED (drain.healthAfter now set)
  events.push({
    type: 'HEALTH_BAR_DRAINED',
    attemptIndex: attempt.index,
    layerIndex,
    drain,
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
  const drain = attempt.currentDrain;

  // Clear reveal data
  attempt.currentVoteResult = null;
  attempt.currentDrain = null;

  if (isCollapsed(attempt.healthBar)) {
    return collapseAttempt(state, attempt);
  } else {
    const winner = voteResult?.winner ?? 'A';
    const drainAmount = drain?.drainAmount ?? null;
    return lockInLayer(state, attempt, winner, drainAmount);
  }
}

/**
 * Lock in the current layer with the winning option and advance to next layer.
 * drainAmount is null for forced lock-ins (FORCE_OPTION).
 */
function lockInLayer(
  state: ShowState,
  attempt: AttemptState,
  winner: 'A' | 'B',
  drainAmount: number | null,
): ConductorEvent[] {
  const events: ConductorEvent[] = [];
  const layerIndex = attempt.currentLayerIndex;
  const layerConfig = attempt.layerPlan[layerIndex];

  // Layer result is normally recorded in resolveCurrentLayer during revealing phase.
  // For forced lock-ins (FORCE_OPTION) that bypass resolveCurrentLayer, push it now.
  const existingResult = attempt.layerResults.find(r => r.layerIndex === layerIndex);
  if (!existingResult) {
    const layerVotes = attempt.votes.filter(v => v.layerIndex === layerIndex);
    const { consensus } = calculateConsensus(layerVotes);
    attempt.layerResults.push({
      layerIndex,
      type: layerConfig?.type ?? 'melody',
      status: 'locked_in',
      chosenOption: winner,
      consensus,
      drainAmount,
    });
  } else {
    // Update status/chosenOption in case it was set as 'unreached' during revealing
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
  const winnerAudioRef = winner === 'A' ? layerConfig?.optionA : layerConfig?.optionB;
  const loserAudioRef = loser === 'A' ? layerConfig?.optionA : layerConfig?.optionB;
  events.push({
    type: 'AUDIO_CUE',
    cue: {
      type: 'lock_in',
      attemptIndex: attempt.index,
      layerIndex,
      winner,
      winnerAudioRef: winnerAudioRef ?? { trackIndex: 0 },
      loserAudioRef: loserAudioRef ?? { trackIndex: 0 },
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
      type: attempt.layerPlan[attempt.currentLayerIndex]?.type ?? 'melody',
      status: 'unreached',
      chosenOption: null,
      consensus: null,
      drainAmount: null,
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
    healthBar: attempt.healthBar,
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
        drainAmount: null,
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
    healthBar: createHealthBar(attemptConfig.drainFactor, attemptConfig.layerMultipliers),
    currentVoteResult: null,
    currentDrain: null,
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
  const allFragmentAvailability = generateFragments(state.attempts, state.config.attempts, state.config.finale.audioPreviewPath);
  const availableFragments = allFragmentAvailability.filter(fa => fa.selectable).map(fa => fa.fragment);
  const lockedFragments = allFragmentAvailability.filter(fa => !fa.selectable).map(fa => fa.fragment);
  const allFragments = allFragmentAvailability.map(fa => fa.fragment);

  state.finaleState = {
    phase: 'elegy',
    availableFragments,
    allFragments,
    lockedFragments,
    assembly: {
      groups: new Map(),
      undecidedUsers: [],
      timerRemaining: 0,
      timerDuration: 0,
    },
    deliberation: {
      groupVotes: new Map(),
      chosenFragments: new Map(),
      ambassadorVolunteers: new Map(),
      ambassadors: new Map(),
      timerRemaining: 0,
      volunteerTimerRemaining: null,
    },
    ceremony: {
      layerOrder: state.config.finale.ceremonyLayerOrder,
      currentIndex: 0,
      currentAmbassador: null,
      altarReady: false,
      lockedLayers: new Map(),
      forfeitedLayers: [],
      ceremonyComplete: false,
    },
    npc: {
      currentMessage: null,
    },
    performerMix: {
      activeLayers: new Map(),
      pendingChanges: [],
      loopPosition: 0,
      loopCount: 0,
      liveTracksActive: [],
    },
  };

  return [{ type: 'FINALE_SETUP_COMPLETE', availableFragments, lockedFragments }];
}

// ============================================================================
// Assembly Handlers
// ============================================================================

function handleStartAssembly(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const assembly = initializeAssembly(state.users, state.config.finale);
  state.finaleState.assembly = assembly;
  state.finaleState.phase = 'assembly';
  const npcMsg = getNpcMessage(state.config.finale.npcMessages, 'assembly_start');
  const events: ConductorEvent[] = [{ type: 'ASSEMBLY_STARTED', timerDuration: assembly.timerDuration }];
  if (npcMsg) {
    state.finaleState.npc.currentMessage = npcMsg;
    events.push({ type: 'NPC_MESSAGE', message: npcMsg });
  }
  return events;
}

function handleJoinGroup(state: ShowState, userId: UserId, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  joinGroup(state.finaleState.assembly, userId, layerType);
  const { groups, undecidedUsers } = state.finaleState.assembly;
  return [{ type: 'GROUP_MEMBERSHIP_CHANGED', groups, undecidedCount: undecidedUsers.length }];
}

function handleAssemblyTimerExpired(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  assignUndecided(state.finaleState.assembly);
  const { groups } = state.finaleState.assembly;
  const emptyGroups = getEmptyGroups(state.finaleState.assembly);
  return [{ type: 'ASSEMBLY_COMPLETE', groups, emptyGroups }];
}

function handleExtendAssemblyTimer(state: ShowState, additionalMs: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.assembly.timerRemaining += additionalMs;
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

// ============================================================================
// Deliberation Handlers
// ============================================================================

function handleStartDeliberation(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const deliberation = initializeDeliberation(
    state.finaleState.assembly.groups,
    state.finaleState.availableFragments,
    state.config.finale,
  );
  state.finaleState.deliberation = deliberation;
  state.finaleState.phase = 'deliberation';
  return [{ type: 'DELIBERATION_STARTED', timerDuration: deliberation.timerRemaining }];
}

function handleSubmitGroupVote(state: ShowState, userId: UserId, layerType: LayerType, fragmentId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { accepted } = submitGroupVote(
    state.finaleState.deliberation,
    state.finaleState.assembly.groups,
    userId, layerType, fragmentId,
  );
  if (!accepted) return [];
  const votes = getGroupVoteCounts(state.finaleState.deliberation, layerType);
  return [{ type: 'GROUP_VOTE_UPDATED', layerType, votes }];
}

function handleDeliberationTimerExpired(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  resolveDeliberation(
    state.finaleState.deliberation,
    state.finaleState.assembly.groups,
    state.finaleState.availableFragments,
  );
  const events: ConductorEvent[] = [];
  for (const [layerType, fragmentId] of state.finaleState.deliberation.chosenFragments) {
    if (fragmentId) events.push({ type: 'FRAGMENT_CHOSEN', layerType, fragmentId });
  }
  // Start ambassador volunteering timer
  state.finaleState.deliberation.volunteerTimerRemaining = state.config.finale.ambassadorVolunteerTimerMs;
  return events;
}

function handleVolunteerAsAmbassador(state: ShowState, userId: UserId, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { accepted } = volunteerAsAmbassador(
    state.finaleState.deliberation,
    state.finaleState.assembly.groups,
    userId, layerType,
  );
  if (!accepted) return [];
  return [{ type: 'AMBASSADOR_VOLUNTEERED', layerType, userId }];
}

function handleAmbassadorVolunteerTimerExpired(state: ShowState, _layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { forfeitedLayers } = resolveAmbassadors(
    state.finaleState.deliberation,
    state.finaleState.assembly.groups,
  );
  const events: ConductorEvent[] = [];
  for (const [layerType, userId] of state.finaleState.deliberation.ambassadors) {
    if (userId) events.push({ type: 'AMBASSADOR_SELECTED', layerType, userId });
  }
  for (const layerType of forfeitedLayers) {
    events.push({ type: 'LAYER_FORFEITED', layerType });
  }
  state.finaleState.deliberation.volunteerTimerRemaining = null;
  events.push({ type: 'DELIBERATION_COMPLETE' });
  return events;
}

function handleForceFragmentSelection(state: ShowState, layerType: LayerType, fragmentId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.deliberation.chosenFragments.set(layerType, fragmentId);
  return [{ type: 'FRAGMENT_CHOSEN', layerType, fragmentId }];
}

function handleExtendDeliberationTimer(state: ShowState, additionalMs: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.deliberation.timerRemaining += additionalMs;
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

function handleForceEndDeliberation(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const timerEvents = handleDeliberationTimerExpired(state);
  // Also immediately resolve ambassadors
  const ambassadorEvents = handleAmbassadorVolunteerTimerExpired(state, 'melody');
  return [...timerEvents, ...ambassadorEvents];
}

// ============================================================================
// Ceremony Handlers
// ============================================================================

function handleStartCeremony(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { deliberation } = state.finaleState;
  // Collect forfeited layers (empty groups + no ambassador)
  const forfeitedLayers: LayerType[] = [];
  for (const [layerType, userId] of deliberation.ambassadors) {
    if (!userId) forfeitedLayers.push(layerType);
  }
  const ceremony = initializeCeremony(
    state.config.finale.ceremonyLayerOrder,
    deliberation.chosenFragments,
    deliberation.ambassadors,
    forfeitedLayers,
  );
  state.finaleState.ceremony = ceremony;
  state.finaleState.phase = 'ceremony';
  return [{ type: 'CEREMONY_STARTED', layerOrder: ceremony.layerOrder }];
}

function handleCallNextAmbassador(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { ceremony, deliberation } = state.finaleState;
  const { layerType, ambassador, skipped } = callNextAmbassador(ceremony, deliberation.ambassadors);
  const events: ConductorEvent[] = [];
  for (const s of skipped) {
    events.push({ type: 'CEREMONY_LAYER_SKIPPED', layerType: s });
  }
  if (layerType === null) {
    ceremony.ceremonyComplete = true;
    events.push({ type: 'CEREMONY_COMPLETE', lockedLayers: ceremony.lockedLayers });
  } else if (ambassador) {
    events.push({ type: 'AMBASSADOR_CALLED', layerType, userId: ambassador });
  }
  return events;
}

function handleAltarLockIn(state: ShowState, userId: UserId, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { ceremony, deliberation } = state.finaleState;
  const { accepted, fragmentId } = processAltarLockIn(ceremony, deliberation.chosenFragments, userId, layerType);
  if (!accepted) return [];
  const events: ConductorEvent[] = [{ type: 'ALTAR_LOCK_IN_DETECTED', layerType, fragmentId: fragmentId ?? '' }];
  if (fragmentId) {
    const fragment = state.finaleState.availableFragments.find(f => f.id === fragmentId);
    events.push({ type: 'CEREMONY_LAYER_LOCKED', layerType, fragmentId });
    if (fragment) {
      events.push({ type: 'AUDIO_CUE', cue: { type: 'ceremony_activate', layerType, fragmentId, audioRef: fragment.audioRef } });
    }
  }
  if (isCeremonyComplete(ceremony)) {
    ceremony.ceremonyComplete = true;
    events.push({ type: 'CEREMONY_COMPLETE', lockedLayers: ceremony.lockedLayers });
  }
  return events;
}

function handleForceLockIn(state: ShowState, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { ceremony, deliberation } = state.finaleState;
  const { fragmentId } = forceLockIn(ceremony, deliberation.chosenFragments, layerType);
  const events: ConductorEvent[] = [];
  if (fragmentId) {
    const fragment = state.finaleState.availableFragments.find(f => f.id === fragmentId);
    events.push({ type: 'CEREMONY_LAYER_LOCKED', layerType, fragmentId });
    if (fragment) {
      events.push({ type: 'AUDIO_CUE', cue: { type: 'ceremony_activate', layerType, fragmentId, audioRef: fragment.audioRef } });
    }
  }
  if (isCeremonyComplete(ceremony)) {
    ceremony.ceremonyComplete = true;
    events.push({ type: 'CEREMONY_COMPLETE', lockedLayers: ceremony.lockedLayers });
  }
  return events;
}

function handleForfeitLayer(state: ShowState, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  forfeitLayer(state.finaleState.ceremony, layerType);
  return [{ type: 'CEREMONY_LAYER_SKIPPED', layerType }];
}

function handleSkipToLayer(state: ShowState, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  skipToLayer(state.finaleState.ceremony, layerType);
  return [{ type: 'STATE_UPDATED', version: state.version }];
}

function handleSendNpcMessage(state: ShowState, message: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.npc.currentMessage = message;
  return [{ type: 'NPC_MESSAGE', message }];
}

function handleStartPerformerMix(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { finaleState } = state;
  finaleState.phase = 'performer_mix';
  finaleState.performerMix.activeLayers = new Map(finaleState.ceremony.lockedLayers);

  return [{ type: 'PERFORMER_MIX_STARTED' }];
}

function handleQueueFragment(state: ShowState, layerType: LayerType, fragmentId: string | null): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.performerMix.pendingChanges = queueChange(
    state.finaleState.performerMix.pendingChanges,
    layerType,
    fragmentId,
  );
  return [];
}

function handleCancelPending(state: ShowState, layerType: LayerType): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.performerMix.pendingChanges = cancelPending(
    state.finaleState.performerMix.pendingChanges,
    layerType,
  );
  return [];
}

function handleFirePendingChanges(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { performerMix } = state.finaleState;
  const { activeLayers, firedChanges } = firePendingChanges(
    performerMix.activeLayers,
    performerMix.pendingChanges,
  );
  performerMix.activeLayers = activeLayers;
  performerMix.pendingChanges = [];

  return [
    { type: 'PENDING_CHANGES_FIRED', changes: firedChanges },
    { type: 'AUDIO_CUE', cue: { type: 'mix_update', changes: firedChanges } },
    { type: 'MIX_STATE_UPDATED', activeLayers },
  ];
}

function handleLoadSnapshot(state: ShowState, snapshot: Map<LayerType, string | null>): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  let pending = state.finaleState.performerMix.pendingChanges;
  for (const [layerType, fragmentId] of snapshot) {
    pending = queueChange(pending, layerType, fragmentId);
  }
  state.finaleState.performerMix.pendingChanges = pending;
  return [];
}

function handleToggleLiveTrack(state: ShowState, trackId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  const { liveTracksActive } = state.finaleState.performerMix;
  const idx = liveTracksActive.indexOf(trackId);
  if (idx === -1) {
    liveTracksActive.push(trackId);
  } else {
    liveTracksActive.splice(idx, 1);
  }
  return [];
}

// ============================================================================
// Utilities
// ============================================================================

/** Get the current attempt, or null if none. */
function currentAttempt(state: ShowState): AttemptState | null {
  return state.attempts[state.currentAttemptIndex] ?? null;
}

/** Get the AudioReference for the given option on the current layer. */
function getLayerAudioRef(attempt: AttemptState, option: 'A' | 'B'): AudioReference {
  const layerConfig = attempt.layerPlan[attempt.currentLayerIndex];
  return option === 'A' ? layerConfig.optionA : layerConfig.optionB;
}

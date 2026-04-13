/**
 * Conductor — Pure State Machine (V3.4)
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O — all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Show flow:
 *   lobby → opener → (attempt_story → attempt_build → attempt_resolve) ×3 →
 *   finale_vote → finale_remix → ended
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
  FinaleState,
  Token,
  VotePhaseConfig,
  V32LayerConfig,
  TrackBundle,
  GranularType,
  TokenPool,
} from './types';
import { getSlideMaxStep } from './types';
import { calculateConsensus, calculateVoteResult } from './voting';
import { checkThreshold } from './threshold';
import {
  getNextQuestion,
  calculateMaxQuestionsPerPerson,
  processEmotion,
} from './question-engine';
import {
  queueToken as remixQueueToken,
  cancelQueue as remixCancelQueue,
  advanceNode as remixAdvanceNode,
  processLoopBoundary as remixProcessLoopBoundary,
  toggleAudienceInteraction as remixToggleAudienceInteraction,
} from './remix-engine';
import { createTokenPool } from './token-pool';

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
  crossfadeBeats: 1,
  unityGainValue: 0.5,
  stepsPerBeat: 2,
  masterDuckGain: 0.3,
  masterDuckBeats: 2,
  masterUnduckBeats: 1,
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
    revealStakesShown: false,
    songRejected: false,
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
    openerSlideState: null,
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
    case 'ADVANCE_SLIDE':
      return handleAdvanceSlide(state);
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
    case 'REVEAL_STAKES':
      return handleRevealStakes(state);
    case 'ADVANCE_FROM_REVEAL':
      return handleAdvanceFromReveal(state);
    case 'ADVANCE_FROM_VERDICT':
      return handleAdvanceFromVerdict(state);
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
    case 'SEND_NPC_MESSAGE':
      return handleSendNpcMessage(state, command.message);

    // Audio
    case 'AUDIO_TRANSPORT':
      return [{ type: 'AUDIO_CUE', cue: { type: 'transport', action: command.action } }];
    case 'AUDIO_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'panic' } }];
    case 'MASTER_PANIC':
      return [{ type: 'AUDIO_CUE', cue: { type: 'master_panic' } }];
    case 'RESET_UTILITIES':
      return [{ type: 'AUDIO_CUE', cue: { type: 'reset_utilities' } }];
    case 'MASTER_DUCK':
      return [{ type: 'AUDIO_CUE', cue: { type: 'master_duck' } }];
    case 'MASTER_UNDUCK':
      return [{ type: 'AUDIO_CUE', cue: { type: 'master_unduck' } }];

    // Connection
    case 'USER_CONNECT':
      return handleUserConnect(state, command.userId, command.seatId);
    case 'USER_DISCONNECT':
      return handleUserDisconnect(state, command.userId);

    // Finale — Vote phase (V3.4)
    case 'START_VOTE':
      return handleStartVote(state);
    case 'SUBMIT_EMOTION':
      return handleSubmitEmotion(state, command.userId, command.chapterId, command.questionIndex);
    case 'REQUEST_NEXT_QUESTION':
      return handleRequestNextQuestion(state, command.userId);
    case 'POOL_CAP_REACHED':
      return handlePoolCapReached(state);

    // Finale — Remix phase (V3.4)
    case 'START_REMIX':
      return handleStartRemix(state);
    case 'QUEUE_TOKEN':
      return handleQueueToken(state, command.granularType, command.chapterId, command.instant);
    case 'CANCEL_QUEUE':
      return handleCancelQueue(state, command.granularType);
    case 'ADVANCE_NODE':
      return handleAdvanceNode(state, command.granularType);
    case 'TOGGLE_AUDIENCE_INTERACTION':
      return handleToggleAudienceInteraction(state);
    case 'LOOP_BOUNDARY':
      return handleLoopBoundary(state);

    // Manual end (V3.4)
    case 'END_SHOW':
      return handleEndShow(state);

    // Testing — inject tokens into the pool
    case 'INJECT_TOKENS':
      return handleInjectTokens(state, command.chapterId, command.count);

    // Failsafe
    case 'GENERATE_VALID_FINALE':
      return handleGenerateValidFinale(state);

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
  'finale_vote',         // V3.4
  'finale_remix',        // V3.4
  'ended',
];

function handleAdvanceSlide(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'opener') {
    return [{ type: 'ERROR', message: 'ADVANCE_SLIDE only valid during opener phase' }];
  }

  const slides = state.config.openerSlides;
  if (!slides || slides.length === 0) {
    return [{ type: 'ERROR', message: 'No opener slides configured' }];
  }

  const cur = state.openerSlideState;

  if (cur === null) {
    // Blank → show first slide title
    state.openerSlideState = { pointIndex: 0, stepIndex: 0 };
  } else {
    const slide = slides[cur.pointIndex];
    const maxStep = getSlideMaxStep(slide);

    if (cur.stepIndex < maxStep) {
      // Reveal next step within this slide
      state.openerSlideState = { pointIndex: cur.pointIndex, stepIndex: cur.stepIndex + 1 };
    } else if (cur.pointIndex < slides.length - 1) {
      // Next slide
      state.openerSlideState = { pointIndex: cur.pointIndex + 1, stepIndex: 0 };
    } else {
      // Past last slide → blank
      state.openerSlideState = null;
    }
  }

  return [
    { type: 'OPENER_SLIDE_CHANGED', position: state.openerSlideState },
    { type: 'STATE_UPDATED', version: state.version },
  ];
}

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
    case 'finale_vote': return 11;
    case 'finale_remix': return 12;
    case 'ended': return 13;
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

  const prevPhase = state.phase;
  state.phase = nextPhase;

  // Unduck master when leaving attempt_build (covers attempt_resolve transition, next attempt_story, etc.)
  if (prevPhase === 'attempt_build' && nextPhase !== 'attempt_build') {
    events.push({ type: 'AUDIO_CUE', cue: { type: 'master_unduck' } });
  }

  // Phase entry side effects
  if (nextPhase === 'opener') {
    state.openerSlideState = null;
  }

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
    // Duck master for performer speech (unducked when audition starts)
    events.push({ type: 'AUDIO_CUE', cue: { type: 'master_duck' } });
  }

  if (nextPhase === 'finale_vote') {
    // Auto-setup V3.4 finale state
    console.log('handleAdvancePhase: auto-setup V3.4 finale state');
    events.push(...handleSetupFinaleV34(state));
  }

  if (nextPhase === 'finale_remix') {
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'live_seed_stop',
      attemptIndex: 3,
        trackIndices: state.config.finale.soundscapeTrackIndices,
      },
    });
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
    // Unduck master for audition playback
    { type: 'AUDIO_CUE', cue: { type: 'master_unduck' } },
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
  attempt.revealStakesShown = false;
  attempt.currentVoteResult = null;

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
      type: 'AUDIO_CUE',
      cue: {
        type: 'master_unduck',
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

  if (attempt.songRejected) {
    return []; // Already rejected; ignore duplicate
  }

  attempt.songRejected = true;

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

  // 0. Stop audition audio — master stays unducked for the reveal sequence
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
 * Show the stakes (threshold) during the revealing phase.
 * Beat 1 of the two-beat reveal — projector shows the threshold bar.
 * Does not change the conductor phase.
 */
function handleRevealStakes(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only reveal stakes during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt || attempt.status !== 'in_progress') {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  if (attempt.currentLayerPhase !== 'revealing') {
    return [{ type: 'ERROR', message: `Cannot reveal stakes from layer phase: ${attempt.currentLayerPhase}` }];
  }

  if (attempt.revealStakesShown) {
    return []; // Already shown; ignore duplicate
  }

  attempt.revealStakesShown = true;

  const layerResult = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
  const threshold = layerResult?.thresholdRequired ?? 0.5;

  return [{
    type: 'REVEAL_STAKES_SHOWN',
    attemptIndex: attempt.index,
    layerIndex: attempt.currentLayerIndex,
    threshold,
  }];
}

/**
 * Advance from the revealing phase to locked_in or collapsed.
 * Beat 2 of the two-beat reveal — sets the verdict state but does NOT
 * auto-advance to the next layer/attempt. The timing engine schedules
 * ADVANCE_FROM_VERDICT after the verdict animation completes.
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

  // Clear reveal flag
  attempt.revealStakesShown = false;

  // Determine pass/collapse from the layer result recorded during resolveCurrentLayer
  const layerResult = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
  const passed = layerResult?.passed ?? true;
  const events: ConductorEvent[] = [];

  if (!passed) {
    // Mark as collapsed but don't auto-advance yet — verdict animation plays first
    attempt.status = 'collapsed';
    attempt.collapsedAtLayer = attempt.currentLayerIndex;
    attempt.currentLayerPhase = 'collapsed';
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
    // Unduck master — song collapsed, leaving build phase
    events.push({ type: 'AUDIO_CUE', cue: { type: 'master_unduck' } });
  } else {
    // Lock in the layer but don't advance to next layer yet — verdict animation plays first
    const winner = attempt.currentVoteResult?.winner ?? 'A';
    const layerIndex = attempt.currentLayerIndex;
    const layerConfig = attempt.layerPlan[layerIndex];

    // Record layer result
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
    // Duck master after lock-in — performer narrates before next layer
    events.push({ type: 'AUDIO_CUE', cue: { type: 'master_duck' } });
  }

  // Don't clear currentVoteResult yet — projector needs it for verdict animation.
  // It will be cleared by ADVANCE_FROM_VERDICT.
  return events;
}

/**
 * Advance from the verdict state to the next layer or attempt.
 * Fired by the timing engine after the verdict animation completes.
 */
function handleAdvanceFromVerdict(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'attempt_build') {
    return [{ type: 'ERROR', message: 'Can only advance from verdict during attempt_build' }];
  }

  const attempt = currentAttempt(state);
  if (!attempt) {
    return [{ type: 'ERROR', message: 'No active attempt' }];
  }

  // Clear vote result now that verdict animation is done
  attempt.currentVoteResult = null;

  if (attempt.currentLayerPhase === 'collapsed') {
    return autoAdvanceAfterCollapse(state);
  }

  if (attempt.currentLayerPhase === 'locked_in') {
    const layerIndex = attempt.currentLayerIndex;
    if (layerIndex < attempt.layerPlan.length - 1) {
      attempt.currentLayerIndex = layerIndex + 1;
      attempt.currentLayerPhase = 'locked';
      return [];
    } else {
      attempt.status = 'completed';
      markUnreachedLayers(attempt);

      const events: ConductorEvent[] = [];
      events.push({ type: 'ATTEMPT_COMPLETED', attemptIndex: attempt.index });
      // Unduck master — song completed, leaving build phase
      events.push({ type: 'AUDIO_CUE', cue: { type: 'master_unduck' } });

      state.phase = 'attempt_resolve';
      events.push({
        type: 'SHOW_PHASE_CHANGED',
        phase: 'attempt_resolve',
        attemptIndex: state.currentAttemptIndex,
      });
      return events;
    }
  }

  return []; // Already advanced; ignore
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

  // Note: live_seed_stop is NOT emitted here because collapse_gesture already
  // includes the live seed tracks in its wall-clock gain ramp (audio-router.ts).
  // Emitting a separate beat-locked live_seed_stop would race with the collapse
  // ramp, causing the track to be unmuted and faded back in by stale beat callbacks.

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
    revealStakesShown: false,
    songRejected: false,
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

function handleSendNpcMessage(state: ShowState, message: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.npc.currentMessage = message;
  return [{ type: 'NPC_MESSAGE', message }];
}

// ============================================================================
// V3.4 Finale Handlers
// ============================================================================

function handleSetupFinaleV34(state: ShowState): ConductorEvent[] {
  const v34Config = state.config.finale;
  if (!v34Config) {
    return [{ type: 'ERROR', message: 'No finale config found in show config' }];
  }

  const audienceCount = countConnectedUsers(state);
  const maxQ = calculateMaxQuestionsPerPerson(v34Config.vote.targetPoolSize, audienceCount);

  // Build chapter → songIndex mapping from attempt configs
  const chapterSongIndex = new Map<string, number>();
  for (let i = 0; i < state.config.attempts.length; i++) {
    chapterSongIndex.set(state.config.attempts[i].chapter, i);
  }

  // Build trackMap from attempt results (vote-aware, includes liveSeed)
  const trackMap = buildTrackMapFromConfig(state);

  const finaleState: FinaleState = {
    phase: 'vote',
    vote: {
      questionsAnsweredByUser: new Map(),
      maxQuestionsPerPerson: maxQ,
      poolCapReached: false,
    },
    pool: {
      tokens: [],
      availableByChapter: new Map(),
      totalByChapter: new Map(),
      totalRemaining: 0,
      targetPoolSize: v34Config.vote.targetPoolSize,
    },
    queue: new Map(),
    active: new Map(),
    audienceInteraction: v34Config.remix.audienceInteraction,
    chapterSongIndex,
    trackMap,
    loopCount: 0,
    loopProgress: 0,
    npc: { currentMessage: null },
  };

  state.finaleState = finaleState;

  return [
    { type: 'VOTE_STARTED' },
    { type: 'AUDIO_CUE', cue: { type: 'live_seed_start', attemptIndex: 3, trackIndices: state.config.finale.soundscapeTrackIndices } },
  ];
}

function handleStartVote(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_vote') {
    return [{ type: 'ERROR', message: 'START_VOTE only valid during finale_vote phase' }];
  }
  // Vote is already started by phase transition; this is a no-op re-trigger
  return [];
}

function handleSubmitEmotion(
  state: ShowState,
  userId: UserId,
  chapterId: string,
  questionIndex: number,
): ConductorEvent[] {
  if (state.phase !== 'finale_vote') {
    return [{ type: 'ERROR', message: 'SUBMIT_EMOTION only valid during finale_vote' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState || finaleState.phase !== 'vote') {
    return [{ type: 'ERROR', message: 'Finale not in vote phase' }];
  }

  const result = processEmotion(finaleState, userId, chapterId, questionIndex);
  state.finaleState = result.state;
  return result.events;
}

function handleRequestNextQuestion(state: ShowState, userId: UserId): ConductorEvent[] {
  if (state.phase !== 'finale_vote') {
    return [{ type: 'ERROR', message: 'REQUEST_NEXT_QUESTION only valid during finale_vote' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState || finaleState.phase !== 'vote') {
    return [{ type: 'ERROR', message: 'Finale not in vote phase' }];
  }

  const v34Config = state.config.finale;
  if (!v34Config) {
    return [{ type: 'ERROR', message: 'No V3.4 finale config' }];
  }

  const answeredCount = finaleState.vote.questionsAnsweredByUser.get(userId) ?? 0;
  const question = getNextQuestion(v34Config.vote, answeredCount, finaleState.vote.maxQuestionsPerPerson, userId);

  if (!question) {
    return []; // No more questions for this user
  }

  return [{
    type: 'NEXT_QUESTION',
    userId,
    questionIndex: answeredCount,
    questionText: question.text,
    answers: question.answers ?? null,
  }];
}

function handlePoolCapReached(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_vote') {
    return [{ type: 'ERROR', message: 'POOL_CAP_REACHED only valid during finale_vote' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  finaleState.vote.poolCapReached = true;
  state.finaleState = finaleState;

  return [{
    type: 'POOL_CAP_REACHED',
    finalPoolSize: finaleState.pool.tokens.length,
  }];
}

function handleStartRemix(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_vote' && state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'START_REMIX only valid from finale_vote or finale_remix' }];
  }

  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  // Transition to remix phase
  finaleState.phase = 'remix';
  state.phase = 'finale_remix';
  state.finaleState = finaleState;

  const pool: TokenPool = {
    available: finaleState.pool.availableByChapter,
    total: finaleState.pool.totalByChapter,
  };

  return [
    { type: 'SHOW_PHASE_CHANGED', phase: 'finale_remix', attemptIndex: state.currentAttemptIndex },
    { type: 'REMIX_STARTED', pool },
    { type: 'AUDIO_CUE', cue: { type: 'remix_start' } },
    { type: 'AUDIO_CUE', cue: { type: 'live_seed_stop', attemptIndex: 3, trackIndices: state.config.finale.soundscapeTrackIndices } },
  ];
}

function handleQueueToken(
  state: ShowState,
  granularType: string,
  chapterId: string,
  instant?: boolean,
): ConductorEvent[] {
  if (state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'QUEUE_TOKEN only valid during finale_remix' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = remixQueueToken(finaleState, granularType, chapterId, instant);
  state.finaleState = result.state;
  return result.events;
}

function handleCancelQueue(state: ShowState, granularType: string): ConductorEvent[] {
  if (state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'CANCEL_QUEUE only valid during finale_remix' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = remixCancelQueue(finaleState, granularType);
  state.finaleState = result.state;
  return result.events;
}

function handleAdvanceNode(state: ShowState, granularType: string): ConductorEvent[] {
  if (state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'ADVANCE_NODE only valid during finale_remix' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = remixAdvanceNode(finaleState, granularType);
  state.finaleState = result.state;
  return result.events;
}

function handleToggleAudienceInteraction(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'TOGGLE_AUDIENCE_INTERACTION only valid during finale_remix' }];
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = remixToggleAudienceInteraction(finaleState);
  state.finaleState = result.state;
  return result.events;
}

function handleLoopBoundary(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_remix') {
    return []; // Silently ignore loop boundaries outside remix
  }
  const finaleState = state.finaleState as FinaleState;
  if (!finaleState) return [];

  const result = remixProcessLoopBoundary(finaleState);
  state.finaleState = result.state;

  // If POOL_EMPTY was emitted, auto-transition to ended
  const poolEmpty = result.events.some(e => e.type === 'POOL_EMPTY');
  if (poolEmpty) {
    state.phase = 'ended';
    result.events.push({ type: 'SHOW_PHASE_CHANGED', phase: 'ended', attemptIndex: state.currentAttemptIndex });
  }

  return result.events;
}

function handleEndShow(state: ShowState): ConductorEvent[] {
  if (state.phase !== 'finale_vote' && state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'END_SHOW only valid during finale phases' }];
  }

  state.phase = 'ended';
  return [{ type: 'SHOW_PHASE_CHANGED', phase: 'ended', attemptIndex: state.currentAttemptIndex }];
}

function handleInjectTokens(state: ShowState, chapterId: string, count: number): ConductorEvent[] {
  if (state.phase !== 'finale_vote' && state.phase !== 'finale_remix') {
    return [{ type: 'ERROR', message: 'INJECT_TOKENS only valid during finale phases' }];
  }

  const fs = state.finaleState as FinaleState | null;
  if (!fs) return [{ type: 'ERROR', message: 'No finale state' }];

  const startId = fs.pool.tokens.length;
  const newTokens: Token[] = [];
  for (let i = 0; i < count; i++) {
    newTokens.push({
      id: `injected-${startId + i}`,
      ownerId: '__controller__',
      chapterId,
      questionIndex: -1,
      status: 'available',
    });
  }

  fs.pool.tokens = [...fs.pool.tokens, ...newTokens];
  const prev = fs.pool.availableByChapter.get(chapterId) ?? 0;
  fs.pool.availableByChapter.set(chapterId, prev + count);
  const prevTotal = fs.pool.totalByChapter.get(chapterId) ?? 0;
  fs.pool.totalByChapter.set(chapterId, prevTotal + count);
  fs.pool.totalRemaining += count;

  return [{ type: 'STATE_UPDATED', version: state.version }];
}

/**
 * Failsafe: generate a valid finale from a blank show.
 * Populates synthetic layerResults on all attempts using config-driven defaultWinners,
 * then transitions to finale_vote and initializes FinaleState with a valid trackMap.
 * If already in finale_vote, just rebuilds the trackMap from current attempt state.
 */
function handleGenerateValidFinale(state: ShowState): ConductorEvent[] {
  const events: ConductorEvent[] = [];

  // Populate synthetic layerResults for every attempt
  for (let i = 0; i < state.attempts.length; i++) {
    const attempt = state.attempts[i];
    const config = state.config.attempts[i];
    if (!config) continue;

    const defaultWinners = config.defaultWinners ?? config.layers.map(() => 'A' as const);

    attempt.status = 'completed';
    attempt.currentLayerIndex = config.layers.length - 1;
    attempt.currentLayerPhase = 'locked_in';
    attempt.collapsedAtLayer = null;
    attempt.layerResults = config.layers.map((layer, layerIdx) => ({
      layerIndex: layer.index,
      group: layer.group,
      status: 'locked_in' as const,
      chosenOption: defaultWinners[layerIdx] ?? 'A',
      winningProportion: 1.0,
      thresholdRequired: config.thresholds[layerIdx] ?? 0.5,
      passed: true,
    }));
  }

  // If not already in a finale phase, transition to finale_vote
  if (state.phase !== 'finale_vote' && state.phase !== 'finale_remix') {
    state.phase = 'finale_vote';
    events.push({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'finale_vote',
      attemptIndex: state.currentAttemptIndex,
    });
  }

  // (Re)initialize the finale state with valid trackMap built from the synthetic results
  events.push(...handleSetupFinaleV34(state));

  return events;
}

/**
 * Build trackMap from attempt configs for V3.4 remix.
 * Maps granularType → songIndex → trackIndices.
 * Same logic as V3.3 buildTrackMap but reads from attempt configs directly.
 */
/**
 * Build trackMap from attempt results (vote-aware).
 * Only includes tracks from winning options (or both if bothOptionsSurvive).
 * Also includes liveSeed tracks for the "seed" granular type.
 *
 * Mirrors the logic in fragments.ts generateGranularFragments() for consistency.
 */
function buildTrackMapFromConfig(state: ShowState): Map<string, Map<number, number[]>> {
  const trackMap = new Map<string, Map<number, number[]>>();
  const bothOptionsSurvive = state.config.finale.bothOptionsSurvive;

  function addTracks(granularType: string, songIndex: number, trackIndices: number[]): void {
    if (trackIndices.length === 0) return;
    if (!trackMap.has(granularType)) {
      trackMap.set(granularType, new Map());
    }
    const typeMap = trackMap.get(granularType)!;
    const existing = typeMap.get(songIndex);
    if (existing) {
      // Merge track indices for same granularType + songIndex (same as mergeTracksByGranularType)
      typeMap.set(songIndex, [...existing, ...trackIndices]);
    } else {
      typeMap.set(songIndex, [...trackIndices]);
    }
  }

  for (let songIndex = 0; songIndex < state.config.attempts.length; songIndex++) {
    const attemptConfig = state.config.attempts[songIndex];
    const attemptState = state.attempts[songIndex];

    for (const layer of attemptConfig.layers) {
      const result = attemptState?.layerResults.find(r => r.layerIndex === layer.index);
      const isVoted = result
        && (result.status === 'locked_in' || result.status === 'collapsed')
        && result.chosenOption !== null;

      if (isVoted) {
        const winOption = result!.chosenOption!;
        const winBundle = winOption === 'A' ? layer.optionA : layer.optionB;
        const loseBundle = winOption === 'A' ? layer.optionB : layer.optionA;

        // Winner tracks — always included
        for (const trackRef of winBundle.tracks) {
          addTracks(trackRef.granularType, songIndex, trackRef.trackIndices);
        }

        // Loser tracks — only if bothOptionsSurvive or alwaysAvailable
        for (const trackRef of loseBundle.tracks) {
          if (bothOptionsSurvive || trackRef.alwaysAvailable) {
            addTracks(trackRef.granularType, songIndex, trackRef.trackIndices);
          }
        }
      } else {
        // Unreached layer — only alwaysAvailable tracks
        for (const trackRef of layer.optionA.tracks) {
          if (trackRef.alwaysAvailable) {
            addTracks(trackRef.granularType, songIndex, trackRef.trackIndices);
          }
        }
        for (const trackRef of layer.optionB.tracks) {
          if (trackRef.alwaysAvailable) {
            addTracks(trackRef.granularType, songIndex, trackRef.trackIndices);
          }
        }
      }
    }

    // Add seed tracks from liveSeed
    const liveSeed = attemptConfig.liveSeed;
    if (liveSeed?.trackIndices?.length) {
      addTracks('seed', songIndex, liveSeed.trackIndices);
    }
  }

  return trackMap;
}

// ============================================================================
// Utilities
// ============================================================================

/** Get the current attempt, or null if none. */
function currentAttempt(state: ShowState): AttemptState | null {
  return state.attempts[state.currentAttemptIndex] ?? null;
}

/** Count connected users. */
function countConnectedUsers(state: ShowState): number {
  let count = 0;
  for (const user of state.users.values()) {
    if (user.connected) count++;
  }
  return count;
}

/** Get the TrackBundle for the given option on the current layer. */
function getLayerTrackBundle(attempt: AttemptState, option: 'A' | 'B'): TrackBundle {
  const layerConfig = attempt.layerPlan[attempt.currentLayerIndex];
  return option === 'A' ? layerConfig.optionA : layerConfig.optionB;
}

/** Empty TrackBundle fallback for edge cases. */
const EMPTY_TRACK_BUNDLE: TrackBundle = { tracks: [] };

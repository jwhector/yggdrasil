/**
 * Conductor — Pure State Machine (V3.3)
 *
 * The conductor is the heart of the system. It receives commands, validates them,
 * updates state, and emits events. It has no I/O — all side effects are handled
 * by the server layer.
 *
 * Architecture: (state, command) => (newState, events)
 *
 * Show flow:
 *   lobby → opener → (attempt_story → attempt_build → attempt_resolve) ×3 →
 *   finale_elegy → finale_assignment → finale_preview → finale_playback → ended
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
  V33FinaleState,
  V32LayerConfig,
  TrackBundle,
  GranularType,
  ArcConfig,
  ArcPhase,
  QuiltCell,
} from './types';
import { calculateConsensus, calculateVoteResult } from './voting';
import { checkThreshold } from './threshold';
import { generateGranularFragments } from './fragments';
import { getNpcMessage } from './npc';
import {
  createQuiltGrid,
  claimCell as quiltClaimCell,
  releaseCell as quiltReleaseCell,
  setCellSong as quiltSetCellSong,
  lockInChoice as quiltLockInChoice,
  assignDefaultSongs,
  assignRemainingUsers,
  moveCell as quiltMoveCell,
  changeCellSong as quiltChangeCellSong,
  reorderColumn as quiltReorderColumn,
  swapCells as quiltSwapCells,
  lockCell as quiltLockCell,
  unlockCell as quiltUnlockCell,
  muteCell as quiltMuteCell,
  unmuteCell as quiltUnmuteCell,
  overrideCellSong as quiltOverrideCellSong,
  advancePlayhead as quiltAdvancePlayhead,
  resolveTrack,
  buildTrackMap,
  deriveAvailableSongs,
  findUserCell,
} from './quilt';
import {
  computeBarsPerCell,
  computeArcSchedule,
  initArcState,
  sortGrid,
  applyPositionMap,
  resolveAllTracksForRows,
  resolveTracksForRows,
} from './quilt-arc';

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
    case 'SETUP_FINALE':
      return handleSetupFinale(state);
    // Assignment (V3.3: cell claiming)
    case 'START_ASSIGNMENT':
      return handleStartAssignment(state);
    case 'CLAIM_CELL':
      return handleClaimCell(state, command.userId, command.cellId);
    case 'RELEASE_CELL':
      return handleReleaseCell(state, command.userId);
    case 'ASSIGNMENT_COMPLETE':
      return handleAssignmentComplete(state);
    case 'SEND_NPC_MESSAGE':
      return handleSendNpcMessage(state, command.message);

    // Preview (V3.3)
    case 'START_PREVIEW':
      return handleStartPreview(state);
    case 'SET_CELL_SONG':
      return handleSetCellSong(state, command.userId, command.songIndex);
    case 'LOCK_IN_CHOICE':
      return handleLockInChoice(state, command.userId);
    case 'PREVIEW_COMPLETE':
      return handlePreviewComplete(state);

    // Playback & Remix (V3.3)
    case 'START_PLAYBACK':
      return handleStartPlayback(state);
    case 'ADVANCE_QUILT_COLUMN':
      return handleAdvanceQuiltColumn(state);
    case 'MOVE_CELL':
      return handleMoveCell(state, command.userId, command.targetCellId);
    case 'CHANGE_CELL_SONG':
      return handleChangeCellSong(state, command.userId, command.songIndex);
    case 'REORDER_COLUMN':
      return handleReorderColumn(state, command.fromIndex, command.toIndex);
    case 'SWAP_CELLS':
      return handleSwapCells(state, command.cellIdA, command.cellIdB);
    case 'LOCK_CELL':
      return handleLockCell(state, command.cellId);
    case 'UNLOCK_CELL':
      return handleUnlockCell(state, command.cellId);
    case 'MUTE_CELL':
      return handleMuteCell(state, command.cellId);
    case 'UNMUTE_CELL':
      return handleUnmuteCell(state, command.cellId);
    case 'OVERRIDE_CELL_SONG':
      return handleOverrideCellSong(state, command.cellId, command.songIndex);

    // Arc (V3.3: automated playback arc)
    case 'ARC_ENTRY_ROW_GROUP':
      return handleArcEntryRowGroup(state, command.groupIndex);
    case 'ARC_EXIT_ROW_GROUP':
      return handleArcExitRowGroup(state, command.groupIndex);
    case 'ARC_COMPLETE':
      return handleArcComplete(state);
    case 'TRIGGER_SORT':
      return handleTriggerSort(state);

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
  'finale_preview',
  'finale_playback',
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
    // Blank → show first point (no sub-points yet)
    state.openerSlideState = { pointIndex: 0, subPointIndex: -1 };
  } else {
    const slide = slides[cur.pointIndex];
    const maxSub = (slide.subPoints?.length ?? 0) - 1;

    if (cur.subPointIndex < maxSub) {
      // Reveal next sub-point
      state.openerSlideState = { pointIndex: cur.pointIndex, subPointIndex: cur.subPointIndex + 1 };
    } else if (cur.pointIndex < slides.length - 1) {
      // Next point
      state.openerSlideState = { pointIndex: cur.pointIndex + 1, subPointIndex: -1 };
    } else {
      // Past last point → blank
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
    case 'finale_elegy': return 11;
    case 'finale_assignment': return 12;
    case 'finale_preview': return 13;
    case 'finale_playback': return 14;
    case 'ended': return 15;
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
  }

  if (nextPhase === 'finale_elegy') {
    // Auto-setup finale state (generate fragments from attempt results)
    console.log('handleAdvancePhase: auto-setup finale state');
    events.push(...handleSetupFinale(state));
  }

  if (nextPhase === 'finale_assignment' && state.finaleState) {
    events.push(...handleStartAssignment(state));
  }

  if (nextPhase === 'finale_preview' && state.finaleState) {
    events.push(...handleStartPreview(state));
  }

  if (nextPhase === 'finale_playback' && state.finaleState) {
    events.push(...handleStartPlayback(state));
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

  const granularTypes = state.config.granularTypes ?? [];
  const audienceSize = countConnectedUsers(state);
  const quiltGrid = createQuiltGrid(audienceSize, config.quilt, granularTypes);

  state.finaleState = {
    phase: 'elegy',
    availableFragments,
    allFragments,
    quilt: quiltGrid,
    availableSongs: [], // Derived after state is set
    trackMap: new Map(),
    assignment: {
      mode: config.assignmentMode,
      timerRemaining: null,
    },
    preview: {
      lockedInUsers: new Set(),
      timerRemaining: null,
    },
    remix: {
      lockedCells: new Set(),
      mutedCells: new Set(),
      lastMoveByUser: new Map(),
      liveTracksActive: [],
    },
    npc: { currentMessage: null },
    arc: null,
  };

  // Derive available songs and track map from fragments
  state.finaleState.availableSongs = deriveAvailableSongs(state.finaleState);
  state.finaleState.trackMap = buildTrackMap(state.finaleState);

  return [{ type: 'FINALE_SETUP_COMPLETE', availableFragments, allFragments }];
}

// ============================================================================
// Assignment Handlers (V3.3 — cell claiming)
// ============================================================================

function handleStartAssignment(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const config = state.config.finale;
  state.finaleState.phase = 'assignment';
  state.finaleState.assignment.mode = config.assignmentMode;

  if (config.assignmentMode === 'self_select') {
    state.finaleState.assignment.timerRemaining = config.quilt.assignmentTimerMs;
  }

  const quilt = state.finaleState.quilt;
  const events: ConductorEvent[] = [
    { type: 'ASSIGNMENT_STARTED', mode: config.assignmentMode, quiltDimensions: { rows: quilt.rows, columns: quilt.columns } },
  ];
  const npcMsg = getNpcMessage(config.npcMessages, 'assignment_start');
  if (npcMsg) {
    state.finaleState.npc.currentMessage = npcMsg;
    events.push({ type: 'NPC_MESSAGE', message: npcMsg });
  }
  return events;
}

function handleAssignmentComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const events: ConductorEvent[] = [];

  // Assign remaining unclaimed users to empty cells
  const claimedUserIds = new Set<UserId>();
  for (const cell of state.finaleState.quilt.cells.values()) {
    if (cell.ownerId) claimedUserIds.add(cell.ownerId);
  }
  const unclaimedUserIds: UserId[] = [];
  for (const [userId, user] of state.users) {
    if (user.connected && !claimedUserIds.has(userId)) {
      unclaimedUserIds.push(userId);
    }
  }

  if (unclaimedUserIds.length > 0) {
    const result = assignRemainingUsers(state.finaleState.quilt, unclaimedUserIds);
    for (const assignment of result.assignments) {
      events.push({ type: 'CELL_CLAIMED', cellId: assignment.cellId, userId: assignment.userId });
    }
  }

  state.finaleState.assignment.timerRemaining = null;
  events.push({ type: 'ALL_CELLS_ASSIGNED' });
  return events;
}

// ============================================================================
// Cell Claiming (Assignment Phase)
// ============================================================================

function handleClaimCell(state: ShowState, userId: UserId, cellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'assignment') {
    return [{ type: 'ERROR', message: 'Can only claim cells during assignment phase' }];
  }

  const result = quiltClaimCell(state.finaleState.quilt, userId, cellId);
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  return [{ type: 'CELL_CLAIMED', cellId, userId }];
}

function handleReleaseCell(state: ShowState, userId: UserId): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'assignment') {
    return [{ type: 'ERROR', message: 'Can only release cells during assignment phase' }];
  }

  const cell = findUserCell(state.finaleState.quilt, userId);
  if (!cell) return [{ type: 'ERROR', message: `User ${userId} does not own any cell` }];

  const result = quiltReleaseCell(state.finaleState.quilt, userId);
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  return [{ type: 'CELL_RELEASED', cellId: cell.id }];
}

// ============================================================================
// Preview Phase
// ============================================================================

function handleStartPreview(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  state.finaleState.phase = 'preview';
  state.finaleState.preview.timerRemaining = state.config.finale.quilt.previewTimerMs;

  const events: ConductorEvent[] = [{ type: 'PREVIEW_STARTED' }];
  const npcMsg = getNpcMessage(state.config.finale.npcMessages, 'preview_start');
  if (npcMsg) {
    state.finaleState.npc.currentMessage = npcMsg;
    events.push({ type: 'NPC_MESSAGE', message: npcMsg });
  }
  return events;
}

function handleSetCellSong(state: ShowState, userId: UserId, songIndex: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'preview') {
    return [{ type: 'ERROR', message: 'Can only set song during preview phase' }];
  }
  if (state.finaleState.preview.lockedInUsers.has(userId)) {
    return [{ type: 'ERROR', message: 'User already locked in' }];
  }

  const result = quiltSetCellSong(
    state.finaleState.quilt, userId, songIndex, state.finaleState.availableSongs,
  );
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  const cell = findUserCell(state.finaleState.quilt, userId)!;
  return [{ type: 'CELL_SONG_SET', cellId: cell.id, songIndex }];
}

function handleLockInChoice(state: ShowState, userId: UserId): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'preview') {
    return [{ type: 'ERROR', message: 'Can only lock in during preview phase' }];
  }

  const result = quiltLockInChoice(
    state.finaleState.quilt, userId, state.finaleState.preview.lockedInUsers,
  );
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];
  if (result.alreadyLocked) return [];

  return [{ type: 'USER_LOCKED_IN', userId }];
}

function handlePreviewComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  // Assign default songs to users who didn't choose
  assignDefaultSongs(state.finaleState.quilt, state.finaleState.availableSongs);
  state.finaleState.preview.timerRemaining = null;

  return [];
}

// ============================================================================
// Playback Phase
// ============================================================================

function handleStartPlayback(state: ShowState): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  state.finaleState.phase = 'playback';
  state.finaleState.quilt.playheadColumn = state.finaleState.quilt.columnOrder[0] ?? 0;

  const events: ConductorEvent[] = [];
  const quilt = state.finaleState.quilt;
  const trackMap = state.finaleState.trackMap;
  const mutedCells = state.finaleState.remix.mutedCells;
  const arcConfig = state.config.finale.quilt.arc;

  // Initialize arc if enabled
  if (arcConfig?.enabled) {
    const schedule = computeArcSchedule(quilt.columns, arcConfig);
    state.finaleState.arc = initArcState(schedule);

    // Only unmute first entry group's tracks (staggered entry)
    const firstGroup = arcConfig.entrySchedule[0];
    if (firstGroup) {
      const initialTrackIndices = resolveAllTracksForRows(
        quilt.cells, trackMap, firstGroup.granularTypes, mutedCells,
      );

      state.finaleState.arc.enteredRowGroups.push(0);

      events.push({
        type: 'PLAYBACK_STARTED',
        quilt: new Map(quilt.cells),
        columnOrder: [...quilt.columnOrder],
      });

      events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'entry' });

      events.push({
        type: 'ARC_ROW_GROUP_ENTERED',
        granularTypes: firstGroup.granularTypes,
      });

      events.push({
        type: 'AUDIO_CUE',
        cue: {
          type: 'quilt_playback_start',
          initialColumn: quilt.playheadColumn,
          trackIndices: initialTrackIndices,
        },
      });

      // If only one entry group, transition straight to raw
      if (arcConfig.entrySchedule.length === 1) {
        state.finaleState.arc.phase = 'raw';
        events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'raw' });
      }
    }
  } else {
    // No arc — unmute all tracks at once (original behavior)
    const initialTrackIndices: number[] = [];
    for (const cell of quilt.cells.values()) {
      if (cell.columnIndex === quilt.playheadColumn && cell.songIndex !== null && !mutedCells.has(cell.id)) {
        const trackIndex = resolveTrack(trackMap, cell.granularType, cell.songIndex);
        if (trackIndex !== null) initialTrackIndices.push(trackIndex);
      }
    }

    events.push({
      type: 'PLAYBACK_STARTED',
      quilt: new Map(quilt.cells),
      columnOrder: [...quilt.columnOrder],
    });

    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'quilt_playback_start',
        initialColumn: quilt.playheadColumn,
        trackIndices: initialTrackIndices,
      },
    });
  }

  const npcMsg = getNpcMessage(state.config.finale.npcMessages, 'first_playback');
  if (npcMsg) {
    state.finaleState.npc.currentMessage = npcMsg;
    events.push({ type: 'NPC_MESSAGE', message: npcMsg });
  }

  return events;
}

function handleAdvanceQuiltColumn(state: ShowState): ConductorEvent[] {
  if (!state.finaleState || state.finaleState.phase !== 'playback') return [];

  const quilt = state.finaleState.quilt;
  const trackMap = state.finaleState.trackMap;
  const mutedCells = state.finaleState.remix.mutedCells;
  const arc = state.finaleState.arc;
  const previousColumn = quilt.playheadColumn;

  // Determine which granular types are active (arc entry filtering)
  const enteredTypes = getEnteredGranularTypes(state);

  // Build a map of granularType -> active trackIndex for the previous column
  const previousTracks = new Map<string, number>();
  for (const cell of quilt.cells.values()) {
    if (cell.columnIndex === previousColumn && cell.songIndex !== null && !mutedCells.has(cell.id)) {
      if (enteredTypes && !enteredTypes.has(cell.granularType)) continue;
      const trackIndex = resolveTrack(trackMap, cell.granularType, cell.songIndex);
      if (trackIndex !== null) previousTracks.set(cell.granularType, trackIndex);
    }
  }

  // Advance playhead
  const { columnIndex, loopWrapped } = quiltAdvancePlayhead(quilt);

  // Track grid loop completion for arc + trigger phase transitions
  const arcPhaseEvents: ConductorEvent[] = [];
  if (loopWrapped && arc && arc.phase !== 'complete') {
    arc.gridLoopsInPhase++;

    // Raw phase complete: after 1 grid loop, trigger sort
    if (arc.phase === 'raw' && arc.gridLoopsInPhase >= 1) {
      arcPhaseEvents.push(...handleArcRawComplete(state));
    }
    // Sorted playback: after each grid loop, check if pass/phase is done
    else if (arc.phase === 'sorted_playback') {
      arcPhaseEvents.push(...handleArcSortComplete(state));
    }
  }

  // Build a map of granularType -> active trackIndex for the new column
  const newTracks = new Map<string, number>();
  for (const cell of quilt.cells.values()) {
    if (cell.columnIndex === columnIndex && cell.songIndex !== null && !mutedCells.has(cell.id)) {
      if (enteredTypes && !enteredTypes.has(cell.granularType)) continue;
      const trackIndex = resolveTrack(trackMap, cell.granularType, cell.songIndex);
      if (trackIndex !== null) newTracks.set(cell.granularType, trackIndex);
    }
  }

  // Compute track changes: only include types where the track actually changed
  const trackChanges: { granularType: string; muteTrack: number | null; unmuteTrack: number | null }[] = [];
  const allTypes = new Set([...previousTracks.keys(), ...newTracks.keys()]);
  for (const gt of allTypes) {
    const prev = previousTracks.get(gt) ?? null;
    const next = newTracks.get(gt) ?? null;
    if (prev !== next) {
      trackChanges.push({ granularType: gt, muteTrack: prev, unmuteTrack: next });
    }
  }

  const events: ConductorEvent[] = [];

  events.push({ type: 'PLAYHEAD_ADVANCED', columnIndex });

  if (trackChanges.length > 0) {
    events.push({
      type: 'AUDIO_CUE',
      cue: { type: 'quilt_column_change', columnIndex, trackChanges },
    });
  }

  // Append arc phase transition events (sort applied, phase changed, etc.)
  events.push(...arcPhaseEvents);

  return events;
}

/**
 * Get the set of granular types that have entered during the arc.
 * Returns null if arc is not active (meaning all types are active).
 */
function getEnteredGranularTypes(state: ShowState): Set<string> | null {
  const arc = state.finaleState?.arc;
  if (!arc) return null;

  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig?.enabled) return null;

  // After entry phase, all types are active
  if (arc.phase !== 'entry') return null;

  const entered = new Set<string>();
  for (const groupIndex of arc.enteredRowGroups) {
    const group = arcConfig.entrySchedule[groupIndex];
    if (group) {
      for (const gt of group.granularTypes) {
        entered.add(gt);
      }
    }
  }
  return entered;
}

// ============================================================================
// Arc Handlers (V3.3: Automated Playback Arc)
// ============================================================================

function handleArcEntryRowGroup(state: ShowState, groupIndex: number): ConductorEvent[] {
  if (!state.finaleState?.arc) return [{ type: 'ERROR', message: 'Arc not initialized' }];

  const arc = state.finaleState.arc;
  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig?.enabled) return [];
  if (arc.phase !== 'entry') return [];

  const group = arcConfig.entrySchedule[groupIndex];
  if (!group) return [{ type: 'ERROR', message: `Invalid entry group index: ${groupIndex}` }];

  // Skip if already entered
  if (arc.enteredRowGroups.includes(groupIndex)) return [];

  arc.enteredRowGroups.push(groupIndex);

  const trackIndices = resolveAllTracksForRows(
    state.finaleState.quilt.cells,
    state.finaleState.trackMap,
    group.granularTypes,
    state.finaleState.remix.mutedCells,
  );

  const events: ConductorEvent[] = [];

  events.push({ type: 'ARC_ROW_GROUP_ENTERED', granularTypes: group.granularTypes });

  events.push({
    type: 'AUDIO_CUE',
    cue: { type: 'quilt_row_unmute', granularTypes: group.granularTypes, trackIndices },
  });

  // Check if all entry groups have entered
  if (arc.enteredRowGroups.length >= arcConfig.entrySchedule.length) {
    arc.phase = 'raw';
    arc.gridLoopsInPhase = 0;
    events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'raw' });
  }

  return events;
}

function handleArcRawComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState?.arc) return [{ type: 'ERROR', message: 'Arc not initialized' }];

  const arc = state.finaleState.arc;
  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig?.enabled) return [];
  if (arc.phase !== 'raw') return [];

  const events: ConductorEvent[] = [];

  // Snapshot cells before sort
  const previousCells = new Map<string, QuiltCell>();
  for (const [id, cell] of state.finaleState.quilt.cells) {
    previousCells.set(id, { ...cell });
  }

  // Apply first sort
  const granularTypes = (state.config.granularTypes ?? []).map(gt => gt.id);
  const mode = arc.schedule.sortMode === 'single_pass' ? 'single' as const : 'multi' as const;
  const targetEnergy = mode === 'multi' ? arcConfig.multiPassTargets[0] : undefined;

  const positionMap = sortGrid(
    state.finaleState.quilt.cells,
    state.finaleState.quilt.columns,
    state.finaleState.quilt.rows,
    arcConfig,
    mode,
    targetEnergy,
  );

  applyPositionMap(state.finaleState.quilt.cells, positionMap, granularTypes);

  arc.phase = 'sorted_playback';
  arc.currentPassIndex = 0;
  arc.gridLoopsInPhase = 0;

  events.push({ type: 'ARC_SORT_APPLIED', passIndex: 0, previousCells });
  events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'sorted_playback' });

  return events;
}

function handleArcSortComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState?.arc) return [{ type: 'ERROR', message: 'Arc not initialized' }];

  const arc = state.finaleState.arc;
  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig?.enabled) return [];
  if (arc.phase !== 'sorted_playback') return [];

  const events: ConductorEvent[] = [];

  // Multi-pass: check if there are more passes
  if (arc.schedule.sortMode === 'multi_pass') {
    const nextPassIndex = arc.currentPassIndex + 1;

    if (nextPassIndex < arc.schedule.sortedPassCount) {
      // Re-sort for next pass
      const previousCells = new Map<string, QuiltCell>();
      for (const [id, cell] of state.finaleState.quilt.cells) {
        previousCells.set(id, { ...cell });
      }

      const granularTypes = (state.config.granularTypes ?? []).map(gt => gt.id);
      const targetEnergy = arcConfig.multiPassTargets[nextPassIndex] ?? 0.5;

      const positionMap = sortGrid(
        state.finaleState.quilt.cells,
        state.finaleState.quilt.columns,
        state.finaleState.quilt.rows,
        arcConfig,
        'multi',
        targetEnergy,
      );

      applyPositionMap(state.finaleState.quilt.cells, positionMap, granularTypes);

      arc.currentPassIndex = nextPassIndex;
      arc.gridLoopsInPhase = 0;

      events.push({ type: 'ARC_SORT_APPLIED', passIndex: nextPassIndex, previousCells });
      return events;
    }
  }

  // All passes done (or single-pass) → transition to exit
  arc.phase = 'exit';
  arc.gridLoopsInPhase = 0;
  events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'exit' });

  return events;
}

function handleArcExitRowGroup(state: ShowState, groupIndex: number): ConductorEvent[] {
  if (!state.finaleState?.arc) return [{ type: 'ERROR', message: 'Arc not initialized' }];

  const arc = state.finaleState.arc;
  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig?.enabled) return [];
  if (arc.phase !== 'exit') return [];

  const group = arcConfig.exitSchedule[groupIndex];
  if (!group) return [{ type: 'ERROR', message: `Invalid exit group index: ${groupIndex}` }];

  // Skip if already exited
  if (arc.exitedRowGroups.includes(groupIndex)) return [];

  arc.exitedRowGroups.push(groupIndex);

  const trackIndices = resolveAllTracksForRows(
    state.finaleState.quilt.cells,
    state.finaleState.trackMap,
    group.granularTypes,
    state.finaleState.remix.mutedCells,
  );

  const events: ConductorEvent[] = [];

  events.push({ type: 'ARC_ROW_GROUP_EXITED', granularTypes: group.granularTypes });

  events.push({
    type: 'AUDIO_CUE',
    cue: { type: 'quilt_row_mute', granularTypes: group.granularTypes, trackIndices },
  });

  // Check if all exit groups have exited
  if (arc.exitedRowGroups.length >= arcConfig.exitSchedule.length) {
    arc.phase = 'complete';
    events.push({ type: 'ARC_PHASE_CHANGED', arcPhase: 'complete' });
  }

  return events;
}

function handleArcComplete(state: ShowState): ConductorEvent[] {
  if (!state.finaleState?.arc) return [];

  state.finaleState.arc.phase = 'complete';
  return [{ type: 'ARC_PHASE_CHANGED', arcPhase: 'complete' }];
}

function handleTriggerSort(state: ShowState): ConductorEvent[] {
  if (!state.finaleState || state.finaleState.phase !== 'playback') {
    return [{ type: 'ERROR', message: 'Can only sort during playback' }];
  }

  const arcConfig = state.config.finale.quilt.arc;
  if (!arcConfig) return [{ type: 'ERROR', message: 'Arc config not found' }];

  // Snapshot cells before sort
  const previousCells = new Map(
    [...state.finaleState.quilt.cells].map(([id, cell]) => [id, { ...cell }]),
  );

  const granularTypes = (state.config.granularTypes ?? []).map(gt => gt.id);

  const positionMap = sortGrid(
    state.finaleState.quilt.cells,
    state.finaleState.quilt.columns,
    state.finaleState.quilt.rows,
    arcConfig,
    'single',
  );

  if (positionMap.size === 0) {
    return []; // Nothing to sort
  }

  applyPositionMap(state.finaleState.quilt.cells, positionMap, granularTypes);

  return [{ type: 'ARC_SORT_APPLIED', passIndex: 0, previousCells }];
}

// ============================================================================
// Audience Remix (Playback Phase)
// ============================================================================

function handleMoveCell(state: ShowState, userId: UserId, targetCellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'playback') {
    return [{ type: 'ERROR', message: 'Can only move cells during playback phase' }];
  }

  const sourceCell = findUserCell(state.finaleState.quilt, userId);
  if (!sourceCell) return [{ type: 'ERROR', message: `User ${userId} does not own any cell` }];
  const fromPosition = { row: sourceCell.rowIndex, col: sourceCell.columnIndex };

  const targetCell = state.finaleState.quilt.cells.get(targetCellId);
  const swappedWithCellId = targetCell?.ownerId ? targetCellId : null;

  const result = quiltMoveCell(
    state.finaleState.quilt,
    userId,
    targetCellId,
    state.config.finale.quilt.audienceRemix,
    state.finaleState.remix.lockedCells,
    state.finaleState.remix.lastMoveByUser,
    state.finaleState.quilt.loopCount,
  );
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  // After swap, the source cell has moved to the target position
  const movedCell = findUserCell(state.finaleState.quilt, userId)!;
  return [{
    type: 'CELL_MOVED',
    cellId: movedCell.id,
    fromPosition,
    toPosition: { row: movedCell.rowIndex, col: movedCell.columnIndex },
    swappedWithCellId,
  }];
}

function handleChangeCellSong(state: ShowState, userId: UserId, songIndex: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'playback') {
    return [{ type: 'ERROR', message: 'Can only change song during playback phase' }];
  }

  const result = quiltChangeCellSong(
    state.finaleState.quilt,
    userId,
    songIndex,
    state.config.finale.quilt.audienceRemix,
    state.finaleState.availableSongs,
    state.finaleState.remix.lockedCells,
  );
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  const cell = findUserCell(state.finaleState.quilt, userId)!;
  return [{ type: 'CELL_SONG_SET', cellId: cell.id, songIndex }];
}

// ============================================================================
// Performer Remix (Playback Phase)
// ============================================================================

function handleReorderColumn(state: ShowState, fromIndex: number, toIndex: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'playback') {
    return [{ type: 'ERROR', message: 'Can only reorder columns during playback phase' }];
  }

  const result = quiltReorderColumn(state.finaleState.quilt, fromIndex, toIndex);
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  return [
    { type: 'COLUMN_REORDERED', columnOrder: [...state.finaleState.quilt.columnOrder] },
    { type: 'AUDIO_CUE', cue: { type: 'quilt_reorder', newColumnOrder: [...state.finaleState.quilt.columnOrder] } },
  ];
}

function handleSwapCells(state: ShowState, cellIdA: string, cellIdB: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  if (state.finaleState.phase !== 'playback') {
    return [{ type: 'ERROR', message: 'Can only swap cells during playback phase' }];
  }

  const result = quiltSwapCells(state.finaleState.quilt, cellIdA, cellIdB);
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  return [{ type: 'CELLS_SWAPPED', cellIdA, cellIdB }];
}

function handleLockCell(state: ShowState, cellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = quiltLockCell(state.finaleState.remix.lockedCells, cellId, state.finaleState.quilt);
  if (!result.ok) return [{ type: 'ERROR', message: result.error! }];

  return [{ type: 'CELL_LOCKED', cellId }];
}

function handleUnlockCell(state: ShowState, cellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = quiltUnlockCell(state.finaleState.remix.lockedCells, cellId);
  if (!result.ok) return [{ type: 'ERROR', message: result.error! }];

  return [{ type: 'CELL_UNLOCKED', cellId }];
}

function handleMuteCell(state: ShowState, cellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = quiltMuteCell(state.finaleState.remix.mutedCells, cellId, state.finaleState.quilt);
  if (!result.ok) return [{ type: 'ERROR', message: result.error! }];

  const cell = state.finaleState.quilt.cells.get(cellId);
  const events: ConductorEvent[] = [{ type: 'CELL_MUTED', cellId }];
  if (cell && cell.songIndex !== null) {
    const trackIndex = resolveTrack(state.finaleState.trackMap, cell.granularType, cell.songIndex);
    if (trackIndex !== null) {
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'quilt_mute_cell', granularType: cell.granularType, columnIndex: cell.columnIndex, trackIndex },
      });
    }
  }
  return events;
}

function handleUnmuteCell(state: ShowState, cellId: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = quiltUnmuteCell(state.finaleState.remix.mutedCells, cellId);
  if (!result.ok) return [{ type: 'ERROR', message: result.error! }];

  const cell = state.finaleState.quilt.cells.get(cellId);
  const events: ConductorEvent[] = [{ type: 'CELL_UNMUTED', cellId }];
  if (cell && cell.songIndex !== null) {
    const trackIndex = resolveTrack(state.finaleState.trackMap, cell.granularType, cell.songIndex);
    if (trackIndex !== null) {
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'quilt_unmute_cell', granularType: cell.granularType, columnIndex: cell.columnIndex, trackIndex },
      });
    }
  }
  return events;
}

function handleOverrideCellSong(state: ShowState, cellId: string, songIndex: number): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];

  const result = quiltOverrideCellSong(
    state.finaleState.quilt, cellId, songIndex, state.finaleState.availableSongs,
  );
  if (!result.ok) return [{ type: 'ERROR', message: result.error }];

  return [{ type: 'CELL_SONG_SET', cellId, songIndex }];
}

function handleSendNpcMessage(state: ShowState, message: string): ConductorEvent[] {
  if (!state.finaleState) return [{ type: 'ERROR', message: 'Finale not initialized' }];
  state.finaleState.npc.currentMessage = message;
  return [{ type: 'NPC_MESSAGE', message }];
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

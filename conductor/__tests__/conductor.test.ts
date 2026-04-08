/**
 * Conductor State Machine Tests (V2)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import { createInitialState, processCommand } from '../conductor';
import type {
  ShowState,
  ShowConfig,
  V32AttemptConfig,
  V32LayerConfig,
  ConductorEvent,
} from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

const LAYER_GROUPS = ['bones', 'flesh', 'spark'] as const;

function makeV32LayerConfig(index: number): V32LayerConfig {
  return {
    index,
    group: LAYER_GROUPS[index % LAYER_GROUPS.length],
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    optionA: { tracks: [{ granularType: 'bass', trackIndices: [index * 2] }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndices: [index * 2 + 1] }] },
  };
}

function makeAttemptConfig(
  chapter: 'ambition' | 'love' | 'avoidance',
  layerCount = 3,
  thresholds?: number[],
): V32AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: Array.from({ length: layerCount }, (_, i) => makeV32LayerConfig(i)),
    thresholds: thresholds ?? Array(layerCount).fill(0.5),
    tempos: Array(layerCount).fill(120),
    auditionBars: Array(layerCount).fill(4),
    auditionCycles: Array(layerCount).fill(1),
  };
}

function createTestConfig(
  layerCount = 3,
  thresholds?: number[],
): ShowConfig {
  return {
    layersPerAttempt: layerCount,
    attempts: [
      makeAttemptConfig('ambition', layerCount, thresholds),
      makeAttemptConfig('love', layerCount, thresholds),
      makeAttemptConfig('avoidance', layerCount, thresholds),
    ],
    finale: {
      assignmentMode: 'auto',
      bothOptionsSurvive: true,
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
      quilt: {
        maxColumns: 4,
        loopBars: 8,
        columnTiming: 'divided' as const,
        overflowMode: 'spectator' as const,
        previewTimerMs: 20000,
        assignmentTimerMs: 30000,
        audienceRemix: {
          enabled: true,
          scope: 'own_cell' as const,
          allowCrossRowSwaps: true,
          cooldownLoops: 1,
          allowSongChange: false,
        },
      },
    },
    granularTypes: [
      { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
      { id: 'drums', label: 'Drums', color: '#000', symbol: '▲' },
      { id: 'pad', label: 'Pad', color: '#000', symbol: '◆' },
      { id: 'seed', label: 'Seed', color: '#000', symbol: '◎' },
      { id: 'harmony', label: 'Harmony', color: '#000', symbol: '●' },
      { id: 'fx', label: 'FX', color: '#000', symbol: '~' },
    ],
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
      loopBoundaryBeats: 32,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: ['seat-1', 'seat-2'],
  };
}

/**
 * Config where a 50/50 split collapses the attempt.
 * Uses threshold=0.6 so winningProportion=0.5 < 0.6 → collapse.
 */
function createCollapseConfig(layerCount = 1): ShowConfig {
  return createTestConfig(layerCount, Array(layerCount).fill(0.6));
}

function createTestState(config?: ShowConfig): ShowState {
  return createInitialState(config || createTestConfig(), 'test-show');
}

/** Advance through phases to reach attempt_build for attempt 0. */
function advanceToBuild(state: ShowState): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  processCommand(state, { type: 'ADVANCE_PHASE' }); // opener → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story → attempt_build
}

/** Connect a user and return their userId. */
function connectUser(state: ShowState, userId: string): void {
  processCommand(state, { type: 'USER_CONNECT', userId });
}

/** Run through the full layer cycle: audition → close → advance from reveal. */
function completeSingleLayer(state: ShowState, voters: string[], choice: 'A' | 'B' = 'A'): ConductorEvent[] {
  processCommand(state, { type: 'START_AUDITION' });
  for (const userId of voters) {
    processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  }
  const revealEvents = processCommand(state, { type: 'CLOSE_VOTING' });
  const lockInEvents = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
  const verdictEvents = processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });
  return [...revealEvents, ...lockInEvents, ...verdictEvents];
}


/** Run through N layers with unanimous votes (all pass threshold). */
function completeNLayers(state: ShowState, n: number, voters: string[], choice: 'A' | 'B' = 'A'): void {
  for (let i = 0; i < n; i++) {
    completeSingleLayer(state, voters, choice);
  }
}

function findEvent(events: ConductorEvent[], type: string): ConductorEvent | undefined {
  return events.find(e => e.type === type);
}

// ============================================================================
// Show Phase Transitions
// ============================================================================

describe('Show Phase Transitions', () => {
  test('initial state starts in lobby phase with version 0', () => {
    const state = createTestState();
    expect(state.phase).toBe('lobby');
    expect(state.version).toBe(0);
    expect(state.currentAttemptIndex).toBe(0);
    expect(state.attempts).toHaveLength(3);
    expect(state.paused).toBe(false);
  });

  test('ADVANCE_PHASE transitions from lobby to opener', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.phase).toBe('opener');
    expect(findEvent(events, 'SHOW_PHASE_CHANGED')).toBeDefined();
  });

  test('ADVANCE_PHASE walks through the full phase sequence including attempt_resolve', () => {
    const state = createTestState();
    const phases: string[] = [state.phase];

    for (let i = 0; i < 15; i++) {
      processCommand(state, { type: 'ADVANCE_PHASE' });
      phases.push(state.phase);
    }

    expect(phases).toEqual([
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
    ]);
  });

  test('ADVANCE_PHASE increments currentAttemptIndex correctly through attempts', () => {
    const state = createTestState();

    processCommand(state, { type: 'ADVANCE_PHASE' }); // opener
    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story 0
    expect(state.currentAttemptIndex).toBe(0);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 0
    expect(state.currentAttemptIndex).toBe(0);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_resolve 0
    expect(state.currentAttemptIndex).toBe(0);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story 1
    expect(state.currentAttemptIndex).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 1
    expect(state.currentAttemptIndex).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_resolve 1
    expect(state.currentAttemptIndex).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story 2
    expect(state.currentAttemptIndex).toBe(2);
  });

  test('ADVANCE_PHASE returns error when already at ended', () => {
    const state = createTestState();
    for (let i = 0; i < 16; i++) {
      processCommand(state, { type: 'ADVANCE_PHASE' });
    }
    expect(state.phase).toBe('ended');

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('ADVANCE_PHASE returns error when paused', () => {
    const state = createTestState();
    processCommand(state, { type: 'PAUSE' });

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('JUMP_TO_PHASE transitions directly to specified phase', () => {
    const state = createTestState();
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'attempt_build', attemptIndex: 1 });

    expect(state.phase).toBe('attempt_build');
    expect(state.currentAttemptIndex).toBe(1);
  });

  test('entering attempt_build activates the attempt as in_progress', () => {
    const state = createTestState();
    advanceToBuild(state);

    expect(state.attempts[0].status).toBe('in_progress');
    expect(state.attempts[0].currentLayerIndex).toBe(0);
    expect(state.attempts[0].currentLayerPhase).toBe('locked');
  });

  test('version increments with every command processed', () => {
    const state = createTestState();
    expect(state.version).toBe(0);

    processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.version).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.version).toBe(2);
  });
});

// ============================================================================
// Pause / Resume
// ============================================================================

describe('Pause and Resume', () => {
  test('PAUSE sets paused to true and emits PAUSED event', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'PAUSE' });

    expect(state.paused).toBe(true);
    expect(findEvent(events, 'PAUSED')).toBeDefined();
  });

  test('RESUME clears paused and emits RESUMED event', () => {
    const state = createTestState();
    processCommand(state, { type: 'PAUSE' });
    const events = processCommand(state, { type: 'RESUME' });

    expect(state.paused).toBe(false);
    expect(findEvent(events, 'RESUMED')).toBeDefined();
  });

  test('PAUSE is idempotent when already paused', () => {
    const state = createTestState();
    processCommand(state, { type: 'PAUSE' });
    const events = processCommand(state, { type: 'PAUSE' });

    expect(events).toHaveLength(0);
  });

  test('RESUME is idempotent when not paused', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'RESUME' });

    expect(events).toHaveLength(0);
  });
});

// ============================================================================
// Song-Building: Layer Flow
// ============================================================================

describe('Song-Building Layer Flow', () => {
  test('START_AUDITION transitions current layer from locked to auditioning', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'START_AUDITION' });
    const attempt = state.attempts[0];

    expect(attempt.currentLayerPhase).toBe('auditioning');
    expect(findEvent(events, 'LAYER_PHASE_CHANGED')).toBeDefined();
    expect(findEvent(events, 'AUDIO_CUE')).toBeDefined();
  });

  test('START_AUDITION returns error when not in attempt_build', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'START_AUDITION' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('START_AUDITION emits set_tempo AUDIO_CUE with BPM from config', () => {
    const config = createTestConfig(3);
    config.attempts[0].tempos = [110, 130, 155];
    const state = createTestState(config);
    advanceToBuild(state);

    const events = processCommand(state, { type: 'START_AUDITION' });
    const audioCues = events.filter(e => e.type === 'AUDIO_CUE') as Array<{ type: 'AUDIO_CUE'; cue: { type: string; bpm?: number } }>;
    const tempoCue = audioCues.find(e => e.cue.type === 'set_tempo');

    expect(tempoCue).toBeDefined();
    expect(tempoCue!.cue.bpm).toBe(110);
  });

  test('set_tempo cue precedes audition_start cue in events', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'START_AUDITION' });
    const audioCues = events.filter(e => e.type === 'AUDIO_CUE') as Array<{ type: 'AUDIO_CUE'; cue: { type: string } }>;
    const cueTypes = audioCues.map(e => e.cue.type);

    const tempoIdx = cueTypes.indexOf('set_tempo');
    const auditionIdx = cueTypes.indexOf('audition_start');

    expect(tempoIdx).toBeGreaterThanOrEqual(0);
    expect(auditionIdx).toBeGreaterThan(tempoIdx);
  });

  test('each layer uses its own tempo from config', () => {
    const config = createTestConfig(3);
    config.attempts[0].tempos = [110, 140, 170];
    const state = createTestState(config);
    advanceToBuild(state);
    connectUser(state, 'user-1');

    // Layer 0 → 110 BPM
    let events = processCommand(state, { type: 'START_AUDITION' });
    let tempoCue = (events.filter(e => e.type === 'AUDIO_CUE') as any[]).find(e => e.cue.type === 'set_tempo');
    expect(tempoCue.cue.bpm).toBe(110);

    // Complete layer 0
    completeSingleLayer(state, ['user-1'], 'A');

    // Layer 1 → 140 BPM
    events = processCommand(state, { type: 'START_AUDITION' });
    tempoCue = (events.filter(e => e.type === 'AUDIO_CUE') as any[]).find(e => e.cue.type === 'set_tempo');
    expect(tempoCue.cue.bpm).toBe(140);
  });

  test('SUBMIT_VOTE records a vote during auditioning phase', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    const events = processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    expect(findEvent(events, 'VOTE_RECEIVED')).toBeDefined();
    expect(state.attempts[0].votes).toHaveLength(1);
    expect(state.attempts[0].votes[0].choice).toBe('A');
  });

  test('SUBMIT_VOTE replaces an existing vote from the same user for the same layer', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'B' });

    expect(state.attempts[0].votes).toHaveLength(1);
    expect(state.attempts[0].votes[0].choice).toBe('B');
  });

  test('SUBMIT_VOTE is silently ignored when not in voting phase', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    const events = processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    expect(events).toHaveLength(0);
  });

  test('CLOSE_VOTING resolves the layer and emits VOTE_RESULT', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    connectUser(state, 'user-2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-2', choice: 'A' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });
    expect(findEvent(events, 'VOTE_RESULT')).toBeDefined();
  });

  test('CLOSE_VOTING transitions layer to revealing and emits THRESHOLD_CHECK', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });
    expect(findEvent(events, 'THRESHOLD_CHECK')).toBeDefined();
  });
});

// ============================================================================
// Reveal Stakes
// ============================================================================

describe('REVEAL_STAKES', () => {
  test('emits REVEAL_STAKES_SHOWN during revealing phase', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].currentLayerPhase).toBe('revealing');
    expect(state.attempts[0].revealStakesShown).toBe(false);

    const events = processCommand(state, { type: 'REVEAL_STAKES' });
    const shown = findEvent(events, 'REVEAL_STAKES_SHOWN');
    expect(shown).toBeDefined();
    expect(shown!.type === 'REVEAL_STAKES_SHOWN' && shown!.threshold).toBeGreaterThan(0);
    expect(state.attempts[0].revealStakesShown).toBe(true);
  });

  test('errors when not in revealing phase', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    const events = processCommand(state, { type: 'REVEAL_STAKES' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('ignores duplicate REVEAL_STAKES', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });

    const events = processCommand(state, { type: 'REVEAL_STAKES' });
    expect(events).toHaveLength(0);
  });

  test('revealStakesShown resets after ADVANCE_FROM_REVEAL', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    expect(state.attempts[0].revealStakesShown).toBe(false);
  });

  test('revealStakesShown resets on RERUN_VOTE', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'RERUN_VOTE' });

    expect(state.attempts[0].revealStakesShown).toBe(false);
    expect(state.attempts[0].currentLayerPhase).toBe('auditioning');
  });
});

// ============================================================================
// Vote Resolution: Lock-in
// ============================================================================

describe('Vote Resolution and Lock-in', () => {
  test('layer locks in when threshold passes', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    connectUser(state, 'user-2');
    connectUser(state, 'user-3');
    advanceToBuild(state);

    // Unanimous vote → winningProportion=1.0 → threshold passes
    const events = completeSingleLayer(state, ['user-1', 'user-2', 'user-3'], 'A');

    expect(findEvent(events, 'LAYER_LOCKED_IN')).toBeDefined();
    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(state.attempts[0].layerResults[0].chosenOption).toBe('A');
  });

  test('layer result includes winningProportion and passed after close voting', () => {
    // threshold=0.4: winningProportion=0.5 (1A,1B) >= 0.4 → passed
    const config = createTestConfig(1, [0.4]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].layerResults[0].winningProportion).toBeCloseTo(0.5);
    expect(state.attempts[0].layerResults[0].passed).toBe(true);
  });

  test('layer advances to next layer after lock-in', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    completeSingleLayer(state, ['user-1'], 'A');

    expect(state.attempts[0].currentLayerIndex).toBe(1);
    expect(state.attempts[0].currentLayerPhase).toBe('locked');
  });

  test('attempt is completed and transitions to attempt_resolve when all layers locked in', () => {
    const config = createTestConfig(2);
    const state = createTestState(config);
    connectUser(state, 'user-1');
    advanceToBuild(state);

    completeSingleLayer(state, ['user-1'], 'A');
    const events = completeSingleLayer(state, ['user-1'], 'B');

    expect(state.attempts[0].status).toBe('completed');
    expect(findEvent(events, 'ATTEMPT_COMPLETED')).toBeDefined();
    expect(state.phase).toBe('attempt_resolve');
    expect(state.attempts[0].layerResults).toHaveLength(2);
    expect(state.attempts[0].layerResults[0].chosenOption).toBe('A');
    expect(state.attempts[0].layerResults[1].chosenOption).toBe('B');
  });

  test('lock-in emits AUDIO_CUE with correct attempt and layer info', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    const events = completeSingleLayer(state, ['user-1'], 'A');
    const audioCue = events.find(e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'lock_in');

    expect(audioCue).toBeDefined();
    expect((audioCue as any).cue.attemptIndex).toBe(0);
    expect((audioCue as any).cue.layerIndex).toBe(0);
    expect((audioCue as any).cue.winner).toBe('A');
  });
});

// ============================================================================
// Threshold Collapse
// ============================================================================

describe('Threshold Collapse', () => {
  test('attempt collapses when threshold fails (50/50 split with threshold=0.6)', () => {
    // threshold=0.6: winningProportion=0.5 (1A,1B) < 0.6 → collapse
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    const closeEvents = processCommand(state, { type: 'CLOSE_VOTING' });
    const advanceEvents = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    const allEvents = [...closeEvents, ...advanceEvents];

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].collapsedAtLayer).toBe(0);
    expect(findEvent(allEvents, 'ATTEMPT_COLLAPSED')).toBeDefined();
    expect(findEvent(allEvents, 'THRESHOLD_CHECK')).toBeDefined();
  });

  test('ATTEMPT_COLLAPSED event is emitted on threshold failure', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });
    const events = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    const collapsed = findEvent(events, 'ATTEMPT_COLLAPSED') as any;

    expect(collapsed).toBeDefined();
  });

  test('collapse records the correct collapsedAtLayer', () => {
    // 2 layers: thresholds=[0.4, 0.6]
    // layer 0: winningProportion=0.5 >= 0.4 → passes
    // layer 1: winningProportion=0.5 < 0.6 → collapses
    const config = createTestConfig(2, [0.4, 0.6]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: 50/50, threshold=0.4 → passes
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });
    expect(state.attempts[0].status).toBe('in_progress');

    // Layer 1: 50/50, threshold=0.6 → collapses
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].collapsedAtLayer).toBe(1);
    expect(state.attempts[0].layerResults.find(r => r.layerIndex === 0)?.status).toBe('locked_in');
  });

  test('collapse emits AUDIO_CUE with collapse_gesture', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });
    const events = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    const collapseAudio = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'collapse_gesture'
    );
    expect(collapseAudio).toBeDefined();
  });

  test('collapse of attempt 0 auto-advances to attempt_story for attempt 1', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });

    expect(state.phase).toBe('attempt_story');
    expect(state.currentAttemptIndex).toBe(1);
  });

  test('collapse of attempt 1 auto-advances to attempt_story for attempt 2', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');

    // Collapse attempt 0
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });
    // Now at attempt_story index 1

    // Advance to attempt_build 1 and collapse
    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 1
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });

    expect(state.phase).toBe('attempt_story');
    expect(state.currentAttemptIndex).toBe(2);
  });

  test('collapse of attempt 2 (Song 3) does NOT auto-advance — manual transition required', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');

    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'attempt_build', attemptIndex: 2 });
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    // Should stay in attempt_build (not auto-advance to finale)
    expect(state.phase).toBe('attempt_build');
    expect(state.currentAttemptIndex).toBe(2);
    expect(state.attempts[2].status).toBe('collapsed');
  });

  test('unreached layers are marked in results after collapse', () => {
    // 3 layers: thresholds=[0.4, 0.6, 0.6]
    // layer 0: winningProportion=0.5 >= 0.4 → passes; layer 1: 0.5 < 0.6 → collapses; layer 2: unreached
    const config = createTestConfig(3, [0.4, 0.6, 0.6]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: passes (threshold=0.4)
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });

    // Layer 1: collapses (threshold=0.6)
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    const results = state.attempts[0].layerResults;
    expect(results.find(r => r.layerIndex === 0)?.status).toBe('locked_in');
    // The layer that failed the threshold is marked 'collapsed'
    expect(results.find(r => r.layerIndex === 1)?.status).toBe('collapsed');
    // Layers that were never reached are marked 'unreached' with null winningProportion
    expect(results.find(r => r.layerIndex === 2)?.status).toBe('unreached');
    expect(results.find(r => r.layerIndex === 2)?.winningProportion).toBeNull();
  });
});

// ============================================================================
// Song Completion and attempt_resolve
// ============================================================================

describe('Song Completion and attempt_resolve', () => {
  test('all 6 layers complete when all thresholds pass', () => {
    const config = createTestConfig(6);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);

    // Unanimous votes → winningProportion=1.0, always passes
    for (let i = 0; i < 6; i++) {
      completeSingleLayer(state, ['u1'], 'A');
    }

    expect(state.attempts[0].status).toBe('completed');
    expect(state.attempts[0].layerResults).toHaveLength(6);
    expect(state.attempts[0].layerResults.every(r => r.status === 'locked_in')).toBe(true);
  });

  test('completed attempt auto-transitions to attempt_resolve (not collapse)', () => {
    const config = createTestConfig(2);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);

    completeSingleLayer(state, ['u1'], 'A');
    const events = completeSingleLayer(state, ['u1'], 'B');

    expect(state.phase).toBe('attempt_resolve');
    expect(state.currentAttemptIndex).toBe(0);
    expect(findEvent(events, 'SHOW_PHASE_CHANGED')).toBeDefined();
    const phaseChanged = findEvent(events, 'SHOW_PHASE_CHANGED') as any;
    expect(phaseChanged.phase).toBe('attempt_resolve');
  });

  test('TRIGGER_REJECTION emits SONG_REJECTED and rejection audio cue during attempt_resolve', () => {
    const config = createTestConfig(2);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);
    completeSingleLayer(state, ['u1'], 'A');
    completeSingleLayer(state, ['u1'], 'B');

    expect(state.phase).toBe('attempt_resolve');

    const events = processCommand(state, { type: 'TRIGGER_REJECTION' });

    expect(findEvent(events, 'SONG_REJECTED')).toBeDefined();
    const rejectionAudio = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'rejection_gesture'
    );
    expect(rejectionAudio).toBeDefined();
    const songRejected = findEvent(events, 'SONG_REJECTED') as any;
    expect(songRejected.attemptIndex).toBe(0);
  });

  test('TRIGGER_REJECTION returns error when not in attempt_resolve', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'TRIGGER_REJECTION' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('completed attempt status is completed after all layers pass', () => {
    const config = createTestConfig(3);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);

    completeNLayers(state, 3, ['u1'], 'A');

    expect(state.attempts[0].status).toBe('completed');
  });
});

// ============================================================================
// Force Commands
// ============================================================================

describe('Force Commands', () => {
  test('FORCE_OPTION locks in the specified option regardless of votes', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);

    const events = processCommand(state, { type: 'FORCE_OPTION', choice: 'B' });

    expect(state.attempts[0].layerResults[0].chosenOption).toBe('B');
    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(findEvent(events, 'LAYER_LOCKED_IN')).toBeDefined();
  });

  test('FORCE_OPTION lock-in has null thresholdRequired (bypasses threshold check)', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'FORCE_OPTION', choice: 'A' });

    expect(state.attempts[0].layerResults[0].thresholdRequired).toBeNull();
  });

  test('FORCE_COLLAPSE collapses the current attempt immediately', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'FORCE_COLLAPSE' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(findEvent(events, 'ATTEMPT_COLLAPSED')).toBeDefined();
  });

  test('FORCE_COLLAPSE works even when no votes have been cast', () => {
    const state = createTestState();
    advanceToBuild(state);
    const events = processCommand(state, { type: 'FORCE_COLLAPSE' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(findEvent(events, 'ATTEMPT_COLLAPSED')).toBeDefined();
  });

  test('FORCE_COLLAPSE returns error when not in attempt_build', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'FORCE_COLLAPSE' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('RERUN_VOTE clears votes and returns to auditioning', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });

    expect(state.attempts[0].votes).toHaveLength(1);

    const events = processCommand(state, { type: 'RERUN_VOTE' });

    expect(state.attempts[0].votes).toHaveLength(0);
    expect(state.attempts[0].currentLayerPhase).toBe('auditioning');
    expect(findEvent(events, 'LAYER_PHASE_CHANGED')).toBeDefined();
  });
});

// ============================================================================
// User Connection
// ============================================================================

describe('User Connection', () => {
  test('USER_CONNECT creates a new user', () => {
    const state = createTestState();
    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1', seatId: 'seat-1' });

    expect(state.users.has('user-1')).toBe(true);
    const user = state.users.get('user-1')!;
    expect(user.seatId).toBe('seat-1');
    expect(user.connected).toBe(true);
  });

  test('USER_CONNECT reconnects an existing user', () => {
    const state = createTestState();
    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1' });
    processCommand(state, { type: 'USER_DISCONNECT', userId: 'user-1' });

    expect(state.users.get('user-1')!.connected).toBe(false);

    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1' });
    expect(state.users.get('user-1')!.connected).toBe(true);
    expect(state.users.size).toBe(1);
  });

  test('USER_DISCONNECT marks user as disconnected', () => {
    const state = createTestState();
    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1' });
    processCommand(state, { type: 'USER_DISCONNECT', userId: 'user-1' });

    expect(state.users.get('user-1')!.connected).toBe(false);
  });
});

// ============================================================================
// Recovery
// ============================================================================

describe('Recovery', () => {
  test('RESET_TO_LOBBY resets phase and attempts but preserves users when specified', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: true });

    expect(state.phase).toBe('lobby');
    expect(state.currentAttemptIndex).toBe(0);
    expect(state.users.has('user-1')).toBe(true);
    expect(state.attempts[0].status).toBe('pending');
    expect(state.paused).toBe(false);
  });

  test('RESET_TO_LOBBY clears users when preserveUsers is false', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: false });

    expect(state.users.size).toBe(0);
  });

  test('FORCE_RECONNECT_ALL emits FORCE_RECONNECT event', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'FORCE_RECONNECT_ALL' });

    expect(findEvent(events, 'FORCE_RECONNECT')).toBeDefined();
  });
});

// ============================================================================
// Audio Commands
// ============================================================================

describe('Audio Commands', () => {
  test('AUDIO_TRANSPORT emits transport audio cue', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'AUDIO_TRANSPORT', action: 'play' });

    const cue = events.find(e => e.type === 'AUDIO_CUE');
    expect(cue).toBeDefined();
    expect((cue as any).cue.type).toBe('transport');
    expect((cue as any).cue.action).toBe('play');
  });

  test('AUDIO_PANIC emits panic audio cue', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'AUDIO_PANIC' });

    const cue = events.find(e => e.type === 'AUDIO_CUE');
    expect(cue).toBeDefined();
    expect((cue as any).cue.type).toBe('panic');
  });
});

// ============================================================================
// V3.2: 3 Bundled Layer Groups + Live Seed
// ============================================================================

describe('V3.2: 3 Bundled Layer Groups', () => {
  test('3 layers per attempt with thresholds [0.50, 0.66, 0.99]', () => {
    const config = createTestConfig(3, [0.50, 0.66, 0.99]);
    const state = createTestState(config);
    advanceToBuild(state);

    expect(state.attempts[0].layerPlan).toHaveLength(3);
    expect(state.config.attempts[0].thresholds).toEqual([0.50, 0.66, 0.99]);
  });

  test('layer 0 passes with exactly 50/50 split at threshold 0.50', () => {
    // threshold=0.50: winningProportion=0.5 >= 0.50 → passes
    const config = createTestConfig(1, [0.50]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(state.attempts[0].layerResults[0].passed).toBe(true);
  });

  test('layer 1 passes when winning proportion >= 0.66', () => {
    // 2 voters vote A, 1 votes B: winningProportion=0.667 >= 0.66 → passes
    const config = createTestConfig(1, [0.66]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    connectUser(state, 'u3');
    advanceToBuild(state);

    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u3', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    expect(state.attempts[0].layerResults[0].passed).toBe(true);
  });

  test('layer 2 collapses on any non-unanimous vote at threshold 0.99', () => {
    // 9/10 for A: winningProportion=0.9 < 0.99 → collapses
    const config = createTestConfig(1, [0.99]);
    const state = createTestState(config);
    for (let i = 0; i < 10; i++) connectUser(state, `u${i}`);
    advanceToBuild(state);

    processCommand(state, { type: 'START_AUDITION' });
    for (let i = 0; i < 9; i++) processCommand(state, { type: 'SUBMIT_VOTE', userId: `u${i}`, choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u9', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    expect(state.attempts[0].status).toBe('collapsed');
  });

  test('ADVANCE_PHASE to attempt_build emits live_seed_start cue', () => {
    const state = createTestState();
    // advance to attempt_build (3 ADVANCE_PHASE calls)
    processCommand(state, { type: 'ADVANCE_PHASE' }); // opener
    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story
    const events = processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build

    const liveSeedCue = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'live_seed_start'
    );
    expect(liveSeedCue).toBeDefined();
    expect((liveSeedCue as any).cue.attemptIndex).toBe(0);
    expect((liveSeedCue as any).cue.trackIndices).toEqual([99]);
  });

  test('collapse does NOT emit separate live_seed_stop (handled by collapse_gesture)', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    const events = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    // live_seed_stop should NOT be emitted during collapse — the collapse_gesture
    // already includes live seed tracks in its wall-clock gain ramp. A separate
    // beat-locked live_seed_stop would race and unmute the track.
    const liveSeedStop = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'live_seed_stop'
    );
    expect(liveSeedStop).toBeUndefined();

    // collapse_gesture should still be emitted
    const collapseGesture = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'collapse_gesture'
    );
    expect(collapseGesture).toBeDefined();
  });

  test('song rejection emits live_seed_stop cue', () => {
    const config = createTestConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);
    completeSingleLayer(state, ['u1'], 'A');
    // now in attempt_resolve
    const events = processCommand(state, { type: 'TRIGGER_REJECTION' });

    const liveSeedStop = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'live_seed_stop'
    );
    expect(liveSeedStop).toBeDefined();
  });

  test('audition_start cue carries trackBundle with all tracks in layer group', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'START_AUDITION' });
    const auditionCue = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'audition_start'
    );

    expect(auditionCue).toBeDefined();
    const cue = (auditionCue as any).cue;
    expect(cue.trackBundle).toBeDefined();
    expect(Array.isArray(cue.trackBundle.tracks)).toBe(true);
    expect(cue.trackBundle.tracks.length).toBeGreaterThan(0);
    expect(cue.otherTrackBundle).toBeDefined();
    expect(Array.isArray(cue.otherTrackBundle.tracks)).toBe(true);
  });

  test('lock_in cue carries winnerTrackBundle and loserTrackBundle', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);

    const events = completeSingleLayer(state, ['u1'], 'A');
    const lockInCue = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'lock_in'
    );

    expect(lockInCue).toBeDefined();
    const cue = (lockInCue as any).cue;
    expect(cue.winnerTrackBundle).toBeDefined();
    expect(Array.isArray(cue.winnerTrackBundle.tracks)).toBe(true);
    expect(cue.loserTrackBundle).toBeDefined();
    expect(Array.isArray(cue.loserTrackBundle.tracks)).toBe(true);
  });

  test('layer results carry group identity from V32LayerConfig', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);
    completeSingleLayer(state, ['u1'], 'A');

    const result = state.attempts[0].layerResults[0];
    expect(result.group).toBe('bones'); // first layer group in makeV32LayerConfig
  });
});


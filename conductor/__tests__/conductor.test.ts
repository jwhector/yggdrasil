/**
 * Conductor State Machine Tests (NEW SYSTEM)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import { createInitialState, processCommand } from '../conductor';
import type { ShowState, ShowConfig, AttemptConfig, LayerConfig, ConductorEvent, AudioReference } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeAudioRef(index: number): AudioReference {
  return { trackIndex: index };
}

function makeLayerConfig(index: number, threshold: number | null = null): LayerConfig {
  return {
    index,
    type: index === 0 ? 'foundation' : index === 1 ? 'pulse' : 'color',
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    doubtThreshold: threshold,
  };
}

function makeAttemptConfig(
  chapter: 'ambition' | 'love' | 'avoidance',
  thresholds: (number | null)[] = [null, null, 0.65],
): AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    layers: thresholds.map((t, i) => makeLayerConfig(i, t)),
  };
}

function createTestConfig(layerThresholds: (number | null)[] = [null, null, 0.65]): ShowConfig {
  return {
    maxLayersPerAttempt: 7,
    attempts: [
      makeAttemptConfig('ambition', layerThresholds),
      makeAttemptConfig('love', layerThresholds),
      makeAttemptConfig('avoidance', layerThresholds),
    ],
    finale: {
      slotCount: 7,
      rotationBars: 8,
      defaultRotationRate: 2,
      triangleDriftTimeoutMs: 10000,
      triangleDriftSpeedMs: 3000,
      fragments: [],
    },
    timing: {
      auditionDurationMs: 4000,
      votingWindowMs: 30000,
      resolveAnimationMs: 5000,
      collapseAnimationMs: 3000,
      autoAdvanceToStoryMs: 2000,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: ['seat-1', 'seat-2'],
  };
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

/** Run through the full layer cycle: audition → vote → close (resolve). */
function completeSingleLayer(state: ShowState, voters: string[], choice: 'A' | 'B' = 'A'): ConductorEvent[] {
  processCommand(state, { type: 'START_AUDITION' });
  processCommand(state, { type: 'OPEN_VOTING' });
  for (const userId of voters) {
    processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  }
  return processCommand(state, { type: 'CLOSE_VOTING' });
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

  test('ADVANCE_PHASE walks through the full phase sequence', () => {
    const state = createTestState();
    const phases: string[] = [state.phase];

    // Walk through all phases
    for (let i = 0; i < 11; i++) {
      processCommand(state, { type: 'ADVANCE_PHASE' });
      phases.push(state.phase);
    }

    expect(phases).toEqual([
      'lobby',
      'opener',
      'attempt_story', // attempt 0
      'attempt_build', // attempt 0
      'attempt_story', // attempt 1
      'attempt_build', // attempt 1
      'attempt_story', // attempt 2
      'attempt_build', // attempt 2
      'finale_setup',
      'finale_rotating',
      'finale_frozen',
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

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story 1
    expect(state.currentAttemptIndex).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 1
    expect(state.currentAttemptIndex).toBe(1);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story 2
    expect(state.currentAttemptIndex).toBe(2);
  });

  test('ADVANCE_PHASE returns error when already at ended', () => {
    const state = createTestState();
    // Walk to ended
    for (let i = 0; i < 11; i++) {
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

  test('OPEN_VOTING transitions from auditioning to voting', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });

    const events = processCommand(state, { type: 'OPEN_VOTING' });
    expect(state.attempts[0].currentLayerPhase).toBe('voting');
    expect(findEvent(events, 'LAYER_PHASE_CHANGED')).toBeDefined();
  });

  test('OPEN_VOTING returns error when not in auditioning phase', () => {
    const state = createTestState();
    advanceToBuild(state);
    // Layer is in 'locked' — should fail
    const events = processCommand(state, { type: 'OPEN_VOTING' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('SUBMIT_VOTE records a vote during voting phase', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });

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
    processCommand(state, { type: 'OPEN_VOTING' });

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
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-2', choice: 'A' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });
    expect(findEvent(events, 'VOTE_RESULT')).toBeDefined();
  });
});

// ============================================================================
// Vote Resolution: Lock-in
// ============================================================================

describe('Vote Resolution and Lock-in', () => {
  test('layer locks in when consensus meets or exceeds threshold', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    connectUser(state, 'user-2');
    connectUser(state, 'user-3');
    advanceToBuild(state);

    // Layer 0 has no threshold (null), so any majority wins
    const events = completeSingleLayer(state, ['user-1', 'user-2', 'user-3'], 'A');

    expect(findEvent(events, 'LAYER_LOCKED_IN')).toBeDefined();
    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(state.attempts[0].layerResults[0].chosenOption).toBe('A');
  });

  test('layer advances to next layer after lock-in', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);

    completeSingleLayer(state, ['user-1'], 'A');

    expect(state.attempts[0].currentLayerIndex).toBe(1);
    expect(state.attempts[0].currentLayerPhase).toBe('locked');
  });

  test('attempt is completed when all layers are locked in', () => {
    // Config with 2 layers, both no threshold
    const config = createTestConfig([null, null]);
    const state = createTestState(config);
    connectUser(state, 'user-1');
    advanceToBuild(state);

    completeSingleLayer(state, ['user-1'], 'A');
    const events = completeSingleLayer(state, ['user-1'], 'B');

    expect(state.attempts[0].status).toBe('completed');
    expect(findEvent(events, 'ATTEMPT_COMPLETED')).toBeDefined();
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
// Doubt Threshold and Collapse
// ============================================================================

describe('Doubt Threshold and Collapse', () => {
  test('attempt collapses when consensus is below doubt threshold', () => {
    // Layer 0 has 65% threshold
    const config = createTestConfig([0.65]);
    const state = createTestState(config);
    // Need 4 voters to get 50% consensus (2:2 split)
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    connectUser(state, 'u3');
    connectUser(state, 'u4');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u3', choice: 'B' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u4', choice: 'B' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].collapsedAtLayer).toBe(0);
    expect(findEvent(events, 'ATTEMPT_COLLAPSED')).toBeDefined();
  });

  test('collapse records the correct collapsedAtLayer', () => {
    // 2 layers: layer 0 no threshold, layer 1 has 90% threshold
    const config = createTestConfig([null, 0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: all vote A, no threshold → passes
    completeSingleLayer(state, ['u1', 'u2'], 'A');

    // Layer 1: split vote 1:1 = 50%, threshold 90% → collapses
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].collapsedAtLayer).toBe(1);
    // Layer 0 should be in results as locked_in
    expect(state.attempts[0].layerResults.find(r => r.layerIndex === 0)?.status).toBe('locked_in');
  });

  test('collapse emits AUDIO_CUE with collapse_gesture', () => {
    const config = createTestConfig([0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });
    const collapseAudio = events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'collapse_gesture'
    );
    expect(collapseAudio).toBeDefined();
  });

  test('collapse of attempt 0 auto-advances to attempt_story for attempt 1', () => {
    const config = createTestConfig([0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.phase).toBe('attempt_story');
    expect(state.currentAttemptIndex).toBe(1);
  });

  test('collapse of attempt 1 auto-advances to attempt_story for attempt 2', () => {
    const config = createTestConfig([0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');

    // Collapse attempt 0
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    // Now at attempt_story index 1

    // Advance to attempt_build 1 and collapse
    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 1
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.phase).toBe('attempt_story');
    expect(state.currentAttemptIndex).toBe(2);
  });

  test('collapse of attempt 2 (Song 3) does NOT auto-advance — manual transition required', () => {
    const config = createTestConfig([0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');

    // Jump straight to attempt_build for attempt 2
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'attempt_build', attemptIndex: 2 });

    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    // Should stay in attempt_build (not auto-advance to finale_setup)
    expect(state.phase).toBe('attempt_build');
    expect(state.currentAttemptIndex).toBe(2);
    expect(state.attempts[2].status).toBe('collapsed');
  });

  test('unreached layers are marked in results after collapse', () => {
    // 3 layers, collapse on layer 1
    const config = createTestConfig([null, 0.9, 0.9]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: passes
    completeSingleLayer(state, ['u1', 'u2'], 'A');

    // Layer 1: collapses
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    const results = state.attempts[0].layerResults;
    expect(results.find(r => r.layerIndex === 0)?.status).toBe('locked_in');
    expect(results.find(r => r.layerIndex === 1)?.status).toBe('unreached');
    expect(results.find(r => r.layerIndex === 2)?.status).toBe('unreached');
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

    // Don't vote, just force
    const events = processCommand(state, { type: 'FORCE_OPTION', choice: 'B' });

    expect(state.attempts[0].layerResults[0].chosenOption).toBe('B');
    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(findEvent(events, 'LAYER_LOCKED_IN')).toBeDefined();
  });

  test('FORCE_COLLAPSE collapses the current attempt immediately', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'FORCE_COLLAPSE' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(findEvent(events, 'ATTEMPT_COLLAPSED')).toBeDefined();
  });

  test('FORCE_CONTINUE returns error when not in resolving phase', () => {
    const state = createTestState();
    advanceToBuild(state);

    const events = processCommand(state, { type: 'FORCE_CONTINUE' });
    expect(findEvent(events, 'ERROR')).toBeDefined();
  });

  test('RERUN_VOTE clears votes and returns to auditioning', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });

    expect(state.attempts[0].votes).toHaveLength(1);

    const events = processCommand(state, { type: 'RERUN_VOTE' });

    expect(state.attempts[0].votes).toHaveLength(0);
    expect(state.attempts[0].currentLayerPhase).toBe('auditioning');
    expect(findEvent(events, 'LAYER_PHASE_CHANGED')).toBeDefined();
  });

  test('SET_THRESHOLD updates the doubt threshold for a specific layer', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'SET_THRESHOLD', layerIndex: 0, threshold: 0.8 });

    expect(state.attempts[0].layerPlan[0].doubtThreshold).toBe(0.8);
  });

  test('SET_THRESHOLD can set threshold to null (disable doubt)', () => {
    const config = createTestConfig([0.9]);
    const state = createTestState(config);
    advanceToBuild(state);

    processCommand(state, { type: 'SET_THRESHOLD', layerIndex: 0, threshold: null });

    expect(state.attempts[0].layerPlan[0].doubtThreshold).toBeNull();
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
    expect(user.finaleChapter).toBeNull();
  });

  test('USER_CONNECT reconnects an existing user', () => {
    const state = createTestState();
    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1' });
    processCommand(state, { type: 'USER_DISCONNECT', userId: 'user-1' });

    expect(state.users.get('user-1')!.connected).toBe(false);

    processCommand(state, { type: 'USER_CONNECT', userId: 'user-1' });
    expect(state.users.get('user-1')!.connected).toBe(true);
    // Should not create a duplicate
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

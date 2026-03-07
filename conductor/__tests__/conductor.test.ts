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
  AttemptConfig,
  LayerConfig,
  ConductorEvent,
  AudioReference,
  LayerType,
} from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeAudioRef(index: number): AudioReference {
  return { trackIndex: index };
}

const LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

function makeLayerConfig(index: number): LayerConfig {
  return {
    index,
    type: LAYER_TYPES[index % LAYER_TYPES.length],
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
  };
}

function makeAttemptConfig(
  chapter: 'ambition' | 'love' | 'avoidance',
  layerCount = 3,
  drainFactor = 0.5,
  layerMultipliers?: number[],
): AttemptConfig {
  const multipliers = layerMultipliers ?? Array(layerCount).fill(1.0);
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    layers: Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i)),
    drainFactor,
    layerMultipliers: multipliers,
  };
}

function createTestConfig(
  layerCount = 3,
  drainFactor = 0.5,
  layerMultipliers?: number[],
): ShowConfig {
  const multipliers = layerMultipliers ?? Array(layerCount).fill(1.0);
  return {
    layersPerAttempt: layerCount,
    attempts: [
      makeAttemptConfig('ambition', layerCount, drainFactor, multipliers),
      makeAttemptConfig('love', layerCount, drainFactor, multipliers),
      makeAttemptConfig('avoidance', layerCount, drainFactor, multipliers),
    ],
    finale: {
      consensusRoundDurationMs: 15000,
      firstRoundDurationMs: 20000,
      initialThreshold: 0.4,
      thresholdDecayPerFailure: 0.05,
      minThreshold: 0.25,
      interRoundDelayMs: 3000,
      successCelebrationMs: 6000,
      npcAutoTriggers: [],
    },
    timing: {
      auditionDurationMs: 4000,
      votingWindowMs: 30000,
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: ['seat-1', 'seat-2'],
  };
}

/**
 * Config where a 50/50 split immediately collapses the health bar.
 * Uses drainFactor=2.0 so 0.5 * 100 * 2.0 * 1.0 = 100 → full drain on first split vote.
 */
function createCollapseConfig(layerCount = 1): ShowConfig {
  return createTestConfig(layerCount, 2.0, Array(layerCount).fill(1.0));
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

/** Run through the full layer cycle: audition → vote → close → advance from reveal. */
function completeSingleLayer(state: ShowState, voters: string[], choice: 'A' | 'B' = 'A'): ConductorEvent[] {
  processCommand(state, { type: 'START_AUDITION' });
  processCommand(state, { type: 'OPEN_VOTING' });
  for (const userId of voters) {
    processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  }
  const revealEvents = processCommand(state, { type: 'CLOSE_VOTING' });
  const lockInEvents = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
  return [...revealEvents, ...lockInEvents];
}

/** Run through N layers with unanimous votes (no drain). */
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

    for (let i = 0; i < 14; i++) {
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
      'finale_consensus',
      'finale_performer_mix',
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
    for (let i = 0; i < 14; i++) {
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

  test('CLOSE_VOTING transitions layer to revealing and emits HEALTH_BAR_DRAINED', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'user-1', choice: 'A' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });
    expect(findEvent(events, 'HEALTH_BAR_DRAINED')).toBeDefined();
  });
});

// ============================================================================
// Health Bar: Drain Mechanics
// ============================================================================

describe('Health Bar Drain Mechanics', () => {
  test('unanimous vote causes zero drain on health bar', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    connectUser(state, 'u3');
    advanceToBuild(state);

    completeSingleLayer(state, ['u1', 'u2', 'u3'], 'A'); // unanimous → 0 drain

    expect(state.attempts[0].healthBar.current).toBe(100);
  });

  test('health bar drains correctly with 70/30 split (factor=0.5, multiplier=1.0)', () => {
    // losingProportion = 3/10 = 0.3 → drain = 0.3 * 100 * 0.5 * 1.0 = 15
    const config = createTestConfig(1, 0.5, [1.0]);
    const state = createTestState(config);
    for (let i = 1; i <= 10; i++) connectUser(state, `u${i}`);
    advanceToBuild(state);

    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    for (let i = 1; i <= 7; i++) processCommand(state, { type: 'SUBMIT_VOTE', userId: `u${i}`, choice: 'A' });
    for (let i = 8; i <= 10; i++) processCommand(state, { type: 'SUBMIT_VOTE', userId: `u${i}`, choice: 'B' });

    const events = processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].healthBar.current).toBeCloseTo(85);
    const drainEvent = events.find(e => e.type === 'HEALTH_BAR_DRAINED') as any;
    expect(drainEvent.drain.drainAmount).toBeCloseTo(15);
    expect(drainEvent.drain.losingProportion).toBeCloseTo(0.3);
  });

  test('later layers cost more than early layers with default multipliers', () => {
    // 2 layers: multiplier[0]=0.5, multiplier[1]=2.0 with same 50/50 split
    const config = createTestConfig(2, 0.5, [0.5, 2.0]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: 50/50 split → drain = 0.5 * 100 * 0.5 * 0.5 = 12.5
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    const layer0Events = processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    // Layer 1: 50/50 split → drain = 0.5 * 100 * 0.5 * 2.0 = 50
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    const layer1Events = processCommand(state, { type: 'CLOSE_VOTING' });

    const drain0 = (layer0Events.find(e => e.type === 'HEALTH_BAR_DRAINED') as any).drain.drainAmount;
    const drain1 = (layer1Events.find(e => e.type === 'HEALTH_BAR_DRAINED') as any).drain.drainAmount;
    expect(drain1).toBeGreaterThan(drain0);
    expect(drain0).toBeCloseTo(12.5);
    expect(drain1).toBeCloseTo(50);
  });

  test('default multipliers [0.5,0.6,0.8,1.0,1.3,1.6,2.0] produce escalating drain', () => {
    const defaultMultipliers = [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0];
    const config = createTestConfig(7, 0.5, defaultMultipliers);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    const drains: number[] = [];
    for (let layer = 0; layer < 7; layer++) {
      processCommand(state, { type: 'START_AUDITION' });
      processCommand(state, { type: 'OPEN_VOTING' });
      // 50/50 split → losingProportion = 0.5
      processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
      processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
      const events = processCommand(state, { type: 'CLOSE_VOTING' });

      // If attempt didn't collapse, record drain; if it did, we're done
      const drainEvent = events.find(e => e.type === 'HEALTH_BAR_DRAINED') as any;
      if (drainEvent) drains.push(drainEvent.drain.drainAmount);
      if (state.attempts[0].status === 'collapsed') break;
    }

    // Each drain should be larger than the previous
    for (let i = 1; i < drains.length; i++) {
      expect(drains[i]).toBeGreaterThan(drains[i - 1]);
    }
  });
});

// ============================================================================
// Vote Resolution: Lock-in
// ============================================================================

describe('Vote Resolution and Lock-in', () => {
  test('layer locks in when health bar survives the vote', () => {
    const state = createTestState();
    connectUser(state, 'user-1');
    connectUser(state, 'user-2');
    connectUser(state, 'user-3');
    advanceToBuild(state);

    // Unanimous vote → zero drain → health survives
    const events = completeSingleLayer(state, ['user-1', 'user-2', 'user-3'], 'A');

    expect(findEvent(events, 'LAYER_LOCKED_IN')).toBeDefined();
    expect(state.attempts[0].layerResults[0].status).toBe('locked_in');
    expect(state.attempts[0].layerResults[0].chosenOption).toBe('A');
  });

  test('layer result includes drainAmount after lock-in', () => {
    const config = createTestConfig(1, 0.5, [1.0]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // 1A, 1B: losingProportion = 0.5, drain = 25
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });

    expect(state.attempts[0].layerResults[0].drainAmount).toBeCloseTo(25);
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
// Health Bar Collapse
// ============================================================================

describe('Health Bar Collapse', () => {
  test('attempt collapses when health bar reaches zero', () => {
    // drainFactor=2.0, 50/50 split (1A,1B) → drain = 100 → immediate collapse
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    const closeEvents = processCommand(state, { type: 'CLOSE_VOTING' });
    const advanceEvents = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    const allEvents = [...closeEvents, ...advanceEvents];

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].collapsedAtLayer).toBe(0);
    expect(state.attempts[0].healthBar.current).toBe(0);
    expect(findEvent(allEvents, 'ATTEMPT_COLLAPSED')).toBeDefined();
    expect(findEvent(allEvents, 'HEALTH_BAR_DRAINED')).toBeDefined();
  });

  test('ATTEMPT_COLLAPSED event includes healthBar state', () => {
    const config = createCollapseConfig(1);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });
    const events = processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    const collapsed = findEvent(events, 'ATTEMPT_COLLAPSED') as any;

    expect(collapsed).toBeDefined();
    expect(collapsed.healthBar).toBeDefined();
    expect(collapsed.healthBar.current).toBe(0);
  });

  test('collapse records the correct collapsedAtLayer', () => {
    // 2 layers: layer 0 passes (unanimous), layer 1 collapses (50/50, drainFactor=2.0)
    const config = createTestConfig(2, 2.0, [0.0, 1.0]); // multiplier 0 = no drain on layer 0
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: 50/50 but multiplier=0 → zero drain → passes
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    expect(state.attempts[0].status).toBe('in_progress');

    // Layer 1: 50/50, multiplier=1.0, drainFactor=2.0 → drain=100 → collapse
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

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
    processCommand(state, { type: 'OPEN_VOTING' });
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
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });

    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

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
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    // Now at attempt_story index 1

    // Advance to attempt_build 1 and collapse
    processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_build 1
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

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
    processCommand(state, { type: 'OPEN_VOTING' });
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
    // 3 layers: layer 0 passes (zero drain), layers 1,2 become unreached after collapse on layer 1
    const config = createTestConfig(3, 2.0, [0.0, 1.0, 1.0]); // layer 0 no drain, layer 1 full drain
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    advanceToBuild(state);

    // Layer 0: passes (multiplier=0 → no drain)
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    // Layer 1: collapses (drainFactor=2.0, multiplier=1.0, 50/50 → drain=100)
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'OPEN_VOTING' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u2', choice: 'B' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });

    const results = state.attempts[0].layerResults;
    expect(results.find(r => r.layerIndex === 0)?.status).toBe('locked_in');
    expect(results.find(r => r.layerIndex === 1)?.status).toBe('unreached');
    expect(results.find(r => r.layerIndex === 2)?.status).toBe('unreached');
    // Unreached layers have null drainAmount
    expect(results.find(r => r.layerIndex === 1)?.drainAmount).toBeNull();
    expect(results.find(r => r.layerIndex === 2)?.drainAmount).toBeNull();
  });

  test('health bar history records all drain events', () => {
    // 2 layers, both survive (unanimous vote → 0 drain each)
    const config = createTestConfig(2, 0.5, [1.0, 1.0]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    connectUser(state, 'u2');
    connectUser(state, 'u3');
    advanceToBuild(state);

    completeSingleLayer(state, ['u1', 'u2', 'u3'], 'A'); // layer 0: 3A, 0B → 0 drain
    completeSingleLayer(state, ['u1', 'u2'], 'A');        // layer 2: 2A, 0B → 0 drain (u3 didn't vote)

    expect(state.attempts[0].healthBar.history).toHaveLength(2);
  });
});

// ============================================================================
// Song Completion and attempt_resolve
// ============================================================================

describe('Song Completion and attempt_resolve', () => {
  test('all 7 layers complete when health bar survives the full song', () => {
    const config = createTestConfig(7, 0.5, [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);

    // Unanimous votes → zero drain throughout
    for (let i = 0; i < 7; i++) {
      completeSingleLayer(state, ['u1'], 'A');
    }

    expect(state.attempts[0].status).toBe('completed');
    expect(state.attempts[0].layerResults).toHaveLength(7);
    expect(state.attempts[0].layerResults.every(r => r.status === 'locked_in')).toBe(true);
    expect(state.attempts[0].healthBar.current).toBe(100); // No drain (unanimous)
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

  test('completed attempt health bar remains above zero', () => {
    const config = createTestConfig(3, 0.5, [1.0, 1.0, 1.0]);
    const state = createTestState(config);
    connectUser(state, 'u1');
    advanceToBuild(state);

    // Unanimous → zero drain
    completeNLayers(state, 3, ['u1'], 'A');

    expect(state.attempts[0].healthBar.current).toBe(100);
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

  test('FORCE_OPTION lock-in has null drainAmount (bypasses health bar)', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'FORCE_OPTION', choice: 'A' });

    expect(state.attempts[0].layerResults[0].drainAmount).toBeNull();
  });

  test('FORCE_COLLAPSE collapses the current attempt immediately regardless of health bar state', () => {
    const state = createTestState();
    advanceToBuild(state);

    expect(state.attempts[0].healthBar.current).toBe(100);

    const events = processCommand(state, { type: 'FORCE_COLLAPSE' });

    expect(state.attempts[0].status).toBe('collapsed');
    expect(state.attempts[0].healthBar.current).toBe(0);
    expect(findEvent(events, 'ATTEMPT_COLLAPSED')).toBeDefined();
  });

  test('FORCE_COLLAPSE works even with full health bar', () => {
    const state = createTestState();
    advanceToBuild(state);
    // Health is still 100, no votes taken
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
    processCommand(state, { type: 'OPEN_VOTING' });
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

  test('RESET_TO_LOBBY resets health bars on all attempts', () => {
    const state = createTestState();
    connectUser(state, 'u1');
    advanceToBuild(state);
    // Partially drain health bar
    processCommand(state, { type: 'SET_HEALTH', value: 42 });
    expect(state.attempts[0].healthBar.current).toBe(42);

    processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: true });

    expect(state.attempts[0].healthBar.current).toBe(100);
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
// Health Bar Controls
// ============================================================================

describe('Health Bar Controls', () => {
  test('SET_DRAIN_FACTOR updates drain factor for current attempt', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'SET_DRAIN_FACTOR', factor: 0.75 });

    expect(state.attempts[0].healthBar.drainFactor).toBe(0.75);
  });

  test('SET_HEALTH sets health bar to specified value', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'SET_HEALTH', value: 50 });

    expect(state.attempts[0].healthBar.current).toBe(50);
  });

  test('SET_HEALTH clamps value to 0–100 range', () => {
    const state = createTestState();
    advanceToBuild(state);

    processCommand(state, { type: 'SET_HEALTH', value: 150 });
    expect(state.attempts[0].healthBar.current).toBe(100);

    processCommand(state, { type: 'SET_HEALTH', value: -10 });
    expect(state.attempts[0].healthBar.current).toBe(0);
  });
});

// ============================================================================
// Initial State
// ============================================================================

describe('Initial State', () => {
  test('each attempt starts with a fresh health bar at 100', () => {
    const state = createTestState();

    for (const attempt of state.attempts) {
      expect(attempt.healthBar.current).toBe(100);
      expect(attempt.healthBar.history).toHaveLength(0);
    }
  });

  test('health bar stores attempt drainFactor from config', () => {
    const config = createTestConfig(3, 0.75);
    const state = createTestState(config);

    for (const attempt of state.attempts) {
      expect(attempt.healthBar.drainFactor).toBe(0.75);
    }
  });
});

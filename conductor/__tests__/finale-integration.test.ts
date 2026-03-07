/**
 * Finale Integration Tests
 *
 * Tests the full consensus game and performer mix pipelines through
 * processCommand, verifying state mutations and events end-to-end.
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
// Test Helpers (duplicated from conductor.test.ts — kept local for isolation)
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

function makeAttemptConfig(chapter: 'ambition' | 'love' | 'avoidance', layerCount = 2): AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    layers: Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i)),
    drainFactor: 0.1, // low drain so songs don't collapse
    layerMultipliers: Array(layerCount).fill(1.0),
  };
}

function createFinaleConfig(layerCount = 2): ShowConfig {
  return {
    layersPerAttempt: layerCount,
    attempts: [
      makeAttemptConfig('ambition', layerCount),
      makeAttemptConfig('love', layerCount),
      makeAttemptConfig('avoidance', layerCount),
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
      beatsPerLoop: 32,
      auditionsPerLayer: 2,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function createTestState(config?: ShowConfig): ShowState {
  return createInitialState(config ?? createFinaleConfig(), 'test-show');
}

function connectUsers(state: ShowState, count: number): string[] {
  const ids = Array.from({ length: count }, (_, i) => `user-${i}`);
  for (const id of ids) processCommand(state, { type: 'USER_CONNECT', userId: id });
  return ids;
}

function completeSingleLayer(state: ShowState, voters: string[], choice: 'A' | 'B' = 'A'): void {
  processCommand(state, { type: 'START_AUDITION' });
  processCommand(state, { type: 'OPEN_VOTING' });
  for (const userId of voters) processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  processCommand(state, { type: 'CLOSE_VOTING' });
  processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
}

/**
 * Advance from lobby all the way through all 3 attempts into finale_elegy,
 * then call SETUP_FINALE.
 */
function advanceToFinale(state: ShowState, voters: string[], layerCount: number): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  for (let attempt = 0; attempt < 3; attempt++) {
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_build
    for (let layer = 0; layer < layerCount; layer++) {
      completeSingleLayer(state, voters, 'A');
    }
    // → attempt_resolve (auto-advance after completion)
    processCommand(state, { type: 'TRIGGER_REJECTION' }); // → next attempt_story or finale_elegy
  }
  // Now in finale_elegy
  processCommand(state, { type: 'SETUP_FINALE' });
}

function findEvent(events: ConductorEvent[], type: string): ConductorEvent | undefined {
  return events.find(e => e.type === type);
}

// ============================================================================
// SETUP_FINALE
// ============================================================================

describe('SETUP_FINALE', () => {
  test('computes available and locked fragments from attempt results', () => {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 5);

    processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
    for (let attempt = 0; attempt < 3; attempt++) {
      processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
      processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_build
      for (let layer = 0; layer < layerCount; layer++) {
        completeSingleLayer(state, voters, 'A');
      }
      processCommand(state, { type: 'TRIGGER_REJECTION' });
    }

    const events = processCommand(state, { type: 'SETUP_FINALE' });
    const setupEvent = findEvent(events, 'FINALE_SETUP_COMPLETE') as Extract<
      ConductorEvent,
      { type: 'FINALE_SETUP_COMPLETE' }
    >;

    expect(setupEvent).toBeDefined();
    // 3 attempts × 2 layers × 1 winner = 6 available
    expect(setupEvent.availableFragments).toHaveLength(6);
    // 3 attempts × 2 layers × 1 loser = 6 locked
    expect(setupEvent.lockedFragments).toHaveLength(6);

    expect(state.finaleState).not.toBeNull();
    expect(state.finaleState!.phase).toBe('elegy');
    expect(state.finaleState!.consensusGame.threshold).toBe(0.4);
  });

  test('allFragments contains winners and losers', () => {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, layerCount);

    // 3 × 2 × 2 options = 12 total
    expect(state.finaleState!.allFragments).toHaveLength(12);
  });
});

// ============================================================================
// Consensus Game — Round Flow
// ============================================================================

describe('Consensus Game — round flow', () => {
  function setupConsensusState() {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 10);
    advanceToFinale(state, voters, layerCount);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // elegy → finale_consensus
    return { state, voters };
  }

  test('START_CONSENSUS_ROUND sets round active, increments round count, sets threshold', () => {
    const { state } = setupConsensusState();
    const events = processCommand(state, { type: 'START_CONSENSUS_ROUND' });

    const startEvent = findEvent(events, 'CONSENSUS_ROUND_STARTED') as Extract<
      ConductorEvent,
      { type: 'CONSENSUS_ROUND_STARTED' }
    >;
    expect(startEvent).toBeDefined();
    expect(startEvent.roundNumber).toBe(1);
    expect(startEvent.threshold).toBeCloseTo(0.4);
    expect(state.finaleState!.consensusGame.active).toBe(true);
    expect(state.finaleState!.consensusGame.currentRound).toBe(1);
  });

  test('SUBMIT_CONSENSUS_VOTE records vote and emits CONSENSUS_VOTE_UPDATED', () => {
    const { state, voters } = setupConsensusState();
    processCommand(state, { type: 'START_CONSENSUS_ROUND' });

    const firstFragment = state.finaleState!.availableFragments[0];
    const events = processCommand(state, {
      type: 'SUBMIT_CONSENSUS_VOTE',
      userId: voters[0],
      fragmentId: firstFragment.id,
    });

    const updateEvent = findEvent(events, 'CONSENSUS_VOTE_UPDATED') as Extract<
      ConductorEvent,
      { type: 'CONSENSUS_VOTE_UPDATED' }
    >;
    expect(updateEvent).toBeDefined();
    expect(updateEvent.convergenceValue).toBeCloseTo(1.0); // only one voter so far
  });

  test('END_CONSENSUS_ROUND succeeds when convergence >= threshold', () => {
    const { state, voters } = setupConsensusState();
    processCommand(state, { type: 'START_CONSENSUS_ROUND' });

    const firstFragment = state.finaleState!.availableFragments[0];
    // All 10 voters vote for the same fragment → convergence = 1.0 >= 0.4
    for (const userId of voters) {
      processCommand(state, { type: 'SUBMIT_CONSENSUS_VOTE', userId, fragmentId: firstFragment.id });
    }

    const events = processCommand(state, { type: 'END_CONSENSUS_ROUND' });
    const successEvent = findEvent(events, 'CONSENSUS_ROUND_SUCCESS') as Extract<
      ConductorEvent,
      { type: 'CONSENSUS_ROUND_SUCCESS' }
    >;
    expect(successEvent).toBeDefined();
    expect(successEvent.fragmentId).toBe(firstFragment.id);
    expect(successEvent.convergence).toBeCloseTo(1.0);

    const audioCue = findEvent(events, 'AUDIO_CUE') as Extract<ConductorEvent, { type: 'AUDIO_CUE' }>;
    expect(audioCue?.cue.type).toBe('consensus_activate');

    const { consensusGame } = state.finaleState!;
    expect(consensusGame.lockedRoles.has(firstFragment.layerType)).toBe(true);
    expect(consensusGame.consecutiveFailures).toBe(0);
    expect(consensusGame.active).toBe(false);
  });

  test('END_CONSENSUS_ROUND fails when convergence < threshold', () => {
    const { state, voters } = setupConsensusState();
    processCommand(state, { type: 'START_CONSENSUS_ROUND' });

    const fragments = state.finaleState!.availableFragments;
    // Each voter votes for a different fragment → max convergence = 1/10 = 0.1 < 0.4
    for (let i = 0; i < voters.length; i++) {
      const frag = fragments[i % fragments.length];
      processCommand(state, { type: 'SUBMIT_CONSENSUS_VOTE', userId: voters[i], fragmentId: frag.id });
    }

    const events = processCommand(state, { type: 'END_CONSENSUS_ROUND' });
    const failureEvent = findEvent(events, 'CONSENSUS_ROUND_FAILURE');
    expect(failureEvent).toBeDefined();
    expect(state.finaleState!.consensusGame.consecutiveFailures).toBe(1);
    expect(state.finaleState!.consensusGame.active).toBe(false);
  });

  test('threshold decays after consecutive failures', () => {
    const { state, voters } = setupConsensusState();
    const fragments = state.finaleState!.availableFragments;

    // Fail round 1
    processCommand(state, { type: 'START_CONSENSUS_ROUND' });
    for (let i = 0; i < voters.length; i++) {
      processCommand(state, { type: 'SUBMIT_CONSENSUS_VOTE', userId: voters[i], fragmentId: fragments[i % fragments.length].id });
    }
    processCommand(state, { type: 'END_CONSENSUS_ROUND' });
    expect(state.finaleState!.consensusGame.consecutiveFailures).toBe(1);

    // Round 2 threshold should decay
    const events2 = processCommand(state, { type: 'START_CONSENSUS_ROUND' });
    const startEvent2 = findEvent(events2, 'CONSENSUS_ROUND_STARTED') as Extract<
      ConductorEvent,
      { type: 'CONSENSUS_ROUND_STARTED' }
    >;
    // initialThreshold 0.4 - 1 * 0.05 = 0.35
    expect(startEvent2.threshold).toBeCloseTo(0.35);
  });

  test('CONSENSUS_GAME_COMPLETE emitted when all available layer types are locked', () => {
    // Use 1-layer-per-attempt config so there are fewer layer types to lock
    // layerCount=1: 3 attempts × 1 layer = 3 unique layerTypes → won't reach 7
    // We need at least 7 distinct layer types locked.
    // Use layerCount=3 to get melody, drums, pad per attempt × 3 = 9 available (3 layer types × 3 songs)
    // But we only need 7 distinct layerTypes. layerCount=7 means 7 per attempt.
    const layerCount = 7;
    const config = createFinaleConfig(layerCount);
    const state = createTestState(config);
    const voters = connectUsers(state, 10);
    advanceToFinale(state, voters, layerCount);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_consensus

    const available = state.finaleState!.availableFragments;
    // Lock all 7 role types one round at a time
    const lockedLayerTypes = new Set<string>();
    let gameComplete = false;

    for (const fragment of available) {
      if (lockedLayerTypes.has(fragment.layerType)) continue;

      processCommand(state, { type: 'START_CONSENSUS_ROUND' });
      // Unanimous vote for this fragment
      for (const userId of voters) {
        processCommand(state, { type: 'SUBMIT_CONSENSUS_VOTE', userId, fragmentId: fragment.id });
      }
      const events = processCommand(state, { type: 'END_CONSENSUS_ROUND' });
      lockedLayerTypes.add(fragment.layerType);

      if (findEvent(events, 'CONSENSUS_GAME_COMPLETE')) {
        gameComplete = true;
        break;
      }
    }

    expect(gameComplete).toBe(true);
    expect(state.finaleState!.consensusGame.lockedRoles.size).toBe(7);
  });
});

// ============================================================================
// SET_CONSENSUS_THRESHOLD / SEND_NPC_MESSAGE
// ============================================================================

describe('SET_CONSENSUS_THRESHOLD', () => {
  test('overrides the current threshold', () => {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, layerCount);

    processCommand(state, { type: 'SET_CONSENSUS_THRESHOLD', threshold: 0.6 });
    expect(state.finaleState!.consensusGame.threshold).toBeCloseTo(0.6);
  });
});

describe('SEND_NPC_MESSAGE', () => {
  test('sets npc currentMessage and emits NPC_MESSAGE', () => {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, layerCount);

    const events = processCommand(state, { type: 'SEND_NPC_MESSAGE', message: 'hello audience' });
    const npcEvent = findEvent(events, 'NPC_MESSAGE') as Extract<ConductorEvent, { type: 'NPC_MESSAGE' }>;
    expect(npcEvent?.message).toBe('hello audience');
    expect(state.finaleState!.npc.currentMessage).toBe('hello audience');
  });
});

// ============================================================================
// Performer Mix
// ============================================================================

describe('Performer Mix', () => {
  function setupPerformerMixState() {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 10);
    advanceToFinale(state, voters, layerCount);
    // Lock one role via consensus so performerMix starts with something
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_consensus
    processCommand(state, { type: 'START_CONSENSUS_ROUND' });
    const firstFrag = state.finaleState!.availableFragments[0];
    for (const userId of voters) {
      processCommand(state, { type: 'SUBMIT_CONSENSUS_VOTE', userId, fragmentId: firstFrag.id });
    }
    processCommand(state, { type: 'END_CONSENSUS_ROUND' });
    processCommand(state, { type: 'START_PERFORMER_MIX' });
    return { state, voters, firstFrag };
  }

  test('START_PERFORMER_MIX transitions to performer_mix phase and seeds activeLayers from lockedRoles', () => {
    const { state, firstFrag } = setupPerformerMixState();
    expect(state.finaleState!.phase).toBe('performer_mix');
    expect(state.finaleState!.performerMix.activeLayers.get(firstFrag.layerType)).toBe(firstFrag.id);
  });

  test('QUEUE_FRAGMENT adds pending change', () => {
    const { state } = setupPerformerMixState();
    const frag = state.finaleState!.allFragments[0];
    processCommand(state, { type: 'QUEUE_FRAGMENT', layerType: frag.layerType, fragmentId: frag.id });
    expect(state.finaleState!.performerMix.pendingChanges).toHaveLength(1);
    expect(state.finaleState!.performerMix.pendingChanges[0].fragmentId).toBe(frag.id);
  });

  test('QUEUE_FRAGMENT with null queues a mute', () => {
    const { state } = setupPerformerMixState();
    processCommand(state, { type: 'QUEUE_FRAGMENT', layerType: 'melody', fragmentId: null });
    const change = state.finaleState!.performerMix.pendingChanges.find(p => p.layerType === 'melody');
    expect(change?.fragmentId).toBeNull();
  });

  test('CANCEL_PENDING removes pending change for that layer', () => {
    const { state } = setupPerformerMixState();
    processCommand(state, { type: 'QUEUE_FRAGMENT', layerType: 'melody', fragmentId: 'frag-x' });
    processCommand(state, { type: 'CANCEL_PENDING', layerType: 'melody' });
    expect(state.finaleState!.performerMix.pendingChanges).toHaveLength(0);
  });

  test('FIRE_PENDING_CHANGES applies changes, emits events, clears queue', () => {
    const { state } = setupPerformerMixState();
    const frag = state.finaleState!.allFragments[0];
    processCommand(state, { type: 'QUEUE_FRAGMENT', layerType: frag.layerType, fragmentId: frag.id });

    const events = processCommand(state, { type: 'FIRE_PENDING_CHANGES' });

    const firedEvent = findEvent(events, 'PENDING_CHANGES_FIRED') as Extract<
      ConductorEvent,
      { type: 'PENDING_CHANGES_FIRED' }
    >;
    expect(firedEvent).toBeDefined();
    expect(firedEvent.changes).toHaveLength(1);

    const audioCue = findEvent(events, 'AUDIO_CUE') as Extract<ConductorEvent, { type: 'AUDIO_CUE' }>;
    expect(audioCue?.cue.type).toBe('mix_update');

    expect(findEvent(events, 'MIX_STATE_UPDATED')).toBeDefined();
    expect(state.finaleState!.performerMix.pendingChanges).toHaveLength(0);
    expect(state.finaleState!.performerMix.activeLayers.get(frag.layerType)).toBe(frag.id);
  });

  test('LOAD_SNAPSHOT queues all layers in the snapshot', () => {
    const { state } = setupPerformerMixState();
    const snapshot = new Map<LayerType, string | null>([
      ['melody', 'frag-a'],
      ['drums', null],
      ['pad', 'frag-b'],
    ]);
    processCommand(state, { type: 'LOAD_SNAPSHOT', snapshot });

    const pending = state.finaleState!.performerMix.pendingChanges;
    expect(pending).toHaveLength(3);
    expect(pending.find(p => p.layerType === 'melody')?.fragmentId).toBe('frag-a');
    expect(pending.find(p => p.layerType === 'drums')?.fragmentId).toBeNull();
    expect(pending.find(p => p.layerType === 'pad')?.fragmentId).toBe('frag-b');
  });

  test('TOGGLE_LIVE_TRACK adds and removes track from liveTracksActive', () => {
    const { state } = setupPerformerMixState();
    processCommand(state, { type: 'TOGGLE_LIVE_TRACK', trackId: 'vocal-mic' });
    expect(state.finaleState!.performerMix.liveTracksActive).toContain('vocal-mic');

    processCommand(state, { type: 'TOGGLE_LIVE_TRACK', trackId: 'vocal-mic' });
    expect(state.finaleState!.performerMix.liveTracksActive).not.toContain('vocal-mic');
  });
});

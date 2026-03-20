/**
 * Finale Integration Tests — V3 Assembly / Deliberation / Ceremony
 *
 * Tests the full finale flow through the conductor state machine.
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

const LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

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
    thresholds: Array(layerCount).fill(0.5),
    tempos: Array(layerCount).fill(120),
    auditionBars: Array(layerCount).fill(4),
    auditionCycles: Array(layerCount).fill(1),
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
      assemblyTimerMs: 60000,
      assemblyGracePeriodMs: 15000,
      deliberationTimerMs: 120000,
      ambassadorVolunteerTimerMs: 15000,
      ceremonyLayerOrder: ['bass', 'drums', 'pad', 'melody', 'harmony', 'fx'],
      audioPreviewPath: '/audio/previews',
      layerLabels: new Map(),
      npcMessages: [],
      bothOptionsSurvive: true,
    },
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
      loopBoundaryBeats: 32,
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
  for (const userId of voters) processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  processCommand(state, { type: 'CLOSE_VOTING' });
  processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
}

function advanceToFinale(state: ShowState, voters: string[], layerCount: number): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  for (let attempt = 0; attempt < 3; attempt++) {
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_build
    for (let layer = 0; layer < layerCount; layer++) {
      completeSingleLayer(state, voters, 'A');
    }
    processCommand(state, { type: 'TRIGGER_REJECTION' });
  }
  // After 3rd rejection we're in attempt_resolve (attempt 2); advance to finale_elegy
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_elegy (auto-inits finaleState)
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
    advanceToFinale(state, voters, layerCount);

    expect(state.finaleState).not.toBeNull();
    expect(state.finaleState!.phase).toBe('elegy');
    // bothOptionsSurvive: true → 3 attempts × 2 layers × 2 options = 12 available
    expect(state.finaleState!.availableFragments).toHaveLength(12);
    // bothOptionsSurvive: true → no locked fragments (all voted layers survive)
    expect(state.finaleState!.lockedFragments).toHaveLength(0);
  });

  test('allFragments contains all 12 options', () => {
    const layerCount = 2;
    const state = createTestState(createFinaleConfig(layerCount));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, layerCount);
    // 3 × 2 × 2 options = 12
    expect(state.finaleState!.allFragments).toHaveLength(12);
  });

  test('fragments have previewAudioPath set', () => {
    const state = createTestState(createFinaleConfig(2));
    const voters = connectUsers(state, 3);
    advanceToFinale(state, voters, 2);
    for (const frag of state.finaleState!.allFragments) {
      expect(frag.previewAudioPath).toMatch(/^\/audio\/previews\/preview-/);
    }
  });
});

// ============================================================================
// Assembly
// ============================================================================

describe('Assembly flow', () => {
  function setupAssemblyState() {
    const state = createTestState(createFinaleConfig(2));
    const voters = connectUsers(state, 6);
    advanceToFinale(state, voters, 2);
    return { state, voters };
  }

  test('START_ASSEMBLY initializes groups and emits ASSEMBLY_STARTED', () => {
    const { state } = setupAssemblyState();
    const events = processCommand(state, { type: 'START_ASSEMBLY' });
    expect(findEvent(events, 'ASSEMBLY_STARTED')).toBeDefined();
    expect(state.finaleState!.phase).toBe('assembly');
    expect(state.finaleState!.assembly.undecidedUsers).toHaveLength(6);
    expect(state.finaleState!.assembly.groups.size).toBe(6);
  });

  test('JOIN_GROUP moves user to group and emits GROUP_MEMBERSHIP_CHANGED', () => {
    const { state, voters } = setupAssemblyState();
    processCommand(state, { type: 'START_ASSEMBLY' });
    const events = processCommand(state, { type: 'JOIN_GROUP', userId: voters[0], layerType: 'melody' });
    expect(findEvent(events, 'GROUP_MEMBERSHIP_CHANGED')).toBeDefined();
    expect(state.finaleState!.assembly.groups.get('melody')).toContain(voters[0]);
    expect(state.finaleState!.assembly.undecidedUsers).not.toContain(voters[0]);
  });

  test('ASSEMBLY_TIMER_EXPIRED assigns undecided users and emits ASSEMBLY_COMPLETE', () => {
    const { state, voters } = setupAssemblyState();
    processCommand(state, { type: 'START_ASSEMBLY' });
    // Have 3 users join, leaving 3 undecided
    processCommand(state, { type: 'JOIN_GROUP', userId: voters[0], layerType: 'melody' });
    processCommand(state, { type: 'JOIN_GROUP', userId: voters[1], layerType: 'drums' });
    processCommand(state, { type: 'JOIN_GROUP', userId: voters[2], layerType: 'pad' });

    const events = processCommand(state, { type: 'ASSEMBLY_TIMER_EXPIRED' });
    expect(findEvent(events, 'ASSEMBLY_COMPLETE')).toBeDefined();
    expect(state.finaleState!.assembly.undecidedUsers).toHaveLength(0);
    // All 6 users should now be in some group
    let total = 0;
    for (const members of state.finaleState!.assembly.groups.values()) total += members.length;
    expect(total).toBe(6);
  });

  test('FORCE_END_ASSEMBLY works like ASSEMBLY_TIMER_EXPIRED', () => {
    const { state } = setupAssemblyState();
    processCommand(state, { type: 'START_ASSEMBLY' });
    const events = processCommand(state, { type: 'FORCE_END_ASSEMBLY' });
    expect(findEvent(events, 'ASSEMBLY_COMPLETE')).toBeDefined();
    expect(state.finaleState!.assembly.undecidedUsers).toHaveLength(0);
  });

  test('EXTEND_ASSEMBLY_TIMER adds time', () => {
    const { state } = setupAssemblyState();
    processCommand(state, { type: 'START_ASSEMBLY' });
    const before = state.finaleState!.assembly.timerRemaining;
    processCommand(state, { type: 'EXTEND_ASSEMBLY_TIMER', additionalMs: 10000 });
    expect(state.finaleState!.assembly.timerRemaining).toBe(before + 10000);
  });
});

// ============================================================================
// Deliberation
// ============================================================================

describe('Deliberation flow', () => {
  function setupDeliberationState() {
    const state = createTestState(createFinaleConfig(6)); // 6 layers per attempt
    const voters = connectUsers(state, 6);
    advanceToFinale(state, voters, 6);
    processCommand(state, { type: 'START_ASSEMBLY' });
    // Assign each voter to a different layer type group
    const layerTypes: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];
    for (let i = 0; i < voters.length; i++) {
      processCommand(state, { type: 'JOIN_GROUP', userId: voters[i], layerType: layerTypes[i] });
    }
    processCommand(state, { type: 'ASSEMBLY_TIMER_EXPIRED' });
    return { state, voters, layerTypes };
  }

  test('START_DELIBERATION transitions phase and emits DELIBERATION_STARTED', () => {
    const { state } = setupDeliberationState();
    const events = processCommand(state, { type: 'START_DELIBERATION' });
    expect(findEvent(events, 'DELIBERATION_STARTED')).toBeDefined();
    expect(state.finaleState!.phase).toBe('deliberation');
  });

  test('SUBMIT_GROUP_VOTE records vote and emits GROUP_VOTE_UPDATED', () => {
    const { state, voters } = setupDeliberationState();
    processCommand(state, { type: 'START_DELIBERATION' });
    const melodyFragment = state.finaleState!.availableFragments.find(f => f.layerType === 'melody');
    if (!melodyFragment) return; // skip if no melody fragment available

    const events = processCommand(state, {
      type: 'SUBMIT_GROUP_VOTE',
      userId: voters[0], // voters[0] is in melody group
      layerType: 'melody',
      fragmentId: melodyFragment.id,
    });
    expect(findEvent(events, 'GROUP_VOTE_UPDATED')).toBeDefined();
  });

  test('DELIBERATION_TIMER_EXPIRED resolves fragments and emits FRAGMENT_CHOSEN', () => {
    const { state, voters } = setupDeliberationState();
    processCommand(state, { type: 'START_DELIBERATION' });
    const melodyFragment = state.finaleState!.availableFragments.find(f => f.layerType === 'melody');
    if (melodyFragment) {
      processCommand(state, {
        type: 'SUBMIT_GROUP_VOTE',
        userId: voters[0],
        layerType: 'melody',
        fragmentId: melodyFragment.id,
      });
    }
    const events = processCommand(state, { type: 'DELIBERATION_TIMER_EXPIRED' });
    expect(events.some(e => e.type === 'FRAGMENT_CHOSEN')).toBe(true);
    expect(state.finaleState!.deliberation.volunteerTimerRemaining).not.toBeNull();
  });

  test('VOLUNTEER_AS_AMBASSADOR emits AMBASSADOR_VOLUNTEERED', () => {
    const { state, voters } = setupDeliberationState();
    processCommand(state, { type: 'START_DELIBERATION' });
    processCommand(state, { type: 'DELIBERATION_TIMER_EXPIRED' });
    const events = processCommand(state, {
      type: 'VOLUNTEER_AS_AMBASSADOR',
      userId: voters[0],
      layerType: 'melody',
    });
    expect(findEvent(events, 'AMBASSADOR_VOLUNTEERED')).toBeDefined();
  });

  test('AMBASSADOR_VOLUNTEER_TIMER_EXPIRED resolves ambassadors and emits DELIBERATION_COMPLETE', () => {
    const { state, voters } = setupDeliberationState();
    processCommand(state, { type: 'START_DELIBERATION' });
    processCommand(state, { type: 'DELIBERATION_TIMER_EXPIRED' });
    // voters[0] volunteers for melody
    processCommand(state, { type: 'VOLUNTEER_AS_AMBASSADOR', userId: voters[0], layerType: 'melody' });
    const events = processCommand(state, { type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED', layerType: 'melody' });
    expect(findEvent(events, 'DELIBERATION_COMPLETE')).toBeDefined();
  });
});

// ============================================================================
// Ceremony
// ============================================================================

describe('Ceremony flow', () => {
  function setupCeremonyState() {
    const state = createTestState(createFinaleConfig(6));
    const voters = connectUsers(state, 6);
    advanceToFinale(state, voters, 6);
    processCommand(state, { type: 'START_ASSEMBLY' });
    const layerTypes: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];
    for (let i = 0; i < voters.length; i++) {
      processCommand(state, { type: 'JOIN_GROUP', userId: voters[i], layerType: layerTypes[i] });
    }
    processCommand(state, { type: 'ASSEMBLY_TIMER_EXPIRED' });
    processCommand(state, { type: 'START_DELIBERATION' });
    processCommand(state, { type: 'DELIBERATION_TIMER_EXPIRED' });
    // All groups are single-member, so ambassadors are auto-selected
    processCommand(state, { type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED', layerType: 'melody' });
    return { state, voters, layerTypes };
  }

  test('START_CEREMONY transitions phase and emits CEREMONY_STARTED', () => {
    const { state } = setupCeremonyState();
    const events = processCommand(state, { type: 'START_CEREMONY' });
    expect(findEvent(events, 'CEREMONY_STARTED')).toBeDefined();
    expect(state.finaleState!.phase).toBe('ceremony');
  });

  test('CALL_NEXT_AMBASSADOR emits AMBASSADOR_CALLED', () => {
    const { state } = setupCeremonyState();
    processCommand(state, { type: 'START_CEREMONY' });
    const events = processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
    // First non-forfeited in ceremonyLayerOrder ['bass','drums','pad','melody','harmony','fx']
    const calledEvent = findEvent(events, 'AMBASSADOR_CALLED') as Extract<ConductorEvent, { type: 'AMBASSADOR_CALLED' }> | undefined;
    expect(calledEvent).toBeDefined();
  });

  test('ALTAR_LOCK_IN with wrong ambassador is rejected (no event)', () => {
    const { state } = setupCeremonyState();
    processCommand(state, { type: 'START_CEREMONY' });
    processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
    const events = processCommand(state, {
      type: 'ALTAR_LOCK_IN',
      userId: 'not-the-ambassador',
      layerType: 'bass',
    });
    expect(findEvent(events, 'CEREMONY_LAYER_LOCKED')).toBeUndefined();
  });

  test('FORCE_LOCK_IN locks layer and emits CEREMONY_LAYER_LOCKED', () => {
    const { state } = setupCeremonyState();
    processCommand(state, { type: 'START_CEREMONY' });
    processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
    const bassFragment = state.finaleState!.deliberation.chosenFragments.get('bass');
    if (!bassFragment) return;

    const events = processCommand(state, { type: 'FORCE_LOCK_IN', layerType: 'bass' });
    expect(findEvent(events, 'CEREMONY_LAYER_LOCKED')).toBeDefined();
    expect(state.finaleState!.ceremony.lockedLayers.get('bass')).toBe(bassFragment);
  });

  test('FORFEIT_LAYER mid-ceremony emits CEREMONY_LAYER_SKIPPED', () => {
    const { state } = setupCeremonyState();
    processCommand(state, { type: 'START_CEREMONY' });
    processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
    const events = processCommand(state, { type: 'FORFEIT_LAYER', layerType: 'bass' });
    expect(findEvent(events, 'CEREMONY_LAYER_SKIPPED')).toBeDefined();
  });

  test('CEREMONY_COMPLETE emitted after all non-forfeited layers locked via FORCE_LOCK_IN', () => {
    const { state } = setupCeremonyState();
    processCommand(state, { type: 'START_CEREMONY' });

    const layerOrder: LayerType[] = state.finaleState!.ceremony.layerOrder;
    const forfeited = state.finaleState!.ceremony.forfeitedLayers;
    let complete = false;

    for (const lt of layerOrder) {
      if (forfeited.includes(lt)) continue;
      const chosenFragment = state.finaleState!.deliberation.chosenFragments.get(lt);
      if (!chosenFragment) continue;

      processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
      const events = processCommand(state, { type: 'FORCE_LOCK_IN', layerType: lt });
      if (findEvent(events, 'CEREMONY_COMPLETE')) {
        complete = true;
        break;
      }
    }

    expect(complete).toBe(true);
    expect(state.finaleState!.ceremony.ceremonyComplete).toBe(true);
  });
});

// ============================================================================
// Performer Mix seeds from ceremony lockedLayers
// ============================================================================

describe('Performer Mix — seeded from ceremony', () => {
  test('START_PERFORMER_MIX seeds activeLayers from ceremony.lockedLayers', () => {
    const state = createTestState(createFinaleConfig(6));
    const voters = connectUsers(state, 6);
    advanceToFinale(state, voters, 6);
    processCommand(state, { type: 'START_ASSEMBLY' });
    const layerTypes: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];
    for (let i = 0; i < voters.length; i++) {
      processCommand(state, { type: 'JOIN_GROUP', userId: voters[i], layerType: layerTypes[i] });
    }
    processCommand(state, { type: 'ASSEMBLY_TIMER_EXPIRED' });
    processCommand(state, { type: 'START_DELIBERATION' });
    processCommand(state, { type: 'DELIBERATION_TIMER_EXPIRED' });
    processCommand(state, { type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED', layerType: 'melody' });
    processCommand(state, { type: 'START_CEREMONY' });

    // Force-lock at least one non-forfeited layer
    const layerOrder = state.finaleState!.ceremony.layerOrder;
    const forfeited = state.finaleState!.ceremony.forfeitedLayers;
    let lockedLayerType: LayerType | null = null;
    let lockedFragmentId: string | null = null;

    for (const lt of layerOrder) {
      if (forfeited.includes(lt)) continue;
      const chosen = state.finaleState!.deliberation.chosenFragments.get(lt);
      if (!chosen) continue;
      processCommand(state, { type: 'CALL_NEXT_AMBASSADOR' });
      processCommand(state, { type: 'FORCE_LOCK_IN', layerType: lt });
      lockedLayerType = lt;
      lockedFragmentId = chosen;
      break;
    }

    processCommand(state, { type: 'START_PERFORMER_MIX' });
    expect(state.finaleState!.phase).toBe('performer_mix');

    if (lockedLayerType && lockedFragmentId) {
      expect(state.finaleState!.performerMix.activeLayers.get(lockedLayerType)).toBe(lockedFragmentId);
    }
  });
});

// ============================================================================
// Performer Mix operations
// ============================================================================

describe('Performer Mix operations', () => {
  function setupPerformerMixState() {
    const state = createTestState(createFinaleConfig(2));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, 2);
    // Jump directly to performer mix
    processCommand(state, { type: 'START_PERFORMER_MIX' });
    return { state, voters };
  }

  test('QUEUE_FRAGMENT adds pending change', () => {
    const { state } = setupPerformerMixState();
    const frag = state.finaleState!.allFragments[0];
    processCommand(state, { type: 'QUEUE_FRAGMENT', layerType: frag.layerType, fragmentId: frag.id });
    expect(state.finaleState!.performerMix.pendingChanges).toHaveLength(1);
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
    expect(findEvent(events, 'PENDING_CHANGES_FIRED')).toBeDefined();
    expect(findEvent(events, 'MIX_STATE_UPDATED')).toBeDefined();
    const audioCue = findEvent(events, 'AUDIO_CUE') as Extract<ConductorEvent, { type: 'AUDIO_CUE' }> | undefined;
    expect(audioCue?.cue.type).toBe('mix_update');
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
  });

  test('TOGGLE_LIVE_TRACK adds and removes track', () => {
    const { state } = setupPerformerMixState();
    processCommand(state, { type: 'TOGGLE_LIVE_TRACK', trackId: 'vocal-mic' });
    expect(state.finaleState!.performerMix.liveTracksActive).toContain('vocal-mic');
    processCommand(state, { type: 'TOGGLE_LIVE_TRACK', trackId: 'vocal-mic' });
    expect(state.finaleState!.performerMix.liveTracksActive).not.toContain('vocal-mic');
  });
});

// ============================================================================
// NPC Message
// ============================================================================

describe('SEND_NPC_MESSAGE', () => {
  test('sets npc currentMessage and emits NPC_MESSAGE', () => {
    const state = createTestState(createFinaleConfig(2));
    const voters = connectUsers(state, 5);
    advanceToFinale(state, voters, 2);
    const events = processCommand(state, { type: 'SEND_NPC_MESSAGE', message: 'hello audience' });
    const npcEvent = findEvent(events, 'NPC_MESSAGE') as Extract<ConductorEvent, { type: 'NPC_MESSAGE' }> | undefined;
    expect(npcEvent?.message).toBe('hello audience');
    expect(state.finaleState!.npc.currentMessage).toBe('hello audience');
  });
});

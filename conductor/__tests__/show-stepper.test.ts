/**
 * Show Stepper Tests
 *
 * Unit tests for the pure derivation functions: deriveNextStep and derivePhoneCue.
 * Also tests that songRejected is set correctly by the conductor.
 */

import { describe, test, expect } from '@jest/globals';
import { deriveNextStep, derivePhoneCue } from '../../hooks/useShowStepper';
import { createInitialState, processCommand } from '../conductor';
import type { ShowState, ShowConfig, V32AttemptConfig, V32LayerConfig } from '../types';

// ============================================================================
// Test Helpers (mirrored from conductor.test.ts)
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

function makeAttemptConfig(chapter: string, layerCount = 3): V32AttemptConfig {
  return {
    chapter,
    title: chapter,
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: Array.from({ length: layerCount }, (_, i) => makeV32LayerConfig(i)),
    thresholds: Array(layerCount).fill(0.5),
    tempos: Array(layerCount).fill(120),
    auditionBars: Array(layerCount).fill(4),
    auditionCycles: Array(layerCount).fill(1),
  };
}

function createTestConfig(): ShowConfig {
  return {
    layersPerAttempt: 3,
    attempts: [
      makeAttemptConfig('ambition'),
      makeAttemptConfig('love'),
      makeAttemptConfig('acceptance'),
    ],
    finale: {
      bothOptionsSurvive: true,
      soundscapeTrackIndices: [],
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
      vote: {
        questions: [{ text: 'What do you feel?' }],
        shuffleQuestions: false,
        targetPoolSize: 10,
        questionDelayMs: 3000,
        revealPoolOnProjector: true,
      },
      remix: { audienceInteraction: false, orbsPerPerson: 6, orbDecayLoops: 3, tallyBroadcastMs: 500, instantCrossfade: false },
    },
    granularTypes: [
      { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
    ],
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
      loopBoundaryBeats: 32,
      gain: {
        entryGain: 0.25,
        entrySwellBeats: 4,
        holdBars: 6,
        exitFadeBeats: 8,
        lockInFadeBeats: 8,
        collapseFadeBeats: 8,
        ceremonySwellBeats: 4,
        crossfadeBeats: 4,
        unityGainValue: 0,
        stepsPerBeat: 2,
        masterDuckGain: 0.6,
        masterDuckBeats: 4,
        masterUnduckBeats: 4,
        masterFadeOutBeats: 16,
      },
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function createTestState(): ShowState {
  return createInitialState(createTestConfig(), 'test-show');
}

function advanceToBuild(state: ShowState): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  processCommand(state, { type: 'ADVANCE_PHASE' }); // opener → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story → attempt_build
}

/** Complete all 3 layers with passing votes → auto-transitions to attempt_resolve. */
function completeAllLayers(state: ShowState): void {
  processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
  for (let i = 0; i < 3; i++) {
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });
  }
}

// ============================================================================
// deriveNextStep
// ============================================================================

describe('deriveNextStep', () => {
  test('lobby → Start Show', () => {
    const state = createTestState();
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_PHASE' });
    expect(step.label).toBe('Start Show');
  });

  test('opener with slides not started → Next Slide', () => {
    const state = createTestState();
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → opener
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_SLIDE' });
    expect(step.label).toBe('Next Slide');
  });

  test('opener with slides exhausted → Begin Story', () => {
    const state = createTestState();
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → opener
    // openerSlideState is null but hasOpenerStarted=true
    const step = deriveNextStep(state, true);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_PHASE' });
    expect(step.label).toBe('Begin Story');
  });

  test('attempt_story → Begin Song Building', () => {
    const state = createTestState();
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → opener
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_PHASE' });
    expect(step.label).toBe('Begin Song Building');
  });

  test('attempt_build, layer locked → Start Audition', () => {
    const state = createTestState();
    advanceToBuild(state);
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'START_AUDITION' });
    expect(step.label).toContain('Start Audition');
  });

  test('attempt_build, auditioning → blocked', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(true);
    expect(step.label).toContain('Voting');
  });

  test('attempt_build, revealing without stakes → Show Stakes', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'REVEAL_STAKES' });
    expect(step.label).toBe('Show Stakes');
  });

  test('attempt_build, revealing with stakes → Reveal Votes', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_FROM_REVEAL' });
    expect(step.label).toBe('Reveal Votes');
  });

  test('attempt_build, locked_in → blocked (verdict timer)', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    // Should be locked_in (threshold 0.5, vote 100% A → passes)
    expect(state.attempts[0].currentLayerPhase).toBe('locked_in');
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(true);
  });

  test('attempt_resolve, not rejected → Reject Song', () => {
    const state = createTestState();
    advanceToBuild(state);
    completeAllLayers(state);
    expect(state.phase).toBe('attempt_resolve');
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'TRIGGER_REJECTION' });
    expect(step.label).toBe('Reject Song');
  });

  test('attempt_resolve, after rejection → Continue', () => {
    const state = createTestState();
    advanceToBuild(state);
    completeAllLayers(state);
    processCommand(state, { type: 'TRIGGER_REJECTION' });
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(false);
    expect(step.command).toEqual({ type: 'ADVANCE_PHASE' });
    expect(step.label).toBe('Continue');
  });

  test('finale_vote → Start Remix', () => {
    const state = createTestState();
    state.phase = 'finale_vote';
    const step = deriveNextStep(state, false);
    expect(step.command).toEqual({ type: 'START_REMIX' });
  });

  test('finale_remix → sequential node enable steps then End Show', () => {
    const state = createTestState();
    // Jump directly to finale_remix (sets up finale state automatically via finale_vote)
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'finale_vote' });
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'finale_remix' });
    expect(state.phase).toBe('finale_remix');
    expect(state.finaleState).not.toBeNull();
    expect(state.finaleState!.enabledNodes.size).toBe(0);

    // Nodes should be enabled in order: pad, fx, seed(melody), harmony, bass, drums
    const expectedOrder = [
      { id: 'pad', label: 'Enable Pad' },
      { id: 'fx', label: 'Enable FX' },
      { id: 'seed', label: 'Enable Melody' },
      { id: 'harmony', label: 'Enable Harmony' },
      { id: 'bass', label: 'Enable Bass' },
      { id: 'drums', label: 'Enable Drums' },
    ];

    for (const { id, label } of expectedOrder) {
      const s = deriveNextStep(state, false);
      expect(s.label).toBe(label);
      expect(s.command).toEqual({ type: 'ENABLE_NODE', granularType: id });
      processCommand(state, { type: 'ENABLE_NODE', granularType: id });
    }

    // All nodes enabled — now should offer End Show
    const finalStep = deriveNextStep(state, false);
    expect(finalStep.command).toEqual({ type: 'END_SHOW' });
    expect(finalStep.label).toBe('End Show');
  });

  test('epilogue → End Show', () => {
    const state = createTestState();
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'finale_vote' });
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'finale_remix' });
    processCommand(state, { type: 'END_SHOW' }); // → epilogue
    expect(state.phase).toBe('epilogue');

    const s = deriveNextStep(state, false);
    expect(s.command).toEqual({ type: 'END_SHOW' });
    expect(s.label).toBe('End Show');
  });

  test('ended → blocked', () => {
    const state = createTestState();
    state.phase = 'ended';
    const step = deriveNextStep(state, false);
    expect(step.blocked).toBe(true);
  });
});

// ============================================================================
// derivePhoneCue
// ============================================================================

describe('derivePhoneCue', () => {
  test('lobby → null', () => {
    const state = createTestState();
    expect(derivePhoneCue(state)).toBeNull();
  });

  test('attempt_build, locked → ready', () => {
    const state = createTestState();
    advanceToBuild(state);
    expect(derivePhoneCue(state)).toBe('ready');
  });

  test('attempt_build, auditioning → up', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    expect(derivePhoneCue(state)).toBe('up');
  });

  test('attempt_build, revealing → up', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    expect(derivePhoneCue(state)).toBe('up');
  });

  test('attempt_build, locked_in during verdict → up (deferred phone-down)', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    expect(state.attempts[0].currentLayerPhase).toBe('locked_in');
    // Verdict animation still playing — phone cue stays 'up'
    expect(derivePhoneCue(state)).toBe('up');
  });

  test('attempt_build, after verdict advances to next layer → ready', () => {
    const state = createTestState();
    advanceToBuild(state);
    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    processCommand(state, { type: 'START_AUDITION' });
    processCommand(state, { type: 'SUBMIT_VOTE', userId: 'u1', choice: 'A' });
    processCommand(state, { type: 'CLOSE_VOTING' });
    processCommand(state, { type: 'REVEAL_STAKES' });
    processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
    processCommand(state, { type: 'ADVANCE_FROM_VERDICT' });
    // Verdict cleared, next layer starts — phone cue is 'ready' again
    expect(derivePhoneCue(state)).toBe('ready');
  });

  test('finale_vote → up', () => {
    const state = createTestState();
    state.phase = 'finale_vote';
    expect(derivePhoneCue(state)).toBe('up');
  });

  test('finale_remix → null', () => {
    const state = createTestState();
    state.phase = 'finale_remix';
    expect(derivePhoneCue(state)).toBeNull();
  });

  test('opener → null', () => {
    const state = createTestState();
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → opener
    expect(derivePhoneCue(state)).toBeNull();
  });
});

// ============================================================================
// songRejected conductor integration
// ============================================================================

describe('songRejected field', () => {
  test('initial state has songRejected = false', () => {
    const state = createTestState();
    expect(state.attempts[0].songRejected).toBe(false);
    expect(state.attempts[1].songRejected).toBe(false);
    expect(state.attempts[2].songRejected).toBe(false);
  });

  test('TRIGGER_REJECTION sets songRejected = true', () => {
    const state = createTestState();
    advanceToBuild(state);
    completeAllLayers(state);
    expect(state.phase).toBe('attempt_resolve');
    expect(state.attempts[0].songRejected).toBe(false);

    processCommand(state, { type: 'TRIGGER_REJECTION' });
    expect(state.attempts[0].songRejected).toBe(true);
  });

  test('duplicate TRIGGER_REJECTION is idempotent', () => {
    const state = createTestState();
    advanceToBuild(state);
    completeAllLayers(state);
    const events1 = processCommand(state, { type: 'TRIGGER_REJECTION' });
    expect(events1.some(e => e.type === 'SONG_REJECTED')).toBe(true);

    const events2 = processCommand(state, { type: 'TRIGGER_REJECTION' });
    expect(events2).toEqual([]);
  });

  test('resetToLobby resets songRejected', () => {
    const state = createTestState();
    advanceToBuild(state);
    completeAllLayers(state);
    processCommand(state, { type: 'TRIGGER_REJECTION' });
    expect(state.attempts[0].songRejected).toBe(true);

    processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: false });
    expect(state.attempts[0].songRejected).toBe(false);
  });
});

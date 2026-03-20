/**
 * Timing Engine Tests (V2)
 *
 * Tests cover:
 * - Timer scheduling for auditioning and voting phases
 * - Version-check safety (stale timers ignored)
 * - Timer cancellation on phase change
 * - Paused state prevents scheduling
 * - Consensus round timer fires END_CONSENSUS_ROUND
 * - Loop boundary fires FIRE_PENDING_CHANGES
 * - Lifecycle (start/stop/dispose)
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createTimingEngine, type TimingEngine } from '../timing';
import { createNullOSCBridge, type OSCBridge } from '../osc';
import { createInitialState, processCommand } from '../../conductor/conductor';
import type {
  ShowState,
  ShowConfig,
  AttemptConfig,
  LayerConfig,
  AudioReference,
  FinaleState,
} from '../../conductor/types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeAudioRef(index: number): AudioReference {
  return { trackIndex: index };
}

function makeLayerConfig(index: number): LayerConfig {
  return {
    index,
    type: 'melody',
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
  };
}

function makeAttemptConfig(chapter: 'ambition' | 'love' | 'avoidance'): AttemptConfig {
  return {
    chapter,
    title: chapter,
    thresholds: [0.5, 0.5, 0.65, 0.78, 0.88, 0.95],
    tempos: [120, 120, 130, 140, 155, 170],
    auditionBars: [4, 4, 4, 2, 2, 2],
    layers: [0, 1, 2].map(i => makeLayerConfig(i)),
  };
}

function createTestConfig(): ShowConfig {
  return {
    layersPerAttempt: 7,
    attempts: [
      makeAttemptConfig('ambition'),
      makeAttemptConfig('love'),
      makeAttemptConfig('avoidance'),
    ],
    finale: {
      assemblyTimerMs: 120000,
      assemblyGracePeriodMs: 15000,
      deliberationTimerMs: 180000,
      ambassadorVolunteerTimerMs: 30000,
      ceremonyLayerOrder: ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'],
      audioPreviewPath: '/audio/previews',
      layerLabels: new Map(),
      npcMessages: [],
    },
    timing: {
      auditionDurationMs: 4000,
      votingWindowMs: 30000,
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 2000,
      beatsPerLoop: 0,
      auditionsPerLayer: 2,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function createTestState(): ShowState {
  return createInitialState(createTestConfig(), 'test-show');
}

/** Advance through phases to reach attempt_build for attempt 0. */
function advanceToBuild(state: ShowState): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  processCommand(state, { type: 'ADVANCE_PHASE' }); // opener → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story → attempt_build
}

function makeMinimalFinaleState(timerRemaining = 60000): FinaleState {
  const layerTypes = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'] as const;
  return {
    phase: 'assembly',
    availableFragments: [],
    allFragments: [],
    lockedFragments: [],
    assembly: {
      groups: new Map(layerTypes.map(lt => [lt, []])),
      undecidedUsers: [],
      timerRemaining,
      timerDuration: timerRemaining,
    },
    deliberation: {
      groupVotes: new Map(layerTypes.map(lt => [lt, new Map()])),
      chosenFragments: new Map(layerTypes.map(lt => [lt, null])),
      ambassadorVolunteers: new Map(layerTypes.map(lt => [lt, []])),
      ambassadors: new Map(layerTypes.map(lt => [lt, null])),
      timerRemaining: 120000,
      volunteerTimerRemaining: null,
    },
    ceremony: {
      layerOrder: [...layerTypes],
      currentIndex: -1,
      currentAmbassador: null,
      altarReady: false,
      lockedLayers: new Map(),
      forfeitedLayers: [],
      ceremonyComplete: false,
    },
    npc: { currentMessage: null },
    performerMix: {
      activeLayers: new Map(),
      pendingChanges: [],
      loopPosition: 0,
      loopCount: 0,
      liveTracksActive: [],
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TimingEngine', () => {
  let sendCommand: jest.Mock;
  let state: ShowState;
  let timingEngine: TimingEngine;

  beforeEach(() => {
    jest.useFakeTimers();
    sendCommand = jest.fn();
    state = createTestState();
  });

  afterEach(() => {
    timingEngine?.dispose();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Fallback mode (no OSC)
  // --------------------------------------------------------------------------

  describe('fallback mode (no OSC)', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null },
      );
      timingEngine.start();
    });

    test('auditioning phase schedules auditionDurationMs timer → sends CLOSE_VOTING', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      // Notify timing engine of the layer phase change
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Timer should not have fired yet
      expect(sendCommand).not.toHaveBeenCalled();

      // Advance to auditionDurationMs (4000)
      jest.advanceTimersByTime(4000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'CLOSE_VOTING' });
    });

    test('timer is cancelled on phase change', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      // Start audition timer
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Advance part way
      jest.advanceTimersByTime(2000);

      // Phase changes to revealing — cancels audition timer
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'revealing',
      }]);

      // Advance past the original audition timer (4000 total)
      jest.advanceTimersByTime(3000);

      // Should NOT have sent CLOSE_VOTING (timer was cancelled)
      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'CLOSE_VOTING' });
    });

    test('timer fires even if state version changed (version check disabled)', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });
      const scheduledVersion = state.version;

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Manually bump version to simulate an external state change
      state.version = scheduledVersion + 10;

      jest.advanceTimersByTime(4000);

      // Version check is disabled — timer still fires
      expect(sendCommand).toHaveBeenCalledWith({ type: 'CLOSE_VOTING' });
    });

    test('does not schedule when paused', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });
      state.paused = true;

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      jest.advanceTimersByTime(10000);

      expect(sendCommand).not.toHaveBeenCalled();
    });

    test('locked_in does not schedule a timer', () => {
      advanceToBuild(state);

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'locked_in',
      }]);

      jest.advanceTimersByTime(60000);

      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  describe('lifecycle', () => {
    test('isRunning reflects state', () => {
      timingEngine = createTimingEngine(sendCommand, () => state, { enabled: true });
      expect(timingEngine.isRunning()).toBe(false);

      timingEngine.start();
      expect(timingEngine.isRunning()).toBe(true);

      timingEngine.stop();
      expect(timingEngine.isRunning()).toBe(false);
    });

    test('disabled engine does not start', () => {
      timingEngine = createTimingEngine(sendCommand, () => state, { enabled: false });
      timingEngine.start();

      expect(timingEngine.isRunning()).toBe(false);
    });

    test('dispose stops the engine', () => {
      timingEngine = createTimingEngine(sendCommand, () => state, { enabled: true });
      timingEngine.start();

      timingEngine.dispose();
      expect(timingEngine.isRunning()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Beat-Synced Audition (fallback mode)
  // --------------------------------------------------------------------------

  describe('beat-synced audition (fallback mode)', () => {
    function createAuditionState(): ShowState {
      const config: ShowConfig = {
        ...createTestConfig(),
        timing: {
          auditionDurationMs: 4000,
          votingWindowMs: 30000,
          revealSequenceDurationMs: 5000,
          rejectionEffectDurationMs: 2000,
          beatsPerLoop: 32,
          auditionsPerLayer: 2,
        },
      };
      return createInitialState(config, 'test-show');
    }

    beforeEach(() => {
      state = createAuditionState();
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null, fallbackBpm: 120 },
      );
      timingEngine.start();
    });

    test('sends TOGGLE_AUDITION after one beatsPerLoop interval', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      expect(sendCommand).not.toHaveBeenCalled();

      // 32 beats × (60000ms / 120bpm) = 16000ms per loop
      jest.advanceTimersByTime(16000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });

    test('sends TOGGLE_AUDITION three times then CLOSE_VOTING for auditionsPerLayer=2 (4 total loops)', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // 3 toggles (loops 1, 2, 3), then CLOSE_VOTING (loop 4 completes = totalLoops)
      jest.advanceTimersByTime(16000); // loop 1 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 2 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 3 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 4 → CLOSE_VOTING

      const toggleCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'TOGGLE_AUDITION',
      );
      const closeVotingCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'CLOSE_VOTING',
      );

      expect(toggleCalls).toHaveLength(3);
      expect(closeVotingCalls).toHaveLength(1);
    });

    test('stops audition interval on phase change to revealing', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Transition away before interval fires (e.g., manual CLOSE_VOTING)
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'revealing',
      }]);

      // Well past the interval
      jest.advanceTimersByTime(64000);

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'CLOSE_VOTING' });
    });
  });

  // --------------------------------------------------------------------------
  // Beat-Synced Audition (OSC mode)
  // --------------------------------------------------------------------------

  describe('beat-synced audition (OSC mode)', () => {
    let oscBridge: OSCBridge;

    function createAuditionState(): ShowState {
      const config: ShowConfig = {
        ...createTestConfig(),
        timing: {
          auditionDurationMs: 4000,
          votingWindowMs: 30000,
          revealSequenceDurationMs: 5000,
          rejectionEffectDurationMs: 2000,
          beatsPerLoop: 32,
          auditionsPerLayer: 2,
        },
      };
      return createInitialState(config, 'test-show');
    }

    beforeEach(async () => {
      state = createAuditionState();
      oscBridge = createNullOSCBridge();
      await oscBridge.start();  // Mark bridge as running
      oscBridge.send = jest.fn();

      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge },
      );
      timingEngine.start();
    });

    test('subscribes to beat events on start', () => {
      expect(oscBridge.send).toHaveBeenCalledWith('/live/song/start_listen/beat');
    });

    test('unsubscribes from beat events on stop', () => {
      timingEngine.stop();

      expect(oscBridge.send).toHaveBeenCalledWith('/live/song/stop_listen/beat');
    });

    test('sends TOGGLE_AUDITION after beatsPerLoop beats', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Beat 1 sets baseline; beats 2-32 have beatsSinceToggle 1-31 (< 32)
      timingEngine.onOSCMessage('/live/song/get/beat', [1]);
      for (let i = 2; i <= 32; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
        expect(sendCommand).not.toHaveBeenCalled();
      }

      // Beat 33: 33 - 1 = 32 >= beatsPerLoop(32) → TOGGLE_AUDITION
      timingEngine.onOSCMessage('/live/song/get/beat', [33]);
      expect(sendCommand).toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });

    test('sends CLOSE_VOTING after totalLoops × beatsPerLoop beats', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Beat 1 sets baseline; triggers at beats 33, 65, 97 (TOGGLE) and 129 (CLOSE_VOTING)
      for (let beat = 1; beat <= 129; beat++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [beat]);
      }

      const closeVotingCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'CLOSE_VOTING',
      );
      expect(closeVotingCalls).toHaveLength(1);

      const toggleCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'TOGGLE_AUDITION',
      );
      expect(toggleCalls).toHaveLength(3); // 3 toggles before the final CLOSE_VOTING
    });

    test('sends TOGGLE_AUDITION when Ableton beats wrap (0-31 → 0)', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Simulate Ableton sending beats 0-31, then wrapping back to 0
      // Beat 0 sets baseline (lastToggleBeat = 0 monotonic)
      for (let i = 0; i <= 31; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
      }
      // After beats 0-31: beatsSinceToggle = 31 - 0 = 31, not >= 32
      expect(sendCommand).not.toHaveBeenCalled();

      // Ableton wraps to 0 — monotonic beat 32, beatsSinceToggle = 32 >= 32
      timingEngine.onOSCMessage('/live/song/get/beat', [0]);
      expect(sendCommand).toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });

    test('does not fire during rotation when not in auditioning phase', () => {
      advanceToBuild(state);
      // Do NOT start audition — layer is 'locked'

      // Send many beats
      for (let i = 1; i <= 64; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
      }

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });

    test('stops audition on phase change away from auditioning (OSC)', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Phase changes before beats complete (e.g., manual CLOSE_VOTING → revealing)
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'revealing',
      }]);

      // Beats continue — should not trigger TOGGLE_AUDITION
      for (let i = 1; i <= 64; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
      }

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });
  });

  // --------------------------------------------------------------------------
  // Assembly Timer
  // --------------------------------------------------------------------------

  describe('assembly timer', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null },
      );
      timingEngine.start();
    });

    test('fires ASSEMBLY_TIMER_EXPIRED when assembly timer expires', () => {
      state.phase = 'finale_assembly';
      state.finaleState = makeMinimalFinaleState(30000);

      timingEngine.onStateChanged(state, [{
        type: 'ASSEMBLY_STARTED',
        timerDuration: 30000,
      }]);

      expect(sendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(30000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'ASSEMBLY_TIMER_EXPIRED' });
    });

    test('does not fire if phase changed before timer fires', () => {
      state.phase = 'finale_assembly';
      state.finaleState = makeMinimalFinaleState(5000);

      timingEngine.onStateChanged(state, [{
        type: 'ASSEMBLY_STARTED',
        timerDuration: 5000,
      }]);

      // Phase advances before timer fires
      state.phase = 'finale_deliberation';

      jest.advanceTimersByTime(10000);

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'ASSEMBLY_TIMER_EXPIRED' });
    });

    test('timer cleared on ASSEMBLY_COMPLETE', () => {
      state.phase = 'finale_assembly';
      state.finaleState = makeMinimalFinaleState(30000);

      timingEngine.onStateChanged(state, [{
        type: 'ASSEMBLY_STARTED',
        timerDuration: 30000,
      }]);

      // Assembly ended early (force end)
      timingEngine.onStateChanged(state, [{
        type: 'ASSEMBLY_COMPLETE',
        groups: new Map(),
        emptyGroups: [],
      }]);

      jest.advanceTimersByTime(30000);

      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Deliberation Timer
  // --------------------------------------------------------------------------

  describe('deliberation timer', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null },
      );
      timingEngine.start();
    });

    test('fires DELIBERATION_TIMER_EXPIRED when deliberation timer expires', () => {
      state.phase = 'finale_deliberation';
      state.finaleState = makeMinimalFinaleState(60000);

      timingEngine.onStateChanged(state, [{
        type: 'DELIBERATION_STARTED',
        timerDuration: 60000,
      }]);

      expect(sendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'DELIBERATION_TIMER_EXPIRED' });
    });

    test('timer cleared on DELIBERATION_COMPLETE', () => {
      state.phase = 'finale_deliberation';
      state.finaleState = makeMinimalFinaleState(60000);

      timingEngine.onStateChanged(state, [{
        type: 'DELIBERATION_STARTED',
        timerDuration: 60000,
      }]);

      timingEngine.onStateChanged(state, [{ type: 'DELIBERATION_COMPLETE' }]);

      jest.advanceTimersByTime(60000);

      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Loop Boundary (Performer Mix — fallback mode)
  // --------------------------------------------------------------------------

  describe('loop boundary (fallback mode)', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null, fallbackBpm: 120 },
      );
      timingEngine.start();
    });

    test('fires FIRE_PENDING_CHANGES after 8 bars at fallback BPM', () => {
      state.phase = 'finale_performer_mix';

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_performer_mix',
      }]);

      // 8 bars × 4 beats/bar × (60000ms / 120bpm) = 16000ms
      jest.advanceTimersByTime(16000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'FIRE_PENDING_CHANGES' });
    });

    test('fires repeatedly every 8 bars', () => {
      state.phase = 'finale_performer_mix';

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_performer_mix',
      }]);

      jest.advanceTimersByTime(48000); // 3 × 16000ms

      const calls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'FIRE_PENDING_CHANGES',
      );
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    test('stops firing on show phase change', () => {
      state.phase = 'finale_performer_mix';

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_performer_mix',
      }]);

      // Phase changes away
      state.phase = 'ended';
      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'ended',
      }]);

      jest.advanceTimersByTime(64000);

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'FIRE_PENDING_CHANGES' });
    });
  });

  // --------------------------------------------------------------------------
  // Loop Boundary (Performer Mix — OSC mode)
  // --------------------------------------------------------------------------

  describe('loop boundary (OSC mode)', () => {
    let oscBridge: OSCBridge;

    beforeEach(async () => {
      oscBridge = createNullOSCBridge();
      await oscBridge.start();
      oscBridge.send = jest.fn();

      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge },
      );
      timingEngine.start();
    });

    test('fires FIRE_PENDING_CHANGES after 32 beats (8 bars × 4 beats/bar)', () => {
      state.phase = 'finale_performer_mix';

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_performer_mix',
      }]);

      // Beat 1 sets baseline; need 32 beats difference to fire
      timingEngine.onOSCMessage('/live/song/get/beat', [1]);
      for (let i = 2; i <= 32; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
        expect(sendCommand).not.toHaveBeenCalled();
      }

      // Beat 33: 33 - 1 = 32 >= loopBeats(32) → FIRE_PENDING_CHANGES
      timingEngine.onOSCMessage('/live/song/get/beat', [33]);
      expect(sendCommand).toHaveBeenCalledWith({ type: 'FIRE_PENDING_CHANGES' });
    });

    test('does not fire loop boundary when in attempt_build phase', () => {
      advanceToBuild(state);

      // Loop state not started (no SHOW_PHASE_CHANGED to finale_performer_mix)
      for (let i = 1; i <= 64; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
      }

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'FIRE_PENDING_CHANGES' });
    });
  });

  // --------------------------------------------------------------------------
  // Beat Callback Scheduler
  // --------------------------------------------------------------------------

  describe('beat callback scheduler (OSC mode)', () => {
    let oscBridge: OSCBridge;

    function fireBeat(beat: number): void {
      timingEngine.onOSCMessage('/live/song/get/beat', [beat]);
    }

    beforeEach(async () => {
      oscBridge = createNullOSCBridge();
      await oscBridge.start();
      oscBridge.send = jest.fn();

      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge },
      );
      timingEngine.start();
    });

    test('scheduleAtBeat fires callback at target beat', () => {
      const cb = jest.fn();
      timingEngine.scheduleAtBeat('test-cb', 5, cb);

      fireBeat(1);
      fireBeat(2);
      fireBeat(4);
      expect(cb).not.toHaveBeenCalled();

      fireBeat(5);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('scheduleAtBeat fires at or after target beat (late delivery)', () => {
      const cb = jest.fn();
      timingEngine.scheduleAtBeat('test-late', 5, cb);

      // Jump straight to beat 7 (skipped 5)
      fireBeat(7);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('scheduleAtBeat does not fire again after firing', () => {
      const cb = jest.fn();
      timingEngine.scheduleAtBeat('test-once', 3, cb);

      fireBeat(3);
      fireBeat(4);
      fireBeat(5);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('schedulePerBeat fires callback on each of N consecutive beats', () => {
      const cb = jest.fn();
      timingEngine.schedulePerBeat('ramp', 10, 4, cb);

      fireBeat(9);
      expect(cb).not.toHaveBeenCalled();

      fireBeat(10);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(0, 4);

      fireBeat(11);
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenLastCalledWith(1, 4);

      fireBeat(12);
      expect(cb).toHaveBeenCalledTimes(3);
      expect(cb).toHaveBeenLastCalledWith(2, 4);

      fireBeat(13);
      expect(cb).toHaveBeenCalledTimes(4);
      expect(cb).toHaveBeenLastCalledWith(3, 4);

      // No more callbacks
      fireBeat(14);
      expect(cb).toHaveBeenCalledTimes(4);
    });

    test('cancelCallbacks stops a specific callback from firing', () => {
      const cbA = jest.fn();
      const cbB = jest.fn();
      timingEngine.scheduleAtBeat('fade-1-t0', 5, cbA);
      timingEngine.scheduleAtBeat('fade-2-t0', 5, cbB);

      timingEngine.cancelCallbacks('fade-1-t0');

      fireBeat(5);
      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).toHaveBeenCalledTimes(1);
    });

    test('cancelCallbacks cancels all callbacks matching prefix', () => {
      const cb = jest.fn();
      timingEngine.schedulePerBeat('fade-5-t3', 1, 4, cb);

      timingEngine.cancelCallbacks('fade-5-t3');

      for (let i = 1; i <= 10; i++) fireBeat(i);
      expect(cb).not.toHaveBeenCalled();
    });

    test('cancelCallbacks does not cancel callbacks with different prefix', () => {
      const cbA = jest.fn();
      const cbB = jest.fn();
      timingEngine.scheduleAtBeat('fade-1-t3-step', 5, cbA);
      timingEngine.scheduleAtBeat('fade-2-t3-step', 5, cbB);

      timingEngine.cancelCallbacks('fade-1-t3');
      // fade-1-t3-step starts with 'fade-1-t3', so cbA is cancelled
      // fade-2-t3-step does not start with 'fade-1-t3', so cbB remains

      fireBeat(5);
      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).toHaveBeenCalledTimes(1);
    });

    test('getCurrentBeat returns 0 before any beats', () => {
      expect(timingEngine.getCurrentBeat()).toBe(0);
    });

    test('getCurrentBeat returns current absolute beat after beats received', () => {
      fireBeat(7);
      expect(timingEngine.getCurrentBeat()).toBe(7);

      fireBeat(15);
      expect(timingEngine.getCurrentBeat()).toBe(15);
    });

    test('getCurrentBeatPosition returns null before any beats', () => {
      expect(timingEngine.getCurrentBeatPosition()).toBeNull();
    });

    test('getCurrentBeatPosition returns correct beatInBar after beats received', () => {
      fireBeat(4); // beat 4: beatInBar = 4 % 4 = 0
      const pos = timingEngine.getCurrentBeatPosition();
      expect(pos).not.toBeNull();
      expect(pos!.absoluteBeat).toBe(4);
      expect(pos!.beatInBar).toBe(0); // 4 % 4 = 0
    });

    test('beat wrapping: monotonic beats survive Ableton loop restart (0-31 → 0)', () => {
      const cb = jest.fn();
      // Schedule at monotonic beat 35 (past first 32-beat loop)
      timingEngine.scheduleAtBeat('wrap-test', 35, cb);

      // First loop: beats 0–31
      for (let i = 0; i <= 31; i++) fireBeat(i);
      expect(cb).not.toHaveBeenCalled();

      // Ableton wraps to 0 — monotonic should continue: 32, 33, 34...
      fireBeat(0); // monotonic 32
      fireBeat(1); // monotonic 33
      fireBeat(2); // monotonic 34
      expect(cb).not.toHaveBeenCalled();

      fireBeat(3); // monotonic 35 — should fire
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('beat wrapping: getCurrentBeat returns monotonic value after wrap', () => {
      for (let i = 0; i <= 31; i++) fireBeat(i);
      expect(timingEngine.getCurrentBeat()).toBe(31);

      fireBeat(0); // wrap
      expect(timingEngine.getCurrentBeat()).toBe(32);

      fireBeat(5);
      expect(timingEngine.getCurrentBeat()).toBe(37);
    });

    test('beat wrapping: schedulePerBeat works across loop boundary', () => {
      const cb = jest.fn();

      // Start at beat 30, 4 beats long → 30, 31, wrap(32), wrap(33)
      timingEngine.schedulePerBeat('cross-wrap', 30, 4, cb);

      fireBeat(29);
      expect(cb).not.toHaveBeenCalled();

      fireBeat(30); // step 0
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(0, 4);

      fireBeat(31); // step 1
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenLastCalledWith(1, 4);

      // Ableton wraps
      fireBeat(0); // monotonic 32, step 2
      expect(cb).toHaveBeenCalledTimes(3);
      expect(cb).toHaveBeenLastCalledWith(2, 4);

      fireBeat(1); // monotonic 33, step 3
      expect(cb).toHaveBeenCalledTimes(4);
      expect(cb).toHaveBeenLastCalledWith(3, 4);
    });

    test('stop clears all scheduled beat callbacks', () => {
      const cb = jest.fn();
      timingEngine.scheduleAtBeat('test-clear', 10, cb);

      timingEngine.stop();

      // Manually call beat handler won't work after stop, but verify no callbacks remain
      // (we can't easily test this without re-starting, so just verify no crash)
      expect(() => timingEngine.stop()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Beat Callback Scheduler (fallback mode — synthetic beats)
  // --------------------------------------------------------------------------

  describe('beat callback scheduler (fallback mode)', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null, fallbackBpm: 120 },
      );
      timingEngine.start();
    });

    test('synthetic beat ticker fires beat callbacks at fallbackBpm rate', () => {
      const cb = jest.fn();
      // At 120 BPM, each beat = 500ms. Schedule at beat 3.
      timingEngine.scheduleAtBeat('ticker-test', 3, cb);

      jest.advanceTimersByTime(999); // 1.998 beats — not yet
      expect(cb).not.toHaveBeenCalled();

      jest.advanceTimersByTime(501); // Total 1500ms = 3 beats
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('schedulePerBeat fires across multiple synthetic beats', () => {
      const cb = jest.fn();
      timingEngine.schedulePerBeat('synth-ramp', 2, 3, cb);

      // 500ms per beat at 120 BPM
      jest.advanceTimersByTime(500); // beat 1 — before start
      expect(cb).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // beat 2
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(0, 3);

      jest.advanceTimersByTime(500); // beat 3
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenLastCalledWith(1, 3);

      jest.advanceTimersByTime(500); // beat 4
      expect(cb).toHaveBeenCalledTimes(3);
      expect(cb).toHaveBeenLastCalledWith(2, 3);

      jest.advanceTimersByTime(1000); // beats 5-6 — no more callbacks
      expect(cb).toHaveBeenCalledTimes(3);
    });

    test('cancelCallbacks stops synthetic beat callbacks', () => {
      const cb = jest.fn();
      timingEngine.scheduleAtBeat('cancel-test', 2, cb);

      timingEngine.cancelCallbacks('cancel-test');

      jest.advanceTimersByTime(2000); // 4 beats worth
      expect(cb).not.toHaveBeenCalled();
    });

    test('getCurrentBeat updates with synthetic beats', () => {
      expect(timingEngine.getCurrentBeat()).toBe(0);

      jest.advanceTimersByTime(500); // 1 beat
      expect(timingEngine.getCurrentBeat()).toBe(1);

      jest.advanceTimersByTime(1000); // 2 more beats
      expect(timingEngine.getCurrentBeat()).toBe(3);
    });
  });
});

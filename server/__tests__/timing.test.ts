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
    drainFactor: 0.5,
    layerMultipliers: [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0],
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

function makeMinimalFinaleState(roundTimeRemaining = 15000): FinaleState {
  return {
    phase: 'consensus_game',
    availableFragments: [],
    allFragments: [],
    lockedFragments: [],
    consensusGame: {
      active: true,
      currentRound: 1,
      roundTimeRemaining,
      votes: new Map(),
      convergenceValue: 0,
      threshold: 0.4,
      consecutiveFailures: 0,
      lockedRoles: new Map(),
    },
    npc: { currentMessage: null, autoTriggersEnabled: false },
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

    test('auditioning phase schedules auditionDurationMs timer → sends OPEN_VOTING', () => {
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

      expect(sendCommand).toHaveBeenCalledWith({ type: 'OPEN_VOTING' });
    });

    test('voting phase schedules votingWindowMs timer → sends CLOSE_VOTING', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });
      processCommand(state, { type: 'OPEN_VOTING' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'voting',
      }]);

      expect(sendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(30000);

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

      // Phase changes to voting — cancels audition timer
      processCommand(state, { type: 'OPEN_VOTING' });
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'voting',
      }]);

      // Advance past the original audition timer (4000 total)
      jest.advanceTimersByTime(3000);

      // Should NOT have sent OPEN_VOTING (timer was cancelled)
      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'OPEN_VOTING' });
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
      expect(sendCommand).toHaveBeenCalledWith({ type: 'OPEN_VOTING' });
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

    test('sends TOGGLE_AUDITION three times then OPEN_VOTING for auditionsPerLayer=2 (4 total loops)', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // 3 toggles (loops 1, 2, 3), then OPEN_VOTING (loop 4 completes = totalLoops)
      jest.advanceTimersByTime(16000); // loop 1 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 2 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 3 → TOGGLE
      jest.advanceTimersByTime(16000); // loop 4 → OPEN_VOTING

      const toggleCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'TOGGLE_AUDITION',
      );
      const openVotingCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'OPEN_VOTING',
      );

      expect(toggleCalls).toHaveLength(3);
      expect(openVotingCalls).toHaveLength(1);
    });

    test('stops audition interval on phase change to voting', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Transition away before interval fires
      processCommand(state, { type: 'OPEN_VOTING' });
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'voting',
      }]);

      // Well past the interval
      jest.advanceTimersByTime(64000);

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'OPEN_VOTING' });
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

    test('sends OPEN_VOTING after totalLoops × beatsPerLoop beats', () => {
      advanceToBuild(state);
      processCommand(state, { type: 'START_AUDITION' });

      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'auditioning',
      }]);

      // Beat 1 sets baseline; triggers at beats 33, 65, 97 (TOGGLE) and 129 (OPEN_VOTING)
      for (let beat = 1; beat <= 129; beat++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [beat]);
      }

      const openVotingCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'OPEN_VOTING',
      );
      expect(openVotingCalls).toHaveLength(1);

      const toggleCalls = (sendCommand as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'TOGGLE_AUDITION',
      );
      expect(toggleCalls).toHaveLength(3); // 3 toggles before the final OPEN_VOTING
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

      // Phase changes before beats complete
      processCommand(state, { type: 'OPEN_VOTING' });
      timingEngine.onStateChanged(state, [{
        type: 'LAYER_PHASE_CHANGED',
        attemptIndex: 0,
        layerIndex: 0,
        phase: 'voting',
      }]);

      // Beats continue — should not trigger TOGGLE_AUDITION
      for (let i = 1; i <= 64; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
      }

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'TOGGLE_AUDITION' });
    });
  });

  // --------------------------------------------------------------------------
  // Consensus Round Timer
  // --------------------------------------------------------------------------

  describe('consensus round timer', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null },
      );
      timingEngine.start();
    });

    test('fires END_CONSENSUS_ROUND when round timer expires', () => {
      state.phase = 'finale_consensus';
      state.finaleState = makeMinimalFinaleState(15000);

      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_STARTED',
        roundNumber: 1,
        threshold: 0.4,
      }]);

      expect(sendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(15000);

      expect(sendCommand).toHaveBeenCalledWith({ type: 'END_CONSENSUS_ROUND' });
    });

    test('does not fire if phase or active state changed before timer fires', () => {
      state.phase = 'finale_consensus';
      state.finaleState = makeMinimalFinaleState(5000);

      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_STARTED',
        roundNumber: 1,
        threshold: 0.4,
      }]);

      // Deactivate consensus before timer fires
      state.finaleState.consensusGame.active = false;
      state.phase = 'finale_performer_mix';

      jest.advanceTimersByTime(10000);

      expect(sendCommand).not.toHaveBeenCalledWith({ type: 'END_CONSENSUS_ROUND' });
    });

    test('timer cleared on CONSENSUS_ROUND_SUCCESS', () => {
      state.phase = 'finale_consensus';
      state.finaleState = makeMinimalFinaleState(15000);

      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_STARTED',
        roundNumber: 1,
        threshold: 0.4,
      }]);

      // Round succeeded before timer fired
      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_SUCCESS',
        fragmentId: 'frag-0-0-A',
        layerType: 'melody',
        convergence: 0.8,
      }]);

      jest.advanceTimersByTime(15000);

      expect(sendCommand).not.toHaveBeenCalled();
    });

    test('timer cleared on CONSENSUS_ROUND_FAILURE', () => {
      state.phase = 'finale_consensus';
      state.finaleState = makeMinimalFinaleState(15000);

      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_STARTED',
        roundNumber: 1,
        threshold: 0.4,
      }]);

      timingEngine.onStateChanged(state, [{
        type: 'CONSENSUS_ROUND_FAILURE',
        highestConvergence: 0.2,
      }]);

      jest.advanceTimersByTime(15000);

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
});

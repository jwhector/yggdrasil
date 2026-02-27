/**
 * Timing Engine Tests (NEW SYSTEM)
 *
 * Tests cover:
 * - Timer scheduling for auditioning and voting phases
 * - Version-check safety (stale timers ignored)
 * - Timer cancellation on phase change
 * - Paused state prevents scheduling
 * - Rotation beat tracking fires PERFORM_ROTATION_TICK
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
    type: 'foundation',
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    doubtThreshold: null,
  };
}

function makeAttemptConfig(chapter: 'ambition' | 'love' | 'avoidance'): AttemptConfig {
  return {
    chapter,
    title: chapter,
    layers: [0, 1, 2].map(i => makeLayerConfig(i)),
  };
}

function createTestConfig(): ShowConfig {
  return {
    maxLayersPerAttempt: 7,
    attempts: [
      makeAttemptConfig('ambition'),
      makeAttemptConfig('love'),
      makeAttemptConfig('avoidance'),
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

    test('version-check safety — stale timer is ignored', () => {
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

      // Timer fired but version mismatch → command NOT sent
      expect(sendCommand).not.toHaveBeenCalled();
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
  // Rotation (fallback)
  // --------------------------------------------------------------------------

  describe('rotation (fallback mode)', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        sendCommand,
        () => state,
        { enabled: true, oscBridge: null, fallbackBpm: 120 },
      );
      timingEngine.start();
    });

    test('starts rotation interval on finale_rotating', () => {
      // Setup minimal finale state
      state.phase = 'finale_rotating';
      state.finaleState = {
        chapterAssignments: new Map(),
        queue: [],
        activeSlots: Array(7).fill(null),
        trianglePositions: new Map(),
        centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
        rotationActive: true,
        rotationRate: 2,
        frozen: false,
        stewardshipLog: [],
        triangleActive: true,
      };

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_rotating',
      }]);

      // Rotation interval = 8 bars * 4 beats/bar * (60000/120) ms/beat = 16000ms
      jest.advanceTimersByTime(16000);

      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PERFORM_ROTATION_TICK' }),
      );
    });

    test('stops rotation on phase change away from finale_rotating', () => {
      state.phase = 'finale_rotating';
      state.finaleState = {
        chapterAssignments: new Map(),
        queue: [],
        activeSlots: Array(7).fill(null),
        trianglePositions: new Map(),
        centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
        rotationActive: true,
        rotationRate: 2,
        frozen: false,
        stewardshipLog: [],
        triangleActive: true,
      };

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_rotating',
      }]);

      // Change phase away
      state.phase = 'finale_frozen';
      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_frozen',
      }]);

      jest.advanceTimersByTime(32000);

      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Rotation (OSC beat events)
  // --------------------------------------------------------------------------

  describe('rotation (OSC mode)', () => {
    let oscBridge: OSCBridge;

    beforeEach(async () => {
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

    test('fires PERFORM_ROTATION_TICK after rotationBars * 4 beats', () => {
      state.phase = 'finale_rotating';
      state.finaleState = {
        chapterAssignments: new Map(),
        queue: [],
        activeSlots: Array(7).fill(null),
        trianglePositions: new Map(),
        centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
        rotationActive: true,
        rotationRate: 2,
        frozen: false,
        stewardshipLog: [],
        triangleActive: true,
      };

      timingEngine.onStateChanged(state, [{
        type: 'SHOW_PHASE_CHANGED',
        phase: 'finale_rotating',
      }]);

      // Send beats: 8 bars * 4 beats = 32 beats for rotation
      for (let i = 1; i < 32; i++) {
        timingEngine.onOSCMessage('/live/song/get/beat', [i]);
        expect(sendCommand).not.toHaveBeenCalled();
      }

      // Beat 32 should trigger rotation tick
      timingEngine.onOSCMessage('/live/song/get/beat', [32]);

      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PERFORM_ROTATION_TICK', beat: 32 }),
      );
    });

    test('unsubscribes from beat events on stop', () => {
      timingEngine.stop();

      expect(oscBridge.send).toHaveBeenCalledWith('/live/song/stop_listen/beat');
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
});

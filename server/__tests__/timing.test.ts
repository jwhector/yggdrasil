/**
 * Timing Engine Tests
 *
 * Tests cover:
 * - Timer scheduling for each phase
 * - Timer cancellation on phase change
 * - AbletonOSC beat-based audition timing
 * - Fallback mode (JS timers only)
 * - Pause/resume behavior
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTimingEngine, type TimingEngine } from '../timing';
import { createNullOSCBridge, type OSCBridge } from '../osc';
import { createInitialState } from '@/conductor/conductor';
import type { ShowState, ConductorCommand, ConductorEvent, FactionConfig } from '@/conductor/types';

// Helper to create test config
function createTestConfig() {
  const factions: FactionConfig[] = [
    { id: 0, name: 'Faction 0', color: '#ff0000' },
    { id: 1, name: 'Faction 1', color: '#00ff00' },
    { id: 2, name: 'Faction 2', color: '#0000ff' },
    { id: 3, name: 'Faction 3', color: '#ffff00' },
  ];

  return {
    rowCount: 2,
    factions,
    timing: {
      auditionLoopsPerOption: 2,
      auditionLoopsPerRow: 1,
      auditionPerOptionMs: 100, // Short for tests
      votingWindowMs: 200,
      revealDurationMs: 150,
      coupWindowMs: 100,
      masterLoopBeats: 4, // Small for tests
    },
    coup: {
      threshold: 0.5,
      multiplierBonus: 0.5,
    },
    lobby: {
      projectorContent: 'Welcome',
      audiencePrompt: 'What lives on your fig tree?',
    },
    rows: [
      {
        index: 0,
        label: 'Row 0',
        type: 'layer' as const,
        options: [
          { id: 'r0o0', index: 0, audioRef: 'audio/r0o0.wav' },
          { id: 'r0o1', index: 1, audioRef: 'audio/r0o1.wav' },
          { id: 'r0o2', index: 2, audioRef: 'audio/r0o2.wav' },
          { id: 'r0o3', index: 3, audioRef: 'audio/r0o3.wav' },
        ],
      },
      {
        index: 1,
        label: 'Row 1',
        type: 'layer' as const,
        options: [
          { id: 'r1o0', index: 0, audioRef: 'audio/r1o0.wav' },
          { id: 'r1o1', index: 1, audioRef: 'audio/r1o1.wav' },
          { id: 'r1o2', index: 2, audioRef: 'audio/r1o2.wav' },
          { id: 'r1o3', index: 3, audioRef: 'audio/r1o3.wav' },
        ],
      },
    ],
    topology: { type: 'none' as const },
  };
}

// Helper to create a state in running phase
function createRunningState(): ShowState {
  const config = createTestConfig();
  const state = createInitialState(config, 'test-show');
  state.phase = 'running';
  state.rows[0].phase = 'voting';
  return state;
}

describe('Timing Engine', () => {
  let timingEngine: TimingEngine;
  let mockSendCommand: jest.Mock<(cmd: ConductorCommand) => void>;
  let currentState: ShowState;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSendCommand = jest.fn();
    currentState = createRunningState();
  });

  afterEach(() => {
    if (timingEngine) {
      timingEngine.dispose();
    }
    jest.useRealTimers();
  });

  describe('Fallback Mode (No OSC)', () => {
    beforeEach(() => {
      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: null }
      );
      timingEngine.start();
    });

    test('schedules timer when entering voting phase', () => {
      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Timer should be scheduled but not fired yet
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Fast-forward past voting window
      jest.advanceTimersByTime(200);

      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('schedules timer when entering revealing phase', () => {
      currentState.rows[0].phase = 'revealing';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'revealing' },
      ]);

      expect(mockSendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(150);

      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('schedules timer when entering coup_window phase', () => {
      currentState.rows[0].phase = 'coup_window';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'coup_window' },
      ]);

      expect(mockSendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('does not schedule timer for committed phase', () => {
      currentState.rows[0].phase = 'committed';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'committed' },
      ]);

      jest.advanceTimersByTime(10000);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('cancels timer on phase change', () => {
      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Advance partway
      jest.advanceTimersByTime(100);
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Phase changes before timer fires
      currentState.rows[0].phase = 'revealing';
      currentState.version++;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'revealing' },
      ]);

      // Original timer should be cancelled, new one scheduled
      jest.advanceTimersByTime(100); // Would have fired original
      expect(mockSendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50); // Now fires new timer
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    test('does not fire timer if state version changed', () => {
      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Manually change version (simulates external command)
      currentState.version += 5;

      jest.advanceTimersByTime(200);

      // Timer fires but version check fails
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('does not schedule timer when paused', () => {
      currentState.phase = 'paused';
      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      jest.advanceTimersByTime(1000);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('uses fallback JS timer for auditioning phase', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Fallback uses auditionPerOptionMs * auditionLoopsPerOption = 100 * 2 = 200ms
      jest.advanceTimersByTime(199);
      expect(mockSendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });
  });

  describe('OSC Mode (Beat-Based)', () => {
    let mockOscBridge: OSCBridge;

    beforeEach(() => {
      mockOscBridge = createNullOSCBridge();
      mockOscBridge.start();

      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: mockOscBridge }
      );
      timingEngine.start();
    });

    test('does not use JS timer for audition in OSC mode', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // In OSC mode, should NOT use JS timer for audition
      jest.advanceTimersByTime(10000);
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('records start beat on first beat event and does not advance', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // First beat records start beat, should not advance
      timingEngine.onOSCMessage('/live/song/get/beat', [10]);
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('advances after masterLoopBeats beats have elapsed', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // First beat records start (beat 10)
      timingEngine.onOSCMessage('/live/song/get/beat', [10]);
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Beats 11, 12, 13 — not enough (3 < 4 masterLoopBeats)
      timingEngine.onOSCMessage('/live/song/get/beat', [11]);
      timingEngine.onOSCMessage('/live/song/get/beat', [12]);
      timingEngine.onOSCMessage('/live/song/get/beat', [13]);
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Beat 14 — 4 beats elapsed (14 - 10 = 4 >= masterLoopBeats)
      timingEngine.onOSCMessage('/live/song/get/beat', [14]);
      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('does not advance before enough beats have elapsed', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // First beat records start (beat 0)
      timingEngine.onOSCMessage('/live/song/get/beat', [0]);

      // 3 more beats (3 elapsed < 4 masterLoopBeats)
      timingEngine.onOSCMessage('/live/song/get/beat', [1]);
      timingEngine.onOSCMessage('/live/song/get/beat', [2]);
      timingEngine.onOSCMessage('/live/song/get/beat', [3]);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('ignores beat events when audition is already complete', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].auditionComplete = true;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Beat events should be ignored (audition complete → JS voting timer)
      timingEngine.onOSCMessage('/live/song/get/beat', [0]);
      timingEngine.onOSCMessage('/live/song/get/beat', [100]);

      // Voting timer should fire instead
      jest.advanceTimersByTime(200);
      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    test('uses JS timers for voting window after audition completes in OSC mode', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].auditionComplete = true;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      jest.advanceTimersByTime(200);

      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });
  });

  describe('Audition Loops Per Row', () => {
    test('fallback timer uses correct duration for single option in multi-loop row', () => {
      const config = createTestConfig();
      config.timing.auditionLoopsPerRow = 2;
      currentState = createInitialState(config, 'test-show');
      currentState.phase = 'running';
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: null }
      );
      timingEngine.start();

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Each option still takes auditionPerOptionMs * auditionLoopsPerOption
      // (100ms * 2 = 200ms per option, regardless of row loops)
      jest.advanceTimersByTime(199);
      expect(mockSendCommand).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('OSC mode uses beat counting for multi-loop audition', () => {
      const config = createTestConfig();
      config.timing.auditionLoopsPerRow = 2;
      currentState = createInitialState(config, 'test-show');
      currentState.phase = 'running';
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 4;  // Loop 2, option 0

      const mockOscBridge = createNullOSCBridge();
      mockOscBridge.start();

      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: mockOscBridge }
      );
      timingEngine.start();

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // First beat records start
      timingEngine.onOSCMessage('/live/song/get/beat', [50]);
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Master loop complete (4 beats)
      timingEngine.onOSCMessage('/live/song/get/beat', [54]);
      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });
  });

  describe('Lifecycle', () => {
    test('does not schedule timers when disabled', () => {
      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: false, oscBridge: null }
      );
      timingEngine.start();

      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      jest.advanceTimersByTime(1000);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('stop cancels all timers', () => {
      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: null }
      );
      timingEngine.start();

      currentState.rows[0].phase = 'voting';

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      timingEngine.stop();

      jest.advanceTimersByTime(1000);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('isRunning returns correct state', () => {
      timingEngine = createTimingEngine(
        mockSendCommand,
        () => currentState,
        { enabled: true, oscBridge: null }
      );

      expect(timingEngine.isRunning()).toBe(false);

      timingEngine.start();
      expect(timingEngine.isRunning()).toBe(true);

      timingEngine.stop();
      expect(timingEngine.isRunning()).toBe(false);
    });
  });
});

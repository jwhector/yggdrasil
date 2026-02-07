/**
 * Timing Engine Tests
 *
 * Tests cover:
 * - Timer scheduling for each phase
 * - Timer cancellation on phase change
 * - Ableton OSC message handling
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

  describe('OSC Mode', () => {
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

    test('waits for Ableton audition_done in OSC mode', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // In OSC mode, should NOT use JS timer for audition
      jest.advanceTimersByTime(1000);
      expect(mockSendCommand).not.toHaveBeenCalled();

      // Simulate Ableton sending audition_done
      timingEngine.onOSCMessage('/ableton/audition/done', [0, 0]);

      expect(mockSendCommand).toHaveBeenCalledWith({ type: 'ADVANCE_PHASE' });
    });

    test('ignores audition_done for wrong row', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Wrong row index
      timingEngine.onOSCMessage('/ableton/audition/done', [1, 0]);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('ignores audition_done for wrong option', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].currentAuditionIndex = 0;

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Wrong option index
      timingEngine.onOSCMessage('/ableton/audition/done', [0, 1]);

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('ignores audition_done when audition is already complete', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].auditionComplete = true; // Audition already complete

      timingEngine.onStateChanged(currentState, [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
      ]);

      // Send audition_done after audition complete
      timingEngine.onOSCMessage('/ableton/audition/done', [0, 0]);

      // Should not advance
      jest.advanceTimersByTime(100);
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    test('uses JS timers for voting window after audition completes in OSC mode', () => {
      currentState.rows[0].phase = 'voting';
      currentState.rows[0].auditionComplete = true; // Audition complete, now in voting window

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

    test('OSC mode validates against option index modulo 4', () => {
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

      // Ableton sends optionIndex=0 (correct for raw index 4 % 4 = 0)
      timingEngine.onOSCMessage('/ableton/audition/done', [0, 0]);
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

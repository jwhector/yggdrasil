/**
 * Audio Router Tests (NEW SYSTEM)
 *
 * Tests that AUDIO_CUE events are correctly translated to AbletonOSC messages.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createAudioRouter, computeTrackIndex, type AudioRouter, type AbletonLayoutConfig } from '../audio-router';
import { createNullOSCBridge, type OSCBridge } from '../osc';
import { createInitialState } from '../../conductor/conductor';
import type {
  ShowState,
  ShowConfig,
  AttemptConfig,
  LayerConfig,
  AudioReference,
  Fragment,
} from '../../conductor/types';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_LAYOUT: AbletonLayoutConfig = {
  maxLayersPerAttempt: 7,
  attemptCount: 3,
  collapseReturnTrackIndex: 0,
  finaleSlotCount: 7,
};

function makeAudioRef(index: number, effectIndices?: number[]): AudioReference {
  return effectIndices ? { trackIndex: index, effectIndices } : { trackIndex: index };
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
      beatsPerLoop: 32,
      auditionsPerLayer: 2,
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

function makeFragment(attemptIndex: number, layerIndex: number, option: 'A' | 'B'): Fragment {
  const trackIndex = computeTrackIndex(attemptIndex, layerIndex, option, 7);
  return {
    id: `frag-${attemptIndex}-${layerIndex}-${option}`,
    attemptIndex,
    layerIndex,
    option,
    chapter: 'ambition',
    layerType: 'foundation',
    displayName: `Fragment ${attemptIndex}.${layerIndex}.${option}`,
    audioRef: { trackIndex },
    safeParameter: {
      name: 'intensity',
      displayLabel: 'Intensity',
      abletonMapping: { trackIndex, deviceIndex: 0, paramIndex: 1 },
      min: 0.1,
      max: 0.9,
      defaultValue: 0.5,
      smoothingMs: 50,
    },
  };
}

/** Helper to send a single AUDIO_CUE event through the router */
function sendCue(router: AudioRouter, state: ShowState, cue: any): void {
  router.handleStateChange(state, [{ type: 'AUDIO_CUE', cue }]);
}

// ============================================================================
// Tests
// ============================================================================

describe('computeTrackIndex', () => {
  test('attempt 0, layer 0, option A = 0', () => {
    expect(computeTrackIndex(0, 0, 'A', 7)).toBe(0);
  });

  test('attempt 0, layer 0, option B = 1', () => {
    expect(computeTrackIndex(0, 0, 'B', 7)).toBe(1);
  });

  test('attempt 0, layer 2, option B = 5', () => {
    expect(computeTrackIndex(0, 2, 'B', 7)).toBe(5);
  });

  test('attempt 1, layer 0, option A = 14', () => {
    expect(computeTrackIndex(1, 0, 'A', 7)).toBe(14);
  });

  test('attempt 2, layer 6, option B = 41', () => {
    expect(computeTrackIndex(2, 6, 'B', 7)).toBe(41);
  });

  test('attempt 1, layer 3, option A = 20', () => {
    expect(computeTrackIndex(1, 3, 'A', 7)).toBe(20);
  });
});

describe('AudioRouter', () => {
  let oscBridge: OSCBridge;
  let mockSend: jest.Mock;
  let router: AudioRouter;
  let state: ShowState;

  beforeEach(() => {
    oscBridge = createNullOSCBridge();
    mockSend = jest.fn();
    oscBridge.send = mockSend;
    router = createAudioRouter(oscBridge, TEST_LAYOUT);
    state = createTestState();
  });

  afterEach(() => {
    router.dispose();
  });

  // --------------------------------------------------------------------------
  // audition_start — track-only options
  // --------------------------------------------------------------------------

  describe('audition_start (track-only)', () => {
    test('starts transport on first audition', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/song/start_playing');
    });

    test('unmutes the specified option track', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0);
    });

    test('mutes the other option track and unmutes this one', () => {
      // First unmute A
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      // Now audition B — should mute A first
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'B',
        audioRef: makeAudioRef(1),
        otherAudioRef: makeAudioRef(0),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1); // mute A
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 0); // unmute B
    });

    test('does not start transport again on subsequent calls', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 1, option: 'A',
        audioRef: makeAudioRef(2),
        otherAudioRef: makeAudioRef(3),
      });

      expect(mockSend).not.toHaveBeenCalledWith('/live/song/start_playing');
    });
  });

  // --------------------------------------------------------------------------
  // audition_start — effect-based options
  // --------------------------------------------------------------------------

  describe('audition_start (effect-based)', () => {
    test('enables effects on this option', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0, [2, 3]),
        otherAudioRef: makeAudioRef(1, [4, 5]),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 2, 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 3, 0, 1);
    });

    test('disables effects on the other option', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0, [2, 3]),
        otherAudioRef: makeAudioRef(1, [4, 5]),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 4, 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 5, 0, 0);
    });

    test('does not mute/unmute track when both options share the same track', () => {
      // First audition option A (same track 5) to establish state, then switch to B
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(5, [1]),
        otherAudioRef: makeAudioRef(5, [2]),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'B',
        audioRef: makeAudioRef(5, [2]),
        otherAudioRef: makeAudioRef(5, [1]),
      });

      // No track mute/unmute for the shared track — only effect toggling
      const trackCalls = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/track/set/mute' && c[1] === 5,
      );
      expect(trackCalls.length).toBe(0);

      // Effects are toggled
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 5, 1, 0, 0); // disable A's effect
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 5, 2, 0, 1); // enable B's effect
    });

    test('still mutes/unmutes tracks when options are on different tracks', () => {
      // First unmute B's track (track 2) so the mute call will fire when switching to A
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'B',
        audioRef: makeAudioRef(2, [3]),
        otherAudioRef: makeAudioRef(0, [1]),
      });
      mockSend.mockClear();

      // Switch to A — should mute track 2 and unmute track 0
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0, [1]),
        otherAudioRef: makeAudioRef(2, [3]),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 2, 1); // mute other track
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0); // unmute this track
    });

    test('handles multiple effects per option', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'B',
        audioRef: makeAudioRef(1, [0, 1, 2]),
        otherAudioRef: makeAudioRef(0),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 0, 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 1, 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 2, 0, 1);
    });

    test('no device calls when neither option has effects', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });

      const deviceCalls = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/device/set/parameter/value',
      );
      expect(deviceCalls.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // audition_stop
  // --------------------------------------------------------------------------

  describe('audition_stop', () => {
    test('mutes the specified track', () => {
      // First unmute it
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'audition_stop', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
    });

    test('disables effects when stopping an effect option', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0, [3, 4]),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'audition_stop', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0, [3, 4]),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 3, 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 4, 0, 0);
    });

    test('stops playback when option is null (no audioRef)', () => {
      sendCue(router, state, {
        type: 'audition_stop', attemptIndex: 0, layerIndex: 0, option: null,
      });

      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });

    test('is idempotent — muting already-muted track sends no OSC', () => {
      // Track 0 was never unmuted
      sendCue(router, state, {
        type: 'audition_stop', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
      });

      expect(mockSend).not.toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      // But still stops playback
      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });
  });

  // --------------------------------------------------------------------------
  // lock_in
  // --------------------------------------------------------------------------

  describe('lock_in (track-only)', () => {
    test('unmutes winner and mutes loser', () => {
      // Setup: audition B so it's unmuted
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'B',
        audioRef: makeAudioRef(1),
        otherAudioRef: makeAudioRef(0),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 0, winner: 'A',
        winnerAudioRef: makeAudioRef(0),
        loserAudioRef: makeAudioRef(1),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0); // unmute A (winner)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 1); // mute B (loser)
    });

    test('previously locked layers stay unmuted (stacking)', () => {
      // Lock layer 0 with winner A
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 0, winner: 'A',
        winnerAudioRef: makeAudioRef(0),
        loserAudioRef: makeAudioRef(1),
      });

      // Audition layer 1 option A first, then lock in A
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 1, option: 'A',
        audioRef: makeAudioRef(2),
        otherAudioRef: makeAudioRef(3),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 1, winner: 'A',
        winnerAudioRef: makeAudioRef(2),
        loserAudioRef: makeAudioRef(3),
      });

      // Layer 0 track (track 0) must NOT be mentioned — still unmuted
      expect(mockSend).not.toHaveBeenCalledWith('/live/track/set/mute', 0, expect.anything());
      // Track 1 (layer 0 B) also not mentioned
      expect(mockSend).not.toHaveBeenCalledWith('/live/track/set/mute', 1, expect.anything());
    });
  });

  describe('lock_in (effect-based)', () => {
    test('enables winner effects and disables loser effects', () => {
      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 0, winner: 'A',
        winnerAudioRef: makeAudioRef(0, [2, 3]),
        loserAudioRef: makeAudioRef(1, [4, 5]),
      });

      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 2, 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 0, 3, 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 4, 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 1, 5, 0, 0);
    });

    test('does not mute loser track when winner and loser share the same track', () => {
      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 0, winner: 'A',
        winnerAudioRef: makeAudioRef(5, [1]),
        loserAudioRef: makeAudioRef(5, [2]),
      });

      // Track 5 unmuted for winner, but NOT muted for loser (same track)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 5, 0); // unmute winner's track
      const muteCalls = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/track/set/mute' && c[1] === 5 && c[2] === 1,
      );
      expect(muteCalls.length).toBe(0);

      // Effects toggled correctly
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 5, 1, 0, 1); // enable winner effect
      expect(mockSend).toHaveBeenCalledWith('/live/device/set/parameter/value', 5, 2, 0, 0); // disable loser effect
    });
  });

  // --------------------------------------------------------------------------
  // collapse_gesture
  // --------------------------------------------------------------------------

  describe('collapse_gesture', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('enables return track effects immediately', () => {
      sendCue(router, state, {
        type: 'collapse_gesture', attemptIndex: 0,
      });

      expect(mockSend).toHaveBeenCalledWith('/live/return/set/mute', 0, 0);
    });

    test('mutes all attempt tracks after collapseAnimationMs', () => {
      // Unmute some tracks first
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      sendCue(router, state, {
        type: 'lock_in', attemptIndex: 0, layerIndex: 0, winner: 'A',
        winnerAudioRef: makeAudioRef(0),
        loserAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'collapse_gesture', attemptIndex: 0,
      });

      // Before timer fires: only return track unmuted
      expect(mockSend).toHaveBeenCalledWith('/live/return/set/mute', 0, 0);
      const muteCallsBefore = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/track/set/mute' && c[2] === 1,
      );
      expect(muteCallsBefore.length).toBe(0);

      mockSend.mockClear();

      // Advance timer (collapseAnimationMs = 3000)
      jest.advanceTimersByTime(3000);

      // Track 0 was unmuted, so it should be muted
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      // Return track re-muted
      expect(mockSend).toHaveBeenCalledWith('/live/return/set/mute', 0, 1);
    });
  });

  // --------------------------------------------------------------------------
  // slot_activate / slot_deactivate
  // --------------------------------------------------------------------------

  describe('slot_activate', () => {
    test('unmutes fragment track and starts transport', () => {
      const fragment = makeFragment(0, 2, 'B'); // track 5

      sendCue(router, state, {
        type: 'slot_activate', slotIndex: 0, fragment,
      });

      expect(mockSend).toHaveBeenCalledWith('/live/song/start_playing');
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 5, 0);
    });
  });

  describe('slot_deactivate', () => {
    test('mutes the track that was activated for this slot', () => {
      const fragment = makeFragment(0, 2, 'B'); // track 5

      // Activate then deactivate
      sendCue(router, state, {
        type: 'slot_activate', slotIndex: 3, fragment,
      });
      mockSend.mockClear();

      sendCue(router, state, {
        type: 'slot_deactivate', slotIndex: 3,
      });

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 5, 1);
    });

    test('does nothing if slot was never activated', () => {
      sendCue(router, state, {
        type: 'slot_deactivate', slotIndex: 5,
      });

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // steward_param
  // --------------------------------------------------------------------------

  describe('steward_param', () => {
    test('sends device parameter value to correct Ableton mapping', () => {
      const fragment = makeFragment(1, 0, 'A'); // track 14

      // Set up finale state with an active slot
      state.finaleState = {
        chapterAssignments: new Map(),
        queue: [],
        activeSlots: Array(7).fill(null),
        trianglePositions: new Map(),
        centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
        rotationActive: false,
        rotationRate: 2,
        frozen: false,
        stewardshipLog: [],
        triangleActive: true,
      };
      state.finaleState.activeSlots[2] = {
        slotIndex: 2,
        fragment,
        stewardUserId: 'user-1',
        parameterValue: 0.5,
        activatedAtBeat: 0,
        energyLevel: 0,
      };

      sendCue(router, state, {
        type: 'steward_param', slotIndex: 2, value: 0.7,
      });

      expect(mockSend).toHaveBeenCalledWith(
        '/live/device/set/parameter/value',
        14, // trackIndex from abletonMapping
        0,  // deviceIndex
        1,  // paramIndex
        0.7,
      );
    });

    test('does nothing if slot is empty', () => {
      state.finaleState = {
        chapterAssignments: new Map(),
        queue: [],
        activeSlots: Array(7).fill(null),
        trianglePositions: new Map(),
        centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
        rotationActive: false,
        rotationRate: 2,
        frozen: false,
        stewardshipLog: [],
        triangleActive: true,
      };

      sendCue(router, state, {
        type: 'steward_param', slotIndex: 2, value: 0.7,
      });

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // transport
  // --------------------------------------------------------------------------

  describe('transport', () => {
    test('play sends start_playing', () => {
      sendCue(router, state, { type: 'transport', action: 'play' });

      expect(mockSend).toHaveBeenCalledWith('/live/song/start_playing');
    });

    test('stop sends stop_playing', () => {
      sendCue(router, state, { type: 'transport', action: 'stop' });

      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });
  });

  // --------------------------------------------------------------------------
  // panic
  // --------------------------------------------------------------------------

  describe('panic', () => {
    test('mutes all 42 tracks', () => {
      sendCue(router, state, { type: 'panic' });

      const muteCalls = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/track/set/mute' && c[2] === 1,
      );
      expect(muteCalls.length).toBe(42); // 3 * 7 * 2
    });
  });

  // --------------------------------------------------------------------------
  // Non-AudioCue events
  // --------------------------------------------------------------------------

  describe('SHOW_RESET', () => {
    test('mutes all tracks, stops transport, clears state', () => {
      // Set up some state
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      router.handleStateChange(state, [
        { type: 'SHOW_RESET', preservedUsers: false },
      ]);

      // All 42 tracks muted
      const muteCalls = mockSend.mock.calls.filter(
        (c: any[]) => c[0] === '/live/track/set/mute' && c[2] === 1,
      );
      expect(muteCalls.length).toBe(42);

      // Transport stopped
      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });
  });

  describe('PAUSED', () => {
    test('stops transport', () => {
      router.handleStateChange(state, [{ type: 'PAUSED' }]);

      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });
  });

  describe('RESUMED', () => {
    test('continues transport', () => {
      router.handleStateChange(state, [{ type: 'RESUMED' }]);

      expect(mockSend).toHaveBeenCalledWith('/live/song/continue_playing');
    });
  });

  // --------------------------------------------------------------------------
  // Idempotency
  // --------------------------------------------------------------------------

  describe('idempotency', () => {
    test('unmuting an already-unmuted track does not send duplicate OSC', () => {
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });
      mockSend.mockClear();

      // Try to unmute track 0 again via another audition_start
      sendCue(router, state, {
        type: 'audition_start', attemptIndex: 0, layerIndex: 0, option: 'A',
        audioRef: makeAudioRef(0),
        otherAudioRef: makeAudioRef(1),
      });

      // No unmute call for track 0 (already unmuted)
      expect(mockSend).not.toHaveBeenCalledWith('/live/track/set/mute', 0, 0);
    });
  });
});

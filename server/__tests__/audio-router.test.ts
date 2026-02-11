/**
 * Audio Router Tests - AbletonOSC Protocol
 */

import { createAudioRouter } from '../audio-router';
import { createNullOSCBridge } from '../osc';
import type { ShowState, ConductorEvent, AudioCue } from '../../conductor/types';

describe('AudioRouter with AbletonOSC', () => {
  let mockSend: jest.Mock;
  let oscBridge: ReturnType<typeof createNullOSCBridge>;
  let router: ReturnType<typeof createAudioRouter>;
  let mockState: ShowState;

  beforeEach(() => {
    // Create a null OSC bridge and spy on its send method
    oscBridge = createNullOSCBridge();
    mockSend = jest.fn();
    oscBridge.send = mockSend;

    // Create the audio router
    router = createAudioRouter(oscBridge);

    // Create a minimal mock state
    mockState = {
      id: 'test-show',
      phase: 'running',
      currentRowIndex: 0,
      rows: [
        {
          index: 0,
          options: [
            { id: 'row0-opt0', index: 0, audioRef: 'row0/option0' },
            { id: 'row0-opt1', index: 1, audioRef: 'row0/option1' },
            { id: 'row0-opt2', index: 2, audioRef: 'row0/option2' },
            { id: 'row0-opt3', index: 3, audioRef: 'row0/option3' },
          ],
          phase: 'voting',
          committedOption: null,
          attempts: 0,
          currentAuditionIndex: 0,
          auditionComplete: false,
        },
        {
          index: 1,
          options: [
            { id: 'row1-opt0', index: 0, audioRef: 'row1/option0' },
            { id: 'row1-opt1', index: 1, audioRef: 'row1/option1' },
            { id: 'row1-opt2', index: 2, audioRef: 'row1/option2' },
            { id: 'row1-opt3', index: 3, audioRef: 'row1/option3' },
          ],
          phase: 'pending',
          committedOption: null,
          attempts: 0,
          currentAuditionIndex: null,
          auditionComplete: false,
        },
        {
          index: 2,
          options: [
            { id: 'row2-opt0', index: 0, audioRef: 'row2/option0' },
            { id: 'row2-opt1', index: 1, audioRef: 'row2/option1' },
            { id: 'row2-opt2', index: 2, audioRef: 'row2/option2' },
            { id: 'row2-opt3', index: 3, audioRef: 'row2/option3' },
          ],
          phase: 'pending',
          committedOption: null,
          attempts: 0,
          currentAuditionIndex: null,
          auditionComplete: false,
        },
      ],
      factions: [
        { id: 0, coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 1, coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 2, coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 3, coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
      ],
      users: new Map(),
      votes: [],
      personalTrees: new Map(),
      config: {} as any,
      version: 1,
      lastUpdated: Date.now(),
      pausedPhase: null,
    } as ShowState;
  });

  afterEach(() => {
    router.dispose();
  });

  describe('trackIndex utility', () => {
    test('row 0, option 0 => track 0', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Should fire all 4 clips and unmute track 0
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0);
    });

    test('row 0, option 3 => track 3', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt3' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 3, 0);
    });

    test('row 1, option 0 => track 4', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 1, optionId: 'row1-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 4, 0);
    });

    test('row 2, option 3 => track 11', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 2, optionId: 'row2-opt3' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 11, 0);
    });
  });

  describe('play_option cue', () => {
    test('fires all 4 clips for a row on first audition and unmutes active option', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Should mute all 4 tracks first
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 2, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 3, 1);

      // Should fire all 4 clips at slot 0
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 1, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 2, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 3, 0);

      // Should unmute the active option (track 0)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0);
    });

    test('on subsequent options, mutes previous and unmutes new', () => {
      // First play option 0
      const cue1: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue1 }]);

      mockSend.mockClear();

      // Then play option 1
      const cue2: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt1' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue2 }]);

      // Should mute previous track (0)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      // Should unmute new track (1)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 0);
      // Should NOT fire clips again (already fired on first audition)
      expect(mockSend).not.toHaveBeenCalledWith('/live/clip/fire', 0, 0);
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = { type: 'play_option', optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('does not send if optionId is missing', () => {
      const cue: AudioCue = { type: 'play_option', rowIndex: 0 };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('stop_option cue', () => {
    test('mutes the option track', () => {
      const cue: AudioCue = { type: 'stop_option', rowIndex: 0, optionId: 'row0-opt1' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = { type: 'stop_option', optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('commit_layer cue', () => {
    test('unmutes winner and mutes others for the row', () => {
      const cue: AudioCue = { type: 'commit_layer', rowIndex: 0, optionId: 'row0-opt2' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Track 2 (winner) should be unmuted
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 2, 0);
      // Tracks 0, 1, 3 (losers) should be muted
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 3, 1);

      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    test('committed layers from previous rows remain unmuted', () => {
      // Commit row 0 option 0
      const cue1: AudioCue = { type: 'commit_layer', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue1 }]);

      mockSend.mockClear();

      // Commit row 1 option 2
      const cue2: AudioCue = { type: 'commit_layer', rowIndex: 1, optionId: 'row1-opt2' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue2 }]);

      // Should only affect row 1 tracks (4-7), not row 0 tracks (0-3)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 4, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 5, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 6, 0); // Winner
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 7, 1);

      // Should NOT call track 0 (row 0)
      expect(mockSend).not.toHaveBeenCalledWith('/live/track/set/mute', 0, expect.anything());
    });

    test('does not send if optionId is missing', () => {
      const cue: AudioCue = { type: 'commit_layer', rowIndex: 0 };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('uncommit_layer cue (coup)', () => {
    test('mutes and stops all 4 tracks for the row', () => {
      const cue: AudioCue = { type: 'uncommit_layer', rowIndex: 0 };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Should mute all 4 tracks
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 2, 1);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 3, 1);

      // Should stop all 4 clips
      expect(mockSend).toHaveBeenCalledWith('/live/clip/stop', 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/stop', 1, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/stop', 2, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/stop', 3, 0);

      expect(mockSend).toHaveBeenCalledTimes(8);
    });

    test('clears fired state so clips are re-fired on next audition', () => {
      // First audition to fire clips
      const playCue: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue: playCue }]);

      mockSend.mockClear();

      // Uncommit
      const uncommitCue: AudioCue = { type: 'uncommit_layer', rowIndex: 0 };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue: uncommitCue }]);

      mockSend.mockClear();

      // Play again - should re-fire clips
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue: playCue }]);

      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 1, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 2, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 3, 0);
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = { type: 'uncommit_layer' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('play_timeline cue (finale)', () => {
    test('mutes all current tracks and unmutes path tracks', () => {
      // Set up some unmuted tracks first
      const setupCue: AudioCue = { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue: setupCue }]);

      mockSend.mockClear();

      // Play timeline
      const cue: AudioCue = {
        type: 'play_timeline',
        path: ['row0-opt1', 'row1-opt2', 'row2-opt0'],
      };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Should mute track 0 (was unmuted from setup)
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);

      // Should fire and unmute tracks for path: 1 (row0-opt1), 6 (row1-opt2), 8 (row2-opt0)
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 1, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 0);

      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 6, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 6, 0);

      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 8, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 8, 0);
    });

    test('fires clips for tracks not previously fired', () => {
      const cue: AudioCue = {
        type: 'play_timeline',
        path: ['row0-opt0', 'row1-opt1'],
      };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      // Should fire both clips since neither was fired before
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 5, 0);
    });

    test('does not send if path is missing', () => {
      const cue: AudioCue = { type: 'play_timeline' };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('handles empty path array', () => {
      const cue: AudioCue = { type: 'play_timeline', path: [] };
      router.handleStateChange(mockState, [{ type: 'AUDIO_CUE', cue }]);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('SHOW_PHASE_CHANGED event', () => {
    test('entering paused phase sends /live/song/stop_playing', () => {
      const events: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('resuming from paused sends /live/song/continue_playing', () => {
      // First pause
      const pauseEvents: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, pauseEvents);

      mockSend.mockClear();

      // Then resume
      const resumeEvents: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'running' },
      ];
      router.handleStateChange(mockState, resumeEvents);

      expect(mockSend).toHaveBeenCalledWith('/live/song/continue_playing');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('changing from running to finale does not send pause or resume', () => {
      mockState.phase = 'running';
      const events: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'finale' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('entering running phase initially does not send resume', () => {
      const events: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'running' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('multiple events', () => {
    test('handles multiple AUDIO_CUE events in sequence', () => {
      const events: ConductorEvent[] = [
        { type: 'AUDIO_CUE', cue: { type: 'play_option', rowIndex: 0, optionId: 'row0-opt0' } },
        { type: 'AUDIO_CUE', cue: { type: 'stop_option', rowIndex: 0, optionId: 'row0-opt0' } },
        { type: 'AUDIO_CUE', cue: { type: 'commit_layer', rowIndex: 0, optionId: 'row0-opt1' } },
      ];
      router.handleStateChange(mockState, events);

      // First cue fires 4 clips + mutes + unmutes
      expect(mockSend).toHaveBeenCalledWith('/live/clip/fire', 0, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 0);

      // Second cue mutes track 0
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 0, 1);

      // Third cue sets final mute states
      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 1, 0);
    });

    test('handles audio cue and phase change together', () => {
      const events: ConductorEvent[] = [
        { type: 'AUDIO_CUE', cue: { type: 'commit_layer', rowIndex: 0, optionId: 'row0-opt2' } },
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/live/track/set/mute', 2, 0);
      expect(mockSend).toHaveBeenCalledWith('/live/song/stop_playing');
    });
  });

  describe('non-audio events', () => {
    test('ignores non-AUDIO_CUE and non-SHOW_PHASE_CHANGED events', () => {
      const events: ConductorEvent[] = [
        { type: 'ROW_PHASE_CHANGED', row: 0, phase: 'voting' },
        { type: 'VOTE_RECEIVED', userId: 'user-1', row: 0 },
        { type: 'AUDITION_COMPLETE', row: 0 },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('handles empty events array', () => {
      const events: ConductorEvent[] = [];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    test('dispose clears internal state', () => {
      // Pause to set internal state
      const pauseEvents: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, pauseEvents);

      // Dispose
      router.dispose();
      mockSend.mockClear();

      // Try to resume - should not send resume since state was cleared
      const resumeEvents: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'running' },
      ];
      router.handleStateChange(mockState, resumeEvents);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});

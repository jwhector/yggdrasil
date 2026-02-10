/**
 * Audio Router Tests
 */

import { createAudioRouter } from '../audio-router';
import { createNullOSCBridge } from '../osc';
import type { ShowState, ConductorEvent, AudioCue } from '../../conductor/types';

describe('AudioRouter', () => {
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

  describe('play_option cue', () => {
    test('sends /ygg/audition/start with correct arguments', () => {
      const cue: AudioCue = {
        type: 'play_option',
        rowIndex: 0,
        optionId: 'row0-opt2',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/audition/start', 0, 2, 'row0-opt2');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('handles option at index 0', () => {
      const cue: AudioCue = {
        type: 'play_option',
        rowIndex: 0,
        optionId: 'row0-opt0',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/audition/start', 0, 0, 'row0-opt0');
    });

    test('handles option at index 3', () => {
      const cue: AudioCue = {
        type: 'play_option',
        rowIndex: 0,
        optionId: 'row0-opt3',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/audition/start', 0, 3, 'row0-opt3');
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = {
        type: 'play_option',
        optionId: 'row0-opt0',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('does not send if optionId is missing', () => {
      const cue: AudioCue = {
        type: 'play_option',
        rowIndex: 0,
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('stop_option cue', () => {
    test('sends /ygg/audition/stop with correct arguments', () => {
      const cue: AudioCue = {
        type: 'stop_option',
        rowIndex: 0,
        optionId: 'row0-opt1',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/audition/stop', 0, 1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = {
        type: 'stop_option',
        optionId: 'row0-opt0',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('commit_layer cue', () => {
    test('sends /ygg/layer/commit with rowIndex and optionId', () => {
      const cue: AudioCue = {
        type: 'commit_layer',
        rowIndex: 0,
        optionId: 'row0-opt2',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/layer/commit', 0, 'row0-opt2');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('does not send if optionId is missing', () => {
      const cue: AudioCue = {
        type: 'commit_layer',
        rowIndex: 0,
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('uncommit_layer cue', () => {
    test('sends /ygg/layer/uncommit with rowIndex', () => {
      const cue: AudioCue = {
        type: 'uncommit_layer',
        rowIndex: 0,
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/layer/uncommit', 0);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('does not send if rowIndex is missing', () => {
      const cue: AudioCue = {
        type: 'uncommit_layer',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('play_timeline cue', () => {
    test('without userId sends /ygg/finale/popular', () => {
      const cue: AudioCue = {
        type: 'play_timeline',
        path: ['row0-opt0', 'row1-opt2', 'row2-opt1'],
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/finale/popular', 'row0-opt0,row1-opt2,row2-opt1');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('with userId sends /ygg/finale/timeline', () => {
      const cue: AudioCue = {
        type: 'play_timeline',
        userId: 'user-123',
        path: ['row0-opt1', 'row1-opt0', 'row2-opt3'],
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/finale/timeline', 'user-123', 'row0-opt1,row1-opt0,row2-opt3');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('does not send if path is missing', () => {
      const cue: AudioCue = {
        type: 'play_timeline',
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).not.toHaveBeenCalled();
    });

    test('handles empty path array', () => {
      const cue: AudioCue = {
        type: 'play_timeline',
        path: [],
      };

      const events: ConductorEvent[] = [{ type: 'AUDIO_CUE', cue }];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/finale/popular', '');
    });
  });

  describe('SHOW_PHASE_CHANGED event', () => {
    test('entering paused phase sends /ygg/show/pause', () => {
      const events: ConductorEvent[] = [
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledWith('/ygg/show/pause');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('resuming from paused sends /ygg/show/resume', () => {
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

      expect(mockSend).toHaveBeenCalledWith('/ygg/show/resume');
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

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend).toHaveBeenNthCalledWith(1, '/ygg/audition/start', 0, 0, 'row0-opt0');
      expect(mockSend).toHaveBeenNthCalledWith(2, '/ygg/audition/stop', 0, 0);
      expect(mockSend).toHaveBeenNthCalledWith(3, '/ygg/layer/commit', 0, 'row0-opt1');
    });

    test('handles audio cue and phase change together', () => {
      const events: ConductorEvent[] = [
        { type: 'AUDIO_CUE', cue: { type: 'commit_layer', rowIndex: 0, optionId: 'row0-opt2' } },
        { type: 'SHOW_PHASE_CHANGED', phase: 'paused' },
      ];
      router.handleStateChange(mockState, events);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledWith('/ygg/layer/commit', 0, 'row0-opt2');
      expect(mockSend).toHaveBeenCalledWith('/ygg/show/pause');
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

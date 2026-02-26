/**
 * Audio Router - Maps Conductor Events to AbletonOSC Messages
 *
 * Translates AUDIO_CUE events from the conductor into OSC messages for Ableton Live
 * using the AbletonOSC plugin (ideoforms).
 *
 * This is the single source of truth for audio command routing.
 * The timing engine handles scheduling but does NOT send audio OSC messages.
 * The audio router handles ALL outbound audio OSC messages.
 *
 * Track Layout (shared by both modes):
 * - optionsPerRow * rowCount tracks total (optionsPerRow per row)
 * - Track index = rowIndex * optionsPerRow + optionIndex
 * - Row 0: tracks 0-(optionsPerRow-1), Row 1: tracks optionsPerRow-(optionsPerRow*2-1), etc.
 * - Audition via mute/unmute (smooth transitions, no stop/start glitches)
 * - Layering: each row has its own tracks, committed clips keep playing
 *
 * Playback Modes (mutually exclusive, set via ShowConfig.playbackMode):
 * - Session View ('session', default): Fires clips at slot 0 (scene 0) per row.
 *   Tracks which clips have been fired via firedTracks set.
 *   Ableton ignores arrangement view when session clips are fired.
 * - Arrangement View ('arrangement'): Uses global transport (start/stop).
 *   No clips are ever fired. Tracks whether transport has been started.
 */

import type { OSCBridge } from './osc';
import type { ShowState, ConductorEvent, ShowPhase, PlaybackMode } from '../conductor/types';

/**
 * Audio router interface
 */
export interface AudioRouter {
  /** Process state change events, routing audio cues to OSC */
  handleStateChange(state: ShowState, events: ConductorEvent[]): void;
  /** Dispose of resources */
  dispose(): void;
}

/**
 * Internal state tracking for the audio router
 */
interface AudioRouterState {
  lastKnownPhase: ShowPhase | null;
  /** Set of track indices with clips currently fired — session mode only */
  firedTracks: Set<number>;
  /** Set of track indices currently unmuted (audible) */
  unmutedTracks: Set<number>;
  /** Whether the global transport has been started — arrangement mode only */
  transportStarted: boolean;
}

/**
 * Calculate Ableton track index from row and option indices.
 * Layout: optionsPerRow * rowCount tracks, optionsPerRow per row, grouped sequentially.
 * Row 0: tracks 0-(optionsPerRow-1), Row 1: tracks optionsPerRow-(optionsPerRow*2-1), etc.
 */
function trackIndex(optionsPerRow: number, rowIndex: number, optionIndex: number): number {
  return rowIndex * optionsPerRow + optionIndex;
}

function stopAllTracks(oscBridge: OSCBridge): void {
  function onNumTracks(numTracks: number): void {
    for (let i = 0; i < numTracks; i++) {
      oscBridge.send('/live/track/set/mute', i, 1);
    }
  }
  oscBridge.once('/live/song/get/num_tracks', onNumTracks);
  oscBridge.send('/live/song/get/num_tracks');
}

/**
 * Create an audio router that translates conductor events to AbletonOSC messages
 *
 * @param oscBridge - OSC bridge for sending messages to Ableton
 * @param playbackMode - 'session' for clip-based (default) or 'arrangement' for transport-based
 * @returns AudioRouter instance
 */
export function createAudioRouter(oscBridge: OSCBridge, playbackMode: PlaybackMode = 'session'): AudioRouter {
  // Internal state tracking
  const routerState: AudioRouterState = {
    lastKnownPhase: null,
    firedTracks: new Set<number>(),
    unmutedTracks: new Set<number>(),
    transportStarted: false,
  };

  /**
   * Mute all currently-unmuted tracks for a given row
   */
  function muteRowTracks(state: ShowState, rowIndex: number): void {
    for (let i = 0; i < state.config.optionsPerRow; i++) {
      const trk = trackIndex(state.config.optionsPerRow, rowIndex, i);
      if (routerState.unmutedTracks.has(trk)) {
        oscBridge.send('/live/track/set/mute', trk, 1);
        routerState.unmutedTracks.delete(trk);
      }
    }
  }

  /**
   * Handle state changes - called after every command is processed
   */
  function handleStateChange(state: ShowState, events: ConductorEvent[]): void {
    for (const event of events) {
      // Handle audio cues
      if (event.type === 'AUDIO_CUE') {
        const cue = event.cue;

        switch (cue.type) {
          case 'play_option': {
            if (cue.rowIndex === undefined || !cue.optionId) break;

            const row = state.rows[cue.rowIndex];
            const optionIdx = row?.options.findIndex(o => o.id === cue.optionId) ?? 0;
            const newTrack = trackIndex(state.config.optionsPerRow, cue.rowIndex, optionIdx);

            if (playbackMode === 'session') {
              // Session View: fire clips on first audition for this row, then mute/unmute
              const rowBaseTrk = cue.rowIndex * state.config.optionsPerRow;
              const rowClipsFired = routerState.firedTracks.has(rowBaseTrk);

              if (!rowClipsFired) {
                // Unmute the active option's track
                oscBridge.send('/live/track/set/mute', newTrack, 0);
                routerState.unmutedTracks.add(newTrack);
                // First audition for this row: fire all optionsPerRow clips
                for (let i = 0; i < state.config.optionsPerRow; i++) {
                  const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
                  oscBridge.send('/live/clip/fire', trk, 0);
                  routerState.firedTracks.add(trk);
                }
              } else {
                // Mute previously unmuted tracks for this row, then unmute new
                muteRowTracks(state, cue.rowIndex);
                oscBridge.send('/live/track/set/mute', newTrack, 0);
                routerState.unmutedTracks.add(newTrack);
              }
            } else {
              // Arrangement View: ensure transport is playing, then mute/unmute
              if (!routerState.transportStarted) {
                routerState.transportStarted = true;
                oscBridge.send('/live/song/start_playing');
              }
              // Mute previously unmuted tracks for this row, then unmute new
              muteRowTracks(state, cue.rowIndex);
              oscBridge.send('/live/track/set/mute', newTrack, 0);
              routerState.unmutedTracks.add(newTrack);
            }

            break;
          }

          case 'stop_option': {
            if (cue.rowIndex === undefined || !cue.optionId) break;

            const row = state.rows[cue.rowIndex];
            const optionIdx = row?.options.findIndex(o => o.id === cue.optionId) ?? 0;
            const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, optionIdx);

            // Mute the track
            oscBridge.send('/live/track/set/mute', trk, 1);
            routerState.unmutedTracks.delete(trk);
            break;
          }

          case 'commit_layer': {
            if (cue.rowIndex === undefined || !cue.optionId) break;

            const row = state.rows[cue.rowIndex];
            const winnerIdx = row?.options.findIndex(o => o.id === cue.optionId) ?? 0;

            // Ensure winner is unmuted, all others for this row are muted
            for (let i = 0; i < state.config.optionsPerRow; i++) {
              const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
              if (i === winnerIdx) {
                oscBridge.send('/live/track/set/mute', trk, 0); // Unmute winner
                routerState.unmutedTracks.add(trk);
              } else {
                oscBridge.send('/live/track/set/mute', trk, 1); // Mute losers
                routerState.unmutedTracks.delete(trk);
              }
            }
            break;
          }

          case 'uncommit_layer': {
            if (cue.rowIndex === undefined) break;

            // Mute all option tracks for the row
            for (let i = 0; i < state.config.optionsPerRow; i++) {
              const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
              oscBridge.send('/live/track/set/mute', trk, 1);
              routerState.unmutedTracks.delete(trk);

              if (playbackMode === 'session') {
                // Session: also stop clips and clear fired state
                oscBridge.send('/live/clip/stop', trk, 0);
                routerState.firedTracks.delete(trk);
              }
            }
            break;
          }

          case 'play_timeline': {
            if (!cue.path || cue.path.length === 0) break;

            // Mute everything first
            for (const trk of routerState.unmutedTracks) {
              oscBridge.send('/live/track/set/mute', trk, 1);
            }
            routerState.unmutedTracks.clear();

            // Unmute tracks for each option in the path
            for (let rowIdx = 0; rowIdx < cue.path.length; rowIdx++) {
              const row = state.rows[rowIdx];
              if (!row) continue;
              const optionIdx = row.options.findIndex(o => o.id === cue.path![rowIdx]);
              if (optionIdx < 0) continue;
              const trk = trackIndex(state.config.optionsPerRow, rowIdx, optionIdx);

              if (playbackMode === 'session') {
                // Session: ensure clip is fired
                if (!routerState.firedTracks.has(trk)) {
                  oscBridge.send('/live/clip/fire', trk, 0);
                  routerState.firedTracks.add(trk);
                }
              }
              // Arrangement: transport should already be running; just unmute

              // Unmute the track
              oscBridge.send('/live/track/set/mute', trk, 0);
              routerState.unmutedTracks.add(trk);
            }
            break;
          }
        }
      }

      if (event.type === 'AUDITION_OPTION_CHANGED' || event.type === 'ROW_PHASE_CHANGED') {
        oscBridge.send('/live/song/set/current_song_time', 0);
      }

      if (event.type === 'SHOW_RESET') {
        routerState.firedTracks.clear();
        routerState.unmutedTracks.clear();
        routerState.transportStarted = false;
        stopAllTracks(oscBridge);
        oscBridge.send('/live/song/stop_playing');
        oscBridge.send('/live/song/set/current_song_time', 0);
      }

      // Handle pause/resume
      if (event.type === 'SHOW_PHASE_CHANGED') {
        const phaseEvent = event;

        if (phaseEvent.phase === 'paused') {
          oscBridge.send('/live/song/stop_playing');
        } else if (routerState.lastKnownPhase === 'paused') {
          // Resuming from pause (previous phase was paused, current phase is not)
          oscBridge.send('/live/song/continue_playing');
        }

        routerState.lastKnownPhase = phaseEvent.phase;
      }
    }
  }

  /**
   * Clean up resources
   */
  function dispose(): void {
    routerState.lastKnownPhase = null;
    routerState.firedTracks.clear();
    routerState.unmutedTracks.clear();
    routerState.transportStarted = false;
  }

  return {
    handleStateChange,
    dispose,
  };
}

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
 * Session Layout:
 * - optionsPerRow * rowCount tracks total (optionsPerRow per row)
 * - Track index = rowIndex * optionsPerRow + optionIndex
 * - Row 0: tracks 0-(optionsPerRow-1), Row 1: tracks optionsPerRow-(optionsPerRow*2-1), ..., Row (rowCount-1): tracks (optionsPerRow*(rowCount-1))-(optionsPerRow*rowCount-1)
 * - Clips fired at slot 0 (scene 0)
 * - Audition via mute/unmute (smooth transitions, no stop/start glitches)
 * - Layering: each row has its own tracks, committed clips keep playing
 */

import type { OSCBridge } from './osc';
import type { ShowState, ConductorEvent, ShowPhase } from '../conductor/types';

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
  /** Set of track indices with clips currently fired (playing, possibly muted) */
  firedTracks: Set<number>;
  /** Set of track indices currently unmuted (audible) */
  unmutedTracks: Set<number>;
}

/**
 * Calculate Ableton track index from row and option indices.
 * Layout: optionsPerRow * rowCount tracks, optionsPerRow per row, grouped sequentially.
 * Row 0: tracks 0-(optionsPerRow-1), Row 1: tracks optionsPerRow-(optionsPerRow*2-1), ..., Row (rowCount-1): tracks (optionsPerRow*(rowCount-1))-(optionsPerRow*rowCount-1).
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
 * @returns AudioRouter instance
 */
export function createAudioRouter(oscBridge: OSCBridge): AudioRouter {
  // Internal state tracking
  const routerState: AudioRouterState = {
    lastKnownPhase: null,
    firedTracks: new Set<number>(),
    unmutedTracks: new Set<number>(),
  };

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

            // Check if clips for this row have been fired yet
            const rowBaseTrk = cue.rowIndex * state.config.optionsPerRow;
            const rowClipsFired = routerState.firedTracks.has(rowBaseTrk);

            
            if (!rowClipsFired) {
              // Unmute the active option's track
              oscBridge.send('/live/track/set/mute', newTrack, 0);
              routerState.unmutedTracks.add(newTrack);
              // First audition for this row: fire all optionsPerRow clips
              for (let i = 0; i < state.config.optionsPerRow; i++) {
                const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
                // Ensure muted first
                // oscBridge.send('/live/track/set/mute', trk, 1);
                // Fire clip at slot 0
                oscBridge.send('/live/clip/fire', trk, 0);
                routerState.firedTracks.add(trk);
              }
            } else {
              // Mute any previously unmuted track for this row
              for (let i = 0; i < state.config.optionsPerRow; i++) {
                const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
                if (routerState.unmutedTracks.has(trk)) {
                  oscBridge.send('/live/track/set/mute', trk, 1);
                  routerState.unmutedTracks.delete(trk);
                }
              }
              // oscBridge.send('/live/song/set/current_song_time', 0);
              // Unmute the active option's track
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

            // Mute and stop all option tracks for the row
            for (let i = 0; i < state.config.optionsPerRow; i++) {
              const trk = trackIndex(state.config.optionsPerRow, cue.rowIndex, i);
              oscBridge.send('/live/track/set/mute', trk, 1);
              oscBridge.send('/live/clip/stop', trk, 0);
              routerState.unmutedTracks.delete(trk);
              routerState.firedTracks.delete(trk);
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

              // Ensure clip is fired
              if (!routerState.firedTracks.has(trk)) {
                oscBridge.send('/live/clip/fire', trk, 0);
                routerState.firedTracks.add(trk);
              }

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
  }

  return {
    handleStateChange,
    dispose,
  };
}

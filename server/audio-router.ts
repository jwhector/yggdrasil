/**
 * Audio Router - Maps Conductor Events to OSC Messages
 *
 * Translates AUDIO_CUE events from the conductor into OSC messages for Ableton Live.
 * This is the single source of truth for audio command routing.
 *
 * The timing engine handles scheduling but does NOT send audio OSC messages.
 * The audio router handles ALL outbound audio OSC messages.
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
 * Create an audio router that translates conductor events to OSC messages
 *
 * @param oscBridge - OSC bridge for sending messages to Ableton
 * @returns AudioRouter instance
 */
export function createAudioRouter(oscBridge: OSCBridge): AudioRouter {
  // Track previous phase to detect resume from pause
  let lastKnownPhase: ShowPhase | null = null;

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
            if (cue.rowIndex !== undefined && cue.optionId) {
              // Find option index from the current row
              const row = state.rows[cue.rowIndex];
              const optionIndex = row?.options.findIndex(o => o.id === cue.optionId) ?? 0;
              oscBridge.send('/live/send/start_playing', cue.rowIndex, optionIndex, cue.optionId);
            }
            break;
          }

          case 'stop_option': {
            if (cue.rowIndex !== undefined && cue.optionId) {
              const row = state.rows[cue.rowIndex];
              const optionIndex = row?.options.findIndex(o => o.id === cue.optionId) ?? 0;
              oscBridge.send('/ygg/audition/stop', cue.rowIndex, optionIndex);
            }
            break;
          }

          case 'commit_layer': {
            if (cue.rowIndex !== undefined && cue.optionId) {
              oscBridge.send('/ygg/layer/commit', cue.rowIndex, cue.optionId);
            }
            break;
          }

          case 'uncommit_layer': {
            if (cue.rowIndex !== undefined) {
              oscBridge.send('/ygg/layer/uncommit', cue.rowIndex);
            }
            break;
          }

          case 'play_timeline': {
            if (cue.userId && cue.path) {
              // Individual timeline playback
              oscBridge.send('/ygg/finale/timeline', cue.userId, cue.path.join(','));
            } else if (cue.path) {
              // Popular path playback
              oscBridge.send('/ygg/finale/popular', cue.path.join(','));
            }
            break;
          }
        }
      }

      // Handle pause/resume
      if (event.type === 'SHOW_PHASE_CHANGED') {
        const phaseEvent = event;

        if (phaseEvent.phase === 'paused') {
          oscBridge.send('/ygg/show/pause');
        } else if (lastKnownPhase === 'paused') {
          // Resuming from pause (previous phase was paused, current phase is not)
          oscBridge.send('/ygg/show/resume');
        }

        lastKnownPhase = phaseEvent.phase;
      }
    }
  }

  /**
   * Clean up resources
   */
  function dispose(): void {
    lastKnownPhase = null;
  }

  return {
    handleStateChange,
    dispose,
  };
}

/**
 * Audio Router — Maps Conductor AUDIO_CUE Events to AbletonOSC Messages
 *
 * Translates AUDIO_CUE events from the conductor into OSC messages for Ableton Live
 * using the AbletonOSC plugin (ideoforms).
 *
 * This is the single source of truth for audio command routing.
 * The timing engine handles scheduling but does NOT send audio OSC messages.
 * The audio router handles ALL outbound audio OSC messages.
 *
 * Track Layout (arrangement mode — all clips pre-laid out, mute/unmute only):
 *   trackIndex = attemptIndex * (layersPerAttempt * 2) + layerIndex * 2 + optionOffset
 *   - optionOffset: 0 for Option A, 1 for Option B
 *   - With layersPerAttempt=7: 42 tracks total (0–41)
 *   - Example: Attempt 0, Layer 2, Option B = 0*14 + 2*2 + 1 = track 5
 *
 * Collapse gesture uses a master return track with effects (distortion, filter sweep,
 * reverb tail). All song-building tracks route through this return.
 *
 * Song rejection uses the same return track (or a configurable separate one).
 *
 * Finale consensus activation: unmute the winning fragment's track.
 * Performer mix updates: batch mute/unmute at loop boundary.
 */

import type { OSCBridge } from './osc';
import type {
  ShowState,
  ConductorEvent,
  AudioCue,
  AudioReference,
  LayerType,
} from '../conductor/types';

// ============================================================================
// Layout Configuration
// ============================================================================

export interface AbletonLayoutConfig {
  maxLayersPerAttempt: number;       // Default: 7
  attemptCount: number;               // Default: 3
  collapseReturnTrackIndex: number;   // Return track index for collapse effects
  rejectionReturnTrackIndex: number;  // Return track index for rejection effects (can be same as collapse)
}

const DEFAULT_LAYOUT: AbletonLayoutConfig = {
  maxLayersPerAttempt: 7,
  attemptCount: 3,
  collapseReturnTrackIndex: 0,
  rejectionReturnTrackIndex: 0,
};

// ============================================================================
// Track Index Computation
// ============================================================================

/**
 * Compute Ableton track index from attempt, layer, and option.
 *
 * Formula: attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset
 */
export function computeTrackIndex(
  attemptIndex: number,
  layerIndex: number,
  option: 'A' | 'B',
  maxLayersPerAttempt: number,
): number {
  const optionOffset = option === 'A' ? 0 : 1;
  return attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset;
}

// ============================================================================
// Audio Router Interface
// ============================================================================

export interface AudioRouter {
  /** Process conductor events, routing audio cues to OSC */
  handleStateChange(state: ShowState, events: ConductorEvent[]): void;
  /** Clean up resources */
  dispose(): void;
}

// ============================================================================
// Internal State
// ============================================================================

interface AudioRouterState {
  /** Track indices currently unmuted (audible) */
  unmutedTracks: Set<number>;
  /** Whether the global transport has been started */
  transportStarted: boolean;
  /** Pending collapse cleanup timers, keyed by attemptIndex */
  collapseTimers: Map<number, NodeJS.Timeout>;
  /** Pending rejection cleanup timers, keyed by attemptIndex */
  rejectionTimers: Map<number, NodeJS.Timeout>;
  /** Active layer type → track index for performer mix */
  activeLayerTracks: Map<LayerType, number>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an audio router that translates conductor events to AbletonOSC messages.
 */
export function createAudioRouter(
  oscBridge: OSCBridge,
  config?: Partial<AbletonLayoutConfig>,
): AudioRouter {
  const layout: AbletonLayoutConfig = { ...DEFAULT_LAYOUT, ...config };

  const routerState: AudioRouterState = {
    unmutedTracks: new Set(),
    transportStarted: false,
    collapseTimers: new Map(),
    rejectionTimers: new Map(),
    activeLayerTracks: new Map(),
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function ensureTransportStarted(): void {
    oscBridge.once('/live/song/get/is_playing', (playing: boolean) => {
      if (!playing || !routerState.transportStarted) {
        oscBridge.send('/live/song/start_playing');
      }
      routerState.transportStarted = true;
    });
    oscBridge.send('/live/song/get/is_playing');
  }

  function muteTrack(trackIndex: number): void {
    if (routerState.unmutedTracks.has(trackIndex)) {
      oscBridge.send('/live/track/set/mute', trackIndex, 1);
      routerState.unmutedTracks.delete(trackIndex);
    }
  }

  function unmuteTrack(trackIndex: number): void {
    if (!routerState.unmutedTracks.has(trackIndex)) {
      oscBridge.send('/live/track/set/mute', trackIndex, 0);
      routerState.unmutedTracks.add(trackIndex);
    }
  }

  function muteAllTracks(): void {
    let totalTracks = 0;
    oscBridge.once('/live/song/get/num_tracks', (count: number) => {
      totalTracks = count;
      oscBridge.send(`/live/song/get/track_data`, 0, totalTracks, 'track.is_foldable');
    });
    oscBridge.once('/live/song/get/track_data', (...trackArgs: any[]) => {
      console.log("Handling track data", trackArgs);
      for (let i = 0; i < trackArgs.length; i++) {
        console.log("Track", i, "is foldable", trackArgs[i]);
        if (!trackArgs[i]) {
          oscBridge.send('/live/track/set/mute', i, 1);
        }
      }
    });
    oscBridge.send('/live/song/get/num_tracks');
    oscBridge.send('/live/song/stop_playing');
    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();
  }

  function enableEffects(audioRef: AudioReference): void {
    if (audioRef.effectIndices) {
      for (const deviceIndex of audioRef.effectIndices) {
        oscBridge.send('/live/device/set/parameter/value', audioRef.trackIndex, deviceIndex, 0, 1);
      }
    }
  }

  function disableEffects(audioRef: AudioReference): void {
    if (audioRef.effectIndices) {
      for (const deviceIndex of audioRef.effectIndices) {
        oscBridge.send('/live/device/set/parameter/value', audioRef.trackIndex, deviceIndex, 0, 0);
      }
    }
  }

  function clearCollapseTimers(): void {
    for (const timer of routerState.collapseTimers.values()) {
      clearTimeout(timer);
    }
    routerState.collapseTimers.clear();
  }

  function clearRejectionTimers(): void {
    for (const timer of routerState.rejectionTimers.values()) {
      clearTimeout(timer);
    }
    routerState.rejectionTimers.clear();
  }

  function stopPlayback(): void {
    oscBridge.send('/live/song/stop_playing');
    routerState.transportStarted = false;
  }

  // --------------------------------------------------------------------------
  // AudioCue Handlers
  // --------------------------------------------------------------------------

  function handleAuditionStart(cue: Extract<AudioCue, { type: 'audition_start' }>, state: ShowState): void {
    ensureTransportStarted();

    const { audioRef, otherAudioRef, attemptIndex, layerIndex } = cue;
    const layer = state.attempts[attemptIndex].layerPlan[layerIndex];

    // Disable the other option's effects first
    disableEffects(otherAudioRef);

    // When both options share the same track (effect-only swap), skip track mute/unmute
    // to avoid a brief audio glitch from muting then immediately unmuting the same track.
    const sameTrack = otherAudioRef.trackIndex === audioRef.trackIndex;
    if (!sameTrack) {
      muteTrack(otherAudioRef.trackIndex);
    }

    unmuteTrack(audioRef.trackIndex);
    enableEffects(audioRef);
  }

  function handleAuditionStop(cue: Extract<AudioCue, { type: 'audition_stop' }>): void {
    if (!cue.audioRef) {
      stopPlayback();
      return;
    }
    disableEffects(cue.audioRef);
    muteTrack(cue.audioRef.trackIndex);
    stopPlayback();
  }

  function handleLockIn(cue: Extract<AudioCue, { type: 'lock_in' }>): void {
    const { winnerAudioRef, loserAudioRef } = cue;

    unmuteTrack(winnerAudioRef.trackIndex);
    enableEffects(winnerAudioRef);

    disableEffects(loserAudioRef);
    if (loserAudioRef.trackIndex !== winnerAudioRef.trackIndex) {
      muteTrack(loserAudioRef.trackIndex);
    }
  }

  function handleCollapseGesture(
    cue: Extract<AudioCue, { type: 'collapse_gesture' }>,
    state: ShowState,
  ): void {
    // Enable return track effects (unmute return)
    oscBridge.send('/live/return/set/mute', layout.collapseReturnTrackIndex, 0);

    // Schedule cleanup: mute all attempt tracks + re-mute return after animation
    const collapseMs = state.config.timing.revealSequenceDurationMs;
    const timer = setTimeout(() => {
      for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
        muteTrack(layer.optionA.trackIndex);
        muteTrack(layer.optionB.trackIndex);
      }
      // Re-mute return track effects
      oscBridge.send('/live/return/set/mute', layout.collapseReturnTrackIndex, 1);
      routerState.collapseTimers.delete(cue.attemptIndex);
    }, collapseMs);

    routerState.collapseTimers.set(cue.attemptIndex, timer);
  }

  function handleRejectionGesture(
    cue: Extract<AudioCue, { type: 'rejection_gesture' }>,
    state: ShowState,
  ): void {
    // Enable rejection return track effects
    oscBridge.send('/live/return/set/mute', layout.rejectionReturnTrackIndex, 0);

    // Schedule cleanup: mute all attempt tracks + re-mute return after effect
    const rejectionMs = state.config.timing.rejectionEffectDurationMs;
    const timer = setTimeout(() => {
      for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
        muteTrack(layer.optionA.trackIndex);
        muteTrack(layer.optionB.trackIndex);
      }
      oscBridge.send('/live/return/set/mute', layout.rejectionReturnTrackIndex, 1);
      routerState.rejectionTimers.delete(cue.attemptIndex);
    }, rejectionMs);

    routerState.rejectionTimers.set(cue.attemptIndex, timer);
  }

  function handleConsensusActivate(cue: Extract<AudioCue, { type: 'consensus_activate' }>): void {
    ensureTransportStarted();
    unmuteTrack(cue.audioRef.trackIndex);
    routerState.activeLayerTracks.set(cue.layerType, cue.audioRef.trackIndex);
  }

  function handleMixUpdate(
    cue: Extract<AudioCue, { type: 'mix_update' }>,
    state: ShowState,
  ): void {
    // Apply all pending changes simultaneously at loop boundary
    for (const change of cue.changes) {
      const { layerType, fragmentId } = change;

      // Mute previous track for this layer type (if any)
      const previousTrack = routerState.activeLayerTracks.get(layerType);
      if (previousTrack !== undefined) {
        muteTrack(previousTrack);
      }

      if (fragmentId !== null) {
        // Find the new fragment's track from the finale state
        const finaleState = state.finaleState;
        const fragment = finaleState?.allFragments.find(f => f.id === fragmentId);
        if (fragment) {
          unmuteTrack(fragment.audioRef.trackIndex);
          routerState.activeLayerTracks.set(layerType, fragment.audioRef.trackIndex);
        } else {
          console.warn(`[AudioRouter] mix_update: fragment ${fragmentId} not found in allFragments`);
          routerState.activeLayerTracks.delete(layerType);
        }
      } else {
        // Muting this layer — no new track to activate
        routerState.activeLayerTracks.delete(layerType);
      }
    }
  }

  function handleTransport(cue: Extract<AudioCue, { type: 'transport' }>): void {
    if (cue.action === 'play') {
      oscBridge.send('/live/song/start_playing');
      routerState.transportStarted = true;
    } else {
      oscBridge.send('/live/song/stop_playing');
      routerState.transportStarted = false;
    }
  }

  function handlePanic(): void {
    muteAllTracks();
  }

  // --------------------------------------------------------------------------
  // Main Event Loop
  // --------------------------------------------------------------------------

  function handleStateChange(state: ShowState, events: ConductorEvent[]): void {
    for (const event of events) {
      if (event.type === 'AUDIO_CUE') {
        const cue = event.cue;
        switch (cue.type) {
          case 'audition_start':
            handleAuditionStart(cue, state);
            break;
          case 'audition_stop':
            handleAuditionStop(cue);
            break;
          case 'lock_in':
            handleLockIn(cue);
            break;
          case 'collapse_gesture':
            handleCollapseGesture(cue, state);
            break;
          case 'rejection_gesture':
            handleRejectionGesture(cue, state);
            break;
          case 'consensus_activate':
            handleConsensusActivate(cue);
            break;
          case 'mix_update':
            handleMixUpdate(cue, state);
            break;
          case 'transport':
            handleTransport(cue);
            break;
          case 'panic':
            handlePanic();
            break;
        }
      }

      if (event.type === 'SHOW_RESET') {
        muteAllTracks();
        stopPlayback();
        clearCollapseTimers();
        clearRejectionTimers();
      }

      if (event.type === 'PAUSED') {
        stopPlayback();
      }

      if (event.type === 'RESUMED') {
        oscBridge.send('/live/song/continue_playing');
        routerState.transportStarted = true;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  function dispose(): void {
    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();
    routerState.transportStarted = false;
    clearCollapseTimers();
    clearRejectionTimers();
  }

  return {
    handleStateChange,
    dispose,
  };
}

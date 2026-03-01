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
 *   trackIndex = attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset
 *   - optionOffset: 0 for Option A, 1 for Option B
 *   - With maxLayersPerAttempt=7: 42 tracks total (0–41)
 *   - Example: Attempt 0, Layer 2, Option B = 0*14 + 2*2 + 1 = track 5
 *
 * Collapse gesture uses a master return track with effects (distortion, filter sweep,
 * reverb tail). All song-building tracks route through this return.
 *
 * Finale fragments reference the same Ableton tracks used during song-building.
 * Stewardship parameters map to Ableton device parameters via SafeParameter.abletonMapping.
 * Smoothing is handled by the Ableton device configuration, not the server.
 */

import type { OSCBridge } from './osc';
import type {
  ShowState,
  ConductorEvent,
  AudioCue,
} from '../conductor/types';

// ============================================================================
// Layout Configuration
// ============================================================================

export interface AbletonLayoutConfig {
  maxLayersPerAttempt: number;      // Default: 7
  attemptCount: number;              // Default: 3
  collapseReturnTrackIndex: number;  // Return track index for collapse effects
  finaleSlotCount: number;           // Default: 7
}

const DEFAULT_LAYOUT: AbletonLayoutConfig = {
  maxLayersPerAttempt: 7,
  attemptCount: 3,
  collapseReturnTrackIndex: 0,
  finaleSlotCount: 7,
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
  /** Maps finale slotIndex → trackIndex for deactivation lookup */
  activatedSlotTracks: Map<number, number>;
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
    activatedSlotTracks: new Map(),
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function ensureTransportStarted(): void {
    if (!routerState.transportStarted) {
      oscBridge.send('/live/song/start_playing');
      routerState.transportStarted = true;
    }
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
    const totalTracks = layout.attemptCount * layout.maxLayersPerAttempt * 2;
    for (let i = 0; i < totalTracks; i++) {
      oscBridge.send('/live/track/set/mute', i, 1);
    }
    routerState.unmutedTracks.clear();
    routerState.activatedSlotTracks.clear();
  }

  function clearCollapseTimers(): void {
    for (const timer of routerState.collapseTimers.values()) {
      clearTimeout(timer);
    }
    routerState.collapseTimers.clear();
  }

  function stopPlayback(): void {
    oscBridge.send('/live/song/stop_playing');
    routerState.transportStarted = false;
  }

  function startPlayback(): void {
    oscBridge.send('/live/song/start_playing');
    routerState.transportStarted = true;
  }

  // --------------------------------------------------------------------------
  // AudioCue Handlers
  // --------------------------------------------------------------------------

  function handleAuditionStart(cue: Extract<AudioCue, { type: 'audition_start' }>): void {
    ensureTransportStarted();

    // Mute the other option for the same layer (in case it was previously unmuted)
    const otherOption: 'A' | 'B' = cue.option === 'A' ? 'B' : 'A';
    const otherTrack = computeTrackIndex(cue.attemptIndex, cue.layerIndex, otherOption, layout.maxLayersPerAttempt);
    muteTrack(otherTrack);

    // Unmute this option
    const track = computeTrackIndex(cue.attemptIndex, cue.layerIndex, cue.option, layout.maxLayersPerAttempt);
    unmuteTrack(track);
  }

  function handleAuditionStop(cue: Extract<AudioCue, { type: 'audition_stop' }>): void {
    if (cue.option === null) {
      console.log('Audition stop: cue.option is null, stopping playback');
      stopPlayback();
      return;
    }
    const track = computeTrackIndex(cue.attemptIndex, cue.layerIndex, cue.option, layout.maxLayersPerAttempt);
    muteTrack(track);
    stopPlayback();
  }

  function handleLockIn(cue: Extract<AudioCue, { type: 'lock_in' }>): void {
    const winnerTrack = computeTrackIndex(cue.attemptIndex, cue.layerIndex, cue.winner, layout.maxLayersPerAttempt);
    const loser: 'A' | 'B' = cue.winner === 'A' ? 'B' : 'A';
    const loserTrack = computeTrackIndex(cue.attemptIndex, cue.layerIndex, loser, layout.maxLayersPerAttempt);

    unmuteTrack(winnerTrack);
    muteTrack(loserTrack);
  }

  function handleCollapseGesture(
    cue: Extract<AudioCue, { type: 'collapse_gesture' }>,
    state: ShowState,
  ): void {
    // Enable return track effects (unmute return)
    oscBridge.send('/live/return/set/mute', layout.collapseReturnTrackIndex, 0);

    // Schedule cleanup: mute all attempt tracks + re-mute return after animation
    const collapseMs = state.config.timing.collapseAnimationMs;
    const timer = setTimeout(() => {
      const baseTrack = cue.attemptIndex * (layout.maxLayersPerAttempt * 2);
      const trackCount = layout.maxLayersPerAttempt * 2;
      for (let i = 0; i < trackCount; i++) {
        muteTrack(baseTrack + i);
      }
      // Re-mute return track effects
      oscBridge.send('/live/return/set/mute', layout.collapseReturnTrackIndex, 1);
      routerState.collapseTimers.delete(cue.attemptIndex);
    }, collapseMs);

    routerState.collapseTimers.set(cue.attemptIndex, timer);
  }

  function handleSlotActivate(cue: Extract<AudioCue, { type: 'slot_activate' }>): void {
    ensureTransportStarted();
    const trackIndex = cue.fragment.audioRef.trackIndex;
    unmuteTrack(trackIndex);
    routerState.activatedSlotTracks.set(cue.slotIndex, trackIndex);
  }

  function handleSlotDeactivate(cue: Extract<AudioCue, { type: 'slot_deactivate' }>): void {
    const trackIndex = routerState.activatedSlotTracks.get(cue.slotIndex);
    if (trackIndex !== undefined) {
      muteTrack(trackIndex);
      routerState.activatedSlotTracks.delete(cue.slotIndex);
    }
  }

  function handleStewardParam(
    cue: Extract<AudioCue, { type: 'steward_param' }>,
    state: ShowState,
  ): void {
    const slot = state.finaleState?.activeSlots[cue.slotIndex];
    if (!slot) return;

    const mapping = slot.fragment.safeParameter.abletonMapping;
    oscBridge.send(
      '/live/device/set/parameter/value',
      mapping.trackIndex,
      mapping.deviceIndex,
      mapping.paramIndex,
      cue.value,
    );
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
            handleAuditionStart(cue);
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
          case 'slot_activate':
            handleSlotActivate(cue);
            break;
          case 'slot_deactivate':
            handleSlotDeactivate(cue);
            break;
          case 'steward_param':
            handleStewardParam(cue, state);
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
      }

      if (event.type === 'PAUSED') {
        stopPlayback();
      }

      if (event.type === 'RESUMED') {
        startPlayback();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  function dispose(): void {
    routerState.unmutedTracks.clear();
    routerState.activatedSlotTracks.clear();
    routerState.transportStarted = false;
    clearCollapseTimers();
  }

  return {
    handleStateChange,
    dispose,
  };
}

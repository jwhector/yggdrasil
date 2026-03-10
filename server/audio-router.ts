/**
 * Audio Router — Maps Conductor AUDIO_CUE Events to AbletonOSC Messages
 *
 * Translates AUDIO_CUE events from the conductor into OSC messages for Ableton Live
 * using the AbletonOSC plugin (ideoforms).
 *
 * === Ableton Setup Requirements ===
 * 1. All 42 fragment tracks must have a Utility device as their LAST device in chain.
 * 2. All clips must be set to loop — the server never fires or stops individual clips.
 * 3. Utility Gain starts at muted (parameter value -1.0) — the server controls gain.
 * 4. Track volume faders should stay at 0 dB — reserved for performer's manual mixing.
 * 5. Transport starts once and plays continuously.
 *
 * === Control Model ===
 * - Primary:   Utility device Gain parameter (-1.0 = muted, 0.0 = 0 dB, 1.0 = +35 dB)
 * - Secondary: Track mute/unmute for Ableton session view legibility
 *   - Unmute BEFORE gain ramps up (so clip slot color appears active in session view)
 *   - Mute AFTER gain reaches 0 (so clip slot color grays out when silent)
 * - Gain fades are locked to the musical grid via the timing engine's beat callback scheduler.
 * - If no timing engine (test mode), fades snap instantly to the target gain.
 * - Tracks without a cached Utility device fall back to mute/unmute only.
 *
 * === Track Layout ===
 *   42 fragment tracks (3 attempts × 7 layers × 2 options)
 *   Group (foldable) tracks are intermixed with fragment tracks in Ableton.
 *   Mute operations query is_foldable to avoid muting group tracks.
 */

import type { OSCBridge } from './osc';
import type { TimingEngine } from './timing';
import type {
  ShowState,
  ConductorEvent,
  AudioCue,
  AudioReference,
  LayerType,
  GainConfig,
} from '../conductor/types';

// ============================================================================
// Layout Configuration
// ============================================================================

export interface AbletonLayoutConfig {
  maxLayersPerAttempt: number;         // Default: 7
  attemptCount: number;                // Default: 3
  collapseReturnTrackIndex: number;    // Return track index for collapse effects
  rejectionReturnTrackIndex: number;   // Return track index for rejection effects
  utilityDeviceName: string;           // Device name to search for (e.g. "Utility")
  utilityGainParamName: string;        // Parameter name for gain (e.g. "Gain")
}

const DEFAULT_LAYOUT: AbletonLayoutConfig = {
  maxLayersPerAttempt: 7,
  attemptCount: 3,
  collapseReturnTrackIndex: 0,
  rejectionReturnTrackIndex: 1,
  utilityDeviceName: 'Utility',
  utilityGainParamName: 'Gain',
};

const DEFAULT_GAIN_CONFIG: GainConfig = {
  entryGain: 0.6,
  entrySwellBeats: 4,
  holdBars: 7,
  exitFadeBeats: 4,
  lockInFadeBeats: 4,
  collapseFadeBeats: 8,
  consensusSwellBeats: 4,
  unityGainValue: 0,
  stepsPerBeat: 2,
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
  /** Discover Utility devices on all fragment tracks. Call once after OSC bridge starts. */
  discoverDevices(): Promise<void>;
  /** Clean up resources */
  dispose(): void;
}

// ============================================================================
// Internal State Types
// ============================================================================

/** Per-track gain state tracked internally. */
interface TrackGainState {
  currentGain: number;          // 0.0 to 1.0 (musical gain, before unityGainValue scaling)
  activeFadeId: string | null;  // ID prefix of in-flight fade, for cancellation
  subBeatTimers: NodeJS.Timeout[];  // Pending sub-beat interpolation timers
}

/** Cached Utility device and parameter info for a track. */
interface TrackDeviceInfo {
  utilityDeviceIndex: number;
  gainParamIndex: number;
}

interface AudioRouterState {
  /** Tracks currently unmuted in Ableton (for legibility tracking) */
  unmutedTracks: Set<number>;
  /** Per-track gain and fade state */
  trackGains: Map<number, TrackGainState>;
  /** Cached Utility device info per track (populated by discoverDevices) */
  deviceCache: Map<number, TrackDeviceInfo>;
  /** Whether device discovery has completed */
  discoveryComplete: boolean;
  /** Monotonic counter for unique fade IDs */
  fadeCounter: number;
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
 *
 * @param oscBridge - OSC bridge for Ableton communication
 * @param config - Optional Ableton layout config overrides
 * @param timingEngine - Optional timing engine for beat-locked fades.
 *                       If null (test mode), fades snap instantly to target gain.
 */
export function createAudioRouter(
  oscBridge: OSCBridge,
  config?: Partial<AbletonLayoutConfig>,
  timingEngine?: TimingEngine,
): AudioRouter {
  const layout: AbletonLayoutConfig = { ...DEFAULT_LAYOUT, ...config };

  const routerState: AudioRouterState = {
    unmutedTracks: new Set(),
    trackGains: new Map(),
    deviceCache: new Map(),
    discoveryComplete: false,
    fadeCounter: 0,
    transportStarted: false,
    collapseTimers: new Map(),
    rejectionTimers: new Map(),
    activeLayerTracks: new Map(),
  };

  // Last-seen gain config, updated at the top of handleStateChange
  let currentGainConfig: GainConfig = { ...DEFAULT_GAIN_CONFIG };

  // Total number of fragment tracks
  const totalTracks = layout.maxLayersPerAttempt * layout.attemptCount * 2;

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  function getOrCreateTrackGainState(trackIndex: number): TrackGainState {
    let gs = routerState.trackGains.get(trackIndex);
    if (!gs) {
      gs = { currentGain: 0, activeFadeId: null, subBeatTimers: [] };
      routerState.trackGains.set(trackIndex, gs);
    }
    return gs;
  }

  /** Low-level Ableton track mute (for session view legibility). Idempotent. */
  function muteTrack(trackIndex: number): void {
    if (routerState.unmutedTracks.has(trackIndex)) {
      oscBridge.send('/live/track/set/mute', trackIndex, 1);
      routerState.unmutedTracks.delete(trackIndex);
    }
  }

  /** Low-level Ableton track unmute (for session view legibility). Idempotent. */
  function unmuteTrack(trackIndex: number): void {
    if (!routerState.unmutedTracks.has(trackIndex)) {
      oscBridge.send('/live/track/set/mute', trackIndex, 0);
      routerState.unmutedTracks.add(trackIndex);
    }
  }

  /**
   * Set the Utility device gain for a track.
   *
   * - If gain > 0 and track is muted → unmutes the track first (legibility)
   * - Sends gain to Utility device (falls back to mute/unmute if no device cached)
   * - If gain === 0 → mutes the track after setting gain (legibility)
   */
  function setGain(trackIndex: number, gain: number): void {
    const clampedGain = Math.max(0, Math.min(1, gain));

    // Unmute before any audible gain (so session view shows track as active)
    if (clampedGain > 0) {
      unmuteTrack(trackIndex);
    }

    const deviceInfo = routerState.deviceCache.get(trackIndex);
    if (deviceInfo) {
      // Map internal gain (0=silent, 1=full) to Ableton Utility range (-1=muted, 0=0dB)
      // Formula: oscValue = -1 + gain * (unityGainValue + 1)
      const oscValue = -1 + clampedGain * (currentGainConfig.unityGainValue + 1);
      oscBridge.send(
        '/live/device/set/parameter/value',
        trackIndex,
        deviceInfo.utilityDeviceIndex,
        deviceInfo.gainParamIndex,
        oscValue,
      );
    } else {
      // Fallback: no Utility device — mute/unmute is the only lever
      // (gain > 0 already unmuted above; gain === 0 will mute below)
      if (!routerState.discoveryComplete) {
        // Discovery hasn't run; this is expected during startup
      } else {
        // Discovery ran but this track has no Utility device
        console.warn(`[AudioRouter] Track ${trackIndex} has no cached Utility device — using mute/unmute fallback`);
      }
    }

    const gs = getOrCreateTrackGainState(trackIndex);
    gs.currentGain = clampedGain;

    // Mute after gain reaches zero (so session view shows track as inactive)
    if (clampedGain === 0) {
      muteTrack(trackIndex);
    }
  }

  /**
   * Schedule a linear gain fade over durationBeats, locked to the musical grid.
   *
   * - Cancels any existing in-flight fade on this track.
   * - If no timing engine or durationBeats <= 0: snaps instantly to targetGain.
   * - If fading in (targetGain > 0): unmutes the track before the first beat fires.
   * - If fading out (targetGain === 0): the final gain step calls setGain(0) which mutes.
   * - Returns the fadeId (can be used to cancel with timingEngine.cancelCallbacks).
   */
  function fadeGain(
    trackIndex: number,
    targetGain: number,
    durationBeats: number,
    startBeat?: number,
  ): string {
    const gs = getOrCreateTrackGainState(trackIndex);

    // Cancel any existing fade on this track
    if (gs.activeFadeId) {
      timingEngine?.cancelCallbacks(gs.activeFadeId);
      gs.activeFadeId = null;
    }
    for (const timer of gs.subBeatTimers) clearTimeout(timer);
    gs.subBeatTimers = [];

    routerState.fadeCounter++;
    const fadeId = `fade-${routerState.fadeCounter}-t${trackIndex}`;
    gs.activeFadeId = fadeId;

    // No timing engine or zero-beat fade: snap instantly
    if (!timingEngine || durationBeats <= 0) {
      setGain(trackIndex, targetGain);
      gs.activeFadeId = null;
      return fadeId;
    }

    // If fading in, unmute now so session view shows track active before first beat
    if (targetGain > 0) {
      unmuteTrack(trackIndex);
    }

    const startGain = gs.currentGain;
    const fromBeat = startBeat ?? (timingEngine.getCurrentBeat() + 1);

    timingEngine.schedulePerBeat(
      fadeId,
      fromBeat,
      durationBeats,
      (beatIndex: number, totalBeats: number) => {
        // On-beat step
        const progress = (beatIndex + 1) / totalBeats;
        const newGain = startGain + (targetGain - startGain) * progress;
        setGain(trackIndex, Math.max(0, Math.min(1, newGain)));

        // Sub-beat steps between this beat and the next
        const stepsPerBeat = currentGainConfig.stepsPerBeat ?? 1;
        if (stepsPerBeat > 1 && beatIndex < totalBeats - 1) {
          const nextProgress = (beatIndex + 2) / totalBeats;
          const beatMs = timingEngine!.getBeatDurationMs();
          for (let s = 1; s < stepsPerBeat; s++) {
            const frac = s / stepsPerBeat;
            const subProgress = progress + (nextProgress - progress) * frac;
            const subGain = startGain + (targetGain - startGain) * subProgress;
            const timer = setTimeout(() => {
              setGain(trackIndex, Math.max(0, Math.min(1, subGain)));
            }, beatMs * frac);
            const currentGs = routerState.trackGains.get(trackIndex);
            if (currentGs) currentGs.subBeatTimers.push(timer);
          }
        }

        // Clear activeFadeId after final step
        if (beatIndex === totalBeats - 1) {
          const g = routerState.trackGains.get(trackIndex);
          if (g && g.activeFadeId === fadeId) {
            g.activeFadeId = null;
          }
        }
      },
    );

    return fadeId;
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


  /**
   * Immediately silence all tracks:
   * - Cancels all in-flight fades
   * - Sets all Utility device gains to 0 (if device is cached)
   * - Queries Ableton for is_foldable, then mutes all non-group tracks
   *
   * Note: Group (foldable) tracks are intermixed with fragment tracks,
   * so we must query is_foldable to avoid muting group tracks.
   * The muting step is async (waits for Ableton response).
   */
  function silenceAllTracks(): void {
    // Cancel all in-flight fades and sub-beat timers
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
      gs.subBeatTimers = [];
    }

    // Zero all Utility device gains synchronously
    for (let i = 0; i < totalTracks; i++) {
      const gs = getOrCreateTrackGainState(i);
      gs.currentGain = 0;

      const deviceInfo = routerState.deviceCache.get(i);
      if (deviceInfo) {
        oscBridge.send(
          '/live/device/set/parameter/value',
          i,
          deviceInfo.utilityDeviceIndex,
          deviceInfo.gainParamIndex,
          -1,
        );
      }
    }

    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();

    // Query is_foldable to mute only non-group tracks (async)
    oscBridge.once('/live/song/get/num_tracks', (count: number) => {
      oscBridge.send('/live/song/get/track_data', 0, count, 'track.is_foldable');
    });
    oscBridge.once('/live/song/get/track_data', (...trackArgs: any[]) => {
      for (let i = 0; i < trackArgs.length; i++) {
        if (!trackArgs[i]) {
          oscBridge.send('/live/track/set/mute', i, 1);
        }
      }
    });
    oscBridge.send('/live/song/get/num_tracks');
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
    for (const timer of routerState.collapseTimers.values()) clearTimeout(timer);
    routerState.collapseTimers.clear();
  }

  function clearRejectionTimers(): void {
    for (const timer of routerState.rejectionTimers.values()) clearTimeout(timer);
    routerState.rejectionTimers.clear();
  }

  function ensureTransportStarted(): void {
    waitForOSC('/live/song/get/is_playing').then((isPlaying: any) => {
      if (!isPlaying[0]) {
        oscBridge.send('/live/song/start_playing');
      }
      routerState.transportStarted = true;
    }).catch((error: any) => {
      console.error('Error checking if transport is started', error);
    });
    oscBridge.send('/live/song/get/is_playing');
  }

  function stopPlayback(): void {
    oscBridge.send('/live/song/stop_playing');
    routerState.transportStarted = false;
  }

  // --------------------------------------------------------------------------
  // Device Discovery
  // --------------------------------------------------------------------------

  /**
   * Wait for a single OSC response at the given address.
   * Returns the response args, or null on timeout.
   */
  function waitForOSC(listenAddress: string, timeoutMs: number = 1000): Promise<any[] | null> {
    return new Promise<any[] | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      oscBridge.once(listenAddress, (...args: any[]) => {
        clearTimeout(timer);
        resolve(args);
      });
    });
  }

  /**
   * Discover and cache the Utility device info for a single track.
   * Queries Ableton sequentially: num_devices → device names → param names.
   * If multiple Utility devices exist on a track, uses the LAST one
   * (the one closest to the output in the device chain).
   */
  async function discoverTrackDevice(trackIndex: number): Promise<void> {
    oscBridge.send('/live/track/get/num_devices', trackIndex);
    const numDevicesResp = await waitForOSC('/live/track/get/num_devices');
    if (!numDevicesResp) {
      console.warn(`[AudioRouter] discover: no response for track ${trackIndex} num_devices`);
      return;
    }

    // Response format: [trackIndex, numDevices]
    const numDevices = numDevicesResp[1] as number ?? numDevicesResp[0] as number;
    if (!numDevices || numDevices === 0) return;

    for (let deviceIndex = 0; deviceIndex < numDevices; deviceIndex++) {
      oscBridge.send('/live/device/get/name', trackIndex, deviceIndex);
      const nameResp = await waitForOSC('/live/device/get/name');
      if (!nameResp) continue;

      // Response format: [trackIndex, deviceIndex, name]
      const name = nameResp[2] as string ?? nameResp[0] as string;
      if (name !== layout.utilityDeviceName) continue;

      // Found a Utility device — get param names to find Gain
      oscBridge.send('/live/device/get/parameters/name', trackIndex, deviceIndex);
      const paramResp = await waitForOSC('/live/device/get/parameters/name');
      if (!paramResp) continue;

      // Response format: [trackIndex, deviceIndex, name0, name1, ...]
      const paramNames = paramResp.slice(2) as string[];
      const gainParamIndex = paramNames.indexOf(layout.utilityGainParamName);

      if (gainParamIndex >= 0) {
        // Overwrite any earlier match — we want the last Utility in the chain
        routerState.deviceCache.set(trackIndex, { utilityDeviceIndex: deviceIndex, gainParamIndex });
        console.log(`[AudioRouter] Track ${trackIndex}: Utility device ${deviceIndex}, Gain param ${gainParamIndex}`);
      } else {
        console.warn(`[AudioRouter] Track ${trackIndex}: Utility device found but no "${layout.utilityGainParamName}" param`);
      }
      // Continue scanning — use the last Utility device on the track
    }
  }

  /**
   * Discover Utility devices on all 42 fragment tracks.
   * Call once after the OSC bridge starts.
   */
  async function discoverDevices(): Promise<void> {
    console.log(`[AudioRouter] Starting device discovery for ${totalTracks} tracks...`);

    for (let trackIndex = 0; trackIndex < totalTracks; trackIndex++) {
      await discoverTrackDevice(trackIndex);
    }

    routerState.discoveryComplete = true;
    console.log(`[AudioRouter] Device discovery complete. ${routerState.deviceCache.size}/${totalTracks} tracks have Utility devices.`);
  }

  // --------------------------------------------------------------------------
  // AudioCue Handlers
  // --------------------------------------------------------------------------

  function handleAuditionStart(
    cue: Extract<AudioCue, { type: 'audition_start' }>,
  ): void {
    ensureTransportStarted();

    const { audioRef, otherAudioRef } = cue;

    disableEffects(otherAudioRef);

    const sameTrack = otherAudioRef.trackIndex === audioRef.trackIndex;
    if (!sameTrack) {
      // Fade out the other option's track
      fadeGain(otherAudioRef.trackIndex, 0, currentGainConfig.exitFadeBeats);
    }

    // Bring in the new option: unmute, snap to entryGain, swell to unity
    unmuteTrack(audioRef.trackIndex);
    setGain(audioRef.trackIndex, currentGainConfig.entryGain);
    fadeGain(audioRef.trackIndex, 1.0, currentGainConfig.entrySwellBeats);
    enableEffects(audioRef);
  }

  function handleAuditionStop(cue: Extract<AudioCue, { type: 'audition_stop' }>): void {
    if (!cue.audioRef) {
      // No active audition — nothing to fade
      return;
    }
    disableEffects(cue.audioRef);
    fadeGain(cue.audioRef.trackIndex, 0, currentGainConfig.exitFadeBeats);
    // Note: transport continues running; clips keep looping silently
  }

  function handleLockIn(cue: Extract<AudioCue, { type: 'lock_in' }>): void {
    const { winnerAudioRef, loserAudioRef } = cue;

    // Cancel any in-flight fades on both tracks first
    const winnerGs = getOrCreateTrackGainState(winnerAudioRef.trackIndex);
    if (winnerGs.activeFadeId) {
      timingEngine?.cancelCallbacks(winnerGs.activeFadeId);
      winnerGs.activeFadeId = null;
    }

    // Winner: snap to full gain
    unmuteTrack(winnerAudioRef.trackIndex);
    setGain(winnerAudioRef.trackIndex, 1.0);
    enableEffects(winnerAudioRef);

    // Loser: fade to silent
    disableEffects(loserAudioRef);
    if (loserAudioRef.trackIndex !== winnerAudioRef.trackIndex) {
      fadeGain(loserAudioRef.trackIndex, 0, currentGainConfig.lockInFadeBeats);
    }
  }

  function handleCollapseGesture(
    cue: Extract<AudioCue, { type: 'collapse_gesture' }>,
    state: ShowState,
  ): void {
    // Enable return track effects for collapse animation
    oscBridge.send('/live/return/set/mute', layout.collapseReturnTrackIndex, 0);

    // Fade all tracks in the collapsing attempt to 0
    for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
      fadeGain(layer.optionA.trackIndex, 0, currentGainConfig.collapseFadeBeats);
      fadeGain(layer.optionB.trackIndex, 0, currentGainConfig.collapseFadeBeats);
    }

    // Schedule re-mute of return track after collapse animation completes
    const collapseMs = state.config.timing.revealSequenceDurationMs;
    const timer = setTimeout(() => {
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

    // Fade all tracks in the rejected attempt to 0
    for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
      fadeGain(layer.optionA.trackIndex, 0, currentGainConfig.collapseFadeBeats);
      fadeGain(layer.optionB.trackIndex, 0, currentGainConfig.collapseFadeBeats);
    }

    // Schedule re-mute of return track after effect completes
    const rejectionMs = state.config.timing.rejectionEffectDurationMs;
    const timer = setTimeout(() => {
      oscBridge.send('/live/return/set/mute', layout.rejectionReturnTrackIndex, 1);
      routerState.rejectionTimers.delete(cue.attemptIndex);
    }, rejectionMs);

    routerState.rejectionTimers.set(cue.attemptIndex, timer);
  }

  function handleConsensusActivate(cue: Extract<AudioCue, { type: 'consensus_activate' }>): void {
    ensureTransportStarted();

    // Snap to entry gain then swell to unity
    unmuteTrack(cue.audioRef.trackIndex);
    setGain(cue.audioRef.trackIndex, currentGainConfig.entryGain);
    fadeGain(cue.audioRef.trackIndex, 1.0, currentGainConfig.consensusSwellBeats);
    routerState.activeLayerTracks.set(cue.layerType, cue.audioRef.trackIndex);
  }

  function handleMixUpdate(
    cue: Extract<AudioCue, { type: 'mix_update' }>,
    state: ShowState,
  ): void {
    for (const change of cue.changes) {
      const { layerType, fragmentId } = change;

      // Fade out the track previously assigned to this layer (if any)
      const previousTrack = routerState.activeLayerTracks.get(layerType);
      if (previousTrack !== undefined) {
        fadeGain(previousTrack, 0, currentGainConfig.lockInFadeBeats);
      }

      if (fragmentId !== null) {
        const fragment = state.finaleState?.allFragments.find(f => f.id === fragmentId);
        if (fragment) {
          const newTrack = fragment.audioRef.trackIndex;
          unmuteTrack(newTrack);
          setGain(newTrack, currentGainConfig.entryGain);
          fadeGain(newTrack, 1.0, currentGainConfig.consensusSwellBeats);
          routerState.activeLayerTracks.set(layerType, newTrack);
        } else {
          console.warn(`[AudioRouter] mix_update: fragment ${fragmentId} not found in allFragments`);
          routerState.activeLayerTracks.delete(layerType);
        }
      } else {
        // Layer being muted — no new track
        routerState.activeLayerTracks.delete(layerType);
      }
    }
  }

  function handleTransport(cue: Extract<AudioCue, { type: 'transport' }>): void {
    if (cue.action === 'play') {
      oscBridge.send('/live/song/start_playing');
      routerState.transportStarted = true;
    } else {
      stopPlayback();
    }
  }

  function handlePanic(): void {
    silenceAllTracks();
  }

  /**
   * Emergency reset: set all Utility gains to 0 dB and unmute all tracks.
   * Allows the performer to take over from Ableton's mixer.
   */
  function handleResetUtilities(): void {
    // Cancel all in-flight fades and sub-beat timers
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
      gs.subBeatTimers = [];
    }

    for (let i = 0; i < totalTracks; i++) {
      const deviceInfo = routerState.deviceCache.get(i);
      if (deviceInfo) {
        // Set to unity gain (0 dB in Ableton's normalized scale)
        oscBridge.send(
          '/live/device/set/parameter/value',
          i,
          deviceInfo.utilityDeviceIndex,
          deviceInfo.gainParamIndex,
          currentGainConfig.unityGainValue,
        );
      }
      // Unmute regardless of whether a Utility device was found
      // oscBridge.send('/live/track/set/mute', i, 0);
      // routerState.unmutedTracks.add(i);

      const gs = getOrCreateTrackGainState(i);
      gs.currentGain = 1.0;
      gs.activeFadeId = null;
    }

    routerState.activeLayerTracks.clear();
    console.log('[AudioRouter] reset_utilities: all Utility gains set to 0 dB, all tracks unmuted');
  }

  // --------------------------------------------------------------------------
  // Main Event Loop
  // --------------------------------------------------------------------------

  function handleStateChange(state: ShowState, events: ConductorEvent[]): void {
    // Keep gain config in sync with show config
    currentGainConfig = state.config.timing.gain ?? DEFAULT_GAIN_CONFIG;

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
          case 'reset_utilities':
            handleResetUtilities();
            break;
        }
      }

      if (event.type === 'ATTEMPT_COMPLETED') {
        // Silence all tracks; transport keeps running (clips continue looping silently)
        silenceAllTracks();
        clearCollapseTimers();
        clearRejectionTimers();
      }

      if (event.type === 'SHOW_RESET') {
        silenceAllTracks();
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
    // Cancel all in-flight fades and sub-beat timers
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
    }
    routerState.trackGains.clear();
    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();
    routerState.transportStarted = false;
    clearCollapseTimers();
    clearRejectionTimers();
  }

  return {
    handleStateChange,
    discoverDevices,
    dispose,
  };
}

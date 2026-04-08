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
  LayerType,
  GainConfig,
} from '../conductor/types';

// ============================================================================
// Layout Configuration
// ============================================================================

export interface AbletonLayoutConfig {
  maxLayersPerAttempt: number;         // Default: 6
  attemptCount: number;                // Default: 3
  collapseReturnTrackIndex: number;    // Return track index for collapse effects
  rejectionReturnTrackIndex: number;   // Return track index for rejection effects
  utilityDeviceName: string;           // Device name to search for (e.g. "Utility")
  utilityGainParamName: string;        // Parameter name for gain (e.g. "Gain")
}

const DEFAULT_LAYOUT: AbletonLayoutConfig = {
  maxLayersPerAttempt: 6,
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
  ceremonySwellBeats: 4,
  crossfadeBeats: 1,
  unityGainValue: 0,
  stepsPerBeat: 2,
};

const COLLAPSE_TEMPO_RAMP_DURATION_MS = 2000;
const COLLAPSE_TEMPO_FLOOR_BPM = 20;
const COLLAPSE_DELAY_TAIL_MS = 10000;
const NOMINAL_TEMPO_BPM = 120;
const TEMPO_RAMP_STEPS = 20;

// ============================================================================
// Track Index Computation
// ============================================================================

/**
 * Compute Ableton track index from attempt, layer, and option.
 *
 * Formula: attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset
 *
 * NOTE: This assumes a contiguous layout with no group tracks intermixed.
 * The real Ableton layout (default-show.json) has group tracks at indices 0, 3-7, 13,
 * so AudioReference.trackIndex values come from the show config, not this formula.
 * This function is only valid for test fixtures that use a flat layout.
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
  /** Discover Utility devices on fragment tracks. Pass ShowState to target only known tracks. */
  discoverDevices(state?: ShowState): Promise<void>;
  /** Authoritative panic: query Ableton for all tracks, mute every non-foldable, reset gains */
  masterPanic(): Promise<void>;
  /** Reset state and re-discover devices after bridge (re)connect */
  onBridgeReconnect(state: ShowState): Promise<void>;
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
  deviceCache: Map<"master" | number, TrackDeviceInfo>;
  /** Whether device discovery has completed */
  discoveryComplete: boolean;
  /** Monotonic counter for unique fade IDs */
  fadeCounter: number;
  /** Whether the global transport has been started */
  transportStarted: boolean;
  /** Pending collapse cleanup timers, keyed by attemptIndex */
  collapseTimers: Map<number, NodeJS.Timeout>;
  /** In-flight tempo ramp step timers for the collapse gesture */
  tempoRampTimers: NodeJS.Timeout[];
  /** In-flight wall-clock gain ramp timers for the collapse gesture */
  collapseGainRampTimers: NodeJS.Timeout[];
  /** Scheduled Master delay disable timer for the collapse gesture */
  collapseDelayTimer: NodeJS.Timeout | null;
  /** Pending rejection cleanup timers, keyed by attemptIndex */
  rejectionTimers: Map<number, NodeJS.Timeout>;
  /** Active layer type → track index for performer mix */
  activeLayerTracks: Map<LayerType, number>;
  /** Authoritative set of fragment track indices, built from ShowState */
  fragmentTrackIndices: Set<number>;
  /** Base tempo derived from config (first attempt, first layer), used for resets */
  baseTempo: number;
  /** Track indices identified as foldable (group tracks) during discovery — never muted */
  foldableTracks: Set<number>;
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
    tempoRampTimers: [],
    collapseGainRampTimers: [],
    collapseDelayTimer: null,
    rejectionTimers: new Map(),
    activeLayerTracks: new Map(),
    fragmentTrackIndices: new Set(),
    baseTempo: NOMINAL_TEMPO_BPM,
    foldableTracks: new Set(),
  };

  // Last-seen gain config, updated at the top of handleStateChange
  let currentGainConfig: GainConfig = { ...DEFAULT_GAIN_CONFIG };

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

  /** Low-level Ableton track mute (for session view legibility). Skips foldable (group) tracks. */
  function muteTrack(trackIndex: number): void {
    if (routerState.foldableTracks.has(trackIndex)) return;
    oscBridge.send('/live/track/set/mute', trackIndex, 1);
    routerState.unmutedTracks.delete(trackIndex);
  }

  /** Low-level Ableton track unmute (for session view legibility). Always sends OSC. */
  function unmuteTrack(trackIndex: number): void {
    oscBridge.send('/live/track/set/mute', trackIndex, 0);
    routerState.unmutedTracks.add(trackIndex);
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
      if (routerState.discoveryComplete) {
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

    // Equal-power easing for perceptually smooth fades.
    // easeProgress always maps 0→0, 1→1 (no transition → full transition).
    // Fade-out: slow departure from full gain, accelerates toward silence.
    // Fade-in: fast departure from silence, decelerates toward full gain.
    // Both keep perceived loudness constant during overlapping crossfades.
    const fadingOut = targetGain < startGain;
    const easeProgress = (t: number): number => {
      return fadingOut
        ? 1 - Math.cos(t * Math.PI / 2)   // Slow start (stays loud), fast end (drops to silence)
        : Math.sin(t * Math.PI / 2);       // Fast start (jumps from silence), slow end (eases into full)
    };

    timingEngine.schedulePerBeat(
      fadeId,
      fromBeat,
      durationBeats,
      (beatIndex: number, totalBeats: number) => {
        // On-beat step — snap to target on final beat to avoid floating-point drift
        const progress = (beatIndex + 1) / totalBeats;
        const newGain = progress >= 1.0
          ? targetGain
          : startGain + (targetGain - startGain) * easeProgress(progress);
        setGain(trackIndex, Math.max(0, Math.min(1, newGain)));

        // Sub-beat steps between this beat and the next
        const stepsPerBeat = currentGainConfig.stepsPerBeat ?? 1;
        if (stepsPerBeat > 1 && beatIndex < totalBeats - 1) {
          const nextProgress = (beatIndex + 2) / totalBeats;
          const beatMs = timingEngine!.getBeatDurationMs();
          for (let s = 1; s < stepsPerBeat; s++) {
            const frac = s / stepsPerBeat;
            const subProgress = progress + (nextProgress - progress) * frac;
            const easedSubProgress = easeProgress(subProgress);
            const subGain = startGain + (targetGain - startGain) * easedSubProgress;
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

  /**
   * Immediately silence all known fragment tracks:
   * - Cancels all in-flight fades (synchronous)
   * - Mutes every track in fragmentTrackIndices (built from ShowState — no Ableton query needed)
   * - Sets Utility device gains to -1 on tracks with a cached device
   *
   * Does NOT stop transport — callers that need that should call stopPlayback() separately.
   */
  function silenceAllTracks(): void {
    // Cancel all in-flight fades and sub-beat timers immediately
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
      gs.subBeatTimers = [];
    }
    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();

    for (const i of routerState.fragmentTrackIndices) {
      if (routerState.foldableTracks.has(i)) continue;
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
      const gs = getOrCreateTrackGainState(i);
      gs.currentGain = 0;
      oscBridge.send('/live/track/set/mute', i, 1);
    }
  }

  function clearCollapseTimers(): void {
    for (const timer of routerState.collapseTimers.values()) clearTimeout(timer);
    routerState.collapseTimers.clear();
    for (const timer of routerState.tempoRampTimers) clearTimeout(timer);
    routerState.tempoRampTimers = [];
    for (const timer of routerState.collapseGainRampTimers) clearTimeout(timer);
    routerState.collapseGainRampTimers = [];
    if (routerState.collapseDelayTimer) {
      clearTimeout(routerState.collapseDelayTimer);
      routerState.collapseDelayTimer = null;
    }
    oscBridge.send('/live/song/set/tempo', routerState.baseTempo);
    oscBridge.send('/live/device/set/parameter/value', 'master', 0, 0, 0);
  }

  function clearRejectionTimers(): void {
    for (const timer of routerState.rejectionTimers.values()) clearTimeout(timer);
    routerState.rejectionTimers.clear();
  }

  function ensureTransportStarted(): void {
    waitForOSC('/live/song/get/is_playing').then((isPlaying: any) => {
      if (!isPlaying || !isPlaying[0]) {
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
  // Fragment Track Set
  // --------------------------------------------------------------------------

  /**
   * Build the authoritative set of fragment track indices from ShowState.
   * Replaces the computed `totalTracks` constant — treats the show config as source of truth.
   */
  function updateFragmentTrackSet(state: ShowState): void {
    routerState.fragmentTrackIndices.clear();
    for (const attempt of state.attempts) {
      for (const layer of attempt.layerPlan) {
        // V3.2: layers have TrackBundles (multiple tracks per option)
        for (const track of layer.optionA.tracks) {
          for (const idx of track.trackIndices) routerState.fragmentTrackIndices.add(idx);
        }
        for (const track of layer.optionB.tracks) {
          for (const idx of track.trackIndices) routerState.fragmentTrackIndices.add(idx);
        }
      }
      // Also register live seed tracks
      const attemptCfg = state.config.attempts[attempt.index];
      for (const idx of (attemptCfg?.liveSeed?.trackIndices ?? [])) {
        routerState.fragmentTrackIndices.add(idx);
      }
    }
    if (state.finaleState) {
      for (const fragment of state.finaleState.allFragments) {
        for (const idx of fragment.trackIndices) routerState.fragmentTrackIndices.add(idx);
      }
    }
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
   * Wait for an OSC response correlated by track index (first arg).
   * Uses a persistent `on()` listener that resolves only when the first arg
   * matches the expected trackId. Cleans up after match or timeout.
   */
  function waitForOSCCorrelated(
    listenAddress: string,
    trackId: number | "master",
    timeoutMs: number = 2000,
  ): Promise<any[] | null> {
    return new Promise<any[] | null>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          oscBridge.off(listenAddress, handler);
          resolve(null);
        }
      }, timeoutMs);

      function handler(...args: any[]) {
        if (resolved) return;
        // AbletonOSC responses include track_id as first arg
        if (args[0] === trackId) {
          resolved = true;
          clearTimeout(timer);
          oscBridge.off(listenAddress, handler);
          resolve(args);
        }
      }

      oscBridge.on(listenAddress, handler);
    });
  }

  /**
   * Discover and cache the Utility device info for a single track.
   * Uses bulk `/live/track/get/devices/name` to get all device names in one call,
   * then queries only the Utility device's parameters.
   * If multiple Utility devices exist on a track, uses the LAST one
   * (the one closest to the output in the device chain).
   */
  async function discoverTrackDevice(trackIndex: number | "master"): Promise<void> {
    // Check if this is a foldable (group) track — skip device discovery if so
    if (trackIndex !== "master") {
      oscBridge.send('/live/track/get/is_foldable', trackIndex);
      const foldableResp = await waitForOSCCorrelated('/live/track/get/is_foldable', trackIndex);
      if (foldableResp?.[1] === true) {
        console.log(`[AudioRouter] foldable track: ${trackIndex} is foldable`);
        routerState.foldableTracks.add(trackIndex);
        return;
      }
    }

    // Bulk query: get all device names on this track in one round-trip
    oscBridge.send('/live/track/get/devices/name', trackIndex);
    const namesResp = await waitForOSCCorrelated('/live/track/get/devices/name', trackIndex);
    if (!namesResp) {
      console.warn(`[AudioRouter] discover: no response for track ${trackIndex} devices/name`);
      return;
    }

    // Response format: [trackIndex, name0, name1, ...]
    const deviceNames = namesResp.slice(1) as string[];
    if (deviceNames.length === 0) return;

    // Find the LAST Utility device in the chain
    let utilityDeviceIndex = -1;
    for (let i = deviceNames.length - 1; i >= 0; i--) {
      if (deviceNames[i] === layout.utilityDeviceName) {
        utilityDeviceIndex = i;
        break;
      }
    }
    if (utilityDeviceIndex < 0) return;

    // Query only the Utility device's parameter names
    oscBridge.send('/live/device/get/parameters/name', trackIndex, utilityDeviceIndex);
    const paramResp = await waitForOSCCorrelated('/live/device/get/parameters/name', trackIndex);
    if (!paramResp) return;

    // Response format: [trackIndex, deviceIndex, name0, name1, ...]
    const paramNames = paramResp.slice(2) as string[];
    const gainParamIndex = paramNames.indexOf(layout.utilityGainParamName);

    if (gainParamIndex >= 0) {
      routerState.deviceCache.set(trackIndex, { utilityDeviceIndex, gainParamIndex });
      console.log(`[AudioRouter] Track ${trackIndex}: Utility device ${utilityDeviceIndex}, Gain param ${gainParamIndex}`);
    } else {
      console.warn(`[AudioRouter] Track ${trackIndex}: Utility device found but no "${layout.utilityGainParamName}" param`);
    }
  }

  /**
   * Discover Utility devices on fragment tracks.
   * Call once after the OSC bridge starts.
   *
   * Fires all track discovery queries in parallel for fast startup.
   * If state is provided, only discovers tracks in the show config (skips group tracks).
   * Otherwise falls back to querying Ableton for total track count.
   */
  async function discoverDevices(state?: ShowState): Promise<void> {
    if (state) {
      updateFragmentTrackSet(state);
    }

    // Build list of track indices to discover
    let trackList: (number | "master")[];

    if (routerState.fragmentTrackIndices.size > 0) {
      trackList = Array.from(routerState.fragmentTrackIndices).sort((a, b) => a - b);
      trackList.push("master");
      console.log(`[AudioRouter] Starting device discovery for ${trackList.length} tracks (parallel)...`);
    } else {
      // Fallback: query Ableton for total track count
      oscBridge.send('/live/song/get/num_tracks');
      const numTracksResp = await waitForOSC('/live/song/get/num_tracks');
      const numTracks = numTracksResp?.[0] ?? 42;
      trackList = [];
      for (let i = 0; i < numTracks; i++) trackList.push(i);
      trackList.push("master");
      console.log(`[AudioRouter] Starting device discovery for ${numTracks} tracks (parallel, fallback)...`);
    }

    // Fire all track discoveries in parallel
    // Temporarily raise listener limit to avoid MaxListenersExceededWarning
    // (each parallel discovery adds a listener on the same OSC response address)
    const prevMax = oscBridge.getMaxListeners();
    oscBridge.setMaxListeners(trackList.length * 3 + prevMax);
    await Promise.all(trackList.map(trackIndex => discoverTrackDevice(trackIndex)));
    oscBridge.setMaxListeners(prevMax);

    routerState.discoveryComplete = true;
    console.log(`[AudioRouter] Device discovery complete. ${routerState.deviceCache.size} tracks have Utility devices.`);
  }

  // --------------------------------------------------------------------------
  // AudioCue Handlers
  // --------------------------------------------------------------------------

  function handleSetTempo(cue: Extract<AudioCue, { type: 'set_tempo' }>): void {
    oscBridge.send('/live/song/set/tempo', cue.bpm);
    console.log(`[AudioRouter] set_tempo: ${cue.bpm} BPM (attempt ${cue.attemptIndex}, layer ${cue.layerIndex})`);
  }

  function handleAuditionStart(
    cue: Extract<AudioCue, { type: 'audition_start' }>,
  ): void {
    ensureTransportStarted();

    const { trackBundle, otherTrackBundle } = cue;

    // Fade out all tracks in the outgoing bundle
    for (const track of otherTrackBundle.tracks) {
      for (const idx of track.trackIndices) fadeGain(idx, 0, currentGainConfig.exitFadeBeats);
    }

    // Bring in all tracks in the incoming bundle: unmute, snap to entryGain, swell to unity
    for (const track of trackBundle.tracks) {
      for (const idx of track.trackIndices) {
        unmuteTrack(idx);
        setGain(idx, currentGainConfig.entryGain);
        fadeGain(idx, 1.0, currentGainConfig.entrySwellBeats);
      }
    }
  }

  function handleAuditionStop(cue: Extract<AudioCue, { type: 'audition_stop' }>): void {
    if (!cue.trackBundle) {
      // No active audition — nothing to fade
      return;
    }
    for (const track of cue.trackBundle.tracks) {
      for (const idx of track.trackIndices) fadeGain(idx, 0, currentGainConfig.exitFadeBeats);
    }
    // Note: transport continues running; clips keep looping silently
  }

  function handleLockIn(cue: Extract<AudioCue, { type: 'lock_in' }>): void {
    const { winnerTrackBundle, loserTrackBundle } = cue;

    // Winner tracks: cancel in-flight fades, snap to full gain
    for (const track of winnerTrackBundle.tracks) {
      for (const idx of track.trackIndices) {
        const gs = getOrCreateTrackGainState(idx);
        if (gs.activeFadeId) {
          timingEngine?.cancelCallbacks(gs.activeFadeId);
          gs.activeFadeId = null;
        }
        unmuteTrack(idx);
        fadeGain(idx, 1.0, currentGainConfig.entrySwellBeats);
      }
    }

    // Loser tracks: fade to silent
    for (const track of loserTrackBundle.tracks) {
      for (const idx of track.trackIndices) fadeGain(idx, 0, currentGainConfig.lockInFadeBeats);
    }
  }

  /**
   * Linearly ramp the Ableton tempo from `fromBpm` to `toBpm` over `durationMs`.
   * Cancels any in-flight ramp before starting. Replaces routerState.tempoRampTimers.
   */
  function startTempoRamp(fromBpm: number, toBpm: number, durationMs: number): void {
    for (const t of routerState.tempoRampTimers) clearTimeout(t);
    routerState.tempoRampTimers = [];

    // oscBridge.send('/live/song/get/num_tracks');
    // const numTracksResp = await waitForOSC('/live/song/get/num_tracks');
    // if (!numTracksResp) {
    //   console.warn('[AudioRouter] silenceAllTracks: no response for num_tracks');
    //   return;
    // }
    // const numTracks = numTracksResp[0] as number;


    const stepMs = durationMs / TEMPO_RAMP_STEPS;
    for (let i = 1; i <= TEMPO_RAMP_STEPS; i++) {
      const t = i / TEMPO_RAMP_STEPS;
      const bpm = fromBpm + (toBpm - fromBpm) * t;
      const timer = setTimeout(() => {
        oscBridge.send('/live/song/set/tempo', bpm);
      }, stepMs * i);
      routerState.tempoRampTimers.push(timer);
    }
  }

  /**
   * Wall-clock gain ramp for the collapse gesture.
   * Ramps all given tracks from their current gain to 0 over `durationMs`,
   * then hard-mutes them at the end. Decoupled from the beat clock so the
   * simultaneous tempo ramp-down doesn't stretch the fade.
   */
  function startCollapseGainRamp(trackIndices: number[], durationMs: number): void {
    for (const timer of routerState.collapseGainRampTimers) clearTimeout(timer);
    routerState.collapseGainRampTimers = [];

    const steps = TEMPO_RAMP_STEPS;
    const stepMs = durationMs / steps;

    // Snapshot each track's starting gain
    const startGains = trackIndices.map(i => getOrCreateTrackGainState(i).currentGain);

    // Cancel any beat-locked fades on these tracks so they don't fight
    for (const i of trackIndices) {
      const gs = getOrCreateTrackGainState(i);
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const t of gs.subBeatTimers) clearTimeout(t);
      gs.subBeatTimers = [];
    }

    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const timer = setTimeout(() => {
        for (let j = 0; j < trackIndices.length; j++) {
          const gain = startGains[j] * (1 - progress);
          setGain(trackIndices[j], Math.max(0, gain));
        }

        // Hard-mute all tracks on the final step
        if (step === steps) {
          for (const i of trackIndices) {
            oscBridge.send('/live/track/set/mute', i, 1);
          }
        }
      }, stepMs * step);
      routerState.collapseGainRampTimers.push(timer);
    }
  }

  function handleLiveSeedStart(cue: Extract<AudioCue, { type: 'live_seed_start' }>): void {
    ensureTransportStarted();
    for (const trackIndex of cue.trackIndices) {
      unmuteTrack(trackIndex);
      setGain(trackIndex, currentGainConfig.entryGain);
      fadeGain(trackIndex, 1.0, currentGainConfig.entrySwellBeats);
    }
  }

  function handleLiveSeedStop(cue: Extract<AudioCue, { type: 'live_seed_stop' }>): void {
    for (const trackIndex of cue.trackIndices) {
      fadeGain(trackIndex, 0, currentGainConfig.collapseFadeBeats);
    }
  }

  async function handleCollapseGesture(
    cue: Extract<AudioCue, { type: 'collapse_gesture' }>,
    state: ShowState,
  ): Promise<void> {
    // Collect all track indices for the collapsing attempt (V3.2: iterate TrackBundle tracks)
    const collapseTrackIndices: number[] = [];
    for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
      for (const track of layer.optionA.tracks) collapseTrackIndices.push(...track.trackIndices);
      for (const track of layer.optionB.tracks) collapseTrackIndices.push(...track.trackIndices);
    }
    // Include live seed tracks
    const liveSeedIndices = state.config.attempts[cue.attemptIndex]?.liveSeed?.trackIndices ?? [];
    collapseTrackIndices.push(...liveSeedIndices);

    // Enable Master track delay device at the start of the collapse
    oscBridge.send('/live/device/set/parameter/value', 'master', 0, 0, 1);

    // Wall-clock gain ramp to 0, decoupled from beat clock
    startCollapseGainRamp(collapseTrackIndices, COLLAPSE_TEMPO_RAMP_DURATION_MS);

    // Query current tempo then ramp down to COLLAPSE_TEMPO_FLOOR_BPM over the same duration
    oscBridge.send('/live/song/get/tempo');
    const tempoResp = await waitForOSC('/live/song/get/tempo');
    const currentTempo = (tempoResp?.[0] as number) ?? NOMINAL_TEMPO_BPM;
    startTempoRamp(currentTempo, COLLAPSE_TEMPO_FLOOR_BPM, COLLAPSE_TEMPO_RAMP_DURATION_MS);

    // Schedule Master delay disable after gain ramp + tail duration
    if (routerState.collapseDelayTimer) {
      clearTimeout(routerState.collapseDelayTimer);
    }
    routerState.collapseDelayTimer = setTimeout(() => {
      oscBridge.send('/live/device/set/parameter/value', 'master', 0, 0, 0);
      routerState.collapseDelayTimer = null;
    }, COLLAPSE_TEMPO_RAMP_DURATION_MS + COLLAPSE_DELAY_TAIL_MS);

    // Schedule cleanup: snap tempo back to nominal after the full collapse window
    const collapseMs = state.config.timing.revealSequenceDurationMs;
    const timer = setTimeout(() => {
      oscBridge.send('/live/song/set/tempo', routerState.baseTempo);
      routerState.collapseTimers.delete(cue.attemptIndex);
      setTimeout(() => {
        oscBridge.send('/live/song/stop_playing');
      }, 3000);
    }, collapseMs);
    

    routerState.collapseTimers.set(cue.attemptIndex, timer);
  }

  function handleRejectionGesture(
    cue: Extract<AudioCue, { type: 'rejection_gesture' }>,
    state: ShowState,
  ): void {
    // Enable rejection return track effects
    oscBridge.send('/live/return/set/mute', layout.rejectionReturnTrackIndex, 0);

    // Fade all tracks in the rejected attempt to 0 (V3.2: iterate TrackBundle tracks)
    for (const layer of state.attempts[cue.attemptIndex].layerPlan) {
      for (const track of layer.optionA.tracks) {
        for (const idx of track.trackIndices) fadeGain(idx, 0, currentGainConfig.collapseFadeBeats);
      }
      for (const track of layer.optionB.tracks) {
        for (const idx of track.trackIndices) fadeGain(idx, 0, currentGainConfig.collapseFadeBeats);
      }
    }
    // Live seed faded by the separate live_seed_stop cue emitted by the conductor

    // Schedule re-mute of return track and tempo reset after effect completes
    const rejectionMs = state.config.timing.rejectionEffectDurationMs;
    const timer = setTimeout(() => {
      oscBridge.send('/live/return/set/mute', layout.rejectionReturnTrackIndex, 1);
      oscBridge.send('/live/song/set/tempo', routerState.baseTempo);
      routerState.rejectionTimers.delete(cue.attemptIndex);
    }, rejectionMs);

    routerState.rejectionTimers.set(cue.attemptIndex, timer);
  }

  // V3.3: Quilt playback start — unmute initial column tracks
  function handleQuiltPlaybackStart(cue: Extract<AudioCue, { type: 'quilt_playback_start' }>): void {
    if (cue.jumpToBeatZero) {
      oscBridge.send('/live/song/stop_playing');
      oscBridge.send('/live/song/set/current_song_time', 0);
      oscBridge.send('/live/song/start_playing');
      routerState.transportStarted = true;
    } else {
      ensureTransportStarted();
    }
    for (const trackIndex of cue.trackIndices) {
      unmuteTrack(trackIndex);
      setGain(trackIndex, 1.0);
    }
  }

  // V3.3: Quilt column change — crossfade tracks at column boundary
  function handleQuiltColumnChange(cue: Extract<AudioCue, { type: 'quilt_column_change' }>): void {
    const xfadeBeats = currentGainConfig.crossfadeBeats ?? 1;
    for (const change of cue.trackChanges) {
      for (const ti of change.muteTracks) {
        fadeGain(ti, 0, xfadeBeats);
      }
      for (const ti of change.unmuteTracks) {
        fadeGain(ti, 1.0, xfadeBeats);
      }
    }

    // Safety mute: silence any tracks that are unmuted but shouldn't be active
    // for the incoming column. Catches bleedthrough from edge cases (swaps,
    // reorders, or missed mutes from prior columns).
    const expected = new Set(cue.expectedTracks);
    // Also keep tracks that are actively being crossfaded out (they'll reach 0 on their own)
    for (const change of cue.trackChanges) {
      for (const ti of change.muteTracks) expected.add(ti);
    }
    for (const trackIndex of routerState.unmutedTracks) {
      if (!expected.has(trackIndex)) {
        setGain(trackIndex, 0);
      }
    }
  }

  // V3.3: Quilt mute cell
  function handleQuiltMuteCell(cue: Extract<AudioCue, { type: 'quilt_mute_cell' }>): void {
    for (const ti of cue.trackIndices) {
      fadeGain(ti, 0, currentGainConfig.lockInFadeBeats);
    }
  }

  // V3.3: Quilt unmute cell
  function handleQuiltUnmuteCell(cue: Extract<AudioCue, { type: 'quilt_unmute_cell' }>): void {
    for (const ti of cue.trackIndices) {
      unmuteTrack(ti);
      setGain(ti, 1.0);
    }
  }

  // V3.3 Arc: Staggered row group unmute during entry
  function handleQuiltRowUnmute(cue: Extract<AudioCue, { type: 'quilt_row_unmute' }>): void {
    for (const trackIndex of cue.trackIndices) {
      unmuteTrack(trackIndex);
      fadeGain(trackIndex, 1.0, currentGainConfig.entrySwellBeats);
    }
  }

  // V3.3 Arc: Staggered row group mute during exit
  function handleQuiltRowMute(cue: Extract<AudioCue, { type: 'quilt_row_mute' }>): void {
    for (const trackIndex of cue.trackIndices) {
      fadeGain(trackIndex, 0, currentGainConfig.exitFadeBeats);
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
    stopPlayback();
  }

  /**
   * Authoritative master panic: queries Ableton for total track count, then
   * mutes every non-foldable track and resets Utility gains to -inf.
   * Foldable (group) tracks are unmuted. Master track gain reset to unity.
   * Unlike handlePanic(), this doesn't rely on the config-driven fragmentTrackIndices —
   * it discovers the full track list from Ableton directly.
   */
  async function masterPanic(): Promise<void> {
    console.log('[AudioRouter] Master panic: querying Ableton for full track list...');

    // 1. Cancel all in-flight fades and sub-beat timers
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
        gs.activeFadeId = null;
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
      gs.subBeatTimers = [];
    }
    routerState.unmutedTracks.clear();
    routerState.activeLayerTracks.clear();
    clearCollapseTimers();
    clearRejectionTimers();

    // 2. Query Ableton for total track count
    oscBridge.send('/live/song/get/num_tracks');
    const numTracksResp = await waitForOSC('/live/song/get/num_tracks');
    const numTracks = numTracksResp?.[0] ?? 0;
    if (numTracks === 0) {
      console.warn('[AudioRouter] Master panic: no track count from Ableton, aborting');
      return;
    }

    // 3. Process each track in parallel — check foldable, mute/reset non-foldable
    const trackIndices: number[] = [];
    for (let i = 0; i < numTracks; i++) trackIndices.push(i);

    const prevMax = oscBridge.getMaxListeners();
    oscBridge.setMaxListeners(numTracks * 3 + prevMax);

    let mutedCount = 0;
    let foldableCount = 0;

    await Promise.all(trackIndices.map(async (trackIndex) => {
      // Check if foldable (group track)
      oscBridge.send('/live/track/get/is_foldable', trackIndex);
      const foldableResp = await waitForOSCCorrelated('/live/track/get/is_foldable', trackIndex);

      if (foldableResp?.[1] === true) {
        // Group track — unmute it so groups are open
        foldableCount++;
        oscBridge.send('/live/track/set/mute', trackIndex, 0);
        return;
      }

      // Non-foldable — mute and reset gain
      mutedCount++;

      // Use cached device info if available, otherwise discover on the fly
      let deviceInfo = routerState.deviceCache.get(trackIndex);
      if (!deviceInfo) {
        await discoverTrackDevice(trackIndex);
        deviceInfo = routerState.deviceCache.get(trackIndex);
      }

      if (deviceInfo) {
        oscBridge.send(
          '/live/device/set/parameter/value',
          trackIndex,
          deviceInfo.utilityDeviceIndex,
          deviceInfo.gainParamIndex,
          -1,
        );
      }

      const gs = getOrCreateTrackGainState(trackIndex);
      gs.currentGain = 0;
      oscBridge.send('/live/track/set/mute', trackIndex, 1);
    }));

    oscBridge.setMaxListeners(prevMax);

    // 4. Reset master track Utility gain to unity (0 dB)
    const masterDevice = routerState.deviceCache.get('master');
    if (masterDevice) {
      oscBridge.send(
        '/live/device/set/parameter/value',
        'master',
        masterDevice.utilityDeviceIndex,
        masterDevice.gainParamIndex,
        0,
      );
    }

    // 5. Stop transport
    stopPlayback();

    console.log(`[AudioRouter] Master panic complete. Muted ${mutedCount} tracks, skipped ${foldableCount} foldable.`);
  }

  /**
   * Emergency reset: set all Utility gains to 0 dB on fragment tracks.
   * Allows the performer to take over from Ableton's mixer.
   * Note: tracks are not unmuted — performers can adjust manually in Ableton.
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

    for (const i of routerState.fragmentTrackIndices) {
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

      const gs = getOrCreateTrackGainState(i);
      gs.currentGain = 1.0;
      gs.activeFadeId = null;
    }

    routerState.activeLayerTracks.clear();
    console.log('[AudioRouter] reset_utilities: all Utility gains set to 0 dB');
  }

  // --------------------------------------------------------------------------
  // Main Event Loop
  // --------------------------------------------------------------------------

  function handleStateChange(state: ShowState, events: ConductorEvent[]): void {
    // Keep gain config in sync with show config
    currentGainConfig = state.config.timing.gain ?? DEFAULT_GAIN_CONFIG;
    // Derive base tempo from config (first attempt, first layer)
    routerState.baseTempo = state.config.attempts[0]?.tempos?.[0] ?? NOMINAL_TEMPO_BPM;
    // Rebuild fragment track set from state (Ableton layout as source of truth)
    updateFragmentTrackSet(state);

    for (const event of events) {
      if (event.type === 'AUDIO_CUE') {
        const cue = event.cue;
        switch (cue.type) {
          case 'set_tempo':
            handleSetTempo(cue);
            break;
          case 'audition_start':
            handleAuditionStart(cue);
            break;
          case 'audition_stop':
            handleAuditionStop(cue);
            break;
          case 'lock_in':
            handleLockIn(cue);
            break;
          case 'live_seed_start':
            handleLiveSeedStart(cue);
            break;
          case 'live_seed_stop':
            handleLiveSeedStop(cue);
            break;
          case 'collapse_gesture':
            handleCollapseGesture(cue, state);
            break;
          case 'rejection_gesture':
            handleRejectionGesture(cue, state);
            break;
          case 'quilt_playback_start':
            handleQuiltPlaybackStart(cue);
            break;
          case 'quilt_column_change':
            handleQuiltColumnChange(cue);
            break;
          case 'quilt_reorder':
            // No immediate audio change — takes effect at next column boundary
            break;
          case 'quilt_mute_cell':
            handleQuiltMuteCell(cue);
            break;
          case 'quilt_unmute_cell':
            handleQuiltUnmuteCell(cue);
            break;
          case 'quilt_row_unmute':
            handleQuiltRowUnmute(cue);
            break;
          case 'quilt_row_mute':
            handleQuiltRowMute(cue);
            break;
          case 'transport':
            handleTransport(cue);
            break;
          case 'panic':
            handlePanic();
            break;
          case 'master_panic':
            // Async — actual work done via audioRouter.masterPanic() from socket handler
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

      if (event.type === 'SHOW_PHASE_CHANGED') {
        const phaseEvent = event as { type: 'SHOW_PHASE_CHANGED'; phase: string };
        if (phaseEvent.phase === 'finale_elegy') {
          oscBridge.send('/live/song/set/tempo', routerState.baseTempo);
          console.log(`[AudioRouter] Tempo reset to ${routerState.baseTempo} BPM at finale_elegy`);
        }
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

  /**
   * Reset state and re-discover devices after bridge (re)connect.
   * Ableton's state is unknown after a reconnect, so we clear all tracked
   * gains, mute state, and device cache, then re-discover.
   */
  async function onBridgeReconnect(state: ShowState): Promise<void> {
    console.log('[AudioRouter] Bridge reconnected — resetting state and re-discovering devices');

    // Cancel all in-flight fades and sub-beat timers
    for (const gs of routerState.trackGains.values()) {
      if (gs.activeFadeId) {
        timingEngine?.cancelCallbacks(gs.activeFadeId);
      }
      for (const timer of gs.subBeatTimers) clearTimeout(timer);
    }

    // Reset tracked state (Ableton state is unknown)
    routerState.trackGains.clear();
    routerState.unmutedTracks.clear();
    routerState.deviceCache.clear();
    routerState.discoveryComplete = false;
    routerState.transportStarted = false;
    routerState.foldableTracks.clear();
    clearCollapseTimers();
    clearRejectionTimers();

    // Re-discover devices
    await discoverDevices(state);
  }

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
    masterPanic,
    onBridgeReconnect,
    dispose,
  };
}

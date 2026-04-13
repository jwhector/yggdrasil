/**
 * Timing Engine — Hybrid Timing with AbletonOSC + Server Timers
 *
 * Manages automatic phase advancement with a hybrid approach:
 * - AbletonOSC beat events drive audition A/B cycling and performer mix loop boundaries
 * - Server JS timers as fallback when OSC unavailable
 * - Per-beat callback scheduler allows audio router to lock gain changes to the musical grid
 *
 * Architecture:
 * - Observes state changes via onStateChanged()
 * - For auditioning: Plays A then B (per-layer auditionBars from AttemptConfig) → sends CLOSE_VOTING
 * - For performer mix: Counts beats/bars → sends FIRE_PENDING_CHANGES at loop boundary
 *
 * Beat Callback Scheduler:
 * - scheduleAtBeat / schedulePerBeat register callbacks at specific absolute beat numbers
 * - handleBeatEvent fires them when their target beat arrives
 * - Works in both OSC mode (real Ableton beats) and fallback mode (synthetic beats)
 *
 * Fallback Mode:
 * - When OSC bridge is not available, uses JS timers for all phases
 * - A synthetic beat ticker generates beats at fallbackBpm for the callback scheduler
 * - Enables testing without Ableton running
 */

import type {
  ShowState,
  ConductorCommand,
  ConductorEvent,
  LayerPhase,
  AuditionProgress,
} from '../conductor/types';
import type { OSCBridge } from './osc';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Timing engine configuration
 */
export interface TimingEngineConfig {
  /** Whether timing engine is enabled */
  enabled: boolean;
  /** OSC bridge for Ableton communication (null = fallback to JS timers) */
  oscBridge: OSCBridge | null;
  /** BPM for fallback timing (default: 120) */
  fallbackBpm: number;
  /** Callback for audition progress updates (~4 Hz during auditioning) */
  onAuditionProgress?: (progress: AuditionProgress) => void;
  /** Callback for remix loop progress updates (every beat during finale_remix) */
  onRemixLoopProgress?: (progress: number) => void;
}

/** Beat position within the current musical context. */
export interface BeatPosition {
  absoluteBeat: number;    // Raw beat number from Ableton (or synthetic)
  rawBeat?: number;        // Raw beat number from Ableton (or synthetic)
  beatInBar: number;       // 0–3 within current bar
  barInLoop: number;       // 0–(barsPerLoop-1) within current loop (driven by config.timing.loopBoundaryBeats)
  loopCount: number;       // Total loops elapsed since beat tracking started
}

/** A scheduled per-beat callback. */
interface BeatCallback {
  id: string;              // Unique ID; use prefix convention for group cancellation
  targetBeat: number;      // Absolute beat number to fire on (fires when beat >= targetBeat)
  callback: () => void;
}

/**
 * Timing engine interface
 */
export interface TimingEngine {
  /** Start the timing engine */
  start(): void;
  /** Stop the timing engine (cancels all timers) */
  stop(): void;
  /** Handle state changes (called after every command) */
  onStateChanged(state: ShowState, events: ConductorEvent[]): void;
  /** Handle incoming OSC messages from Ableton */
  onOSCMessage(address: string, args: any[]): void;
  /** Clean up resources */
  dispose(): void;
  /** Check if engine is running */
  isRunning(): boolean;
  /** Recover and restart finale timers after a server restart. */
  recoverTimers(state: ShowState): void;
  /** Re-subscribe to OSC events and reset beat state after bridge (re)connect. */
  onBridgeReconnect(): void;

  // Beat callback scheduler
  /** Register a callback to fire at a specific absolute beat number. */
  scheduleAtBeat(id: string, targetBeat: number, callback: () => void): void;
  /**
   * Register a callback to fire on each of N consecutive beats starting at startBeat.
   * The callback receives (beatIndex: number, totalBeats: number).
   */
  schedulePerBeat(
    idPrefix: string,
    startBeat: number,
    beatCount: number,
    callback: (beatIndex: number, totalBeats: number) => void,
  ): void;
  /** Cancel all callbacks whose id starts with the given prefix. */
  cancelCallbacks(idPrefix: string): void;
  /** Get the current absolute beat number (0 if no beats received yet). */
  getCurrentBeat(): number;
  /** Get the current beat position (null if no beats received yet). */
  getCurrentBeatPosition(): BeatPosition | null;
  /** Get the duration of one beat in milliseconds. Uses Ableton's BPM via
   *  /live/song/get/tempo when available; falls back to 60000 / fallbackBpm. */
  getBeatDurationMs(): number;
}

/**
 * Internal timer state
 */
interface TimerState {
  timer: NodeJS.Timeout;
  scheduledVersion: number;
  scheduledAt: number;
  durationMs: number;
  phase: string;
}

/**
 * Audition tracking state (for song-building A/B cycling)
 */
interface AuditionTrackingState {
  lastToggleBeat: number;      // Beat number at last option toggle (-1 = not yet set)
  beatsPerLoop: number;        // From config
  totalLoops: number;          // auditionCycles * 2 (each cycle = A + B)
  currentLoopIndex: number;    // 0-based, increments on each toggle
}

/**
 * Remix loop boundary tracking state (V3.4 token pool).
 *
 * Ableton transport loop is the source of truth for loop period. The raw beat
 * position (0–31 for a 32-beat loop) tells us exactly where we are. We fire
 * LOOP_BOUNDARY `preCueBeats` before the transport wraps so the crossfade is
 * already in progress when the new loop starts. The wrap resets the fired flag.
 *
 * In fallback mode, a JS interval fires at configuredLoopBoundaryBeats intervals.
 */
interface RemixLoopTrackingState {
  active: boolean;
  preCueBeats: number;          // How many beats before the wrap to fire LOOP_BOUNDARY
  loopBeats: number;            // configuredLoopBoundaryBeats (for pre-cue threshold)
  firedThisLoop: boolean;       // Prevents double-firing within the same loop
}

const BEATS_PER_BAR = 4;

/**
 * Convert bars to milliseconds at a given BPM.
 */
export function barsToMs(bars: number, bpm: number, beatsPerBar: number = BEATS_PER_BAR): number {
  const msPerBeat = 60000 / bpm;
  return bars * beatsPerBar * msPerBeat;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a timing engine instance.
 *
 * @param sendCommand - Function to send commands (will be processed and broadcast)
 * @param getState - Function to get current show state
 * @param config - Timing engine configuration
 */
export function createTimingEngine(
  sendCommand: (command: ConductorCommand) => void,
  getState: () => ShowState,
  config?: Partial<TimingEngineConfig>,
): TimingEngine {
  const engineConfig: TimingEngineConfig = {
    enabled: true,
    oscBridge: null,
    fallbackBpm: 120,
    ...config,
  };

  // Engine state
  let running = false;
  let currentTimer: TimerState | null = null;
  let auditionState: AuditionTrackingState | null = null;
  let fallbackAuditionInterval: NodeJS.Timeout | null = null;
  let fallbackAuditionLoopIndex = 0;
  let remixLoopState: RemixLoopTrackingState | null = null;
  let fallbackRemixLoopInterval: NodeJS.Timeout | null = null;
  let fallbackRemixProgressInterval: NodeJS.Timeout | null = null;
  let fallbackRemixLoopStartTime: number = 0;
  let configuredLoopBoundaryBeats: number = 32; // Set from config on start/state change

  // Beat callback scheduler state
  let beatCallbacks: BeatCallback[] = [];
  let currentBeatPosition: BeatPosition | null = null;
  let currentAbsoluteBeat: number = 0;
  let loopStartBeat: number = 0;
  let totalLoopsElapsed: number = 0;

  // Monotonic beat tracking (handles Ableton beat wrapping at loop boundaries)
  let previousRawBeat: number = -1;
  let beatWrapOffset: number = 0;

  // Fallback beat ticker (generates synthetic beats when no OSC bridge)
  let fallbackBeatInterval: NodeJS.Timeout | null = null;
  let fallbackBeatCounter: number = 0;

  // BPM from Ableton (for sub-beat interpolation in audio router)
  let currentBpm: number = engineConfig.fallbackBpm;

  // Audition progress emission (~4 Hz)
  let auditionProgressInterval: NodeJS.Timeout | null = null;
  let auditionStartTime: number = 0;

  // --------------------------------------------------------------------------
  // Timer Management
  // --------------------------------------------------------------------------

  /**
   * Cancel current timer if one exists.
   */
  function cancelCurrentTimer(): void {
    if (currentTimer) {
      clearTimeout(currentTimer.timer);
      console.log(`[Timing] Cancelled timer for ${currentTimer.phase}`);
      currentTimer = null;
    }
  }

  /**
   * Schedule a timer to fire after the given duration.
   * Version check disabled — votes update state frequently.
   */
  function scheduleTimer(
    durationMs: number,
    scheduledVersion: number,
    phase: string,
    callback: () => void,
  ): void {
    cancelCurrentTimer();

    const timer = setTimeout(() => {
      console.log(`[Timing] Timer fired for ${phase}`);
      callback();
      currentTimer = null;
    }, durationMs);

    currentTimer = {
      timer,
      scheduledVersion,
      scheduledAt: Date.now(),
      durationMs,
      phase,
    };

    console.log(`[Timing] Scheduled timer for ${phase}: ${durationMs}ms`);
  }

  // --------------------------------------------------------------------------
  // Beat Callback Scheduler
  // --------------------------------------------------------------------------

  /**
   * Register a callback to fire at a specific absolute beat.
   */
  function scheduleAtBeat(id: string, targetBeat: number, callback: () => void): void {
    beatCallbacks.push({ id, targetBeat, callback });
  }

  /**
   * Register a callback to fire on each of N consecutive beats starting at startBeat.
   */
  function schedulePerBeat(
    idPrefix: string,
    startBeat: number,
    beatCount: number,
    callback: (beatIndex: number, totalBeats: number) => void,
  ): void {
    for (let i = 0; i < beatCount; i++) {
      const beatIndex = i;
      scheduleAtBeat(
        `${idPrefix}-${i}`,
        startBeat + i,
        () => callback(beatIndex, beatCount),
      );
    }
  }

  /**
   * Cancel all callbacks whose id starts with the given prefix.
   */
  function cancelCallbacks(idPrefix: string): void {
    beatCallbacks = beatCallbacks.filter(cb => !cb.id.startsWith(idPrefix));
  }

  /**
   * Get the current absolute beat number.
   */
  function getCurrentBeat(): number {
    return currentAbsoluteBeat;
  }

  /**
   * Get the current beat position.
   */
  function getCurrentBeatPosition(): BeatPosition | null {
    return currentBeatPosition;
  }

  function clearAllFinaleTimers(): void {
    stopRemixLoopTracking();
  }

  // --------------------------------------------------------------------------
  // Layer Phase Handlers
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Audition Progress Emission (~4 Hz)
  // --------------------------------------------------------------------------

  const AUDITION_PROGRESS_INTERVAL_MS = 250; // ~4 Hz

  function startAuditionProgressEmission(): void {
    stopAuditionProgressEmission();
    if (!engineConfig.onAuditionProgress) return;

    auditionStartTime = Date.now();

    auditionProgressInterval = setInterval(() => {
      if (!running) return;
      const progress = computeAuditionProgress();
      if (progress && engineConfig.onAuditionProgress) {
        engineConfig.onAuditionProgress(progress);
      }
    }, AUDITION_PROGRESS_INTERVAL_MS);
  }

  function stopAuditionProgressEmission(): void {
    if (auditionProgressInterval) {
      clearInterval(auditionProgressInterval);
      auditionProgressInterval = null;
    }
  }

  function computeAuditionProgress(): AuditionProgress | null {
    const state = getState();
    if (state.phase !== 'attempt_build') return null;

    const attempt = state.attempts[state.currentAttemptIndex];
    if (!attempt || attempt.currentLayerPhase !== 'auditioning') return null;

    const attemptConfig = state.config.attempts[state.currentAttemptIndex];
    const layerIndex = attempt.currentLayerIndex;
    const auditionBars = attemptConfig?.auditionBars?.[layerIndex] ?? 4;
    const tempo = attemptConfig?.tempos?.[layerIndex] ?? engineConfig.fallbackBpm;
    const auditionCycles = attemptConfig?.auditionCycles?.[layerIndex] ?? 1;
    const currentOption = attempt.currentAuditionOption ?? 'A';

    const optionDurationMs = barsToMs(auditionBars, tempo);
    const votingWindowMs = optionDurationMs * auditionCycles * 2;
    const elapsedMs = Date.now() - auditionStartTime;

    // Compute bar progress within the current option's audition
    let barProgress: number;
    if (engineConfig.oscBridge && auditionState) {
      // OSC mode: derive from beat position
      const beatsSinceToggle = auditionState.lastToggleBeat >= 0
        ? currentAbsoluteBeat - auditionState.lastToggleBeat
        : 0;
      barProgress = Math.min(beatsSinceToggle / auditionState.beatsPerLoop, 1.0);
    } else {
      // Fallback mode: derive from elapsed time within current option
      const timeInCurrentOption = elapsedMs % optionDurationMs;
      // After first option switch, use modular position
      if (elapsedMs < optionDurationMs) {
        barProgress = elapsedMs / optionDurationMs;
      } else {
        barProgress = timeInCurrentOption / optionDurationMs;
      }
      barProgress = Math.min(Math.max(barProgress, 0), 1.0);
    }

    return {
      layerIndex,
      currentOption,
      barProgress,
      totalBars: auditionBars,
      tempo,
      votingWindowMs,
      elapsedMs,
    };
  }

  /**
   * Start audition tracking for the current layer.
   * Reads per-layer auditionBars from AttemptConfig to determine timing.
   * Plays A then B (2 total loops), then sends CLOSE_VOTING.
   * OSC mode: counts beats from Ableton. Fallback: JS interval from per-layer tempo.
   */
  function startAuditionTracking(state: ShowState): void {
    stopAuditionTracking();

    const attempt = state.attempts[state.currentAttemptIndex];
    const attemptConfig = state.config.attempts[state.currentAttemptIndex];
    const layerIndex = attempt?.currentLayerIndex ?? 0;

    // Per-layer config from AttemptConfig
    const auditionBars = attemptConfig?.auditionBars?.[layerIndex] ?? 4;
    const tempo = attemptConfig?.tempos?.[layerIndex] ?? engineConfig.fallbackBpm;
    const beatsPerLoop = auditionBars * BEATS_PER_BAR;
    const auditionCycles = attemptConfig?.auditionCycles?.[layerIndex] ?? 1;
    const totalLoops = auditionCycles * 2; // Each cycle = A + B

    // Start progress emission (~4 Hz)
    startAuditionProgressEmission();

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats; first beat sets the baseline in handleBeatEvent
      auditionState = {
        lastToggleBeat: -1,
        beatsPerLoop,
        totalLoops,
        currentLoopIndex: 0,
      };

      console.log(`[Timing] Audition tracking started (OSC, ${auditionBars} bars/option × ${totalLoops} loops)`);
    } else {
      // Fallback: JS interval using per-layer tempo
      const intervalMs = barsToMs(auditionBars, tempo);
      startAuditionFallbackInterval(intervalMs, totalLoops);
      console.log(`[Timing] Audition tracking started (fallback, ${auditionBars} bars/option @ ${tempo} BPM, ${intervalMs.toFixed(0)}ms/option)`);
    }
  }

  /**
   * Start fallback JS interval for audition cycling (non-OSC mode only).
   * Cleared by stopAuditionTracking().
   */
  function startAuditionFallbackInterval(intervalMs: number, totalLoops: number): void {
    if (fallbackAuditionInterval) {
      clearInterval(fallbackAuditionInterval);
    }
    fallbackAuditionLoopIndex = 0;

    fallbackAuditionInterval = setInterval(() => {
      if (!running) return;
      const currentState = getState();
      const attempt = currentState.attempts[currentState.currentAttemptIndex];
      if (!attempt || attempt.currentLayerPhase !== 'auditioning') {
        stopAuditionTracking();
        return;
      }

      fallbackAuditionLoopIndex++;

      if (fallbackAuditionLoopIndex >= totalLoops) {
        stopAuditionTracking();
        sendCommand({ type: 'CLOSE_VOTING' });
      } else {
        sendCommand({ type: 'TOGGLE_AUDITION' });
      }
    }, intervalMs);
  }

  /**
   * Stop audition tracking (both OSC and fallback modes).
   */
  function stopAuditionTracking(): void {
    auditionState = null;
    stopAuditionProgressEmission();
    if (fallbackAuditionInterval) {
      clearInterval(fallbackAuditionInterval);
      fallbackAuditionInterval = null;
    }
    fallbackAuditionLoopIndex = 0;
  }

  // --------------------------------------------------------------------------
  // Remix Loop Boundary Tracking (V3.4)
  // --------------------------------------------------------------------------

  /**
   * Start loop boundary tracking for the finale_remix phase.
   * Fires LOOP_BOUNDARY at each 8-bar (loopBoundaryBeats) boundary.
   * Simpler than V3.3 loop tracking — no crossfade pre-cue, no column logic.
   */
  function startRemixLoopTracking(): void {
    stopRemixLoopTracking();

    const state = getState();
    const crossfadeBeats = state.config.timing.gain?.crossfadeBeats ?? 1;
    const preCueBeats = Math.ceil(crossfadeBeats / 2);
    const loopBeats = configuredLoopBoundaryBeats;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: fire LOOP_BOUNDARY `preCueBeats` before Ableton transport wraps
      remixLoopState = { active: true, preCueBeats, loopBeats, firedThisLoop: false };
      console.log(`[Timing] Remix loop tracking started (OSC, Ableton transport loop, pre-cue ${preCueBeats} beats)`);
    } else {
      // Fallback: JS interval (no Ableton transport to detect)
      remixLoopState = { active: true, preCueBeats, loopBeats, firedThisLoop: false };
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = loopBeats * msPerBeat;
      fallbackRemixLoopStartTime = Date.now();

      fallbackRemixLoopInterval = setInterval(() => {
        if (!running) return;
        const s = getState();
        if (s.phase !== 'finale_remix') {
          stopRemixLoopTracking();
          return;
        }
        fallbackRemixLoopStartTime = Date.now();
        sendCommand({ type: 'LOOP_BOUNDARY' });
      }, intervalMs);

      // Progress emission (~4 Hz) in fallback mode
      if (engineConfig.onRemixLoopProgress) {
        fallbackRemixProgressInterval = setInterval(() => {
          if (!running) return;
          const elapsed = Date.now() - fallbackRemixLoopStartTime;
          const progress = Math.min(elapsed / intervalMs, 1.0);
          engineConfig.onRemixLoopProgress!(progress);
        }, 250);
      }

      console.log(`[Timing] Remix loop tracking started (fallback, every ${intervalMs.toFixed(0)}ms)`);
    }
  }

  /**
   * Stop remix loop boundary tracking.
   */
  function stopRemixLoopTracking(): void {
    remixLoopState = null;
    if (fallbackRemixLoopInterval) {
      clearInterval(fallbackRemixLoopInterval);
      fallbackRemixLoopInterval = null;
    }
    if (fallbackRemixProgressInterval) {
      clearInterval(fallbackRemixProgressInterval);
      fallbackRemixProgressInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // Fallback Beat Ticker
  // --------------------------------------------------------------------------

  /**
   * Start the fallback beat ticker. Generates synthetic beats from fallbackBpm
   * so the beat callback scheduler works even without an OSC bridge.
   */
  function startFallbackBeatTicker(): void {
    if (fallbackBeatInterval) return;
    const msPerBeat = 60000 / engineConfig.fallbackBpm;
    fallbackBeatCounter = 0;

    fallbackBeatInterval = setInterval(() => {
      if (!running) return;
      fallbackBeatCounter++;
      handleBeatCallbacks(fallbackBeatCounter);
    }, msPerBeat);

    console.log(`[Timing] Fallback beat ticker started (${engineConfig.fallbackBpm} BPM, ${msPerBeat.toFixed(0)}ms/beat)`);
  }

  /**
   * Stop the fallback beat ticker.
   */
  function stopFallbackBeatTicker(): void {
    if (fallbackBeatInterval) {
      clearInterval(fallbackBeatInterval);
      fallbackBeatInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // Beat Event Handling
  // --------------------------------------------------------------------------

  /**
   * Convert a raw Ableton beat number (which wraps at loop boundaries, e.g. 0–31)
   * to a monotonically increasing beat number. Detects wraps by comparing with
   * the previous raw beat. Only used in OSC mode — fallback ticker is already monotonic.
   */
  function rawToMonotonic(rawBeat: number): number {
    if (previousRawBeat >= 0 && rawBeat < previousRawBeat) {
      beatWrapOffset += previousRawBeat + 1;
    }
    previousRawBeat = rawBeat;
    return rawBeat + beatWrapOffset;
  }

  /**
   * Process scheduled beat callbacks for the given beat number.
   * Called from both handleBeatEvent (OSC) and the fallback beat ticker.
   */
  function getBeatDurationMs(): number {
    return 60000 / currentBpm;
  }

  function handleBeatCallbacks(beatNumber: number, rawBeat?: number): void {
    currentAbsoluteBeat = beatNumber;

    // Update beat position
    const beatsSinceLoopStart = beatNumber - loopStartBeat;
    const loopBeats = configuredLoopBoundaryBeats;
    totalLoopsElapsed = Math.floor(beatsSinceLoopStart / loopBeats);

    currentBeatPosition = {
      absoluteBeat: beatNumber,
      beatInBar: beatNumber % BEATS_PER_BAR,
      barInLoop: Math.floor(beatsSinceLoopStart / BEATS_PER_BAR) % (configuredLoopBoundaryBeats / BEATS_PER_BAR),
      loopCount: totalLoopsElapsed,
      rawBeat
    };

    // Fire any scheduled callbacks for this beat
    const toFire = beatCallbacks.filter(cb => cb.targetBeat <= beatNumber);
    beatCallbacks = beatCallbacks.filter(cb => cb.targetBeat > beatNumber);
    for (const cb of toFire) {
      try {
        cb.callback();
      } catch (err) {
        console.error(`[Timing] Beat callback error (${cb.id}):`, err);
      }
    }
  }

  /**
   * Handle beat event from AbletonOSC.
   * Drives audition A/B cycling, performer mix loop boundaries, and beat callbacks.
   */
  function handleBeatEvent(rawBeatNumber: number): void {
    if (!running) return;

    // Capture pre-wrap state for remix loop detection (before rawToMonotonic mutates previousRawBeat)
    const prevRaw = previousRawBeat;

    // Convert wrapping Ableton beats (e.g. 0–31, 0–31, ...) to monotonic
    const monotonicBeat = rawToMonotonic(rawBeatNumber);
    const state = getState();

    // Fire scheduled beat callbacks (uses monotonic for scheduling)
    handleBeatCallbacks(monotonicBeat, rawBeatNumber);

    // --- Audition beat tracking (song-building) ---
    if (auditionState && state.phase === 'attempt_build') {
      const attempt = state.attempts[state.currentAttemptIndex];
      if (attempt?.currentLayerPhase === 'auditioning') {
        // Initialize baseline on first beat received
        if (auditionState.lastToggleBeat < 0) {
          auditionState.lastToggleBeat = monotonicBeat;
        }

        const beatsSinceLastToggle = monotonicBeat - auditionState.lastToggleBeat;
        if (beatsSinceLastToggle >= auditionState.beatsPerLoop) {
          auditionState.lastToggleBeat = monotonicBeat;
          auditionState.currentLoopIndex++;

          if (auditionState.currentLoopIndex >= auditionState.totalLoops) {
            stopAuditionTracking();
            sendCommand({ type: 'CLOSE_VOTING' });
          } else {
            sendCommand({ type: 'TOGGLE_AUDITION' });
          }
        }
        // Audition tracking handled — do not fall through to loop boundary
        return;
      }
    }

    // --- Remix loop boundary (V3.4 — Ableton transport loop is source of truth) ---
    // Fire LOOP_BOUNDARY `preCueBeats` before the transport wraps so the
    // crossfade is already in progress when the new loop starts. Reset on wrap.
    if (remixLoopState?.active && state.phase === 'finale_remix') {
      // Transport wrapped — reset flag for the new loop
      if (prevRaw >= 0 && rawBeatNumber < prevRaw) {
        remixLoopState.firedThisLoop = false;
      }

      // Pre-cue: fire when raw beat reaches the threshold
      const threshold = remixLoopState.loopBeats - remixLoopState.preCueBeats;
      if (!remixLoopState.firedThisLoop && rawBeatNumber >= threshold) {
        remixLoopState.firedThisLoop = true;
        sendCommand({ type: 'LOOP_BOUNDARY' });
      }

      // Update loop progress (0.0–1.0) from raw beat position
      if (engineConfig.onRemixLoopProgress && remixLoopState.loopBeats > 0) {
        engineConfig.onRemixLoopProgress(rawBeatNumber / remixLoopState.loopBeats);
      }
    }
  }

  // --------------------------------------------------------------------------
  // OSC Message Handling
  // --------------------------------------------------------------------------

  /**
   * Handle incoming OSC messages from AbletonOSC.
   */
  function onOSCMessage(address: string, args: any[]): void {
    if (!running) return;

    switch (address) {
      case '/live/song/get/beat': {
        const beatNumber = args[0] as number;
        handleBeatEvent(beatNumber);
        break;
      }
      default:
        break;
    }
  }

  // --------------------------------------------------------------------------
  // State Change Handling
  // --------------------------------------------------------------------------

  /**
   * Handle state changes — called after every command is processed.
   */
  function onStateChanged(state: ShowState, events: ConductorEvent[]): void {
    if (!running || !engineConfig.enabled) return;

    configuredLoopBoundaryBeats = state.config.timing.loopBoundaryBeats || 32;

    // Don't schedule if paused
    if (state.paused) {
      cancelCurrentTimer();
      clearAllFinaleTimers();
      return;
    }

    // Check for layer phase changes (song-building)
    const layerPhaseEvent = events.find(e => e.type === 'LAYER_PHASE_CHANGED') as
      | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
      | undefined;

    if (layerPhaseEvent) {
      cancelCurrentTimer();

      switch (layerPhaseEvent.phase) {
        case 'auditioning':
          startAuditionTracking(state);
          break;
        case 'revealing': {
          stopAuditionTracking();
          // Two-beat reveal: performer manually fires REVEAL_STAKES then ADVANCE_FROM_REVEAL
          // via controller buttons. No auto-advance timer.
          console.log('[Timing] Revealing — waiting for manual REVEAL_STAKES → ADVANCE_FROM_REVEAL');
          break;
        }
        case 'locked_in': {
          stopAuditionTracking();
          const verdictMs = state.config.timing.revealSequenceDurationMs;
          console.log(`[Timing] Layer locked in — scheduling ${verdictMs}ms verdict timer → ADVANCE_FROM_VERDICT`);
          scheduleTimer(verdictMs, state.version, 'verdict', () => {
            sendCommand({ type: 'ADVANCE_FROM_VERDICT' });
          });
          break;
        }
        case 'collapsed': {
          stopAuditionTracking();
          const collapseVerdictMs = state.config.timing.revealSequenceDurationMs;
          console.log(`[Timing] Attempt collapsed — scheduling ${collapseVerdictMs}ms verdict timer → ADVANCE_FROM_VERDICT`);
          scheduleTimer(collapseVerdictMs, state.version, 'verdict', () => {
            sendCommand({ type: 'ADVANCE_FROM_VERDICT' });
          });
          break;
        }
        case 'locked':
          stopAuditionTracking();
          console.log('[Timing] Layer reset to locked — timers cancelled');
          break;
        default:
          break;
      }
    }

    // Check for show phase changes
    const showPhaseEvent = events.find(e => e.type === 'SHOW_PHASE_CHANGED') as
      | { type: 'SHOW_PHASE_CHANGED'; phase: string; attemptIndex?: number }
      | undefined;

    if (showPhaseEvent) {
      cancelCurrentTimer();
      clearAllFinaleTimers();

      if (showPhaseEvent.phase === 'finale_remix') {
        startRemixLoopTracking();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the timing engine.
   */
  function start(): void {
    if (running) {
      console.warn('[Timing] Engine already running');
      return;
    }

    if (!engineConfig.enabled) {
      console.log('[Timing] Engine disabled by config');
      return;
    }

    running = true;

    // Wire up OSC message handling if bridge is available
    if (engineConfig.oscBridge) {
      engineConfig.oscBridge.on('/live/song/get/beat', (...args: any[]) => {
        onOSCMessage('/live/song/get/beat', args);
      });

      // Subscribe to beat events from AbletonOSC
      engineConfig.oscBridge.send('/live/song/start_listen/beat');

      // Subscribe to tempo changes from Ableton
      engineConfig.oscBridge.on('/live/song/get/tempo', (...args: any[]) => {
        const bpm = args[0] as number;
        if (bpm > 0) currentBpm = bpm;
      });
      engineConfig.oscBridge.send('/live/song/start_listen/tempo');
      engineConfig.oscBridge.send('/live/song/get/tempo');
    } else {
      // Start synthetic beat ticker for beat callback scheduling in fallback mode
      startFallbackBeatTicker();
    }

    console.log('[Timing] Engine started');
    console.log(`[Timing] Mode: ${engineConfig.oscBridge ? 'AbletonOSC (beat-synced)' : 'Fallback (JS timers)'}`);

    // Initialize based on current state
    const state = getState();
    configuredLoopBoundaryBeats = state.config.timing.loopBoundaryBeats || 32;
    if (state.phase === 'attempt_build') {
      const attempt = state.attempts[state.currentAttemptIndex];
      if (attempt && attempt.status === 'in_progress') {
        onStateChanged(state, [
          {
            type: 'LAYER_PHASE_CHANGED',
            attemptIndex: state.currentAttemptIndex,
            layerIndex: attempt.currentLayerIndex,
            phase: attempt.currentLayerPhase,
          },
        ]);
      }
    } else if (state.phase === 'finale_remix') {
      startRemixLoopTracking();
    }
  }

  /**
   * Stop the timing engine.
   */
  function stop(): void {
    if (!running) return;

    running = false;
    cancelCurrentTimer();
    clearAllFinaleTimers();
    stopAuditionTracking(); // Also stops progress emission
    stopFallbackBeatTicker();
    beatCallbacks = [];
    previousRawBeat = -1;
    beatWrapOffset = 0;
    currentAbsoluteBeat = 0;
    currentBeatPosition = null;
    currentBpm = engineConfig.fallbackBpm;

    // Unsubscribe from beat and tempo events
    if (engineConfig.oscBridge) {
      engineConfig.oscBridge.send('/live/song/stop_listen/beat');
      engineConfig.oscBridge.send('/live/song/stop_listen/tempo');
    }

    console.log('[Timing] Engine stopped');
  }

  /**
   * Clean up resources.
   */
  function dispose(): void {
    stop();
    console.log('[Timing] Engine disposed');
  }

  /**
   * Check if engine is running.
   */
  function isRunning(): boolean {
    return running;
  }

  /**
   * Recover and restart finale timers after a server restart.
   * Uses state.lastUpdated as an approximation of when the timer was last active.
   */
  function recoverTimers(state: ShowState): void {
    if (!state.finaleState) return;

    // V3.4: finale_remix loop tracking restarts via start() → phase check.
    // No timer-based recovery needed for remix (loop tracking is stateless).
    if (state.phase === 'finale_remix') {
      startRemixLoopTracking();
    }
  }

  /**
   * Re-subscribe to OSC events and reset beat state after bridge (re)connect.
   * Called when the osc-bridge client connects or reconnects.
   */
  function onBridgeReconnect(): void {
    if (!running || !engineConfig.oscBridge) return;

    console.log('[Timing] Bridge reconnected — re-subscribing to OSC events');

    // Reset beat tracking (new Ableton session = new beat numbers)
    previousRawBeat = -1;
    beatWrapOffset = 0;
    currentAbsoluteBeat = 0;
    currentBeatPosition = null;
    currentBpm = engineConfig.fallbackBpm;

    // Reset audition baselines so they re-anchor to new beats
    if (auditionState) auditionState.lastToggleBeat = -1;

    // Re-subscribe to Ableton events
    engineConfig.oscBridge.send('/live/song/start_listen/beat');
    engineConfig.oscBridge.send('/live/song/start_listen/tempo');
    engineConfig.oscBridge.send('/live/song/get/tempo');

    // Re-initialize for current phase (restart audition/loop tracking if mid-show)
    const state = getState();
    if (state.phase === 'attempt_build') {
      const attempt = state.attempts[state.currentAttemptIndex];
      if (attempt?.status === 'in_progress' && attempt.currentLayerPhase === 'auditioning') {
        startAuditionTracking(state);
      }
    } else if (state.phase === 'finale_remix') {
      startRemixLoopTracking();
    }
  }

  return {
    start,
    stop,
    onStateChanged,
    onOSCMessage,
    dispose,
    isRunning,
    recoverTimers,
    onBridgeReconnect,
    scheduleAtBeat,
    schedulePerBeat,
    cancelCallbacks,
    getCurrentBeat,
    getCurrentBeatPosition,
    getBeatDurationMs,
  };
}

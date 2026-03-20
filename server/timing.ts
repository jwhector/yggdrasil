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
}

/** Beat position within the current musical context. */
export interface BeatPosition {
  absoluteBeat: number;    // Raw beat number from Ableton (or synthetic)
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
  totalLoops: number;          // Always 2 (A then B)
  currentLoopIndex: number;    // 0-based, increments on each toggle
}

/**
 * Loop boundary tracking state (for performer mix pending changes)
 */
interface LoopTrackingState {
  lastBoundaryBeat: number;    // Beat number at last loop boundary (-1 = not yet set)
  loopBeats: number;           // from config.timing.loopBoundaryBeats
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
  let assemblyTimer: NodeJS.Timeout | null = null;
  let deliberationTimer: NodeJS.Timeout | null = null;
  let ambassadorVolunteerTimer: NodeJS.Timeout | null = null;
  let auditionState: AuditionTrackingState | null = null;
  let fallbackAuditionInterval: NodeJS.Timeout | null = null;
  let fallbackAuditionLoopIndex = 0;
  let loopState: LoopTrackingState | null = null;
  let fallbackLoopInterval: NodeJS.Timeout | null = null;
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

  // --------------------------------------------------------------------------
  // Finale Timers (Assembly, Deliberation, Ambassador Volunteer)
  // --------------------------------------------------------------------------

  function startAssemblyTimer(durationMs: number): void {
    clearAssemblyTimer();
    console.log(`[Timing] Assembly timer: ${durationMs}ms`);
    assemblyTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_assembly') {
        console.log('[Timing] Assembly timer expired → ASSEMBLY_TIMER_EXPIRED');
        sendCommand({ type: 'ASSEMBLY_TIMER_EXPIRED' });
      }
      assemblyTimer = null;
    }, durationMs);
  }

  function clearAssemblyTimer(): void {
    if (assemblyTimer) {
      clearTimeout(assemblyTimer);
      assemblyTimer = null;
    }
  }

  function startDeliberationTimer(durationMs: number): void {
    clearDeliberationTimer();
    console.log(`[Timing] Deliberation timer: ${durationMs}ms`);
    deliberationTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_deliberation') {
        console.log('[Timing] Deliberation timer expired → DELIBERATION_TIMER_EXPIRED');
        sendCommand({ type: 'DELIBERATION_TIMER_EXPIRED' });
      }
      deliberationTimer = null;
    }, durationMs);
  }

  function clearDeliberationTimer(): void {
    if (deliberationTimer) {
      clearTimeout(deliberationTimer);
      deliberationTimer = null;
    }
  }

  function startAmbassadorVolunteerTimer(durationMs: number): void {
    clearAmbassadorVolunteerTimer();
    console.log(`[Timing] Ambassador volunteer timer: ${durationMs}ms`);
    ambassadorVolunteerTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_deliberation') {
        console.log('[Timing] Ambassador volunteer timer expired → AMBASSADOR_VOLUNTEER_TIMER_EXPIRED');
        // Conductor resolves all groups in one pass when this fires
        sendCommand({ type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED', layerType: 'melody' });
      }
      ambassadorVolunteerTimer = null;
    }, durationMs);
  }

  function clearAmbassadorVolunteerTimer(): void {
    if (ambassadorVolunteerTimer) {
      clearTimeout(ambassadorVolunteerTimer);
      ambassadorVolunteerTimer = null;
    }
  }

  function clearAllFinaleTimers(): void {
    clearAssemblyTimer();
    clearDeliberationTimer();
    clearAmbassadorVolunteerTimer();
  }

  // --------------------------------------------------------------------------
  // Layer Phase Handlers
  // --------------------------------------------------------------------------

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
    const totalLoops = 2; // A then B

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
    if (fallbackAuditionInterval) {
      clearInterval(fallbackAuditionInterval);
      fallbackAuditionInterval = null;
    }
    fallbackAuditionLoopIndex = 0;
  }

  // --------------------------------------------------------------------------
  // Loop Boundary Tracking (Performer Mix)
  // --------------------------------------------------------------------------

  /**
   * Start loop boundary tracking for performer mix phase.
   * Fires FIRE_PENDING_CHANGES at each 8-bar boundary.
   */
  function startLoopTracking(): void {
    stopLoopTracking();

    const loopBeats = configuredLoopBoundaryBeats;
    const loopBars = configuredLoopBoundaryBeats / BEATS_PER_BAR;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats
      loopState = {
        lastBoundaryBeat: -1,
        loopBeats,
      };
      console.log(`[Timing] Loop boundary tracking started (OSC, every ${loopBars} bars / ${loopBeats} beats)`);
    } else {
      // Fallback: JS interval
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = loopBeats * msPerBeat;

      fallbackLoopInterval = setInterval(() => {
        if (!running) return;
        const state = getState();
        if (state.phase !== 'finale_performer_mix') {
          stopLoopTracking();
          return;
        }
        console.log('[Timing] Loop boundary → FIRE_PENDING_CHANGES');
        sendCommand({ type: 'FIRE_PENDING_CHANGES' });
      }, intervalMs);

      console.log(`[Timing] Loop boundary tracking started (fallback, every ${intervalMs.toFixed(0)}ms)`);
    }
  }

  /**
   * Stop loop boundary tracking.
   */
  function stopLoopTracking(): void {
    loopState = null;
    if (fallbackLoopInterval) {
      clearInterval(fallbackLoopInterval);
      fallbackLoopInterval = null;
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

  function handleBeatCallbacks(beatNumber: number): void {
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

    // Convert wrapping Ableton beats (e.g. 0–31, 0–31, ...) to monotonic
    const monotonicBeat = rawToMonotonic(rawBeatNumber);
    const state = getState();

    // Fire scheduled beat callbacks (uses monotonic for scheduling)
    handleBeatCallbacks(monotonicBeat);

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

    // --- Loop boundary tracking (performer mix) ---
    if (!loopState) return;
    if (state.phase !== 'finale_performer_mix') return;

    // Initialize baseline on first beat
    if (loopState.lastBoundaryBeat < 0) {
      loopState.lastBoundaryBeat = monotonicBeat;
    }

    const beatsSinceBoundary = monotonicBeat - loopState.lastBoundaryBeat;
    if (beatsSinceBoundary >= loopState.loopBeats) {
      loopState.lastBoundaryBeat = monotonicBeat;
      console.log(`[Timing] Loop boundary at monotonic beat ${monotonicBeat} → FIRE_PENDING_CHANGES`);
      sendCommand({ type: 'FIRE_PENDING_CHANGES' });
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
          const revealMs = state.config.timing.revealSequenceDurationMs;
          console.log(`[Timing] Revealing: scheduling ${revealMs}ms timer → ADVANCE_FROM_REVEAL`);
          scheduleTimer(revealMs, state.version, 'revealing', () => {
            sendCommand({ type: 'ADVANCE_FROM_REVEAL' });
          });
          break;
        }
        case 'locked_in':
          stopAuditionTracking();
          console.log('[Timing] Layer locked in — waiting for manual advance');
          break;
        case 'collapsed':
          stopAuditionTracking();
          console.log('[Timing] Attempt collapsed — no timer needed');
          break;
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
      stopLoopTracking();
      clearAllFinaleTimers();

      if (showPhaseEvent.phase === 'finale_performer_mix') {
        startLoopTracking();
      }
    }

    // Assembly started → start assembly timer
    const assemblyStartedEvent = events.find(e => e.type === 'ASSEMBLY_STARTED') as
      | { type: 'ASSEMBLY_STARTED'; timerDuration: number }
      | undefined;
    if (assemblyStartedEvent) {
      startAssemblyTimer(assemblyStartedEvent.timerDuration);
    }

    // Assembly complete → clear assembly timer
    if (events.some(e => e.type === 'ASSEMBLY_COMPLETE')) {
      clearAssemblyTimer();
    }

    // Deliberation started → start deliberation timer
    const deliberationStartedEvent = events.find(e => e.type === 'DELIBERATION_STARTED') as
      | { type: 'DELIBERATION_STARTED'; timerDuration: number }
      | undefined;
    if (deliberationStartedEvent) {
      startDeliberationTimer(deliberationStartedEvent.timerDuration);
    }

    // Deliberation timer resolved → clear main timer, start volunteer timer if set
    if (events.some(e => e.type === 'FRAGMENT_CHOSEN')) {
      clearDeliberationTimer();
      const volunteerMs = state.finaleState?.deliberation.volunteerTimerRemaining;
      if (volunteerMs && volunteerMs > 0) {
        startAmbassadorVolunteerTimer(volunteerMs);
      }
    }

    // Deliberation complete → clear all deliberation timers
    if (events.some(e => e.type === 'DELIBERATION_COMPLETE')) {
      clearDeliberationTimer();
      clearAmbassadorVolunteerTimer();
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
    } else if (state.phase === 'finale_performer_mix') {
      startLoopTracking();
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
    stopAuditionTracking();
    stopLoopTracking();
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

    const elapsed = Date.now() - state.lastUpdated;

    if (state.phase === 'finale_assembly') {
      const remaining = state.finaleState.assembly.timerRemaining - elapsed;
      if (remaining > 0) {
        console.log(`[Timing] Recovering assembly timer: ${remaining}ms remaining`);
        startAssemblyTimer(remaining);
      } else {
        console.log('[Timing] Assembly timer already expired on recovery → firing ASSEMBLY_TIMER_EXPIRED');
        sendCommand({ type: 'ASSEMBLY_TIMER_EXPIRED' });
      }
    } else if (state.phase === 'finale_deliberation') {
      const volunteerMs = state.finaleState.deliberation.volunteerTimerRemaining;
      if (volunteerMs !== null) {
        // Volunteer timer was active
        const remaining = volunteerMs - elapsed;
        if (remaining > 0) {
          console.log(`[Timing] Recovering ambassador volunteer timer: ${remaining}ms remaining`);
          startAmbassadorVolunteerTimer(remaining);
        } else {
          console.log('[Timing] Volunteer timer already expired on recovery → firing AMBASSADOR_VOLUNTEER_TIMER_EXPIRED');
          sendCommand({ type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED', layerType: 'melody' });
        }
      } else {
        const remaining = state.finaleState.deliberation.timerRemaining - elapsed;
        if (remaining > 0) {
          console.log(`[Timing] Recovering deliberation timer: ${remaining}ms remaining`);
          startDeliberationTimer(remaining);
        } else {
          console.log('[Timing] Deliberation timer already expired on recovery → firing DELIBERATION_TIMER_EXPIRED');
          sendCommand({ type: 'DELIBERATION_TIMER_EXPIRED' });
        }
      }
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
    scheduleAtBeat,
    schedulePerBeat,
    cancelCallbacks,
    getCurrentBeat,
    getCurrentBeatPosition,
    getBeatDurationMs,
  };
}

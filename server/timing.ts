/**
 * Timing Engine — Hybrid Timing with AbletonOSC + Server Timers
 *
 * Manages automatic phase advancement with a hybrid approach:
 * - Server JS timers control game logic timing (audition duration, voting window,
 *   consensus round duration)
 * - AbletonOSC beat events drive audition A/B cycling and performer mix loop boundaries
 * - Per-beat callback scheduler allows audio router to lock gain changes to the musical grid
 *
 * Architecture:
 * - Observes state changes via onStateChanged()
 * - For auditioning: Schedules auditionDurationMs timer → sends OPEN_VOTING
 *   (or beat-synced cycling if beatsPerLoop > 0)
 * - For voting: Schedules votingWindowMs timer → sends CLOSE_VOTING
 * - For consensus rounds: Schedules round duration timer → sends END_CONSENSUS_ROUND
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
  barInLoop: number;       // 0–7 within current 8-bar loop
  loopCount: number;       // Total 8-bar loops elapsed since beat tracking started
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
  totalLoops: number;          // auditionsPerLayer * 2
  currentLoopIndex: number;    // 0-based, increments on each toggle
}

/**
 * Loop boundary tracking state (for performer mix pending changes)
 */
interface LoopTrackingState {
  lastBoundaryBeat: number;    // Beat number at last loop boundary (-1 = not yet set)
  loopBeats: number;           // LOOP_BARS * BEATS_PER_BAR
}

const BEATS_PER_BAR = 4;
const LOOP_BARS = 8;          // Performer mix loop length in bars

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
  let consensusRoundTimer: NodeJS.Timeout | null = null;
  let auditionState: AuditionTrackingState | null = null;
  let fallbackAuditionInterval: NodeJS.Timeout | null = null;
  let fallbackAuditionLoopIndex = 0;
  let loopState: LoopTrackingState | null = null;
  let fallbackLoopInterval: NodeJS.Timeout | null = null;

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
  // Consensus Round Timer
  // --------------------------------------------------------------------------

  /**
   * Start consensus round timer. Fires END_CONSENSUS_ROUND when duration expires.
   */
  function startConsensusRoundTimer(durationMs: number): void {
    clearConsensusRoundTimer();

    console.log(`[Timing] Consensus round timer: ${durationMs}ms`);
    consensusRoundTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_consensus' && state.finaleState?.consensusGame.active) {
        console.log('[Timing] Consensus round timer expired → END_CONSENSUS_ROUND');
        sendCommand({ type: 'END_CONSENSUS_ROUND' });
      }
      consensusRoundTimer = null;
    }, durationMs);
  }

  /**
   * Clear the consensus round timer (round ended by other means).
   */
  function clearConsensusRoundTimer(): void {
    if (consensusRoundTimer) {
      clearTimeout(consensusRoundTimer);
      consensusRoundTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Layer Phase Handlers
  // --------------------------------------------------------------------------

  /**
   * Start beat-synced audition tracking.
   * OSC mode: counts beats from Ableton, toggles A/B every beatsPerLoop beats.
   * Fallback mode: JS interval based on fallbackBpm.
   * After all loops complete, sends OPEN_VOTING.
   */
  function startAuditionTracking(state: ShowState): void {
    stopAuditionTracking();

    const beatsPerLoop = state.config.timing.beatsPerLoop ?? 0;
    const auditionsPerLayer = state.config.timing.auditionsPerLayer ?? 2;
    const { auditionDurationMs } = state.config.timing;
    const totalLoops = auditionsPerLayer * 2;

    if (beatsPerLoop > 0 && engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats; first beat sets the baseline in handleBeatEvent
      auditionState = {
        lastToggleBeat: -1,
        beatsPerLoop,
        totalLoops,
        currentLoopIndex: 0,
      };
      console.log(`[Timing] Audition tracking started (OSC, ${beatsPerLoop} beats/loop × ${totalLoops} loops)`);
    } else if (beatsPerLoop > 0) {
      // Fallback: derive interval from BPM
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = beatsPerLoop * msPerBeat;
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
          sendCommand({ type: 'OPEN_VOTING' });
        } else {
          sendCommand({ type: 'TOGGLE_AUDITION' });
        }
      }, intervalMs);

      console.log(`[Timing] Audition tracking started (fallback, ${intervalMs.toFixed(0)}ms/loop × ${totalLoops} loops)`);
    } else {
      // Legacy: flat timer using auditionDurationMs
      console.log(`[Timing] Auditioning: scheduling ${auditionDurationMs}ms timer → OPEN_VOTING (legacy)`);
      scheduleTimer(auditionDurationMs, state.version, 'auditioning', () => {
        sendCommand({ type: 'OPEN_VOTING' });
      });
    }
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

  /**
   * Handle layer entering 'voting' phase.
   * Schedules votingWindowMs timer → sends CLOSE_VOTING.
   */
  function handleVotingPhase(state: ShowState): void {
    const durationMs = state.config.timing.votingWindowMs;
    console.log(`[Timing] Voting: scheduling ${durationMs}ms timer → CLOSE_VOTING`);

    scheduleTimer(durationMs, state.version, 'voting', () => {
      sendCommand({ type: 'CLOSE_VOTING' });
    });
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

    const loopBeats = LOOP_BARS * BEATS_PER_BAR;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats
      loopState = {
        lastBoundaryBeat: -1,
        loopBeats,
      };
      console.log(`[Timing] Loop boundary tracking started (OSC, every ${LOOP_BARS} bars / ${loopBeats} beats)`);
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
    const loopBeats = LOOP_BARS * BEATS_PER_BAR; // 32
    totalLoopsElapsed = Math.floor(beatsSinceLoopStart / loopBeats);

    currentBeatPosition = {
      absoluteBeat: beatNumber,
      beatInBar: beatNumber % BEATS_PER_BAR,
      barInLoop: Math.floor(beatsSinceLoopStart / BEATS_PER_BAR) % LOOP_BARS,
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
            sendCommand({ type: 'OPEN_VOTING' });
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

    // Don't schedule if paused
    if (state.paused) {
      cancelCurrentTimer();
      clearConsensusRoundTimer();
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
        case 'voting':
          stopAuditionTracking();
          handleVotingPhase(state);
          break;
        case 'revealing': {
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
      clearConsensusRoundTimer();

      if (showPhaseEvent.phase === 'finale_performer_mix') {
        startLoopTracking();
      }
    }

    // Consensus round started — set round timer
    const roundStartedEvent = events.find(e => e.type === 'CONSENSUS_ROUND_STARTED') as
      | { type: 'CONSENSUS_ROUND_STARTED'; roundNumber: number; threshold: number }
      | undefined;

    if (roundStartedEvent && state.finaleState) {
      startConsensusRoundTimer(state.finaleState.consensusGame.roundTimeRemaining);
    }

    // Consensus round ended (success or failure) — clear timer
    const roundEndedEvent = events.find(
      e => e.type === 'CONSENSUS_ROUND_SUCCESS' || e.type === 'CONSENSUS_ROUND_FAILURE'
    );
    if (roundEndedEvent) {
      clearConsensusRoundTimer();
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
    } else if (state.phase === 'finale_consensus' && state.finaleState?.consensusGame.active) {
      startConsensusRoundTimer(state.finaleState.consensusGame.roundTimeRemaining);
    }
  }

  /**
   * Stop the timing engine.
   */
  function stop(): void {
    if (!running) return;

    running = false;
    cancelCurrentTimer();
    clearConsensusRoundTimer();
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

  return {
    start,
    stop,
    onStateChanged,
    onOSCMessage,
    dispose,
    isRunning,
    scheduleAtBeat,
    schedulePerBeat,
    cancelCallbacks,
    getCurrentBeat,
    getCurrentBeatPosition,
    getBeatDurationMs,
  };
}

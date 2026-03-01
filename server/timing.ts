/**
 * Timing Engine — Hybrid Timing with AbletonOSC + Server Timers
 *
 * Manages automatic phase advancement with a hybrid approach:
 * - Server JS timers control game logic timing (audition duration, voting window)
 * - AbletonOSC beat events drive finale rotation ticks
 *
 * Architecture:
 * - Observes state changes via onStateChanged()
 * - For auditioning: Schedules auditionDurationMs timer → sends OPEN_VOTING
 * - For voting: Schedules votingWindowMs timer → sends CLOSE_VOTING
 * - For finale rotation: Counts beats → sends PERFORM_ROTATION_TICK
 * - Manual advances always take precedence (version check)
 *
 * Fallback Mode:
 * - When OSC bridge is not available, uses JS timers for all phases
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
  /** BPM for fallback rotation timing (default: 120) */
  fallbackBpm: number;
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
 * Rotation tracking state (for finale beat-based rotation)
 */
interface RotationTrackingState {
  lastRotationBeat: number;
  rotationBeats: number;       // rotationBars * 4 (beats per rotation cycle)
}

/**
 * Audition tracking state (for song-building A/B cycling)
 */
interface AuditionTrackingState {
  lastToggleBeat: number;      // Beat number at last option toggle (0 = not yet set)
  beatsPerLoop: number;        // From config
  totalLoops: number;          // auditionsPerLayer * 2
  currentLoopIndex: number;    // 0-based, increments on each toggle
}

const BEATS_PER_BAR = 4;

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
  let rotationState: RotationTrackingState | null = null;
  let fallbackRotationInterval: NodeJS.Timeout | null = null;
  let auditionState: AuditionTrackingState | null = null;
  let fallbackAuditionInterval: NodeJS.Timeout | null = null;
  let fallbackAuditionLoopIndex = 0;

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
   * Includes version-check safety: if state has changed by the time the timer
   * fires, the callback is skipped.
   */
  function scheduleTimer(
    durationMs: number,
    scheduledVersion: number,
    phase: string,
    callback: () => void,
  ): void {
    cancelCurrentTimer();

    const timer = setTimeout(() => {
      const state = getState();

      // Version check disabled - votes update state
      // Verify state hasn't changed (version check)
      // if (state.version !== scheduledVersion) {
      //   console.log(`[Timing] Timer fired but state version changed (scheduled: ${scheduledVersion}, current: ${state.version}). Skipping.`);
      //   currentTimer = null;
      //   return;
      // }

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

    const { beatsPerLoop, auditionsPerLayer, auditionDurationMs } = state.config.timing;
    const totalLoops = auditionsPerLayer * 2;

    if (beatsPerLoop > 0 && engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats; first beat sets the baseline in handleBeatEvent
      auditionState = {
        lastToggleBeat: 0,
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
    const state = getState();
    const attempt = state.attempts[state.currentAttemptIndex];
    if (attempt?.currentAuditionOption) {
      attempt.currentAuditionOption = null;
    }
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
  // Rotation Beat Tracking (Finale)
  // --------------------------------------------------------------------------

  /**
   * Start tracking beats for finale rotation.
   */
  function startRotationTracking(state: ShowState): void {
    stopRotationTracking();

    const rotationBars = state.config.finale.rotationBars;
    const rotationBeats = rotationBars * BEATS_PER_BAR;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: use beat events
      rotationState = {
        lastRotationBeat: 0,
        rotationBeats,
      };
      console.log(`[Timing] Rotation tracking started (OSC, every ${rotationBars} bars / ${rotationBeats} beats)`);
    } else {
      // Fallback: use JS interval
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = rotationBeats * msPerBeat;

      fallbackRotationInterval = setInterval(() => {
        if (!running) return;
        const currentState = getState();
        if (currentState.phase !== 'finale_rotating') {
          stopRotationTracking();
          return;
        }
        if (!currentState.finaleState?.rotationActive) return;

        sendCommand({ type: 'PERFORM_ROTATION_TICK', beat: 0 });
      }, intervalMs);

      console.log(`[Timing] Rotation tracking started (fallback, every ${intervalMs.toFixed(0)}ms)`);
    }
  }

  /**
   * Stop rotation tracking.
   */
  function stopRotationTracking(): void {
    rotationState = null;
    if (fallbackRotationInterval) {
      clearInterval(fallbackRotationInterval);
      fallbackRotationInterval = null;
    }
  }

  /**
   * Handle beat event from AbletonOSC.
   * Drives both audition A/B cycling and finale rotation.
   */
  function handleBeatEvent(beatNumber: number): void {
    if (!running) return;

    const state = getState();

    // --- Audition beat tracking ---
    if (auditionState && state.phase === 'attempt_build') {
      const attempt = state.attempts[state.currentAttemptIndex];
      if (attempt?.currentLayerPhase === 'auditioning') {
        // Initialize baseline on first beat received
        if (auditionState.lastToggleBeat === 0) {
          auditionState.lastToggleBeat = beatNumber;
        }

        const beatsSinceToggle = beatNumber - auditionState.lastToggleBeat;

        // if (beatsSinceToggle >= auditionState.beatsPerLoop) {
        if (beatNumber % auditionState.beatsPerLoop === 0 && beatNumber > 0) {
          auditionState.lastToggleBeat = beatNumber;
          auditionState.currentLoopIndex++;

          if (auditionState.currentLoopIndex >= auditionState.totalLoops) {
            stopAuditionTracking();
            sendCommand({ type: 'OPEN_VOTING' });
          } else {
            sendCommand({ type: 'TOGGLE_AUDITION' });
          }
        }
        // Audition tracking handled — do not fall through to rotation
        return;
      }
    }

    // --- Rotation beat tracking ---
    if (!rotationState) return;
    if (state.phase !== 'finale_rotating') return;
    if (!state.finaleState?.rotationActive) return;

    const beatsSinceLastRotation = beatNumber - rotationState.lastRotationBeat;

    if (beatsSinceLastRotation >= rotationState.rotationBeats) {
      rotationState.lastRotationBeat = beatNumber;
      sendCommand({ type: 'PERFORM_ROTATION_TICK', beat: beatNumber });
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

      if (showPhaseEvent.phase === 'finale_rotating') {
        startRotationTracking(state);
      } else {
        stopRotationTracking();
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
    }

    console.log('[Timing] Engine started');
    console.log(`[Timing] Mode: ${engineConfig.oscBridge ? 'AbletonOSC (beat-based rotation)' : 'Fallback (JS timers)'}`);

    // Initialize based on current state
    const state = getState();
    if (state.phase === 'attempt_build') {
      const attempt = state.attempts[state.currentAttemptIndex];
      if (attempt && attempt.status === 'in_progress') {
        // Synthesize event to trigger scheduling for current layer
        onStateChanged(state, [
          {
            type: 'LAYER_PHASE_CHANGED',
            attemptIndex: state.currentAttemptIndex,
            layerIndex: attempt.currentLayerIndex,
            phase: attempt.currentLayerPhase,
          },
        ]);
      }
    } else if (state.phase === 'finale_rotating') {
      startRotationTracking(state);
    }
  }

  /**
   * Stop the timing engine.
   */
  function stop(): void {
    if (!running) return;

    running = false;
    cancelCurrentTimer();
    stopRotationTracking();
    stopAuditionTracking();

    // Unsubscribe from beat events
    if (engineConfig.oscBridge) {
      engineConfig.oscBridge.send('/live/song/stop_listen/beat');
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
  };
}

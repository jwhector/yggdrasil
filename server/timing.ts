/**
 * Timing Engine - Hybrid Timing with AbletonOSC + Server Timers
 *
 * Manages automatic phase advancement with a hybrid approach:
 * - AbletonOSC controls musical timing via beat events (audition loops)
 * - Server JS timers control game logic timing (voting, coup windows)
 *
 * Architecture:
 * - Observes state changes via onStateChanged()
 * - For audition: Subscribes to beat events, counts beats for master loop completion
 * - For voting/revealing/coup_window: Uses JS timers
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
  TimingConfig,
  Row,
  RowPhase,
} from '../conductor/types';
import type { OSCBridge } from './osc';

/**
 * Timing engine configuration
 */
export interface TimingEngineConfig {
  /** Whether timing engine is enabled */
  enabled: boolean;
  /** OSC bridge for Ableton communication (null = fallback to JS timers) */
  oscBridge: OSCBridge | null;
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
 * Beat tracking state (for Ableton mode audition timing)
 */
interface BeatTrackingState {
  /** The beat number when the current audition option started */
  auditionOptionStartBeat: number | null;
  /** Current row being auditioned */
  rowIndex: number;
  /** Raw audition index (0-based, maps to option via % optionsPerRow) */
  rawAuditionIndex: number;
}

/**
 * Create a timing engine instance
 *
 * @param sendCommand - Function to send commands (will be processed and broadcast)
 * @param getState - Function to get current show state
 * @param config - Timing engine configuration
 * @returns TimingEngine instance
 */
export function createTimingEngine(
  sendCommand: (command: ConductorCommand) => void,
  getState: () => ShowState,
  config?: Partial<TimingEngineConfig>
): TimingEngine {
  const engineConfig: TimingEngineConfig = {
    enabled: true,
    oscBridge: null,
    ...config,
  };

  // Engine state
  let running = false;
  let currentTimer: TimerState | null = null;
  let beatTrackingState: BeatTrackingState | null = null;

  // ============================================================================
  // Timer Management
  // ============================================================================

  /**
   * Cancel current timer if one exists
   */
  function cancelCurrentTimer(): void {
    if (currentTimer) {
      clearTimeout(currentTimer.timer);
      console.log(`[Timing] Cancelled timer for ${currentTimer.phase}`);
      currentTimer = null;
    }
  }

  /**
   * Schedule a timer to fire after the given duration
   */
  function scheduleTimer(
    durationMs: number,
    scheduledVersion: number,
    phase: string,
    callback: () => void
  ): void {
    cancelCurrentTimer();

    const timer = setTimeout(() => {
      const state = getState();

      // Verify state hasn't changed (version check)
      if (state.version !== scheduledVersion) {
        console.log(`[Timing] Timer fired but state version changed (scheduled: ${scheduledVersion}, current: ${state.version}). Skipping.`);
        currentTimer = null;
        return;
      }

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

  /**
   * Schedule automatic advance via ADVANCE_PHASE command
   */
  function scheduleAdvance(durationMs: number, scheduledVersion: number, phase: string): void {
    scheduleTimer(durationMs, scheduledVersion, phase, () => {
      sendCommand({ type: 'ADVANCE_PHASE' });
    });
  }

  // ============================================================================
  // Beat Event Handling (AbletonOSC)
  // ============================================================================

  /**
   * Handle beat event from AbletonOSC
   */
  function handleBeatEvent(beatNumber: number): void {
    if (!running || !beatTrackingState) return;

    const state = getState();
    if (state.phase !== 'running') return;

    const currentRow = state.rows[state.currentRowIndex];
    if (currentRow.phase !== 'voting' || currentRow.auditionComplete) return;

    // If we haven't recorded a start beat yet, this is it
    if (beatTrackingState.auditionOptionStartBeat === null) {
      beatTrackingState.auditionOptionStartBeat = beatNumber;
      console.log(`[Timing] Beat ${beatNumber}: audition option start recorded`);
      return;
    }

    const masterLoopBeats = state.config.timing.masterLoopBeats ?? 32;
    // const beatsElapsed = beatNumber - beatTrackingState.auditionOptionStartBeat;
    const beatsElapsed = beatNumber % masterLoopBeats;

    // if (beatsElapsed >= masterLoopBeats) {
    if (beatsElapsed === 0 && beatNumber !== 0) {
      console.log(`[Timing] Beat ${beatNumber}: master loop complete (${beatsElapsed} beats >= ${masterLoopBeats}). Advancing.`);
      beatTrackingState = null; // Clear; will be recreated on next audition phase
      sendCommand({ type: 'ADVANCE_PHASE' });
    }
  }

  // ============================================================================
  // Audition Phase (Beat-Based or Fallback)
  // ============================================================================

  /**
   * Handle entering audition phase
   */
  function handleAuditionPhase(state: ShowState, row: Row): void {
    const rawAuditionIndex = row.currentAuditionIndex ?? 0;
    const optionIndex = rawAuditionIndex % state.config.optionsPerRow;  // Always 0-(optionsPerRow-1)
    const timing = state.config.timing;
    const loopsPerRow = timing.auditionLoopsPerRow ?? 1;
    const currentLoop = Math.floor(rawAuditionIndex / state.config.optionsPerRow) + 1;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // Ableton mode: Track beats, advance on master loop boundary
      console.log(`[Timing] Audition (AbletonOSC): row ${row.index}, option ${optionIndex} (loop ${currentLoop}/${loopsPerRow})`);

      beatTrackingState = {
        auditionOptionStartBeat: null,  // Will be set on next beat event
        rowIndex: row.index,
        rawAuditionIndex,
      };

      // Beat events are handled by handleBeatEvent() via the /live/song/get/beat listener
    } else {
      // Fallback mode: Use JS timer
      console.log(`[Timing] Audition (fallback): option ${optionIndex} (loop ${currentLoop}/${loopsPerRow})`);

      beatTrackingState = {
        auditionOptionStartBeat: null,
        rowIndex: row.index,
        rawAuditionIndex,
      };

      // Calculate total audition time for this option
      // Each audition step = one option * loops per option
      const totalMs = timing.auditionPerOptionMs * timing.auditionLoopsPerOption;

      scheduleAdvance(totalMs, state.version, `auditioning option ${optionIndex} (loop ${currentLoop})`);
    }
  }

  // ============================================================================
  // Other Phases (Server-Driven)
  // ============================================================================

  /**
   * Handle entering voting phase
   */
  function handleVotingPhase(state: ShowState): void {
    const timing = state.config.timing;
    console.log(`[Timing] Voting phase: scheduling ${timing.votingWindowMs}ms timer`);
    scheduleAdvance(timing.votingWindowMs, state.version, 'voting');
  }

  /**
   * Handle entering revealing phase
   */
  function handleRevealingPhase(state: ShowState): void {
    const timing = state.config.timing;
    console.log(`[Timing] Revealing phase: scheduling ${timing.revealDurationMs}ms timer`);
    scheduleAdvance(timing.revealDurationMs, state.version, 'revealing');
  }

  /**
   * Handle entering coup_window phase
   */
  function handleCoupWindowPhase(state: ShowState): void {
    const timing = state.config.timing;
    console.log(`[Timing] Coup window phase: scheduling ${timing.coupWindowMs}ms timer`);
    scheduleAdvance(timing.coupWindowMs, state.version, 'coup_window');
  }

  // ============================================================================
  // OSC Message Handling
  // ============================================================================

  /**
   * Handle incoming OSC messages from AbletonOSC
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
        // Ignore unknown messages
        break;
    }
  }

  // ============================================================================
  // State Change Handling
  // ============================================================================

  /**
   * Handle state changes - called after every command is processed
   */
  function onStateChanged(state: ShowState, events: ConductorEvent[]): void {
    if (!running || !engineConfig.enabled) return;

    // Check for relevant events
    const rowPhaseEvent = events.find(e => e.type === 'ROW_PHASE_CHANGED') as
      | { type: 'ROW_PHASE_CHANGED'; row: number; phase: RowPhase }
      | undefined;

    const showPhaseEvent = events.find(e => e.type === 'SHOW_PHASE_CHANGED') as
      | { type: 'SHOW_PHASE_CHANGED'; phase: string }
      | undefined;

    // Cancel timers on phase change
    if (rowPhaseEvent || showPhaseEvent) {
      cancelCurrentTimer();
      beatTrackingState = null;
    }

    // Don't schedule if paused
    if (state.phase === 'paused') {
      console.log('[Timing] Show paused - not scheduling timer');
      return;
    }

    // Don't schedule if not running
    if (state.phase !== 'running') {
      return;
    }

    const currentRow = state.rows[state.currentRowIndex];

    // Schedule based on current row phase
    switch (currentRow.phase) {
      case 'voting':
        // If still auditioning, handle audition; otherwise handle voting window
        if (!currentRow.auditionComplete) {
          handleAuditionPhase(state, currentRow);
        } else {
          handleVotingPhase(state);
        }
        break;

      case 'revealing':
        handleRevealingPhase(state);
        break;

      case 'coup_window':
        handleCoupWindowPhase(state);
        break;

      case 'committed':
        // Manual control - no timer
        console.log('[Timing] Row committed - waiting for manual advance');
        break;

      case 'pending':
        // No timer for pending rows
        break;

      default:
        console.warn(`[Timing] Unknown row phase: ${currentRow.phase}`);
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the timing engine
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
      // Subscribe to beat events from AbletonOSC
      engineConfig.oscBridge.on('/live/song/get/beat', (...args) => {
        onOSCMessage('/live/song/get/beat', args);
      });

      // Send subscription request to AbletonOSC
      engineConfig.oscBridge.send('/live/song/start_listen/beat');
    }

    console.log('[Timing] Engine started');
    console.log(`[Timing] Mode: ${engineConfig.oscBridge ? 'AbletonOSC (beat-based)' : 'Fallback (JS timers)'}`);

    // Initialize based on current state
    const state = getState();
    if (state.phase === 'running') {
      const currentRow = state.rows[state.currentRowIndex];
      // Synthesize a phase changed event to trigger scheduling
      onStateChanged(state, [
        { type: 'ROW_PHASE_CHANGED', row: state.currentRowIndex, phase: currentRow.phase },
      ]);
    }
  }

  /**
   * Stop the timing engine
   */
  function stop(): void {
    if (!running) return;

    running = false;
    cancelCurrentTimer();
    beatTrackingState = null;

    // Unsubscribe from beat events
    if (engineConfig.oscBridge) {
      engineConfig.oscBridge.send('/live/song/stop_listen/beat');
    }

    console.log('[Timing] Engine stopped');
  }

  /**
   * Clean up resources
   */
  function dispose(): void {
    stop();
    console.log('[Timing] Engine disposed');
  }

  /**
   * Check if engine is running
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

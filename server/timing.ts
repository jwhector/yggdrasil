/**
 * Timing Engine - Hybrid Timing with Ableton + Server Timers
 *
 * Manages automatic phase advancement with a hybrid approach:
 * - Ableton Live controls musical timing (audition loops, audio cues)
 * - Server JS timers control game logic timing (voting, coup windows)
 *
 * Architecture:
 * - Observes state changes via onStateChanged()
 * - For audition: Sends OSC to Ableton, waits for loop_complete/audition_done
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
 * Audition state tracking (when waiting for Ableton)
 */
interface AuditionState {
  rowIndex: number;
  optionIndex: number;
  waitingForAbleton: boolean;
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
  let auditionState: AuditionState | null = null;

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
  // Audition Phase (Ableton-Driven or Fallback)
  // ============================================================================

  /**
   * Handle entering audition phase
   */
  function handleAuditionPhase(state: ShowState, row: Row): void {
    const rawAuditionIndex = row.currentAuditionIndex ?? 0;
    const optionIndex = rawAuditionIndex % 4;  // Always 0-3
    const option = row.options[optionIndex];
    const timing = state.config.timing;
    const loopsPerRow = timing.auditionLoopsPerRow ?? 1;
    const currentLoop = Math.floor(rawAuditionIndex / 4) + 1;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // Ableton mode: Send OSC, wait for response
      console.log(`[Timing] Audition: Sending to Ableton - row ${row.index}, option ${optionIndex} (loop ${currentLoop}/${loopsPerRow})`);

      auditionState = {
        rowIndex: row.index,
        optionIndex: rawAuditionIndex,  // Store raw index for validation
        waitingForAbleton: true,
      };

      // Send the actual option index (0-3) to Ableton, not the raw index
      engineConfig.oscBridge.send(
        '/ygg/audition/start',
        row.index,
        optionIndex,
        option.id
      );

      // No timer - we wait for Ableton's audition_done message
    } else {
      // Fallback mode: Use JS timer
      console.log(`[Timing] Audition (fallback): option ${optionIndex} (loop ${currentLoop}/${loopsPerRow})`);

      auditionState = {
        rowIndex: row.index,
        optionIndex: rawAuditionIndex,  // Store raw index for validation
        waitingForAbleton: false,
      };

      // Calculate total audition time for this option
      // Each audition step = one option * loops per option
      const totalMs = timing.auditionPerOptionMs * timing.auditionLoopsPerOption;

      scheduleAdvance(totalMs, state.version, `auditioning option ${optionIndex} (loop ${currentLoop})`);
    }
  }

  /**
   * Handle audition_done message from Ableton
   */
  function handleAbletonAuditionDone(rowIndex: number, optionIndex: number): void {
    const state = getState();

    // Verify we're still in the expected state
    if (state.phase !== 'running') {
      console.log('[Timing] Ignoring audition_done - show not running');
      return;
    }

    const currentRow = state.rows[state.currentRowIndex];
    if (currentRow.phase !== 'voting' || currentRow.auditionComplete) {
      console.log('[Timing] Ignoring audition_done - not in voting/auditioning phase');
      return;
    }

    if (state.currentRowIndex !== rowIndex) {
      console.log(`[Timing] Ignoring audition_done - wrong row (expected ${state.currentRowIndex}, got ${rowIndex})`);
      return;
    }

    // Compare against the actual option index (0-3), not raw audition index
    const currentOptionIndex = (currentRow.currentAuditionIndex ?? 0) % 4;
    if (currentOptionIndex !== optionIndex) {
      console.log(`[Timing] Ignoring audition_done - wrong option (expected ${currentOptionIndex}, got ${optionIndex})`);
      return;
    }

    console.log(`[Timing] Ableton audition_done: row ${rowIndex}, option ${optionIndex} - advancing`);
    auditionState = null;
    sendCommand({ type: 'ADVANCE_PHASE' });
  }

  /**
   * Handle loop_complete message from Ableton (optional tracking)
   */
  function handleAbletonLoopComplete(rowIndex: number, optionIndex: number, loopCount: number): void {
    console.log(`[Timing] Ableton loop_complete: row ${rowIndex}, option ${optionIndex}, loop ${loopCount}`);
    // Currently just for logging - could be used for UI feedback
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
   * Handle incoming OSC messages from Ableton
   */
  function onOSCMessage(address: string, args: any[]): void {
    if (!running) return;

    switch (address) {
      case '/ableton/audition/done': {
        const [rowIndex, optionIndex] = args;
        handleAbletonAuditionDone(rowIndex, optionIndex);
        break;
      }

      case '/ableton/loop/complete': {
        const [rowIndex, optionIndex, loopCount] = args;
        handleAbletonLoopComplete(rowIndex, optionIndex, loopCount);
        break;
      }

      case '/ableton/cue/hit': {
        const [cueName] = args;
        console.log(`[Timing] Ableton cue hit: ${cueName}`);
        // TODO: Handle cue-based timing (e.g., reveal_complete)
        break;
      }

      case '/ableton/ready': {
        console.log('[Timing] Ableton is ready');
        break;
      }

      default:
        console.log(`[Timing] Unknown OSC message: ${address}`, args);
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
      auditionState = null;
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
      engineConfig.oscBridge.on('/ableton/audition/done', (...args) => {
        onOSCMessage('/ableton/audition/done', args);
      });
      engineConfig.oscBridge.on('/ableton/loop/complete', (...args) => {
        onOSCMessage('/ableton/loop/complete', args);
      });
      engineConfig.oscBridge.on('/ableton/cue/hit', (...args) => {
        onOSCMessage('/ableton/cue/hit', args);
      });
      engineConfig.oscBridge.on('/ableton/ready', (...args) => {
        onOSCMessage('/ableton/ready', args);
      });
    }

    console.log('[Timing] Engine started');
    console.log(`[Timing] Mode: ${engineConfig.oscBridge ? 'Ableton (OSC)' : 'Fallback (JS timers)'}`);

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
    auditionState = null;

    // Unwire OSC handlers
    if (engineConfig.oscBridge) {
      // Note: Would need to store handler references to properly remove them
      // For now, the bridge's removeAllListeners on stop() handles cleanup
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

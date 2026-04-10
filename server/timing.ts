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
 * Loop boundary tracking state (for performer mix pending changes — V3.3 quilt)
 */
interface LoopTrackingState {
  lastBoundaryBeat: number;    // Beat number at last loop boundary (-1 = not yet set)
  loopBeats: number;           // from config.timing.loopBoundaryBeats
  crossfadeBeats: number;      // How many beats before boundary to fire PREPARE_COLUMN_CROSSFADE
  crossfadeSent: boolean;      // Whether the pre-cue has been sent for the current interval
}

/**
 * Remix loop boundary tracking state (V3.4 token pool).
 * Simpler than V3.3: just fires LOOP_BOUNDARY at each 8-bar boundary, no crossfade pre-cue.
 */
interface RemixLoopTrackingState {
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
  let assignmentTimer: NodeJS.Timeout | null = null;
  let auditionState: AuditionTrackingState | null = null;
  let fallbackAuditionInterval: NodeJS.Timeout | null = null;
  let fallbackAuditionLoopIndex = 0;
  let loopState: LoopTrackingState | null = null;
  let fallbackLoopInterval: NodeJS.Timeout | null = null;
  let fallbackCrossfadeTimeout: NodeJS.Timeout | null = null;
  let remixLoopState: RemixLoopTrackingState | null = null;
  let fallbackRemixLoopInterval: NodeJS.Timeout | null = null;
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

  // --------------------------------------------------------------------------
  // Finale Timers (Assignment — self-select mode only)
  // --------------------------------------------------------------------------

  function startAssignmentTimer(durationMs: number): void {
    clearAssignmentTimer();
    console.log(`[Timing] Assignment timer: ${durationMs}ms`);
    assignmentTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_assignment') {
        console.log('[Timing] Assignment timer expired → ASSIGNMENT_COMPLETE');
        sendCommand({ type: 'ASSIGNMENT_COMPLETE' });
      }
      assignmentTimer = null;
    }, durationMs);
  }

  function clearAssignmentTimer(): void {
    if (assignmentTimer) {
      clearTimeout(assignmentTimer);
      assignmentTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Preview Timer (V3.3)
  // --------------------------------------------------------------------------

  let previewTimer: NodeJS.Timeout | null = null;

  function startPreviewTimer(durationMs: number): void {
    clearPreviewTimer();
    console.log(`[Timing] Preview timer: ${durationMs}ms`);
    previewTimer = setTimeout(() => {
      if (!running) return;
      const state = getState();
      if (state.phase === 'finale_preview') {
        console.log('[Timing] Preview timer expired → PREVIEW_COMPLETE');
        sendCommand({ type: 'PREVIEW_COMPLETE' });
        sendCommand({ type: 'ADVANCE_PHASE' });
      }
      previewTimer = null;
    }, durationMs);
  }

  function clearPreviewTimer(): void {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Arc Tracking (V3.3: beat-driven arc phase triggers)
  // --------------------------------------------------------------------------

  // Arc entry/exit triggers are driven by Ableton loop boundaries (every 32 beats).
  // Raw→sort and sort pass transitions are driven by the conductor detecting grid
  // loop wraps in handleAdvanceQuiltColumn — no timing-level triggers needed for those.

  interface ArcTrackingState {
    abletonLoopCount: number;
    lastAbletonLoopBeat: number;
    triggers: Array<{ atLoop: number; command: ConductorCommand }>;
    firedTriggers: Set<number>;
  }
  let arcTrackingState: ArcTrackingState | null = null;

  /**
   * Start beat-driven arc tracking. Pre-computes a trigger table of
   * Ableton loop boundaries → commands (entry/exit row groups).
   * Raw→sort and sort pass transitions happen in the conductor via grid loop wraps.
   */
  function startArcTracking(state: ShowState): void {
    stopArcTracking();

    const arcConfig = state.config.finale.quilt.arc;
    if (!arcConfig?.enabled || !state.finaleState?.arc) return;

    const triggers: Array<{ atLoop: number; command: ConductorCommand }> = [];

    // Entry row groups: fire at their abletonLoopIndex
    // (group 0 is already entered by handleStartPlayback at loop 0)
    for (let i = 0; i < arcConfig.entrySchedule.length; i++) {
      const group = arcConfig.entrySchedule[i];
      if (group.abletonLoopIndex === 0) continue; // Already fired
      triggers.push({
        atLoop: group.abletonLoopIndex,
        command: { type: 'ARC_ENTRY_ROW_GROUP', groupIndex: i },
      });
    }

    // Exit row groups: offset by entry + raw + sorted playback duration.
    // But we don't know the exact Ableton loop count for exit start — the conductor
    // will set arc.phase = 'exit' when sorted playback is done (via grid loop wraps).
    // We schedule exit triggers relative to when the exit phase begins, using a
    // separate mechanism: check arc.phase in the beat handler and count from there.
    // For simplicity, we'll handle exit triggers reactively (see handleArcBeat below).

    arcTrackingState = {
      abletonLoopCount: 0,
      lastAbletonLoopBeat: -1,
      triggers,
      firedTriggers: new Set(),
    };

    console.log(`[Timing] Arc tracking started: ${triggers.length} entry triggers`);
  }

  // Exit tracking: separate counter that starts when arc enters 'exit' phase
  let exitLoopCount = 0;
  let lastExitLoopBeat = -1;
  let exitTriggersActive = false;

  /**
   * Called on each Ableton loop boundary (every configuredLoopBoundaryBeats beats).
   * Fires entry/exit row group commands based on loop count.
   */
  function handleArcBeat(monotonicBeat: number): void {
    if (!arcTrackingState) return;

    const state = getState();
    const arcPhase = state.finaleState?.arc?.phase;
    if (!arcPhase) return;

    // Initialize baseline on first beat
    if (arcTrackingState.lastAbletonLoopBeat < 0) {
      arcTrackingState.lastAbletonLoopBeat = monotonicBeat;
      return;
    }

    const beatsSinceLast = monotonicBeat - arcTrackingState.lastAbletonLoopBeat;
    if (beatsSinceLast >= configuredLoopBoundaryBeats) {
      arcTrackingState.lastAbletonLoopBeat = monotonicBeat;
      arcTrackingState.abletonLoopCount++;

      // Check entry triggers
      if (arcPhase === 'entry') {
        for (let i = 0; i < arcTrackingState.triggers.length; i++) {
          const trigger = arcTrackingState.triggers[i];
          if (!arcTrackingState.firedTriggers.has(i) && trigger.atLoop <= arcTrackingState.abletonLoopCount) {
            arcTrackingState.firedTriggers.add(i);
            sendCommand(trigger.command);
          }
        }
      }
    }

    // Exit phase tracking: count Ableton loops since exit started
    if (arcPhase === 'exit') {
      const arcConfig = state.config.finale.quilt.arc;
      if (!arcConfig) return;

      if (!exitTriggersActive) {
        // First time in exit phase — initialize
        exitTriggersActive = true;
        exitLoopCount = 0;
        lastExitLoopBeat = monotonicBeat;
      }

      const exitBeatsSinceLast = monotonicBeat - lastExitLoopBeat;
      if (exitBeatsSinceLast >= configuredLoopBoundaryBeats) {
        lastExitLoopBeat = monotonicBeat;
        exitLoopCount++;

        // Fire exit group commands
        for (let i = 0; i < arcConfig.exitSchedule.length; i++) {
          const group = arcConfig.exitSchedule[i];
          if (group.abletonLoopIndex === exitLoopCount) {
            sendCommand({ type: 'ARC_EXIT_ROW_GROUP', groupIndex: i });
          }
        }
      }
    } else {
      // Reset exit tracking if we're not in exit phase
      exitTriggersActive = false;
    }
  }

  function stopArcTracking(): void {
    arcTrackingState = null;
    exitTriggersActive = false;
    exitLoopCount = 0;
    lastExitLoopBeat = -1;
  }

  function clearAllFinaleTimers(): void {
    clearAssignmentTimer();
    clearPreviewTimer();
    stopArcTracking();
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
  // Loop Boundary Tracking (Performer Mix)
  // --------------------------------------------------------------------------

  /**
   * Start loop boundary tracking for performer mix phase.
   * Fires FIRE_PENDING_CHANGES at each 8-bar boundary.
   */
  function startLoopTracking(): void {
    stopLoopTracking();

    // Reset beat baseline so rawToMonotonic handles the jump to beat 0 cleanly
    previousRawBeat = -1;
    beatWrapOffset = 0;
    currentAbsoluteBeat = 0;

    const state = getState();
    const columns = state.finaleState?.quilt.columns ?? 1;
    const columnTiming = state.config.finale.quilt.columnTiming ?? 'divided';
    const loopBeats = Math.round(
      columnTiming === 'divided'
        ? configuredLoopBoundaryBeats / columns
        : columnTiming === 'half_loop'
          ? configuredLoopBoundaryBeats / 2
          : configuredLoopBoundaryBeats
    );
    const loopBars = loopBeats / BEATS_PER_BAR;

    const crossfadeBeats = Math.min(
      state.config.timing.gain?.crossfadeBeats ?? 1,
      loopBeats - 1, // Clamp: pre-cue can't fire at or before previous boundary
    );

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      // OSC mode: track beats
      loopState = {
        lastBoundaryBeat: -1,
        loopBeats,
        crossfadeBeats,
        crossfadeSent: false,
      };
      console.log(`[Timing] Loop boundary tracking started (OSC, every ${loopBars} bars / ${loopBeats} beats, crossfade ${crossfadeBeats} beats early)`);
    } else {
      // Fallback: JS interval
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = loopBeats * msPerBeat;
      const crossfadeMs = crossfadeBeats * msPerBeat;

      // Schedule the first pre-cue (subsequent ones are scheduled after each boundary)
      fallbackCrossfadeTimeout = setTimeout(() => {
        if (!running) return;
        sendCommand({ type: 'PREPARE_COLUMN_CROSSFADE' });
      }, intervalMs - crossfadeMs);

      fallbackLoopInterval = setInterval(() => {
        if (!running) return;
        const state = getState();
        if (state.phase !== 'finale_playback') {
          stopLoopTracking();
          return;
        }
        sendCommand({ type: 'ADVANCE_QUILT_COLUMN' });

        // Schedule next pre-cue
        fallbackCrossfadeTimeout = setTimeout(() => {
          if (!running) return;
          sendCommand({ type: 'PREPARE_COLUMN_CROSSFADE' });
        }, intervalMs - crossfadeMs);
      }, intervalMs);

      console.log(`[Timing] Loop boundary tracking started (fallback, every ${intervalMs.toFixed(0)}ms, crossfade ${crossfadeMs.toFixed(0)}ms early)`);
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
    if (fallbackCrossfadeTimeout) {
      clearTimeout(fallbackCrossfadeTimeout);
      fallbackCrossfadeTimeout = null;
    }
  }

  // --------------------------------------------------------------------------
  // Remix Loop Boundary Tracking (V3.4 token pool)
  // --------------------------------------------------------------------------

  /**
   * Start loop boundary tracking for the finale_remix phase.
   * Fires LOOP_BOUNDARY at each 8-bar (loopBoundaryBeats) boundary.
   * Simpler than V3.3 loop tracking — no crossfade pre-cue, no column logic.
   */
  function startRemixLoopTracking(): void {
    stopRemixLoopTracking();

    // Reset beat baseline so rawToMonotonic handles the jump to beat 0 cleanly
    previousRawBeat = -1;
    beatWrapOffset = 0;
    currentAbsoluteBeat = 0;

    const loopBeats = configuredLoopBoundaryBeats;

    if (engineConfig.oscBridge && engineConfig.oscBridge.isRunning()) {
      remixLoopState = { lastBoundaryBeat: -1, loopBeats };
      console.log(`[Timing] Remix loop tracking started (OSC, every ${loopBeats} beats)`);
    } else {
      // Fallback: JS interval
      const msPerBeat = 60000 / engineConfig.fallbackBpm;
      const intervalMs = loopBeats * msPerBeat;

      fallbackRemixLoopInterval = setInterval(() => {
        if (!running) return;
        const state = getState();
        if (state.phase !== 'finale_remix') {
          stopRemixLoopTracking();
          return;
        }
        sendCommand({ type: 'LOOP_BOUNDARY' });
      }, intervalMs);

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

    // --- Remix loop boundary (V3.4 token pool) ---
    if (remixLoopState && state.phase === 'finale_remix') {
      if (remixLoopState.lastBoundaryBeat < 0) {
        remixLoopState.lastBoundaryBeat = monotonicBeat;
      }
      const remixBeatsSinceBoundary = monotonicBeat - remixLoopState.lastBoundaryBeat;
      if (remixBeatsSinceBoundary >= remixLoopState.loopBeats) {
        remixLoopState.lastBoundaryBeat = monotonicBeat;
        sendCommand({ type: 'LOOP_BOUNDARY' });
      }
      return; // Remix loop handled — do not fall through to V3.3 loop tracking
    }

    // --- Loop boundary tracking (live mix — V3.3 quilt) ---
    if (!loopState) return;
    if (state.phase !== 'finale_playback') return;

    // Initialize baseline on first beat
    if (loopState.lastBoundaryBeat < 0) {
      loopState.lastBoundaryBeat = monotonicBeat;
    }

    const beatsSinceBoundary = monotonicBeat - loopState.lastBoundaryBeat;

    // Pre-cue: start crossfade ahead of boundary
    if (!loopState.crossfadeSent && beatsSinceBoundary >= loopState.loopBeats - loopState.crossfadeBeats) {
      loopState.crossfadeSent = true;
      sendCommand({ type: 'PREPARE_COLUMN_CROSSFADE' });
    }

    // Boundary: advance playhead state (audio already transitioning)
    if (beatsSinceBoundary >= loopState.loopBeats) {
      loopState.lastBoundaryBeat = monotonicBeat;
      loopState.crossfadeSent = false;
      sendCommand({ type: 'ADVANCE_QUILT_COLUMN' });
    }

    // --- Arc entry/exit tracking (on Ableton loop boundaries) ---
    handleArcBeat(monotonicBeat);
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
      stopLoopTracking();
      clearAllFinaleTimers();

      if (showPhaseEvent.phase === 'finale_playback') {
        startLoopTracking();
        // Start beat-driven arc tracking if arc is enabled
        startArcTracking(state);
      }

      if (showPhaseEvent.phase === 'finale_remix') {
        startRemixLoopTracking();
      }
    }

    // Assignment started (self-select mode) → start assignment timer
    const assignmentStartedEvent = events.find(e => e.type === 'ASSIGNMENT_STARTED') as
      | { type: 'ASSIGNMENT_STARTED'; mode: 'auto' | 'self_select' }
      | undefined;
    if (assignmentStartedEvent && assignmentStartedEvent.mode === 'self_select') {
      const timerMs = state.config.finale.quilt.assignmentTimerMs;
      if (timerMs > 0) {
        startAssignmentTimer(timerMs);
      }
    }

    // All cells assigned → clear assignment timer
    if (events.some(e => e.type === 'ALL_CELLS_ASSIGNED')) {
      clearAssignmentTimer();
    }

    // Preview started → start preview timer
    if (events.some(e => e.type === 'PREVIEW_STARTED')) {
      const timerMs = state.config.finale.quilt.previewTimerMs;
      if (timerMs > 0) {
        startPreviewTimer(timerMs);
      }
    }

    // All users locked in → clear preview timer (ADVANCE_PHASE handled by conductor/server)
    if (events.some(e => e.type === 'USER_LOCKED_IN')) {
      // Check if all cell owners have locked in
      const fs = state.finaleState;
      if (fs && fs.phase === 'preview') {
        let allLocked = true;
        for (const cell of fs.quilt.cells.values()) {
          if (cell.ownerId && !fs.preview.lockedInUsers.has(cell.ownerId)) {
            allLocked = false;
            break;
          }
        }
        if (allLocked) {
          clearPreviewTimer();
          sendCommand({ type: 'PREVIEW_COMPLETE' });
          sendCommand({ type: 'ADVANCE_PHASE' });
        }
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
    } else if (state.phase === 'finale_playback') {
      startLoopTracking();
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

    if (state.phase === 'finale_assignment' && state.finaleState.assignment.mode === 'self_select') {
      const timerRemaining = state.finaleState.assignment.timerRemaining;
      if (timerRemaining !== null) {
        const remaining = timerRemaining - elapsed;
        if (remaining > 0) {
          console.log(`[Timing] Recovering assignment timer: ${remaining}ms remaining`);
          startAssignmentTimer(remaining);
        } else {
          console.log('[Timing] Assignment timer already expired on recovery → firing ASSIGNMENT_COMPLETE');
          sendCommand({ type: 'ASSIGNMENT_COMPLETE' });
        }
      }
    }

    if (state.phase === 'finale_preview') {
      const timerRemaining = state.finaleState.preview.timerRemaining;
      if (timerRemaining !== null) {
        const remaining = timerRemaining - elapsed;
        if (remaining > 0) {
          console.log(`[Timing] Recovering preview timer: ${remaining}ms remaining`);
          startPreviewTimer(remaining);
        } else {
          console.log('[Timing] Preview timer already expired on recovery → firing PREVIEW_COMPLETE');
          sendCommand({ type: 'PREVIEW_COMPLETE' });
          sendCommand({ type: 'ADVANCE_PHASE' });
        }
      }
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

    // Reset audition/loop baselines so they re-anchor to new beats
    if (auditionState) auditionState.lastToggleBeat = -1;
    if (loopState) loopState.lastBoundaryBeat = -1;
    if (remixLoopState) remixLoopState.lastBoundaryBeat = -1;

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
    } else if (state.phase === 'finale_playback') {
      startLoopTracking();
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

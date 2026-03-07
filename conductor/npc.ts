/**
 * NPC — Reactive Narrative Voice Auto-Trigger Evaluation
 *
 * The NPC speaks at inflection points in the consensus game. This module
 * evaluates configured trigger conditions against current game state and
 * returns the first matching message (or null if nothing fires).
 *
 * Pure function, no I/O.
 */

import type { Fragment, LayerType, NpcTriggerConfig } from './types';

/** Snapshot of game state passed to NPC evaluation. */
export interface NpcGameState {
  consecutiveFailures: number;
  lastConvergence: number;          // Convergence value from the most recent round
  threshold: number;                // Current threshold at time of evaluation
  lockedRoles: Map<LayerType, string>;
  availableFragments: Fragment[];
  /** Most recent lock history (latest last) for same_song_streak detection. */
  recentLockHistory: Array<{ attemptIndex: number }>;
}

/**
 * Evaluate auto-trigger conditions in order and return the first matching
 * message, or null if nothing fires.
 */
export function evaluateAutoTriggers(
  gameState: NpcGameState,
  triggerConfigs: NpcTriggerConfig[],
): string | null {
  for (const config of triggerConfigs) {
    if (matchesTrigger(gameState, config)) {
      return config.message;
    }
  }
  return null;
}

function matchesTrigger(gameState: NpcGameState, config: NpcTriggerConfig): boolean {
  const threshold = config.threshold ?? 1;

  switch (config.condition) {
    case 'consecutive_failures':
      return gameState.consecutiveFailures >= threshold;

    case 'same_song_streak': {
      // Last N locked fragments all came from the same attempt
      const history = gameState.recentLockHistory;
      if (history.length < threshold) return false;
      const last = history.slice(-threshold);
      const firstAttempt = last[0].attemptIndex;
      return last.every(e => e.attemptIndex === firstAttempt);
    }

    case 'near_miss': {
      // Convergence was close to threshold but below it (within 5%)
      // Small epsilon handles floating-point imprecision (e.g. 0.4 - 0.05 !== 0.35 exactly)
      const delta = 0.05 + 1e-10;
      return (
        gameState.lastConvergence < gameState.threshold &&
        gameState.lastConvergence >= gameState.threshold - delta
      );
    }

    case 'first_success':
      // Just locked the first role (size is 1 after success)
      return gameState.lockedRoles.size === 1;

    case 'final_fragment':
      // 6 roles locked, one remaining
      return gameState.lockedRoles.size === 6;

    case 'single_option_role': {
      // Any unlocked role has only one available fragment
      const lockedLayerTypes = new Set(gameState.lockedRoles.keys());
      const countByRole = new Map<LayerType, number>();
      for (const f of gameState.availableFragments) {
        if (!lockedLayerTypes.has(f.layerType)) {
          countByRole.set(f.layerType, (countByRole.get(f.layerType) ?? 0) + 1);
        }
      }
      for (const count of countByRole.values()) {
        if (count === 1) return true;
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Health Bar — Cumulative song vitality tracking
 *
 * Pure functions for managing the health bar state during a song-building attempt.
 * The health bar starts at 100 and drains after each vote using a two-component model:
 *
 *   drain[i] = ENTROPY[i] + FRAGILITY[i] × losingProportion
 *
 * ENTROPY: inevitable cost per layer, gently rising. Sum = 89.
 *   Guarantees collapse after all 6 layers even at 100% consensus.
 *
 * FRAGILITY: disagreement penalty, front-loaded. Sum = 200.
 *   Early disagreement is devastating; late-stage disagreement is survivable.
 *   A creative project is most fragile at the beginning.
 *
 * Completion (all 6 layers locked) requires ~95% average alignment.
 * At 50/50 splits, collapse hits on the 3rd vote (2 layers locked).
 * At 70/30 splits, collapse hits on the 4th vote (3 layers locked).
 *
 * Both options from every voted layer survive as finale fragments,
 * so the health bar is purely dramatic — it controls how far the song
 * gets, not which fragments are available.
 */

import type { HealthBarState, HealthBarDrain } from './types';

/** Inevitable drain per layer — the slow entropy of creative effort. Sum = 89. */
const ENTROPY: readonly number[] = [13, 14, 15, 15, 16, 16];

/** Disagreement multiplier per layer — front-loaded fragility. Sum = 200. */
const FRAGILITY: readonly number[] = [42, 46, 38, 32, 24, 18];

/** Number of layers per attempt. */
export const LAYERS_PER_ATTEMPT = 6;

/**
 * Create a fresh health bar at full health (100).
 */
export function createHealthBar(): HealthBarState {
  return {
    current: 100,
    history: [],
    drainFactor: 0.5,
  };
}

/**
 * Calculate the drain for a single layer vote.
 *
 * drain = ENTROPY[layerIndex] + FRAGILITY[layerIndex] × losingProportion
 *
 * losingProportion ranges from 0.0 (unanimous) to 0.5 (perfectly split).
 * Returns a HealthBarDrain with healthAfter set to 0 as a placeholder.
 * Call applyDrain to update the health bar and set the real healthAfter.
 */
export function calculateDrain(
  votesA: number,
  votesB: number,
  layerIndex: number,
): HealthBarDrain {
  if (layerIndex < 0 || layerIndex >= LAYERS_PER_ATTEMPT) {
    throw new Error(`layerIndex ${layerIndex} out of range [0, ${LAYERS_PER_ATTEMPT - 1}]`);
  }

  const total = votesA + votesB;
  const losingProportion = total === 0 ? 0 : Math.min(votesA, votesB) / total;
  const drainAmount = ENTROPY[layerIndex] + FRAGILITY[layerIndex] * losingProportion;

  return {
    layerIndex,
    losingProportion,
    drainAmount,
    healthAfter: 0, // Set by applyDrain
  };
}

/**
 * Apply a drain event to the health bar.
 *
 * Mutates the health bar (subtracts drain, floors at 0, appends to history).
 * Also mutates drain.healthAfter to record the resulting health value.
 * Returns the mutated health bar.
 */
export function applyDrain(healthBar: HealthBarState, drain: HealthBarDrain): HealthBarState {
  const newHealth = Math.max(0, healthBar.current - drain.drainAmount);
  drain.healthAfter = newHealth;
  healthBar.current = newHealth;
  healthBar.history.push(drain);
  return healthBar;
}

/**
 * Returns true if the health bar has reached zero (attempt has collapsed).
 */
export function isCollapsed(healthBar: HealthBarState): boolean {
  return healthBar.current <= 0;
}
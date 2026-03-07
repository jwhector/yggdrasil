/**
 * Health Bar — Cumulative song vitality tracking
 *
 * Pure functions for managing the health bar state during a song-building attempt.
 * The health bar starts at 100 and drains after each vote based on:
 *   drain = (min(votesA, votesB) / total) * 100 * drainFactor * layerMultiplier
 *
 * When health reaches zero, the attempt collapses.
 */

import type { HealthBarState, HealthBarDrain } from './types';

/**
 * Create a fresh health bar at full health (100).
 */
export function createHealthBar(drainFactor: number, layerMultipliers: number[]): HealthBarState {
  return {
    current: 100,
    drainFactor,
    layerMultipliers,
    history: [],
  };
}

/**
 * Calculate the drain for a single layer vote.
 *
 * Returns a HealthBarDrain with healthAfter set to 0 as a placeholder.
 * Call applyDrain to update the health bar and set the real healthAfter.
 */
export function calculateDrain(
  votesA: number,
  votesB: number,
  drainFactor: number,
  layerMultiplier: number,
  layerIndex: number,
): HealthBarDrain {
  const total = votesA + votesB;
  const losingProportion = total === 0 ? 0 : Math.min(votesA, votesB) / total;
  const drainAmount = losingProportion * 100 * drainFactor * layerMultiplier;

  return {
    layerIndex,
    losingProportion,
    layerMultiplier,
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

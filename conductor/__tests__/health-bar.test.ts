/**
 * Health Bar — Unit Tests
 */

import { describe, test, expect } from '@jest/globals';
import { createHealthBar, calculateDrain, applyDrain, isCollapsed } from '../health-bar';
import type { HealthBarState } from '../types';

// ============================================================================
// createHealthBar
// ============================================================================

describe('createHealthBar', () => {
  test('starts at full health (100)', () => {
    const hb = createHealthBar(0.5, [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]);
    expect(hb.current).toBe(100);
  });

  test('stores drainFactor and layerMultipliers', () => {
    const multipliers = [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0];
    const hb = createHealthBar(0.75, multipliers);
    expect(hb.drainFactor).toBe(0.75);
    expect(hb.layerMultipliers).toEqual(multipliers);
  });

  test('starts with empty history', () => {
    const hb = createHealthBar(0.5, [1.0]);
    expect(hb.history).toHaveLength(0);
  });
});

// ============================================================================
// calculateDrain
// ============================================================================

describe('calculateDrain', () => {
  test('70/30 split with factor 0.5 and multiplier 1.0 drains 15 points', () => {
    // 7A, 3B: losingProportion = 3/10 = 0.3 → drain = 0.3 * 100 * 0.5 * 1.0 = 15
    const drain = calculateDrain(7, 3, 0.5, 1.0, 0);
    expect(drain.drainAmount).toBeCloseTo(15);
    expect(drain.losingProportion).toBeCloseTo(0.3);
  });

  test('same 70/30 split with multiplier 2.0 drains 30 points', () => {
    // drain = 0.3 * 100 * 0.5 * 2.0 = 30
    const drain = calculateDrain(7, 3, 0.5, 2.0, 0);
    expect(drain.drainAmount).toBeCloseTo(30);
  });

  test('50/50 split with factor 0.5 and multiplier 1.0 drains 25 points', () => {
    // losingProportion = 5/10 = 0.5 → drain = 0.5 * 100 * 0.5 * 1.0 = 25
    const drain = calculateDrain(5, 5, 0.5, 1.0, 0);
    expect(drain.drainAmount).toBeCloseTo(25);
    expect(drain.losingProportion).toBeCloseTo(0.5);
  });

  test('layer multiplier 0.5 makes early layers cheap (70/30 split drains only 7.5)', () => {
    // drain = 0.3 * 100 * 0.5 * 0.5 = 7.5
    const drain = calculateDrain(7, 3, 0.5, 0.5, 0);
    expect(drain.drainAmount).toBeCloseTo(7.5);
  });

  test('unanimous vote (100/0) causes zero drain', () => {
    const drain = calculateDrain(10, 0, 0.5, 1.0, 0);
    expect(drain.drainAmount).toBe(0);
    expect(drain.losingProportion).toBe(0);
  });

  test('zero total votes causes zero drain', () => {
    const drain = calculateDrain(0, 0, 0.5, 1.0, 0);
    expect(drain.drainAmount).toBe(0);
    expect(drain.losingProportion).toBe(0);
  });

  test('records correct layerIndex and layerMultiplier', () => {
    const drain = calculateDrain(7, 3, 0.5, 1.3, 4);
    expect(drain.layerIndex).toBe(4);
    expect(drain.layerMultiplier).toBe(1.3);
  });

  test('uses the minority side regardless of which option wins', () => {
    // Same split, B wins this time: losingProportion = min(3,7)/10 = 0.3
    const drain = calculateDrain(3, 7, 0.5, 1.0, 0);
    expect(drain.losingProportion).toBeCloseTo(0.3);
    expect(drain.drainAmount).toBeCloseTo(15);
  });
});

// ============================================================================
// applyDrain
// ============================================================================

describe('applyDrain', () => {
  test('subtracts drain amount from health bar current', () => {
    const hb = createHealthBar(0.5, [1.0]);
    const drain = calculateDrain(7, 3, 0.5, 1.0, 0); // 15 points
    applyDrain(hb, drain);
    expect(hb.current).toBeCloseTo(85);
  });

  test('health bar never goes below zero', () => {
    const hb = createHealthBar(0.5, [1.0]);
    // 50/50 split with factor 2.0 → drain = 0.5*100*2.0*1.0 = 100 → health goes to 0
    const drain = calculateDrain(5, 5, 2.0, 1.0, 0);
    applyDrain(hb, drain);
    expect(hb.current).toBe(0);
  });

  test('health bar floors at zero when drain exceeds remaining health', () => {
    const hb = createHealthBar(0.5, [1.0]);
    hb.current = 10; // Artificially reduce health
    const drain = calculateDrain(5, 5, 0.5, 1.0, 0); // 25 point drain
    applyDrain(hb, drain);
    expect(hb.current).toBe(0); // Would be -15, but floored at 0
  });

  test('sets drain.healthAfter to the post-drain health value', () => {
    const hb = createHealthBar(0.5, [1.0]);
    const drain = calculateDrain(7, 3, 0.5, 1.0, 0); // 15 points
    applyDrain(hb, drain);
    expect(drain.healthAfter).toBeCloseTo(85);
  });

  test('drain history accumulates correctly across multiple layers', () => {
    const hb = createHealthBar(0.5, [1.0, 1.0, 1.0]);
    const drain0 = calculateDrain(7, 3, 0.5, 1.0, 0); // 15 points
    const drain1 = calculateDrain(6, 4, 0.5, 1.0, 1); // 20 points
    const drain2 = calculateDrain(5, 5, 0.5, 1.0, 2); // 25 points

    applyDrain(hb, drain0);
    applyDrain(hb, drain1);
    applyDrain(hb, drain2);

    expect(hb.history).toHaveLength(3);
    expect(hb.history[0].drainAmount).toBeCloseTo(15);
    expect(hb.history[1].drainAmount).toBeCloseTo(20);
    expect(hb.history[2].drainAmount).toBeCloseTo(25);
    expect(hb.current).toBeCloseTo(40); // 100 - 15 - 20 - 25
  });

  test('healthAfter reflects cumulative drain (not just this drain)', () => {
    const hb = createHealthBar(0.5, [1.0, 1.0]);
    const drain0 = calculateDrain(7, 3, 0.5, 1.0, 0); // 15 points
    const drain1 = calculateDrain(6, 4, 0.5, 1.0, 1); // 20 points

    applyDrain(hb, drain0);
    applyDrain(hb, drain1);

    expect(drain0.healthAfter).toBeCloseTo(85);
    expect(drain1.healthAfter).toBeCloseTo(65); // 85 - 20
  });
});

// ============================================================================
// isCollapsed
// ============================================================================

describe('isCollapsed', () => {
  test('returns false when health bar is full', () => {
    const hb = createHealthBar(0.5, [1.0]);
    expect(isCollapsed(hb)).toBe(false);
  });

  test('returns false when health bar is above zero', () => {
    const hb = createHealthBar(0.5, [1.0]);
    hb.current = 1;
    expect(isCollapsed(hb)).toBe(false);
  });

  test('returns true when health bar is exactly zero', () => {
    const hb = createHealthBar(0.5, [1.0]);
    hb.current = 0;
    expect(isCollapsed(hb)).toBe(true);
  });

  test('returns true after draining to zero', () => {
    const hb = createHealthBar(0.5, [1.0]);
    const drain = calculateDrain(5, 5, 2.0, 1.0, 0); // 100 drain
    applyDrain(hb, drain);
    expect(isCollapsed(hb)).toBe(true);
  });
});

// ============================================================================
// Default layer multipliers
// ============================================================================

describe('Default layer multipliers [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]', () => {
  const DEFAULT_MULTIPLIERS = [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0];

  test('later layers cost more than early layers for same vote split', () => {
    const drainFactor = 0.5;
    const drains = DEFAULT_MULTIPLIERS.map((m, i) =>
      calculateDrain(7, 3, drainFactor, m, i).drainAmount
    );

    // Each layer should drain more than the previous
    for (let i = 1; i < drains.length; i++) {
      expect(drains[i]).toBeGreaterThan(drains[i - 1]);
    }
  });

  test('layer 0 (multiplier 0.5) is cheapest with 70/30 split', () => {
    const drain = calculateDrain(7, 3, 0.5, 0.5, 0);
    expect(drain.drainAmount).toBeCloseTo(7.5);
  });

  test('layer 6 (multiplier 2.0) is most expensive with 70/30 split', () => {
    const drain = calculateDrain(7, 3, 0.5, 2.0, 6);
    expect(drain.drainAmount).toBeCloseTo(30);
  });
});

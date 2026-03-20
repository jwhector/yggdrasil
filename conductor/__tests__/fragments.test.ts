/**
 * Fragments — Fragment Generation Tests
 */

import { describe, test, expect } from '@jest/globals';
import { generateFragments, extractAttemptResult } from '../fragments';
import type { AttemptState, AttemptConfig, LayerConfig, AudioReference } from '../types';

function makeAudioRef(index: number): AudioReference {
  return { trackIndex: index };
}

function makeLayerConfig(index: number, threshold: number | null = null): LayerConfig {
  return {
    index,
    type: 'melody',
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
  };
}

function makeAttemptConfig(chapter: 'ambition' | 'love' | 'avoidance', layerCount: number): AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    layers: Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i)),
    thresholds: Array(layerCount).fill(0.5),
    tempos: Array(layerCount).fill(120),
    auditionBars: Array(layerCount).fill(4),
  };
}

function makeCompletedAttempt(index: number, chapter: 'ambition' | 'love' | 'avoidance', layerCount: number): AttemptState {
  const layers = Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i));
  return {
    index,
    chapter,
    layerPlan: layers,
    currentLayerIndex: layerCount - 1,
    currentLayerPhase: 'locked_in',
    layerResults: layers.map((l, i) => ({
      layerIndex: i,
      type: l.type,
      status: 'locked_in' as const,
      chosenOption: i % 2 === 0 ? 'A' as const : 'B' as const,
      winningProportion: 0.8,
      thresholdRequired: 0.5,
      passed: true,
    })),
    votes: [],
    status: 'completed',
    collapsedAtLayer: null,
    currentAuditionOption: null,
    auditionLoopIndex: 0,
    currentVoteResult: null,
  };
}

function makeCollapsedAttempt(index: number, chapter: 'ambition' | 'love' | 'avoidance', layerCount: number, collapseAt: number): AttemptState {
  const layers = Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i));
  return {
    index,
    chapter,
    layerPlan: layers,
    currentLayerIndex: collapseAt,
    currentLayerPhase: 'collapsed',
    layerResults: [
      // Layers before collapse are locked in
      ...Array.from({ length: collapseAt }, (_, i) => ({
        layerIndex: i,
        type: layers[i].type,
        status: 'locked_in' as const,
        chosenOption: 'A' as const,
        winningProportion: 0.8,
        thresholdRequired: 0.5,
        passed: true,
      })),
      // Collapsed layer and beyond are unreached
      ...Array.from({ length: layerCount - collapseAt }, (_, i) => ({
        layerIndex: collapseAt + i,
        type: layers[collapseAt + i].type,
        status: 'unreached' as const,
        chosenOption: null,
        winningProportion: null,
        thresholdRequired: null,
        passed: null,
      })),
    ],
    votes: [],
    status: 'collapsed',
    collapsedAtLayer: collapseAt,
    currentAuditionOption: null,
    auditionLoopIndex: 0,
    currentVoteResult: null,
  };
}

describe('extractAttemptResult', () => {
  test('extracts correct result from a completed attempt', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 3);
    const result = extractAttemptResult(attempt);

    expect(result.attemptIndex).toBe(0);
    expect(result.chapter).toBe('ambition');
    expect(result.completed).toBe(true);
    expect(result.collapsedAtLayer).toBeNull();
    expect(result.layers).toHaveLength(3);
  });

  test('extracts correct result from a collapsed attempt', () => {
    const attempt = makeCollapsedAttempt(1, 'love', 5, 2);
    const result = extractAttemptResult(attempt);

    expect(result.completed).toBe(false);
    expect(result.collapsedAtLayer).toBe(2);
    expect(result.layers.filter(l => l.status === 'locked_in')).toHaveLength(2);
    expect(result.layers.filter(l => l.status === 'unreached')).toHaveLength(3);
  });
});

describe('generateFragments', () => {
  test('produces two fragments per layer for a completed attempt (winner selectable, loser not)', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 3);
    const configs = [makeAttemptConfig('ambition', 3)];
    const fragments = generateFragments([attempt], configs);

    // 3 layers × 2 fragments each = 6
    expect(fragments).toHaveLength(6);

    // Each layer should have exactly one selectable and one non-selectable
    for (let i = 0; i < 3; i++) {
      const layerFragments = fragments.filter(f => f.fragment.layerIndex === i);
      expect(layerFragments).toHaveLength(2);
      expect(layerFragments.filter(f => f.selectable)).toHaveLength(1);
      expect(layerFragments.filter(f => !f.selectable)).toHaveLength(1);
    }
  });

  test('selectable fragment option matches the chosen option from the layer result', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 2);
    const configs = [makeAttemptConfig('ambition', 2)];
    const fragments = generateFragments([attempt], configs);

    // Layer 0 chose A (even index), Layer 1 chose B (odd index)
    const layer0Selectable = fragments.find(f => f.fragment.layerIndex === 0 && f.selectable);
    expect(layer0Selectable?.fragment.option).toBe('A');

    const layer1Selectable = fragments.find(f => f.fragment.layerIndex === 1 && f.selectable);
    expect(layer1Selectable?.fragment.option).toBe('B');
  });

  test('unreached layers produce two non-selectable fragments', () => {
    const attempt = makeCollapsedAttempt(0, 'ambition', 4, 2);
    const configs = [makeAttemptConfig('ambition', 4)];
    const fragments = generateFragments([attempt], configs);

    // Layers 0-1: locked_in → 1 selectable + 1 not each
    // Layers 2-3: unreached → 2 not-selectable each
    // Total: 4 + 4 = 8
    expect(fragments).toHaveLength(8);

    const unreachedFragments = fragments.filter(f => f.fragment.layerIndex >= 2);
    expect(unreachedFragments).toHaveLength(4);
    expect(unreachedFragments.every(f => !f.selectable)).toBe(true);
  });

  test('skips pending attempts entirely', () => {
    const pending: AttemptState = {
      index: 2,
      chapter: 'avoidance',
      layerPlan: [makeLayerConfig(0)],
      currentLayerIndex: 0,
      currentLayerPhase: 'locked',
      layerResults: [],
      votes: [],
      status: 'pending',
      collapsedAtLayer: null,
      currentAuditionOption: null,
      auditionLoopIndex: 0,
      currentVoteResult: null,
    };
    const configs = [makeAttemptConfig('avoidance', 1)];
    const fragments = generateFragments([pending], configs);
    expect(fragments).toHaveLength(0);
  });

  test('generates fragments from multiple attempts with correct chapter assignments', () => {
    const attempt0 = makeCompletedAttempt(0, 'ambition', 2);
    const attempt1 = makeCollapsedAttempt(1, 'love', 3, 1);
    const configs = [
      makeAttemptConfig('ambition', 2),
      makeAttemptConfig('love', 3),
    ];
    const fragments = generateFragments([attempt0, attempt1], configs);

    const ambitionFragments = fragments.filter(f => f.fragment.chapter === 'ambition');
    const loveFragments = fragments.filter(f => f.fragment.chapter === 'love');

    expect(ambitionFragments).toHaveLength(4); // 2 layers × 2
    expect(loveFragments).toHaveLength(6); // 3 layers × 2

    // Love: layer 0 is locked_in (1 selectable), layers 1-2 unreached (all non-selectable)
    const loveSelectable = loveFragments.filter(f => f.selectable);
    expect(loveSelectable).toHaveLength(1);
  });

  test('fragment IDs are unique and follow the expected format', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 3);
    const configs = [makeAttemptConfig('ambition', 3)];
    const fragments = generateFragments([attempt], configs);

    const ids = fragments.map(f => f.fragment.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Check format: attemptIndex-layerIndex-option
    expect(ids).toContain('0-0-A');
    expect(ids).toContain('0-0-B');
    expect(ids).toContain('0-1-A');
    expect(ids).toContain('0-1-B');
  });
});

/**
 * Fragments — Fragment Generation Tests
 */

import { describe, test, expect } from '@jest/globals';
import { generateFragments, generateGranularFragments, extractAttemptResult } from '../fragments';
import type { AttemptState, V32AttemptConfig, V32LayerConfig } from '../types';

const LAYER_GROUPS = ['bones', 'flesh', 'spark'] as const;

function makeLayerConfig(index: number): V32LayerConfig {
  return {
    index,
    group: LAYER_GROUPS[index % LAYER_GROUPS.length],
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    optionA: { tracks: [{ granularType: 'melody', trackIndices: [index * 2] }] },
    optionB: { tracks: [{ granularType: 'melody', trackIndices: [index * 2 + 1] }] },
  };
}

function makeAttemptConfig(chapter: string, layerCount: number): V32AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i)),
    thresholds: Array(layerCount).fill(0.5),
    tempos: Array(layerCount).fill(120),
    auditionBars: Array(layerCount).fill(4),
    auditionCycles: Array(layerCount).fill(1),
  };
}

function makeCompletedAttempt(index: number, chapter: string, layerCount: number): AttemptState {
  const layers = Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i));
  return {
    index,
    chapter,
    layerPlan: layers,
    currentLayerIndex: layerCount - 1,
    currentLayerPhase: 'locked_in',
    layerResults: layers.map((l, i) => ({
      layerIndex: i,
      group: l.group,
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
    currentVoteResult: null, revealStakesShown: false, songRejected: false,
  };
}

function makeCollapsedAttempt(index: number, chapter: string, layerCount: number, collapseAt: number): AttemptState {
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
        group: layers[i].group,
        status: 'locked_in' as const,
        chosenOption: 'A' as const,
        winningProportion: 0.8,
        thresholdRequired: 0.5,
        passed: true,
      })),
      // Collapsed layer and beyond are unreached
      ...Array.from({ length: layerCount - collapseAt }, (_, i) => ({
        layerIndex: collapseAt + i,
        group: layers[collapseAt + i].group,
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
    currentVoteResult: null, revealStakesShown: false, songRejected: false,
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
      chapter: 'acceptance',
      layerPlan: [makeLayerConfig(0)],
      currentLayerIndex: 0,
      currentLayerPhase: 'locked',
      layerResults: [],
      votes: [],
      status: 'pending',
      collapsedAtLayer: null,
      currentAuditionOption: null,
      auditionLoopIndex: 0,
      currentVoteResult: null, revealStakesShown: false, songRejected: false,
    };
    const configs = [makeAttemptConfig('acceptance', 1)];
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

describe('generateFragments — bothOptionsSurvive', () => {
  test('bothOptionsSurvive: true makes losers from voted layers selectable', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 3);
    const configs = [makeAttemptConfig('ambition', 3)];
    const fragments = generateFragments([attempt], configs, '', true);

    // All 6 fragments should be selectable (3 winners + 3 losers)
    expect(fragments).toHaveLength(6);
    expect(fragments.filter(f => f.selectable)).toHaveLength(6);
  });

  test('bothOptionsSurvive: false keeps losers non-selectable (default behavior)', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 3);
    const configs = [makeAttemptConfig('ambition', 3)];
    const fragments = generateFragments([attempt], configs, '', false);

    expect(fragments).toHaveLength(6);
    expect(fragments.filter(f => f.selectable)).toHaveLength(3);
    expect(fragments.filter(f => !f.selectable)).toHaveLength(3);
  });

  test('collapsed layers produce selectable fragments when bothOptionsSurvive: true', () => {
    // Collapse at layer 2: layers 0-1 locked_in, layer 2 collapsed (voted), layers 3-5 unreached
    const attempt = makeCollapsedAttempt(0, 'ambition', 6, 2);
    // Give the collapsed layer a vote result
    attempt.layerResults[2] = {
      layerIndex: 2,
      group: 'spark',
      status: 'collapsed',
      chosenOption: 'A',
      winningProportion: 0.6,
      thresholdRequired: 0.65,
      passed: false,
    };
    const configs = [makeAttemptConfig('ambition', 6)];
    const fragments = generateFragments([attempt], configs, '', true);

    // Layers 0-1: 2 selectable each = 4
    // Layer 2 (collapsed with vote): 2 selectable (both options survive)
    // Layers 3-5: 2 non-selectable each = 6
    const selectable = fragments.filter(f => f.selectable);
    expect(selectable).toHaveLength(6); // 2+2+2 from layers 0,1,2

    const layer2Fragments = fragments.filter(f => f.fragment.layerIndex === 2);
    expect(layer2Fragments).toHaveLength(2);
    expect(layer2Fragments.every(f => f.selectable)).toBe(true);
  });

  test('unreached layers are never selectable regardless of bothOptionsSurvive', () => {
    const attempt = makeCollapsedAttempt(0, 'ambition', 4, 1);
    const configs = [makeAttemptConfig('ambition', 4)];
    const fragments = generateFragments([attempt], configs, '', true);

    // Layer 0: locked_in → 2 selectable (bothOptionsSurvive)
    // Layers 1-3: unreached → 2 non-selectable each
    const unreached = fragments.filter(f => f.fragment.layerIndex >= 1);
    expect(unreached).toHaveLength(6);
    expect(unreached.every(f => !f.selectable)).toBe(true);
  });

  test('wonVote is true for winners and false for losers', () => {
    const attempt = makeCompletedAttempt(0, 'ambition', 2);
    const configs = [makeAttemptConfig('ambition', 2)];
    const fragments = generateFragments([attempt], configs, '', true);

    // Layer 0 chose A, Layer 1 chose B
    const layer0Winner = fragments.find(f => f.fragment.layerIndex === 0 && f.fragment.option === 'A');
    const layer0Loser = fragments.find(f => f.fragment.layerIndex === 0 && f.fragment.option === 'B');
    expect(layer0Winner?.fragment.wonVote).toBe(true);
    expect(layer0Loser?.fragment.wonVote).toBe(false);

    const layer1Winner = fragments.find(f => f.fragment.layerIndex === 1 && f.fragment.option === 'B');
    const layer1Loser = fragments.find(f => f.fragment.layerIndex === 1 && f.fragment.option === 'A');
    expect(layer1Winner?.fragment.wonVote).toBe(true);
    expect(layer1Loser?.fragment.wonVote).toBe(false);
  });
});

// ============================================================================
// V3.2 Granular Fragment Generation
// ============================================================================

// Realistic V3.2 layer configs: bones(bass+drums), flesh(melody+pad+harmony), spark(fx)
function makeV32LayerConfig(index: number, group: string): V32LayerConfig {
  const trackBundles: Record<string, { a: { granularType: string; trackIndices: number[] }[]; b: { granularType: string; trackIndices: number[] }[] }> = {
    bones: {
      a: [{ granularType: 'bass', trackIndices: [index * 10 + 1] }, { granularType: 'drums', trackIndices: [index * 10 + 2] }],
      b: [{ granularType: 'bass', trackIndices: [index * 10 + 3] }, { granularType: 'drums', trackIndices: [index * 10 + 4] }],
    },
    flesh: {
      a: [{ granularType: 'pad', trackIndices: [index * 10 + 2] }, { granularType: 'harmony', trackIndices: [index * 10 + 3] }],
      b: [{ granularType: 'pad', trackIndices: [index * 10 + 5] }, { granularType: 'harmony', trackIndices: [index * 10 + 6] }],
    },
    spark: {
      a: [{ granularType: 'fx', trackIndices: [index * 10 + 1] }],
      b: [{ granularType: 'fx', trackIndices: [index * 10 + 2] }],
    },
  };
  const bundle = trackBundles[group];
  return {
    index,
    group,
    labelA: `${group} A`,
    labelB: `${group} B`,
    optionA: { tracks: bundle.a },
    optionB: { tracks: bundle.b },
  };
}

function makeV32AttemptConfig(chapter: string): V32AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: [
      makeV32LayerConfig(0, 'bones'),
      makeV32LayerConfig(1, 'flesh'),
      makeV32LayerConfig(2, 'spark'),
    ],
    thresholds: [0.50, 0.66, 0.99],
    tempos: [120, 120, 120],
    auditionBars: [4, 4, 2],
    auditionCycles: [2, 2, 2],
  };
}

function makeV32CompletedAttempt(index: number, chapter: string): AttemptState {
  const config = makeV32AttemptConfig(chapter);
  return {
    index,
    chapter,
    layerPlan: config.layers,
    currentLayerIndex: 2,
    currentLayerPhase: 'locked_in',
    layerResults: config.layers.map((l, i) => ({
      layerIndex: i,
      group: l.group,
      status: 'locked_in' as const,
      chosenOption: i % 2 === 0 ? 'A' as const : 'B' as const,
      winningProportion: 0.8,
      thresholdRequired: config.thresholds[i],
      passed: true,
    })),
    votes: [],
    status: 'completed',
    collapsedAtLayer: null,
    currentAuditionOption: null,
    auditionLoopIndex: 0,
    currentVoteResult: null, revealStakesShown: false, songRejected: false,
  };
}

function makeV32CollapsedAttempt(index: number, chapter: string, collapseAt: number): AttemptState {
  const config = makeV32AttemptConfig(chapter);
  return {
    index,
    chapter,
    layerPlan: config.layers,
    currentLayerIndex: collapseAt,
    currentLayerPhase: 'collapsed',
    layerResults: [
      ...Array.from({ length: collapseAt }, (_, i) => ({
        layerIndex: i,
        group: config.layers[i].group,
        status: 'locked_in' as const,
        chosenOption: 'A' as const,
        winningProportion: 0.8,
        thresholdRequired: config.thresholds[i],
        passed: true,
      })),
      // Collapsed layer has a vote but failed threshold
      {
        layerIndex: collapseAt,
        group: config.layers[collapseAt].group,
        status: 'collapsed' as const,
        chosenOption: 'A' as const,
        winningProportion: 0.55,
        thresholdRequired: config.thresholds[collapseAt],
        passed: false,
      },
      ...Array.from({ length: config.layers.length - collapseAt - 1 }, (_, i) => ({
        layerIndex: collapseAt + 1 + i,
        group: config.layers[collapseAt + 1 + i].group,
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
    currentVoteResult: null, revealStakesShown: false, songRejected: false,
  };
}

describe('generateGranularFragments', () => {
  test('voted layer with bothOptionsSurvive=false produces 1 GranularFragment per granular type (winner only)', () => {
    const attempt = makeV32CompletedAttempt(0, 'ambition');
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', false);

    // Layer 0 (bones, chose A): 2 tracks (bass, drums) = 2 fragments
    // Layer 1 (flesh, chose B): 2 tracks (pad, harmony) = 2 fragments
    // Layer 2 (spark, chose A): 1 track (fx) = 1 fragment
    // + 1 seed fragment from liveSeed
    // Total: 6 fragments
    expect(fragments).toHaveLength(6);

    const seedFragments = fragments.filter(f => f.granularType === 'seed');
    expect(seedFragments).toHaveLength(1);
    expect(seedFragments[0].wonVote).toBe(true);
    expect(seedFragments[0].id).toBe('0-seed-seed-A');
  });

  test('voted layer with bothOptionsSurvive=true produces 2 GranularFragments per granular type', () => {
    const attempt = makeV32CompletedAttempt(0, 'ambition');
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', true);

    // Each layer type gets winner + loser: bones(4) + flesh(4) + spark(2) = 10
    // + 1 seed fragment (no A/B, always 1)
    // Total: 11
    expect(fragments).toHaveLength(11);

    const winners = fragments.filter(f => f.wonVote);
    const losers = fragments.filter(f => !f.wonVote);
    expect(winners).toHaveLength(6); // 5 layer winners + 1 seed
    expect(losers).toHaveLength(5);
  });

  test('collapsed layer still produces winners fragments', () => {
    // Collapse at layer 1 (flesh): layers 0 locked_in, layer 1 collapsed (voted), layer 2 unreached
    const attempt = makeV32CollapsedAttempt(0, 'ambition', 1);
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', false);

    // Layer 0 (bones, locked_in, chose A): 2 winner fragments
    // Layer 1 (flesh, collapsed, chose A): 2 winner fragments
    // Layer 2 (spark, unreached): 0 fragments
    // + 1 seed fragment
    expect(fragments).toHaveLength(5);

    const fleshFragments = fragments.filter(f => f.layerGroupId === 'flesh');
    expect(fleshFragments).toHaveLength(2);
    expect(fleshFragments.every(f => f.wonVote)).toBe(true);
  });

  test('unreached layer produces no fragments', () => {
    const attempt = makeV32CollapsedAttempt(0, 'ambition', 1);
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', true);

    // Layer 2 (spark) is unreached — no fragments regardless of bothOptionsSurvive
    const sparkFragments = fragments.filter(f => f.layerGroupId === 'spark');
    expect(sparkFragments).toHaveLength(0);
  });

  test('fragment count across full show with bothOptionsSurvive=true', () => {
    const attempt0 = makeV32CompletedAttempt(0, 'ambition');
    const attempt1 = makeV32CompletedAttempt(1, 'love');
    const attempt2 = makeV32CompletedAttempt(2, 'acceptance');
    const configs = [
      makeV32AttemptConfig('ambition'),
      makeV32AttemptConfig('love'),
      makeV32AttemptConfig('acceptance'),
    ];
    const fragments = generateGranularFragments([attempt0, attempt1, attempt2], configs, '/audio', true);

    // Per song: bones(2) + flesh(2) + spark(1) = 5 types × 2 options = 10, + 1 seed = 11
    // 3 songs × 11 = 33
    expect(fragments).toHaveLength(33);
  });

  test('fragment count across full show with bothOptionsSurvive=false', () => {
    const attempt0 = makeV32CompletedAttempt(0, 'ambition');
    const attempt1 = makeV32CompletedAttempt(1, 'love');
    const attempt2 = makeV32CompletedAttempt(2, 'acceptance');
    const configs = [
      makeV32AttemptConfig('ambition'),
      makeV32AttemptConfig('love'),
      makeV32AttemptConfig('acceptance'),
    ];
    const fragments = generateGranularFragments([attempt0, attempt1, attempt2], configs, '/audio', false);

    // Per song: bones(2) + flesh(2) + spark(1) = 5 winners + 1 seed = 6
    // 3 songs × 6 = 18
    expect(fragments).toHaveLength(18);
  });

  test('fragment IDs are unique and follow songIndex-group-type-option format', () => {
    const attempt = makeV32CompletedAttempt(0, 'ambition');
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', true);

    const ids = fragments.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Spot-check format
    expect(ids).toContain('0-bones-bass-A');
    expect(ids).toContain('0-bones-drums-A');
    expect(ids).toContain('0-flesh-pad-B');
    expect(ids).toContain('0-spark-fx-A');
    expect(ids).toContain('0-seed-seed-A');
  });

  test('previewAudioPath follows naming convention', () => {
    const attempt = makeV32CompletedAttempt(0, 'ambition');
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([attempt], configs, '/audio/previews', true);

    const bassA = fragments.find(f => f.granularType === 'bass' && f.option === 'A');
    expect(bassA?.previewAudioPath).toBe('/audio/previews/preview-0-bass-A.mp3');

    const seedA = fragments.find(f => f.granularType === 'seed' && f.option === 'A');
    expect(seedA?.previewAudioPath).toBe('/audio/previews/preview-0-seed-A.mp3');
  });

  test('skips pending attempts', () => {
    const pending: AttemptState = {
      index: 0,
      chapter: 'ambition',
      layerPlan: makeV32AttemptConfig('ambition').layers,
      currentLayerIndex: 0,
      currentLayerPhase: 'locked',
      layerResults: [],
      votes: [],
      status: 'pending',
      collapsedAtLayer: null,
      currentAuditionOption: null,
      auditionLoopIndex: 0,
      currentVoteResult: null, revealStakesShown: false, songRejected: false,
    };
    const configs = [makeV32AttemptConfig('ambition')];
    const fragments = generateGranularFragments([pending], configs, '/audio', true);
    expect(fragments).toHaveLength(0);
  });

  test('chapter is correctly assigned from the attempt', () => {
    const attempt = makeV32CompletedAttempt(1, 'love');
    const configs = [undefined as any, makeV32AttemptConfig('love')];
    const fragments = generateGranularFragments([attempt], configs, '/audio', false);

    expect(fragments.every(f => f.chapter === 'love')).toBe(true);
    expect(fragments.every(f => f.songIndex === 1)).toBe(true);
  });
});

describe('generateGranularFragments — alwaysAvailable', () => {
  test('alwaysAvailable track on losing option produces fragment even when bothOptionsSurvive=false', () => {
    const config = makeV32AttemptConfig('ambition');
    // Mark the bass track on option B as alwaysAvailable
    config.layers[0].optionB.tracks[0] = { granularType: 'bass', trackIndices: [3], alwaysAvailable: true };

    const attempt = makeV32CompletedAttempt(0, 'ambition');
    // Layer 0 (bones) chose A — so B is the loser
    const fragments = generateGranularFragments([attempt], [config], '/audio', false);

    // Winners: bones A(bass, drums) + flesh B(pad, harmony) + spark A(fx) = 5 + 1 seed = 6
    // Plus: bones B bass (alwaysAvailable) = 1
    // But drums on B is NOT alwaysAvailable, so excluded
    expect(fragments).toHaveLength(7);

    const loserBass = fragments.find(f => f.layerGroupId === 'bones' && f.granularType === 'bass' && f.option === 'B');
    expect(loserBass).toBeDefined();
    expect(loserBass!.wonVote).toBe(false);

    // Loser drums should not be present
    const loserDrums = fragments.find(f => f.layerGroupId === 'bones' && f.granularType === 'drums' && f.option === 'B');
    expect(loserDrums).toBeUndefined();
  });

  test('alwaysAvailable track on unreached layer produces fragment', () => {
    const config = makeV32AttemptConfig('ambition');
    // Mark fx track on option A of spark (layer 2) as alwaysAvailable
    config.layers[2].optionA.tracks[0] = { granularType: 'fx', trackIndices: [21], alwaysAvailable: true };

    // Collapse at layer 1, so layer 2 (spark) is unreached
    const attempt = makeV32CollapsedAttempt(0, 'ambition', 1);
    const fragments = generateGranularFragments([attempt], [config], '/audio', false);

    // Layer 0 (bones, locked_in): 2 winners
    // Layer 1 (flesh, collapsed): 2 winners
    // Layer 2 (spark, unreached): 1 alwaysAvailable fragment from option A
    // + 1 seed fragment
    expect(fragments).toHaveLength(6);

    const sparkFragment = fragments.find(f => f.layerGroupId === 'spark');
    expect(sparkFragment).toBeDefined();
    expect(sparkFragment!.wonVote).toBe(false);
    expect(sparkFragment!.option).toBe('A');
    expect(sparkFragment!.trackIndices).toEqual([21]);
  });

  test('alwaysAvailable tracks on both options of unreached layer produce two fragments', () => {
    const config = makeV32AttemptConfig('ambition');
    config.layers[2].optionA.tracks[0] = { granularType: 'fx', trackIndices: [21], alwaysAvailable: true };
    config.layers[2].optionB.tracks[0] = { granularType: 'fx', trackIndices: [22], alwaysAvailable: true };

    const attempt = makeV32CollapsedAttempt(0, 'ambition', 1);
    const fragments = generateGranularFragments([attempt], [config], '/audio', false);

    const sparkFragments = fragments.filter(f => f.layerGroupId === 'spark');
    expect(sparkFragments).toHaveLength(2);
    expect(sparkFragments.find(f => f.option === 'A')).toBeDefined();
    expect(sparkFragments.find(f => f.option === 'B')).toBeDefined();
    expect(sparkFragments.every(f => f.wonVote === false)).toBe(true);
  });

  test('alwaysAvailable does not duplicate winner fragments that would already be included', () => {
    const config = makeV32AttemptConfig('ambition');
    // Mark the bass track on option A as alwaysAvailable — but it's already the winner
    config.layers[0].optionA.tracks[0] = { granularType: 'bass', trackIndices: [1], alwaysAvailable: true };

    const attempt = makeV32CompletedAttempt(0, 'ambition');
    // Layer 0 chose A — bass A is already a winner
    const fragments = generateGranularFragments([attempt], [config], '/audio', false);

    // Should still be 6 (no duplicate for bass A)
    expect(fragments).toHaveLength(6);
    const bassA = fragments.filter(f => f.layerGroupId === 'bones' && f.granularType === 'bass' && f.option === 'A');
    expect(bassA).toHaveLength(1);
  });
});

/**
 * Audience Remix Engine Tests (V3.4 — Swarm Orbs)
 *
 * Pure conductor logic tests. No I/O, no mocks.
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import {
  createUserOrbs,
  placeOrb,
  recallOrb,
  processDecay,
  scatterNode,
  lockNode,
  unlockNode,
  setDecayRate,
  setCrossfadeMode,
  getEffectiveChapter,
  recomputeTallies,
} from '../audience-remix';
import type { FinaleState, NodeVoteTally } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeFinaleState(overrides?: Partial<FinaleState>): FinaleState {
  return {
    phase: 'remix',
    vote: {
      questionsAnsweredByUser: new Map(),
    },
    pool: {
      tokens: [],
      availableByChapter: new Map(),
      totalByChapter: new Map(),
      totalRemaining: 0,
      targetPoolSize: 120,
    },
    queue: new Map(),
    active: new Map(),
    audienceInteraction: true,
    chapterSongIndex: new Map([['ambition', 0], ['love', 1], ['acceptance', 2]]),
    trackMap: new Map(),
    loopCount: 0,
    loopProgress: 0,
    npc: { currentMessage: null },
    audienceOrbs: new Map(),
    nodeTallies: new Map(),
    orbDecayLoops: 3,
    instantCrossfade: false,
    fallbackMode: false,
    ...overrides,
  };
}

function stateWithUser(state: FinaleState, userId: string, chapters: string[]): FinaleState {
  const userOrbs = createUserOrbs(userId, chapters);
  const updatedOrbs = new Map(state.audienceOrbs);
  updatedOrbs.set(userId, userOrbs);
  return { ...state, audienceOrbs: updatedOrbs };
}

// ============================================================================
// createUserOrbs
// ============================================================================

describe('audience-remix: createUserOrbs', () => {
  test('creates orbs from chapter ids, all in hand', () => {
    const result = createUserOrbs('user-1', ['ambition', 'love', 'acceptance', 'ambition', 'love', 'acceptance']);
    expect(result.userId).toBe('user-1');
    expect(result.orbs).toHaveLength(6);
    expect(result.orbs[0]).toEqual({ index: 0, chapterId: 'ambition', placedOnNode: null, placedAtLoop: 0 });
    expect(result.orbs[3]).toEqual({ index: 3, chapterId: 'ambition', placedOnNode: null, placedAtLoop: 0 });
  });

  test('preserves chapter order from answers', () => {
    const result = createUserOrbs('user-1', ['love', 'ambition', 'acceptance']);
    expect(result.orbs[0].chapterId).toBe('love');
    expect(result.orbs[1].chapterId).toBe('ambition');
    expect(result.orbs[2].chapterId).toBe('acceptance');
  });
});

// ============================================================================
// placeOrb
// ============================================================================

describe('audience-remix: placeOrb', () => {
  test('places an orb on a node and updates tally', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition', 'love']);

    const result = placeOrb(state, 'user-1', 0, 'bass');

    const orb = result.state.audienceOrbs.get('user-1')!.orbs[0];
    expect(orb.placedOnNode).toBe('bass');
    expect(orb.placedAtLoop).toBe(0);

    const tally = result.state.nodeTallies.get('bass')!;
    expect(tally.votes.get('ambition')).toBe(1);
    expect(tally.dominantChapter).toBe('ambition');

    expect(result.events.some(e => e.type === 'ORB_PLACED')).toBe(true);
  });

  test('moving an orb between nodes updates both tallies', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);

    // Place on bass
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    expect(state.nodeTallies.get('bass')!.votes.get('ambition')).toBe(1);

    // Move to drums
    const result = placeOrb(state, 'user-1', 0, 'drums');
    expect(result.state.nodeTallies.get('bass')!.votes.has('ambition')).toBe(false);
    expect(result.state.nodeTallies.get('drums')!.votes.get('ambition')).toBe(1);
  });

  test('placing orb on the same node it is already on is a no-op for tally', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    const result = placeOrb(state, 'user-1', 0, 'bass');
    expect(result.state.nodeTallies.get('bass')!.votes.get('ambition')).toBe(1);
  });

  test('free stacking: multiple orbs from same user on same node', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition', 'ambition', 'love']);

    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-1', 1, 'bass').state;
    state = placeOrb(state, 'user-1', 2, 'bass').state;

    const tally = state.nodeTallies.get('bass')!;
    expect(tally.votes.get('ambition')).toBe(2);
    expect(tally.votes.get('love')).toBe(1);
    expect(tally.dominantChapter).toBe('ambition');
  });

  test('returns unchanged state for unknown user', () => {
    const state = makeFinaleState();
    const result = placeOrb(state, 'nonexistent', 0, 'bass');
    expect(result.events).toHaveLength(0);
  });

  test('returns unchanged state for invalid orb index', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    const result = placeOrb(state, 'user-1', 99, 'bass');
    expect(result.events).toHaveLength(0);
  });
});

// ============================================================================
// recallOrb
// ============================================================================

describe('audience-remix: recallOrb', () => {
  test('recalls a placed orb and decrements tally', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    const result = recallOrb(state, 'user-1', 0);
    const orb = result.state.audienceOrbs.get('user-1')!.orbs[0];
    expect(orb.placedOnNode).toBeNull();
    expect(result.state.nodeTallies.get('bass')!.votes.has('ambition')).toBe(false);
    expect(result.events.some(e => e.type === 'ORB_RECALLED')).toBe(true);
  });

  test('recalling an orb already in hand is a no-op', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    const result = recallOrb(state, 'user-1', 0);
    expect(result.events).toHaveLength(0);
  });
});

// ============================================================================
// Dominant chapter calculation
// ============================================================================

describe('audience-remix: dominant chapter', () => {
  test('majority wins', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = stateWithUser(state, 'user-2', ['ambition']);
    state = stateWithUser(state, 'user-3', ['love']);

    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-2', 0, 'bass').state;
    state = placeOrb(state, 'user-3', 0, 'bass').state;

    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('ambition');
  });

  test('tie preserves incumbent', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = stateWithUser(state, 'user-2', ['love']);

    // Ambition placed first — becomes incumbent
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('ambition');

    // Love ties — incumbent (ambition) stays
    state = placeOrb(state, 'user-2', 0, 'bass').state;
    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('ambition');
  });

  test('removing the leader causes a new dominant', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = stateWithUser(state, 'user-2', ['love']);
    state = stateWithUser(state, 'user-3', ['love']);

    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-2', 0, 'bass').state;
    state = placeOrb(state, 'user-3', 0, 'bass').state;

    // love: 2, ambition: 1 → love dominant
    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('love');

    // recall one love → ambition: 1, love: 1 → tie, incumbent (love) stays
    state = recallOrb(state, 'user-2', 0).state;
    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('love');

    // recall second love → ambition: 1 → ambition dominant
    state = recallOrb(state, 'user-3', 0).state;
    expect(state.nodeTallies.get('bass')!.dominantChapter).toBe('ambition');
  });

  test('all orbs removed from node results in null dominant', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = recallOrb(state, 'user-1', 0).state;

    expect(state.nodeTallies.get('bass')!.dominantChapter).toBeNull();
  });
});

// ============================================================================
// processDecay
// ============================================================================

describe('audience-remix: processDecay', () => {
  test('decays orbs that have been placed for orbDecayLoops', () => {
    let state = makeFinaleState({ loopCount: 0, orbDecayLoops: 3 });
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    // Advance to loop 3 — orb was placed at loop 0, decay threshold is 3
    state = { ...state, loopCount: 3 };
    const result = processDecay(state);

    const orb = result.state.audienceOrbs.get('user-1')!.orbs[0];
    expect(orb.placedOnNode).toBeNull();
    expect(result.events.some(e => e.type === 'ORB_DECAYED')).toBe(true);
  });

  test('does not decay orbs before threshold', () => {
    let state = makeFinaleState({ loopCount: 0, orbDecayLoops: 3 });
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    state = { ...state, loopCount: 2 };
    const result = processDecay(state);

    const orb = result.state.audienceOrbs.get('user-1')!.orbs[0];
    expect(orb.placedOnNode).toBe('bass');
    expect(result.events.filter(e => e.type === 'ORB_DECAYED')).toHaveLength(0);
  });

  test('does nothing when orbDecayLoops is 0 (disabled)', () => {
    let state = makeFinaleState({ loopCount: 100, orbDecayLoops: 0 });
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    const result = processDecay(state);
    expect(result.state.audienceOrbs.get('user-1')!.orbs[0].placedOnNode).toBe('bass');
  });

  test('decays orbs from multiple users on same node', () => {
    let state = makeFinaleState({ loopCount: 0, orbDecayLoops: 2 });
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = stateWithUser(state, 'user-2', ['love']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-2', 0, 'bass').state;

    state = { ...state, loopCount: 2 };
    const result = processDecay(state);

    expect(result.state.audienceOrbs.get('user-1')!.orbs[0].placedOnNode).toBeNull();
    expect(result.state.audienceOrbs.get('user-2')!.orbs[0].placedOnNode).toBeNull();
    expect(result.state.nodeTallies.get('bass')!.dominantChapter).toBeNull();
  });
});

// ============================================================================
// scatterNode
// ============================================================================

describe('audience-remix: scatterNode', () => {
  test('scatters all orbs from a specific node', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition', 'love']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-1', 1, 'drums').state;

    const result = scatterNode(state, 'bass');

    expect(result.state.audienceOrbs.get('user-1')!.orbs[0].placedOnNode).toBeNull();
    expect(result.state.audienceOrbs.get('user-1')!.orbs[1].placedOnNode).toBe('drums'); // Untouched
    expect(result.events.some(e => e.type === 'NODES_SCATTERED')).toBe(true);
  });

  test('scatters all orbs from all nodes when granularType is null', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition', 'love']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-1', 1, 'drums').state;

    const result = scatterNode(state, null);

    expect(result.state.audienceOrbs.get('user-1')!.orbs[0].placedOnNode).toBeNull();
    expect(result.state.audienceOrbs.get('user-1')!.orbs[1].placedOnNode).toBeNull();
  });
});

// ============================================================================
// lockNode / unlockNode
// ============================================================================

describe('audience-remix: lockNode / unlockNode', () => {
  test('lock overrides tally', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;

    const lockResult = lockNode(state, 'bass', 'love');
    const tally = lockResult.state.nodeTallies.get('bass')!;
    expect(tally.locked).toBe(true);
    expect(tally.lockedChapter).toBe('love');
    expect(getEffectiveChapter(tally)).toBe('love'); // Ignores tally dominant
  });

  test('unlock restores tally-based dominant', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition']);
    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = lockNode(state, 'bass', 'love').state;

    const unlockResult = unlockNode(state, 'bass');
    const tally = unlockResult.state.nodeTallies.get('bass')!;
    expect(tally.locked).toBe(false);
    expect(getEffectiveChapter(tally)).toBe('ambition');
  });
});

// ============================================================================
// setDecayRate / setCrossfadeMode
// ============================================================================

describe('audience-remix: config changes', () => {
  test('setDecayRate updates state and emits event', () => {
    const state = makeFinaleState({ orbDecayLoops: 3 });
    const result = setDecayRate(state, 0);
    expect(result.state.orbDecayLoops).toBe(0);
    expect(result.events[0]).toEqual({ type: 'DECAY_RATE_CHANGED', loops: 0 });
  });

  test('setCrossfadeMode updates state and emits event', () => {
    const state = makeFinaleState({ instantCrossfade: false });
    const result = setCrossfadeMode(state, true);
    expect(result.state.instantCrossfade).toBe(true);
    expect(result.events[0]).toEqual({ type: 'CROSSFADE_MODE_CHANGED', instant: true });
  });
});

// ============================================================================
// recomputeTallies
// ============================================================================

describe('audience-remix: recomputeTallies', () => {
  test('recomputes from scratch matching incremental tallies', () => {
    let state = makeFinaleState();
    state = stateWithUser(state, 'user-1', ['ambition', 'love']);
    state = stateWithUser(state, 'user-2', ['ambition', 'acceptance']);

    state = placeOrb(state, 'user-1', 0, 'bass').state;
    state = placeOrb(state, 'user-1', 1, 'bass').state;
    state = placeOrb(state, 'user-2', 0, 'drums').state;
    state = placeOrb(state, 'user-2', 1, 'bass').state;

    const recomputed = recomputeTallies(state, ['bass', 'drums', 'pad']);

    const bassTally = recomputed.get('bass')!;
    expect(bassTally.votes.get('ambition')).toBe(1);
    expect(bassTally.votes.get('love')).toBe(1);
    expect(bassTally.votes.get('acceptance')).toBe(1);

    const drumsTally = recomputed.get('drums')!;
    expect(drumsTally.votes.get('ambition')).toBe(1);

    const padTally = recomputed.get('pad')!;
    expect(padTally.votes.size).toBe(0);
    expect(padTally.dominantChapter).toBeNull();
  });

  test('preserves lock state when recomputing', () => {
    let state = makeFinaleState();
    state = lockNode(state, 'bass', 'love').state;

    const recomputed = recomputeTallies(state, ['bass']);
    expect(recomputed.get('bass')!.locked).toBe(true);
    expect(recomputed.get('bass')!.lockedChapter).toBe('love');
  });
});

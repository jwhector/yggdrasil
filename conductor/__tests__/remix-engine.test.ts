/**
 * Remix Engine Tests (V3.4)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import {
  queueToken,
  cancelQueue,
  advanceNode,
  processLoopBoundary,
  toggleAudienceInteraction,
  resolveTrack,
} from '../remix-engine';
import type { FinaleState, Token, ConductorEvent } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeTokens(counts: Record<string, number>): Token[] {
  const tokens: Token[] = [];
  for (const [chapterId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      tokens.push({
        id: `token-${chapterId}-${i}`,
        ownerId: `user-${tokens.length}`,
        chapterId,
        questionIndex: i,
        status: 'available',
      });
    }
  }
  return tokens;
}

function makeTrackMap(): Map<string, Map<number, number[]>> {
  const map = new Map<string, Map<number, number[]>>();
  const types = ['bass', 'drums', 'pad', 'seed', 'harmony', 'fx'];
  for (const type of types) {
    const inner = new Map<number, number[]>();
    inner.set(0, [types.indexOf(type) * 3 + 1]);
    inner.set(1, [types.indexOf(type) * 3 + 2]);
    inner.set(2, [types.indexOf(type) * 3 + 3]);
    map.set(type, inner);
  }
  return map;
}

function makeRemixState(overrides?: Partial<FinaleState>): FinaleState {
  const tokens = makeTokens({ chapter_0: 5, chapter_1: 5, chapter_2: 5 });
  return {
    phase: 'remix',
    vote: {
      questionsAnsweredByUser: new Map(),
    },
    pool: {
      tokens,
      availableByChapter: new Map([['chapter_0', 5], ['chapter_1', 5], ['chapter_2', 5]]),
      totalByChapter: new Map([['chapter_0', 5], ['chapter_1', 5], ['chapter_2', 5]]),
      totalRemaining: 15,
      targetPoolSize: 15,
    },
    queue: new Map(),
    active: new Map(),
    audienceInteraction: false,
    chapterSongIndex: new Map([['chapter_0', 0], ['chapter_1', 1], ['chapter_2', 2]]),
    trackMap: makeTrackMap(),
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

function findEvent(events: ConductorEvent[], type: string): ConductorEvent | undefined {
  return events.find(e => e.type === type);
}

function findEvents(events: ConductorEvent[], type: string): ConductorEvent[] {
  return events.filter(e => e.type === type);
}

// ============================================================================
// queueToken
// ============================================================================

describe('remix-engine: queueToken', () => {
  test('queuing a token consumes from pool and adds to queue', () => {
    const state = makeRemixState();
    const result = queueToken(state, 'bass', 'chapter_0');

    expect(result.state.pool.availableByChapter.get('chapter_0')).toBe(4);
    expect(result.state.queue.get('bass')).toHaveLength(1);
    expect(result.state.queue.get('bass')![0].chapterId).toBe('chapter_0');
    // Should NOT be active — always queued, even on silent nodes
    expect(result.state.active.has('bass')).toBe(false);

    const queuedEvent = findEvent(result.events, 'TOKEN_QUEUED');
    expect(queuedEvent).toBeDefined();
    expect((queuedEvent as any).granularType).toBe('bass');
    expect((queuedEvent as any).queueDepth).toBe(1);
  });

  test('queuing when chapter pool is empty returns error', () => {
    const state = makeRemixState({
      pool: {
        tokens: makeTokens({ chapter_0: 0, chapter_1: 5 }),
        availableByChapter: new Map([['chapter_0', 0], ['chapter_1', 5]]),
        totalByChapter: new Map([['chapter_0', 0], ['chapter_1', 5]]),
        totalRemaining: 5,
        targetPoolSize: 5,
      },
    });

    const result = queueToken(state, 'bass', 'chapter_0');
    const errorEvent = findEvent(result.events, 'ERROR');
    expect(errorEvent).toBeDefined();
  });

  test('stacking multiple tokens on same node creates queue depth', () => {
    const state = makeRemixState();
    const r1 = queueToken(state, 'bass', 'chapter_0');
    const r2 = queueToken(r1.state, 'bass', 'chapter_1');
    const r3 = queueToken(r2.state, 'bass', 'chapter_2');

    expect(r3.state.queue.get('bass')).toHaveLength(3);
    const lastQueued = findEvent(r3.events, 'TOKEN_QUEUED');
    expect((lastQueued as any).queueDepth).toBe(3);
  });
});

// ============================================================================
// cancelQueue
// ============================================================================

describe('remix-engine: cancelQueue', () => {
  test('cancelling queue returns token to pool', () => {
    const state = makeRemixState();
    const queued = queueToken(state, 'bass', 'chapter_0');
    expect(queued.state.pool.availableByChapter.get('chapter_0')).toBe(4);

    const cancelled = cancelQueue(queued.state, 'bass');
    expect(cancelled.state.pool.availableByChapter.get('chapter_0')).toBe(5);
    expect(cancelled.state.queue.get('bass')).toHaveLength(0);

    const cancelEvent = findEvent(cancelled.events, 'TOKEN_CANCELLED');
    expect(cancelEvent).toBeDefined();
    expect((cancelEvent as any).returnedToPool).toBe(true);
  });

  test('cancelling empty queue is a no-op', () => {
    const state = makeRemixState();
    const result = cancelQueue(state, 'bass');
    expect(result.events).toHaveLength(0);
    expect(result.state).toBe(state);
  });

  test('cancelling removes the last queued token (LIFO)', () => {
    const state = makeRemixState();
    const r1 = queueToken(state, 'bass', 'chapter_0');
    const r2 = queueToken(r1.state, 'bass', 'chapter_1');

    const cancelled = cancelQueue(r2.state, 'bass');
    expect(cancelled.state.queue.get('bass')).toHaveLength(1);
    expect(cancelled.state.queue.get('bass')![0].chapterId).toBe('chapter_0');
    // chapter_1 should be returned to pool
    expect(cancelled.state.pool.availableByChapter.get('chapter_1')).toBe(5);
  });
});

// ============================================================================
// processLoopBoundary
// ============================================================================

describe('remix-engine: processLoopBoundary', () => {
  test('loop boundary activates queued tokens and emits TOKEN_ACTIVATED', () => {
    const state = makeRemixState();
    const queued = queueToken(state, 'bass', 'chapter_0');

    const result = processLoopBoundary(queued.state);

    expect(result.state.active.has('bass')).toBe(true);
    expect(result.state.active.get('bass')!.chapterId).toBe('chapter_0');
    expect(result.state.queue.get('bass') ?? []).toHaveLength(0);

    const activated = findEvent(result.events, 'TOKEN_ACTIVATED');
    expect(activated).toBeDefined();
    expect((activated as any).granularType).toBe('bass');
  });

  test('loop boundary spends active tokens and emits TOKEN_SPENT', () => {
    const state = makeRemixState();
    const queued = queueToken(state, 'bass', 'chapter_0');
    const boundary1 = processLoopBoundary(queued.state);

    // Now bass is active with no replacement queued
    const boundary2 = processLoopBoundary(boundary1.state);

    expect(boundary2.state.active.has('bass')).toBe(false);
    const spent = findEvent(boundary2.events, 'TOKEN_SPENT');
    expect(spent).toBeDefined();
    const silent = findEvent(boundary2.events, 'NODE_SILENT');
    expect(silent).toBeDefined();
    expect((silent as any).granularType).toBe('bass');
  });

  test('active token with queued replacement triggers crossfade', () => {
    const state = makeRemixState();

    // Queue and activate chapter_0 on bass
    const q1 = queueToken(state, 'bass', 'chapter_0');
    const b1 = processLoopBoundary(q1.state);
    expect(b1.state.active.get('bass')!.chapterId).toBe('chapter_0');

    // Queue chapter_1 replacement
    const q2 = queueToken(b1.state, 'bass', 'chapter_1');

    // Process boundary — should crossfade
    const b2 = processLoopBoundary(q2.state);
    expect(b2.state.active.get('bass')!.chapterId).toBe('chapter_1');

    const spentEvent = findEvent(b2.events, 'TOKEN_SPENT');
    expect(spentEvent).toBeDefined();

    const activatedEvent = findEvent(b2.events, 'TOKEN_ACTIVATED');
    expect(activatedEvent).toBeDefined();
    expect((activatedEvent as any).chapterId).toBe('chapter_1');

    const crossfadeCue = b2.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_crossfade',
    );
    expect(crossfadeCue).toBeDefined();
  });

  test('active token with no replacement triggers fade-out and NODE_SILENT', () => {
    const state = makeRemixState();
    const q = queueToken(state, 'drums', 'chapter_1');
    const b1 = processLoopBoundary(q.state);

    // No replacement queued
    const b2 = processLoopBoundary(b1.state);

    const fadeOut = b2.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_fade_out',
    );
    expect(fadeOut).toBeDefined();
    expect((fadeOut as any).cue.granularType).toBe('drums');

    expect(findEvent(b2.events, 'NODE_SILENT')).toBeDefined();
  });

  test('pool empty after last token spent emits POOL_EMPTY', () => {
    const singleToken: Token = {
      id: 'token-only',
      ownerId: 'user-1',
      chapterId: 'chapter_0',
      questionIndex: 0,
      status: 'available',
    };
    const state = makeRemixState({
      pool: {
        tokens: [singleToken],
        availableByChapter: new Map([['chapter_0', 1]]),
        totalByChapter: new Map([['chapter_0', 1]]),
        totalRemaining: 1,
        targetPoolSize: 1,
      },
    });

    const queued = queueToken(state, 'bass', 'chapter_0');
    // Activate it
    const b1 = processLoopBoundary(queued.state);
    expect(b1.state.active.has('bass')).toBe(true);

    // Spend it (no replacement)
    const b2 = processLoopBoundary(b1.state);
    expect(findEvent(b2.events, 'POOL_EMPTY')).toBeDefined();
  });

  test('increments loopCount on each boundary', () => {
    const state = makeRemixState();
    const b1 = processLoopBoundary(state);
    expect(b1.state.loopCount).toBe(1);

    const b2 = processLoopBoundary(b1.state);
    expect(b2.state.loopCount).toBe(2);
  });
});

// ============================================================================
// Audience Interaction Mode
// ============================================================================

describe('remix-engine: audience interaction mode', () => {
  test('audience interaction mode: token activates immediately (no loop boundary wait)', () => {
    const state = makeRemixState({ audienceInteraction: true });

    const result = queueToken(state, 'bass', 'chapter_0', true);

    // Should be active immediately (not queued)
    expect(result.state.active.has('bass')).toBe(true);
    expect(result.state.active.get('bass')!.chapterId).toBe('chapter_0');
    expect(result.state.active.get('bass')!.persistent).toBe(true);
    expect(result.state.queue.get('bass') ?? []).toHaveLength(0);

    const activated = findEvent(result.events, 'TOKEN_ACTIVATED');
    expect(activated).toBeDefined();
  });

  test('audience interaction mode: active token loops indefinitely until overridden', () => {
    const state = makeRemixState({ audienceInteraction: true });

    // Activate a token
    const q = queueToken(state, 'bass', 'chapter_0', true);

    // Process loop boundary — persistent token should survive
    const b1 = processLoopBoundary(q.state);
    expect(b1.state.active.has('bass')).toBe(true);
    expect(b1.state.active.get('bass')!.tokenId).toBe(q.state.active.get('bass')!.tokenId);

    // And again
    const b2 = processLoopBoundary(b1.state);
    expect(b2.state.active.has('bass')).toBe(true);

    // No TOKEN_SPENT should have been emitted
    expect(findEvent(b1.events, 'TOKEN_SPENT')).toBeUndefined();
    expect(findEvent(b2.events, 'TOKEN_SPENT')).toBeUndefined();
  });

  test('audience interaction mode: new token on occupied node spends old token', () => {
    const state = makeRemixState({ audienceInteraction: true });

    // Activate chapter_0 on bass
    const q1 = queueToken(state, 'bass', 'chapter_0', true);
    const oldTokenId = q1.state.active.get('bass')!.tokenId;

    // Activate chapter_1 on bass — should replace
    const q2 = queueToken(q1.state, 'bass', 'chapter_1', true);
    expect(q2.state.active.get('bass')!.chapterId).toBe('chapter_1');

    const spent = findEvent(q2.events, 'TOKEN_SPENT');
    expect(spent).toBeDefined();
    expect((spent as any).tokenId).toBe(oldTokenId);

    // Should emit instant crossfade audio cue
    const crossfade = q2.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_instant_crossfade',
    );
    expect(crossfade).toBeDefined();
  });

  test('disabling audience interaction mode: persistent tokens finish current loop', () => {
    const state = makeRemixState({ audienceInteraction: true });

    // Activate persistent token
    const q = queueToken(state, 'bass', 'chapter_0', true);
    expect(q.state.active.get('bass')!.persistent).toBe(true);

    // Disable audience interaction
    const toggled = toggleAudienceInteraction(q.state);
    expect(toggled.state.audienceInteraction).toBe(false);
    expect(toggled.state.active.get('bass')!.persistent).toBe(false);

    // Next loop boundary should spend the now-non-persistent token
    const b = processLoopBoundary(toggled.state);
    expect(b.state.active.has('bass')).toBe(false);
    expect(findEvent(b.events, 'TOKEN_SPENT')).toBeDefined();
  });
});

// ============================================================================
// toggleAudienceInteraction
// ============================================================================

describe('remix-engine: toggleAudienceInteraction', () => {
  test('toggles mode on', () => {
    const state = makeRemixState({ audienceInteraction: false });
    const result = toggleAudienceInteraction(state);
    expect(result.state.audienceInteraction).toBe(true);
  });

  test('toggles mode off', () => {
    const state = makeRemixState({ audienceInteraction: true });
    const result = toggleAudienceInteraction(state);
    expect(result.state.audienceInteraction).toBe(false);
  });
});

// ============================================================================
// resolveTrack
// ============================================================================

describe('remix-engine: resolveTrack', () => {
  test('track resolution uses trackMap[granularType][songIndex]', () => {
    const trackMap = makeTrackMap();

    // bass = index 0, so song 0 = [1], song 1 = [2], song 2 = [3]
    expect(resolveTrack(trackMap, 'bass', 0)).toEqual([1]);
    expect(resolveTrack(trackMap, 'bass', 1)).toEqual([2]);
    expect(resolveTrack(trackMap, 'bass', 2)).toEqual([3]);

    // drums = index 1, so song 0 = [4], song 1 = [5], song 2 = [6]
    expect(resolveTrack(trackMap, 'drums', 0)).toEqual([4]);
  });

  test('returns empty array for unknown granular type', () => {
    const trackMap = makeTrackMap();
    expect(resolveTrack(trackMap, 'unknown', 0)).toEqual([]);
  });

  test('returns empty array for unknown song index', () => {
    const trackMap = makeTrackMap();
    expect(resolveTrack(trackMap, 'bass', 99)).toEqual([]);
  });
});

// ============================================================================
// advanceNode
// ============================================================================

describe('remix-engine: advanceNode', () => {
  test('advancing a silent node with queued token activates it immediately', () => {
    const state = makeRemixState();
    const queued = queueToken(state, 'bass', 'chapter_0');
    expect(queued.state.active.has('bass')).toBe(false);
    expect(queued.state.queue.get('bass')).toHaveLength(1);

    const result = advanceNode(queued.state, 'bass');

    expect(result.state.active.has('bass')).toBe(true);
    expect(result.state.active.get('bass')!.chapterId).toBe('chapter_0');
    expect(result.state.queue.get('bass') ?? []).toHaveLength(0);

    expect(findEvent(result.events, 'TOKEN_ACTIVATED')).toBeDefined();
    expect(findEvent(result.events, 'NODE_ADVANCED')).toBeDefined();

    const unmuteCue = result.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_unmute',
    );
    expect(unmuteCue).toBeDefined();
  });

  test('advancing an active node with queued token crossfades immediately', () => {
    const state = makeRemixState();
    const q1 = queueToken(state, 'bass', 'chapter_0');
    // Activate via loop boundary
    const b1 = processLoopBoundary(q1.state);
    expect(b1.state.active.get('bass')!.chapterId).toBe('chapter_0');

    // Queue a replacement
    const q2 = queueToken(b1.state, 'bass', 'chapter_1');

    // Advance — should crossfade immediately
    const result = advanceNode(q2.state, 'bass');
    expect(result.state.active.get('bass')!.chapterId).toBe('chapter_1');

    expect(findEvent(result.events, 'TOKEN_SPENT')).toBeDefined();
    expect(findEvent(result.events, 'TOKEN_ACTIVATED')).toBeDefined();
    expect(findEvent(result.events, 'NODE_ADVANCED')).toBeDefined();

    const crossfadeCue = result.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_instant_crossfade',
    );
    expect(crossfadeCue).toBeDefined();
  });

  test('advancing an active node with no queue fades out and goes silent', () => {
    const state = makeRemixState();
    const q = queueToken(state, 'bass', 'chapter_0');
    const b = processLoopBoundary(q.state);
    expect(b.state.active.has('bass')).toBe(true);

    // No queue — advance should silence
    const result = advanceNode(b.state, 'bass');
    expect(result.state.active.has('bass')).toBe(false);

    expect(findEvent(result.events, 'TOKEN_SPENT')).toBeDefined();
    expect(findEvent(result.events, 'NODE_SILENT')).toBeDefined();
    expect(findEvent(result.events, 'NODE_ADVANCED')).toBeDefined();

    const fadeOut = result.events.find(
      e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'node_fade_out',
    );
    expect(fadeOut).toBeDefined();
  });

  test('advancing a persistent node (audience mode) with no queue silences it', () => {
    const state = makeRemixState({ audienceInteraction: true });

    // Activate persistent token via instant
    const q = queueToken(state, 'bass', 'chapter_0', true);
    expect(q.state.active.get('bass')!.persistent).toBe(true);

    // Advance with no queue — should silence even though persistent
    const result = advanceNode(q.state, 'bass');
    expect(result.state.active.has('bass')).toBe(false);

    expect(findEvent(result.events, 'TOKEN_SPENT')).toBeDefined();
    expect(findEvent(result.events, 'NODE_SILENT')).toBeDefined();
  });

  test('advancing a silent node with no queue is a no-op', () => {
    const state = makeRemixState();
    const result = advanceNode(state, 'bass');
    expect(result.events).toHaveLength(0);
    expect(result.state).toBe(state);
  });

  test('advancing spends the outgoing active token', () => {
    const state = makeRemixState();
    const q = queueToken(state, 'bass', 'chapter_0');
    const b = processLoopBoundary(q.state);
    const activeTokenId = b.state.active.get('bass')!.tokenId;

    // Queue replacement and advance
    const q2 = queueToken(b.state, 'bass', 'chapter_1');
    const result = advanceNode(q2.state, 'bass');

    const spent = findEvent(result.events, 'TOKEN_SPENT');
    expect(spent).toBeDefined();
    expect((spent as any).tokenId).toBe(activeTokenId);

    // Verify the token is marked spent
    const spentToken = result.state.pool.tokens.find(t => t.id === activeTokenId);
    expect(spentToken?.status).toBe('spent');
  });
});

// ============================================================================
// Chapter-to-SongIndex Resolution
// ============================================================================

describe('remix-engine: chapterToSongIndex via chapterSongIndex', () => {
  test('non-numeric chapter IDs resolve to correct song index via chapterSongIndex', () => {
    const tokens = makeTokens({ ambition: 5, love: 5, acceptance: 5 });
    const state = makeRemixState({
      chapterSongIndex: new Map([['ambition', 0], ['love', 1], ['acceptance', 2]]),
      pool: {
        tokens,
        availableByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalRemaining: 15,
        targetPoolSize: 15,
      },
    });

    // Queue token for "ambition" (songIndex=0) on bass, then activate via boundary
    const r0 = queueToken(state, 'bass', 'ambition');
    const b0 = processLoopBoundary(r0.state);
    const activated0 = findEvent(b0.events, 'TOKEN_ACTIVATED');
    // bass songIndex=0 → trackIndex 1 (from makeTrackMap: bass index 0, song 0 = [1])
    expect(activated0).toBeDefined();
    expect((activated0 as any).trackIndices).toEqual([1]);
  });

  test('different chapters resolve to different track indices', () => {
    const tokens = makeTokens({ ambition: 5, love: 5, acceptance: 5 });
    const state = makeRemixState({
      chapterSongIndex: new Map([['ambition', 0], ['love', 1], ['acceptance', 2]]),
      pool: {
        tokens,
        availableByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalRemaining: 15,
        targetPoolSize: 15,
      },
    });

    // Queue chapter "love" (songIndex=1) on bass, then activate via boundary
    const r1 = queueToken(state, 'bass', 'love');
    const b1 = processLoopBoundary(r1.state);
    const activated1 = findEvent(b1.events, 'TOKEN_ACTIVATED');
    expect(activated1).toBeDefined();
    expect((activated1 as any).trackIndices).toEqual([2]);
  });

  test('seed granular type resolves when present in trackMap', () => {
    const trackMap = makeTrackMap();
    // Add seed entries (simulating liveSeed being included in trackMap)
    trackMap.set('seed', new Map([[0, [100]], [1, [101]], [2, [102]]]));

    const tokens = makeTokens({ ambition: 5, love: 5, acceptance: 5 });
    const state = makeRemixState({
      chapterSongIndex: new Map([['ambition', 0], ['love', 1]]),
      trackMap,
      pool: {
        tokens,
        availableByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalByChapter: new Map([['ambition', 5], ['love', 5], ['acceptance', 5]]),
        totalRemaining: 10,
        targetPoolSize: 10,
      },
    });

    // Queue and activate via boundary
    const r = queueToken(state, 'seed', 'love');
    const b = processLoopBoundary(r.state);
    const activated = findEvent(b.events, 'TOKEN_ACTIVATED');
    expect(activated).toBeDefined();
    expect((activated as any).trackIndices).toEqual([101]);
  });
});

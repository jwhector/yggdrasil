/**
 * Remix Engine — Pure Functions for V3.4 Finale Queue & Spend Logic
 *
 * Manages the performer's token queuing, loop boundary processing,
 * audience interaction mode, and track resolution.
 *
 * Token lifecycle on a node:
 *   queue → (loop boundary) → activate → (loop boundary) → spend
 *   With audience interaction: queue → activate immediately → loops until overridden
 *
 * All functions are pure — no I/O, no Socket.IO, no database calls.
 */

import type {
  FinaleState,
  ConductorEvent,
  QueuedToken,
  ActiveNode,
  AudioCue,
  TokenPool,
} from './types';
import { consumeToken, returnToken, isPoolEmpty, getTotalRemaining } from './token-pool';

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Queue a token from the pool for a granular type node.
 * In audience interaction mode with instant=true, activates immediately.
 */
export function queueToken(
  state: FinaleState,
  granularType: string,
  chapterId: string,
  instant?: boolean,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];

  // Consume a token from the pool
  const poolView: TokenPool = { available: state.pool.availableByChapter, total: state.pool.totalByChapter };
  const consumed = consumeToken(poolView, state.pool.tokens, chapterId);
  if (!consumed.token) {
    return {
      state,
      events: [{ type: 'ERROR', message: `No available tokens for chapter ${chapterId}` } as any],
    };
  }

  const updatedPool = {
    ...state.pool,
    tokens: consumed.tokens,
    availableByChapter: consumed.pool.available,
    totalByChapter: consumed.pool.total,
    totalRemaining: getTotalRemaining(consumed.pool),
  };

  // If audience interaction mode and instant, activate immediately
  if (state.audienceInteraction && instant) {
    return activateInstant(
      { ...state, pool: updatedPool },
      granularType,
      chapterId,
      consumed.token.id,
    );
  }

  // If the node is silent (no active token), activate immediately — no reason to wait
  if (!state.active.has(granularType)) {
    return activateOnSilentNode(
      { ...state, pool: updatedPool },
      granularType,
      chapterId,
      consumed.token.id,
    );
  }

  // Add to queue
  const updatedQueue = new Map(state.queue);
  const typeQueue = [...(updatedQueue.get(granularType) ?? [])];
  typeQueue.push({
    tokenId: consumed.token.id,
    chapterId,
    queuedAt: Date.now(),
  });
  updatedQueue.set(granularType, typeQueue);

  events.push({
    type: 'TOKEN_QUEUED',
    granularType,
    chapterId,
    queueDepth: typeQueue.length,
  });

  return {
    state: { ...state, pool: updatedPool, queue: updatedQueue },
    events,
  };
}

/**
 * Cancel the last queued token for a granular type, returning it to the pool.
 */
export function cancelQueue(
  state: FinaleState,
  granularType: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const typeQueue = state.queue.get(granularType);
  if (!typeQueue || typeQueue.length === 0) {
    return { state, events: [] }; // No-op
  }

  // Remove last queued token
  const cancelled = typeQueue[typeQueue.length - 1];
  const updatedTypeQueue = typeQueue.slice(0, -1);

  const updatedQueue = new Map(state.queue);
  updatedQueue.set(granularType, updatedTypeQueue);

  // Return token to pool
  const returned = returnToken(
    { available: state.pool.availableByChapter, total: state.pool.totalByChapter },
    state.pool.tokens,
    cancelled.tokenId,
  );

  const updatedPool = {
    ...state.pool,
    tokens: returned.tokens,
    availableByChapter: returned.pool.available,
    totalByChapter: returned.pool.total,
    totalRemaining: getTotalRemaining(returned.pool),
  };

  return {
    state: { ...state, pool: updatedPool, queue: updatedQueue },
    events: [{
      type: 'TOKEN_CANCELLED',
      granularType,
      chapterId: cancelled.chapterId,
      returnedToPool: true,
    }],
  };
}

// ============================================================================
// Loop Boundary Processing
// ============================================================================

/**
 * Process a loop boundary — the core tick of the remix engine.
 *
 * 1. For each active node: if a replacement is queued → crossfade, else → spend & fade out
 *    (Exception: persistent tokens in audience interaction mode loop indefinitely)
 * 2. For each queued token with no active node: activate (unmute)
 * 3. Check if pool is empty and no tokens are active or queued
 */
export function processLoopBoundary(
  state: FinaleState,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const updatedActive = new Map(state.active);
  const updatedQueue = new Map(state.queue);
  let updatedTokens = [...state.pool.tokens];

  // Step 1: Process active nodes
  for (const [granularType, activeNode] of state.active) {
    // Persistent tokens (audience interaction mode) loop indefinitely
    if (activeNode.persistent) {
      continue;
    }

    const typeQueue = updatedQueue.get(granularType) ?? [];

    if (typeQueue.length > 0) {
      // Replacement queued — crossfade
      const replacement = typeQueue[0];
      const newQueue = typeQueue.slice(1);
      updatedQueue.set(granularType, newQueue);

      // Spend the outgoing token
      const outgoingIdx = updatedTokens.findIndex(t => t.id === activeNode.tokenId);
      if (outgoingIdx !== -1) {
        updatedTokens = [...updatedTokens];
        updatedTokens[outgoingIdx] = { ...updatedTokens[outgoingIdx], status: 'spent' };
      }

      // Resolve track for incoming token
      const songIndex = chapterToSongIndex(replacement.chapterId, state);
      const trackIndices = resolveTrack(state.trackMap, granularType, songIndex);
      // const trackIndex = trackIndices[0] ?? -1;

      // Activate replacement
      updatedActive.set(granularType, {
        tokenId: replacement.tokenId,
        chapterId: replacement.chapterId,
        startedAtLoop: state.loopCount + 1,
        trackIndices,
        persistent: false,
      });

      // Mark replacement token as playing
      const replIdx = updatedTokens.findIndex(t => t.id === replacement.tokenId);
      if (replIdx !== -1) {
        updatedTokens[replIdx] = { ...updatedTokens[replIdx], status: 'playing' };
      }

      events.push({
        type: 'TOKEN_SPENT',
        granularType,
        tokenId: activeNode.tokenId,
        poolRemaining: 0, // Will be updated at end
      });

      events.push({
        type: 'TOKEN_ACTIVATED',
        granularType,
        chapterId: replacement.chapterId,
        tokenId: replacement.tokenId,
        trackIndices,
      });

      // Audio: crossfade
      events.push({
        type: 'AUDIO_CUE',
        cue: {
          type: 'node_crossfade',
          granularType,
          muteTrack: activeNode.trackIndex,
          unmuteTrack: trackIndices[0],
        },
      });
    } else {
      // No replacement — spend and fade out
      const outgoingIdx = updatedTokens.findIndex(t => t.id === activeNode.tokenId);
      if (outgoingIdx !== -1) {
        updatedTokens = [...updatedTokens];
        updatedTokens[outgoingIdx] = { ...updatedTokens[outgoingIdx], status: 'spent' };
      }

      events.push({
        type: 'TOKEN_SPENT',
        granularType,
        tokenId: activeNode.tokenId,
        poolRemaining: 0, // Will be updated at end
      });

      events.push({
        type: 'AUDIO_CUE',
        cue: {
          type: 'node_fade_out',
          granularType,
          trackIndex: activeNode.trackIndex,
        },
      });

      updatedActive.delete(granularType);

      events.push({ type: 'NODE_SILENT', granularType });
    }
  }

  // Step 2: Activate queued tokens for nodes that are now empty
  for (const [granularType, typeQueue] of updatedQueue) {
    if (updatedActive.has(granularType)) continue; // Already handled above
    if (typeQueue.length === 0) continue;

    const next = typeQueue[0];
    const newQueue = typeQueue.slice(1);
    updatedQueue.set(granularType, newQueue);

    const songIndex = chapterToSongIndex(next.chapterId, state);
    const trackIndices = resolveTrack(state.trackMap, granularType, songIndex);
    const trackIndex = trackIndices[0] ?? -1;

    updatedActive.set(granularType, {
      tokenId: next.tokenId,
      chapterId: next.chapterId,
      startedAtLoop: state.loopCount + 1,
      trackIndex,
      persistent: false,
    });

    // Mark token as playing
    const tokenIdx = updatedTokens.findIndex(t => t.id === next.tokenId);
    if (tokenIdx !== -1) {
      updatedTokens[tokenIdx] = { ...updatedTokens[tokenIdx], status: 'playing' };
    }

    events.push({
      type: 'TOKEN_ACTIVATED',
      granularType,
      chapterId: next.chapterId,
      tokenId: next.tokenId,
      trackIndex,
    });

    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'node_unmute',
        granularType,
        trackIndex,
      },
    });
  }

  // Compute remaining
  const updatedAvailable = new Map(state.pool.availableByChapter);
  const totalRemaining = getTotalRemaining({ available: updatedAvailable, total: state.pool.totalByChapter });

  // Update poolRemaining on TOKEN_SPENT events
  for (const event of events) {
    if (event.type === 'TOKEN_SPENT') {
      (event as any).poolRemaining = totalRemaining;
    }
  }

  const updatedState: FinaleState = {
    ...state,
    pool: {
      ...state.pool,
      tokens: updatedTokens,
      totalRemaining,
    },
    queue: updatedQueue,
    active: updatedActive,
    loopCount: state.loopCount + 1,
  };

  // Check pool empty: no available, no queued, no active
  const poolEmpty = isPoolEmpty({ available: updatedAvailable, total: state.pool.totalByChapter });
  const hasQueued = [...updatedQueue.values()].some(q => q.length > 0);
  const hasActive = updatedActive.size > 0;

  if (poolEmpty && !hasQueued && !hasActive) {
    events.push({ type: 'POOL_EMPTY' });
  }

  return { state: updatedState, events };
}

// ============================================================================
// Audience Interaction Mode
// ============================================================================

/**
 * Toggle audience interaction mode.
 * When disabling: persistent tokens are marked non-persistent (they'll finish their current loop).
 */
export function toggleAudienceInteraction(
  state: FinaleState,
): { state: FinaleState; events: ConductorEvent[] } {
  const newMode = !state.audienceInteraction;
  const updatedActive = new Map(state.active);

  if (!newMode) {
    // Disabling: mark all persistent tokens as non-persistent
    // They'll finish their current loop, then standard behavior resumes
    for (const [granularType, node] of updatedActive) {
      if (node.persistent) {
        updatedActive.set(granularType, { ...node, persistent: false });
      }
    }
  }

  return {
    state: { ...state, audienceInteraction: newMode, active: updatedActive },
    events: [],
  };
}

// ============================================================================
// Track Resolution
// ============================================================================

/**
 * Resolve Ableton track indices for a granular type + song index.
 * Uses the trackMap built from config: trackMap[granularType][songIndex] → trackIndices
 */
export function resolveTrack(
  trackMap: Map<string, Map<number, number[]>>,
  granularType: string,
  songIndex: number,
): number[] {
  const typeMap = trackMap.get(granularType);
  if (!typeMap) return [];
  return typeMap.get(songIndex) ?? [];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Activate a token immediately on a silent node (no active token playing).
 * Used when queuing to an empty node — no reason to wait for loop boundary.
 */
function activateOnSilentNode(
  state: FinaleState,
  granularType: string,
  chapterId: string,
  tokenId: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const updatedActive = new Map(state.active);
  const updatedTokens = [...state.pool.tokens];

  const songIndex = chapterToSongIndex(chapterId, state);
  const trackIndices = resolveTrack(state.trackMap, granularType, songIndex);
  const trackIndex = trackIndices[0] ?? -1;

  // Mark token as playing
  const tokenIdx = updatedTokens.findIndex(t => t.id === tokenId);
  if (tokenIdx !== -1) {
    updatedTokens[tokenIdx] = { ...updatedTokens[tokenIdx], status: 'playing' };
  }

  updatedActive.set(granularType, {
    tokenId,
    chapterId,
    startedAtLoop: state.loopCount,
    trackIndex,
    persistent: false,
  });

  events.push({
    type: 'TOKEN_ACTIVATED',
    granularType,
    chapterId,
    tokenId,
    trackIndex,
  });

  events.push({
    type: 'AUDIO_CUE',
    cue: { type: 'node_unmute', granularType, trackIndex },
  });

  return {
    state: {
      ...state,
      pool: { ...state.pool, tokens: updatedTokens },
      active: updatedActive,
    },
    events,
  };
}

/**
 * Instantly activate a token (audience interaction mode).
 * If there's an active node, spend it immediately and crossfade.
 */
function activateInstant(
  state: FinaleState,
  granularType: string,
  chapterId: string,
  tokenId: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const updatedActive = new Map(state.active);
  let updatedTokens = [...state.pool.tokens];

  const existingNode = updatedActive.get(granularType);

  // Resolve track for new token
  const songIndex = chapterToSongIndex(chapterId, state);
  const trackIndices = resolveTrack(state.trackMap, granularType, songIndex);
  const trackIndex = trackIndices[0] ?? -1;

  if (existingNode) {
    // Spend the existing token
    const outIdx = updatedTokens.findIndex(t => t.id === existingNode.tokenId);
    if (outIdx !== -1) {
      updatedTokens[outIdx] = { ...updatedTokens[outIdx], status: 'spent' };
    }

    events.push({
      type: 'TOKEN_SPENT',
      granularType,
      tokenId: existingNode.tokenId,
      poolRemaining: state.pool.totalRemaining, // Approximate; updated below
    });

    // Instant crossfade audio cue
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'node_instant_crossfade',
        granularType,
        muteTrack: existingNode.trackIndex,
        unmuteTrack: trackIndex,
      },
    });
  } else {
    // No existing node — unmute
    events.push({
      type: 'AUDIO_CUE',
      cue: {
        type: 'node_instant_crossfade',
        granularType,
        muteTrack: null,
        unmuteTrack: trackIndex,
      },
    });
  }

  // Mark new token as playing
  const newIdx = updatedTokens.findIndex(t => t.id === tokenId);
  if (newIdx !== -1) {
    updatedTokens[newIdx] = { ...updatedTokens[newIdx], status: 'playing' };
  }

  // Activate new node (persistent in audience interaction mode)
  updatedActive.set(granularType, {
    tokenId,
    chapterId,
    startedAtLoop: state.loopCount,
    trackIndex,
    persistent: true,
  });

  const totalRemaining = getTotalRemaining({ available: state.pool.availableByChapter, total: state.pool.totalByChapter });

  // Update poolRemaining on TOKEN_SPENT events
  for (const event of events) {
    if (event.type === 'TOKEN_SPENT') {
      (event as any).poolRemaining = totalRemaining;
    }
  }

  events.push({
    type: 'TOKEN_ACTIVATED',
    granularType,
    chapterId,
    tokenId,
    trackIndex,
  });

  return {
    state: {
      ...state,
      pool: { ...state.pool, tokens: updatedTokens, totalRemaining },
      active: updatedActive,
    },
    events,
  };
}

/**
 * Map a chapterId to a songIndex using the trackMap keys.
 * Convention: chapter_0 → 0, chapter_1 → 1, chapter_2 → 2.
 * Uses the pre-built chapterSongIndex map on FinaleState.
 * Populated at finale setup from attempt configs (e.g., "ambition" → 0, "love" → 1).
 */
function chapterToSongIndex(chapterId: string, state: FinaleState): number {
  return state.chapterSongIndex.get(chapterId) ?? 0;
}

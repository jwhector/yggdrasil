/**
 * State Serialization Utilities
 *
 * Handles proper serialization/deserialization of ShowState for Socket.IO
 * and backup/persistence.
 *
 * Problem: Map/Set objects don't survive JSON serialization (become {}).
 * Solution: Convert Maps to [key, value][] arrays and Sets to arrays before sending,
 *           reconstruct after receiving.
 *
 * Maps/Sets in ShowState:
 *   - ShowState.users: Map<UserId, User>
 *   - FinaleState.vote.questionsAnsweredByUser: Map<UserId, number>
 *   - FinaleState.pool.availableByChapter: Map<string, number>
 *   - FinaleState.pool.totalByChapter: Map<string, number>
 *   - FinaleState.queue: Map<string, QueuedToken[]>
 *   - FinaleState.active: Map<string, ActiveNode>
 *   - FinaleState.trackMap: Map<string, Map<number, number[]>>
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  FinaleState,
  UserRemixState,
  NodeVoteTally,
} from '@/conductor/types';

// ============================================================================
// Serialized Types
// ============================================================================

/** Serialized shape of FinaleState (Maps converted to arrays). */
export interface SerializedFinaleState {
  phase: 'vote' | 'remix';
  vote: {
    questionsAnsweredByUser: [string, number][];
  };
  pool: {
    tokens: FinaleState['pool']['tokens'];
    availableByChapter: [string, number][];
    totalByChapter: [string, number][];
    totalRemaining: number;
    targetPoolSize: number;
  };
  queue: [string, FinaleState['queue'] extends Map<string, infer V> ? V : never][];
  active: [string, FinaleState['active'] extends Map<string, infer V> ? V : never][];
  audienceInteraction: boolean;
  chapterSongIndex: [string, number][];
  trackMap: [string, [number, number[]][]][];
  loopCount: number;
  loopProgress: number;
  npc: { currentMessage: string | null };
  audienceOrbs: [string, UserRemixState][];
  nodeTallies: [string, { granularType: string; votes: [string, number][]; dominantChapter: string | null; locked: boolean; lockedChapter: string | null }][];
  orbDecayLoops: number;
  instantCrossfade: boolean;
  fallbackMode: boolean;
}

export interface SerializedShowState {
  id: ShowState['id'];
  phase: ShowState['phase'];
  currentAttemptIndex: number;
  attempts: ShowState['attempts'];
  users: [UserId, User][];
  finaleState: SerializedFinaleState | null;
  config: ShowState['config'];
  version: number;
  lastUpdated: number;
  paused: boolean;
  openerSlideState?: ShowState['openerSlideState'];
}

// ============================================================================
// Finale State Serialize / Deserialize
// ============================================================================

export function serializeFinaleState(fs: FinaleState): SerializedFinaleState {
  return {
    phase: fs.phase,
    vote: {
      questionsAnsweredByUser: Array.from(fs.vote.questionsAnsweredByUser.entries()),
    },
    pool: {
      tokens: fs.pool.tokens,
      availableByChapter: Array.from(fs.pool.availableByChapter.entries()),
      totalByChapter: Array.from(fs.pool.totalByChapter.entries()),
      totalRemaining: fs.pool.totalRemaining,
      targetPoolSize: fs.pool.targetPoolSize,
    },
    queue: Array.from(fs.queue.entries()).map(([gt, tokens]) => [gt, tokens]),
    active: Array.from(fs.active.entries()).map(([gt, node]) => [gt, node]),
    audienceInteraction: fs.audienceInteraction,
    chapterSongIndex: Array.from(fs.chapterSongIndex.entries()),
    trackMap: Array.from(fs.trackMap.entries()).map(
      ([gt, songMap]): [string, [number, number[]][]] => [gt, Array.from(songMap.entries())],
    ),
    loopCount: fs.loopCount,
    loopProgress: fs.loopProgress,
    npc: fs.npc,
    audienceOrbs: Array.from((fs.audienceOrbs ?? new Map()).entries()),
    nodeTallies: Array.from((fs.nodeTallies ?? new Map()).entries()).map(([gt, tally]) => [gt, {
      ...tally,
      votes: Array.from(tally.votes.entries()),
    }]),
    orbDecayLoops: fs.orbDecayLoops ?? 3,
    instantCrossfade: fs.instantCrossfade ?? false,
    fallbackMode: fs.fallbackMode ?? false,
  };
}

export function deserializeFinaleState(data: SerializedFinaleState): FinaleState {
  return {
    phase: data.phase,
    vote: {
      questionsAnsweredByUser: new Map(data.vote.questionsAnsweredByUser),
    },
    pool: {
      tokens: data.pool.tokens,
      availableByChapter: new Map(data.pool.availableByChapter),
      totalByChapter: new Map(data.pool.totalByChapter),
      totalRemaining: data.pool.totalRemaining,
      targetPoolSize: data.pool.targetPoolSize,
    },
    queue: new Map(data.queue),
    active: new Map(data.active),
    audienceInteraction: data.audienceInteraction,
    chapterSongIndex: new Map(data.chapterSongIndex),
    trackMap: new Map(
      data.trackMap.map(([gt, entries]) => [gt, new Map(entries)]),
    ),
    loopCount: data.loopCount,
    loopProgress: data.loopProgress,
    npc: data.npc,
    audienceOrbs: new Map(data.audienceOrbs ?? []),
    nodeTallies: new Map(
      (data.nodeTallies ?? []).map(([gt, tally]) => [gt, {
        ...tally,
        votes: new Map(tally.votes),
      }] as [string, NodeVoteTally]),
    ),
    orbDecayLoops: data.orbDecayLoops ?? 3,
    instantCrossfade: data.instantCrossfade ?? false,
    fallbackMode: data.fallbackMode ?? false,
  };
}

// ============================================================================
// Show State Serialize / Deserialize
// ============================================================================

/**
 * Serialize ShowState for transmission over Socket.IO or storage.
 * Converts all Maps/Sets to arrays.
 */
export function serializeState(state: ShowState): SerializedShowState {
  return {
    id: state.id,
    phase: state.phase,
    currentAttemptIndex: state.currentAttemptIndex,
    attempts: state.attempts,
    users: Array.from(state.users.entries()),
    finaleState: state.finaleState
      ? serializeFinaleState(state.finaleState as FinaleState)
      : null,
    config: state.config,
    version: state.version,
    lastUpdated: state.lastUpdated,
    paused: state.paused,
    openerSlideState: state.openerSlideState,
  };
}

/**
 * Deserialize ShowState after receiving from Socket.IO or loading from storage.
 * Reconstructs all Maps/Sets from arrays.
 */
export function deserializeState(data: SerializedShowState): ShowState {
  return {
    id: data.id,
    phase: data.phase,
    currentAttemptIndex: data.currentAttemptIndex,
    attempts: data.attempts,
    users: new Map(data.users),
    finaleState: data.finaleState && data.finaleState.vote
      ? deserializeFinaleState(data.finaleState)
      : null,
    config: data.config,
    version: data.version,
    lastUpdated: data.lastUpdated,
    paused: data.paused,
    openerSlideState: data.openerSlideState ?? null,
  };
}

/**
 * Type guard: check if data looks like a serialized ShowState
 */
export function isSerializedState(data: unknown): data is SerializedShowState {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.version === 'number' &&
    Array.isArray(obj.users) &&
    Array.isArray(obj.attempts)
  );
}

/**
 * State Serialization Utilities (V3.3)
 *
 * Handles proper serialization/deserialization of ShowState for Socket.IO
 * and backup/persistence.
 *
 * Problem: Map/Set objects don't survive JSON serialization (become {}).
 * Solution: Convert Maps to [key, value][] arrays and Sets to arrays before sending,
 *           reconstruct after receiving.
 *
 * Maps/Sets in ShowState (V3.3):
 *   - ShowState.users: Map<UserId, User>
 *   - V33FinaleState.quilt.cells: Map<string, QuiltCell>
 *   - V33FinaleState.trackMap: Map<string, Map<number, number[]>>
 *   - V33FinaleState.preview.lockedInUsers: Set<UserId>
 *   - V33FinaleState.remix.lockedCells: Set<string>
 *   - V33FinaleState.remix.mutedCells: Set<string>
 *   - V33FinaleState.remix.lastMoveByUser: Map<UserId, number>
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  V33FinaleState,
  V34FinaleState,
  QuiltCell,
} from '@/conductor/types';

// ============================================================================
// Serialized Types
// ============================================================================

export interface SerializedFinaleState {
  phase: V33FinaleState['phase'];
  availableFragments: V33FinaleState['availableFragments'];
  allFragments: V33FinaleState['allFragments'];
  elegyOptedIn?: string[];
  quilt: {
    rows: number;
    columns: number;
    barsPerCell: number;
    cells: [string, QuiltCell][];
    columnOrder: number[];
    playheadColumn: number;
    loopCount: number;
  };
  availableSongs: number[];
  trackMap: [string, [number, number[]][]][];
  assignment: V33FinaleState['assignment'];
  preview: {
    lockedInUsers: UserId[];
    timerRemaining: number | null;
  };
  remix: {
    lockedCells: string[];
    mutedCells: string[];
    lastMoveByUser: [UserId, number][];
    liveTracksActive: string[];
    frozenColumn: number | null;
    frozenActiveTracks: [string, number[]][];
  };
  npc: V33FinaleState['npc'];
  arc?: V33FinaleState['arc'];
}

export interface SerializedShowState {
  id: ShowState['id'];
  phase: ShowState['phase'];
  currentAttemptIndex: number;
  attempts: ShowState['attempts'];
  users: [UserId, User][];
  finaleState: SerializedFinaleState | object | null;
  config: ShowState['config'];
  version: number;
  lastUpdated: number;
  paused: boolean;
  openerSlideState?: ShowState['openerSlideState'];
}

// ============================================================================
// Finale State Serialize / Deserialize
// ============================================================================

export function serializeFinaleState(fs: V33FinaleState): SerializedFinaleState {
  return {
    phase: fs.phase,
    availableFragments: fs.availableFragments,
    allFragments: fs.allFragments,
    elegyOptedIn: Array.from(fs.elegyOptedIn),
    quilt: {
      rows: fs.quilt.rows,
      columns: fs.quilt.columns,
      barsPerCell: fs.quilt.barsPerCell,
      cells: Array.from(fs.quilt.cells.entries()),
      columnOrder: fs.quilt.columnOrder,
      playheadColumn: fs.quilt.playheadColumn,
      loopCount: fs.quilt.loopCount,
    },
    availableSongs: fs.availableSongs,
    trackMap: Array.from(fs.trackMap.entries()).map(
      ([gt, songMap]): [string, [number, number[]][]] => [gt, Array.from(songMap.entries())],
    ),
    assignment: fs.assignment,
    preview: {
      lockedInUsers: Array.from(fs.preview.lockedInUsers),
      timerRemaining: fs.preview.timerRemaining,
    },
    remix: {
      lockedCells: Array.from(fs.remix.lockedCells),
      mutedCells: Array.from(fs.remix.mutedCells),
      lastMoveByUser: Array.from(fs.remix.lastMoveByUser.entries()),
      liveTracksActive: fs.remix.liveTracksActive,
      frozenColumn: fs.remix.frozenColumn,
      frozenActiveTracks: Array.from(fs.remix.frozenActiveTracks.entries()),
    },
    npc: fs.npc,
    arc: fs.arc,
  };
}

export function deserializeFinaleState(data: SerializedFinaleState): V33FinaleState {
  return {
    phase: data.phase,
    availableFragments: data.availableFragments,
    allFragments: data.allFragments,
    elegyOptedIn: new Set(data.elegyOptedIn ?? []),
    quilt: {
      rows: data.quilt.rows,
      columns: data.quilt.columns,
      barsPerCell: data.quilt.barsPerCell,
      cells: new Map(data.quilt.cells),
      columnOrder: data.quilt.columnOrder,
      playheadColumn: data.quilt.playheadColumn,
      loopCount: data.quilt.loopCount,
    },
    availableSongs: data.availableSongs,
    trackMap: new Map(
      data.trackMap.map(([gt, entries]) => [gt, new Map(entries)]),
    ),
    assignment: data.assignment,
    preview: {
      lockedInUsers: new Set(data.preview.lockedInUsers),
      timerRemaining: data.preview.timerRemaining,
    },
    remix: {
      lockedCells: new Set(data.remix.lockedCells),
      mutedCells: new Set(data.remix.mutedCells),
      lastMoveByUser: new Map(data.remix.lastMoveByUser),
      liveTracksActive: data.remix.liveTracksActive,
      frozenColumn: data.remix.frozenColumn ?? null,
      frozenActiveTracks: new Map(data.remix.frozenActiveTracks ?? []),
    },
    npc: data.npc,
    arc: data.arc ?? null,
  };
}

// ============================================================================
// V3.4 Finale State Serialize / Deserialize
// ============================================================================

/** Serialized shape of V3.4 finale state (Maps converted to arrays). */
export interface SerializedV34FinaleState {
  phase: 'vote' | 'remix';
  vote: {
    questionsAnsweredByUser: [string, number][];
    maxQuestionsPerPerson: number;
    poolCapReached: boolean;
  };
  pool: {
    tokens: V34FinaleState['pool']['tokens'];
    availableByChapter: [string, number][];
    totalByChapter: [string, number][];
    totalRemaining: number;
    targetPoolSize: number;
  };
  queue: [string, V34FinaleState['queue'] extends Map<string, infer V> ? V : never][];
  active: [string, V34FinaleState['active'] extends Map<string, infer V> ? V : never][];
  audienceInteraction: boolean;
  trackMap: [string, [number, number[]][]][];
  loopCount: number;
  loopProgress: number;
  npc: { currentMessage: string | null };
}

export function deserializeV34FinaleState(data: SerializedV34FinaleState): V34FinaleState {
  return {
    phase: data.phase,
    vote: {
      questionsAnsweredByUser: new Map(data.vote.questionsAnsweredByUser),
      maxQuestionsPerPerson: data.vote.maxQuestionsPerPerson,
      poolCapReached: data.vote.poolCapReached,
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
    trackMap: new Map(
      data.trackMap.map(([gt, entries]) => [gt, new Map(entries)]),
    ),
    loopCount: data.loopCount,
    loopProgress: data.loopProgress,
    npc: data.npc,
  };
}

export function serializeV34FinaleState(fs: V34FinaleState): object {
  return {
    phase: fs.phase,
    vote: {
      questionsAnsweredByUser: Array.from(fs.vote.questionsAnsweredByUser.entries()),
      maxQuestionsPerPerson: fs.vote.maxQuestionsPerPerson,
      poolCapReached: fs.vote.poolCapReached,
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
    trackMap: Array.from(fs.trackMap.entries()).map(
      ([gt, songMap]): [string, [number, number[]][]] => [gt, Array.from(songMap.entries())],
    ),
    loopCount: fs.loopCount,
    loopProgress: fs.loopProgress,
    npc: fs.npc,
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
    finaleState: state.finaleState && 'quilt' in state.finaleState
      ? serializeFinaleState(state.finaleState as V33FinaleState)
      : state.finaleState && 'queue' in state.finaleState
        ? serializeV34FinaleState(state.finaleState as V34FinaleState)
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
    finaleState: data.finaleState && typeof data.finaleState === 'object'
      ? 'quilt' in data.finaleState
        ? deserializeFinaleState(data.finaleState as SerializedFinaleState)
        : 'queue' in data.finaleState
          ? deserializeV34FinaleState(data.finaleState as SerializedV34FinaleState)
          : null
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

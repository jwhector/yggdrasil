/**
 * State Serialization Utilities
 *
 * Handles proper serialization/deserialization of ShowState for Socket.IO
 * and backup/persistence.
 *
 * Problem: Map objects don't survive JSON serialization (become {}).
 * Solution: Convert Maps to [key, value][] arrays before sending,
 *           reconstruct after receiving.
 *
 * Maps in ShowState:
 *   - ShowState.users: Map<UserId, User>
 *   - FinaleState.chapterAssignments: Map<UserId, Chapter>
 *   - FinaleState.trianglePositions: Map<UserId, TrianglePosition>
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  Chapter,
  TrianglePosition,
  FinaleState,
} from '@/conductor/types';

// ============================================================================
// Serialized Types
// ============================================================================

export interface SerializedFinaleState {
  chapterAssignments: [UserId, Chapter][];
  queue: FinaleState['queue'];
  activeSlots: FinaleState['activeSlots'];
  trianglePositions: [UserId, TrianglePosition][];
  centroid: TrianglePosition;
  rotationActive: boolean;
  rotationRate: 1 | 2;
  frozen: boolean;
  stewardshipLog: FinaleState['stewardshipLog'];
  triangleActive: boolean;
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
}

// ============================================================================
// Finale State Serialize / Deserialize
// ============================================================================

export function serializeFinaleState(finaleState: FinaleState): SerializedFinaleState {
  return {
    chapterAssignments: Array.from(finaleState.chapterAssignments.entries()),
    queue: finaleState.queue,
    activeSlots: finaleState.activeSlots,
    trianglePositions: Array.from(finaleState.trianglePositions.entries()),
    centroid: finaleState.centroid,
    rotationActive: finaleState.rotationActive,
    rotationRate: finaleState.rotationRate,
    frozen: finaleState.frozen,
    stewardshipLog: finaleState.stewardshipLog,
    triangleActive: finaleState.triangleActive,
  };
}

export function deserializeFinaleState(data: SerializedFinaleState): FinaleState {
  return {
    chapterAssignments: new Map(data.chapterAssignments),
    queue: data.queue,
    activeSlots: data.activeSlots,
    trianglePositions: new Map(data.trianglePositions),
    centroid: data.centroid,
    rotationActive: data.rotationActive,
    rotationRate: data.rotationRate,
    frozen: data.frozen,
    stewardshipLog: data.stewardshipLog,
    triangleActive: data.triangleActive,
  };
}

// ============================================================================
// Show State Serialize / Deserialize
// ============================================================================

/**
 * Serialize ShowState for transmission over Socket.IO or storage.
 * Converts all Maps to [key, value][] arrays.
 */
export function serializeState(state: ShowState): SerializedShowState {
  return {
    id: state.id,
    phase: state.phase,
    currentAttemptIndex: state.currentAttemptIndex,
    attempts: state.attempts,
    users: Array.from(state.users.entries()),
    finaleState: state.finaleState ? serializeFinaleState(state.finaleState) : null,
    config: state.config,
    version: state.version,
    lastUpdated: state.lastUpdated,
    paused: state.paused,
  };
}

/**
 * Deserialize ShowState after receiving from Socket.IO or loading from storage.
 * Reconstructs all Maps from [key, value][] arrays.
 */
export function deserializeState(data: SerializedShowState): ShowState {
  return {
    id: data.id,
    phase: data.phase,
    currentAttemptIndex: data.currentAttemptIndex,
    attempts: data.attempts,
    users: new Map(data.users),
    finaleState: data.finaleState ? deserializeFinaleState(data.finaleState) : null,
    config: data.config,
    version: data.version,
    lastUpdated: data.lastUpdated,
    paused: data.paused,
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

/**
 * State Serialization Utilities
 *
 * Handles proper serialization/deserialization of ShowState for Socket.IO.
 *
 * Problem: Map and Set objects don't survive JSON serialization:
 *   - Map becomes {} (empty object) or loses its methods
 *   - Set becomes {} (empty object)
 *
 * Solution: Convert to arrays before sending, reconstruct after receiving.
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  PersonalTree,
  Faction,
  FactionId,
} from '@/conductor/types';

/**
 * Serialized format for transmission (all Maps/Sets become arrays)
 */
export interface SerializedShowState {
  id: string;
  version: number;
  lastUpdated: number;
  phase: ShowState['phase'];
  currentRowIndex: number;
  rows: ShowState['rows'];
  factions: SerializedFaction[];
  users: [UserId, User][];
  votes: ShowState['votes'];
  personalTrees: [UserId, PersonalTree][];
  paths: ShowState['paths'];
  config: ShowState['config'];
  pausedPhase: ShowState['pausedPhase'];
}

export interface SerializedFaction {
  id: FactionId;
  name: string;
  color: string;
  coupUsed: boolean;
  coupMultiplier: number;
  currentRowCoupVotes: UserId[];
}

/**
 * Serialize ShowState for transmission over Socket.IO
 * Converts Maps to arrays of [key, value] pairs
 * Converts Sets to arrays
 */
export function serializeState(state: ShowState): SerializedShowState {
  return {
    id: state.id,
    version: state.version,
    lastUpdated: state.lastUpdated,
    phase: state.phase,
    currentRowIndex: state.currentRowIndex,
    rows: state.rows,
    factions: state.factions.map(serializeFaction),
    users: Array.from(state.users.entries()),
    votes: state.votes,
    personalTrees: Array.from(state.personalTrees.entries()),
    paths: state.paths,
    config: state.config,
    pausedPhase: state.pausedPhase,
  };
}

/**
 * Serialize a single faction
 */
function serializeFaction(faction: Faction): SerializedFaction {
  return {
    id: faction.id,
    name: faction.name,
    color: faction.color,
    coupUsed: faction.coupUsed,
    coupMultiplier: faction.coupMultiplier,
    currentRowCoupVotes: Array.from(faction.currentRowCoupVotes),
  };
}

/**
 * Deserialize ShowState after receiving from Socket.IO
 * Reconstructs Maps from arrays of [key, value] pairs
 * Reconstructs Sets from arrays
 */
export function deserializeState(data: SerializedShowState): ShowState {
  return {
    id: data.id,
    version: data.version,
    lastUpdated: data.lastUpdated,
    phase: data.phase,
    currentRowIndex: data.currentRowIndex,
    rows: data.rows,
    factions: data.factions.map(deserializeFaction) as [Faction, Faction, Faction, Faction],
    users: new Map(data.users),
    votes: data.votes,
    personalTrees: new Map(data.personalTrees),
    paths: data.paths,
    config: data.config,
    pausedPhase: data.pausedPhase,
  };
}

/**
 * Deserialize a single faction
 */
function deserializeFaction(faction: SerializedFaction): Faction {
  return {
    id: faction.id,
    name: faction.name,
    color: faction.color,
    coupUsed: faction.coupUsed,
    coupMultiplier: faction.coupMultiplier,
    currentRowCoupVotes: new Set(faction.currentRowCoupVotes),
  };
}

/**
 * Type guard to check if data is serialized state format
 */
export function isSerializedState(data: unknown): data is SerializedShowState {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.version === 'number' &&
    Array.isArray(obj.users) &&
    Array.isArray(obj.factions)
  );
}

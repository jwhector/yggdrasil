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
 * Maps in ShowState (V2):
 *   - ShowState.users: Map<UserId, User>
 *   - FinaleState.consensusGame.votes: Map<UserId, string>
 *   - FinaleState.consensusGame.lockedRoles: Map<LayerType, string>
 *   - FinaleState.performerMix.activeLayers: Map<LayerType, string | null>
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  LayerType,
  FinaleState,
} from '@/conductor/types';

// ============================================================================
// Serialized Types
// ============================================================================

export interface SerializedConsensusGame {
  active: boolean;
  currentRound: number;
  roundTimeRemaining: number;
  votes: [UserId, string][];
  convergenceValue: number;
  threshold: number;
  consecutiveFailures: number;
  lockedRoles: [LayerType, string][];
}

export interface SerializedPerformerMix {
  activeLayers: [LayerType, string | null][];
  pendingChanges: FinaleState['performerMix']['pendingChanges'];
  loopPosition: number;
  loopCount: number;
  liveTracksActive: string[];
}

export interface SerializedFinaleState {
  phase: FinaleState['phase'];
  availableFragments: FinaleState['availableFragments'];
  allFragments: FinaleState['allFragments'];
  lockedFragments: FinaleState['lockedFragments'];
  consensusGame: SerializedConsensusGame;
  npc: FinaleState['npc'];
  performerMix: SerializedPerformerMix;
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
    phase: finaleState.phase,
    availableFragments: finaleState.availableFragments,
    allFragments: finaleState.allFragments,
    lockedFragments: finaleState.lockedFragments,
    consensusGame: {
      active: finaleState.consensusGame.active,
      currentRound: finaleState.consensusGame.currentRound,
      roundTimeRemaining: finaleState.consensusGame.roundTimeRemaining,
      votes: Array.from(finaleState.consensusGame.votes.entries()),
      convergenceValue: finaleState.consensusGame.convergenceValue,
      threshold: finaleState.consensusGame.threshold,
      consecutiveFailures: finaleState.consensusGame.consecutiveFailures,
      lockedRoles: Array.from(finaleState.consensusGame.lockedRoles.entries()),
    },
    npc: finaleState.npc,
    performerMix: {
      activeLayers: Array.from(finaleState.performerMix.activeLayers.entries()),
      pendingChanges: finaleState.performerMix.pendingChanges,
      loopPosition: finaleState.performerMix.loopPosition,
      loopCount: finaleState.performerMix.loopCount,
      liveTracksActive: finaleState.performerMix.liveTracksActive,
    },
  };
}

export function deserializeFinaleState(data: SerializedFinaleState): FinaleState {
  return {
    phase: data.phase,
    availableFragments: data.availableFragments,
    allFragments: data.allFragments,
    lockedFragments: data.lockedFragments,
    consensusGame: {
      active: data.consensusGame.active,
      currentRound: data.consensusGame.currentRound,
      roundTimeRemaining: data.consensusGame.roundTimeRemaining,
      votes: new Map(data.consensusGame.votes),
      convergenceValue: data.consensusGame.convergenceValue,
      threshold: data.consensusGame.threshold,
      consecutiveFailures: data.consensusGame.consecutiveFailures,
      lockedRoles: new Map(data.consensusGame.lockedRoles),
    },
    npc: data.npc,
    performerMix: {
      activeLayers: new Map(data.performerMix.activeLayers),
      pendingChanges: data.performerMix.pendingChanges,
      loopPosition: data.performerMix.loopPosition,
      loopCount: data.performerMix.loopCount,
      liveTracksActive: data.performerMix.liveTracksActive,
    },
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

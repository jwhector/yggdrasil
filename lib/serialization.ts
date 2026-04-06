/**
 * State Serialization Utilities (V3.2)
 *
 * Handles proper serialization/deserialization of ShowState for Socket.IO
 * and backup/persistence.
 *
 * Problem: Map objects don't survive JSON serialization (become {}).
 * Solution: Convert Maps to [key, value][] arrays before sending,
 *           reconstruct after receiving.
 *
 * Maps in ShowState (V3.2):
 *   - ShowState.users: Map<UserId, User>
 *   - V32FinaleState.assignment.groups: Map<string, UserId[]>
 *   - V32FinaleState.liveMix.votes: Map<string, Map<UserId, LiveMixVote>>
 *   - V32FinaleState.liveMix.activeFragments: Map<string, string>
 *   - V32FinaleState.liveMix.performerOverrides: Map<string, string>
 *
 * Usage:
 *   Server: socket.emit('state_sync', serializeState(state))
 *   Client: const state = deserializeState(data)
 */

import type {
  ShowState,
  UserId,
  User,
  V32FinaleState,
  LiveMixVote,
} from '@/conductor/types';

// ============================================================================
// Serialized Types
// ============================================================================

export interface SerializedAssignment {
  mode: 'auto' | 'self_select';
  groups: [string, UserId[]][];
  timerRemaining: number | null;
}

export interface SerializedLiveMix {
  votes: [string, [UserId, LiveMixVote][]][];
  activeFragments: [string, string][];
  lockedTypes: string[];
  performerOverrides: [string, string][];
  liveTracksActive: string[];
  transportStarted: boolean;
  loopPosition: number;
  loopCount: number;
}

export interface SerializedFinaleState {
  phase: V32FinaleState['phase'];
  availableFragments: V32FinaleState['availableFragments'];
  allFragments: V32FinaleState['allFragments'];
  assignment: SerializedAssignment;
  liveMix: SerializedLiveMix;
  npc: V32FinaleState['npc'];
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

export function serializeFinaleState(fs: V32FinaleState): SerializedFinaleState {
  return {
    phase: fs.phase,
    availableFragments: fs.availableFragments,
    allFragments: fs.allFragments,
    assignment: {
      mode: fs.assignment.mode,
      groups: Array.from(fs.assignment.groups.entries()),
      timerRemaining: fs.assignment.timerRemaining,
    },
    liveMix: {
      votes: Array.from(fs.liveMix.votes.entries()).map(
        ([gt, userVotes]) => [gt, Array.from(userVotes.entries())] as [string, [UserId, LiveMixVote][]],
      ),
      activeFragments: Array.from(fs.liveMix.activeFragments.entries()),
      lockedTypes: fs.liveMix.lockedTypes,
      performerOverrides: Array.from(fs.liveMix.performerOverrides.entries()),
      liveTracksActive: fs.liveMix.liveTracksActive,
      transportStarted: fs.liveMix.transportStarted,
      loopPosition: fs.liveMix.loopPosition,
      loopCount: fs.liveMix.loopCount,
    },
    npc: fs.npc,
  };
}

export function deserializeFinaleState(data: SerializedFinaleState): V32FinaleState {
  return {
    phase: data.phase,
    availableFragments: data.availableFragments,
    allFragments: data.allFragments,
    assignment: {
      mode: data.assignment.mode,
      groups: new Map(data.assignment.groups),
      timerRemaining: data.assignment.timerRemaining,
    },
    liveMix: {
      votes: new Map(
        data.liveMix.votes.map(([gt, userVotes]) => [gt, new Map(userVotes)]),
      ),
      activeFragments: new Map(data.liveMix.activeFragments),
      lockedTypes: data.liveMix.lockedTypes,
      performerOverrides: new Map(data.liveMix.performerOverrides),
      liveTracksActive: data.liveMix.liveTracksActive,
      transportStarted: data.liveMix.transportStarted,
      loopPosition: data.liveMix.loopPosition,
      loopCount: data.liveMix.loopCount,
    },
    npc: data.npc,
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
    openerSlideState: state.openerSlideState,
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

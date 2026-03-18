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
 * Maps in ShowState (V3):
 *   - ShowState.users: Map<UserId, User>
 *   - ShowState.config.finale.layerLabels: Map<LayerType, string>
 *   - FinaleState.assembly.groups: Map<LayerType, UserId[]>
 *   - FinaleState.deliberation.groupVotes: Map<LayerType, Map<UserId, string>>
 *   - FinaleState.deliberation.chosenFragments: Map<LayerType, string | null>
 *   - FinaleState.deliberation.ambassadorVolunteers: Map<LayerType, UserId[]>
 *   - FinaleState.deliberation.ambassadors: Map<LayerType, UserId | null>
 *   - FinaleState.ceremony.lockedLayers: Map<LayerType, string>
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

export interface SerializedAssembly {
  groups: [LayerType, UserId[]][];
  undecidedUsers: UserId[];
  timerRemaining: number;
  timerDuration: number;
}

export interface SerializedDeliberation {
  groupVotes: [LayerType, [UserId, string][]][];
  chosenFragments: [LayerType, string | null][];
  ambassadorVolunteers: [LayerType, UserId[]][];
  ambassadors: [LayerType, UserId | null][];
  timerRemaining: number;
  volunteerTimerRemaining: number | null;
}

export interface SerializedCeremony {
  layerOrder: LayerType[];
  currentIndex: number;
  currentAmbassador: UserId | null;
  altarReady: boolean;
  lockedLayers: [LayerType, string][];
  forfeitedLayers: LayerType[];
  ceremonyComplete: boolean;
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
  assembly: SerializedAssembly;
  deliberation: SerializedDeliberation;
  ceremony: SerializedCeremony;
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
    assembly: {
      groups: Array.from(finaleState.assembly.groups.entries()),
      undecidedUsers: finaleState.assembly.undecidedUsers,
      timerRemaining: finaleState.assembly.timerRemaining,
      timerDuration: finaleState.assembly.timerDuration,
    },
    deliberation: {
      groupVotes: Array.from(finaleState.deliberation.groupVotes.entries()).map(
        ([lt, votes]) => [lt, Array.from(votes.entries())] as [LayerType, [UserId, string][]],
      ),
      chosenFragments: Array.from(finaleState.deliberation.chosenFragments.entries()),
      ambassadorVolunteers: Array.from(finaleState.deliberation.ambassadorVolunteers.entries()),
      ambassadors: Array.from(finaleState.deliberation.ambassadors.entries()),
      timerRemaining: finaleState.deliberation.timerRemaining,
      volunteerTimerRemaining: finaleState.deliberation.volunteerTimerRemaining,
    },
    ceremony: {
      layerOrder: finaleState.ceremony.layerOrder,
      currentIndex: finaleState.ceremony.currentIndex,
      currentAmbassador: finaleState.ceremony.currentAmbassador,
      altarReady: finaleState.ceremony.altarReady,
      lockedLayers: Array.from(finaleState.ceremony.lockedLayers.entries()),
      forfeitedLayers: finaleState.ceremony.forfeitedLayers,
      ceremonyComplete: finaleState.ceremony.ceremonyComplete,
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
    assembly: {
      groups: new Map(data.assembly.groups),
      undecidedUsers: data.assembly.undecidedUsers,
      timerRemaining: data.assembly.timerRemaining,
      timerDuration: data.assembly.timerDuration,
    },
    deliberation: {
      groupVotes: new Map(
        data.deliberation.groupVotes.map(([lt, votes]) => [lt, new Map(votes)]),
      ),
      chosenFragments: new Map(data.deliberation.chosenFragments),
      ambassadorVolunteers: new Map(data.deliberation.ambassadorVolunteers),
      ambassadors: new Map(data.deliberation.ambassadors),
      timerRemaining: data.deliberation.timerRemaining,
      volunteerTimerRemaining: data.deliberation.volunteerTimerRemaining,
    },
    ceremony: {
      layerOrder: data.ceremony.layerOrder,
      currentIndex: data.ceremony.currentIndex,
      currentAmbassador: data.ceremony.currentAmbassador,
      altarReady: data.ceremony.altarReady,
      lockedLayers: new Map(data.ceremony.lockedLayers),
      forfeitedLayers: data.ceremony.forfeitedLayers,
      ceremonyComplete: data.ceremony.ceremonyComplete,
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
  // Serialize config.finale.layerLabels Map to entries array for JSON safety
  const serializedConfig = {
    ...state.config,
    finale: {
      ...state.config.finale,
      layerLabels: state.config.finale.layerLabels instanceof Map
        ? Array.from(state.config.finale.layerLabels.entries())
        : state.config.finale.layerLabels,
    },
  };

  return {
    id: state.id,
    phase: state.phase,
    currentAttemptIndex: state.currentAttemptIndex,
    attempts: state.attempts,
    users: Array.from(state.users.entries()),
    finaleState: state.finaleState ? serializeFinaleState(state.finaleState) : null,
    config: serializedConfig as unknown as ShowState['config'],
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
  // Reconstruct config.finale.layerLabels Map from serialized form
  const config = {
    ...data.config,
    finale: {
      ...data.config.finale,
      layerLabels: data.config.finale.layerLabels instanceof Map
        ? data.config.finale.layerLabels
        : Array.isArray(data.config.finale.layerLabels)
          ? new Map(data.config.finale.layerLabels as [LayerType, string][])
          : new Map(Object.entries(data.config.finale.layerLabels ?? {}) as [LayerType, string][]),
    },
  };

  return {
    id: data.id,
    phase: data.phase,
    currentAttemptIndex: data.currentAttemptIndex,
    attempts: data.attempts,
    users: new Map(data.users),
    finaleState: data.finaleState ? deserializeFinaleState(data.finaleState) : null,
    config: config as ShowState['config'],
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

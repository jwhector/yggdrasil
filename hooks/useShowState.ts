/**
 * useShowState Hook
 *
 * Manages client-side show state by listening to Socket.IO events.
 * Provides state and actions filtered for the client type (controller/projector/audience).
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  ShowState,
  ControllerClientState,
  ProjectorClientState,
  AudienceClientState,
  ConductorCommand,
  UserId,
} from '@/conductor/types';
import { updateLastVersion } from '@/lib/storage';
import { deserializeState, isSerializedState, type SerializedShowState } from '@/lib/serialization';

export type ClientMode = 'controller' | 'projector' | 'audience';

export interface ShowStateHookReturn {
  state: ControllerClientState | ProjectorClientState | AudienceClientState | null;
  fullState: ShowState | null;
  sendCommand: (command: ConductorCommand) => void;
  isLoading: boolean;
}

export function useShowState(
  socket: Socket | null,
  mode: ClientMode,
  userId: UserId | null
): ShowStateHookReturn {
  const [fullState, setFullState] = useState<ShowState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Listen to socket events
  useEffect(() => {
    if (!socket) return;

    // Single state sync handler - receives full state on every update
    // This eliminates the possibility of state drift between client and server
    const handleStateSync = (data: ShowState | SerializedShowState) => {
      // Deserialize if it's serialized format (controller mode)
      const state = isSerializedState(data) ? deserializeState(data) : data;
      console.log('[State] Received state sync, version:', state.version);
      setFullState(state);
      updateLastVersion(state.version);
      setIsLoading(false);
    };

    socket.on('state_sync', handleStateSync);

    return () => {
      socket.off('state_sync', handleStateSync);
    };
  }, [socket]);

  // Send command to server
  const sendCommand = useCallback(
    (command: ConductorCommand) => {
      if (!socket || !socket.connected) {
        console.warn('[State] Cannot send command - not connected:', command.type);
        return;
      }

      console.log('[State] Sending command:', command.type);
      socket.emit('command', command);
    },
    [socket]
  );

  // Transform full state into client-specific state
  const clientState = fullState ? transformStateForClient(fullState, mode, userId) : null;

  return {
    state: clientState,
    fullState,
    sendCommand,
    isLoading,
  };
}

/**
 * Transform full state into client-specific view
 */
function transformStateForClient(
  state: ShowState,
  mode: ClientMode,
  userId: UserId | null
): ControllerClientState | ProjectorClientState | AudienceClientState {
  if (mode === 'controller') {
    return transformForController(state);
  } else if (mode === 'projector') {
    return transformForProjector(state);
  } else {
    return transformForAudience(state, userId);
  }
}

function transformForController(state: ShowState): ControllerClientState {
  // Controller sees everything
  const factionCounts: [number, number, number, number] = [0, 0, 0, 0];

  // State is properly deserialized, users is a Map
  state.users.forEach((user) => {
    if (user.faction !== null) {
      factionCounts[user.faction]++;
    }
  });

  return {
    showPhase: state.phase,
    currentRowIndex: state.currentRowIndex,
    rows: state.rows,
    factions: Array.from(state.factions) as any,
    paths: state.paths,
    userCount: state.users.size,
    factionCounts,
    config: state.config,
  };
}

function transformForProjector(state: ShowState): ProjectorClientState {
  return {
    showPhase: state.phase,
    currentRowIndex: state.currentRowIndex,
    rows: state.rows.map((row) => ({
      index: row.index,
      phase: row.phase,
      committedOption: row.committedOption,
      currentAuditionIndex: row.currentAuditionIndex,
    })),
    paths: state.paths,
    factions: state.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
    lastReveal: null, // TODO: Track last reveal
    tiebreaker: null, // TODO: Track tiebreaker state
    currentFinaleTimeline: null, // TODO: Track finale timeline
    finalePhase: null,
  };
}

function transformForAudience(state: ShowState, userId: UserId | null): AudienceClientState {
  const user = userId ? state.users.get(userId) : null;
  const currentRow = state.rows[state.currentRowIndex];

  // Find user's vote for current row
  let myVote = null;
  if (userId && currentRow) {
    const vote = state.votes.find(
      (v) => v.userId === userId && v.rowIndex === currentRow.index && v.attempt === currentRow.attempts
    );
    if (vote) {
      myVote = {
        factionVote: vote.factionVote,
        personalVote: vote.personalVote,
      };
    }
  }

  const personalTree = userId ? state.personalTrees.get(userId) : null;

  return {
    userId: userId || '',
    seatId: user?.seatId || null,
    faction: user?.faction || null,
    showPhase: state.phase,
    figTreeResponseSubmitted: !!personalTree?.figTreeResponse,
    currentRow: currentRow
      ? {
          index: currentRow.index,
          phase: currentRow.phase,
          options: currentRow.options,
          currentAuditionIndex: currentRow.currentAuditionIndex,
        }
      : null,
    myVote,
    coupMeter: null, // TODO: Track faction coup meter
    canCoup: false, // TODO: Check if user's faction can coup
  };
}

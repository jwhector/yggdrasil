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
import { getCoupProgress, canFactionCoup } from '@/conductor/coup';

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
  const [clientState, setClientState] = useState<ControllerClientState | ProjectorClientState | AudienceClientState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Listen to socket events
  useEffect(() => {
    if (!socket) return;

    // Single state sync handler
    // Controller receives full serialized state
    // Projector/Audience receive pre-filtered client states from server
    const handleStateSync = (data: any) => {
      // Controller mode: deserialize full state and transform
      if (isSerializedState(data)) {
        const state = deserializeState(data);
        console.log('[State] Received full state, version:', state.version);
        setFullState(state);
        setClientState(transformStateForClient(state, mode, userId));
        updateLastVersion(state.version);
      } else {
        // Projector/Audience mode: server already filtered the state
        console.log('[State] Received filtered client state');
        setFullState(null);
        setClientState(data);
        // Update version if available
        if (data.version !== undefined) {
          updateLastVersion(data.version);
        }
      }
      setIsLoading(false);
    };

    socket.on('state_sync', handleStateSync);

    return () => {
      socket.off('state_sync', handleStateSync);
    };
  }, [socket, mode, userId]);

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
      label: row.label,
      type: row.type,
      options: row.options,
      phase: row.phase,
      committedOption: row.committedOption,
      currentAuditionIndex: row.currentAuditionIndex,
      attempts: row.attempts,
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

  // Calculate coup meter and eligibility
  let coupMeter: number | null = null;
  let canCoup = false;

  if (user?.faction !== null && user?.faction !== undefined && currentRow) {
    const faction = state.factions[user.faction];
    canCoup = canFactionCoup(faction, currentRow.phase);

    // Only show coup meter during coup_window
    if (currentRow.phase === 'coup_window') {
      coupMeter = getCoupProgress(faction, state);
    }
  }

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
    coupMeter,
    canCoup,
  };
}

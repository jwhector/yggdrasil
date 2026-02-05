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

    // State sync - full state update
    const handleStateSync = (data: ShowState | SerializedShowState) => {
      // Deserialize if it's serialized format (controller mode)
      const state = isSerializedState(data) ? deserializeState(data) : data;
      console.log('[State] Received state sync, version:', state.version);
      setFullState(state);
      updateLastVersion(state.version);
      setIsLoading(false);
    };

    // Incremental events that update state
    // ROW phase changed (auditioning, voting, revealing, coup_window, committed)
    const handleRowPhaseChanged = (data: { row: number; phase: any }) => {
      setFullState((prev) => {
        if (!prev) return prev;
        const updatedRows = [...prev.rows];
        if (updatedRows[data.row]) {
          updatedRows[data.row] = { ...updatedRows[data.row], phase: data.phase };
        }
        const updated = { ...prev, rows: updatedRows, version: prev.version + 1 };
        updateLastVersion(updated.version);
        return updated;
      });
    };

    // SHOW phase changed (lobby, assigning, running, finale, paused, ended)
    const handleShowPhaseChanged = (data: { phase: any }) => {
      setFullState((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, phase: data.phase, version: prev.version + 1 };
        updateLastVersion(updated.version);
        return updated;
      });
    };

    const handleRowCommitted = (data: { row: number; optionId: string; popularOptionId: string }) => {
      setFullState((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, version: prev.version + 1 };
        // Update the committed option for the row
        if (updated.rows[data.row]) {
          updated.rows[data.row].committedOption = data.optionId;
        }
        updateLastVersion(updated.version);
        return updated;
      });
    };

    const handlePathsUpdated = (data: { paths: any }) => {
      setFullState((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, paths: data.paths, version: prev.version + 1 };
        updateLastVersion(updated.version);
        return updated;
      });
    };

    const handleUserJoined = () => {
      setFullState((prev) => {
        if (!prev) return prev;
        return { ...prev, version: prev.version + 1 };
      });
    };

    const handleUserLeft = () => {
      setFullState((prev) => {
        if (!prev) return prev;
        return { ...prev, version: prev.version + 1 };
      });
    };

    const handleFactionsAssigned = () => {
      setFullState((prev) => {
        if (!prev) return prev;
        return { ...prev, version: prev.version + 1 };
      });
    };

    // Register event listeners
    socket.on('state_sync', handleStateSync);
    socket.on('row_phase_changed', handleRowPhaseChanged);
    socket.on('show_phase_changed', handleShowPhaseChanged);
    socket.on('row_committed', handleRowCommitted);
    socket.on('paths_updated', handlePathsUpdated);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('factions_assigned', handleFactionsAssigned);

    return () => {
      socket.off('state_sync', handleStateSync);
      socket.off('row_phase_changed', handleRowPhaseChanged);
      socket.off('show_phase_changed', handleShowPhaseChanged);
      socket.off('row_committed', handleRowCommitted);
      socket.off('paths_updated', handlePathsUpdated);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('factions_assigned', handleFactionsAssigned);
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

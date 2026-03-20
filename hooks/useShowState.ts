/**
 * useShowState Hook
 *
 * Receives state_sync from the server and provides typed state to components.
 *
 * Design: The server pre-filters state per client mode (filterStateForClient in
 * server/socket.ts). Audience and projector receive plain JSON — no client-side
 * transforms needed. Only the controller receives serialized full state (Maps as
 * arrays) that must be deserialized.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  ShowState,
  ConductorCommand,
  UserId,
  AudienceClientState,
  AudienceAttemptView,
  ProjectorClientState,
} from '@/conductor/types';
import { updateLastVersion } from '@/lib/storage';
import { deserializeState, isSerializedState, type SerializedShowState } from '@/lib/serialization';

export type ClientMode = 'controller' | 'projector' | 'audience';

const DARK_PHASES = new Set(['lobby', 'opener', 'attempt_story', 'ended']);

// ---------------------------------------------------------------------------
// Return type interfaces
// ---------------------------------------------------------------------------

export interface AudienceStateReturn {
  state: AudienceClientState | null;
  isLoading: boolean;
  sendCommand: (command: ConductorCommand) => void;
  currentAttempt: AudienceAttemptView | null;
  isVotingActive: boolean;
  isDark: boolean;
}

export interface ProjectorStateReturn {
  state: ProjectorClientState | null;
  isLoading: boolean;
  sendCommand: (command: ConductorCommand) => void;
  currentAttempt: ProjectorClientState['attempts'][number] | null;
  isVotingActive: boolean;
  isDark: boolean;
}

export interface ControllerStateReturn {
  state: SerializedShowState | null;
  fullState: ShowState | null;
  isLoading: boolean;
  sendCommand: (command: ConductorCommand) => void;
}

// ---------------------------------------------------------------------------
// Overloads
// ---------------------------------------------------------------------------

export function useShowState(
  socket: Socket | null,
  mode: 'audience',
  userId: UserId | null
): AudienceStateReturn;

export function useShowState(
  socket: Socket | null,
  mode: 'projector',
  userId: UserId | null
): ProjectorStateReturn;

export function useShowState(
  socket: Socket | null,
  mode: 'controller',
  userId: UserId | null
): ControllerStateReturn;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function useShowState(
  socket: Socket | null,
  mode: ClientMode,
  _userId: UserId | null
): AudienceStateReturn | ProjectorStateReturn | ControllerStateReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rawState, setRawState] = useState<any>(null);
  const [fullState, setFullState] = useState<ShowState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!socket) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleStateSync = (data: any) => {
      if (mode === 'controller' && isSerializedState(data)) {
        const deserialized = deserializeState(data);
        setFullState(deserialized);
        setRawState(data);
        updateLastVersion(deserialized.version);
      } else {
        // Audience and projector receive pre-filtered state — store as-is
        setRawState(data);
        setFullState(null);
        if (typeof data?.version === 'number') {
          updateLastVersion(data.version);
        }
      }
      setIsLoading(false);
    };

    socket.on('state_sync', handleStateSync);
    return () => { socket.off('state_sync', handleStateSync); };
  }, [socket, mode]);

  const sendCommand = useCallback(
    (command: ConductorCommand) => {
      if (!socket?.connected) {
        console.warn('[State] Cannot send command — not connected:', command.type);
        return;
      }
      socket.emit('command', command);
    },
    [socket]
  );

  if (mode === 'audience') {
    const state = rawState as AudienceClientState | null;
    const currentAttempt = state?.currentAttempt ?? null;
    const isVotingActive = currentAttempt?.currentLayerPhase === 'auditioning';
    const isDark = !state || DARK_PHASES.has(state.phase);
    return { state, isLoading, sendCommand, currentAttempt, isVotingActive, isDark };
  }

  if (mode === 'projector') {
    const state = rawState as ProjectorClientState | null;
    const currentAttempt = state
      ? (state.attempts[state.currentAttemptIndex] ?? null)
      : null;
    const isVotingActive = currentAttempt?.currentLayerPhase === 'auditioning';
    const isDark = !state || DARK_PHASES.has(state.phase);
    return { state, isLoading, sendCommand, currentAttempt, isVotingActive, isDark };
  }

  // controller
  return { state: rawState, fullState, isLoading, sendCommand };
}

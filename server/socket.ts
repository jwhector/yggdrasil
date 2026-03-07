/**
 * Socket.IO Event Handlers
 *
 * Manages WebSocket connections, rooms, and real-time events.
 * Acts as the I/O layer wrapping the pure Conductor logic.
 *
 * Room structure:
 * - 'audience'    — All audience members
 * - 'projector'   — Projector display
 * - 'controller'  — Performer controller
 *
 * High-frequency channels (NOT via state_sync):
 * - 'convergence_update' → audience + projector at ~5 Hz (during consensus rounds)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ShowState,
  ConductorCommand,
  ConductorEvent,
  UserId,
  AttemptState,
  LayerConfig,
} from '../conductor/types';
import { processCommand } from '../conductor';
import type { PersistenceLayer } from './persistence';
import { serializeState } from '../lib/serialization';

// ============================================================================
// Types
// ============================================================================

type ClientMode = 'audience' | 'projector' | 'controller';

interface ClientHeartbeat {
  socketId: string;
  userId: UserId | null;
  lastPing: number;
  missedPongs: number;
}

// ============================================================================
// Constants
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 15000;            // Ping every 15 seconds
const HEARTBEAT_TIMEOUT_MS = 5000;              // Client must respond within 5 seconds
const MAX_MISSED_HEARTBEATS = 2;                // 2 missed = mark disconnected
const CONVERGENCE_BROADCAST_INTERVAL_MS = 200;  // ~5 Hz

// ============================================================================
// Setup
// ============================================================================

/**
 * Setup Socket.IO event handlers.
 *
 * @param io           - Socket.IO server instance
 * @param getState     - Returns current show state
 * @param setState     - Updates state and fires hooks (audio, timing)
 * @param persistence  - Persistence layer for saving data
 * @param createNewShow - Factory for creating a fresh show (optional)
 */
export function setupSocketHandlers(
  io: SocketIOServer,
  getState: () => ShowState,
  setState: (state: ShowState, events: ConductorEvent[]) => void,
  persistence: PersistenceLayer,
  createNewShow?: () => ShowState
): void {
  // Heartbeat tracking
  const heartbeats = new Map<string, ClientHeartbeat>();

  // ============================================================================
  // Heartbeat monitor
  // ============================================================================

  const heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [socketId, heartbeat] of heartbeats.entries()) {
      const timeSinceLastPong = now - heartbeat.lastPing;

      if (timeSinceLastPong > HEARTBEAT_TIMEOUT_MS) {
        heartbeat.missedPongs++;

        if (heartbeat.missedPongs >= MAX_MISSED_HEARTBEATS) {
          console.log(`[Heartbeat] ${socketId} missed ${heartbeat.missedPongs} heartbeats, disconnecting`);
          const socket = io.sockets.sockets.get(socketId);

          if (socket && heartbeat.userId) {
            handleUserDisconnect(socket, heartbeat.userId);
          }

          heartbeats.delete(socketId);
        }
      }
    }

    // Ping all connected clients
    io.emit('ping', { timestamp: now });
  }, HEARTBEAT_INTERVAL_MS);

  // ============================================================================
  // Convergence broadcast (throttled ~5 Hz during active consensus rounds)
  // ============================================================================

  const convergenceInterval = setInterval(() => {
    const state = getState();
    if (
      state.phase === 'finale_consensus' &&
      state.finaleState?.consensusGame.active
    ) {
      const value = state.finaleState.consensusGame.convergenceValue;
      io.to('audience').emit('convergence_update', { value });
      io.to('projector').emit('convergence_update', { value });
    }
  }, CONVERGENCE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Cleanup
  // ============================================================================

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    clearInterval(convergenceInterval);
  });

  // ============================================================================
  // Helpers
  // ============================================================================

  async function handleUserDisconnect(socket: Socket, userId: UserId): Promise<void> {
    const state = getState();
    const user = state.users.get(userId);

    if (user) {
      console.log(`[Socket] User disconnected: ${userId} (seat: ${user.seatId})`);

      const events = processCommand(state, { type: 'USER_DISCONNECT', userId });
      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    }

    heartbeats.delete(socket.id);
  }

  // ============================================================================
  // Connection handler
  // ============================================================================

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    heartbeats.set(socket.id, {
      socketId: socket.id,
      userId: null,
      lastPing: Date.now(),
      missedPongs: 0,
    });

    // ------------------------------------------------------------------
    // Pong (heartbeat response)
    // ------------------------------------------------------------------
    socket.on('pong', () => {
      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat) {
        heartbeat.lastPing = Date.now();
        heartbeat.missedPongs = 0;
      }
    });

    // ------------------------------------------------------------------
    // join — first connection or re-join after page reload
    //
    // Payload: { userId?, seatId?, mode: 'audience' | 'projector' | 'controller' }
    // ------------------------------------------------------------------
    socket.on('join', async (data: { userId?: UserId; mode: ClientMode; seatId?: string }) => {
      console.log(`[Socket] Join: mode=${data.mode} userId=${data.userId ?? '(new)'}`);

      const state = getState();
      socket.join(data.mode);

      if (data.mode === 'audience') {
        const userId = data.userId || `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const isReconnect = state.users.has(userId);

        // USER_CONNECT handles both new users and reconnects
        const events = processCommand(state, {
          type: 'USER_CONNECT',
          userId,
          seatId: data.seatId,
        });

        setState(state, events);
        persistence.saveState(state);

        const heartbeat = heartbeats.get(socket.id);
        if (heartbeat) heartbeat.userId = userId;
        (socket as any).userId = userId;

        if (!isReconnect) {
          // New user: send identity first
          socket.emit('identity', { userId });

          // Save to DB
          const user = state.users.get(userId);
          if (user) persistence.saveUser(user, state.id);
        }

        // Always send full state sync
        socket.emit('state_sync', filterStateForClient(state, 'audience', userId));

        await broadcastEvents(io, events, state);
      } else {
        // Projector or controller: just send current state
        socket.emit('state_sync', filterStateForClient(state, data.mode));
      }
    });

    // ------------------------------------------------------------------
    // reconnect — explicit reconnect with version check
    //
    // Payload: { userId, showId, lastVersion }
    // ------------------------------------------------------------------
    socket.on('reconnect', async (data: { userId: UserId; showId: string; lastVersion: number }) => {
      console.log(`[Socket] Reconnect: userId=${data.userId} lastVersion=${data.lastVersion}`);

      const state = getState();

      if (!state.users.has(data.userId)) {
        socket.emit('error', { message: 'User not found — please rejoin' });
        return;
      }

      const events = processCommand(state, {
        type: 'USER_CONNECT',
        userId: data.userId,
      });

      setState(state, events);
      persistence.saveState(state);

      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat) heartbeat.userId = data.userId;
      (socket as any).userId = data.userId;

      socket.join('audience');

      // Full state sync (client may have missed changes while offline)
      socket.emit('state_sync', filterStateForClient(state, 'audience', data.userId));

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // vote — binary A/B vote for current layer (song-building)
    //
    // Payload: { choice: 'A' | 'B' }
    // Vote is final — no changing during window (blind vote mechanic).
    // userId taken from socket session (not payload) for security.
    // ------------------------------------------------------------------
    socket.on('vote', async (data: { choice: 'A' | 'B' }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] Vote rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] Vote from ${userId}: ${data.choice}`);

      const state = getState();

      // Reject if user already voted this layer (enforce blind vote / no-change)
      const attempt = state.attempts[state.currentAttemptIndex];
      const alreadyVoted = attempt?.votes.some(
        v => v.userId === userId &&
             v.attemptIndex === state.currentAttemptIndex &&
             v.layerIndex === attempt.currentLayerIndex
      );
      if (alreadyVoted) {
        console.warn(`[Socket] Vote rejected: ${userId} already voted this layer`);
        return;
      }

      const events = processCommand(state, {
        type: 'SUBMIT_VOTE',
        userId,
        choice: data.choice,
      });

      setState(state, events);
      persistence.saveState(state);

      // Save vote record to DB for analysis / recovery
      const updatedAttempt = state.attempts[state.currentAttemptIndex];
      const vote = updatedAttempt?.votes.find(
        v => v.userId === userId &&
             v.attemptIndex === state.currentAttemptIndex &&
             v.layerIndex === updatedAttempt.currentLayerIndex
      );
      if (vote) {
        persistence.saveLayerVote(vote, state.id);
      }

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // consensus_vote — audience votes for a fragment during finale consensus
    //
    // Payload: { fragmentId: string }
    // Votes are ephemeral within a round — not persisted to DB.
    // userId taken from socket session (not payload) for security.
    // ------------------------------------------------------------------
    socket.on('consensus_vote', async (data: { fragmentId: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] consensus_vote rejected: no userId on socket');
        return;
      }

      if (typeof data.fragmentId !== 'string' || !data.fragmentId) {
        console.warn(`[Socket] consensus_vote rejected: invalid fragmentId from ${userId}`);
        return;
      }

      console.log(`[Socket] Consensus vote from ${userId}: ${data.fragmentId}`);

      const state = getState();

      const events = processCommand(state, {
        type: 'SUBMIT_CONSENSUS_VOTE',
        userId,
        fragmentId: data.fragmentId,
      });

      setState(state, events);
      // No persistence — consensus votes are ephemeral within a round

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // command — controller sends a ConductorCommand directly
    // ------------------------------------------------------------------
    socket.on('command', async (command: ConductorCommand) => {
      console.log(`[Socket] Command: ${command.type}`);

      // NEW_SHOW is handled at server level (needs I/O to read config)
      if (command.type === 'NEW_SHOW') {
        if (!createNewShow) {
          console.error('[Socket] NEW_SHOW rejected: no createNewShow callback');
          return;
        }
        const newState = createNewShow();
        const events: ConductorEvent[] = [{ type: 'SHOW_PHASE_CHANGED', phase: 'lobby' }];
        setState(newState, events);
        persistence.saveState(newState);
        await broadcastEvents(io, events, newState);
        console.log(`[Socket] New show created: ${newState.id}`);
        return;
      }

      // For commands with a userId field, enforce socket session userId (security)
      let processedCommand = command;
      if ('userId' in command) {
        const socketUserId = (socket as any).userId as UserId | undefined;
        if (!socketUserId) {
          console.warn(`[Socket] ${command.type} rejected: requires userId but socket has none`);
          return;
        }
        processedCommand = { ...command, userId: socketUserId };
      }

      const state = getState();
      const events = processCommand(state, processedCommand);
      setState(state, events);
      persistence.saveState(state);

      // Persist consensus round results when a round ends
      if (processedCommand.type === 'END_CONSENSUS_ROUND') {
        const successEvent = events.find(e => e.type === 'CONSENSUS_ROUND_SUCCESS') as
          | { type: 'CONSENSUS_ROUND_SUCCESS'; fragmentId: string; convergence: number }
          | undefined;
        const failureEvent = events.find(e => e.type === 'CONSENSUS_ROUND_FAILURE') as
          | { type: 'CONSENSUS_ROUND_FAILURE'; highestConvergence: number }
          | undefined;
        const finaleState = state.finaleState;
        if (finaleState) {
          const roundNumber = finaleState.consensusGame.currentRound;
          const threshold = finaleState.consensusGame.threshold;
          if (successEvent) {
            persistence.saveConsensusRound(state.id, roundNumber, successEvent.fragmentId, successEvent.convergence, threshold, true);
          } else if (failureEvent) {
            persistence.saveConsensusRound(state.id, roundNumber, null, failureEvent.highestConvergence, threshold, false);
          }
        }
      }

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // disconnect
    // ------------------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);

      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat?.userId) {
        handleUserDisconnect(socket, heartbeat.userId);
      } else {
        heartbeats.delete(socket.id);
      }
    });
  });
}

// ============================================================================
// Broadcast
// ============================================================================

/**
 * Broadcast full state sync to all clients after every state change.
 *
 * Full-state-sync strategy eliminates state drift between clients and server.
 * Each client type gets a filtered view of the state.
 *
 * Exported for use by timing engine and other server components.
 */
export async function broadcastEvents(
  io: SocketIOServer,
  events: ConductorEvent[],
  state: ShowState
): Promise<void> {
  // Controller gets full serialized state
  io.to('controller').emit('state_sync', filterStateForClient(state, 'controller'));

  // Projector gets public state (no per-user details)
  io.to('projector').emit('state_sync', filterStateForClient(state, 'projector'));

  // Each audience member gets their personalized view
  const audienceSockets = await io.in('audience').fetchSockets();
  for (const socket of audienceSockets) {
    const userId = (socket as any).userId as UserId | undefined;
    if (!userId) continue;

    try {
      socket.emit('state_sync', filterStateForClient(state, 'audience', userId));
    } catch (error) {
      console.error(`[Socket] Error sending state to ${userId}:`, error);
    }
  }

  // Handle special events beyond state sync
  for (const event of events) {
    switch (event.type) {
      case 'FORCE_RECONNECT':
        io.emit('force_reconnect', { reason: event.reason });
        break;

      case 'NPC_MESSAGE':
        io.to('audience').emit('npc_message', { message: event.message });
        io.to('projector').emit('npc_message', { message: event.message });
        break;

      case 'ERROR':
        io.to('controller').emit('error', event);
        console.error('[Conductor Error]:', event.message, (event as any).command?.type);
        break;

      default:
        break;
    }
  }
}

// ============================================================================
// State Filtering
// ============================================================================

/**
 * Filter show state for each client type.
 *
 * Controller: full serialized state (Maps → arrays for JSON compatibility)
 * Projector:  public display state (no per-user data)
 * Audience:   personalized state (their vote, their consensus vote)
 */
export function filterStateForClient(
  state: ShowState,
  mode: ClientMode,
  userId?: UserId
): object {
  switch (mode) {
    // -------------------------------------------------------------------------
    case 'controller':
      return serializeState(state);

    // -------------------------------------------------------------------------
    case 'projector': {
      const fs = state.finaleState;
      return {
        phase: state.phase,
        paused: state.paused,
        version: state.version,
        currentAttemptIndex: state.currentAttemptIndex,
        userCount: state.users.size,
        attempts: state.attempts,
        finaleState: fs ? {
          finalePhase: fs.phase,
          availableFragments: fs.availableFragments,
          lockedFragments: fs.lockedFragments,
          convergenceValue: fs.consensusGame.convergenceValue,
          threshold: fs.consensusGame.threshold,
          roundTimeRemaining: fs.consensusGame.roundTimeRemaining,
          currentRound: fs.consensusGame.currentRound,
          lockedRoles: Array.from(fs.consensusGame.lockedRoles.entries()).map(([layerType, fragmentId]) => ({
            layerType,
            fragmentId,
          })),
          npcMessage: fs.npc.currentMessage,
          mixActiveLayers: Array.from(fs.performerMix.activeLayers.entries()).map(([layerType, fragmentId]) => ({
            layerType,
            fragmentId,
          })),
          mixPendingChanges: fs.performerMix.pendingChanges,
          loopPosition: fs.performerMix.loopPosition,
        } : null,
        config: state.config,
      };
    }

    // -------------------------------------------------------------------------
    case 'audience': {
      if (!userId) throw new Error('userId required for audience state filtering');

      const user = state.users.get(userId);
      if (!user) throw new Error(`User ${userId} not found in state`);

      const attempt: AttemptState | null = state.attempts[state.currentAttemptIndex] ?? null;

      // Find this user's vote on the current layer
      let myVote: 'A' | 'B' | null = null;
      if (attempt) {
        const found = attempt.votes.find(
          v => v.userId === userId &&
               v.attemptIndex === state.currentAttemptIndex &&
               v.layerIndex === attempt.currentLayerIndex
        );
        if (found) myVote = found.choice;
      }

      // Current layer config (for label display)
      const currentLayerConfig: LayerConfig | null =
        attempt?.layerPlan[attempt.currentLayerIndex] ?? null;

      // Finale personalization
      let myFinale: object | null = null;
      const fs = state.finaleState;
      if (fs) {
        // Find this user's consensus vote (null if not voted this round)
        const myVoteFinale: string | null = fs.consensusGame.votes.get(userId) ?? null;

        // Mark available fragments as locked if their role is already locked
        const lockedRoleTypes = new Set(fs.consensusGame.lockedRoles.keys());
        const availableWithLocked = fs.availableFragments.map(fragment => ({
          fragment,
          locked: lockedRoleTypes.has(fragment.layerType),
        }));

        // Flatten lockedRoles map to array for JSON transport
        const lockedRoles: Array<{ layerType: string; fragmentId: string }> =
          Array.from(fs.consensusGame.lockedRoles.entries()).map(([layerType, fragmentId]) => ({
            layerType,
            fragmentId,
          }));

        // Flatten performerMix activeLayers for JSON transport
        const mixActiveLayers: Array<{ layerType: string; fragmentId: string | null }> =
          Array.from(fs.performerMix.activeLayers.entries()).map(([layerType, fragmentId]) => ({
            layerType,
            fragmentId,
          }));

        myFinale = {
          finalePhase: fs.phase,
          availableFragments: availableWithLocked,
          myVote: myVoteFinale,
          convergenceValue: fs.consensusGame.convergenceValue,
          threshold: fs.consensusGame.threshold,
          roundTimeRemaining: fs.consensusGame.roundTimeRemaining,
          currentRound: fs.consensusGame.currentRound,
          lockedRoles,
          npcMessage: fs.npc.currentMessage,
          mixActiveLayers,
        };
      }

      return {
        userId,
        seatId: user.seatId,
        phase: state.phase,
        paused: state.paused,
        version: state.version,
        currentAttemptIndex: state.currentAttemptIndex,
        currentAttempt: attempt ? {
          index: attempt.index,
          chapter: attempt.chapter,
          status: attempt.status,
          currentLayerIndex: attempt.currentLayerIndex,
          currentLayerPhase: attempt.currentLayerPhase,
          layerCount: attempt.layerPlan.length,
          currentLayerConfig,
          layerResults: attempt.layerResults,
          myVote,
          currentAuditionOption: attempt.currentAuditionOption,
          auditionLoopIndex: attempt.auditionLoopIndex,
          auditionTotalLoops: (state.config.timing.auditionsPerLayer ?? 2) * 2,
          healthBar: {
            current: attempt.healthBar.current,
            drainFactor: attempt.healthBar.drainFactor,
            history: attempt.healthBar.history,
          },
          currentVoteResult: attempt.currentVoteResult
            ? { winner: attempt.currentVoteResult.winner, consensus: attempt.currentVoteResult.consensus }
            : null,
          currentDrain: attempt.currentDrain
            ? { drainAmount: attempt.currentDrain.drainAmount, healthAfter: attempt.currentDrain.healthAfter }
            : null,
        } : null,
        myFinale,
        config: {
          lobby: state.config.lobby,
        },
      };
    }

    default:
      return serializeState(state);
  }
}

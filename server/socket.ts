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
 * - 'group_update' → audience + projector at ~2 Hz (during assembly phase)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ShowState,
  ConductorCommand,
  ConductorEvent,
  UserId,
  AttemptState,
  LayerConfig,
  LayerType,
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
const GROUP_UPDATE_BROADCAST_INTERVAL_MS = 500; // ~2 Hz during assembly

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
  // Group update broadcast (throttled ~2 Hz during assembly phase)
  // ============================================================================

  const groupUpdateInterval = setInterval(() => {
    const state = getState();
    if (state.phase === 'finale_assembly' && state.finaleState?.phase === 'assembly') {
      const groupSizes = Array.from(state.finaleState.assembly.groups.entries())
        .map(([layerType, members]) => ({ layerType, count: members.length }));
      const undecidedCount = state.finaleState.assembly.undecidedUsers.length;
      io.to('audience').emit('group_update', { groupSizes, undecidedCount });
      io.to('projector').emit('group_update', { groupSizes, undecidedCount });
    }
  }, GROUP_UPDATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Cleanup
  // ============================================================================

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    clearInterval(groupUpdateInterval);
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
      // const attempt = state.attempts[state.currentAttemptIndex];
      // const alreadyVoted = attempt?.votes.some(
      //   v => v.userId === userId &&
      //        v.attemptIndex === state.currentAttemptIndex &&
      //        v.layerIndex === attempt.currentLayerIndex
      // );
      // if (alreadyVoted) {
      //   console.warn(`[Socket] Vote rejected: ${userId} already voted this layer`);
      //   return;
      // }

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
    // join_group — audience selects a layer-type group during assembly
    //
    // Payload: { layerType: LayerType }
    // ------------------------------------------------------------------
    socket.on('join_group', async (data: { layerType: LayerType }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] join_group rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] join_group from ${userId}: ${data.layerType}`);

      const state = getState();
      const events = processCommand(state, { type: 'JOIN_GROUP', userId, layerType: data.layerType });
      setState(state, events);
      persistence.saveState(state);
      persistence.saveGroupAssignment(state.id, userId, data.layerType, false);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // group_vote — audience votes for a fragment within their group
    //
    // Payload: { layerType: LayerType; fragmentId: string }
    // ------------------------------------------------------------------
    socket.on('group_vote', async (data: { layerType: LayerType; fragmentId: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] group_vote rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] group_vote from ${userId}: ${data.layerType} → ${data.fragmentId}`);

      const state = getState();
      const events = processCommand(state, {
        type: 'SUBMIT_GROUP_VOTE',
        userId,
        layerType: data.layerType,
        fragmentId: data.fragmentId,
      });
      setState(state, events);
      persistence.saveState(state);
      persistence.saveGroupVote(state.id, userId, data.layerType, data.fragmentId);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // volunteer_ambassador — audience volunteers as ambassador
    //
    // Payload: { layerType: LayerType }
    // ------------------------------------------------------------------
    socket.on('volunteer_ambassador', async (data: { layerType: LayerType }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] volunteer_ambassador rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] volunteer_ambassador from ${userId}: ${data.layerType}`);

      const state = getState();
      const events = processCommand(state, {
        type: 'VOLUNTEER_AS_AMBASSADOR',
        userId,
        layerType: data.layerType,
      });
      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // altar_lock_in — ambassador confirms lock-in at the altar
    //
    // Payload: { layerType: LayerType }
    // ------------------------------------------------------------------
    socket.on('altar_lock_in', async (data: { layerType: LayerType }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] altar_lock_in rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] altar_lock_in from ${userId}: ${data.layerType}`);

      const state = getState();
      const events = processCommand(state, {
        type: 'ALTAR_LOCK_IN',
        userId,
        layerType: data.layerType,
      });
      setState(state, events);
      persistence.saveState(state);

      const lockEvent = events.find(e => e.type === 'CEREMONY_LAYER_LOCKED') as
        | { type: 'CEREMONY_LAYER_LOCKED'; layerType: LayerType; fragmentId: string }
        | undefined;
      if (lockEvent) {
        persistence.saveCeremonyEvent(state.id, data.layerType, userId, lockEvent.fragmentId, 'locked');
      }

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

      // Persist auto-assigned group members when assembly ends via timer or force
      if (processedCommand.type === 'ASSEMBLY_TIMER_EXPIRED' || processedCommand.type === 'FORCE_END_ASSEMBLY') {
        const assemblyComplete = events.find(e => e.type === 'ASSEMBLY_COMPLETE') as
          | { type: 'ASSEMBLY_COMPLETE'; groups: Map<LayerType, UserId[]>; emptyGroups: LayerType[] }
          | undefined;
        if (assemblyComplete) {
          for (const [layerType, members] of assemblyComplete.groups) {
            for (const memberId of members) {
              persistence.saveGroupAssignment(state.id, memberId, layerType, true);
            }
          }
        }
      }

      // Persist ceremony lock-in for controller-driven FORCE_LOCK_IN
      if (processedCommand.type === 'FORCE_LOCK_IN') {
        const lockEvent = events.find(e => e.type === 'CEREMONY_LAYER_LOCKED') as
          | { type: 'CEREMONY_LAYER_LOCKED'; layerType: LayerType; fragmentId: string }
          | undefined;
        if (lockEvent) {
          persistence.saveCeremonyEvent(state.id, lockEvent.layerType, null, lockEvent.fragmentId, 'locked');
        }
      }

      // Persist ceremony forfeit for controller-driven FORFEIT_LAYER
      if (processedCommand.type === 'FORFEIT_LAYER') {
        const forfeitEvent = events.find(e => e.type === 'CEREMONY_LAYER_SKIPPED') as
          | { type: 'CEREMONY_LAYER_SKIPPED'; layerType: LayerType }
          | undefined;
        if (forfeitEvent) {
          persistence.saveCeremonyEvent(state.id, forfeitEvent.layerType, null, null, 'forfeited');
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

      case 'AMBASSADOR_CALLED': {
        // Emit altar_ready only to the called ambassador's socket
        const calledSockets = await io.in('audience').fetchSockets();
        for (const s of calledSockets) {
          if ((s as any).userId === event.userId) {
            s.emit('altar_ready', { layerType: event.layerType });
            break;
          }
        }
        // Notify all about who was called (for projector + audience awareness)
        io.to('projector').emit('ambassador_called', { layerType: event.layerType, userId: event.userId });
        io.to('audience').emit('ambassador_called', { layerType: event.layerType, userId: event.userId });
        break;
      }

      case 'CEREMONY_LAYER_LOCKED':
        io.to('audience').emit('altar_confirmed', { layerType: event.layerType, fragmentId: event.fragmentId });
        io.to('projector').emit('altar_confirmed', { layerType: event.layerType, fragmentId: event.fragmentId });
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
          // Assembly
          groupSizes: Array.from(fs.assembly.groups.entries())
            .map(([layerType, members]) => ({ layerType, count: members.length })),
          undecidedCount: fs.assembly.undecidedUsers.length,
          assemblyTimerRemaining: fs.assembly.timerRemaining,
          // Deliberation
          groupVoteDistributions: Array.from(fs.deliberation.groupVotes.entries()).map(([layerType, votes]) => {
            const counts = new Map<string, number>();
            for (const fId of votes.values()) counts.set(fId, (counts.get(fId) ?? 0) + 1);
            return {
              layerType,
              votes: Array.from(counts.entries()).map(([fragmentId, count]) => ({ fragmentId, count })),
            };
          }),
          chosenFragments: Array.from(fs.deliberation.chosenFragments.entries())
            .map(([layerType, fragmentId]) => ({ layerType, fragmentId })),
          ambassadors: Array.from(fs.deliberation.ambassadors.entries())
            .map(([layerType, userId]) => ({ layerType, userId })),
          deliberationTimerRemaining: fs.deliberation.timerRemaining,
          // Ceremony
          ceremonyLayerOrder: fs.ceremony.layerOrder,
          ceremonyLockedLayers: Array.from(fs.ceremony.lockedLayers.entries())
            .map(([layerType, fragmentId]) => ({ layerType, fragmentId })),
          ceremonyForfeitedLayers: fs.ceremony.forfeitedLayers,
          currentCeremonyLayer: fs.ceremony.currentIndex >= 0
            ? (fs.ceremony.layerOrder[fs.ceremony.currentIndex] ?? null)
            : null,
          currentAmbassador: fs.ceremony.currentAmbassador,
          ceremonyComplete: fs.ceremony.ceremonyComplete,
          // NPC
          npcMessage: fs.npc.currentMessage,
          // Performer mix
          mixActiveLayers: Array.from(fs.performerMix.activeLayers.entries())
            .map(([layerType, fragmentId]) => ({ layerType, fragmentId })),
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
        // Determine user's group assignment
        let myGroup: LayerType | null = null;
        for (const [layerType, members] of fs.assembly.groups) {
          if (members.includes(userId)) { myGroup = layerType; break; }
        }

        // All group sizes
        const groupSizes = Array.from(fs.assembly.groups.entries())
          .map(([layerType, members]) => ({ layerType, count: members.length }));

        // Deliberation: fragments available to user's group
        const myGroupFragments = myGroup
          ? fs.availableFragments.filter(f => f.layerType === myGroup)
          : [];

        // Vote counts for user's group
        const groupVoteCounts: Array<{ fragmentId: string; count: number }> = [];
        if (myGroup) {
          const votes = fs.deliberation.groupVotes.get(myGroup);
          if (votes) {
            const counts = new Map<string, number>();
            for (const fId of votes.values()) counts.set(fId, (counts.get(fId) ?? 0) + 1);
            for (const [fragmentId, count] of counts) groupVoteCounts.push({ fragmentId, count });
          }
        }

        // User's own vote in deliberation
        const myGroupVote = myGroup
          ? (fs.deliberation.groupVotes.get(myGroup)?.get(userId) ?? null)
          : null;

        // Chosen fragment for user's group
        const chosenFragment = myGroup
          ? (fs.deliberation.chosenFragments.get(myGroup) ?? null)
          : null;

        // Ambassador volunteer status
        const isAmbassadorVolunteer = myGroup
          ? (fs.deliberation.ambassadorVolunteers.get(myGroup)?.includes(userId) ?? false)
          : false;

        // Selected ambassador for user's group
        const myAmbassadorStatus = myGroup
          ? (fs.deliberation.ambassadors.get(myGroup) ?? null)
          : null;

        // Ceremony progress for display
        const ceremonyProgress = fs.ceremony.layerOrder.map(lt => {
          if (fs.ceremony.lockedLayers.has(lt)) return { layerType: lt, status: 'locked' as const };
          if (fs.ceremony.forfeitedLayers.includes(lt)) return { layerType: lt, status: 'forfeited' as const };
          const currentLayer = fs.ceremony.currentIndex >= 0
            ? fs.ceremony.layerOrder[fs.ceremony.currentIndex]
            : null;
          if (currentLayer === lt) return { layerType: lt, status: 'current' as const };
          return { layerType: lt, status: 'upcoming' as const };
        });

        const isCurrentAmbassador = fs.ceremony.currentAmbassador === userId;
        const altarReady = isCurrentAmbassador && fs.ceremony.altarReady;

        // Performer mix layers
        const mixActiveLayers = Array.from(fs.performerMix.activeLayers.entries())
          .map(([layerType, fragmentId]) => ({ layerType, fragmentId }));

        myFinale = {
          finalePhase: fs.phase,
          myGroup,
          groupSizes,
          assemblyTimerRemaining: fs.assembly.timerRemaining,
          myGroupFragments,
          groupVoteCounts,
          myGroupVote,
          chosenFragment,
          isAmbassadorVolunteer,
          myAmbassadorStatus,
          deliberationTimerRemaining: fs.deliberation.timerRemaining,
          volunteerTimerRemaining: fs.deliberation.volunteerTimerRemaining,
          ceremonyProgress,
          isCurrentAmbassador,
          altarReady,
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
          auditionTotalLoops: (state.config.attempts[state.currentAttemptIndex]?.auditionCycles?.[attempt.currentLayerIndex] ?? 1) * 2,
          currentVoteResult: attempt.currentVoteResult
            ? { winner: attempt.currentVoteResult.winner, winningProportion: attempt.currentVoteResult.consensus }
            : null,
          lastThresholdCheck: (() => {
            const lr = attempt.layerResults.find(r => r.layerIndex === attempt.currentLayerIndex);
            return lr && lr.passed !== null
              ? { winningProportion: lr.winningProportion!, threshold: lr.thresholdRequired!, passed: lr.passed }
              : null;
          })(),
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

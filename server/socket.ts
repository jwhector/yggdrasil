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
 * - 'group_update' → audience + projector at ~2 Hz (during assignment phase)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ShowState,
  ConductorCommand,
  ConductorEvent,
  UserId,
  AttemptState,
  AssignedThought,
  V32LayerConfig,
} from '../conductor/types';
import { processCommand } from '../conductor';
import { assignThoughts, findThoughtsConfig } from '../conductor/intrusive-thoughts';
import type { PersistenceLayer } from './persistence';
import type { AudioRouter } from './audio-router';
import { serializeState } from '../lib/serialization';

// ============================================================================
// Types
// ============================================================================

type ClientMode = 'audience' | 'projector' | 'controller' | 'osc-bridge';

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
const GROUP_UPDATE_BROADCAST_INTERVAL_MS = 500; // ~2 Hz during assignment
const MIX_STATE_BROADCAST_INTERVAL_MS = 250;    // ~4 Hz during live mix

// ============================================================================
// Intrusive thoughts — server-side state
// ============================================================================

/** Active thoughts for the current reveal. Cleared on layer/attempt change. */
let activeThoughts: AssignedThought[] = [];

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
 * @param audioRouter   - Audio router for direct async operations (e.g. master panic)
 */
export function setupSocketHandlers(
  io: SocketIOServer,
  getState: () => ShowState,
  setState: (state: ShowState, events: ConductorEvent[]) => void,
  persistence: PersistenceLayer,
  createNewShow?: () => ShowState,
  audioRouter?: AudioRouter,
  onBridgeConnect?: (socket: Socket) => () => void,
  getLoopPosition?: () => number,
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
  // Group update broadcast (throttled ~2 Hz during assignment phase)
  // ============================================================================

  const groupUpdateInterval = setInterval(() => {
    const state = getState();
    if (state.phase === 'finale_assignment' && state.finaleState?.phase === 'assignment') {
      const groupSizes = Array.from(state.finaleState.assignment.groups.entries())
        .map(([granularType, members]) => ({ granularType, count: members.length }));
      io.to('audience').emit('group_update', { groupSizes });
      io.to('projector').emit('group_update', { groupSizes });
    }
  }, GROUP_UPDATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Mix state broadcast (throttled ~4 Hz during live mix phase)
  // ============================================================================

  const mixStateBroadcastInterval = setInterval(async () => {
    const state = getState();
    if (state.phase !== 'finale_live_mix' || !state.finaleState || state.finaleState.phase !== 'live_mix') return;

    const fs = state.finaleState;

    // Per-type active fragments (shared with all clients)
    const activeFragments = Array.from(fs.liveMix.activeFragments.entries())
      .map(([granularType, fragmentId]) => ({ granularType, fragmentId }));

    // Per-type vote distributions
    const voteDistributions = Array.from(fs.liveMix.votes.entries()).map(([granularType, userVotes]) => {
      const counts = new Map<string, number>();
      for (const vote of userVotes.values()) counts.set(vote.fragmentId, (counts.get(vote.fragmentId) ?? 0) + 1);
      return {
        granularType,
        votes: Array.from(counts.entries()).map(([fragmentId, count]) => ({ fragmentId, count })),
      };
    });

    // Projector gets full data
    io.to('projector').emit('mix_state', {
      activeFragments,
      voteDistributions,
      lockedTypes: fs.liveMix.lockedTypes,

      loopPosition: getLoopPosition ? getLoopPosition() : fs.liveMix.loopPosition,
    });

    // Controller gets full data
    io.to('controller').emit('mix_state', {
      activeFragments,
      voteDistributions,
      lockedTypes: fs.liveMix.lockedTypes,

      loopPosition: getLoopPosition ? getLoopPosition() : fs.liveMix.loopPosition,
    });

    // Each audience member gets: full active fragments, but only detailed votes for their own type
    const audienceSockets = await io.in('audience').fetchSockets();
    for (const socket of audienceSockets) {
      const userId = (socket as any).userId as UserId | undefined;
      if (!userId) continue;

      // Find user's assigned type
      let myType: string | null = null;
      for (const [gt, members] of fs.assignment.groups) {
        if (members.includes(userId)) { myType = gt; break; }
      }

      const myVoteDistribution = myType
        ? voteDistributions.find(d => d.granularType === myType)?.votes ?? []
        : [];

      socket.emit('mix_state', {
        activeFragments,
        myVoteDistribution,
        lockedTypes: fs.liveMix.lockedTypes,
  
      });
    }
  }, MIX_STATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Cleanup
  // ============================================================================

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    clearInterval(groupUpdateInterval);
    clearInterval(mixStateBroadcastInterval);
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
    // Payload: { userId?, seatId?, mode: 'audience' | 'projector' | 'controller' | 'osc-bridge' }
    // ------------------------------------------------------------------
    socket.on('join', async (data: { userId?: UserId; mode: ClientMode; seatId?: string }) => {
      console.log(`[Socket] Join: mode=${data.mode} userId=${data.userId ?? '(new)'}`);

      // OSC bridge client — wire up and return early
      if (data.mode === 'osc-bridge') {
        if (onBridgeConnect) {
          const cleanup = onBridgeConnect(socket);
          socket.on('disconnect', cleanup);
        } else {
          console.warn('[Socket] OSC bridge client connected but no bridge handler configured');
        }
        return;
      }

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

        // Send active thoughts to projector on connect
        if (data.mode === 'projector' && activeThoughts.length > 0) {
          socket.emit('thoughts_state', {
            thoughts: activeThoughts.map(t => ({ id: t.id, text: t.text, dismissed: t.dismissed })),
          });
        }
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

      // Resend any active intrusive thoughts for this user
      if (activeThoughts.length > 0) {
        const myThoughts = activeThoughts
          .filter(t => t.userId === data.userId && !t.dismissed)
          .map(t => ({ id: t.id, text: t.text }));
        if (myThoughts.length > 0) {
          socket.emit('thoughts_assigned', { thoughts: myThoughts });
        }
      }

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
    // select_type — audience selects a granular type during self-select assignment
    //
    // Payload: { granularType: string }
    // ------------------------------------------------------------------
    socket.on('select_type', async (data: { granularType: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] select_type rejected: no userId on socket');
        return;
      }

      console.log(`[Socket] select_type from ${userId}: ${data.granularType}`);

      const state = getState();
      const events = processCommand(state, {
        type: 'SELECT_GRANULAR_TYPE',
        userId,
        granularType: data.granularType,
      });
      setState(state, events);
      persistence.saveState(state);
      persistence.saveFinaleAssignment(state.id, userId, data.granularType, false);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // set_preference — audience sets live mix fragment preference
    //
    // Payload: { fragmentId: string }
    // granularType is derived from the user's assignment (not sent by client)
    // ------------------------------------------------------------------
    socket.on('set_preference', async (data: { fragmentId: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] set_preference rejected: no userId on socket');
        return;
      }

      const state = getState();
      if (!state.finaleState || state.finaleState.phase !== 'live_mix') return;

      // Determine user's assigned granular type
      let granularType: string | null = null;
      for (const [gt, members] of state.finaleState.assignment.groups) {
        if (members.includes(userId)) { granularType = gt; break; }
      }
      if (!granularType) {
        console.warn(`[Socket] set_preference rejected: ${userId} has no granular type assignment`);
        return;
      }

      const events = processCommand(state, {
        type: 'SET_LIVE_MIX_PREFERENCE',
        userId,
        granularType,
        fragmentId: data.fragmentId,
      });

      setState(state, events);

      // Persist preference event
      persistence.saveMixEvent(state.id, userId, granularType, data.fragmentId, 'preference');

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // dismiss_thought — audience member swipes away an intrusive thought
    // ------------------------------------------------------------------
    socket.on('dismiss_thought', (data: { thoughtId: string; direction: 'left' | 'right' }) => {
      const thought = activeThoughts.find(t => t.id === data.thoughtId);
      if (!thought || thought.dismissed) return;

      thought.dismissed = true;
      thought.dismissDirection = data.direction;

      // Notify projector of the dismissal (lightweight delta, not full state)
      io.to('projector').emit('thought_dismissed', {
        thoughtId: data.thoughtId,
        direction: data.direction,
      });
    });

    // ------------------------------------------------------------------
    // command — controller sends a ConductorCommand directly
    // ------------------------------------------------------------------
    socket.on('command', async (command: ConductorCommand) => {
      console.log(`[Socket] Command: ${command.type}`);

      // MASTER_PANIC is async (OSC round-trips) — call audio router directly
      if (command.type === 'MASTER_PANIC') {
        if (!audioRouter) {
          console.error('[Socket] MASTER_PANIC rejected: no audio router available');
          return;
        }
        await audioRouter.masterPanic();
        return;
      }

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

      // Persist all group assignments when assignment completes
      if (processedCommand.type === 'ASSIGNMENT_COMPLETE') {
        const groupsEvent = events.find(e => e.type === 'GROUPS_ASSIGNED') as
          | { type: 'GROUPS_ASSIGNED'; groups: Map<string, UserId[]> }
          | undefined;
        if (groupsEvent) {
          for (const [granularType, members] of groupsEvent.groups) {
            for (const memberId of members) {
              persistence.saveFinaleAssignment(state.id, memberId, granularType, true);
            }
          }
        }
      }

      // Clear intrusive thoughts when advancing past verdict (layer actually moves on)
      if (processedCommand.type === 'ADVANCE_FROM_VERDICT' && activeThoughts.length > 0) {
        // Fling all remaining thoughts off-screen at random directions
        for (const t of activeThoughts) {
          if (!t.dismissed) {
            t.dismissed = true;
            t.dismissDirection = Math.random() > 0.5 ? 'right' : 'left';
            io.to('projector').emit('thought_dismissed', {
              thoughtId: t.id,
              direction: t.dismissDirection,
            });
          }
        }
        // Clear after a brief delay for the fling animation
        setTimeout(() => {
          activeThoughts = [];
          io.to('projector').emit('thoughts_clear');
          io.to('audience').emit('thoughts_clear');
        }, 500);
      }

      // Persist lock/unlock/override mix events
      if (processedCommand.type === 'LOCK_GRANULAR_TYPE') {
        persistence.saveMixEvent(state.id, 'performer', processedCommand.granularType, '', 'lock');
      } else if (processedCommand.type === 'UNLOCK_GRANULAR_TYPE') {
        persistence.saveMixEvent(state.id, 'performer', processedCommand.granularType, '', 'unlock');
      } else if (processedCommand.type === 'OVERRIDE_FRAGMENT') {
        persistence.saveMixEvent(state.id, 'performer', processedCommand.granularType, processedCommand.fragmentId, 'override');
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

      case 'GROUPS_ASSIGNED': {
        // Notify each audience member of their assignment
        const assignedSockets = await io.in('audience').fetchSockets();
        for (const s of assignedSockets) {
          const uid = (s as any).userId as UserId | undefined;
          if (!uid) continue;
          for (const [granularType, members] of event.groups) {
            if (members.includes(uid)) {
              s.emit('assigned', { granularType, groupSize: members.length });
              break;
            }
          }
        }
        break;
      }

      case 'GRANULAR_TYPE_LOCKED':
        io.to('audience').emit('type_locked', { granularType: event.granularType });
        io.to('projector').emit('type_locked', { granularType: event.granularType });
        break;

      case 'GRANULAR_TYPE_UNLOCKED':
        io.to('audience').emit('type_unlocked', { granularType: event.granularType });
        io.to('projector').emit('type_unlocked', { granularType: event.granularType });
        break;

      case 'REVEAL_STAKES_SHOWN': {
        // Distribute intrusive thoughts to audience + projector
        const attempt = state.attempts[event.attemptIndex];
        if (!attempt) break;
        const thoughtsConfig = findThoughtsConfig(state.config.intrusiveThoughts, attempt.chapter);
        if (!thoughtsConfig) break;

        const connectedUserIds: UserId[] = [];
        const audienceSocks = await io.in('audience').fetchSockets();
        for (const s of audienceSocks) {
          const uid = (s as any).userId as UserId | undefined;
          if (uid) connectedUserIds.push(uid);
        }

        activeThoughts = assignThoughts(thoughtsConfig, event.layerIndex, connectedUserIds, event.attemptIndex);
        console.log(`[Thoughts] Assigned ${activeThoughts.length} thoughts to ${connectedUserIds.length} users (layer ${event.layerIndex})`);

        // Send each audience member their thoughts
        for (const s of audienceSocks) {
          const uid = (s as any).userId as UserId | undefined;
          if (!uid) continue;
          const myThoughts = activeThoughts
            .filter(t => t.userId === uid)
            .map(t => ({ id: t.id, text: t.text }));
          if (myThoughts.length > 0) {
            s.emit('thoughts_assigned', { thoughts: myThoughts });
          }
        }

        // Send full list to projector
        io.to('projector').emit('thoughts_state', {
          thoughts: activeThoughts.map(t => ({ id: t.id, text: t.text, dismissed: t.dismissed })),
        });
        break;
      }

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
          allFragments: fs.allFragments,
          // Assignment
          groupSizes: Array.from(fs.assignment.groups.entries())
            .map(([granularType, members]) => ({ granularType, count: members.length })),
          assignmentMode: fs.assignment.mode,
          assignmentTimerRemaining: fs.assignment.timerRemaining,
          // Live mix
          activeFragments: Array.from(fs.liveMix.activeFragments.entries())
            .map(([granularType, fragmentId]) => ({ granularType, fragmentId })),
          voteDistributions: Array.from(fs.liveMix.votes.entries()).map(([granularType, userVotes]) => {
            const counts = new Map<string, number>();
            for (const vote of userVotes.values()) counts.set(vote.fragmentId, (counts.get(vote.fragmentId) ?? 0) + 1);
            return {
              granularType,
              votes: Array.from(counts.entries()).map(([fragmentId, count]) => ({ fragmentId, count })),
            };
          }),
          lockedTypes: fs.liveMix.lockedTypes,
    
          loopPosition: fs.liveMix.loopPosition,
          // NPC
          npcMessage: fs.npc.currentMessage,
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
      const currentLayerConfig: V32LayerConfig | null =
        attempt?.layerPlan[attempt.currentLayerIndex] ?? null;

      // Finale personalization
      let myFinale: object | null = null;
      const fs = state.finaleState;
      if (fs) {
        // Determine user's granular type assignment
        let myGranularType: string | null = null;
        for (const [granularType, members] of fs.assignment.groups) {
          if (members.includes(userId)) { myGranularType = granularType; break; }
        }

        // All group sizes
        const groupSizes = Array.from(fs.assignment.groups.entries())
          .map(([granularType, members]) => ({ granularType, count: members.length }));

        // Fragments available for user's granular type
        const myGroupFragments = myGranularType
          ? fs.availableFragments.filter(f => f.granularType === myGranularType)
          : [];

        // User's own live mix vote
        const myVoteData = myGranularType
          ? (fs.liveMix.votes.get(myGranularType)?.get(userId) ?? null)
          : null;

        // Active fragment for user's group
        const myGroupActiveFragment = myGranularType
          ? (fs.liveMix.activeFragments.get(myGranularType) ?? null)
          : null;

        // Vote distribution for user's group
        const myGroupVoteDistribution: Array<{ fragmentId: string; count: number }> = [];
        if (myGranularType) {
          const votes = fs.liveMix.votes.get(myGranularType);
          if (votes) {
            const counts = new Map<string, number>();
            for (const vote of votes.values()) counts.set(vote.fragmentId, (counts.get(vote.fragmentId) ?? 0) + 1);
            for (const [fragmentId, count] of counts) myGroupVoteDistribution.push({ fragmentId, count });
          }
        }

        // All active fragments (read-only overview for other types)
        const activeFragments = Array.from(fs.liveMix.activeFragments.entries())
          .map(([granularType, fragmentId]) => ({ granularType, fragmentId }));

        myFinale = {
          finalePhase: fs.phase,
          myGranularType,
          groupSizes,
          assignmentMode: fs.assignment.mode,
          assignmentTimerRemaining: fs.assignment.timerRemaining,
          myGroupFragments,
          myGroupActiveFragment,
          myGroupVoteDistribution,
          myVote: myVoteData?.fragmentId ?? null,
          activeFragments,
          lockedTypes: fs.liveMix.lockedTypes,
    
          npcMessage: fs.npc.currentMessage,
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
          layerPlan: attempt.layerPlan,
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
          chapters: state.config.chapters ?? [],
          granularTypes: state.config.granularTypes ?? [],
          intrusiveThoughts: state.config.intrusiveThoughts ?? [],
        },
      };
    }

    default:
      return serializeState(state);
  }
}

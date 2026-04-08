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
 * - 'quilt_state' → all clients at ~2 Hz (assignment) / ~4 Hz (playback)
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
const QUILT_STATE_BROADCAST_INTERVAL_MS = 250;  // ~4 Hz during playback, ~2 Hz during assignment (throttled)

// ============================================================================
// Intrusive thoughts — server-side state
// ============================================================================

/** Active thoughts for the current reveal. Cleared on layer/attempt change. */
let activeThoughts: AssignedThought[] = [];

/**
 * Fling all remaining intrusive thoughts off-screen and clear state.
 * Called from both the socket command handler and the timing engine path.
 */
export function clearThoughtsOnAdvance(io: SocketIOServer): void {
  if (activeThoughts.length === 0) return;

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

  setTimeout(() => {
    activeThoughts = [];
    io.to('projector').emit('thoughts_clear');
    io.to('audience').emit('thoughts_clear');
  }, 500);
}

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
  // Quilt state broadcast (~2 Hz during assignment, ~4 Hz during playback)
  // ============================================================================

  const quiltStateBroadcastInterval = setInterval(() => {
    const state = getState();
    const fs = state.finaleState;
    if (!fs) return;

    const isAssignment = state.phase === 'finale_assignment' && fs.phase === 'assignment';
    const isPlayback = state.phase === 'finale_playback' && fs.phase === 'playback';
    const isPreview = state.phase === 'finale_preview' && fs.phase === 'preview';

    if (!isAssignment && !isPlayback && !isPreview) return;

    const quiltState = {
      cells: Array.from(fs.quilt.cells.values()).map(c => ({
        id: c.id,
        rowIndex: c.rowIndex,
        columnIndex: c.columnIndex,
        granularType: c.granularType,
        songIndex: c.songIndex,
        chapter: c.chapter,
        ownerId: c.ownerId,
      })),
      columnOrder: fs.quilt.columnOrder,
      playheadColumn: fs.quilt.playheadColumn,
      loopCount: fs.quilt.loopCount,
    };

    io.to('audience').emit('quilt_state', quiltState);
    io.to('projector').emit('quilt_state', quiltState);
    io.to('controller').emit('quilt_state', quiltState);
  }, QUILT_STATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Cleanup
  // ============================================================================

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    clearInterval(quiltStateBroadcastInterval);
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
    // claim_cell — audience claims a quilt cell during assignment
    //
    // Payload: { cellId: string }
    // ------------------------------------------------------------------
    socket.on('claim_cell', async (data: { cellId: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'CLAIM_CELL', userId, cellId: data.cellId });
      setState(state, events);
      persistence.saveState(state);

      // Persist cell claim
      const cellClaimedEvent = events.find(e => e.type === 'CELL_CLAIMED');
      if (cellClaimedEvent) {
        persistence.saveQuiltCell(state.id, data.cellId, userId, null);
      }

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // release_cell — audience releases their quilt cell during assignment
    // ------------------------------------------------------------------
    socket.on('release_cell', async () => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'RELEASE_CELL', userId });
      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // set_song — audience sets song choice during preview
    //
    // Payload: { songIndex: number }
    // ------------------------------------------------------------------
    socket.on('set_song', async (data: { songIndex: number }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'SET_CELL_SONG', userId, songIndex: data.songIndex });
      setState(state, events);
      persistence.saveState(state);

      // Persist song choice
      const songSetEvent = events.find(e => e.type === 'CELL_SONG_SET') as { cellId: string; songIndex: number } | undefined;
      if (songSetEvent) {
        persistence.saveQuiltCell(state.id, songSetEvent.cellId, userId, data.songIndex);
      }

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // lock_in — audience locks in their song choice during preview
    // ------------------------------------------------------------------
    socket.on('lock_in', async () => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'LOCK_IN_CHOICE', userId });
      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // move_cell — audience moves their cell during playback
    //
    // Payload: { targetCellId: string }
    // ------------------------------------------------------------------
    socket.on('move_cell', async (data: { targetCellId: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'MOVE_CELL', userId, targetCellId: data.targetCellId });
      setState(state, events);
      persistence.saveState(state);

      // Persist remix event
      const moveEvent = events.find(e => e.type === 'CELL_MOVED');
      if (moveEvent) {
        persistence.saveRemixEvent(state.id, userId, 'move', JSON.stringify(moveEvent));
      }

      await broadcastEvents(io, events, state);
    });

    // ------------------------------------------------------------------
    // change_song — audience changes cell song during playback (when allowed)
    //
    // Payload: { songIndex: number }
    // ------------------------------------------------------------------
    socket.on('change_song', async (data: { songIndex: number }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      const events = processCommand(state, { type: 'CHANGE_CELL_SONG', userId, songIndex: data.songIndex });
      setState(state, events);
      persistence.saveState(state);

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

      // Persist cell assignments when assignment completes (auto-assigned users)
      if (processedCommand.type === 'ASSIGNMENT_COMPLETE') {
        const cellEvents = events.filter(e => e.type === 'CELL_CLAIMED') as
          Array<{ type: 'CELL_CLAIMED'; cellId: string; userId: UserId }>;
        for (const ce of cellEvents) {
          persistence.saveQuiltCell(state.id, ce.cellId, ce.userId, null);
        }
      }

      // Clear intrusive thoughts when advancing past verdict (layer actually moves on)
      if (processedCommand.type === 'ADVANCE_FROM_VERDICT') {
        clearThoughtsOnAdvance(io);
      }

      // Persist performer remix events
      if (processedCommand.type === 'LOCK_CELL') {
        persistence.saveRemixEvent(state.id, null, 'lock', JSON.stringify({ cellId: processedCommand.cellId }));
      } else if (processedCommand.type === 'UNLOCK_CELL') {
        persistence.saveRemixEvent(state.id, null, 'unlock', JSON.stringify({ cellId: processedCommand.cellId }));
      } else if (processedCommand.type === 'MUTE_CELL') {
        persistence.saveRemixEvent(state.id, null, 'mute', JSON.stringify({ cellId: processedCommand.cellId }));
      } else if (processedCommand.type === 'UNMUTE_CELL') {
        persistence.saveRemixEvent(state.id, null, 'unmute', JSON.stringify({ cellId: processedCommand.cellId }));
      } else if (processedCommand.type === 'SWAP_CELLS') {
        persistence.saveRemixEvent(state.id, null, 'swap', JSON.stringify({ cellIdA: processedCommand.cellIdA, cellIdB: processedCommand.cellIdB }));
      } else if (processedCommand.type === 'REORDER_COLUMN') {
        persistence.saveRemixEvent(state.id, null, 'reorder', JSON.stringify({ fromIndex: processedCommand.fromIndex, toIndex: processedCommand.toIndex }));
      } else if (processedCommand.type === 'OVERRIDE_CELL_SONG') {
        persistence.saveRemixEvent(state.id, null, 'override', JSON.stringify({ cellId: processedCommand.cellId, songIndex: processedCommand.songIndex }));
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

      case 'CELL_CLAIMED':
        io.to('audience').emit('cell_claimed', { cellId: event.cellId, userId: event.userId });
        io.to('projector').emit('cell_claimed', { cellId: event.cellId, userId: event.userId });
        break;

      case 'CELL_MOVED':
        io.to('audience').emit('cell_moved', {
          cellId: event.cellId,
          fromPosition: event.fromPosition,
          toPosition: event.toPosition,
          swappedWithCellId: event.swappedWithCellId,
        });
        io.to('projector').emit('cell_moved', {
          cellId: event.cellId,
          fromPosition: event.fromPosition,
          toPosition: event.toPosition,
          swappedWithCellId: event.swappedWithCellId,
        });
        break;

      case 'PLAYHEAD_ADVANCED':
        io.to('audience').emit('playhead_update', { columnIndex: event.columnIndex });
        io.to('projector').emit('playhead_update', { columnIndex: event.columnIndex });
        io.to('controller').emit('playhead_update', { columnIndex: event.columnIndex });
        break;

      case 'COLUMN_REORDERED':
        io.to('audience').emit('column_reordered', { columnOrder: event.columnOrder });
        io.to('projector').emit('column_reordered', { columnOrder: event.columnOrder });
        io.to('controller').emit('column_reordered', { columnOrder: event.columnOrder });
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
        openerSlideState: state.openerSlideState,
        attempts: state.attempts,
        finaleState: fs ? {
          finalePhase: fs.phase,
          availableFragments: fs.availableFragments,
          allFragments: fs.allFragments,
          // Quilt grid
          quilt: {
            rows: fs.quilt.rows,
            columns: fs.quilt.columns,
            cells: Array.from(fs.quilt.cells.values()).map(c => ({
              id: c.id, rowIndex: c.rowIndex, columnIndex: c.columnIndex,
              granularType: c.granularType, songIndex: c.songIndex,
              chapter: c.chapter, ownerId: c.ownerId,
            })),
            columnOrder: fs.quilt.columnOrder,
            playheadColumn: fs.quilt.playheadColumn,
            loopCount: fs.quilt.loopCount,
          },
          availableSongs: fs.availableSongs,
          // Assignment
          assignmentMode: fs.assignment.mode,
          assignmentTimerRemaining: fs.assignment.timerRemaining,
          // Remix
          lockedCells: Array.from(fs.remix.lockedCells),
          mutedCells: Array.from(fs.remix.mutedCells),
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
        // Find user's cell
        let myCellId: string | null = null;
        for (const cell of fs.quilt.cells.values()) {
          if (cell.ownerId === userId) { myCellId = cell.id; break; }
        }

        myFinale = {
          finalePhase: fs.phase,
          // Quilt grid (shared)
          quilt: {
            rows: fs.quilt.rows,
            columns: fs.quilt.columns,
            cells: Array.from(fs.quilt.cells.values()).map(c => ({
              id: c.id, rowIndex: c.rowIndex, columnIndex: c.columnIndex,
              granularType: c.granularType, songIndex: c.songIndex,
              chapter: c.chapter, ownerId: c.ownerId,
            })),
            columnOrder: fs.quilt.columnOrder,
            playheadColumn: fs.quilt.playheadColumn,
          },
          availableSongs: fs.availableSongs,
          // Assignment
          myCellId,
          assignmentMode: fs.assignment.mode,
          assignmentTimerRemaining: fs.assignment.timerRemaining,
          // Preview
          previewTimerRemaining: fs.preview.timerRemaining,
          lockedIn: fs.preview.lockedInUsers.has(userId),
          audioPreviewPath: state.config.finale.audioPreviewPath,
          // Remix
          lockedCells: Array.from(fs.remix.lockedCells),
          mutedCells: Array.from(fs.remix.mutedCells),
          audienceRemix: state.config.finale.quilt.audienceRemix,
          // NPC
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

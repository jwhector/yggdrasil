/**
 * Socket.IO Event Handlers
 *
 * Manages WebSocket connections, rooms, and real-time events.
 * Acts as the I/O layer wrapping the pure Conductor logic.
 *
 * Room structure:
 * - 'audience' - All audience members
 * - 'projector' - Projector display
 * - 'controller' - Performer controller
 * - 'faction:0', 'faction:1', 'faction:2', 'faction:3' - Faction-specific rooms
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ShowState,
  ConductorCommand,
  ConductorEvent,
  UserId,
  FactionId,
  OptionId,
  User,
  Vote,
  AudienceClientState,
  ProjectorClientState,
  ControllerClientState,
} from '../conductor/types';
import { processCommand } from '../conductor';
import type { PersistenceLayer } from './persistence';
import { serializeState } from '../lib/serialization';

/**
 * Client mode for filtering state
 */
type ClientMode = 'audience' | 'projector' | 'controller';

/**
 * Heartbeat tracking for each client
 */
interface ClientHeartbeat {
  socketId: string;
  userId: UserId | null;
  lastPing: number;
  missedPongs: number;
}

/**
 * Configuration for heartbeat monitoring
 */
const HEARTBEAT_INTERVAL_MS = 15000;  // Ping every 15 seconds
const HEARTBEAT_TIMEOUT_MS = 5000;    // Client must respond within 5 seconds
const MAX_MISSED_HEARTBEATS = 2;      // 2 missed = disconnected

/**
 * Setup Socket.IO event handlers
 *
 * @param io - Socket.IO server instance
 * @param getState - Function to get current show state
 * @param setState - Function to update show state
 * @param persistence - Persistence layer for saving data
 */
export function setupSocketHandlers(
  io: SocketIOServer,
  getState: () => ShowState,
  setState: (state: ShowState, events: ConductorEvent[]) => void,
  persistence: PersistenceLayer
): void {
  // Track heartbeats for all clients
  const heartbeats = new Map<string, ClientHeartbeat>();

  /**
   * Heartbeat monitoring system
   */
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [socketId, heartbeat] of heartbeats.entries()) {
      const timeSinceLastPing = now - heartbeat.lastPing;

      // Check if client missed pong
      if (timeSinceLastPing > HEARTBEAT_TIMEOUT_MS) {
        heartbeat.missedPongs++;

        // Too many missed heartbeats - mark as disconnected
        if (heartbeat.missedPongs >= MAX_MISSED_HEARTBEATS) {
          console.log(`[Heartbeat] Client ${socketId} missed ${heartbeat.missedPongs} heartbeats, disconnecting`);
          const socket = io.sockets.sockets.get(socketId);

          if (socket && heartbeat.userId) {
            // Trigger disconnect handling
            handleUserDisconnect(socket, heartbeat.userId);
          }

          heartbeats.delete(socketId);
        }
      }
    }

    // Send ping to all connected clients
    io.emit('ping', { timestamp: now });
  }, HEARTBEAT_INTERVAL_MS);

  /**
   * Clean up on server shutdown
   */
  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
  });

  /**
   * Handle user disconnect
   */
  async function handleUserDisconnect(socket: Socket, userId: UserId): Promise<void> {
    const state = getState();
    const user = state.users.get(userId);

    if (user) {
      console.log(`[Socket] User disconnected: ${userId} (seat: ${user.seatId})`);

      // Process disconnect command
      const events = processCommand(state, {
        type: 'USER_DISCONNECT',
        userId,
      });

      setState(state, events);
      persistence.saveState(state);

      // Broadcast disconnection
      await broadcastEvents(io, events, state);
    }

    heartbeats.delete(socket.id);
  }

  /**
   * Main connection handler
   */
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Initialize heartbeat tracking
    heartbeats.set(socket.id, {
      socketId: socket.id,
      userId: null,
      lastPing: Date.now(),
      missedPongs: 0,
    });

    /**
     * Pong response from client
     */
    socket.on('pong', () => {
      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat) {
        heartbeat.lastPing = Date.now();
        heartbeat.missedPongs = 0;
      }
    });

    /**
     * CLIENT EVENT: Join show
     *
     * Payload: { userId?: string, mode: 'audience' | 'projector' | 'controller', seatId?: string }
     */
    socket.on('join', async (data: { userId?: UserId; mode: ClientMode; seatId?: string }) => {
      console.log(`[Socket] Join request:`, data);

      const state = getState();
      const userId = data.userId || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Join appropriate rooms
      socket.join(data.mode);

      if (data.mode === 'audience') {
        // Connect or reconnect user
        const existingUser = state.users.get(userId);

        if (existingUser) {
          // Reconnecting user
          const events = processCommand(state, {
            type: 'USER_RECONNECT',
            userId,
            lastVersion: 0, // Client should send this, but default to 0
          });

          setState(state, events);
          persistence.saveState(state);

          // Update heartbeat and socket with userId
          const heartbeat = heartbeats.get(socket.id);
          if (heartbeat) {
            heartbeat.userId = userId;
          }
          (socket as any).userId = userId;

          // Send full state sync
          const filteredState = filterStateForClient(state, data.mode, userId);
          socket.emit('state_sync', filteredState);

          // Join faction room if assigned
          if (existingUser.faction !== null) {
            socket.join(`faction:${existingUser.faction}`);
          }

          await broadcastEvents(io, events, state);
        } else {
          // New user
          const events = processCommand(state, {
            type: 'USER_CONNECT',
            userId,
            seatId: data.seatId,
          });

          setState(state, events);
          persistence.saveState(state);

          // Update heartbeat and socket with userId
          const heartbeat = heartbeats.get(socket.id);
          if (heartbeat) {
            heartbeat.userId = userId;
          }
          (socket as any).userId = userId;

          // Send identity and initial state
          socket.emit('identity', { userId });

          const filteredState = filterStateForClient(state, data.mode, userId);
          socket.emit('state_sync', filteredState);

          await broadcastEvents(io, events, state);

          // Save user to database
          const user = state.users.get(userId);
          if (user) {
            persistence.saveUser(user, state.id);
          }
        }
      } else {
        // Projector or controller - just send state
        const filteredState = filterStateForClient(state, data.mode);
        socket.emit('state_sync', filteredState);
      }
    });

    /**
     * CLIENT EVENT: Reconnect with existing identity
     *
     * Payload: { userId: string, lastVersion: number }
     */
    socket.on('reconnect_user', async (data: { userId: UserId; lastVersion: number }) => {
      console.log(`[Socket] Reconnect request: ${data.userId}, last version: ${data.lastVersion}`);

      const state = getState();
      const user = state.users.get(data.userId);

      if (!user) {
        socket.emit('error', { message: 'User not found in current show' });
        return;
      }

      // Process reconnection
      const events = processCommand(state, {
        type: 'USER_RECONNECT',
        userId: data.userId,
        lastVersion: data.lastVersion,
      });

      setState(state, events);
      persistence.saveState(state);

      // Update heartbeat and socket with userId
      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat) {
        heartbeat.userId = data.userId;
      }
      (socket as any).userId = data.userId;

      // Join rooms
      socket.join('audience');
      if (user.faction !== null) {
        socket.join(`faction:${user.faction}`);
      }

      // Send state sync
      const filteredState = filterStateForClient(state, 'audience', data.userId);
      socket.emit('state_sync', filteredState);

      await broadcastEvents(io, events, state);
    });

    /**
     * CLIENT EVENT: Submit vote
     *
     * Payload: { userId: string, factionVote: OptionId, personalVote: OptionId }
     */
    socket.on('vote', async (data: { userId: UserId; factionVote: OptionId; personalVote: OptionId }) => {
      console.log(`[Socket] Vote from ${data.userId}: faction=${data.factionVote}, personal=${data.personalVote}`);

      const state = getState();

      const events = processCommand(state, {
        type: 'SUBMIT_VOTE',
        userId: data.userId,
        factionVote: data.factionVote,
        personalVote: data.personalVote,
      });

      setState(state, events);
      persistence.saveState(state);

      // Save vote to database
      const vote = state.votes.find(
        v => v.userId === data.userId &&
             v.rowIndex === state.currentRowIndex &&
             v.attempt === state.rows[state.currentRowIndex].attempts
      );

      if (vote) {
        persistence.saveVote(vote, state.id);
      }

      await broadcastEvents(io, events, state);
    });

    /**
     * CLIENT EVENT: Submit coup vote
     *
     * Payload: { userId: string }
     */
    socket.on('coup_vote', async (data: { userId: UserId }) => {
      console.log(`[Socket] Coup vote from ${data.userId}`);

      const state = getState();

      const events = processCommand(state, {
        type: 'SUBMIT_COUP_VOTE',
        userId: data.userId,
      });

      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    });

    /**
     * CLIENT EVENT: Submit fig tree response
     *
     * Payload: { userId: string, text: string }
     */
    socket.on('fig_tree_response', async (data: { userId: UserId; text: string }) => {
      console.log(`[Socket] Fig tree response from ${data.userId}: "${data.text.substring(0, 50)}..."`);

      const state = getState();

      const events = processCommand(state, {
        type: 'SUBMIT_FIG_TREE_RESPONSE',
        userId: data.userId,
        text: data.text,
      });

      setState(state, events);
      persistence.saveState(state);

      // Save response to database
      persistence.saveFigTreeResponse(data.userId, data.text, state.id);

      await broadcastEvents(io, events, state);
    });

    /**
     * CLIENT EVENT: Controller command
     *
     * Payload: ConductorCommand
     */
    socket.on('command', async (command: ConductorCommand) => {
      // TODO: Validate that sender is actually a controller
      console.log(`[Socket] Command from controller:`, command.type);

      const state = getState();

      const events = processCommand(state, command);

      setState(state, events);
      persistence.saveState(state);

      await broadcastEvents(io, events, state);
    });

    /**
     * Disconnect handler
     */
    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);

      const heartbeat = heartbeats.get(socket.id);
      if (heartbeat && heartbeat.userId) {
        handleUserDisconnect(socket, heartbeat.userId);
      } else {
        heartbeats.delete(socket.id);
      }
    });
  });
}

/**
 * Broadcast full state sync to all clients after state changes
 *
 * This replaces granular event broadcasting with full state syncs,
 * eliminating the possibility of state drift between client and server.
 */
async function broadcastEvents(
  io: SocketIOServer,
  events: ConductorEvent[],
  state: ShowState
): Promise<void> {
  // Controller gets full serialized state (includes Maps/Sets as arrays)
  io.to('controller').emit('state_sync', filterStateForClient(state, 'controller'));

  // Projector gets public filtered state (same for all projectors)
  io.to('projector').emit('state_sync', filterStateForClient(state, 'projector'));

  // Audience gets personalized filtered state (includes their faction, votes, seat)
  // Iterate all audience sockets to send user-specific data
  const audienceSockets = await io.in('audience').fetchSockets();
  for (const socket of audienceSockets) {
    const userId = (socket as any).userId;
    if (userId) {
      try {
        const filteredState = filterStateForClient(state, 'audience', userId);
        socket.emit('state_sync', filteredState);
      } catch (error) {
        console.error(`[Socket] Error filtering state for user ${userId}:`, error);
      }
    }
  }

  // Handle special events that require additional actions beyond state sync
  for (const event of events) {
    switch (event.type) {
      case 'FACTION_ASSIGNED':
        // Join user to faction room for future broadcasts
        const userSockets = getUserSockets(io, event.userId);
        userSockets.forEach(socket => {
          socket.join(`faction:${event.faction}`);
        });
        break;

      case 'ERROR':
        // Errors still sent separately to controller for visibility
        io.to('controller').emit('error', event);
        console.error('[Conductor Error]:', event.message, event.command);
        break;

      // All other events are superseded by state sync
      default:
        break;
    }
  }
}

/**
 * Get all socket connections for a given user ID
 */
function getUserSockets(io: SocketIOServer, userId: UserId): Socket[] {
  const sockets: Socket[] = [];

  for (const [_, socket] of io.sockets.sockets) {
    // Check if this socket has the userId in its data
    // (This would need to be set when the user joins)
    const socketUserId = (socket as any).userId;
    if (socketUserId === userId) {
      sockets.push(socket);
    }
  }

  return sockets;
}

/**
 * Filter show state based on client type
 *
 * Different client types see different subsets of the state:
 * - Audience: Only what's relevant to them
 * - Projector: Public display info (no coup meters)
 * - Controller: Full state
 */
function filterStateForClient(
  state: ShowState,
  mode: ClientMode,
  userId?: UserId
): ReturnType<typeof serializeState> | Partial<ShowState> | AudienceClientState | ProjectorClientState | ControllerClientState {
  switch (mode) {
    case 'controller':
      // Controller sees everything - serialize to handle Maps/Sets
      return serializeState(state);

    case 'projector':
      // Projector sees public display info
      return {
        id: state.id,
        version: state.version,
        phase: state.phase,
        currentRowIndex: state.currentRowIndex,
        rows: state.rows.map(row => ({
          index: row.index,
          label: row.label,
          type: row.type,
          options: row.options,
          phase: row.phase,
          committedOption: row.committedOption,
          currentAuditionIndex: row.currentAuditionIndex,
          attempts: row.attempts,
        })),
        factions: state.factions.map(f => ({
          id: f.id,
          name: f.name,
          color: f.color,
        })) as any,
        paths: state.paths,
        config: state.config,
      };

    case 'audience':
      if (!userId) {
        throw new Error('userId required for audience state filtering');
      }

      const user = state.users.get(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      const currentRow = state.rows[state.currentRowIndex];
      const personalTree = state.personalTrees.get(userId);

      // Find user's vote for current row
      const myVote = state.votes.find(
        v => v.userId === userId &&
             v.rowIndex === state.currentRowIndex &&
             v.attempt === currentRow.attempts
      );

      return {
        userId,
        seatId: user.seatId,
        faction: user.faction,
        showPhase: state.phase,
        figTreeResponseSubmitted: !!personalTree?.figTreeResponse,
        currentRow: currentRow ? {
          index: currentRow.index,
          phase: currentRow.phase,
          options: currentRow.options,
          currentAuditionIndex: currentRow.currentAuditionIndex,
        } : null,
        myVote: myVote ? {
          factionVote: myVote.factionVote,
          personalVote: myVote.personalVote,
        } : null,
        coupMeter: null, // Updated separately via coup_meter_update events
        canCoup: user.faction !== null ? !state.factions[user.faction].coupUsed : false,
      };

    default:
      return state;
  }
}

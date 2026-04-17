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
 * - 'pool_state' → projector/controller at ~2 Hz during finale phases
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
  FinaleState,
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
const POOL_STATE_BROADCAST_INTERVAL_MS = 500;   // ~2 Hz during finale_vote and finale_remix

// ============================================================================
// Intrusive thoughts — server-side state
// ============================================================================

/** Active thoughts for the current reveal. Cleared on layer/attempt change. */
let activeThoughts: AssignedThought[] = [];

// ============================================================================
// Collective scatter vote — server-side state
// ============================================================================

/** Audience members who have voted to scatter this cycle. Cleared on scatter or phase exit. */
const scatterVotes = new Set<UserId>();

/** Fraction of connected audience needed to trigger scatter. */
const SCATTER_VOTE_THRESHOLD = 0.5;

/**
 * Clear all intrusive thoughts and notify clients.
 * Called from both the socket command handler and the timing engine path.
 */
export function clearThoughtsOnAdvance(io: SocketIOServer): void {
  if (activeThoughts.length === 0) return;

  activeThoughts = [];
  io.to('projector').emit('thoughts_clear');
  io.to('audience').emit('thoughts_clear');
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
  // Pool state broadcast (~2 Hz during finale_vote and finale_remix)
  // ============================================================================

  const poolStateBroadcastInterval = setInterval(() => {
    const state = getState();
    if (state.phase !== 'finale_vote' && state.phase !== 'finale_remix') return;

    const fs = state.finaleState as FinaleState | null;
    if (!fs) return;

    const poolState = {
      availableByChapter: Array.from(fs.pool.availableByChapter.entries()).map(
        ([chapterId, count]) => ({ chapterId, count })
      ),
      totalByChapter: Array.from(fs.pool.totalByChapter.entries()).map(
        ([chapterId, count]) => ({ chapterId, count })
      ),
      totalRemaining: fs.pool.totalRemaining,
      loopProgress: fs.loopProgress,
    };

    io.to('projector').emit('pool_state', poolState);
    io.to('controller').emit('pool_state', poolState);
  }, POOL_STATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Node tally broadcast (~2 Hz during finale_remix with audience orbs)
  // ============================================================================

  const tallyBroadcastInterval = setInterval(() => {
    const state = getState();
    if (state.phase !== 'finale_remix') return;

    const fs = state.finaleState as FinaleState | null;
    if (!fs || fs.fallbackMode) return;
    if (fs.nodeTallies.size === 0) return;

    const tallies = Array.from(fs.nodeTallies.entries()).map(([granularType, tally]) => ({
      granularType,
      dominantChapter: tally.locked && tally.lockedChapter ? tally.lockedChapter : tally.dominantChapter,
      locked: tally.locked,
      votes: Array.from(tally.votes.entries()).map(([chapterId, count]) => ({ chapterId, count })),
    }));

    const enabledNodes = Array.from(fs.enabledNodes);

    io.to('projector').emit('node_tally', { tallies, enabledNodes });
    io.to('controller').emit('node_tally', { tallies, enabledNodes });
    io.to('audience').emit('node_tally', { tallies, enabledNodes });
  }, POOL_STATE_BROADCAST_INTERVAL_MS);

  // ============================================================================
  // Cleanup
  // ============================================================================

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    clearInterval(poolStateBroadcastInterval);
    clearInterval(tallyBroadcastInterval);
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
            thoughts: activeThoughts.map(t => ({ id: t.id, text: t.text })),
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
          .filter(t => t.userId === data.userId)
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

      const state = getState();

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

      // Lightweight — skip full state_sync broadcast to all audience.
      // SUBMIT_VOTE only records the vote; layer resolution happens on CLOSE_VOTING
      // (fired by timing engine). Only the voting user needs their myVote update.
      // Controller gets full state for live vote distribution display.
      socket.emit('state_sync', filterStateForClient(state, 'audience', userId));
      io.to('controller').emit('state_sync', filterStateForClient(state, 'controller'));
    });

    // ------------------------------------------------------------------
    // submit_emotion — audience submits chapter vote during finale_vote
    //
    // Payload: { chapterId: string; questionIndex: number }
    // userId taken from socket session (not payload) for security.
    // ------------------------------------------------------------------
    socket.on('submit_emotion', async (data: { chapterId: string; questionIndex: number }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] submit_emotion rejected: no userId on socket');
        return;
      }

      const state = getState();
      if (state.phase !== 'finale_vote') {
        console.warn(`[Socket] submit_emotion rejected: wrong phase (${state.phase})`);
        return;
      }

      console.log(`[Socket] Emotion from ${userId}: chapter=${data.chapterId} q=${data.questionIndex}`);

      const events = processCommand(state, {
        type: 'SUBMIT_EMOTION',
        userId,
        chapterId: data.chapterId,
        questionIndex: data.questionIndex,
      });

      setState(state, events);
      persistence.saveState(state);
      persistence.saveFinaleVote(state.id, userId, data.chapterId, data.questionIndex);

      // Lightweight emit — skip full state_sync broadcast (pool counts reach
      // projector/controller via the 2Hz pool_state interval instead).
      // Only emit targeted events to the submitting user + projector.
      for (const event of events) {
        if (event.type === 'EMOTION_RECEIVED') {
          const er = event as { type: 'EMOTION_RECEIVED'; userId: UserId; chapterId: string; questionIndex: number };
          socket.emit('emotion_confirmed', { chapterId: er.chapterId, questionIndex: er.questionIndex });
          io.to('projector').emit('token_fly', { chapterId: er.chapterId });
        } else if (event.type === 'NEXT_QUESTION') {
          const nq = event as { type: 'NEXT_QUESTION'; userId: UserId; questionIndex: number; questionText: string; answers?: Array<{ chapterId: string; label: string }> | null };
          socket.emit('question', {
            questionIndex: nq.questionIndex,
            text: nq.questionText,
            answers: nq.answers ?? null,
            chapters: state.config.chapters ?? [],
          });
        }
      }

      // Emit vote progress to controller for live completion tracking
      const fs = state.finaleState as FinaleState | null;
      if (fs) {
        const totalQuestions = state.config.finale.vote?.questions?.length ?? 0;
        let completedUsers = 0;
        for (const [, count] of fs.vote.questionsAnsweredByUser) {
          if (count >= totalQuestions) completedUsers++;
        }
        io.to('controller').emit('vote_progress', {
          completedUsers,
          totalUsers: state.users.size,
          totalOrbs: fs.pool.tokens.length,
        });
      }
    });

    // ------------------------------------------------------------------
    // place_orb — audience places an orb on a remix node
    //
    // Payload: { orbIndex: number; granularType: string }
    // userId taken from socket session (not payload) for security.
    // ------------------------------------------------------------------
    socket.on('place_orb', async (data: { orbIndex: number; granularType: string }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] place_orb rejected: no userId on socket');
        return;
      }

      const state = getState();
      if (state.phase !== 'finale_remix') return;

      const events = processCommand(state, {
        type: 'PLACE_ORB',
        userId,
        orbIndex: data.orbIndex,
        granularType: data.granularType,
      });

      setState(state, events);
      // Lightweight — skip full state_sync. Tallies reach all clients via 2Hz node_tally.
      // AUDIO_CUE events are processed by the setState hook (audio router).
    });

    // ------------------------------------------------------------------
    // recall_orb — audience recalls an orb back to hand
    //
    // Payload: { orbIndex: number }
    // userId taken from socket session (not payload) for security.
    // ------------------------------------------------------------------
    socket.on('recall_orb', async (data: { orbIndex: number }) => {
      const userId = (socket as any).userId as UserId;
      if (!userId) {
        console.warn('[Socket] recall_orb rejected: no userId on socket');
        return;
      }

      const state = getState();
      if (state.phase !== 'finale_remix') return;

      const events = processCommand(state, {
        type: 'RECALL_ORB',
        userId,
        orbIndex: data.orbIndex,
      });

      setState(state, events);
      // Lightweight — skip full state_sync. Tallies reach all clients via 2Hz node_tally.
    });

    // ------------------------------------------------------------------
    // vote_scatter — audience votes to collectively scatter all orbs
    //
    // No payload. userId taken from socket session.
    // When enough audience members vote, SCATTER_ALL fires automatically.
    // ------------------------------------------------------------------
    socket.on('vote_scatter', async () => {
      const userId = (socket as any).userId as UserId;
      if (!userId) return;

      const state = getState();
      if (state.phase !== 'finale_remix') return;

      // Already voted this cycle
      if (scatterVotes.has(userId)) return;
      scatterVotes.add(userId);

      const audienceSockets = await io.in('audience').fetchSockets();
      const connectedCount = audienceSockets.filter(s => (s as any).userId).length;
      const threshold = Math.max(2, Math.ceil(connectedCount * SCATTER_VOTE_THRESHOLD));
      const count = scatterVotes.size;

      console.log(`[Scatter Vote] ${userId} voted (${count}/${threshold})`);

      if (count >= threshold) {
        // Threshold met — fire scatter and reset
        scatterVotes.clear();
        const events = processCommand(state, { type: 'SCATTER_ALL' });
        setState(state, events);
        await broadcastEvents(io, events, state);

        // Broadcast reset count to all audience
        io.to('audience').emit('scatter_vote_count', { count: 0, threshold });
      } else {
        // Broadcast updated count to all audience
        io.to('audience').emit('scatter_vote_count', { count, threshold });
      }
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

      // Clear intrusive thoughts when advancing past verdict (layer actually moves on)
      if (processedCommand.type === 'ADVANCE_FROM_VERDICT') {
        clearThoughtsOnAdvance(io);
      }

      // Persist token events
      for (const event of events) {
        if (event.type === 'TOKEN_ACTIVATED') {
          const ta = event as { type: 'TOKEN_ACTIVATED'; granularType: string; chapterId: string; tokenId: string; trackIndices: number[] };
          persistence.saveTokenEvent(state.id, ta.tokenId, ta.granularType, ta.chapterId, 'activated', null);
        } else if (event.type === 'TOKEN_SPENT') {
          const ts = event as { type: 'TOKEN_SPENT'; granularType: string; tokenId: string; poolRemaining: number };
          const finaleState = state.finaleState as FinaleState | null;
          const spentToken = finaleState?.pool.tokens.find(t => t.id === ts.tokenId);
          const chapterId = spentToken?.chapterId ?? '';
          const loopCount = finaleState?.loopCount ?? null;
          persistence.saveTokenEvent(state.id, ts.tokenId, ts.granularType, chapterId, 'spent', loopCount);
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

  // Fetch audience sockets once — reused for state_sync and all event handlers below.
  // Safe because no sockets can join/leave mid-function (single-threaded event loop).
  const audienceSockets = await io.in('audience').fetchSockets();

  // Each audience member gets their personalized view
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

      case 'ATTEMPT_COLLAPSED': {
        // Distribute intrusive thoughts to audience + projector after collapse
        const attempt = state.attempts[event.attemptIndex];
        if (!attempt) break;
        const thoughtsConfig = findThoughtsConfig(state.config.intrusiveThoughts, attempt.chapter);
        if (!thoughtsConfig) break;

        const connectedUserIds: UserId[] = [];
        for (const s of audienceSockets) {
          const uid = (s as any).userId as UserId | undefined;
          if (uid) connectedUserIds.push(uid);
        }

        activeThoughts = assignThoughts(thoughtsConfig, connectedUserIds, event.attemptIndex);
        console.log(`[Thoughts] Assigned ${activeThoughts.length} thoughts to ${connectedUserIds.length} users`);

        // Send each audience member their thoughts
        for (const s of audienceSockets) {
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
          thoughts: activeThoughts.map(t => ({ id: t.id, text: t.text })),
        });
        break;
      }

      case 'NEXT_QUESTION': {
        // Send next question directly to the specific audience member
        const nextQ = event as { type: 'NEXT_QUESTION'; userId: UserId; questionIndex: number; questionText: string; answers?: Array<{ chapterId: string; label: string }> | null };
        for (const s of audienceSockets) {
          if ((s as any).userId === nextQ.userId) {
            s.emit('question', {
              questionIndex: nextQ.questionIndex,
              text: nextQ.questionText,
              answers: nextQ.answers ?? null,
              chapters: state.config.chapters ?? [],
            });
            break;
          }
        }
        break;
      }

      case 'EMOTION_RECEIVED': {
        // Confirm the vote to the specific audience member
        const er = event as { type: 'EMOTION_RECEIVED'; userId: UserId; chapterId: string; questionIndex: number };
        for (const s of audienceSockets) {
          if ((s as any).userId === er.userId) {
            s.emit('emotion_confirmed', { chapterId: er.chapterId, questionIndex: er.questionIndex });
            break;
          }
        }
        // Relay token fly animation to projector
        io.to('projector').emit('token_fly', { chapterId: er.chapterId });
        break;
      }

      // POOL_CAP_REACHED removed — everyone answers orbsPerPerson questions, no cap

      case 'REMIX_STARTED': {
        // In audience swarm mode, audience keeps their phones for orb placement.
        // In performer-only mode, phones go dark.
        const fs = state.finaleState as FinaleState | null;
        const hasAudienceOrbs = fs && fs.audienceOrbs.size > 0;
        if (!hasAudienceOrbs) {
          io.to('audience').emit('phones_down');
        }
        break;
      }

      case 'TOKEN_ACTIVATED': {
        const ta = event as { type: 'TOKEN_ACTIVATED'; granularType: string; chapterId: string; tokenId: string; trackIndices: number[] };
        io.to('projector').emit('node_update', {
          granularType: ta.granularType,
          chapterId: ta.chapterId,
          status: 'active',
        });
        io.to('controller').emit('node_update', {
          granularType: ta.granularType,
          chapterId: ta.chapterId,
          status: 'active',
        });
        break;
      }

      case 'NODE_SILENT': {
        const ns = event as { type: 'NODE_SILENT'; granularType: string };
        io.to('projector').emit('node_update', {
          granularType: ns.granularType,
          chapterId: null,
          status: 'silent',
        });
        io.to('controller').emit('node_update', {
          granularType: ns.granularType,
          chapterId: null,
          status: 'silent',
        });
        break;
      }

      case 'ORB_DECAYED': {
        // Notify the specific audience member that their orb decayed
        const od = event as { type: 'ORB_DECAYED'; userId: UserId; orbIndex: number; granularType: string };
        for (const s of audienceSockets) {
          if ((s as any).userId === od.userId) {
            s.emit('orb_decayed', { orbIndex: od.orbIndex, granularType: od.granularType });
            break;
          }
        }
        break;
      }

      case 'NODES_SCATTERED': {
        // Notify affected audience members that their orbs were scattered
        const ns2 = event as { type: 'NODES_SCATTERED'; granularType: string | null; affectedUsers: UserId[] };
        for (const s of audienceSockets) {
          const uid = (s as any).userId as UserId | undefined;
          if (uid && ns2.affectedUsers.includes(uid)) {
            s.emit('scatter', { granularType: ns2.granularType });
          }
        }
        // Reset collective scatter votes (whether triggered by audience vote or controller)
        scatterVotes.clear();
        io.to('audience').emit('scatter_vote_count', { count: 0, threshold: 0 });
        break;
      }

      case 'FALLBACK_ACTIVATED': {
        // Performer took over — send phones_down to audience
        io.to('audience').emit('phones_down');
        break;
      }

      case 'VOTE_STARTED': {
        // Send initial questions to all connected audience members
        const voteConfig = state.config.finale.vote;
        if (voteConfig && voteConfig.questions.length > 0) {
          const firstQ = voteConfig.questions[0];
          if (firstQ) {
            for (const s of audienceSockets) {
              s.emit('question', {
                questionIndex: 0,
                text: firstQ.text,
                answers: firstQ.answers ?? null,
                chapters: state.config.chapters ?? [],
              });
            }
          }
        }
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
      let finaleStateForClient: object | null = null;

      if (fs) {
        const finaleFs = fs as FinaleState;
        finaleStateForClient = {
          finalePhase: finaleFs.phase,
          pool: {
            availableByChapter: Array.from(finaleFs.pool.availableByChapter.entries()).map(([chapterId, count]) => ({ chapterId, count })),
            totalByChapter: Array.from(finaleFs.pool.totalByChapter.entries()).map(([chapterId, count]) => ({ chapterId, count })),
            totalRemaining: finaleFs.pool.totalRemaining,
            targetPoolSize: finaleFs.pool.targetPoolSize,
          },
          active: Array.from(finaleFs.active.entries()).map(([granularType, node]) => ({
            granularType,
            chapterId: node.chapterId,
            trackIndices: node.trackIndices,
            persistent: node.persistent,
          })),
          queueDepth: Array.from(finaleFs.queue.entries()).map(([granularType, tokens]) => ({
            granularType,
            depth: tokens.length,
            nextChapterId: tokens[0]?.chapterId ?? null,
          })),
          validNodes: deriveValidNodes(finaleFs),
          loopCount: finaleFs.loopCount,
          loopProgress: finaleFs.loopProgress,
          audienceInteraction: finaleFs.audienceInteraction,
          npcMessage: finaleFs.npc.currentMessage,
          fallbackMode: finaleFs.fallbackMode,
          enabledNodes: Array.from(finaleFs.enabledNodes),
          nodeTallies: Array.from(finaleFs.nodeTallies.entries()).map(([granularType, tally]) => ({
            granularType,
            dominantChapter: tally.locked && tally.lockedChapter ? tally.lockedChapter : tally.dominantChapter,
            locked: tally.locked,
            votes: Array.from(tally.votes.entries()).map(([chapterId, count]) => ({ chapterId, count })),
          })),
          orbDecayLoops: finaleFs.orbDecayLoops,
          instantCrossfade: finaleFs.instantCrossfade,
        };
      }

      return {
        phase: state.phase,
        paused: state.paused,
        version: state.version,
        currentAttemptIndex: state.currentAttemptIndex,
        userCount: state.users.size,
        openerSlideState: state.openerSlideState,
        attempts: state.attempts,
        finaleState: finaleStateForClient,
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
      const fs = state.finaleState as FinaleState | null;
      if (fs) {
        if (state.phase === 'finale_vote') {
          const answeredCount = fs.vote.questionsAnsweredByUser.get(userId) ?? 0;
          const voteConfig = state.config.finale.vote;
          // Resolve NPC intro/outro messages from config for client-side staging
          const npcMessages = state.config.finale.npcMessages ?? [];
          const npcIntro = npcMessages
            .filter((m: { event: string; text: string }) => m.event === 'vote_intro_1' || m.event === 'vote_intro_2')
            .map((m: { text: string }) => m.text);
          const npcOutro = npcMessages.find((m: { event: string }) => m.event === 'vote_outro')?.text ?? null;

          myFinale = {
            finalePhase: 'vote',
            questions: voteConfig?.questions ?? [],
            answeredCount,
            chapters: state.config.chapters ?? [],
            npcMessage: fs.npc.currentMessage,
            npcIntro,
            alarmColor: voteConfig?.alarmColor ?? '#ff0000',
            shuffleQuestions: voteConfig?.shuffleQuestions ?? false,
          };
        } else if (state.phase === 'finale_remix') {
          const userOrbs = fs.audienceOrbs.get(userId);
          myFinale = {
            finalePhase: 'remix',
            npcMessage: fs.npc.currentMessage,
            fallbackMode: fs.fallbackMode,
            orbs: userOrbs?.orbs ?? [],
            nodeTallies: Array.from(fs.nodeTallies.entries()).map(([granularType, tally]) => ({
              granularType,
              votes: Array.from(tally.votes.entries()).map(([chapterId, count]) => ({ chapterId, count })),
              dominantChapter: tally.locked && tally.lockedChapter ? tally.lockedChapter : tally.dominantChapter,
              locked: tally.locked,
              lockedChapter: tally.lockedChapter,
            })),
            chapters: state.config.chapters ?? [],
            granularTypes: state.config.granularTypes ?? [],
            enabledNodes: Array.from(fs.enabledNodes),
            orbDecayLoops: fs.orbDecayLoops,
            instantCrossfade: fs.instantCrossfade,
            loopCount: fs.loopCount,
          };
        }
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

/**
 * Derive valid granularType+chapter combos from the finale trackMap.
 * A combo is valid if trackMap[granularType][songIndex] has entries and
 * the chapter maps to that songIndex via chapterSongIndex.
 */
function deriveValidNodes(fs: FinaleState): Array<{ granularType: string; chapterId: string }> {
  const result: Array<{ granularType: string; chapterId: string }> = [];
  for (const [granularType, songMap] of fs.trackMap.entries()) {
    for (const [songIndex, trackIndices] of songMap.entries()) {
      if (trackIndices.length === 0) continue;
      // Reverse-lookup: find chapterId for this songIndex
      for (const [chapterId, sIdx] of fs.chapterSongIndex.entries()) {
        if (sIdx === songIndex) {
          result.push({ granularType, chapterId });
        }
      }
    }
  }
  return result;
}

#!/usr/bin/env node
/**
 * Audience Simulator — Simulates 40+ audience clients for load testing
 *
 * Creates socket connections that behave like real audience phones:
 * - Joins as audience with unique user IDs
 * - Votes randomly during auditioning phases
 * - Dismisses intrusive thoughts with staggered timing
 * - Claims quilt cells during assignment (V3.3)
 * - Sets song choices and locks in during preview (V3.3)
 * - Moves cells during playback if audience remix enabled (V3.3)
 * - Prints aggregate stats
 *
 * Usage:
 *   npx tsx server/tools/simulate-audience.ts [count] [url]
 *
 * Examples:
 *   npx tsx server/tools/simulate-audience.ts          # 40 clients, localhost:3000
 *   npx tsx server/tools/simulate-audience.ts 60       # 60 clients
 *   npx tsx server/tools/simulate-audience.ts 40 http://192.168.1.5:3000
 */

import { io, Socket } from 'socket.io-client';

const CLIENT_COUNT = parseInt(process.argv[2] || '40', 10);
const SERVER_URL = process.argv[3] || 'http://localhost:3000';

// Timing config for thought dismissal simulation
const MIN_DISMISS_DELAY_MS = 1500;   // Fastest a user would swipe
const MAX_DISMISS_DELAY_MS = 8000;   // Slowest
const DISMISS_STAGGER_MS = 200;      // Per-thought within a user

// V3.3 quilt simulation timing
const CELL_CLAIM_MIN_DELAY_MS = 500;
const CELL_CLAIM_MAX_DELAY_MS = 5000;
const SONG_CHOICE_MIN_DELAY_MS = 1000;
const SONG_CHOICE_MAX_DELAY_MS = 4000;
const LOCK_IN_MIN_DELAY_MS = 2000;
const LOCK_IN_MAX_DELAY_MS = 8000;
const MOVE_CELL_MIN_DELAY_MS = 3000;
const MOVE_CELL_MAX_DELAY_MS = 10000;

interface QuiltCellData {
  id: string;
  rowIndex: number;
  columnIndex: number;
  granularType: string;
  songIndex: number | null;
  chapter: string | null;
  ownerId: string | null;
}

interface QuiltStateData {
  cells: QuiltCellData[];
  columnOrder: number[];
  playheadColumn: number;
  loopCount: number;
}

interface ClientState {
  socket: Socket;
  userId: string;
  connected: boolean;
  phase: string | null;
  layerPhase: string | null;
  myVote: 'A' | 'B' | null;
  thoughts: { id: string; text: string }[];
  thoughtsDismissed: number;
  // V3.3 quilt state
  claimedCellId: string | null;
  songChoice: number | null;
  lockedIn: boolean;
  lastQuiltState: QuiltStateData | null;
}

const clients: ClientState[] = [];
let stats = {
  connected: 0,
  votes: 0,
  thoughtsReceived: 0,
  thoughtsDismissed: 0,
  // V3.3 stats
  cellsClaimed: 0,
  cellsReleased: 0,
  songChoicesSet: 0,
  lockedIn: 0,
  cellMoves: 0,
  quiltStateBroadcasts: 0,
  playheadAdvances: 0,
  lastPlayheadColumn: -1,
};

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function randomDelay(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createClient(index: number): ClientState {
  const userId = `sim-user-${index}-${Date.now().toString(36)}`;
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    autoConnect: false,
  });

  const client: ClientState = {
    socket,
    userId,
    connected: false,
    phase: null,
    layerPhase: null,
    myVote: null,
    thoughts: [],
    thoughtsDismissed: 0,
    claimedCellId: null,
    songChoice: null,
    lockedIn: false,
    lastQuiltState: null,
  };

  socket.on('connect', () => {
    client.connected = true;
    stats.connected++;
    socket.emit('join', {
      userId,
      showId: 'default-show',
      seatId: null,
      mode: 'audience',
      lastVersion: 0,
    });
    if (stats.connected === CLIENT_COUNT) {
      log(`All ${CLIENT_COUNT} clients connected`);
    }
  });

  socket.on('disconnect', () => {
    client.connected = false;
    stats.connected--;
  });

  socket.on('state_sync', (data: any) => {
    const prevPhase = client.phase;
    client.phase = data.phase;

    if (data.currentAttempt) {
      client.layerPhase = data.currentAttempt.currentLayerPhase;
      client.myVote = data.currentAttempt.myVote;

      // Auto-vote during auditioning if we haven't voted yet
      if (client.layerPhase === 'auditioning' && client.myVote === null) {
        const choice = Math.random() > 0.5 ? 'A' : 'B';
        const delay = Math.random() * 3000 + 500; // 0.5-3.5s delay
        setTimeout(() => {
          socket.emit('vote', { choice });
          stats.votes++;
        }, delay);
      }
    }

    // Detect phase transitions for logging
    if (prevPhase !== client.phase && index === 0) {
      log(`Phase transition: ${prevPhase} → ${client.phase}`);
    }
  });

  // ---- V3.3 Quilt Events ----

  socket.on('quilt_state', (data: QuiltStateData) => {
    stats.quiltStateBroadcasts++;
    client.lastQuiltState = data;

    // Track playhead advancement
    if (data.playheadColumn !== stats.lastPlayheadColumn) {
      if (stats.lastPlayheadColumn >= 0) {
        stats.playheadAdvances++;
      }
      stats.lastPlayheadColumn = data.playheadColumn;
    }

    // During assignment: try to claim an unclaimed cell
    if (client.phase === 'finale_assignment' && !client.claimedCellId) {
      const unclaimed = data.cells.filter(c => c.ownerId === null);
      if (unclaimed.length > 0) {
        const target = unclaimed[Math.floor(Math.random() * unclaimed.length)];
        const delay = randomDelay(CELL_CLAIM_MIN_DELAY_MS, CELL_CLAIM_MAX_DELAY_MS);
        setTimeout(() => {
          if (client.phase === 'finale_assignment' && !client.claimedCellId) {
            socket.emit('claim_cell', { cellId: target.id });
            client.claimedCellId = target.id;
            stats.cellsClaimed++;
            if (index < 5) {
              log(`Client ${index}: claimed cell ${target.id}`);
            }
          }
        }, delay);
      }
    }

    // During preview: set song choice and lock in
    if (client.phase === 'finale_preview' && client.claimedCellId && !client.lockedIn) {
      if (client.songChoice === null) {
        // Pick a random song (0, 1, or 2)
        const songIndex = Math.floor(Math.random() * 3);
        const delay = randomDelay(SONG_CHOICE_MIN_DELAY_MS, SONG_CHOICE_MAX_DELAY_MS);
        setTimeout(() => {
          if (client.phase === 'finale_preview' && client.songChoice === null) {
            socket.emit('set_song', { songIndex });
            client.songChoice = songIndex;
            stats.songChoicesSet++;
            if (index < 5) {
              log(`Client ${index}: set song choice to ${songIndex}`);
            }

            // After choosing, lock in after another delay
            const lockDelay = randomDelay(LOCK_IN_MIN_DELAY_MS, LOCK_IN_MAX_DELAY_MS);
            setTimeout(() => {
              if (client.phase === 'finale_preview' && !client.lockedIn) {
                socket.emit('lock_in');
                client.lockedIn = true;
                stats.lockedIn++;
                if (index < 5) {
                  log(`Client ${index}: locked in`);
                }
              }
            }, lockDelay);
          }
        }, delay);
      }
    }

    // During playback: occasionally move cells (if audience remix is enabled)
    if (client.phase === 'finale_playback' && client.claimedCellId && Math.random() < 0.02) {
      // Find a random cell to swap with (low probability per broadcast)
      const otherCells = data.cells.filter(c => c.id !== client.claimedCellId);
      if (otherCells.length > 0) {
        const target = otherCells[Math.floor(Math.random() * otherCells.length)];
        const delay = randomDelay(MOVE_CELL_MIN_DELAY_MS, MOVE_CELL_MAX_DELAY_MS);
        setTimeout(() => {
          if (client.phase === 'finale_playback') {
            socket.emit('move_cell', { targetCellId: target.id });
            stats.cellMoves++;
            if (index < 3) {
              log(`Client ${index}: moved cell to ${target.id}`);
            }
          }
        }, delay);
      }
    }
  });

  socket.on('cell_claimed', (data: { cellId: string; userId: string }) => {
    // Update local tracking if our cell got claimed by someone else (shouldn't happen but defensive)
    if (data.userId === client.userId) {
      client.claimedCellId = data.cellId;
    }
  });

  socket.on('playhead_update', (data: { columnIndex: number }) => {
    // Playhead column boundary crossing
    if (index === 0 && stats.playheadAdvances % 10 === 0) {
      log(`Playhead at column ${data.columnIndex}`);
    }
  });

  // Handle server-assigned intrusive thoughts
  socket.on('thoughts_assigned', (data: { thoughts: { id: string; text: string }[] }) => {
    client.thoughts = data.thoughts;
    stats.thoughtsReceived += data.thoughts.length;
    log(`Client ${index}: received ${data.thoughts.length} thoughts`);

    setTimeout(() => {
      simulateDismissals(client, index);
    }, 30000);
  });

  socket.on('thoughts_clear', () => {
    client.thoughts = [];
  });

  return client;
}

function simulateDismissals(client: ClientState, index: number) {
  // Random initial delay before user starts swiping
  const startDelay = MIN_DISMISS_DELAY_MS + Math.random() * (MAX_DISMISS_DELAY_MS - MIN_DISMISS_DELAY_MS);

  client.thoughts.forEach((thought, i) => {
    const delay = startDelay + i * (DISMISS_STAGGER_MS + Math.random() * 1000);
    setTimeout(() => {
      if (!client.thoughts.find(t => t.id === thought.id)) return; // Already cleared
      const direction = Math.random() > 0.5 ? 'right' : 'left';
      client.socket.emit('dismiss_thought', { thoughtId: thought.id, direction });
      client.thoughtsDismissed++;
      stats.thoughtsDismissed++;
    }, delay);
  });
}

// ============================================================================
// Main
// ============================================================================

log(`Starting ${CLIENT_COUNT} simulated audience clients → ${SERVER_URL}`);

for (let i = 0; i < CLIENT_COUNT; i++) {
  const client = createClient(i);
  clients.push(client);
  // Stagger connections slightly to avoid thundering herd
  setTimeout(() => client.socket.connect(), i * 50);
}

// Print stats periodically
setInterval(() => {
  const quiltLine = stats.quiltStateBroadcasts > 0
    ? `, quilt_state: ${stats.quiltStateBroadcasts}, playhead: ${stats.playheadAdvances} advances`
    : '';
  const claimLine = stats.cellsClaimed > 0
    ? `, cells: ${stats.cellsClaimed} claimed, songs: ${stats.songChoicesSet} set, locked: ${stats.lockedIn}, moves: ${stats.cellMoves}`
    : '';
  log(`Stats: ${stats.connected} connected, ${stats.votes} votes, ${stats.thoughtsReceived}/${stats.thoughtsDismissed} thoughts${quiltLine}${claimLine}`);
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  for (const client of clients) {
    client.socket.disconnect();
  }
  process.exit(0);
});

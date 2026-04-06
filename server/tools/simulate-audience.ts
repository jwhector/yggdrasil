#!/usr/bin/env node
/**
 * Audience Simulator — Simulates 40+ audience clients for load testing
 *
 * Creates socket connections that behave like real audience phones:
 * - Joins as audience with unique user IDs
 * - Votes randomly during auditioning phases
 * - Dismisses intrusive thoughts with staggered timing
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

interface ClientState {
  socket: Socket;
  userId: string;
  connected: boolean;
  phase: string | null;
  layerPhase: string | null;
  myVote: 'A' | 'B' | null;
  thoughts: { id: string; text: string }[];
  thoughtsDismissed: number;
}

const clients: ClientState[] = [];
let stats = {
  connected: 0,
  votes: 0,
  thoughtsReceived: 0,
  thoughtsDismissed: 0,
};

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
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
    client.phase = data.phase;
    if (data.currentAttempt) {
      client.layerPhase = data.currentAttempt.currentLayerPhase;
      client.myVote = data.currentAttempt.myVote;

      // Auto-vote during auditioning if we haven't voted yet
      if (client.layerPhase === 'auditioning' && client.myVote === null) {
        const choice = Math.random() > 0.5 ? 'A' : 'B';
        const delay = Math.random() * 3000 + 500; // 0.5–3.5s delay
        setTimeout(() => {
          socket.emit('vote', { choice });
          stats.votes++;
        }, delay);
      }
    }
  });

  // Handle server-assigned intrusive thoughts
  socket.on('thoughts_assigned', (data: { thoughts: { id: string; text: string }[] }) => {
    client.thoughts = data.thoughts;
    stats.thoughtsReceived += data.thoughts.length;
    log(`Client ${index}: received ${data.thoughts.length} thoughts`);

    setTimeout(() => {
      simulateDismissals(client, index);
    }, 10000);

    // Simulate staggered dismissal
    // simulateDismissals(client, index);
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
  log(`Stats: ${stats.connected} connected, ${stats.votes} votes, ${stats.thoughtsReceived} thoughts received, ${stats.thoughtsDismissed} dismissed`);
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  for (const client of clients) {
    client.socket.disconnect();
  }
  process.exit(0);
});

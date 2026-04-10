#!/usr/bin/env node
/**
 * Audience Simulator — Simulates 40+ audience clients for load testing
 *
 * Creates socket connections that behave like real audience phones:
 * - Joins as audience with unique user IDs
 * - Votes randomly during auditioning phases
 * - Dismisses intrusive thoughts with staggered timing
 * - Answers emotional questions during finale_vote (V3.4)
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

// V3.4 vote timing
const VOTE_MIN_DELAY_MS = 1000;      // Fastest answer
const VOTE_MAX_DELAY_MS = 5000;      // Slowest answer

const CHAPTERS = ['ambition', 'love', 'avoidance'];

interface ClientState {
  socket: Socket;
  userId: string;
  connected: boolean;
  phase: string | null;
  layerPhase: string | null;
  myVote: 'A' | 'B' | null;
  thoughts: { id: string; text: string }[];
  thoughtsDismissed: number;
  // V3.4 vote state
  pendingQuestion: { questionIndex: number; text: string } | null;
  questionsAnswered: number;
  phonesDark: boolean;
}

const clients: ClientState[] = [];
let stats = {
  connected: 0,
  votes: 0,
  thoughtsReceived: 0,
  thoughtsDismissed: 0,
  // V3.4 stats
  questionsReceived: 0,
  emotionsSubmitted: 0,
  phonesDark: 0,
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
    pendingQuestion: null,
    questionsAnswered: 0,
    phonesDark: false,
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

    // V3.4: first question arrives embedded in state_sync myFinale
    if (client.phase === 'finale_vote' && data.myFinale && !client.phonesDark) {
      const voteView = data.myFinale as {
        finalePhase: string;
        currentQuestion: { questionIndex: number; text: string } | null;
        poolCapReached: boolean;
      };
      if (voteView.poolCapReached) {
        client.phonesDark = true;
      } else if (voteView.currentQuestion && !client.pendingQuestion) {
        answerQuestion(client, index, voteView.currentQuestion);
      }
    }
  });

  // ---- V3.4 Finale Vote Events ----

  // Server sends subsequent questions via this event
  socket.on('question', (data: { questionIndex: number; text: string }) => {
    stats.questionsReceived++;
    if (index < 3) {
      log(`Client ${index}: received question ${data.questionIndex}: "${data.text}"`);
    }
    answerQuestion(client, index, data);
  });

  // Server confirms our emotion was received
  socket.on('emotion_confirmed', (_data: { chapterId: string; questionIndex: number }) => {
    // No action needed — next question will arrive via 'question' event
  });

  // Pool is full — phones go dark
  socket.on('phones_down', () => {
    client.phonesDark = true;
    client.pendingQuestion = null;
    stats.phonesDark++;
    if (index < 3) {
      log(`Client ${index}: phones down (answered ${client.questionsAnswered} questions)`);
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

function answerQuestion(client: ClientState, index: number, question: { questionIndex: number; text: string }) {
  if (client.phonesDark || client.pendingQuestion) return; // Already answering or dark
  client.pendingQuestion = question;

  const delay = randomDelay(VOTE_MIN_DELAY_MS, VOTE_MAX_DELAY_MS);
  setTimeout(() => {
    if (client.pendingQuestion && !client.phonesDark) {
      const chapterId = CHAPTERS[Math.floor(Math.random() * CHAPTERS.length)];
      client.socket.emit('submit_emotion', {
        chapterId,
        questionIndex: client.pendingQuestion.questionIndex,
      });
      stats.emotionsSubmitted++;
      client.questionsAnswered++;
      client.pendingQuestion = null;

      if (index < 3) {
        log(`Client ${index}: answered with ${chapterId} (total: ${client.questionsAnswered})`);
      }
    }
  }, delay);
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
  const voteLine = stats.emotionsSubmitted > 0
    ? `, emotions: ${stats.emotionsSubmitted} submitted, questions: ${stats.questionsReceived} received, dark: ${stats.phonesDark}`
    : '';
  const thoughtLine = stats.thoughtsReceived > 0
    ? `, thoughts: ${stats.thoughtsReceived}/${stats.thoughtsDismissed}`
    : '';
  log(`Stats: ${stats.connected} connected, ${stats.votes} votes${voteLine}${thoughtLine}`);
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  for (const client of clients) {
    client.socket.disconnect();
  }
  process.exit(0);
});

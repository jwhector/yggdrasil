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

// V3.4 remix orb timing
const ORB_INITIAL_PLACE_MIN_MS = 2000;    // First orb placement delay
const ORB_INITIAL_PLACE_MAX_MS = 8000;
const ORB_PLACE_STAGGER_MS = 1500;        // Delay between placing successive orbs
const ORB_REPLACE_MIN_MS = 10000;         // Min time before moving an orb
const ORB_REPLACE_MAX_MS = 30000;         // Max time before moving an orb
const ORB_REPLACE_CHANCE = 0.4;           // Probability of moving (vs doing nothing) per tick

const CHAPTERS = ['ambition', 'love', 'acceptance'];
const GRANULAR_TYPES = ['bass', 'drums', 'pad', 'harmony', 'fx', 'seed'];

interface OrbState {
  index: number;
  chapterId: string;
  placedOnNode: string | null;
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
  // V3.4 vote state
  pendingQuestion: { questionIndex: number; text: string } | null;
  questionsAnswered: number;
  phonesDark: boolean;
  // V3.4 remix orb state
  orbs: OrbState[];
  orbsPlaced: boolean;       // True once initial placement is done
  replaceTimer: ReturnType<typeof setTimeout> | null;
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
  // V3.4 remix stats
  orbsPlaced: 0,
  orbsRecalled: 0,
  orbsMoved: 0,
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
    orbs: [],
    orbsPlaced: false,
    replaceTimer: null,
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

    // V3.4: detect finale_vote and bootstrap first question from the questions array
    if (client.phase === 'finale_vote' && data.myFinale && !client.phonesDark) {
      const voteView = data.myFinale as {
        finalePhase: string;
        questions: { text: string }[];
        answeredCount: number;
        poolCapReached: boolean;
      };
      if (voteView.poolCapReached) {
        client.phonesDark = true;
      } else if (
        voteView.questions &&
        voteView.answeredCount === client.questionsAnswered &&
        client.questionsAnswered < voteView.questions.length &&
        !client.pendingQuestion
      ) {
        // Counts match and we're not already answering — bootstrap next question
        const nextQ = voteView.questions[voteView.answeredCount];
        if (nextQ) {
          answerQuestion(client, index, { questionIndex: voteView.answeredCount, text: nextQ.text });
        }
      }
    }

    // V3.4 remix: receive orbs and start placing them
    if (client.phase === 'finale_remix' && data.myFinale) {
      const remixView = data.myFinale as {
        finalePhase: string;
        fallbackMode: boolean;
        orbs: { index: number; chapterId: string; placedOnNode: string | null }[];
      };
      if (remixView.finalePhase === 'remix' && !remixView.fallbackMode) {
        // Initialize local orb state from server on first sync
        if (client.orbs.length === 0 && remixView.orbs.length > 0) {
          client.orbs = remixView.orbs.map(o => ({
            index: o.index,
            chapterId: o.chapterId,
            placedOnNode: o.placedOnNode,
          }));
          client.phonesDark = false;

          if (index < 3) {
            log(`Client ${index}: received ${client.orbs.length} orbs (chapters: ${client.orbs.map(o => o.chapterId).join(', ')})`);
          }

          // Start placing orbs with a staggered delay
          if (!client.orbsPlaced) {
            simulateInitialPlacement(client, index);
          }
        }
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

  // ---- V3.4 Remix Orb Events ----

  socket.on('orb_decayed', (data: { orbIndex: number }) => {
    const orb = client.orbs[data.orbIndex];
    if (orb) {
      orb.placedOnNode = null;
      // Re-place the decayed orb after a short delay
      const delay = randomDelay(2000, 6000);
      setTimeout(() => {
        if (client.phase !== 'finale_remix' || client.phonesDark) return;
        const node = GRANULAR_TYPES[Math.floor(Math.random() * GRANULAR_TYPES.length)];
        placeOrbOnNode(client, index, data.orbIndex, node);
      }, delay);
    }
  });

  socket.on('scatter', (_data: { granularType: string | null }) => {
    // All our orbs were scattered — re-place them staggered
    for (const orb of client.orbs) {
      orb.placedOnNode = null;
    }
    if (index < 3) {
      log(`Client ${index}: orbs scattered, re-placing...`);
    }
    simulateInitialPlacement(client, index);
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
// Remix Orb Simulation
// ============================================================================

/**
 * Place a single orb on a node. Emits socket event and updates local state.
 */
function placeOrbOnNode(client: ClientState, index: number, orbIndex: number, granularType: string) {
  if (client.phase !== 'finale_remix' || client.phonesDark) return;
  const orb = client.orbs[orbIndex];
  if (!orb) return;

  const wasPlaced = orb.placedOnNode !== null;
  const prevNode = orb.placedOnNode;
  orb.placedOnNode = granularType;
  client.socket.emit('place_orb', { orbIndex, granularType });

  if (wasPlaced && prevNode !== granularType) {
    stats.orbsMoved++;
  } else if (!wasPlaced) {
    stats.orbsPlaced++;
  }

  if (index < 3) {
    const action = wasPlaced ? `moved orb ${orbIndex} ${prevNode}→${granularType}` : `placed orb ${orbIndex} on ${granularType}`;
    log(`Client ${index}: ${action} (${orb.chapterId})`);
  }
}

/**
 * Simulate initial orb placement — stagger placing all orbs over several seconds.
 * Mimics a user discovering the UI and placing orbs one by one.
 */
function simulateInitialPlacement(client: ClientState, index: number) {
  const startDelay = randomDelay(ORB_INITIAL_PLACE_MIN_MS, ORB_INITIAL_PLACE_MAX_MS);

  client.orbs.forEach((orb, i) => {
    if (orb.placedOnNode !== null) return; // Already placed (e.g. from state recovery)
    const delay = startDelay + i * (ORB_PLACE_STAGGER_MS + Math.random() * 1500);
    setTimeout(() => {
      if (client.phase !== 'finale_remix' || client.phonesDark) return;
      if (orb.placedOnNode !== null) return; // Placed by a scatter re-place in the interim
      const node = GRANULAR_TYPES[Math.floor(Math.random() * GRANULAR_TYPES.length)];
      placeOrbOnNode(client, index, i, node);
    }, delay);
  });

  // After all initial placements, start the replace loop
  const totalPlacementTime = startDelay + client.orbs.length * (ORB_PLACE_STAGGER_MS + 1500);
  setTimeout(() => {
    client.orbsPlaced = true;
    startReplaceLoop(client, index);
  }, totalPlacementTime);
}

/**
 * Periodically move a random placed orb to a different node.
 * Simulates audience engagement — people shift votes over time.
 */
function startReplaceLoop(client: ClientState, index: number) {
  function scheduleNext() {
    if (client.phase !== 'finale_remix' || client.phonesDark) {
      client.replaceTimer = null;
      return;
    }

    const delay = randomDelay(ORB_REPLACE_MIN_MS, ORB_REPLACE_MAX_MS);
    client.replaceTimer = setTimeout(() => {
      if (client.phase !== 'finale_remix' || client.phonesDark) return;

      if (Math.random() < ORB_REPLACE_CHANCE) {
        // Pick a random placed orb and move it to a different node
        const placedOrbs = client.orbs.filter(o => o.placedOnNode !== null);
        if (placedOrbs.length > 0) {
          const orb = placedOrbs[Math.floor(Math.random() * placedOrbs.length)];
          // Pick a different node
          const otherNodes = GRANULAR_TYPES.filter(n => n !== orb.placedOnNode);
          const newNode = otherNodes[Math.floor(Math.random() * otherNodes.length)];
          placeOrbOnNode(client, index, orb.index, newNode);
        }
      }

      scheduleNext();
    }, delay);
  }

  scheduleNext();
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
  const orbLine = stats.orbsPlaced > 0
    ? `, orbs: ${stats.orbsPlaced} placed, ${stats.orbsMoved} moved, ${stats.orbsRecalled} recalled`
    : '';
  log(`Stats: ${stats.connected} connected, ${stats.votes} votes${voteLine}${thoughtLine}${orbLine}`);
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  for (const client of clients) {
    if (client.replaceTimer) clearTimeout(client.replaceTimer);
    client.socket.disconnect();
  }
  process.exit(0);
});

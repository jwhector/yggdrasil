#!/usr/bin/env node
/**
 * Audience Simulator — Simulates 40+ audience clients for load testing
 *
 * Creates socket connections that behave like real audience phones:
 * - Responds to server heartbeat pings (keeps connection alive)
 * - Joins as audience with unique user IDs
 * - Votes randomly during auditioning phases
 * - Receives intrusive thoughts (no dismissal — show isn't blocked)
 * - Answers emotional questions during finale_vote (V3.4)
 *   Questions are iterated CLIENT-SIDE from the full array (matching real EmotionVote behavior).
 *   Only submit_emotion is sent to the server — no server round-trips for question pacing.
 * - Places/moves orbs during finale_remix
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

// V3.4 vote timing — simulates human reading + deciding time
const VOTE_MIN_DELAY_MS = 2000;      // Fastest answer (intro confirm + read + tap)
const VOTE_MAX_DELAY_MS = 6000;      // Slowest answer
const INTRO_CONFIRM_DELAY_MS = 4000; // Time to read NPC intro before tapping "I understand"

// V3.4 remix orb timing
const ORB_INITIAL_PLACE_MIN_MS = 2000;    // First orb placement delay
const ORB_INITIAL_PLACE_MAX_MS = 8000;
const ORB_PLACE_STAGGER_MS = 1500;        // Delay between placing successive orbs
const ORB_REPLACE_MIN_MS = 1000;         // Min time before moving an orb
const ORB_REPLACE_MAX_MS = 20000;         // Max time before moving an orb
const ORB_REPLACE_CHANCE = 1;           // Probability of moving (vs doing nothing) per tick
const SCATTER_VOTE_CHANCE = 0.15;      // Probability of voting to scatter per replace tick

const CHAPTERS = ['ambition', 'love', 'acceptance'];
const GRANULAR_TYPES = ['bass', 'drums', 'pad', 'harmony', 'fx', 'seed'];

// ============================================================================
// Deterministic shuffle — mirrors conductor/question-engine.ts + EmotionVote.tsx
// ============================================================================

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

function nextHash(hash: number): number {
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = (hash >>> 16) ^ hash;
  return hash | 0;
}

function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let hash = hashString(seed);
  for (let i = result.length - 1; i > 0; i--) {
    hash = nextHash(hash);
    const j = Math.abs(hash) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Types
// ============================================================================

interface QuestionDef {
  text: string;
  answers?: Array<{ chapterId: string; label: string }>;
}

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
  // V3.4 vote state — client-side iteration (matching real EmotionVote)
  questions: QuestionDef[];          // Full questions array from state_sync
  shuffleQuestions: boolean;
  questionIndex: number;             // Current position in the (possibly shuffled) array
  isAnswering: boolean;              // True while a setTimeout is pending for the current question
  voteStarted: boolean;              // True once we've begun the local iteration loop
  phonesDark: boolean;
  // V3.4 remix orb state
  orbs: OrbState[];
  orbsPlaced: boolean;               // True once initial placement is done
  replaceTimer: ReturnType<typeof setTimeout> | null;
  hasVotedScatter: boolean;          // True after voting to scatter this cycle
}

const clients: ClientState[] = [];
let stats = {
  connected: 0,
  votes: 0,
  thoughtsReceived: 0,
  // V3.4 stats
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

// ============================================================================
// Client-side question iteration (matches real EmotionVote behavior)
// ============================================================================

/**
 * Begin the local question iteration loop for a client.
 * Mirrors EmotionVote: intro stage → question stage → submit_emotion → next → done.
 * Questions are iterated locally; only submit_emotion is sent to the server.
 */
function startVoteLoop(client: ClientState, index: number) {
  if (client.voteStarted || client.phonesDark) return;
  if (client.questions.length === 0) return;
  client.voteStarted = true;

  // Order questions — shuffled with userId seed if configured (matching real client)
  const ordered = client.shuffleQuestions
    ? shuffleWithSeed(client.questions, client.userId)
    : [...client.questions];

  // Simulate the intro stage: NPC typewriter + "I understand" button
  const introDelay = INTRO_CONFIRM_DELAY_MS + randomDelay(500, 2000);
  if (index < 3) {
    log(`Client ${index}: entering vote intro (${Math.round(introDelay)}ms)`);
  }

  setTimeout(() => {
    if (client.phonesDark || client.phase !== 'finale_vote') return;
    if (index < 3) {
      log(`Client ${index}: intro confirmed, starting questions (${ordered.length} total)`);
    }
    answerNextQuestion(client, index, ordered);
  }, introDelay);
}

/**
 * Answer the current question and schedule the next one.
 * Recursive chain that mirrors the real client's tap → fly animation → advance cycle.
 */
function answerNextQuestion(client: ClientState, index: number, ordered: QuestionDef[]) {
  if (client.phonesDark || client.phase !== 'finale_vote') return;
  if (client.questionIndex >= ordered.length) {
    // All questions answered — phones go to "done" state (real client shows "Your intentions have been heard")
    if (index < 3) {
      log(`Client ${index}: all ${ordered.length} questions answered`);
    }
    return;
  }

  const _question = ordered[client.questionIndex];
  if (!_question) return;
  client.isAnswering = true;

  // Simulate reading + deciding time
  const delay = randomDelay(VOTE_MIN_DELAY_MS, VOTE_MAX_DELAY_MS);
  setTimeout(() => {
    if (client.phonesDark || client.phase !== 'finale_vote') {
      client.isAnswering = false;
      return;
    }

    // Pick a chapter to vote for
    const chapterId = CHAPTERS[Math.floor(Math.random() * CHAPTERS.length)];

    // Emit to server (matching real client's handleAnswerTap)
    client.socket.emit('submit_emotion', {
      chapterId,
      questionIndex: client.questionIndex,
    });
    stats.emotionsSubmitted++;

    if (index < 3) {
      log(`Client ${index}: answered q${client.questionIndex} with ${chapterId} (${client.questionIndex + 1}/${ordered.length})`);
    }

    // Advance locally (real client does this after fly animation — ~1100ms)
    client.questionIndex++;
    client.isAnswering = false;

    // Schedule next question after a brief "fly animation" pause
    setTimeout(() => {
      answerNextQuestion(client, index, ordered);
    }, 1100 + randomDelay(200, 800));
  }, delay);
}

// ============================================================================
// Client creation
// ============================================================================

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
    questions: [],
    shuffleQuestions: false,
    questionIndex: 0,
    isAnswering: false,
    voteStarted: false,
    phonesDark: false,
    orbs: [],
    orbsPlaced: false,
    replaceTimer: null,
    hasVotedScatter: false,
  };

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Heartbeat — respond to server pings to stay connected
  // Matches useSocket.ts: server sends 'ping', client responds 'pong'
  // ------------------------------------------------------------------
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // ------------------------------------------------------------------
  // State sync — main state update handler
  // ------------------------------------------------------------------

  socket.on('state_sync', (data: any) => {
    const prevPhase = client.phase;
    client.phase = data.phase;

    // ---- Song-building: auto-vote ----
    if (data.currentAttempt) {
      client.layerPhase = data.currentAttempt.currentLayerPhase;
      client.myVote = data.currentAttempt.myVote;

      if (client.layerPhase === 'auditioning' && client.myVote === null) {
        const choice = Math.random() > 0.5 ? 'A' : 'B';
        const delay = Math.random() * 3000 + 500; // 0.5-3.5s delay
        setTimeout(() => {
          socket.emit('vote', { choice });
          stats.votes++;
        }, delay);
      }
    }

    // ---- Phase transition logging ----
    if (prevPhase !== client.phase && index === 0) {
      log(`Phase transition: ${prevPhase} → ${client.phase}`);
    }

    // ---- Finale vote: capture questions array and start local iteration ----
    if (client.phase === 'finale_vote' && data.myFinale && !client.phonesDark) {
      const voteView = data.myFinale as {
        finalePhase: string;
        questions: QuestionDef[];
        answeredCount: number;
        shuffleQuestions?: boolean;
      };

      // Capture questions on first state_sync during vote phase
      if (voteView.questions && client.questions.length === 0) {
        client.questions = voteView.questions;
        client.shuffleQuestions = voteView.shuffleQuestions ?? false;
        client.questionIndex = voteView.answeredCount ?? 0;

        if (index < 3) {
          log(`Client ${index}: received ${client.questions.length} questions (shuffle=${client.shuffleQuestions})`);
        }
      }

      // Start the local question loop (no-op if already started)
      startVoteLoop(client, index);
    }

    // ---- Finale remix: receive orbs and start placing them ----
    if (client.phase === 'finale_remix' && data.myFinale) {
      const remixView = data.myFinale as {
        finalePhase: string;
        fallbackMode: boolean;
        orbs: { index: number; chapterId: string; placedOnNode: string | null }[];
      };
      if (remixView.finalePhase === 'remix' && !remixView.fallbackMode) {
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

          if (!client.orbsPlaced) {
            simulateInitialPlacement(client, index);
          }
        }
      }
    }
  });

  // ------------------------------------------------------------------
  // Finale vote events (server-side confirmation — no action needed)
  // ------------------------------------------------------------------

  socket.on('emotion_confirmed', () => {
    // Server confirmed our emotion. Question pacing is local — nothing to do.
  });

  socket.on('phones_down', () => {
    client.phonesDark = true;
    client.isAnswering = false;
    stats.phonesDark++;
    if (index < 3) {
      log(`Client ${index}: phones down (answered ${client.questionIndex} questions)`);
    }
  });

  // ------------------------------------------------------------------
  // Finale remix events
  // ------------------------------------------------------------------

  socket.on('orb_decayed', (data: { orbIndex: number }) => {
    const orb = client.orbs[data.orbIndex];
    if (orb) {
      orb.placedOnNode = null;
      const delay = randomDelay(2000, 6000);
      setTimeout(() => {
        if (client.phase !== 'finale_remix' || client.phonesDark) return;
        const node = GRANULAR_TYPES[Math.floor(Math.random() * GRANULAR_TYPES.length)];
        placeOrbOnNode(client, index, data.orbIndex, node);
      }, delay);
    }
  });

  socket.on('scatter', (_data: { granularType: string | null }) => {
    for (const orb of client.orbs) {
      orb.placedOnNode = null;
    }
    if (index < 3) {
      log(`Client ${index}: orbs scattered, re-placing...`);
    }
    client.orbsPlaced = false;
    client.hasVotedScatter = false;
    simulateInitialPlacement(client, index);
  });

  socket.on('scatter_vote_count', (data: { count: number; threshold: number }) => {
    if (data.count === 0) {
      client.hasVotedScatter = false;
    }
    if (index < 3) {
      log(`Client ${index}: scatter vote ${data.count}/${data.threshold}`);
    }
  });

  // ------------------------------------------------------------------
  // Intrusive thoughts — receive and track (dismissal not wired on server)
  // ------------------------------------------------------------------

  socket.on('thoughts_assigned', (data: { thoughts: { id: string; text: string }[] }) => {
    client.thoughts = data.thoughts;
    stats.thoughtsReceived += data.thoughts.length;
    if (index < 3) {
      log(`Client ${index}: received ${data.thoughts.length} thoughts`);
    }
  });

  socket.on('thoughts_clear', () => {
    client.thoughts = [];
  });

  // ------------------------------------------------------------------
  // Server-initiated events
  // ------------------------------------------------------------------

  socket.on('npc_message', () => {
    // Display-only — no action needed
  });

  socket.on('force_reconnect', () => {
    log(`Client ${index}: force_reconnect received, reconnecting...`);
    socket.disconnect();
    setTimeout(() => socket.connect(), 100);
  });

  return client;
}

// ============================================================================
// Remix Orb Simulation
// ============================================================================

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

function simulateInitialPlacement(client: ClientState, index: number) {
  const startDelay = randomDelay(ORB_INITIAL_PLACE_MIN_MS, ORB_INITIAL_PLACE_MAX_MS);

  client.orbs.forEach((orb, i) => {
    if (orb.placedOnNode !== null) return;
    const delay = startDelay + i * (ORB_PLACE_STAGGER_MS + Math.random() * 1500);
    setTimeout(() => {
      if (client.phase !== 'finale_remix' || client.phonesDark) return;
      if (orb.placedOnNode !== null) return;
      const node = GRANULAR_TYPES[Math.floor(Math.random() * GRANULAR_TYPES.length)];
      placeOrbOnNode(client, index, i, node);
    }, delay);
  });

  const totalPlacementTime = startDelay + client.orbs.length * (ORB_PLACE_STAGGER_MS + 1500);
  setTimeout(() => {
    client.orbsPlaced = true;
    startReplaceLoop(client, index);
  }, totalPlacementTime);
}

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
        const placedOrbs = client.orbs.filter(o => o.placedOnNode !== null);
        if (placedOrbs.length > 0) {
          const orb = placedOrbs[Math.floor(Math.random() * placedOrbs.length)];
          const otherNodes = GRANULAR_TYPES.filter(n => n !== orb.placedOnNode);
          const newNode = otherNodes[Math.floor(Math.random() * otherNodes.length)];
          placeOrbOnNode(client, index, orb.index, newNode);
        }
      }

      // Occasionally vote to scatter
      if (!client.hasVotedScatter && Math.random() < SCATTER_VOTE_CHANCE) {
        client.hasVotedScatter = true;
        client.socket.emit('vote_scatter');
        if (index < 3) {
          log(`Client ${index}: voted to scatter`);
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
    ? `, emotions: ${stats.emotionsSubmitted} submitted, dark: ${stats.phonesDark}`
    : '';
  const thoughtLine = stats.thoughtsReceived > 0
    ? `, thoughts: ${stats.thoughtsReceived}`
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

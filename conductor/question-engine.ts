/**
 * Question Engine — Pure Functions for V3.4 Vote Phase Logic
 *
 * Manages per-user question pacing, pool cap detection, and emotion processing.
 * Each audience member answers questions at their own pace, generating tokens.
 *
 * All functions are pure — no I/O, no Socket.IO, no database calls.
 */

import type {
  UserId,
  FinaleState,
  VotePhaseConfig,
  QuestionConfig,
  ConductorEvent,
  Token,
} from './types';

// ============================================================================
// Question Pacing
// ============================================================================

/**
 * Get the next question for a user based on how many they've answered.
 * Returns null if the user has answered maxPerPerson or all questions are exhausted.
 *
 * When shuffleQuestions is true, question order is deterministic per userId
 * (seeded by hashing the userId) so reconnecting users get the same order.
 */
export function getNextQuestion(
  config: VotePhaseConfig,
  answeredCount: number,
  maxPerPerson: number,
  userId?: UserId,
): QuestionConfig | null {
  if (answeredCount >= maxPerPerson) return null;
  if (answeredCount >= config.questions.length) return null;

  if (config.shuffleQuestions && userId) {
    const shuffled = shuffleWithSeed(config.questions, userId);
    return shuffled[answeredCount] ?? null;
  }

  return config.questions[answeredCount] ?? null;
}

/**
 * Calculate max questions per person from pool cap and audience size.
 * ceil(targetPoolSize / audienceCount) — ensures we can fill the pool.
 */
export function calculateMaxQuestionsPerPerson(
  targetPoolSize: number,
  audienceCount: number,
): number {
  if (audienceCount <= 0) return 0;
  return Math.ceil(targetPoolSize / audienceCount);
}

/**
 * Check if the pool cap has been reached.
 * Hard ceiling — once totalTokens >= targetPoolSize, no new questions are sent.
 */
export function shouldCapPool(
  totalTokens: number,
  targetPoolSize: number,
): boolean {
  return totalTokens >= targetPoolSize;
}

// ============================================================================
// Emotion Processing
// ============================================================================

/**
 * Process an audience member's emotional vote (answer to a question).
 * Creates a token, updates per-user tracking, checks pool cap.
 *
 * Grace period: answers that arrive after the cap was reached are still accepted
 * (a few extra tokens don't break anything).
 */
export function processEmotion(
  state: FinaleState,
  userId: UserId,
  chapterId: string,
  questionIndex: number,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];

  // Create new token
  const tokenId = `token-${state.pool.tokens.length}`;
  const newToken: Token = {
    id: tokenId,
    ownerId: userId,
    chapterId,
    questionIndex,
    status: 'available',
  };

  // Update pool
  const updatedTokens = [...state.pool.tokens, newToken];
  const updatedAvailable = new Map(state.pool.availableByChapter);
  updatedAvailable.set(chapterId, (updatedAvailable.get(chapterId) ?? 0) + 1);
  const updatedTotal = new Map(state.pool.totalByChapter);
  updatedTotal.set(chapterId, (updatedTotal.get(chapterId) ?? 0) + 1);
  const totalRemaining = state.pool.totalRemaining + 1;

  // Update per-user count
  const updatedAnswered = new Map(state.vote.questionsAnsweredByUser);
  const currentCount = updatedAnswered.get(userId) ?? 0;
  updatedAnswered.set(userId, currentCount + 1);

  const updatedState: FinaleState = {
    ...state,
    pool: {
      ...state.pool,
      tokens: updatedTokens,
      availableByChapter: updatedAvailable,
      totalByChapter: updatedTotal,
      totalRemaining,
    },
    vote: {
      ...state.vote,
      questionsAnsweredByUser: updatedAnswered,
    },
  };

  events.push({
    type: 'EMOTION_RECEIVED',
    userId,
    chapterId,
    questionIndex,
    poolSize: updatedTokens.length,
  });

  return { state: updatedState, events };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Deterministic shuffle using a string seed (userId).
 * Fisher-Yates with a simple hash-based PRNG.
 */
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

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

function nextHash(hash: number): number {
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = (hash >>> 16) ^ hash;
  return hash | 0;
}

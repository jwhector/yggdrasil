/**
 * Question Engine Tests (V3.4)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import {
  getNextQuestion,
  calculateMaxQuestionsPerPerson,
  shouldCapPool,
  processEmotion,
} from '../question-engine';
import type { FinaleState, VotePhaseConfig } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeVoteConfig(overrides?: Partial<VotePhaseConfig>): VotePhaseConfig {
  return {
    questions: [
      { text: 'What does he need to hear?' },
      { text: 'What are you afraid of?' },
      { text: 'What would you forgive?' },
      { text: 'What do you keep going back to?' },
      { text: 'What would you give up?' },
    ],
    shuffleQuestions: false,
    targetPoolSize: 120,
    questionDelayMs: 3000,
    revealPoolOnProjector: true,
    ...overrides,
  };
}

function makeFinaleState(overrides?: Partial<FinaleState>): FinaleState {
  return {
    phase: 'vote',
    vote: {
      questionsAnsweredByUser: new Map(),
      maxQuestionsPerPerson: 3,
      poolCapReached: false,
    },
    pool: {
      tokens: [],
      availableByChapter: new Map(),
      totalByChapter: new Map(),
      totalRemaining: 0,
      targetPoolSize: 120,
    },
    queue: new Map(),
    active: new Map(),
    audienceInteraction: false,
    chapterSongIndex: new Map([['chapter_0', 0], ['chapter_1', 1], ['chapter_2', 2]]),
    trackMap: new Map(),
    loopCount: 0,
    loopProgress: 0,
    npc: { currentMessage: null },
    ...overrides,
  };
}

// ============================================================================
// getNextQuestion
// ============================================================================

describe('question-engine: getNextQuestion', () => {
  test('returns first question when user has answered none', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 0, 3);
    expect(question).toEqual({ text: 'What does he need to hear?' });
  });

  test('returns second question after answering one', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 1, 3);
    expect(question).toEqual({ text: 'What are you afraid of?' });
  });

  test('returns null when user has answered maxQuestionsPerPerson', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 3, 3);
    expect(question).toBeNull();
  });

  test('returns null when all questions exhausted', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 5, 10);
    expect(question).toBeNull();
  });

  test('shuffles question order per user when shuffleQuestions is true', () => {
    const config = makeVoteConfig({ shuffleQuestions: true });

    const userAQ0 = getNextQuestion(config, 0, 5, 'user-a');
    const userBQ0 = getNextQuestion(config, 0, 5, 'user-b');

    // With different user IDs, at least one pair should differ in order
    // (It's theoretically possible they get the same shuffle, but very unlikely)
    const userAAll = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 5, 'user-a'));
    const userBAll = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 5, 'user-b'));

    // Both should contain the same questions (just different order)
    const userATexts = userAAll.map(q => q?.text).sort();
    const userBTexts = userBAll.map(q => q?.text).sort();
    expect(userATexts).toEqual(userBTexts);

    // At least one position should differ (probabilistically near-certain)
    const allSame = userAAll.every((q, i) => q?.text === userBAll[i]?.text);
    // This could theoretically fail but chance is 1/120 (5!)
    // We accept this as sufficiently unlikely
    expect(allSame).toBe(false);
  });

  test('shuffle is deterministic for the same userId', () => {
    const config = makeVoteConfig({ shuffleQuestions: true });

    const first = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 5, 'user-x'));
    const second = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 5, 'user-x'));

    expect(first).toEqual(second);
  });

  test('returns answers when present in question config', () => {
    const answers = [
      { chapterId: 'ambition', label: 'Chase it' },
      { chapterId: 'love', label: 'Hold on' },
      { chapterId: 'acceptance', label: 'Let go' },
    ];
    const config = makeVoteConfig({
      questions: [
        { text: 'What matters?', answers },
        { text: 'What stays?' },
      ],
    });

    const q0 = getNextQuestion(config, 0, 3);
    expect(q0?.answers).toEqual(answers);

    const q1 = getNextQuestion(config, 1, 3);
    expect(q1?.answers).toBeUndefined();
  });
});

// ============================================================================
// calculateMaxQuestionsPerPerson
// ============================================================================

describe('question-engine: calculateMaxQuestionsPerPerson', () => {
  test('calculates max questions as ceil(targetPoolSize / audienceCount)', () => {
    expect(calculateMaxQuestionsPerPerson(120, 40)).toBe(3);
    expect(calculateMaxQuestionsPerPerson(120, 15)).toBe(8);
    expect(calculateMaxQuestionsPerPerson(100, 33)).toBe(4); // ceil(100/33) = 4
  });

  test('returns 0 for zero audience', () => {
    expect(calculateMaxQuestionsPerPerson(120, 0)).toBe(0);
  });

  test('returns targetPoolSize for audience of 1', () => {
    expect(calculateMaxQuestionsPerPerson(120, 1)).toBe(120);
  });
});

// ============================================================================
// shouldCapPool
// ============================================================================

describe('question-engine: shouldCapPool', () => {
  test('caps pool when total tokens reach target size', () => {
    expect(shouldCapPool(120, 120)).toBe(true);
    expect(shouldCapPool(121, 120)).toBe(true);
  });

  test('does not cap pool when below target', () => {
    expect(shouldCapPool(119, 120)).toBe(false);
    expect(shouldCapPool(0, 120)).toBe(false);
  });
});

// ============================================================================
// processEmotion
// ============================================================================

describe('question-engine: processEmotion', () => {
  test('creates a token and emits EMOTION_RECEIVED', () => {
    const state = makeFinaleState();
    const result = processEmotion(state, 'user-1', 'chapter_0', 0);

    expect(result.state.pool.tokens).toHaveLength(1);
    expect(result.state.pool.tokens[0].chapterId).toBe('chapter_0');
    expect(result.state.pool.tokens[0].ownerId).toBe('user-1');
    expect(result.state.pool.tokens[0].status).toBe('available');
    expect(result.state.pool.availableByChapter.get('chapter_0')).toBe(1);
    expect(result.state.pool.totalByChapter.get('chapter_0')).toBe(1);
    expect(result.state.pool.totalRemaining).toBe(1);

    const emotionEvent = result.events.find(e => e.type === 'EMOTION_RECEIVED');
    expect(emotionEvent).toBeDefined();
  });

  test('tracks questions answered per user independently', () => {
    let state = makeFinaleState();

    // User A answers twice
    state = processEmotion(state, 'user-a', 'chapter_0', 0).state;
    state = processEmotion(state, 'user-a', 'chapter_1', 1).state;

    // User B answers once
    state = processEmotion(state, 'user-b', 'chapter_2', 0).state;

    expect(state.vote.questionsAnsweredByUser.get('user-a')).toBe(2);
    expect(state.vote.questionsAnsweredByUser.get('user-b')).toBe(1);
  });

  test('accepts answers that arrive after cap (grace period)', () => {
    const state = makeFinaleState({
      pool: {
        tokens: Array.from({ length: 120 }, (_, i) => ({
          id: `token-${i}`,
          ownerId: `user-${i}`,
          chapterId: 'chapter_0',
          questionIndex: 0,
          status: 'available' as const,
        })),
        availableByChapter: new Map([['chapter_0', 120]]),
        totalByChapter: new Map([['chapter_0', 120]]),
        totalRemaining: 120,
        targetPoolSize: 120,
      },
    });

    // This answer arrives when pool is already at cap
    const result = processEmotion(state, 'user-late', 'chapter_1', 0);

    // Should still be accepted
    expect(result.state.pool.tokens).toHaveLength(121);
    expect(result.state.pool.availableByChapter.get('chapter_1')).toBe(1);

    // Pool cap event should fire
    const capEvent = result.events.find(e => e.type === 'POOL_CAP_REACHED');
    expect(capEvent).toBeDefined();
  });

  test('does not emit POOL_CAP_REACHED if already capped', () => {
    const state = makeFinaleState({
      vote: {
        questionsAnsweredByUser: new Map(),
        maxQuestionsPerPerson: 3,
        poolCapReached: true, // Already capped
      },
      pool: {
        tokens: Array.from({ length: 121 }, (_, i) => ({
          id: `token-${i}`,
          ownerId: `user-${i}`,
          chapterId: 'chapter_0',
          questionIndex: 0,
          status: 'available' as const,
        })),
        availableByChapter: new Map([['chapter_0', 121]]),
        totalByChapter: new Map([['chapter_0', 121]]),
        totalRemaining: 121,
        targetPoolSize: 120,
      },
    });

    const result = processEmotion(state, 'user-extra', 'chapter_0', 0);
    const capEvents = result.events.filter(e => e.type === 'POOL_CAP_REACHED');
    expect(capEvents).toHaveLength(0);
  });
});

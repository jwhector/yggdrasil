/**
 * Question Engine Tests (V3.4)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import {
  getNextQuestion,
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
    targetPoolSize: 300,
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
    },
    pool: {
      tokens: [],
      availableByChapter: new Map(),
      totalByChapter: new Map(),
      totalRemaining: 0,
      targetPoolSize: 300,
    },
    queue: new Map(),
    active: new Map(),
    audienceInteraction: false,
    chapterSongIndex: new Map([['chapter_0', 0], ['chapter_1', 1], ['chapter_2', 2]]),
    trackMap: new Map(),
    loopCount: 0,
    loopProgress: 0,
    npc: { currentMessage: null },
    audienceOrbs: new Map(),
    nodeTallies: new Map(),
    orbDecayLoops: 3,
    instantCrossfade: false,
    enabledNodes: new Set<string>(),
    fallbackMode: false,
    ...overrides,
  };
}

// ============================================================================
// getNextQuestion
// ============================================================================

describe('question-engine: getNextQuestion', () => {
  test('returns first question when user has answered none', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 0);
    expect(question).toEqual({ text: 'What does he need to hear?' });
  });

  test('returns second question after answering one', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 1);
    expect(question).toEqual({ text: 'What are you afraid of?' });
  });

  test('returns null when all questions exhausted', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 5);
    expect(question).toBeNull();
  });

  test('returns null when answeredCount exceeds questions length', () => {
    const config = makeVoteConfig();
    const question = getNextQuestion(config, 10);
    expect(question).toBeNull();
  });

  test('shuffles question order per user when shuffleQuestions is true', () => {
    const config = makeVoteConfig({ shuffleQuestions: true });

    // With different user IDs, at least one pair should differ in order
    const userAAll = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 'user-a'));
    const userBAll = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 'user-b'));

    // Both should contain the same questions (just different order)
    const userATexts = userAAll.map(q => q?.text).sort();
    const userBTexts = userBAll.map(q => q?.text).sort();
    expect(userATexts).toEqual(userBTexts);

    // At least one position should differ (probabilistically near-certain)
    const allSame = userAAll.every((q, i) => q?.text === userBAll[i]?.text);
    expect(allSame).toBe(false);
  });

  test('shuffle is deterministic for the same userId', () => {
    const config = makeVoteConfig({ shuffleQuestions: true });

    const first = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 'user-x'));
    const second = Array.from({ length: 5 }, (_, i) => getNextQuestion(config, i, 'user-x'));

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

    const q0 = getNextQuestion(config, 0);
    expect(q0?.answers).toEqual(answers);

    const q1 = getNextQuestion(config, 1);
    expect(q1?.answers).toBeUndefined();
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

  test('accepts answers beyond targetPoolSize (no cap)', () => {
    const state = makeFinaleState({
      pool: {
        tokens: Array.from({ length: 300 }, (_, i) => ({
          id: `token-${i}`,
          ownerId: `user-${i}`,
          chapterId: 'chapter_0',
          questionIndex: 0,
          status: 'available' as const,
        })),
        availableByChapter: new Map([['chapter_0', 300]]),
        totalByChapter: new Map([['chapter_0', 300]]),
        totalRemaining: 300,
        targetPoolSize: 300,
      },
    });

    const result = processEmotion(state, 'user-late', 'chapter_1', 0);
    expect(result.state.pool.tokens).toHaveLength(301);
    expect(result.state.pool.availableByChapter.get('chapter_1')).toBe(1);
    expect(result.events.every(e => e.type !== 'POOL_CAP_REACHED')).toBe(true);
  });
});

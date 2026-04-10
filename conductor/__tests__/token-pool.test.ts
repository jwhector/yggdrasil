/**
 * Token Pool Tests (V3.4)
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import { createTokenPool, consumeToken, returnToken, isPoolEmpty, getTotalRemaining } from '../token-pool';

describe('token-pool', () => {
  const makeVotes = (counts: Record<string, number>) => {
    const votes: { userId: string; chapterId: string; questionIndex: number }[] = [];
    let qi = 0;
    for (const [chapterId, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i++) {
        votes.push({ userId: `user-${votes.length}`, chapterId, questionIndex: qi++ });
      }
    }
    return votes;
  };

  test('creates pool with correct per-chapter counts from votes', () => {
    const votes = makeVotes({ chapter_0: 5, chapter_1: 3, chapter_2: 2 });
    const { pool, tokens } = createTokenPool(votes);

    expect(pool.available.get('chapter_0')).toBe(5);
    expect(pool.available.get('chapter_1')).toBe(3);
    expect(pool.available.get('chapter_2')).toBe(2);
    expect(pool.total.get('chapter_0')).toBe(5);
    expect(pool.total.get('chapter_1')).toBe(3);
    expect(pool.total.get('chapter_2')).toBe(2);
    expect(tokens).toHaveLength(10);
    expect(tokens.every(t => t.status === 'available')).toBe(true);
  });

  test('consuming a token decrements available count for that chapter', () => {
    const votes = makeVotes({ chapter_0: 3, chapter_1: 2 });
    const { pool, tokens } = createTokenPool(votes);

    const result = consumeToken(pool, tokens, 'chapter_0');
    expect(result.token).not.toBeNull();
    expect(result.token!.chapterId).toBe('chapter_0');
    expect(result.token!.status).toBe('queued');
    expect(result.pool.available.get('chapter_0')).toBe(2);
  });

  test('consuming from empty chapter returns null', () => {
    const votes = makeVotes({ chapter_0: 1 });
    const { pool, tokens } = createTokenPool(votes);

    // Consume the only token
    const first = consumeToken(pool, tokens, 'chapter_0');
    expect(first.token).not.toBeNull();

    // Try to consume another
    const second = consumeToken(first.pool, first.tokens, 'chapter_0');
    expect(second.token).toBeNull();
    expect(second.pool.available.get('chapter_0')).toBe(0);
  });

  test('consuming from non-existent chapter returns null', () => {
    const votes = makeVotes({ chapter_0: 2 });
    const { pool, tokens } = createTokenPool(votes);

    const result = consumeToken(pool, tokens, 'chapter_99');
    expect(result.token).toBeNull();
  });

  test('returning a token increments available count', () => {
    const votes = makeVotes({ chapter_0: 3 });
    const { pool, tokens } = createTokenPool(votes);

    // Consume one
    const consumed = consumeToken(pool, tokens, 'chapter_0');
    expect(consumed.pool.available.get('chapter_0')).toBe(2);

    // Return it
    const returned = returnToken(consumed.pool, consumed.tokens, consumed.token!.id);
    expect(returned.pool.available.get('chapter_0')).toBe(3);
    // Token should be back to available
    const returnedToken = returned.tokens.find(t => t.id === consumed.token!.id);
    expect(returnedToken!.status).toBe('available');
  });

  test('pool is empty when all chapters have zero available', () => {
    const votes = makeVotes({ chapter_0: 1, chapter_1: 1 });
    const { pool, tokens } = createTokenPool(votes);

    const after1 = consumeToken(pool, tokens, 'chapter_0');
    const after2 = consumeToken(after1.pool, after1.tokens, 'chapter_1');

    expect(isPoolEmpty(after2.pool)).toBe(true);
  });

  test('pool is not empty when some chapters have available tokens', () => {
    const votes = makeVotes({ chapter_0: 1, chapter_1: 2 });
    const { pool, tokens } = createTokenPool(votes);

    const after1 = consumeToken(pool, tokens, 'chapter_0');
    expect(isPoolEmpty(after1.pool)).toBe(false);
  });

  test('total counts remain unchanged after consume and return', () => {
    const votes = makeVotes({ chapter_0: 5, chapter_1: 3 });
    const { pool, tokens } = createTokenPool(votes);

    const consumed = consumeToken(pool, tokens, 'chapter_0');
    expect(consumed.pool.total.get('chapter_0')).toBe(5);
    expect(consumed.pool.total.get('chapter_1')).toBe(3);

    const returned = returnToken(consumed.pool, consumed.tokens, consumed.token!.id);
    expect(returned.pool.total.get('chapter_0')).toBe(5);
    expect(returned.pool.total.get('chapter_1')).toBe(3);
  });

  test('getTotalRemaining sums all available tokens', () => {
    const votes = makeVotes({ chapter_0: 5, chapter_1: 3, chapter_2: 2 });
    const { pool } = createTokenPool(votes);

    expect(getTotalRemaining(pool)).toBe(10);

    const consumed = consumeToken(pool, createTokenPool(votes).tokens, 'chapter_0');
    expect(getTotalRemaining(consumed.pool)).toBe(9);
  });
});

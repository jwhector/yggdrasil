/**
 * Token Pool — Pure Functions for V3.4 Finale Pool Management
 *
 * The token pool is the central resource of the V3.4 finale.
 * Audience emotional votes create tokens; the performer spends them to fuel the remix.
 *
 * Token lifecycle: available → queued → playing → spent
 *
 * All functions are pure — no I/O, no Socket.IO, no database calls.
 */

import type { Token, TokenPool, UserId } from './types';

// ============================================================================
// Pool Creation
// ============================================================================

/**
 * Create a token pool from audience vote results.
 * Each vote creates one token. Pool tracks counts per chapter.
 */
export function createTokenPool(
  votes: { userId: UserId; chapterId: string; questionIndex: number }[],
): { pool: TokenPool; tokens: Token[] } {
  const tokens: Token[] = votes.map((vote, i) => ({
    id: `token-${i}`,
    ownerId: vote.userId,
    chapterId: vote.chapterId,
    questionIndex: vote.questionIndex,
    status: 'available' as const,
  }));

  const available = new Map<string, number>();
  const total = new Map<string, number>();

  for (const token of tokens) {
    available.set(token.chapterId, (available.get(token.chapterId) ?? 0) + 1);
    total.set(token.chapterId, (total.get(token.chapterId) ?? 0) + 1);
  }

  return {
    pool: { available, total },
    tokens,
  };
}

// ============================================================================
// Pool Operations
// ============================================================================

/**
 * Consume one available token from the pool for the given chapter.
 * Returns the consumed token (or null if chapter is empty) and updated pool.
 */
export function consumeToken(
  pool: TokenPool,
  tokens: Token[],
  chapterId: string,
): { pool: TokenPool; tokens: Token[]; token: Token | null } {
  const availableCount = pool.available.get(chapterId) ?? 0;
  if (availableCount <= 0) {
    return { pool, tokens, token: null };
  }

  // Find the first available token for this chapter
  const tokenIndex = tokens.findIndex(
    t => t.chapterId === chapterId && t.status === 'available',
  );
  if (tokenIndex === -1) {
    return { pool, tokens, token: null };
  }

  // Mark token as queued
  const updatedTokens = [...tokens];
  updatedTokens[tokenIndex] = { ...updatedTokens[tokenIndex], status: 'queued' };

  // Decrement available count
  const updatedAvailable = new Map(pool.available);
  updatedAvailable.set(chapterId, availableCount - 1);

  return {
    pool: { available: updatedAvailable, total: pool.total },
    tokens: updatedTokens,
    token: updatedTokens[tokenIndex],
  };
}

/**
 * Return a token to the pool (e.g., cancelled queue).
 * Increments the available count for the token's chapter.
 */
export function returnToken(
  pool: TokenPool,
  tokens: Token[],
  tokenId: string,
): { pool: TokenPool; tokens: Token[] } {
  const tokenIndex = tokens.findIndex(t => t.id === tokenId);
  if (tokenIndex === -1) return { pool, tokens };

  const token = tokens[tokenIndex];
  const updatedTokens = [...tokens];
  updatedTokens[tokenIndex] = { ...token, status: 'available' };

  const updatedAvailable = new Map(pool.available);
  const current = updatedAvailable.get(token.chapterId) ?? 0;
  updatedAvailable.set(token.chapterId, current + 1);

  return {
    pool: { available: updatedAvailable, total: pool.total },
    tokens: updatedTokens,
  };
}

/**
 * Check if the pool is completely empty (no available tokens in any chapter).
 */
export function isPoolEmpty(pool: TokenPool): boolean {
  for (const count of pool.available.values()) {
    if (count > 0) return false;
  }
  return true;
}

/**
 * Get total remaining available tokens across all chapters.
 */
export function getTotalRemaining(pool: TokenPool): number {
  let total = 0;
  for (const count of pool.available.values()) {
    total += count;
  }
  return total;
}

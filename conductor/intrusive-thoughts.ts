/**
 * Intrusive Thoughts — Pure assignment logic
 *
 * Distributes thoughts from a shared pool to individual users.
 * No I/O — pure function called by the server when reveal starts.
 */

import type { IntrusiveThoughtsConfig, AssignedThought, UserId, Chapter } from './types';

/**
 * Assign thoughts to users for a specific layer.
 *
 * Draws `thoughtsPerPerson[layerIndex]` random strings from `pool[layerIndex]`
 * for each user. Duplicates across users are expected (shared pool, random draw).
 */
export function assignThoughts(
  config: IntrusiveThoughtsConfig,
  layerIndex: number,
  userIds: UserId[],
  attemptIndex: number,
): AssignedThought[] {
  const pool = config.pool[layerIndex];
  if (!pool || pool.length === 0) return [];

  const count = config.thoughtsPerPerson[layerIndex] ?? 1;
  const thoughts: AssignedThought[] = [];

  for (const userId of userIds) {
    // Draw random thoughts from pool (with replacement across users)
    const drawn = sampleWithoutReplacement(pool, count);
    for (let i = 0; i < drawn.length; i++) {
      thoughts.push({
        id: `${attemptIndex}-${layerIndex}-${userId}-${i}`,
        text: drawn[i],
        userId,
        dismissed: false,
      });
    }
  }

  return thoughts;
}

/**
 * Find the intrusive thoughts config for a given chapter.
 */
export function findThoughtsConfig(
  configs: IntrusiveThoughtsConfig[] | undefined,
  chapter: Chapter,
): IntrusiveThoughtsConfig | undefined {
  return configs?.find(c => c.chapter === chapter);
}

/** Sample n unique items from an array (Fisher-Yates partial shuffle). */
function sampleWithoutReplacement<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

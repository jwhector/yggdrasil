/**
 * Intrusive Thoughts — Pure assignment logic
 *
 * Samples random thoughts from the pool and assigns them to users on collapse.
 * No I/O — pure function called by the server when a song collapses.
 */

import type { IntrusiveThoughtsConfig, AssignedThought, UserId, Chapter } from './types';

/**
 * Assign thoughts to users on collapse.
 *
 * Each user gets `config.count` random thoughts sampled from `config.thoughts`.
 * Different users may see different subsets.
 */
export function assignThoughts(
  config: IntrusiveThoughtsConfig,
  userIds: UserId[],
  attemptIndex: number,
): AssignedThought[] {
  if (config.thoughts.length === 0) return [];

  const count = Math.min(config.count, config.thoughts.length);
  const thoughts: AssignedThought[] = [];

  for (const userId of userIds) {
    const drawn = sampleWithoutReplacement(config.thoughts, count);
    for (let i = 0; i < drawn.length; i++) {
      thoughts.push({
        id: `${attemptIndex}-${userId}-${i}`,
        text: drawn[i],
        userId,
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

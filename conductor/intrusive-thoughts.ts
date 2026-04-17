/**
 * Intrusive Thoughts — Pure assignment logic
 *
 * Assigns the full thought list to every user on collapse.
 * No I/O — pure function called by the server when a song collapses.
 */

import type { IntrusiveThoughtsConfig, AssignedThought, UserId, Chapter } from './types';

/**
 * Assign thoughts to users on collapse.
 *
 * Every user gets the full `config.thoughts` list — deterministic, no sampling.
 */
export function assignThoughts(
  config: IntrusiveThoughtsConfig,
  userIds: UserId[],
  attemptIndex: number,
): AssignedThought[] {
  if (config.thoughts.length === 0) return [];

  const thoughts: AssignedThought[] = [];

  for (const userId of userIds) {
    for (let i = 0; i < config.thoughts.length; i++) {
      thoughts.push({
        id: `${attemptIndex}-${userId}-${i}`,
        text: config.thoughts[i],
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

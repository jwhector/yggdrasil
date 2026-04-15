/**
 * Audience Remix Engine (V3.4 — Swarm Orbs)
 *
 * Pure functions for audience-interactive remix: orb placement, recall,
 * tally computation, decay, scatter, and node locking.
 *
 * Each audience member has N personal orbs (generated from vote phase answers).
 * Orbs are placed on nodes as reusable "votes" that pull nodes toward chapters.
 * The dominant chapter per node plays at loop boundaries (or instantly if configured).
 *
 * No I/O — all side effects live in server/.
 */

import type {
  UserId,
  FinaleState,
  ConductorEvent,
  AudienceOrb,
  UserRemixState,
  NodeVoteTally,
} from './types';

// ============================================================================
// Orb Initialization
// ============================================================================

/**
 * Create orbs for a user from their vote phase answers.
 * Called when remix starts or when a late-joiner enters during remix.
 * Each answer's chapterId becomes an orb; all start in hand (not placed).
 */
export function createUserOrbs(
  userId: UserId,
  chapterIds: string[],
): UserRemixState {
  return {
    userId,
    orbs: chapterIds.map((chapterId, index) => ({
      index,
      chapterId,
      placedOnNode: null,
      placedAtLoop: 0,
    })),
  };
}

// ============================================================================
// Orb Placement
// ============================================================================

/**
 * Place an orb on a node. If the orb is already on a different node,
 * it is moved (old node tally decremented, new node tally incremented).
 */
export function placeOrb(
  state: FinaleState,
  userId: UserId,
  orbIndex: number,
  granularType: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const userState = state.audienceOrbs.get(userId);
  if (!userState) return { state, events };

  const orb = userState.orbs[orbIndex];
  if (!orb) return { state, events };

  const previousNode = orb.placedOnNode;

  // Update orb
  const updatedOrbs = [...userState.orbs];
  updatedOrbs[orbIndex] = {
    ...orb,
    placedOnNode: granularType,
    placedAtLoop: state.loopCount,
  };

  const updatedUserState: UserRemixState = { ...userState, orbs: updatedOrbs };
  const updatedAudienceOrbs = new Map(state.audienceOrbs);
  updatedAudienceOrbs.set(userId, updatedUserState);

  // Update tallies
  let updatedTallies = new Map(state.nodeTallies);

  // Decrement old node if orb was placed somewhere
  if (previousNode && previousNode !== granularType) {
    updatedTallies = decrementTally(updatedTallies, previousNode, orb.chapterId);
  }

  // Increment new node (unless it was already on this node)
  if (previousNode !== granularType) {
    updatedTallies = incrementTally(updatedTallies, granularType, orb.chapterId);
  }

  const updatedState: FinaleState = {
    ...state,
    audienceOrbs: updatedAudienceOrbs,
    nodeTallies: updatedTallies,
  };

  events.push({
    type: 'ORB_PLACED',
    userId,
    orbIndex,
    granularType,
    chapterId: orb.chapterId,
  });

  // Emit tally change for the affected nodes
  if (previousNode && previousNode !== granularType) {
    events.push(makeTallyEvent(updatedTallies, previousNode));
  }
  events.push(makeTallyEvent(updatedTallies, granularType));

  return { state: updatedState, events };
}

/**
 * Recall an orb back to hand (remove from its node).
 */
export function recallOrb(
  state: FinaleState,
  userId: UserId,
  orbIndex: number,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const userState = state.audienceOrbs.get(userId);
  if (!userState) return { state, events };

  const orb = userState.orbs[orbIndex];
  if (!orb || orb.placedOnNode === null) return { state, events };

  const previousNode = orb.placedOnNode;

  // Update orb
  const updatedOrbs = [...userState.orbs];
  updatedOrbs[orbIndex] = {
    ...orb,
    placedOnNode: null,
    placedAtLoop: 0,
  };

  const updatedUserState: UserRemixState = { ...userState, orbs: updatedOrbs };
  const updatedAudienceOrbs = new Map(state.audienceOrbs);
  updatedAudienceOrbs.set(userId, updatedUserState);

  // Decrement tally
  const updatedTallies = decrementTally(new Map(state.nodeTallies), previousNode, orb.chapterId);

  const updatedState: FinaleState = {
    ...state,
    audienceOrbs: updatedAudienceOrbs,
    nodeTallies: updatedTallies,
  };

  events.push({
    type: 'ORB_RECALLED',
    userId,
    orbIndex,
    granularType: previousNode,
    chapterId: orb.chapterId,
  });
  events.push(makeTallyEvent(updatedTallies, previousNode));

  return { state: updatedState, events };
}

// ============================================================================
// Decay
// ============================================================================

/**
 * Process decay for all placed orbs. Called at each loop boundary.
 * Returns orbs that have expired (placed for longer than orbDecayLoops).
 */
export function processDecay(
  state: FinaleState,
): { state: FinaleState; events: ConductorEvent[] } {
  if (state.orbDecayLoops <= 0) return { state, events: [] };

  const events: ConductorEvent[] = [];
  const updatedAudienceOrbs = new Map(state.audienceOrbs);
  let updatedTallies = new Map(state.nodeTallies);
  const affectedNodes = new Set<string>();

  for (const [userId, userState] of state.audienceOrbs) {
    const updatedOrbs = [...userState.orbs];
    let changed = false;

    for (let i = 0; i < updatedOrbs.length; i++) {
      const orb = updatedOrbs[i];
      if (orb.placedOnNode === null) continue;

      const loopsPlaced = state.loopCount - orb.placedAtLoop;
      if (loopsPlaced >= state.orbDecayLoops) {
        // Decay: return to hand
        const node = orb.placedOnNode;
        updatedTallies = decrementTally(updatedTallies, node, orb.chapterId);
        affectedNodes.add(node);

        updatedOrbs[i] = { ...orb, placedOnNode: null, placedAtLoop: 0 };
        changed = true;

        events.push({ type: 'ORB_DECAYED', userId, orbIndex: i, granularType: node });
      }
    }

    if (changed) {
      updatedAudienceOrbs.set(userId, { ...userState, orbs: updatedOrbs });
    }
  }

  // Emit tally events for all affected nodes
  for (const node of affectedNodes) {
    events.push(makeTallyEvent(updatedTallies, node));
  }

  return {
    state: { ...state, audienceOrbs: updatedAudienceOrbs, nodeTallies: updatedTallies },
    events,
  };
}

// ============================================================================
// Scatter
// ============================================================================

/**
 * Scatter all orbs from a specific node (or all nodes) back to hands.
 */
export function scatterNode(
  state: FinaleState,
  granularType: string | null,
): { state: FinaleState; events: ConductorEvent[] } {
  const events: ConductorEvent[] = [];
  const updatedAudienceOrbs = new Map(state.audienceOrbs);
  let updatedTallies = new Map(state.nodeTallies);
  const affectedNodes = new Set<string>();
  const affectedUsers: UserId[] = [];

  for (const [userId, userState] of state.audienceOrbs) {
    const updatedOrbs = [...userState.orbs];
    let changed = false;

    for (let i = 0; i < updatedOrbs.length; i++) {
      const orb = updatedOrbs[i];
      if (orb.placedOnNode === null) continue;
      if (granularType !== null && orb.placedOnNode !== granularType) continue;

      const node = orb.placedOnNode;
      updatedTallies = decrementTally(updatedTallies, node, orb.chapterId);
      affectedNodes.add(node);

      updatedOrbs[i] = { ...orb, placedOnNode: null, placedAtLoop: 0 };
      changed = true;
    }

    if (changed) {
      updatedAudienceOrbs.set(userId, { ...userState, orbs: updatedOrbs });
      affectedUsers.push(userId);
    }
  }

  for (const node of affectedNodes) {
    events.push(makeTallyEvent(updatedTallies, node));
  }

  events.push({ type: 'NODES_SCATTERED', granularType, affectedUsers });

  return {
    state: { ...state, audienceOrbs: updatedAudienceOrbs, nodeTallies: updatedTallies },
    events,
  };
}

// ============================================================================
// Lock / Unlock
// ============================================================================

/**
 * Lock a node to a specific chapter. The locked chapter plays regardless of votes.
 */
export function lockNode(
  state: FinaleState,
  granularType: string,
  chapterId: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const updatedTallies = new Map(state.nodeTallies);
  const existing = updatedTallies.get(granularType) ?? makeEmptyTally(granularType);
  updatedTallies.set(granularType, { ...existing, locked: true, lockedChapter: chapterId });

  return {
    state: { ...state, nodeTallies: updatedTallies },
    events: [{ type: 'NODE_LOCKED', granularType, chapterId }],
  };
}

/**
 * Unlock a node. Tally-based dominant chapter resumes control.
 */
export function unlockNode(
  state: FinaleState,
  granularType: string,
): { state: FinaleState; events: ConductorEvent[] } {
  const updatedTallies = new Map(state.nodeTallies);
  const existing = updatedTallies.get(granularType) ?? makeEmptyTally(granularType);
  updatedTallies.set(granularType, { ...existing, locked: false, lockedChapter: null });

  return {
    state: { ...state, nodeTallies: updatedTallies },
    events: [
      { type: 'NODE_UNLOCKED', granularType },
      makeTallyEvent(updatedTallies, granularType),
    ],
  };
}

// ============================================================================
// Config Changes (live-adjustable)
// ============================================================================

export function setDecayRate(
  state: FinaleState,
  loops: number,
): { state: FinaleState; events: ConductorEvent[] } {
  return {
    state: { ...state, orbDecayLoops: loops },
    events: [{ type: 'DECAY_RATE_CHANGED', loops }],
  };
}

export function setCrossfadeMode(
  state: FinaleState,
  instant: boolean,
): { state: FinaleState; events: ConductorEvent[] } {
  return {
    state: { ...state, instantCrossfade: instant },
    events: [{ type: 'CROSSFADE_MODE_CHANGED', instant }],
  };
}

// ============================================================================
// Tally Queries
// ============================================================================

/**
 * Get the effective chapter for a node (respects lock).
 * Returns null if no orbs placed and not locked.
 */
export function getEffectiveChapter(
  tally: NodeVoteTally,
): string | null {
  if (tally.locked && tally.lockedChapter) return tally.lockedChapter;
  return tally.dominantChapter;
}

/**
 * Compute all node tallies from scratch (for validation/recovery).
 */
export function recomputeTallies(
  state: FinaleState,
  granularTypes: string[],
): Map<string, NodeVoteTally> {
  const tallies = new Map<string, NodeVoteTally>();

  // Initialize empty tallies
  for (const gt of granularTypes) {
    const existing = state.nodeTallies.get(gt);
    tallies.set(gt, {
      granularType: gt,
      votes: new Map(),
      dominantChapter: null,
      locked: existing?.locked ?? false,
      lockedChapter: existing?.lockedChapter ?? null,
    });
  }

  // Count all placed orbs
  for (const [, userState] of state.audienceOrbs) {
    for (const orb of userState.orbs) {
      if (orb.placedOnNode) {
        const tally = tallies.get(orb.placedOnNode);
        if (tally) {
          tally.votes.set(orb.chapterId, (tally.votes.get(orb.chapterId) ?? 0) + 1);
        }
      }
    }
  }

  // Compute dominants
  for (const [, tally] of tallies) {
    tally.dominantChapter = computeDominant(tally.votes, null);
  }

  return tallies;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function makeEmptyTally(granularType: string): NodeVoteTally {
  return {
    granularType,
    votes: new Map(),
    dominantChapter: null,
    locked: false,
    lockedChapter: null,
  };
}

function incrementTally(
  tallies: Map<string, NodeVoteTally>,
  granularType: string,
  chapterId: string,
): Map<string, NodeVoteTally> {
  const tally = tallies.get(granularType) ?? makeEmptyTally(granularType);
  const updatedVotes = new Map(tally.votes);
  updatedVotes.set(chapterId, (updatedVotes.get(chapterId) ?? 0) + 1);
  const incumbent = tally.dominantChapter;
  tallies.set(granularType, {
    ...tally,
    votes: updatedVotes,
    dominantChapter: computeDominant(updatedVotes, incumbent),
  });
  return tallies;
}

function decrementTally(
  tallies: Map<string, NodeVoteTally>,
  granularType: string,
  chapterId: string,
): Map<string, NodeVoteTally> {
  const tally = tallies.get(granularType) ?? makeEmptyTally(granularType);
  const updatedVotes = new Map(tally.votes);
  const current = updatedVotes.get(chapterId) ?? 0;
  if (current <= 1) {
    updatedVotes.delete(chapterId);
  } else {
    updatedVotes.set(chapterId, current - 1);
  }
  const incumbent = tally.dominantChapter;
  tallies.set(granularType, {
    ...tally,
    votes: updatedVotes,
    dominantChapter: computeDominant(updatedVotes, incumbent),
  });
  return tallies;
}

/**
 * Compute dominant chapter from vote counts. Tie = incumbent stays.
 */
function computeDominant(
  votes: Map<string, number>,
  incumbent: string | null,
): string | null {
  if (votes.size === 0) return null;

  let maxCount = 0;
  let maxChapter: string | null = null;
  let tied = false;

  for (const [chapterId, count] of votes) {
    if (count > maxCount) {
      maxCount = count;
      maxChapter = chapterId;
      tied = false;
    } else if (count === maxCount) {
      tied = true;
    }
  }

  // Tie: incumbent stays if it's one of the tied chapters
  if (tied && incumbent && (votes.get(incumbent) ?? 0) === maxCount) {
    return incumbent;
  }

  return maxChapter;
}

function makeTallyEvent(
  tallies: Map<string, NodeVoteTally>,
  granularType: string,
): ConductorEvent {
  const tally = tallies.get(granularType) ?? makeEmptyTally(granularType);
  return {
    type: 'NODE_TALLY_CHANGED',
    granularType,
    dominantChapter: tally.dominantChapter,
    votes: Array.from(tally.votes.entries()).map(([chapterId, count]) => ({ chapterId, count })),
  };
}

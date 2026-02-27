/**
 * Finale — Chapter Assignment, Fragment Selection, Rotation, Stewardship, Triangle
 *
 * Pure functions for finale game logic. No I/O.
 *
 * Flow:
 *   1. SETUP_FINALE → assignChapters, initialize FinaleState
 *   2. Users SELECT_FRAGMENT → validate, add to queue
 *   3. START_ROTATION → fill initial slots from queue
 *   4. Server timing triggers performRotationTick every N bars
 *   5. FREEZE_ROTATION → lock current mix
 *
 * Scheduling priority: fairness-first → chapter weighting → diversity nudge
 */

import type {
  UserId,
  Chapter,
  User,
  ShowState,
  FinaleState,
  FinaleConfig,
  QueueEntry,
  ActiveSlot,
  TrianglePosition,
  StewardshipEntry,
  Fragment,
  ConductorEvent,
} from './types';
import { generateFragments, type FragmentAvailability } from './fragments';

const CHAPTERS: Chapter[] = ['ambition', 'love', 'avoidance'];

// ============================================================================
// Chapter Assignment
// ============================================================================

/**
 * Assign connected audience members evenly (±1) across 3 chapters.
 * Uses Fisher-Yates shuffle for randomization, then round-robin assignment.
 */
export function assignChapters(users: Map<UserId, User>): Map<UserId, Chapter> {
  const assignments = new Map<UserId, Chapter>();

  // Only assign connected users
  const userIds: UserId[] = [];
  users.forEach((user, id) => {
    if (user.connected) userIds.push(id);
  });

  // Fisher-Yates shuffle
  for (let i = userIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [userIds[i], userIds[j]] = [userIds[j], userIds[i]];
  }

  // Round-robin assign
  userIds.forEach((userId, index) => {
    assignments.set(userId, CHAPTERS[index % 3]);
  });

  return assignments;
}

// ============================================================================
// Finale State Initialization
// ============================================================================

/**
 * Create a fresh FinaleState from config and chapter assignments.
 */
export function initializeFinaleState(
  config: FinaleConfig,
  chapterAssignments: Map<UserId, Chapter>,
): FinaleState {
  return {
    chapterAssignments,
    queue: [],
    activeSlots: Array(config.slotCount).fill(null),
    trianglePositions: new Map(),
    centroid: { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 },
    rotationActive: false,
    rotationRate: config.defaultRotationRate,
    frozen: false,
    stewardshipLog: [],
    triangleActive: true,
  };
}

// ============================================================================
// Fragment Availability
// ============================================================================

/**
 * Get all fragments and their availability from the current attempt state.
 */
export function getAvailableFragments(state: ShowState): FragmentAvailability[] {
  return generateFragments(state.attempts, state.config.attempts);
}

// ============================================================================
// Fragment Selection
// ============================================================================

/**
 * Validate and process a fragment selection.
 *
 * Validation:
 * 1. Finale must be initialized
 * 2. User must exist and have a chapter assignment
 * 3. User must not already have a fragment in the queue
 * 4. Fragment must exist and be selectable (locked_in winner)
 * 5. Fragment must be from the user's assigned chapter
 */
export function selectFragment(
  userId: UserId,
  fragmentId: string,
  state: ShowState,
): { events: ConductorEvent[]; error?: string } {
  const finaleState = state.finaleState;
  if (!finaleState) {
    return { events: [], error: 'Finale not initialized' };
  }

  const user = state.users.get(userId);
  if (!user) {
    return { events: [], error: `User not found: ${userId}` };
  }

  const userChapter = finaleState.chapterAssignments.get(userId);
  if (!userChapter) {
    return { events: [], error: `User not assigned to a chapter: ${userId}` };
  }

  // Check if user already has a fragment in the queue
  const existingEntry = finaleState.queue.find(e => e.userId === userId);
  if (existingEntry) {
    return { events: [], error: 'User already has a fragment in the queue' };
  }

  // Find the fragment and check availability
  const allFragments = getAvailableFragments(state);
  const fragmentAvail = allFragments.find(f => f.fragment.id === fragmentId);

  if (!fragmentAvail) {
    return { events: [], error: `Fragment not found: ${fragmentId}` };
  }

  if (!fragmentAvail.selectable) {
    return { events: [], error: `Fragment is not selectable: ${fragmentId}` };
  }

  if (fragmentAvail.fragment.chapter !== userChapter) {
    return {
      events: [],
      error: `Fragment is not from user's chapter. User: ${userChapter}, Fragment: ${fragmentAvail.fragment.chapter}`,
    };
  }

  // Add to queue
  const queueEntry: QueueEntry = {
    userId,
    fragment: fragmentAvail.fragment,
    chapter: fragmentAvail.fragment.chapter,
    enqueuedAt: Date.now(),
    hasBeenSteward: false,
  };
  finaleState.queue.push(queueEntry);

  return {
    events: [{
      type: 'FRAGMENT_QUEUED',
      userId,
      fragment: fragmentAvail.fragment,
    }],
  };
}

// ============================================================================
// Triangle & Centroid
// ============================================================================

/**
 * Compute centroid (average) of all triangle positions.
 * Returns equal weights (1/3 each) if no positions exist.
 */
export function computeCentroid(positions: Map<UserId, TrianglePosition>): TrianglePosition {
  if (positions.size === 0) {
    return { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };
  }

  let totalA = 0;
  let totalL = 0;
  let totalV = 0;

  positions.forEach(pos => {
    totalA += pos.wAmbition;
    totalL += pos.wLove;
    totalV += pos.wAvoidance;
  });

  const count = positions.size;
  return {
    wAmbition: totalA / count,
    wLove: totalL / count,
    wAvoidance: totalV / count,
  };
}

// ============================================================================
// Queue Scheduling
// ============================================================================

/**
 * Select which queue entries should be activated next.
 *
 * Priority:
 *   1. Fairness: users who haven't stewarded go first (+1000)
 *   2. Chapter weighting: centroid weight for the entry's chapter (0–1)
 *   3. Diversity nudge: +0.5 if chapter has no representation in active slots
 *
 * Returns up to `slotsToRotate` entries.
 */
export function scheduleRotation(
  queue: QueueEntry[],
  centroid: TrianglePosition,
  activeSlots: (ActiveSlot | null)[],
  slotsToRotate: number,
): QueueEntry[] {
  // Filter to entries whose fragments are not already in active slots
  const activeFragmentIds = new Set(
    activeSlots
      .filter((s): s is ActiveSlot => s !== null)
      .map(s => s.fragment.id),
  );
  const available = queue.filter(e => !activeFragmentIds.has(e.fragment.id));

  if (available.length === 0) return [];

  // Count current chapter representation in active slots
  const activeChapterCounts: Record<Chapter, number> = { ambition: 0, love: 0, avoidance: 0 };
  activeSlots.forEach(slot => {
    if (slot) activeChapterCounts[slot.fragment.chapter]++;
  });

  // Score and sort
  const scored = available.map(entry => ({
    entry,
    score: computeSchedulingScore(entry, centroid, activeChapterCounts),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, slotsToRotate).map(s => s.entry);
}

/**
 * Compute scheduling priority score for a queue entry.
 */
function computeSchedulingScore(
  entry: QueueEntry,
  centroid: TrianglePosition,
  activeChapterCounts: Record<Chapter, number>,
): number {
  let score = 0;

  // Fairness: +1000 if user hasn't been steward
  if (!entry.hasBeenSteward) score += 1000;

  // Chapter weighting from centroid (0–1)
  score += getChapterWeight(entry.chapter, centroid);

  // Diversity nudge: +0.5 if chapter is not represented in active slots
  if (activeChapterCounts[entry.chapter] === 0) score += 0.5;

  return score;
}

/**
 * Get the centroid weight for a chapter.
 */
function getChapterWeight(chapter: Chapter, centroid: TrianglePosition): number {
  switch (chapter) {
    case 'ambition': return centroid.wAmbition;
    case 'love': return centroid.wLove;
    case 'avoidance': return centroid.wAvoidance;
  }
}

// ============================================================================
// Rotation Tick
// ============================================================================

/**
 * Perform a rotation tick: fill empty slots, or rotate out oldest and rotate in new.
 *
 * Called by START_ROTATION (initial fill) and by the server timing layer
 * (subsequent ticks every N bars).
 *
 * @param currentBeat - Current beat number from Ableton (0 for initial fill)
 */
export function performRotationTick(
  state: ShowState,
  currentBeat: number,
): ConductorEvent[] {
  const finaleState = state.finaleState;
  if (!finaleState || !finaleState.rotationActive || finaleState.frozen) {
    return [];
  }

  const slotsToRotate = finaleState.rotationRate;

  // Schedule next entries from queue
  const nextEntries = scheduleRotation(
    finaleState.queue,
    finaleState.centroid,
    finaleState.activeSlots,
    slotsToRotate,
  );

  if (nextEntries.length === 0) return [];

  // Find slots to use: empty slots first, then oldest occupied slots
  const slotTargets = pickSlotTargets(finaleState.activeSlots, nextEntries.length);

  const events: ConductorEvent[] = [];
  const newSlots: ActiveSlot[] = [];
  const removedSlots: number[] = [];

  for (let i = 0; i < Math.min(nextEntries.length, slotTargets.length); i++) {
    const slotIndex = slotTargets[i];
    const entry = nextEntries[i];

    // Deactivate existing slot
    const existingSlot = finaleState.activeSlots[slotIndex];
    if (existingSlot) {
      endStewardship(finaleState, slotIndex, currentBeat);
      removedSlots.push(slotIndex);

      events.push({
        type: 'STEWARDSHIP_ENDED',
        userId: existingSlot.stewardUserId,
        slotIndex,
      });
      events.push({ type: 'SLOT_DEACTIVATED', slotIndex });
      events.push({
        type: 'AUDIO_CUE',
        cue: { type: 'slot_deactivate', slotIndex },
      });
    }

    // Activate new slot
    const newSlot: ActiveSlot = {
      slotIndex,
      fragment: entry.fragment,
      stewardUserId: entry.userId,
      parameterValue: entry.fragment.safeParameter.defaultValue,
      activatedAtBeat: currentBeat,
      energyLevel: 0,
    };

    finaleState.activeSlots[slotIndex] = newSlot;
    newSlots.push(newSlot);

    // Start stewardship
    startStewardship(finaleState, slotIndex, entry.fragment, entry.userId, currentBeat);

    // Mark queue entry as having stewarded
    entry.hasBeenSteward = true;

    events.push({
      type: 'SLOT_ACTIVATED',
      slotIndex,
      fragment: entry.fragment,
      stewardUserId: entry.userId,
    });
    events.push({
      type: 'STEWARDSHIP_STARTED',
      userId: entry.userId,
      slotIndex,
    });
    events.push({
      type: 'AUDIO_CUE',
      cue: { type: 'slot_activate', slotIndex, fragment: entry.fragment },
    });
  }

  events.push({
    type: 'ROTATION_TICK',
    newSlots,
    removedSlots,
  });

  return events;
}

/**
 * Pick slot indices for incoming entries: empty slots first, then oldest occupied.
 */
function pickSlotTargets(
  activeSlots: (ActiveSlot | null)[],
  count: number,
): number[] {
  const targets: number[] = [];

  // Empty slots first
  for (let i = 0; i < activeSlots.length && targets.length < count; i++) {
    if (activeSlots[i] === null) targets.push(i);
  }

  // Oldest occupied slots (by activatedAtBeat)
  if (targets.length < count) {
    const occupied = activeSlots
      .map((slot, i) => ({ slot, index: i }))
      .filter((s): s is { slot: ActiveSlot; index: number } => s.slot !== null)
      .sort((a, b) => a.slot.activatedAtBeat - b.slot.activatedAtBeat);

    for (const { index } of occupied) {
      if (targets.length >= count) break;
      if (!targets.includes(index)) targets.push(index);
    }
  }

  return targets;
}

// ============================================================================
// Stewardship Lifecycle
// ============================================================================

/**
 * Record the start of stewardship for a slot.
 */
export function startStewardship(
  finaleState: FinaleState,
  slotIndex: number,
  fragment: Fragment,
  stewardUserId: UserId,
  currentBeat: number,
): StewardshipEntry {
  const entry: StewardshipEntry = {
    userId: stewardUserId,
    slotIndex,
    fragment,
    startBeat: currentBeat,
    endBeat: null,
  };
  finaleState.stewardshipLog.push(entry);
  return entry;
}

/**
 * End stewardship for a slot. Closes the active log entry.
 * Returns the closed entry, or null if no active stewardship was found.
 */
export function endStewardship(
  finaleState: FinaleState,
  slotIndex: number,
  currentBeat: number,
): StewardshipEntry | null {
  const entry = finaleState.stewardshipLog.find(
    e => e.slotIndex === slotIndex && e.endBeat === null,
  );
  if (entry) {
    entry.endBeat = currentBeat;
    return entry;
  }
  return null;
}

// ============================================================================
// Steward Parameter
// ============================================================================

/**
 * Validate and clamp a steward's parameter update.
 *
 * Checks:
 * 1. User is an active steward for some slot
 * 2. Value is clamped to the fragment's safe parameter range
 *
 * Returns the slot index and clamped value, or null if the user is not a steward.
 */
export function updateStewardParam(
  userId: UserId,
  value: number,
  finaleState: FinaleState,
): { slotIndex: number; clampedValue: number } | null {
  // Find the slot where this user is steward
  const slot = finaleState.activeSlots.find(
    (s): s is ActiveSlot => s !== null && s.stewardUserId === userId,
  );

  if (!slot) return null;

  const { min, max } = slot.fragment.safeParameter;
  const clampedValue = Math.max(min, Math.min(max, value));

  slot.parameterValue = clampedValue;

  return { slotIndex: slot.slotIndex, clampedValue };
}

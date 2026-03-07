/**
 * Finale — Chapter Assignment, Fragment Selection, Rotation, Stewardship, Triangle Tests
 *
 * Test names are specifications — complete sentences describing behavior.
 */

import { describe, test, expect } from '@jest/globals';
import { createInitialState, processCommand } from '../conductor';
import {
  assignChapters,
  computeCentroid,
  selectFragment,
  scheduleRotation,
  updateStewardParam,
  startStewardship,
  endStewardship,
  getAvailableFragments,
  initializeFinaleState,
} from '../finale';
import type {
  ShowState,
  ShowConfig,
  AttemptConfig,
  LayerConfig,
  AudioReference,
  UserId,
  User,
  Chapter,
  TrianglePosition,
  QueueEntry,
  ActiveSlot,
  Fragment,
  FinaleState,
  ConductorEvent,
} from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeAudioRef(index: number): AudioReference {
  return { trackIndex: index };
}

function makeLayerConfig(index: number, threshold: number | null = null): LayerConfig {
  return {
    index,
    type: index === 0 ? 'foundation' : index === 1 ? 'pulse' : 'color',
    optionA: makeAudioRef(index * 2),
    optionB: makeAudioRef(index * 2 + 1),
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    doubtThreshold: threshold,
  };
}

function makeAttemptConfig(
  chapter: 'ambition' | 'love' | 'avoidance',
  layerCount: number = 3,
): AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    layers: Array.from({ length: layerCount }, (_, i) => makeLayerConfig(i)),
    drainFactor: 0.5,
    layerMultipliers: [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0],
  };
}

function createTestConfig(layerCount: number = 3): ShowConfig {
  return {
    maxLayersPerAttempt: 7,
    attempts: [
      makeAttemptConfig('ambition', layerCount),
      makeAttemptConfig('love', layerCount),
      makeAttemptConfig('avoidance', layerCount),
    ],
    finale: {
      slotCount: 7,
      rotationBars: 8,
      defaultRotationRate: 2,
      triangleDriftTimeoutMs: 10000,
      triangleDriftSpeedMs: 3000,
      fragments: [],
    },
    timing: {
      auditionDurationMs: 4000,
      votingWindowMs: 30000,
      resolveAnimationMs: 5000,
      collapseAnimationMs: 3000,
      autoAdvanceToStoryMs: 2000,
      beatsPerLoop: 0,
      auditionsPerLayer: 0,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function createTestState(layerCount: number = 3): ShowState {
  return createInitialState(createTestConfig(layerCount), 'test-show');
}

function connectUsers(state: ShowState, count: number): UserId[] {
  const ids: UserId[] = [];
  for (let i = 0; i < count; i++) {
    const id = `user-${i}` as UserId;
    processCommand(state, { type: 'USER_CONNECT', userId: id });
    ids.push(id);
  }
  return ids;
}

/** Advance through phases: lobby → opener → attempt_story → attempt_build */
function advanceToBuild(state: ShowState, attemptIndex: number = 0): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  processCommand(state, { type: 'ADVANCE_PHASE' }); // opener → attempt_story 0
  processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story → attempt_build 0

  for (let i = 0; i < attemptIndex; i++) {
    // advance through story → build for each additional attempt
    processCommand(state, { type: 'ADVANCE_PHASE' }); // build → story
    processCommand(state, { type: 'ADVANCE_PHASE' }); // story → build
  }
}

/** Complete a single layer: audition → vote → close voting (locks in) */
function completeSingleLayer(state: ShowState, userIds: UserId[], choice: 'A' | 'B' = 'A'): void {
  processCommand(state, { type: 'START_AUDITION' });
  processCommand(state, { type: 'OPEN_VOTING' });
  for (const id of userIds) {
    processCommand(state, { type: 'SUBMIT_VOTE', userId: id, choice });
  }
  processCommand(state, { type: 'CLOSE_VOTING' });
}

/** Complete all layers in the current attempt */
function completeAttempt(state: ShowState, userIds: UserId[], layerCount: number = 3): void {
  for (let i = 0; i < layerCount; i++) {
    completeSingleLayer(state, userIds, i % 2 === 0 ? 'A' : 'B');
  }
}

/** Advance state to finale_setup with completed attempts */
function advanceToFinaleSetup(state: ShowState, userIds: UserId[], layerCount: number = 3): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) {
      advanceToBuild(state, 0);
    } else {
      processCommand(state, { type: 'ADVANCE_PHASE' }); // build → story
      processCommand(state, { type: 'ADVANCE_PHASE' }); // story → build
    }
    completeAttempt(state, userIds, layerCount);
  }
  processCommand(state, { type: 'ADVANCE_PHASE' }); // build → finale_setup
}

function findEvent(events: ConductorEvent[], type: string): ConductorEvent | undefined {
  return events.find(e => e.type === type);
}

function makeUser(id: string, connected: boolean = true): User {
  return {
    id: id as UserId,
    seatId: null,
    connected,
    joinedAt: Date.now(),
    finaleChapter: null,
  };
}

function makeFragment(attemptIndex: number, layerIndex: number, option: 'A' | 'B', chapter: Chapter): Fragment {
  return {
    id: `${attemptIndex}-${layerIndex}-${option}`,
    attemptIndex,
    layerIndex,
    option,
    chapter,
    layerType: 'foundation',
    displayName: `${chapter}: Foundation ${option}`,
    audioRef: { trackIndex: 0 },
    safeParameter: {
      name: `param-${attemptIndex}-${layerIndex}`,
      displayLabel: 'Intensity',
      abletonMapping: { trackIndex: 0, deviceIndex: 0, paramIndex: 0 },
      min: 0.2,
      max: 0.8,
      defaultValue: 0.5,
      smoothingMs: 50,
    },
  };
}

function makeQueueEntry(userId: string, fragment: Fragment, hasBeenSteward: boolean = false): QueueEntry {
  return {
    userId: userId as UserId,
    fragment,
    chapter: fragment.chapter,
    enqueuedAt: Date.now(),
    hasBeenSteward,
  };
}

function makeActiveSlot(slotIndex: number, fragment: Fragment, stewardUserId: string, beat: number = 0): ActiveSlot {
  return {
    slotIndex,
    fragment,
    stewardUserId: stewardUserId as UserId,
    parameterValue: fragment.safeParameter.defaultValue,
    activatedAtBeat: beat,
    energyLevel: 0,
  };
}

// ============================================================================
// Chapter Assignment
// ============================================================================

describe('assignChapters', () => {
  test('assigns all connected users to chapters', () => {
    const users = new Map<UserId, User>();
    for (let i = 0; i < 9; i++) {
      users.set(`user-${i}` as UserId, makeUser(`user-${i}`));
    }

    const assignments = assignChapters(users);
    expect(assignments.size).toBe(9);

    // Every user should have a chapter
    assignments.forEach(chapter => {
      expect(['ambition', 'love', 'avoidance']).toContain(chapter);
    });
  });

  test('assignment is even (±1) across chapters', () => {
    const users = new Map<UserId, User>();
    for (let i = 0; i < 40; i++) {
      users.set(`user-${i}` as UserId, makeUser(`user-${i}`));
    }

    const assignments = assignChapters(users);
    const counts: Record<string, number> = { ambition: 0, love: 0, avoidance: 0 };
    assignments.forEach(chapter => counts[chapter]++);

    // With 40 users, each chapter should have 13 or 14
    expect(counts.ambition).toBeGreaterThanOrEqual(13);
    expect(counts.ambition).toBeLessThanOrEqual(14);
    expect(counts.love).toBeGreaterThanOrEqual(13);
    expect(counts.love).toBeLessThanOrEqual(14);
    expect(counts.avoidance).toBeGreaterThanOrEqual(13);
    expect(counts.avoidance).toBeLessThanOrEqual(14);
  });

  test('skips disconnected users', () => {
    const users = new Map<UserId, User>();
    users.set('u1' as UserId, makeUser('u1', true));
    users.set('u2' as UserId, makeUser('u2', false));
    users.set('u3' as UserId, makeUser('u3', true));

    const assignments = assignChapters(users);
    expect(assignments.size).toBe(2);
    expect(assignments.has('u1' as UserId)).toBe(true);
    expect(assignments.has('u2' as UserId)).toBe(false);
    expect(assignments.has('u3' as UserId)).toBe(true);
  });

  test('handles zero users', () => {
    const assignments = assignChapters(new Map());
    expect(assignments.size).toBe(0);
  });

  test('handles single user', () => {
    const users = new Map<UserId, User>();
    users.set('solo' as UserId, makeUser('solo'));

    const assignments = assignChapters(users);
    expect(assignments.size).toBe(1);
    expect(['ambition', 'love', 'avoidance']).toContain(assignments.get('solo' as UserId));
  });
});

// ============================================================================
// Centroid Computation
// ============================================================================

describe('computeCentroid', () => {
  test('returns equal weights for empty positions', () => {
    const centroid = computeCentroid(new Map());
    expect(centroid.wAmbition).toBeCloseTo(1 / 3);
    expect(centroid.wLove).toBeCloseTo(1 / 3);
    expect(centroid.wAvoidance).toBeCloseTo(1 / 3);
  });

  test('returns the single position when only one user', () => {
    const positions = new Map<UserId, TrianglePosition>();
    positions.set('u1' as UserId, { wAmbition: 0.8, wLove: 0.1, wAvoidance: 0.1 });

    const centroid = computeCentroid(positions);
    expect(centroid.wAmbition).toBeCloseTo(0.8);
    expect(centroid.wLove).toBeCloseTo(0.1);
    expect(centroid.wAvoidance).toBeCloseTo(0.1);
  });

  test('averages multiple positions correctly', () => {
    const positions = new Map<UserId, TrianglePosition>();
    positions.set('u1' as UserId, { wAmbition: 1.0, wLove: 0.0, wAvoidance: 0.0 });
    positions.set('u2' as UserId, { wAmbition: 0.0, wLove: 1.0, wAvoidance: 0.0 });
    positions.set('u3' as UserId, { wAmbition: 0.0, wLove: 0.0, wAvoidance: 1.0 });

    const centroid = computeCentroid(positions);
    expect(centroid.wAmbition).toBeCloseTo(1 / 3);
    expect(centroid.wLove).toBeCloseTo(1 / 3);
    expect(centroid.wAvoidance).toBeCloseTo(1 / 3);
  });

  test('handles uneven weighting', () => {
    const positions = new Map<UserId, TrianglePosition>();
    positions.set('u1' as UserId, { wAmbition: 0.6, wLove: 0.2, wAvoidance: 0.2 });
    positions.set('u2' as UserId, { wAmbition: 0.4, wLove: 0.4, wAvoidance: 0.2 });

    const centroid = computeCentroid(positions);
    expect(centroid.wAmbition).toBeCloseTo(0.5);
    expect(centroid.wLove).toBeCloseTo(0.3);
    expect(centroid.wAvoidance).toBeCloseTo(0.2);
  });
});

// ============================================================================
// Fragment Selection
// ============================================================================

describe('selectFragment', () => {
  function setupFinaleState(state: ShowState, userIds: UserId[], layerCount: number = 3): void {
    advanceToFinaleSetup(state, userIds, layerCount);
    processCommand(state, { type: 'SETUP_FINALE' });
  }

  test('allows selection of a selectable fragment from user\'s chapter', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    setupFinaleState(state, userIds, 2);

    const finaleState = state.finaleState!;
    const userId = userIds[0];
    const chapter = finaleState.chapterAssignments.get(userId)!;

    // Find a selectable fragment for this user's chapter
    const available = getAvailableFragments(state);
    const validFragment = available.find(f => f.selectable && f.fragment.chapter === chapter);
    expect(validFragment).toBeDefined();

    const result = selectFragment(userId, validFragment!.fragment.id, state);
    expect(result.error).toBeUndefined();
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('FRAGMENT_QUEUED');

    // Check it was added to the queue
    expect(finaleState.queue).toHaveLength(1);
    expect(finaleState.queue[0].userId).toBe(userId);
  });

  test('rejects selection from wrong chapter', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    setupFinaleState(state, userIds, 2);

    const finaleState = state.finaleState!;
    const userId = userIds[0];
    const userChapter = finaleState.chapterAssignments.get(userId)!;

    // Find a fragment from a different chapter
    const available = getAvailableFragments(state);
    const wrongChapterFragment = available.find(
      f => f.selectable && f.fragment.chapter !== userChapter,
    );
    expect(wrongChapterFragment).toBeDefined();

    const result = selectFragment(userId, wrongChapterFragment!.fragment.id, state);
    expect(result.error).toContain('not from user\'s chapter');
    expect(finaleState.queue).toHaveLength(0);
  });

  test('rejects selection of non-selectable fragment', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    setupFinaleState(state, userIds, 2);

    const finaleState = state.finaleState!;
    const userId = userIds[0];
    const chapter = finaleState.chapterAssignments.get(userId)!;

    // Find a non-selectable fragment from user's chapter
    const available = getAvailableFragments(state);
    const lockedFragment = available.find(
      f => !f.selectable && f.fragment.chapter === chapter,
    );
    expect(lockedFragment).toBeDefined();

    const result = selectFragment(userId, lockedFragment!.fragment.id, state);
    expect(result.error).toContain('not selectable');
  });

  test('rejects duplicate selection by same user', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    setupFinaleState(state, userIds, 2);

    const finaleState = state.finaleState!;
    const userId = userIds[0];
    const chapter = finaleState.chapterAssignments.get(userId)!;

    const available = getAvailableFragments(state);
    const validFragments = available.filter(
      f => f.selectable && f.fragment.chapter === chapter,
    );
    expect(validFragments.length).toBeGreaterThanOrEqual(1);

    // First selection succeeds
    selectFragment(userId, validFragments[0].fragment.id, state);
    expect(finaleState.queue).toHaveLength(1);

    // Second selection from same user fails
    const fragmentId = validFragments.length > 1
      ? validFragments[1].fragment.id
      : validFragments[0].fragment.id;
    const result = selectFragment(userId, fragmentId, state);
    expect(result.error).toContain('already has a fragment');
  });

  test('rejects when finale not initialized', () => {
    const state = createTestState();
    const result = selectFragment('u1' as UserId, '0-0-A', state);
    expect(result.error).toBe('Finale not initialized');
  });
});

// ============================================================================
// Queue Scheduling
// ============================================================================

describe('scheduleRotation', () => {
  const centroidEqual: TrianglePosition = { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };

  test('prioritizes users who haven\'t stewarded', () => {
    const fragA = makeFragment(0, 0, 'A', 'ambition');
    const fragB = makeFragment(0, 1, 'A', 'ambition');
    const fragC = makeFragment(1, 0, 'A', 'love');

    const queue: QueueEntry[] = [
      makeQueueEntry('u1', fragA, true),   // has stewarded
      makeQueueEntry('u2', fragB, false),  // hasn't stewarded
      makeQueueEntry('u3', fragC, false),  // hasn't stewarded
    ];

    const emptySlots: (ActiveSlot | null)[] = Array(7).fill(null);
    const result = scheduleRotation(queue, centroidEqual, emptySlots, 2);

    expect(result).toHaveLength(2);
    // Non-stewards should be picked first
    expect(result.map(e => e.userId)).toContain('u2');
    expect(result.map(e => e.userId)).toContain('u3');
  });

  test('uses chapter weighting from centroid among equally fair candidates', () => {
    const fragAmbition = makeFragment(0, 0, 'A', 'ambition');
    const fragLove = makeFragment(1, 0, 'A', 'love');

    const queue: QueueEntry[] = [
      makeQueueEntry('u1', fragAmbition, false),
      makeQueueEntry('u2', fragLove, false),
    ];

    // Centroid heavily weighted toward ambition
    const centroid: TrianglePosition = { wAmbition: 0.8, wLove: 0.1, wAvoidance: 0.1 };
    const emptySlots: (ActiveSlot | null)[] = Array(7).fill(null);

    const result = scheduleRotation(queue, centroid, emptySlots, 1);
    expect(result).toHaveLength(1);
    expect(result[0].fragment.chapter).toBe('ambition');
  });

  test('applies diversity nudge for underrepresented chapters', () => {
    const fragAmbition = makeFragment(0, 0, 'A', 'ambition');
    const fragLove = makeFragment(1, 0, 'A', 'love');

    const queue: QueueEntry[] = [
      makeQueueEntry('u1', fragAmbition, false),
      makeQueueEntry('u2', fragLove, false),
    ];

    // Centroid slightly favors ambition
    const centroid: TrianglePosition = { wAmbition: 0.4, wLove: 0.3, wAvoidance: 0.3 };

    // All active slots are ambition → love gets diversity nudge
    const slots: (ActiveSlot | null)[] = [
      makeActiveSlot(0, makeFragment(0, 1, 'A', 'ambition'), 'u10'),
      ...Array(6).fill(null),
    ];

    const result = scheduleRotation(queue, centroid, slots, 1);
    expect(result).toHaveLength(1);
    // Love should win because it gets +0.5 diversity nudge (not represented)
    // ambition: 1000 + 0.4 = 1000.4
    // love: 1000 + 0.3 + 0.5 = 1000.8
    expect(result[0].fragment.chapter).toBe('love');
  });

  test('returns empty when queue is empty', () => {
    const result = scheduleRotation([], centroidEqual, Array(7).fill(null), 2);
    expect(result).toHaveLength(0);
  });

  test('skips entries whose fragments are already in active slots', () => {
    const frag = makeFragment(0, 0, 'A', 'ambition');
    const queue: QueueEntry[] = [makeQueueEntry('u1', frag)];

    const slots: (ActiveSlot | null)[] = [
      makeActiveSlot(0, frag, 'u1'),
      ...Array(6).fill(null),
    ];

    const result = scheduleRotation(queue, centroidEqual, slots, 1);
    expect(result).toHaveLength(0);
  });

  test('limits results to slotsToRotate count', () => {
    const queue: QueueEntry[] = [
      makeQueueEntry('u1', makeFragment(0, 0, 'A', 'ambition')),
      makeQueueEntry('u2', makeFragment(0, 1, 'A', 'ambition')),
      makeQueueEntry('u3', makeFragment(1, 0, 'A', 'love')),
    ];

    const result = scheduleRotation(queue, centroidEqual, Array(7).fill(null), 1);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// Stewardship Lifecycle
// ============================================================================

describe('stewardship lifecycle', () => {
  test('startStewardship adds a log entry with null endBeat', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());
    const frag = makeFragment(0, 0, 'A', 'ambition');

    const entry = startStewardship(finaleState, 0, frag, 'u1' as UserId, 100);

    expect(entry.userId).toBe('u1');
    expect(entry.slotIndex).toBe(0);
    expect(entry.startBeat).toBe(100);
    expect(entry.endBeat).toBeNull();
    expect(finaleState.stewardshipLog).toHaveLength(1);
  });

  test('endStewardship closes the active log entry', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());
    const frag = makeFragment(0, 0, 'A', 'ambition');

    startStewardship(finaleState, 0, frag, 'u1' as UserId, 100);
    const closed = endStewardship(finaleState, 0, 200);

    expect(closed).not.toBeNull();
    expect(closed!.endBeat).toBe(200);
    expect(finaleState.stewardshipLog[0].endBeat).toBe(200);
  });

  test('endStewardship returns null when no active stewardship for slot', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());

    const result = endStewardship(finaleState, 5, 200);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Steward Parameter
// ============================================================================

describe('updateStewardParam', () => {
  test('clamps value to safe parameter range', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());
    const frag = makeFragment(0, 0, 'A', 'ambition');
    // frag.safeParameter has min: 0.2, max: 0.8

    finaleState.activeSlots[0] = makeActiveSlot(0, frag, 'u1');

    // Value above max
    const result1 = updateStewardParam('u1' as UserId, 1.5, finaleState);
    expect(result1).not.toBeNull();
    expect(result1!.clampedValue).toBe(0.8);

    // Value below min
    const result2 = updateStewardParam('u1' as UserId, -0.5, finaleState);
    expect(result2).not.toBeNull();
    expect(result2!.clampedValue).toBe(0.2);

    // Value within range
    const result3 = updateStewardParam('u1' as UserId, 0.5, finaleState);
    expect(result3).not.toBeNull();
    expect(result3!.clampedValue).toBe(0.5);
  });

  test('rejects non-steward user', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());
    const frag = makeFragment(0, 0, 'A', 'ambition');

    finaleState.activeSlots[0] = makeActiveSlot(0, frag, 'u1');

    const result = updateStewardParam('u2' as UserId, 0.5, finaleState);
    expect(result).toBeNull();
  });

  test('updates the slot parameterValue', () => {
    const config = createTestConfig().finale;
    const finaleState = initializeFinaleState(config, new Map());
    const frag = makeFragment(0, 0, 'A', 'ambition');

    finaleState.activeSlots[0] = makeActiveSlot(0, frag, 'u1');

    updateStewardParam('u1' as UserId, 0.6, finaleState);
    expect(finaleState.activeSlots[0]!.parameterValue).toBe(0.6);
  });
});


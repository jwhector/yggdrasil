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
  performRotationTick,
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
// Rotation Tick
// ============================================================================

describe('performRotationTick', () => {
  function setupRotatingState(userCount: number = 6, layerCount: number = 2): {
    state: ShowState;
    userIds: UserId[];
  } {
    const state = createTestState(layerCount);
    const userIds = connectUsers(state, userCount);
    advanceToFinaleSetup(state, userIds, layerCount);
    processCommand(state, { type: 'SETUP_FINALE' });
    processCommand(state, { type: 'ADVANCE_PHASE' }); // finale_setup → finale_rotating

    // Select fragments for all users
    const available = getAvailableFragments(state);
    const finaleState = state.finaleState!;
    for (const userId of userIds) {
      const chapter = finaleState.chapterAssignments.get(userId);
      const validFrag = available.find(
        f => f.selectable && f.fragment.chapter === chapter,
      );
      if (validFrag) {
        processCommand(state, { type: 'SELECT_FRAGMENT', userId, fragmentId: validFrag.fragment.id });
      }
    }

    return { state, userIds };
  }

  test('fills empty slots from queue on initial rotation', () => {
    const { state } = setupRotatingState();
    const finaleState = state.finaleState!;

    expect(finaleState.queue.length).toBeGreaterThan(0);

    // Start rotation
    const events = processCommand(state, { type: 'START_ROTATION' });

    // Should have filled slots
    const activatedSlots = finaleState.activeSlots.filter(s => s !== null);
    expect(activatedSlots.length).toBeGreaterThan(0);

    // Should have SLOT_ACTIVATED events
    const slotActivated = events.filter(e => e.type === 'SLOT_ACTIVATED');
    expect(slotActivated.length).toBeGreaterThan(0);
  });

  test('does not rotate when rotation is not active', () => {
    const { state } = setupRotatingState();
    // Don't start rotation
    const events = performRotationTick(state, 100);
    expect(events).toHaveLength(0);
  });

  test('does not rotate when frozen', () => {
    const { state } = setupRotatingState();
    processCommand(state, { type: 'START_ROTATION' });
    processCommand(state, { type: 'FREEZE_ROTATION' });

    const events = performRotationTick(state, 100);
    expect(events).toHaveLength(0);
  });

  test('marks queue entries as having been steward after activation', () => {
    const { state } = setupRotatingState();
    processCommand(state, { type: 'START_ROTATION' });

    const finaleState = state.finaleState!;
    const stewardedEntries = finaleState.queue.filter(e => e.hasBeenSteward);
    expect(stewardedEntries.length).toBeGreaterThan(0);
  });

  test('emits ROTATION_TICK event with new and removed slots', () => {
    const { state } = setupRotatingState();
    const events = processCommand(state, { type: 'START_ROTATION' });

    const tickEvent = findEvent(events, 'ROTATION_TICK');
    expect(tickEvent).toBeDefined();
    if (tickEvent && tickEvent.type === 'ROTATION_TICK') {
      expect(tickEvent.newSlots.length).toBeGreaterThan(0);
    }
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

// ============================================================================
// Conductor Finale Command Wiring
// ============================================================================

describe('conductor finale commands', () => {
  test('SETUP_FINALE assigns chapters and initializes finaleState', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);

    expect(state.phase).toBe('finale_setup');
    expect(state.finaleState).toBeNull();

    const events = processCommand(state, { type: 'SETUP_FINALE' });

    expect(state.finaleState).not.toBeNull();
    expect(state.finaleState!.chapterAssignments.size).toBe(6);
    expect(state.finaleState!.activeSlots).toHaveLength(7);

    const setupEvent = findEvent(events, 'FINALE_SETUP_COMPLETE');
    expect(setupEvent).toBeDefined();
  });

  test('SETUP_FINALE rejects when not in finale_setup phase', () => {
    const state = createTestState();
    const events = processCommand(state, { type: 'SETUP_FINALE' });

    const error = findEvent(events, 'ERROR');
    expect(error).toBeDefined();
  });

  test('UPDATE_TRIANGLE updates centroid', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    const events = processCommand(state, {
      type: 'UPDATE_TRIANGLE',
      userId: userIds[0],
      position: { wAmbition: 0.8, wLove: 0.1, wAvoidance: 0.1 },
    });

    const centroidEvent = findEvent(events, 'CENTROID_UPDATED');
    expect(centroidEvent).toBeDefined();
    expect(state.finaleState!.centroid.wAmbition).toBeCloseTo(0.8);
  });

  test('UPDATE_TRIANGLE is silently ignored when triangle is disabled', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    processCommand(state, { type: 'TOGGLE_TRIANGLE', active: false });

    const events = processCommand(state, {
      type: 'UPDATE_TRIANGLE',
      userId: userIds[0],
      position: { wAmbition: 0.8, wLove: 0.1, wAvoidance: 0.1 },
    });

    // No centroid update when disabled
    const centroidEvent = findEvent(events, 'CENTROID_UPDATED');
    expect(centroidEvent).toBeUndefined();
  });

  test('UPDATE_STEWARD_PARAM emits AUDIO_CUE with clamped value', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_rotating

    // Select fragments and start rotation to get stewards
    const finaleState = state.finaleState!;
    const available = getAvailableFragments(state);
    for (const userId of userIds) {
      const chapter = finaleState.chapterAssignments.get(userId);
      const frag = available.find(f => f.selectable && f.fragment.chapter === chapter);
      if (frag) {
        processCommand(state, { type: 'SELECT_FRAGMENT', userId, fragmentId: frag.fragment.id });
      }
    }
    processCommand(state, { type: 'START_ROTATION' });

    // Find a user who is a steward
    const stewardSlot = finaleState.activeSlots.find(s => s !== null);
    if (stewardSlot) {
      const events = processCommand(state, {
        type: 'UPDATE_STEWARD_PARAM',
        userId: stewardSlot.stewardUserId,
        value: 0.7,
      });

      const audioCue = findEvent(events, 'AUDIO_CUE');
      expect(audioCue).toBeDefined();
    }
  });

  test('STOP_ROTATION sets rotationActive to false', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_rotating

    state.finaleState!.rotationActive = true;
    processCommand(state, { type: 'STOP_ROTATION' });

    expect(state.finaleState!.rotationActive).toBe(false);
  });

  test('FREEZE_ROTATION transitions to finale_frozen', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_rotating

    const events = processCommand(state, { type: 'FREEZE_ROTATION' });

    expect(state.phase).toBe('finale_frozen');
    expect(state.finaleState!.frozen).toBe(true);
    expect(state.finaleState!.rotationActive).toBe(false);

    const phaseEvent = findEvent(events, 'SHOW_PHASE_CHANGED');
    expect(phaseEvent).toBeDefined();
  });

  test('SET_ROTATION_RATE changes the rotation rate', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 3);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    processCommand(state, { type: 'SET_ROTATION_RATE', rate: 1 });
    expect(state.finaleState!.rotationRate).toBe(1);

    processCommand(state, { type: 'SET_ROTATION_RATE', rate: 2 });
    expect(state.finaleState!.rotationRate).toBe(2);
  });

  test('CLEAR_QUEUE empties the queue', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    // Queue some fragments
    const finaleState = state.finaleState!;
    const available = getAvailableFragments(state);
    const userId = userIds[0];
    const chapter = finaleState.chapterAssignments.get(userId);
    const frag = available.find(f => f.selectable && f.fragment.chapter === chapter);
    if (frag) {
      processCommand(state, { type: 'SELECT_FRAGMENT', userId, fragmentId: frag.fragment.id });
    }
    expect(finaleState.queue.length).toBeGreaterThan(0);

    processCommand(state, { type: 'CLEAR_QUEUE' });
    expect(finaleState.queue).toHaveLength(0);
  });

  test('TOGGLE_TRIANGLE updates triangleActive state', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 3);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    expect(state.finaleState!.triangleActive).toBe(true);

    processCommand(state, { type: 'TOGGLE_TRIANGLE', active: false });
    expect(state.finaleState!.triangleActive).toBe(false);

    processCommand(state, { type: 'TOGGLE_TRIANGLE', active: true });
    expect(state.finaleState!.triangleActive).toBe(true);
  });

  test('FORCE_INSERT_FRAGMENT inserts a fragment into a specific slot', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    const available = getAvailableFragments(state);
    const selectableFrag = available.find(f => f.selectable);
    expect(selectableFrag).toBeDefined();

    const events = processCommand(state, {
      type: 'FORCE_INSERT_FRAGMENT',
      fragmentId: selectableFrag!.fragment.id,
      slotIndex: 3,
    });

    expect(state.finaleState!.activeSlots[3]).not.toBeNull();
    expect(state.finaleState!.activeSlots[3]!.fragment.id).toBe(selectableFrag!.fragment.id);

    const activatedEvent = findEvent(events, 'SLOT_ACTIVATED');
    expect(activatedEvent).toBeDefined();
  });

  test('FORCE_ASSIGN_STEWARD changes the steward for an active slot', () => {
    const state = createTestState(2);
    const userIds = connectUsers(state, 6);
    advanceToFinaleSetup(state, userIds, 2);
    processCommand(state, { type: 'SETUP_FINALE' });

    // Force insert a fragment to have an active slot
    const available = getAvailableFragments(state);
    const frag = available.find(f => f.selectable)!;
    processCommand(state, { type: 'FORCE_INSERT_FRAGMENT', fragmentId: frag.fragment.id, slotIndex: 0 });

    const events = processCommand(state, {
      type: 'FORCE_ASSIGN_STEWARD',
      userId: userIds[1],
      slotIndex: 0,
    });

    expect(state.finaleState!.activeSlots[0]!.stewardUserId).toBe(userIds[1]);

    const startedEvent = findEvent(events, 'STEWARDSHIP_STARTED');
    expect(startedEvent).toBeDefined();

    const endedEvent = findEvent(events, 'STEWARDSHIP_ENDED');
    expect(endedEvent).toBeDefined();
  });
});

// ============================================================================
// Full Show Flow
// ============================================================================

describe('full show flow', () => {
  test('lobby → 3 attempts (with collapse) → finale setup → rotation → freeze → end', () => {
    const state = createTestState(3);
    const userIds = connectUsers(state, 6);

    // === Song-building: 3 attempts ===
    advanceToBuild(state, 0);
    expect(state.phase).toBe('attempt_build');
    expect(state.currentAttemptIndex).toBe(0);

    // Attempt 0: complete all layers
    completeAttempt(state, userIds, 3);
    expect(state.attempts[0].status).toBe('completed');

    // Advance to attempt 1
    processCommand(state, { type: 'ADVANCE_PHASE' }); // build → story
    processCommand(state, { type: 'ADVANCE_PHASE' }); // story → build

    // Attempt 1: force collapse at layer 1
    completeSingleLayer(state, userIds, 'A'); // layer 0 locked in
    processCommand(state, { type: 'FORCE_COLLAPSE' });
    expect(state.attempts[1].status).toBe('collapsed');
    // Auto-advances to attempt 2 story
    expect(state.phase).toBe('attempt_story');
    expect(state.currentAttemptIndex).toBe(2);

    // Attempt 2: complete all layers
    processCommand(state, { type: 'ADVANCE_PHASE' }); // story → build
    completeAttempt(state, userIds, 3);
    expect(state.attempts[2].status).toBe('completed');

    // === Finale ===
    processCommand(state, { type: 'ADVANCE_PHASE' }); // build → finale_setup
    expect(state.phase).toBe('finale_setup');

    // Setup finale
    const setupEvents = processCommand(state, { type: 'SETUP_FINALE' });
    expect(findEvent(setupEvents, 'FINALE_SETUP_COMPLETE')).toBeDefined();
    expect(state.finaleState).not.toBeNull();
    expect(state.finaleState!.chapterAssignments.size).toBe(6);

    // Verify fragments are available (attempt 0: 3 layers × 2, attempt 1: 1 locked + 2 unreached × 2, attempt 2: 3 layers × 2)
    const fragments = getAvailableFragments(state);
    const selectable = fragments.filter(f => f.selectable);
    // Attempt 0: 3 selectable, Attempt 1: 1 selectable (layer 0 locked in), Attempt 2: 3 selectable = 7
    expect(selectable).toHaveLength(7);

    // Users select fragments
    const finaleState = state.finaleState!;
    for (const userId of userIds) {
      const chapter = finaleState.chapterAssignments.get(userId);
      const validFrag = selectable.find(f => f.fragment.chapter === chapter);
      if (validFrag) {
        processCommand(state, { type: 'SELECT_FRAGMENT', userId, fragmentId: validFrag.fragment.id });
      }
    }

    // Advance to finale_rotating
    processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.phase).toBe('finale_rotating');

    // Start rotation
    const rotationEvents = processCommand(state, { type: 'START_ROTATION' });
    expect(finaleState.rotationActive).toBe(true);
    const tickEvent = findEvent(rotationEvents, 'ROTATION_TICK');
    expect(tickEvent).toBeDefined();

    // Freeze rotation
    processCommand(state, { type: 'FREEZE_ROTATION' });
    expect(state.phase).toBe('finale_frozen');
    expect(finaleState.frozen).toBe(true);

    // End show
    processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.phase).toBe('ended');
  });
});

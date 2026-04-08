// @ts-nocheck — deprecated V3.2 code, to be deleted/rewritten in V3.3 Phase 2
/**
 * Assignment Phase Tests (V3.2)
 *
 * Tests for auto-assignment, self-select, and phase transitions.
 */

import { describe, test, expect } from '@jest/globals';
import {
  autoAssign,
  initializeSelfSelect,
  selectGranularType,
  assignUndecided,
  getUndecidedUsers,
  getGroupSizes,
} from '../assignment';
import { createInitialState, processCommand } from '../conductor';
import type {
  ShowConfig,
  V32AttemptConfig,
  V32LayerConfig,
  User,
  UserId,
  GranularType,
} from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_GRANULAR_TYPES: GranularType[] = [
  { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
  { id: 'drums', label: 'Drums', color: '#000', symbol: '▲' },
  { id: 'pad', label: 'Pad', color: '#000', symbol: '◆' },
  { id: 'seed', label: 'Seed', color: '#000', symbol: '◎' },
  { id: 'harmony', label: 'Harmony', color: '#000', symbol: '●' },
  { id: 'fx', label: 'FX', color: '#000', symbol: '~' },
];

function makeUsers(count: number, connected = true): Map<UserId, User> {
  const users = new Map<UserId, User>();
  for (let i = 0; i < count; i++) {
    users.set(`user-${i}`, {
      id: `user-${i}`,
      seatId: null,
      connected,
      joinedAt: Date.now(),
    });
  }
  return users;
}

function makeV32LayerConfig(index: number): V32LayerConfig {
  return {
    index,
    group: ['bones', 'flesh', 'spark'][index % 3],
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    optionA: { tracks: [{ granularType: 'bass', trackIndices: [index * 2] }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndices: [index * 2 + 1] }] },
  };
}

function makeAttemptConfig(chapter: 'ambition' | 'love' | 'avoidance'): V32AttemptConfig {
  return {
    chapter,
    title: chapter,
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: [0, 1, 2].map(i => makeV32LayerConfig(i)),
    thresholds: [0.5, 0.66, 0.99],
    tempos: [120, 120, 120],
    auditionBars: [4, 4, 2],
    auditionCycles: [1, 1, 1],
  };
}

function createTestConfig(assignmentMode: 'auto' | 'self_select' = 'auto'): ShowConfig {
  return {
    layersPerAttempt: 3,
    granularTypes: TEST_GRANULAR_TYPES,
    attempts: [
      makeAttemptConfig('ambition'),
      makeAttemptConfig('love'),
      makeAttemptConfig('avoidance'),
    ],
    finale: {
      assignmentMode,
      assignmentTimerMs: 30000,
      bothOptionsSurvive: true,
      crossSongConstraint: false,
      audioPreviewPath: '/audio/previews',
      npcMessages: [
        { event: 'assignment_start', text: 'Find your voice.' },
      ],
    },
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
      loopBoundaryBeats: 32,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function totalAssigned(groups: Map<string, UserId[]>): number {
  let total = 0;
  for (const members of groups.values()) total += members.length;
  return total;
}

// ============================================================================
// autoAssign Tests
// ============================================================================

describe('autoAssign', () => {
  test('distributes 12 users evenly across 6 types (2 each)', () => {
    const users = makeUsers(12);
    const groups = autoAssign(users, TEST_GRANULAR_TYPES);

    expect(groups.size).toBe(6);
    for (const members of groups.values()) {
      expect(members.length).toBe(2);
    }
    expect(totalAssigned(groups)).toBe(12);
  });

  test('handles uneven distribution (10 users / 6 types)', () => {
    const users = makeUsers(10);
    const groups = autoAssign(users, TEST_GRANULAR_TYPES);

    expect(totalAssigned(groups)).toBe(10);
    // Each group has 1 or 2 members
    for (const members of groups.values()) {
      expect(members.length).toBeGreaterThanOrEqual(1);
      expect(members.length).toBeLessThanOrEqual(2);
    }
  });

  test('excludes disconnected users', () => {
    const users = makeUsers(6);
    // Disconnect half
    users.get('user-0')!.connected = false;
    users.get('user-2')!.connected = false;
    users.get('user-4')!.connected = false;

    const groups = autoAssign(users, TEST_GRANULAR_TYPES);
    expect(totalAssigned(groups)).toBe(3);
  });

  test('returns empty groups when 0 connected users', () => {
    const users = makeUsers(0);
    const groups = autoAssign(users, TEST_GRANULAR_TYPES);

    expect(groups.size).toBe(6);
    for (const members of groups.values()) {
      expect(members.length).toBe(0);
    }
  });

  test('each user appears in exactly one group', () => {
    const users = makeUsers(20);
    const groups = autoAssign(users, TEST_GRANULAR_TYPES);

    const allAssigned = new Set<string>();
    for (const members of groups.values()) {
      for (const id of members) {
        expect(allAssigned.has(id)).toBe(false);
        allAssigned.add(id);
      }
    }
    expect(allAssigned.size).toBe(20);
  });
});

// ============================================================================
// Self-Select Tests
// ============================================================================

describe('initializeSelfSelect', () => {
  test('creates empty groups for all granular types', () => {
    const assignment = initializeSelfSelect(TEST_GRANULAR_TYPES, 30000);

    expect(assignment.mode).toBe('self_select');
    expect(assignment.groups.size).toBe(6);
    for (const members of assignment.groups.values()) {
      expect(members.length).toBe(0);
    }
    expect(assignment.timerRemaining).toBe(30000);
  });
});

describe('selectGranularType', () => {
  test('moves user into correct group', () => {
    const assignment = initializeSelfSelect(TEST_GRANULAR_TYPES, 30000);
    selectGranularType(assignment, 'user-1', 'bass');

    expect(assignment.groups.get('bass')).toContain('user-1');
  });

  test('allows switching groups (removes from old group)', () => {
    const assignment = initializeSelfSelect(TEST_GRANULAR_TYPES, 30000);
    selectGranularType(assignment, 'user-1', 'bass');
    selectGranularType(assignment, 'user-1', 'drums');

    expect(assignment.groups.get('bass')).not.toContain('user-1');
    expect(assignment.groups.get('drums')).toContain('user-1');
  });

  test('multiple users can join the same group', () => {
    const assignment = initializeSelfSelect(TEST_GRANULAR_TYPES, 30000);
    selectGranularType(assignment, 'user-1', 'bass');
    selectGranularType(assignment, 'user-2', 'bass');
    selectGranularType(assignment, 'user-3', 'bass');

    expect(assignment.groups.get('bass')!.length).toBe(3);
  });
});

describe('assignUndecided', () => {
  test('distributes remaining users who never selected', () => {
    const assignment = initializeSelfSelect(TEST_GRANULAR_TYPES, 30000);
    selectGranularType(assignment, 'user-0', 'bass');
    selectGranularType(assignment, 'user-1', 'drums');

    const connectedIds = ['user-0', 'user-1', 'user-2', 'user-3', 'user-4', 'user-5'];
    assignUndecided(assignment, connectedIds, TEST_GRANULAR_TYPES);

    // All 6 users should now be assigned
    expect(totalAssigned(assignment.groups)).toBe(6);
    // Original assignments preserved
    expect(assignment.groups.get('bass')).toContain('user-0');
    expect(assignment.groups.get('drums')).toContain('user-1');
  });
});

describe('getUndecidedUsers', () => {
  test('returns users not in any group', () => {
    const groups = new Map<string, UserId[]>([
      ['bass', ['user-0']],
      ['drums', ['user-1']],
    ]);
    const connected = ['user-0', 'user-1', 'user-2', 'user-3'];
    const undecided = getUndecidedUsers(connected, groups);

    expect(undecided).toEqual(expect.arrayContaining(['user-2', 'user-3']));
    expect(undecided.length).toBe(2);
  });
});

describe('getGroupSizes', () => {
  test('returns correct sizes', () => {
    const groups = new Map<string, UserId[]>([
      ['bass', ['user-0', 'user-1']],
      ['drums', ['user-2']],
      ['pad', []],
    ]);
    const sizes = getGroupSizes(groups);

    expect(sizes.get('bass')).toBe(2);
    expect(sizes.get('drums')).toBe(1);
    expect(sizes.get('pad')).toBe(0);
  });
});

// ============================================================================
// Phase Transition Tests (via processCommand)
// ============================================================================

describe('assignment phase transitions', () => {
  function createStateAtElegy(mode: 'auto' | 'self_select' = 'auto') {
    const config = createTestConfig(mode);
    const state = createInitialState(config, 'test-show');

    // Add users
    for (let i = 0; i < 12; i++) {
      processCommand(state, { type: 'USER_CONNECT', userId: `user-${i}` });
    }

    // Jump directly to finale_elegy
    processCommand(state, { type: 'JUMP_TO_PHASE', phase: 'finale_elegy' });
    expect(state.phase).toBe('finale_elegy');
    return state;
  }

  test('ADVANCE_PHASE from finale_elegy transitions to finale_assignment', () => {
    const state = createStateAtElegy();
    processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.phase).toBe('finale_assignment');
  });

  test('ADVANCE_PHASE from finale_assignment transitions to finale_live_mix', () => {
    const state = createStateAtElegy();
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix
    expect(state.phase).toBe('finale_live_mix');
  });

  test('START_ASSIGNMENT in auto mode emits ASSIGNMENT_STARTED + GROUPS_ASSIGNED', () => {
    const state = createStateAtElegy('auto');
    const events = processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment

    const assignmentStarted = events.find(e => e.type === 'ASSIGNMENT_STARTED');
    const groupsAssigned = events.find(e => e.type === 'GROUPS_ASSIGNED');

    expect(assignmentStarted).toBeDefined();
    expect((assignmentStarted as any).mode).toBe('auto');
    expect(groupsAssigned).toBeDefined();

    // All 12 users should be assigned
    const groups = (groupsAssigned as any).groups as Map<string, UserId[]>;
    let total = 0;
    for (const members of groups.values()) total += members.length;
    expect(total).toBe(12);
  });

  test('START_ASSIGNMENT in self-select mode emits only ASSIGNMENT_STARTED', () => {
    const state = createStateAtElegy('self_select');
    const events = processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment

    const assignmentStarted = events.find(e => e.type === 'ASSIGNMENT_STARTED');
    const groupsAssigned = events.find(e => e.type === 'GROUPS_ASSIGNED');

    expect(assignmentStarted).toBeDefined();
    expect((assignmentStarted as any).mode).toBe('self_select');
    expect(groupsAssigned).toBeUndefined();

    // Timer should be set
    expect(state.finaleState!.assignment.timerRemaining).toBe(30000);
  });

  test('SELECT_GRANULAR_TYPE in auto mode returns error', () => {
    const state = createStateAtElegy('auto');
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment

    const events = processCommand(state, {
      type: 'SELECT_GRANULAR_TYPE',
      userId: 'user-0',
      granularType: 'bass',
    });

    expect(events.some(e => e.type === 'ERROR')).toBe(true);
  });

  test('SELECT_GRANULAR_TYPE in self-select mode emits GROUPS_ASSIGNED', () => {
    const state = createStateAtElegy('self_select');
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment

    const events = processCommand(state, {
      type: 'SELECT_GRANULAR_TYPE',
      userId: 'user-0',
      granularType: 'bass',
    });

    const groupsAssigned = events.find(e => e.type === 'GROUPS_ASSIGNED');
    expect(groupsAssigned).toBeDefined();
    const groups = (groupsAssigned as any).groups as Map<string, UserId[]>;
    expect(groups.get('bass')).toContain('user-0');
  });

  test('ASSIGNMENT_COMPLETE assigns undecided and emits GROUPS_ASSIGNED', () => {
    const state = createStateAtElegy('self_select');
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment

    // Only one user selects
    processCommand(state, {
      type: 'SELECT_GRANULAR_TYPE',
      userId: 'user-0',
      granularType: 'bass',
    });

    const events = processCommand(state, { type: 'ASSIGNMENT_COMPLETE' });
    const groupsAssigned = events.find(e => e.type === 'GROUPS_ASSIGNED');
    expect(groupsAssigned).toBeDefined();

    // All 12 users should now be assigned
    const groups = (groupsAssigned as any).groups as Map<string, UserId[]>;
    let total = 0;
    for (const members of groups.values()) total += members.length;
    expect(total).toBe(12);

    // user-0 should still be in bass
    expect(groups.get('bass')).toContain('user-0');
  });
});

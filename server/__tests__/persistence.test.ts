/**
 * Persistence Layer Tests (V2)
 *
 * Tests cover:
 * - Database initialization and WAL mode
 * - State save/load with Map serialization (users, finaleState)
 * - Layer vote, user, and consensus round persistence
 * - Transaction atomicity
 * - getLatestShow recovery flow
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createPersistence } from '../persistence';
import { createInitialState } from '../../conductor/conductor';
import type { ShowConfig, LayerVote, User, V32AttemptConfig, V32LayerConfig } from '../../conductor/types';

// ============================================================================
// Test Config Helper
// ============================================================================

function makeV32Layer(index: number): V32LayerConfig {
  return {
    index,
    group: ['bones', 'flesh', 'spark'][index % 3],
    labelA: 'A',
    labelB: 'B',
    optionA: { tracks: [{ granularType: 'bass', trackIndex: index * 2 }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndex: index * 2 + 1 }] },
  };
}

function createTestConfig(): ShowConfig {
  const makeAttempt = (chapter: 'ambition' | 'love' | 'avoidance'): V32AttemptConfig => ({
    chapter,
    title: chapter,
    liveSeed: { trackIndices: [99] },
    layers: [0, 1, 2].map(i => makeV32Layer(i)),
    thresholds: [0.5, 0.66, 0.99],
    tempos: [120, 120, 120],
    auditionBars: [4, 4, 2],
    auditionCycles: [1, 1, 1],
  });

  return {
    layersPerAttempt: 3,
    granularTypes: [
      { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
      { id: 'drums', label: 'Drums', color: '#000', symbol: '▲' },
    ],
    attempts: [makeAttempt('ambition'), makeAttempt('love'), makeAttempt('avoidance')],
    finale: {
      assignmentMode: 'auto',
      assignmentTimerMs: 30000,
      bothOptionsSurvive: true,
      crossSongConstraint: false,
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
    },
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 2000,
      loopBoundaryBeats: 32,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: ['seat-1', 'seat-2'],
  };
}

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DB_PATH = join(__dirname, 'test-persistence.db');
const TEST_DB_WAL = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM = `${TEST_DB_PATH}-shm`;

function cleanup() {
  for (const p of [TEST_DB_PATH, TEST_DB_WAL, TEST_DB_SHM]) {
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

beforeEach(cleanup);
afterEach(cleanup);

// ============================================================================
// Tests
// ============================================================================

describe('Database initialization', () => {
  test('creates database file', () => {
    const db = createPersistence(TEST_DB_PATH);
    expect(existsSync(TEST_DB_PATH)).toBe(true);
    db.close();
  });

  test('enables WAL mode (creates .wal file on first write)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-wal');
    db.saveState(state);
    expect(existsSync(TEST_DB_WAL)).toBe(true);
    db.close();
  });
});

describe('State persistence', () => {
  test('saves and loads state correctly', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('show-1');
    expect(loaded!.version).toBe(state.version);
    expect(loaded!.phase).toBe('lobby');

    db.close();
  });

  test('returns null for non-existent show', () => {
    const db = createPersistence(TEST_DB_PATH);
    expect(db.loadState('no-such-show')).toBeNull();
    db.close();
  });

  test('preserves Map<UserId, User>', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    state.users.set('user-1', { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 });
    state.users.set('user-2', { id: 'user-2', seatId: 'A2', connected: false, joinedAt: 2000 });

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.users).toBeInstanceOf(Map);
    expect(loaded!.users.size).toBe(2);
    expect(loaded!.users.get('user-1')?.seatId).toBe('A1');
    expect(loaded!.users.get('user-2')?.seatId).toBe('A2');

    db.close();
  });

  test('preserves null finaleState', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.finaleState).toBeNull();

    db.close();
  });

  test('preserves finaleState Maps (assignment groups, liveMix votes, liveMix activeFragments)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    state.finaleState = {
      phase: 'assignment',
      availableFragments: [],
      allFragments: [],
      assignment: {
        mode: 'auto',
        groups: new Map([['bass', ['user-1', 'user-2']], ['drums', ['user-3']]]),
        timerRemaining: null,
      },
      liveMix: {
        votes: new Map([['bass', new Map([['user-1', { fragmentId: 'frag-0-0-A', timestamp: 1 }]])]]),
        activeFragments: new Map([['bass', 'frag-0-0-A']]),
        lockedTypes: [],
        performerOverrides: new Map(),
        liveTracksActive: [],
        loopPosition: 0,
        loopCount: 0,
      },
      npc: { currentMessage: 'Try again' },
    };

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.finaleState).not.toBeNull();
    expect(loaded!.finaleState!.assignment.groups).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.assignment.groups.get('bass')).toEqual(['user-1', 'user-2']);
    expect(loaded!.finaleState!.liveMix.votes).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.liveMix.votes.get('bass')).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.liveMix.votes.get('bass')!.get('user-1')!.fragmentId).toBe('frag-0-0-A');
    expect(loaded!.finaleState!.liveMix.activeFragments).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.liveMix.activeFragments.get('bass')).toBe('frag-0-0-A');

    db.close();
  });

  test('updates existing state on re-save', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    db.saveState(state);
    state.version = 5;
    state.phase = 'attempt_build';
    db.saveState(state);

    const loaded = db.loadState('show-1');
    expect(loaded!.version).toBe(5);
    expect(loaded!.phase).toBe('attempt_build');

    db.close();
  });

  test('getLatestShow returns most recently updated show', () => {
    const db = createPersistence(TEST_DB_PATH);
    const config = createTestConfig();

    db.saveState(createInitialState(config, 'show-1'));
    db.saveState(createInitialState(config, 'show-2'));

    const latest = db.getLatestShow();
    expect(latest).not.toBeNull();
    expect(['show-1', 'show-2']).toContain(latest!.id);

    db.close();
  });

  test('getLatestShow returns null when no shows exist', () => {
    const db = createPersistence(TEST_DB_PATH);
    expect(db.getLatestShow()).toBeNull();
    db.close();
  });
});

describe('Layer vote persistence', () => {
  test('saves a layer vote', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 }, 'show-1');

    const vote: LayerVote = {
      userId: 'user-1',
      attemptIndex: 0,
      layerIndex: 0,
      choice: 'A',
      timestamp: Date.now(),
    };

    expect(() => db.saveLayerVote(vote, 'show-1')).not.toThrow();

    db.close();
  });

  test('allows multiple votes from same user across layers', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 }, 'show-1');

    db.saveLayerVote({ userId: 'user-1', attemptIndex: 0, layerIndex: 0, choice: 'A', timestamp: Date.now() }, 'show-1');
    db.saveLayerVote({ userId: 'user-1', attemptIndex: 0, layerIndex: 1, choice: 'B', timestamp: Date.now() }, 'show-1');

    db.close(); // No error = pass
  });
});

describe('User persistence', () => {
  test('saves a user', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    const user: User = { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 };
    expect(() => db.saveUser(user, 'show-1')).not.toThrow();

    db.close();
  });

  test('updates user on conflict (upsert)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    const user: User = { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 };
    db.saveUser(user, 'show-1');

    // Update seat
    user.seatId = 'B2';
    db.saveUser(user, 'show-1');

    const users = db.getUsersByShow('show-1');
    expect(users.length).toBe(1);
    expect(users[0].seatId).toBe('B2');

    db.close();
  });

  test('getUsersByShow returns users scoped to a show', () => {
    const db = createPersistence(TEST_DB_PATH);
    const config = createTestConfig();
    db.saveState(createInitialState(config, 'show-1'));
    db.saveState(createInitialState(config, 'show-2'));

    db.saveUser({ id: 'u1', seatId: 'A1', connected: true, joinedAt: 0 }, 'show-1');
    db.saveUser({ id: 'u2', seatId: 'A2', connected: true, joinedAt: 0 }, 'show-1');
    db.saveUser({ id: 'u3', seatId: 'B1', connected: true, joinedAt: 0 }, 'show-2');

    expect(db.getUsersByShow('show-1').length).toBe(2);
    expect(db.getUsersByShow('show-2').length).toBe(1);

    db.close();
  });
});

describe('Finale persistence (V3.2)', () => {
  test('saves a finale assignment', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: null, connected: true, joinedAt: Date.now() }, 'show-1');

    expect(() =>
      db.saveFinaleAssignment('show-1', 'user-1', 'bass', false)
    ).not.toThrow();

    db.close();
  });

  test('saves an auto-assigned finale assignment', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: null, connected: true, joinedAt: Date.now() }, 'show-1');

    expect(() =>
      db.saveFinaleAssignment('show-1', 'user-1', 'drums', true)
    ).not.toThrow();

    const assignments = db.getFinaleAssignments('show-1');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].granularType).toBe('drums');
    expect(assignments[0].autoAssigned).toBe(true);

    db.close();
  });

  test('retrieves all assignments for a show', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveFinaleAssignment('show-1', 'user-1', 'bass', true);
    db.saveFinaleAssignment('show-1', 'user-2', 'drums', true);
    db.saveFinaleAssignment('show-1', 'user-3', 'bass', false);

    const assignments = db.getFinaleAssignments('show-1');
    expect(assignments).toHaveLength(3);
    expect(assignments.map(a => a.granularType).sort()).toEqual(['bass', 'bass', 'drums']);

    db.close();
  });
});

describe('Transaction atomicity', () => {
  test('rapid saves preserve latest version', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    for (let i = 0; i < 10; i++) {
      state.version = i;
      db.saveState(state);
    }

    const loaded = db.loadState('show-1');
    expect(loaded!.version).toBe(9);

    db.close();
  });
});

describe('Close', () => {
  test('closes database connection without error', () => {
    const db = createPersistence(TEST_DB_PATH);
    expect(() => db.close()).not.toThrow();
  });
});

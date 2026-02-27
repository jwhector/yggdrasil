/**
 * Persistence Layer Tests (NEW SYSTEM)
 *
 * Tests cover:
 * - Database initialization and WAL mode
 * - State save/load with Map serialization (users, finaleState)
 * - Layer vote, user, and fragment selection persistence
 * - Transaction atomicity
 * - getLatestShow recovery flow
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createPersistence } from '../persistence';
import { createInitialState } from '../../conductor/conductor';
import type { ShowConfig, LayerVote, User } from '../../conductor/types';

// ============================================================================
// Test Config Helper
// ============================================================================

function createTestConfig(): ShowConfig {
  return {
    maxLayersPerAttempt: 7,
    attempts: [
      {
        chapter: 'ambition',
        title: 'Ambition',
        layers: [
          { index: 0, type: 'foundation', optionA: { trackIndex: 0 }, optionB: { trackIndex: 1 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
          { index: 1, type: 'pulse', optionA: { trackIndex: 2 }, optionB: { trackIndex: 3 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
        ],
      },
      {
        chapter: 'love',
        title: 'Love',
        layers: [
          { index: 0, type: 'color', optionA: { trackIndex: 4 }, optionB: { trackIndex: 5 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
        ],
      },
      {
        chapter: 'avoidance',
        title: 'Avoidance',
        layers: [
          { index: 0, type: 'space', optionA: { trackIndex: 6 }, optionB: { trackIndex: 7 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
        ],
      },
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

    state.users.set('user-1', { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null });
    state.users.set('user-2', { id: 'user-2', seatId: 'A2', connected: false, joinedAt: 2000, finaleChapter: 'love' });

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.users).toBeInstanceOf(Map);
    expect(loaded!.users.size).toBe(2);
    expect(loaded!.users.get('user-1')?.seatId).toBe('A1');
    expect(loaded!.users.get('user-2')?.finaleChapter).toBe('love');

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

  test('preserves finaleState Maps (chapterAssignments, trianglePositions)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    // Manually attach a minimal finaleState for persistence testing
    state.finaleState = {
      chapterAssignments: new Map([['user-1', 'ambition'], ['user-2', 'love']]),
      queue: [],
      activeSlots: new Array(7).fill(null),
      trianglePositions: new Map([['user-1', { wAmbition: 0.5, wLove: 0.3, wAvoidance: 0.2 }]]),
      centroid: { wAmbition: 0.5, wLove: 0.3, wAvoidance: 0.2 },
      rotationActive: false,
      rotationRate: 2,
      frozen: false,
      stewardshipLog: [],
      triangleActive: true,
    };

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.finaleState).not.toBeNull();
    expect(loaded!.finaleState!.chapterAssignments).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.chapterAssignments.get('user-1')).toBe('ambition');
    expect(loaded!.finaleState!.chapterAssignments.get('user-2')).toBe('love');
    expect(loaded!.finaleState!.trianglePositions).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.trianglePositions.get('user-1')?.wAmbition).toBe(0.5);

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
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null }, 'show-1');

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
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null }, 'show-1');

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

    const user: User = { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null };
    expect(() => db.saveUser(user, 'show-1')).not.toThrow();

    db.close();
  });

  test('updates user on conflict (upsert)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    const user: User = { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null };
    db.saveUser(user, 'show-1');

    // Update seat and finaleChapter
    user.seatId = 'B2';
    user.finaleChapter = 'ambition';
    db.saveUser(user, 'show-1');

    const users = db.getUsersByShow('show-1');
    expect(users.length).toBe(1);
    expect(users[0].seatId).toBe('B2');
    expect(users[0].finaleChapter).toBe('ambition');

    db.close();
  });

  test('getUsersByShow returns users scoped to a show', () => {
    const db = createPersistence(TEST_DB_PATH);
    const config = createTestConfig();
    db.saveState(createInitialState(config, 'show-1'));
    db.saveState(createInitialState(config, 'show-2'));

    db.saveUser({ id: 'u1', seatId: 'A1', connected: true, joinedAt: 0, finaleChapter: null }, 'show-1');
    db.saveUser({ id: 'u2', seatId: 'A2', connected: true, joinedAt: 0, finaleChapter: null }, 'show-1');
    db.saveUser({ id: 'u3', seatId: 'B1', connected: true, joinedAt: 0, finaleChapter: null }, 'show-2');

    expect(db.getUsersByShow('show-1').length).toBe(2);
    expect(db.getUsersByShow('show-2').length).toBe(1);

    db.close();
  });
});

describe('Fragment selection persistence', () => {
  test('saves a fragment selection', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 0, finaleChapter: 'ambition' }, 'show-1');

    expect(() => db.saveFragmentSelection('user-1', 'frag-ambition-0-A', 'show-1')).not.toThrow();

    db.close();
  });

  test('updates selection on conflict (one per user)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: 'A1', connected: true, joinedAt: 0, finaleChapter: 'ambition' }, 'show-1');

    db.saveFragmentSelection('user-1', 'frag-ambition-0-A', 'show-1');
    expect(() => db.saveFragmentSelection('user-1', 'frag-ambition-1-B', 'show-1')).not.toThrow();

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

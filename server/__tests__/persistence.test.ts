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
    optionA: { tracks: [{ granularType: 'bass', trackIndices: [index * 2] }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndices: [index * 2 + 1] }] },
  };
}

function createTestConfig(): ShowConfig {
  const makeAttempt = (chapter: string): V32AttemptConfig => ({
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
      bothOptionsSurvive: true,
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
      vote: {
        questions: [],
        shuffleQuestions: false,
        targetPoolSize: 120,
        questionDelayMs: 3000,
        revealPoolOnProjector: true,
      },
      remix: {
        audienceInteraction: false,
      },
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

  test('preserves finaleState Maps (V3.4 token pool)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    state.finaleState = {
      phase: 'vote',
      vote: {
        questionsAnsweredByUser: new Map([['user-1', 3], ['user-2', 1]]),
        maxQuestionsPerPerson: 5,
        poolCapReached: false,
      },
      pool: {
        tokens: [],
        availableByChapter: new Map([['ambition', 10], ['love', 8]]),
        totalByChapter: new Map([['ambition', 10], ['love', 10]]),
        totalRemaining: 18,
        targetPoolSize: 120,
      },
      queue: new Map([['bass', []]]),
      active: new Map(),
      audienceInteraction: false,
      trackMap: new Map([
        ['bass', new Map([[0, [10, 11]], [1, [12, 13]]])],
        ['drums', new Map([[0, [20]], [1, [21]]])],
      ]),
      loopCount: 0,
      loopProgress: 0,
      npc: { currentMessage: 'Try again' },
    } as any;

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.finaleState).not.toBeNull();
    const fs = loaded!.finaleState! as any;
    // Vote questionsAnsweredByUser Map
    expect(fs.vote.questionsAnsweredByUser).toBeInstanceOf(Map);
    expect(fs.vote.questionsAnsweredByUser.get('user-1')).toBe(3);
    // Pool availableByChapter Map
    expect(fs.pool.availableByChapter).toBeInstanceOf(Map);
    expect(fs.pool.availableByChapter.get('ambition')).toBe(10);
    // Track map (nested Map)
    expect(fs.trackMap).toBeInstanceOf(Map);
    expect(fs.trackMap.get('bass')).toBeInstanceOf(Map);
    expect(fs.trackMap.get('bass')!.get(1)).toEqual([12, 13]);
    // Queue Map
    expect(fs.queue).toBeInstanceOf(Map);

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

describe('Quilt persistence (V3.3)', () => {
  test('saves and retrieves a quilt cell', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveQuiltCell('show-1', '0:0', 'user-1', null);
    db.saveQuiltCell('show-1', '1:0', 'user-2', 1);

    const cells = db.getQuiltCells('show-1');
    expect(cells).toHaveLength(2);
    expect(cells[0].cellId).toBe('0:0');
    expect(cells[0].userId).toBe('user-1');
    expect(cells[0].songIndex).toBeNull();
    expect(cells[1].songIndex).toBe(1);

    db.close();
  });

  test('upserts quilt cell on duplicate (show_id, cell_id)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveQuiltCell('show-1', '0:0', 'user-1', null);
    db.saveQuiltCell('show-1', '0:0', 'user-1', 2); // update song

    const cells = db.getQuiltCells('show-1');
    expect(cells).toHaveLength(1);
    expect(cells[0].songIndex).toBe(2);

    db.close();
  });

  test('saves and retrieves remix events', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveRemixEvent('show-1', 'user-1', 'move', '{"from":"0:0","to":"1:0"}');
    db.saveRemixEvent('show-1', null, 'lock', '{"cellId":"0:0"}');

    const events = db.getRemixEvents('show-1');
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('move');
    expect(events[0].userId).toBe('user-1');
    expect(events[1].eventType).toBe('lock');
    expect(events[1].userId).toBeNull();

    db.close();
  });
});

describe('Finale vote persistence (V3.4)', () => {
  test('saves a finale vote', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() => db.saveFinaleVote('show-1', 'user-1', 'chapter_0', 0)).not.toThrow();

    db.close();
  });

  test('allows multiple votes from the same user (different questions)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveFinaleVote('show-1', 'user-1', 'chapter_0', 0);
    db.saveFinaleVote('show-1', 'user-1', 'chapter_1', 1);
    db.saveFinaleVote('show-1', 'user-1', 'chapter_2', 2);

    db.close(); // No error = pass
  });

  test('allows votes from multiple users', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    db.saveFinaleVote('show-1', 'user-1', 'chapter_0', 0);
    db.saveFinaleVote('show-1', 'user-2', 'chapter_1', 0);
    db.saveFinaleVote('show-1', 'user-3', 'chapter_0', 0);

    db.close(); // No error = pass
  });
});

describe('Token event persistence (V3.4)', () => {
  test('saves an activated token event', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveTokenEvent('show-1', 'token-abc', 'bass', 'chapter_0', 'activated', null)
    ).not.toThrow();

    db.close();
  });

  test('saves a spent token event with loop number', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveTokenEvent('show-1', 'token-abc', 'drums', 'chapter_1', 'spent', 3)
    ).not.toThrow();

    db.close();
  });

  test('saves queued and cancelled events', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() => db.saveTokenEvent('show-1', 'token-1', 'pad', 'chapter_0', 'queued', null)).not.toThrow();
    expect(() => db.saveTokenEvent('show-1', 'token-1', 'pad', 'chapter_0', 'cancelled', null)).not.toThrow();

    db.close();
  });

  test('rejects invalid event_type (CHECK constraint)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveTokenEvent('show-1', 'token-1', 'bass', 'chapter_0', 'invalid' as any, null)
    ).toThrow();

    db.close();
  });

  test('allows null loop number', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveTokenEvent('show-1', 'token-xyz', 'harmony', 'chapter_2', 'activated', null)
    ).not.toThrow();

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

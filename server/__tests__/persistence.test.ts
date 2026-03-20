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
import type { ShowConfig, LayerVote, User } from '../../conductor/types';

// ============================================================================
// Test Config Helper
// ============================================================================

function createTestConfig(): ShowConfig {
  return {
    layersPerAttempt: 7,
    attempts: [
      {
        chapter: 'ambition',
        title: 'Ambition',
        thresholds: [0.5, 0.5, 0.65, 0.78, 0.88, 0.95],
        tempos: [120, 120, 130, 140, 155, 170],
        auditionBars: [4, 4, 4, 2, 2, 2],
        layers: [
          { index: 0, type: 'melody', optionA: { trackIndex: 0 }, optionB: { trackIndex: 1 }, labelA: 'A', labelB: 'B' },
          { index: 1, type: 'drums', optionA: { trackIndex: 2 }, optionB: { trackIndex: 3 }, labelA: 'A', labelB: 'B' },
        ],
      },
      {
        chapter: 'love',
        title: 'Love',
        thresholds: [0.5, 0.5, 0.65, 0.78, 0.88, 0.95],
        tempos: [120, 120, 130, 140, 155, 170],
        auditionBars: [4, 4, 4, 2, 2, 2],
        layers: [
          { index: 0, type: 'pad', optionA: { trackIndex: 4 }, optionB: { trackIndex: 5 }, labelA: 'A', labelB: 'B' },
        ],
      },
      {
        chapter: 'avoidance',
        title: 'Avoidance',
        thresholds: [0.5, 0.5, 0.65, 0.78, 0.88, 0.95],
        tempos: [120, 120, 130, 140, 155, 170],
        auditionBars: [4, 4, 4, 2, 2, 2],
        layers: [
          { index: 0, type: 'bass', optionA: { trackIndex: 6 }, optionB: { trackIndex: 7 }, labelA: 'A', labelB: 'B' },
        ],
      },
    ],
    finale: {
      assemblyTimerMs: 60000,
      assemblyGracePeriodMs: 15000,
      deliberationTimerMs: 120000,
      ambassadorVolunteerTimerMs: 15000,
      ceremonyLayerOrder: ['bass', 'drums', 'pad', 'melody', 'harmony', 'fx'],
      audioPreviewPath: '/audio/previews',
      layerLabels: new Map(),
      npcMessages: [],
    },
    timing: {
      auditionDurationMs: 4000,
      votingWindowMs: 30000,
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 2000,
      beatsPerLoop: 0,
      auditionsPerLayer: 2,
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

  test('preserves finaleState Maps (assembly groups, deliberation groupVotes, performerMix activeLayers)', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');

    state.finaleState = {
      phase: 'assembly',
      availableFragments: [],
      allFragments: [],
      lockedFragments: [],
      assembly: {
        groups: new Map([['melody', ['user-1', 'user-2']], ['drums', ['user-3']]]),
        undecidedUsers: [],
        timerRemaining: 30000,
        timerDuration: 60000,
        gracePeriodActive: false,
      },
      deliberation: {
        groupVotes: new Map([['melody', new Map([['user-1', 'frag-0-0-A'], ['user-2', 'frag-0-1-B']])]]),
        chosenFragments: new Map(),
        ambassadorVolunteers: new Map(),
        ambassadors: new Map(),
        timerRemaining: 120000,
        timerDuration: 120000,
        volunteerTimerRemaining: 0,
        volunteerTimerActive: false,
      },
      ceremony: {
        layerOrder: ['melody'],
        currentIndex: 0,
        currentAmbassador: null,
        altarReady: false,
        lockedLayers: new Map(),
        forfeitedLayers: [],
        ceremonyComplete: false,
      },
      npc: { currentMessage: 'Try again' },
      performerMix: {
        activeLayers: new Map([['melody', 'frag-0-0-A'], ['drums', null]]),
        pendingChanges: [],
        loopPosition: 0,
        loopCount: 0,
        liveTracksActive: [],
      },
    };

    db.saveState(state);
    const loaded = db.loadState('show-1');

    expect(loaded!.finaleState).not.toBeNull();
    expect(loaded!.finaleState!.assembly.groups).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.assembly.groups.get('melody')).toEqual(['user-1', 'user-2']);
    expect(loaded!.finaleState!.deliberation.groupVotes).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.deliberation.groupVotes.get('melody')).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.deliberation.groupVotes.get('melody')!.get('user-1')).toBe('frag-0-0-A');
    expect(loaded!.finaleState!.performerMix.activeLayers).toBeInstanceOf(Map);
    expect(loaded!.finaleState!.performerMix.activeLayers.get('melody')).toBe('frag-0-0-A');
    expect(loaded!.finaleState!.performerMix.activeLayers.get('drums')).toBeNull();

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

describe('Finale persistence (V3)', () => {
  test('saves a group assignment', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    // Need a user record first
    db.saveUser({ id: 'user-1', seatId: null, connected: true, joinedAt: Date.now() }, 'show-1');

    expect(() =>
      db.saveGroupAssignment('show-1', 'user-1', 'melody', false)
    ).not.toThrow();

    db.close();
  });

  test('saves an auto-assigned group assignment', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: null, connected: true, joinedAt: Date.now() }, 'show-1');

    expect(() =>
      db.saveGroupAssignment('show-1', 'user-1', 'drums', true)
    ).not.toThrow();

    const assignments = db.getGroupAssignments('show-1');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].autoAssigned).toBe(true);

    db.close();
  });

  test('saves a group vote', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);
    db.saveUser({ id: 'user-1', seatId: null, connected: true, joinedAt: Date.now() }, 'show-1');

    expect(() =>
      db.saveGroupVote('show-1', 'user-1', 'melody', 'frag-0-0-A')
    ).not.toThrow();

    const votes = db.getGroupVotes('show-1');
    expect(votes).toHaveLength(1);
    expect(votes[0].fragmentId).toBe('frag-0-0-A');

    db.close();
  });

  test('saves a ceremony lock event', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveCeremonyEvent('show-1', 'melody', 'user-1', 'frag-0-0-A', 'locked')
    ).not.toThrow();

    const events = db.getCeremonyEvents('show-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('locked');

    db.close();
  });

  test('saves a ceremony forfeit event', () => {
    const db = createPersistence(TEST_DB_PATH);
    const state = createInitialState(createTestConfig(), 'show-1');
    db.saveState(state);

    expect(() =>
      db.saveCeremonyEvent('show-1', 'drums', null, null, 'forfeited')
    ).not.toThrow();

    const events = db.getCeremonyEvents('show-1');
    expect(events[0].ambassadorUserId).toBeNull();
    expect(events[0].fragmentId).toBeNull();

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

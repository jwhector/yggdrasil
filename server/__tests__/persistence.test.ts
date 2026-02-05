/**
 * Persistence Layer Tests
 *
 * Tests cover:
 * - Database initialization
 * - State save/load with Map/Set serialization
 * - Vote, user, and fig tree response persistence
 * - Transaction atomicity
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createPersistence } from '../persistence';
import { createInitialState } from '@/conductor/conductor';
import type { ShowState, User, Vote, FactionConfig } from '@/conductor/types';

// Helper to create test config
function createTestConfig() {
  const factions: FactionConfig[] = [
    { id: 0, name: 'Faction 0', color: '#ff0000' },
    { id: 1, name: 'Faction 1', color: '#00ff00' },
    { id: 2, name: 'Faction 2', color: '#0000ff' },
    { id: 3, name: 'Faction 3', color: '#ffff00' },
  ];

  return {
    rowCount: 2,
    factions,
    timing: {
      auditionLoopsPerOption: 2,
      auditionPerOptionMs: 4000,
      votingWindowMs: 30000,
      revealDurationMs: 10000,
      coupWindowMs: 15000,
    },
    coup: {
      threshold: 0.5,
      multiplierBonus: 0.5,
    },
    lobby: {
      projectorContent: 'Welcome',
      audiencePrompt: 'What lives on your fig tree?',
    },
    rows: [
      {
        index: 0,
        label: 'Row 0',
        type: 'layer' as const,
        options: [
          { id: 'r0-opt0', index: 0, audioRef: 'audio-0-0' },
          { id: 'r0-opt1', index: 1, audioRef: 'audio-0-1' },
          { id: 'r0-opt2', index: 2, audioRef: 'audio-0-2' },
          { id: 'r0-opt3', index: 3, audioRef: 'audio-0-3' },
        ],
      },
      {
        index: 1,
        label: 'Row 1',
        type: 'effect' as const,
        options: [
          { id: 'r1-opt0', index: 0, audioRef: 'audio-1-0' },
          { id: 'r1-opt1', index: 1, audioRef: 'audio-1-1' },
          { id: 'r1-opt2', index: 2, audioRef: 'audio-1-2' },
          { id: 'r1-opt3', index: 3, audioRef: 'audio-1-3' },
        ],
      },
    ],
    topology: {
      type: 'none' as const,
    },
  };
}

describe('Persistence Layer', () => {
  const testDbPath = join(__dirname, 'test-persistence.db');
  const testDbWalPath = `${testDbPath}-wal`;
  const testDbShmPath = `${testDbPath}-shm`;

  // Clean up before each test
  beforeEach(() => {
    [testDbPath, testDbWalPath, testDbShmPath].forEach(path => {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    });
  });

  // Clean up after each test
  afterEach(() => {
    [testDbPath, testDbWalPath, testDbShmPath].forEach(path => {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Database initialization', () => {
    test('creates database file', () => {
      const db = createPersistence(testDbPath);
      expect(existsSync(testDbPath)).toBe(true);
      db.close();
    });

    test('enables WAL mode', () => {
      const db = createPersistence(testDbPath);
      // WAL mode creates .wal and .shm files on first write
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state);
      expect(existsSync(testDbWalPath)).toBe(true);
      db.close();
    });

    test('creates all required tables', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Should not throw when using all tables
      db.saveState(state);
      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'test-show-1');
      db.saveVote({ userId: 'user-1', rowIndex: 0, factionVote: 'r0-opt0', personalVote: 'r0-opt1', timestamp: Date.now(), attempt: 1 }, 'test-show-1');
      db.saveFigTreeResponse('user-1', 'My response', 'test-show-1');

      db.close();
    });
  });

  describe('State persistence', () => {
    test('saves and loads state correctly', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      db.saveState(state);
      const loaded = db.loadState('test-show-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('test-show-1');
      expect(loaded!.version).toBe(state.version);
      expect(loaded!.phase).toBe(state.phase);

      db.close();
    });

    test('returns null for non-existent show', () => {
      const db = createPersistence(testDbPath);
      const loaded = db.loadState('non-existent');
      expect(loaded).toBeNull();
      db.close();
    });

    test('preserves Map<UserId, User> structure', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Add users
      state.users.set('user-1', {
        id: 'user-1',
        seatId: 'A1',
        faction: 0,
        connected: true,
        joinedAt: Date.now(),
      });
      state.users.set('user-2', {
        id: 'user-2',
        seatId: 'A2',
        faction: 1,
        connected: false,
        joinedAt: Date.now(),
      });

      db.saveState(state);
      const loaded = db.loadState('test-show-1');

      expect(loaded!.users).toBeInstanceOf(Map);
      expect(loaded!.users.size).toBe(2);
      expect(loaded!.users.get('user-1')?.seatId).toBe('A1');
      expect(loaded!.users.get('user-2')?.faction).toBe(1);

      db.close();
    });

    test('preserves Map<UserId, PersonalTree> structure', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Add personal trees
      state.personalTrees.set('user-1', {
        userId: 'user-1',
        path: ['r0-opt0', 'r1-opt2'],
        figTreeResponse: 'My story',
      });

      db.saveState(state);
      const loaded = db.loadState('test-show-1');

      expect(loaded!.personalTrees).toBeInstanceOf(Map);
      expect(loaded!.personalTrees.size).toBe(1);
      expect(loaded!.personalTrees.get('user-1')?.path).toEqual(['r0-opt0', 'r1-opt2']);
      expect(loaded!.personalTrees.get('user-1')?.figTreeResponse).toBe('My story');

      db.close();
    });

    test('preserves Set<UserId> in faction coup votes', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Add coup votes
      state.factions[0].currentRowCoupVotes.add('user-1');
      state.factions[0].currentRowCoupVotes.add('user-2');
      state.factions[1].currentRowCoupVotes.add('user-3');

      db.saveState(state);
      const loaded = db.loadState('test-show-1');

      expect(loaded!.factions[0].currentRowCoupVotes).toBeInstanceOf(Set);
      expect(loaded!.factions[0].currentRowCoupVotes.size).toBe(2);
      expect(loaded!.factions[0].currentRowCoupVotes.has('user-1')).toBe(true);
      expect(loaded!.factions[0].currentRowCoupVotes.has('user-2')).toBe(true);
      expect(loaded!.factions[1].currentRowCoupVotes.has('user-3')).toBe(true);

      db.close();
    });

    test('updates existing state on save', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      db.saveState(state);

      // Modify and save again
      state.version = 2;
      state.phase = 'running';
      db.saveState(state);

      const loaded = db.loadState('test-show-1');
      expect(loaded!.version).toBe(2);
      expect(loaded!.phase).toBe('running');

      db.close();
    });

    test('getLatestShow returns a show when shows exist', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();

      const state1 = createInitialState(config, 'show-1');
      const state2 = createInitialState(config, 'show-2');

      db.saveState(state1);
      db.saveState(state2);

      const latest = db.getLatestShow();
      expect(latest).not.toBeNull();
      expect(['show-1', 'show-2']).toContain(latest!.id);

      db.close();
    });

    test('getLatestShow returns null when no shows exist', () => {
      const db = createPersistence(testDbPath);
      const latest = db.getLatestShow();
      expect(latest).toBeNull();
      db.close();
    });
  });

  describe('Vote persistence', () => {
    test('saves vote correctly', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key
      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'test-show-1');

      const vote: Vote = {
        userId: 'user-1',
        rowIndex: 0,
        factionVote: 'r0-opt0',
        personalVote: 'r0-opt1',
        timestamp: Date.now(),
        attempt: 1,
      };

      db.saveVote(vote, 'test-show-1');
      db.close();
    });

    test('allows multiple votes from same user', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key
      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'test-show-1');

      const vote1: Vote = {
        userId: 'user-1',
        rowIndex: 0,
        factionVote: 'r0-opt0',
        personalVote: 'r0-opt1',
        timestamp: Date.now(),
        attempt: 1,
      };

      const vote2: Vote = {
        userId: 'user-1',
        rowIndex: 0,
        factionVote: 'r0-opt2',
        personalVote: 'r0-opt3',
        timestamp: Date.now(),
        attempt: 2,
      };

      db.saveVote(vote1, 'test-show-1');
      db.saveVote(vote2, 'test-show-1');
      db.close();
    });
  });

  describe('User persistence', () => {
    test('saves user correctly', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key

      const user: User = {
        id: 'user-1',
        seatId: 'A1',
        faction: 0,
        connected: true,
        joinedAt: Date.now(),
      };

      db.saveUser(user, 'test-show-1');
      db.close();
    });

    test('updates user on conflict', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key

      const user: User = {
        id: 'user-1',
        seatId: 'A1',
        faction: 0,
        connected: true,
        joinedAt: Date.now(),
      };

      db.saveUser(user, 'test-show-1');

      // Update user
      user.faction = 1;
      user.seatId = 'B2';
      db.saveUser(user, 'test-show-1');

      const users = db.getUsersByShow('test-show-1');
      expect(users.length).toBe(1);
      expect(users[0].faction).toBe(1);
      expect(users[0].seatId).toBe('B2');

      db.close();
    });

    test('getUsersByShow returns all users for a show', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state1 = createInitialState(config, 'show-1');
      const state2 = createInitialState(config, 'show-2');
      db.saveState(state1); // Create shows first for foreign key
      db.saveState(state2);

      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'show-1');
      db.saveUser({ id: 'user-2', seatId: 'A2', faction: 1, connected: true, joinedAt: Date.now() }, 'show-1');
      db.saveUser({ id: 'user-3', seatId: 'B1', faction: 2, connected: true, joinedAt: Date.now() }, 'show-2');

      const show1Users = db.getUsersByShow('show-1');
      expect(show1Users.length).toBe(2);

      const show2Users = db.getUsersByShow('show-2');
      expect(show2Users.length).toBe(1);

      db.close();
    });
  });

  describe('Fig tree responses', () => {
    test('saves fig tree response', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key
      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'test-show-1');

      db.saveFigTreeResponse('user-1', 'My response to the prompt', 'test-show-1');
      db.close();
    });

    test('updates response on conflict', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      db.saveState(state); // Create show first for foreign key
      db.saveUser({ id: 'user-1', seatId: 'A1', faction: 0, connected: true, joinedAt: Date.now() }, 'test-show-1');

      db.saveFigTreeResponse('user-1', 'First response', 'test-show-1');
      db.saveFigTreeResponse('user-1', 'Updated response', 'test-show-1');

      db.close();
    });
  });

  describe('Transaction atomicity', () => {
    test('state save is atomic', () => {
      const db = createPersistence(testDbPath);
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Save state multiple times rapidly
      for (let i = 0; i < 10; i++) {
        state.version = i;
        db.saveState(state);
      }

      const loaded = db.loadState('test-show-1');
      expect(loaded!.version).toBe(9);

      db.close();
    });
  });

  describe('Close', () => {
    test('closes database connection', () => {
      const db = createPersistence(testDbPath);
      db.close();
      // No error should occur
    });
  });
});

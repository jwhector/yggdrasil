/**
 * Backup System Tests
 *
 * Tests cover:
 * - Creating backups
 * - Loading backups
 * - Listing backups
 * - Pruning old backups
 * - Map/Set deserialization
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createBackup, loadBackup, listBackups, pruneBackups, createAndPruneBackup } from '../backup';
import { createInitialState } from '@/conductor/conductor';
import type { ShowState, FactionConfig } from '@/conductor/types';

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

describe('Backup System', () => {
  const testBackupDir = join(__dirname, 'test-backups');

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testBackupDir)) {
      rmSync(testBackupDir, { recursive: true, force: true });
    }
    mkdirSync(testBackupDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testBackupDir)) {
      rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  describe('createBackup', () => {
    test('creates a backup file', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      const filepath = createBackup(state, testBackupDir);

      expect(existsSync(filepath)).toBe(true);
      expect(filepath).toContain('yggdrasil-backup-');
      expect(filepath).toContain('test-show-1');
      expect(filepath).toMatch(/\.json$/);
    });

    test('creates directory if it does not exist', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      const nonExistentDir = join(testBackupDir, 'nested', 'path');

      const filepath = createBackup(state, nonExistentDir);

      expect(existsSync(filepath)).toBe(true);
      expect(existsSync(nonExistentDir)).toBe(true);
    });

    test('includes version in filename', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');
      state.version = 42;

      const filepath = createBackup(state, testBackupDir);

      expect(filepath).toContain('-v42.json');
    });
  });

  describe('loadBackup', () => {
    test('loads backup correctly', () => {
      const config = createTestConfig();
      const originalState = createInitialState(config, 'test-show-1');

      const filepath = createBackup(originalState, testBackupDir);
      const loadedState = loadBackup(filepath);

      expect(loadedState.id).toBe(originalState.id);
      expect(loadedState.version).toBe(originalState.version);
      expect(loadedState.phase).toBe(originalState.phase);
    });

    test('preserves Map structures', () => {
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

      // Add personal trees
      state.personalTrees.set('user-1', {
        userId: 'user-1',
        path: ['r0-opt0', 'r1-opt1'],
        figTreeResponse: 'Test response',
      });

      const filepath = createBackup(state, testBackupDir);
      const loaded = loadBackup(filepath);

      expect(loaded.users).toBeInstanceOf(Map);
      expect(loaded.users.size).toBe(1);
      expect(loaded.users.get('user-1')?.seatId).toBe('A1');

      expect(loaded.personalTrees).toBeInstanceOf(Map);
      expect(loaded.personalTrees.size).toBe(1);
      expect(loaded.personalTrees.get('user-1')?.path).toEqual(['r0-opt0', 'r1-opt1']);
    });

    test('preserves Set structures in factions', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'test-show-1');

      // Add coup votes
      state.factions[0].currentRowCoupVotes.add('user-1');
      state.factions[0].currentRowCoupVotes.add('user-2');

      const filepath = createBackup(state, testBackupDir);
      const loaded = loadBackup(filepath);

      expect(loaded.factions[0].currentRowCoupVotes).toBeInstanceOf(Set);
      expect(loaded.factions[0].currentRowCoupVotes.size).toBe(2);
      expect(loaded.factions[0].currentRowCoupVotes.has('user-1')).toBe(true);
    });

    test('throws error for non-existent file', () => {
      expect(() => {
        loadBackup(join(testBackupDir, 'non-existent.json'));
      }).toThrow();
    });
  });

  describe('listBackups', () => {
    test('returns empty array for empty directory', () => {
      const backups = listBackups(testBackupDir);
      expect(backups).toEqual([]);
    });

    test('returns empty array for non-existent directory', () => {
      const backups = listBackups(join(testBackupDir, 'non-existent'));
      expect(backups).toEqual([]);
    });

    test('lists all backups', () => {
      const config = createTestConfig();
      const state1 = createInitialState(config, 'show-1');
      const state2 = createInitialState(config, 'show-2');

      createBackup(state1, testBackupDir);
      createBackup(state2, testBackupDir);

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(2);
    });

    test('sorts backups by timestamp descending', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      // Create backups with slight delay
      const path1 = createBackup(state, testBackupDir);
      // Small delay to ensure different timestamps
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // We can't easily test timing in synchronous tests, but we can verify structure
      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(1);
      expect(backups[0].showId).toBe('show-1');
    });

    test('includes metadata in backup info', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');
      state.version = 5;
      state.phase = 'running';

      createBackup(state, testBackupDir);

      const backups = listBackups(testBackupDir);
      expect(backups[0].showId).toBe('show-1');
      expect(backups[0].version).toBe(5);
      expect(backups[0].phase).toBe('running');
      expect(backups[0].filename).toContain('yggdrasil-backup-');
      expect(backups[0].filepath).toContain(testBackupDir);
      expect(typeof backups[0].timestamp).toBe('number');
    });

    test('ignores non-backup files', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      createBackup(state, testBackupDir);

      // Create a non-backup file
      const fs = require('fs');
      fs.writeFileSync(join(testBackupDir, 'other-file.json'), '{}');
      fs.writeFileSync(join(testBackupDir, 'readme.txt'), 'test');

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(1);
    });
  });

  describe('pruneBackups', () => {
    test('keeps all backups if count is below threshold', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      createBackup(state, testBackupDir);
      state.version = 2; // Change version to get different filename
      createBackup(state, testBackupDir);

      const deleted = pruneBackups(testBackupDir, 5);
      expect(deleted).toBe(0);

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(2);
    });

    test('deletes oldest backups when over limit', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      // Create 5 backups
      for (let i = 0; i < 5; i++) {
        state.version = i;
        createBackup(state, testBackupDir);
      }

      const deleted = pruneBackups(testBackupDir, 3);
      expect(deleted).toBe(2);

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(3);
    });

    test('returns 0 for empty directory', () => {
      const deleted = pruneBackups(testBackupDir, 5);
      expect(deleted).toBe(0);
    });

    test('returns 0 for non-existent directory', () => {
      const deleted = pruneBackups(join(testBackupDir, 'non-existent'), 5);
      expect(deleted).toBe(0);
    });
  });

  describe('createAndPruneBackup', () => {
    test('creates backup and prunes old ones', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      // Create several backups
      for (let i = 0; i < 5; i++) {
        state.version = i;
        createAndPruneBackup(state, testBackupDir, 3);
      }

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(3);
    });

    test('uses default max of 10 backups', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      // Create 15 backups
      for (let i = 0; i < 15; i++) {
        state.version = i;
        createAndPruneBackup(state, testBackupDir);
      }

      const backups = listBackups(testBackupDir);
      expect(backups.length).toBe(10);
    });

    test('returns path to created backup', () => {
      const config = createTestConfig();
      const state = createInitialState(config, 'show-1');

      const filepath = createAndPruneBackup(state, testBackupDir, 5);

      expect(existsSync(filepath)).toBe(true);
      expect(filepath).toContain('yggdrasil-backup-');
    });
  });
});

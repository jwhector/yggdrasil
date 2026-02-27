/**
 * Backup System Tests (NEW SYSTEM)
 *
 * Tests cover:
 * - Creating backups
 * - Loading backups with Map deserialization
 * - Listing backups
 * - Pruning old backups
 * - createAndPruneBackup convenience function
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createBackup, loadBackup, listBackups, pruneBackups, createAndPruneBackup } from '../backup';
import { createInitialState } from '../../conductor/conductor';
import type { ShowConfig } from '../../conductor/types';

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
        ],
      },
      {
        chapter: 'love',
        title: 'Love',
        layers: [
          { index: 0, type: 'pulse', optionA: { trackIndex: 2 }, optionB: { trackIndex: 3 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
        ],
      },
      {
        chapter: 'avoidance',
        title: 'Avoidance',
        layers: [
          { index: 0, type: 'color', optionA: { trackIndex: 4 }, optionB: { trackIndex: 5 }, labelA: 'A', labelB: 'B', doubtThreshold: null },
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
    seatIds: ['seat-1'],
  };
}

// ============================================================================
// Test Setup
// ============================================================================

const TEST_BACKUP_DIR = join(__dirname, 'test-backups');

beforeEach(() => {
  if (existsSync(TEST_BACKUP_DIR)) rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(TEST_BACKUP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_BACKUP_DIR)) rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe('createBackup', () => {
  test('creates a backup file', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    const filepath = createBackup(state, TEST_BACKUP_DIR);

    expect(existsSync(filepath)).toBe(true);
    expect(filepath).toContain('yggdrasil-backup-');
    expect(filepath).toContain('show-1');
    expect(filepath).toMatch(/\.json$/);
  });

  test('creates directory if it does not exist', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    const nested = join(TEST_BACKUP_DIR, 'nested', 'path');

    const filepath = createBackup(state, nested);

    expect(existsSync(filepath)).toBe(true);
    expect(existsSync(nested)).toBe(true);
  });

  test('includes version in filename', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.version = 42;

    const filepath = createBackup(state, TEST_BACKUP_DIR);

    expect(filepath).toContain('-v42.json');
  });
});

describe('loadBackup', () => {
  test('loads backup and restores state correctly', () => {
    const original = createInitialState(createTestConfig(), 'show-1');
    const filepath = createBackup(original, TEST_BACKUP_DIR);

    const loaded = loadBackup(filepath);

    expect(loaded.id).toBe(original.id);
    expect(loaded.version).toBe(original.version);
    expect(loaded.phase).toBe(original.phase);
  });

  test('preserves Map<UserId, User>', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.users.set('user-1', { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000, finaleChapter: null });
    state.users.set('user-2', { id: 'user-2', seatId: 'A2', connected: false, joinedAt: 2000, finaleChapter: 'love' });

    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    expect(loaded.users).toBeInstanceOf(Map);
    expect(loaded.users.size).toBe(2);
    expect(loaded.users.get('user-1')?.seatId).toBe('A1');
    expect(loaded.users.get('user-2')?.finaleChapter).toBe('love');
  });

  test('preserves null finaleState', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    expect(loaded.finaleState).toBeNull();
  });

  test('preserves finaleState Maps', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.finaleState = {
      chapterAssignments: new Map([['u1', 'ambition'], ['u2', 'love']]),
      queue: [],
      activeSlots: new Array(7).fill(null),
      trianglePositions: new Map([['u1', { wAmbition: 0.6, wLove: 0.2, wAvoidance: 0.2 }]]),
      centroid: { wAmbition: 0.6, wLove: 0.2, wAvoidance: 0.2 },
      rotationActive: false,
      rotationRate: 2,
      frozen: false,
      stewardshipLog: [],
      triangleActive: true,
    };

    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    expect(loaded.finaleState!.chapterAssignments).toBeInstanceOf(Map);
    expect(loaded.finaleState!.chapterAssignments.get('u1')).toBe('ambition');
    expect(loaded.finaleState!.trianglePositions).toBeInstanceOf(Map);
    expect(loaded.finaleState!.trianglePositions.get('u1')?.wAmbition).toBe(0.6);
  });

  test('throws for non-existent file', () => {
    expect(() => loadBackup(join(TEST_BACKUP_DIR, 'non-existent.json'))).toThrow();
  });
});

describe('listBackups', () => {
  test('returns empty array for empty directory', () => {
    expect(listBackups(TEST_BACKUP_DIR)).toEqual([]);
  });

  test('returns empty array for non-existent directory', () => {
    expect(listBackups(join(TEST_BACKUP_DIR, 'no-such-dir'))).toEqual([]);
  });

  test('lists all backup files', () => {
    const config = createTestConfig();
    createBackup(createInitialState(config, 'show-1'), TEST_BACKUP_DIR);
    createBackup(createInitialState(config, 'show-2'), TEST_BACKUP_DIR);

    expect(listBackups(TEST_BACKUP_DIR).length).toBe(2);
  });

  test('includes metadata in each entry', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.version = 5;
    state.phase = 'attempt_build';

    createBackup(state, TEST_BACKUP_DIR);

    const backups = listBackups(TEST_BACKUP_DIR);
    expect(backups[0].showId).toBe('show-1');
    expect(backups[0].version).toBe(5);
    expect(backups[0].phase).toBe('attempt_build');
    expect(backups[0].filename).toContain('yggdrasil-backup-');
    expect(typeof backups[0].timestamp).toBe('number');
  });

  test('ignores non-backup files', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    createBackup(state, TEST_BACKUP_DIR);

    const fs = require('fs');
    fs.writeFileSync(join(TEST_BACKUP_DIR, 'other-file.json'), '{}');
    fs.writeFileSync(join(TEST_BACKUP_DIR, 'readme.txt'), 'notes');

    expect(listBackups(TEST_BACKUP_DIR).length).toBe(1);
  });
});

describe('pruneBackups', () => {
  test('keeps all backups when count is at or below limit', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    createBackup(state, TEST_BACKUP_DIR);
    state.version = 2;
    createBackup(state, TEST_BACKUP_DIR);

    expect(pruneBackups(TEST_BACKUP_DIR, 5)).toBe(0);
    expect(listBackups(TEST_BACKUP_DIR).length).toBe(2);
  });

  test('deletes oldest backups when over limit', () => {
    const state = createInitialState(createTestConfig(), 'show-1');

    for (let i = 0; i < 5; i++) {
      state.version = i;
      createBackup(state, TEST_BACKUP_DIR);
    }

    expect(pruneBackups(TEST_BACKUP_DIR, 3)).toBe(2);
    expect(listBackups(TEST_BACKUP_DIR).length).toBe(3);
  });

  test('returns 0 for empty directory', () => {
    expect(pruneBackups(TEST_BACKUP_DIR, 5)).toBe(0);
  });

  test('returns 0 for non-existent directory', () => {
    expect(pruneBackups(join(TEST_BACKUP_DIR, 'no-such-dir'), 5)).toBe(0);
  });
});

describe('createAndPruneBackup', () => {
  test('enforces max backup count', () => {
    const state = createInitialState(createTestConfig(), 'show-1');

    for (let i = 0; i < 5; i++) {
      state.version = i;
      createAndPruneBackup(state, TEST_BACKUP_DIR, 3);
    }

    expect(listBackups(TEST_BACKUP_DIR).length).toBe(3);
  });

  test('defaults to 10 backups', () => {
    const state = createInitialState(createTestConfig(), 'show-1');

    for (let i = 0; i < 15; i++) {
      state.version = i;
      createAndPruneBackup(state, TEST_BACKUP_DIR);
    }

    expect(listBackups(TEST_BACKUP_DIR).length).toBe(10);
  });

  test('returns path to the created file', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    const filepath = createAndPruneBackup(state, TEST_BACKUP_DIR, 5);

    expect(existsSync(filepath)).toBe(true);
  });
});

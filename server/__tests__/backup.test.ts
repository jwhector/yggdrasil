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
  const makeLayer = (i: number) => ({
    index: i,
    group: ['bones', 'flesh', 'spark'][i % 3],
    labelA: 'A',
    labelB: 'B',
    optionA: { tracks: [{ granularType: 'bass', trackIndices: [i * 2] }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndices: [i * 2 + 1] }] },
  });
  const makeAttempt = (chapter: string) => ({
    chapter,
    title: chapter,
    liveSeed: { trackIndices: [99] },
    layers: [0, 1, 2].map(i => makeLayer(i)),
    thresholds: [0.5, 0.66, 0.99],
    tempos: [120, 120, 120],
    auditionBars: [4, 4, 2],
    auditionCycles: [1, 1, 1],
  });
  return {
    layersPerAttempt: 3,
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
    state.users.set('user-1', { id: 'user-1', seatId: 'A1', connected: true, joinedAt: 1000 });
    state.users.set('user-2', { id: 'user-2', seatId: 'A2', connected: false, joinedAt: 2000 });

    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    expect(loaded.users).toBeInstanceOf(Map);
    expect(loaded.users.size).toBe(2);
    expect(loaded.users.get('user-1')?.seatId).toBe('A1');
    expect(loaded.users.get('user-2')?.seatId).toBe('A2');
  });

  test('preserves null finaleState', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    expect(loaded.finaleState).toBeNull();
  });

  test('preserves finaleState Maps (V3.4 token pool)', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.finaleState = {
      phase: 'vote',
      vote: {
        questionsAnsweredByUser: new Map([['u1', 3]]),
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
      trackMap: new Map([['bass', new Map([[0, [10, 11]], [1, [12, 13]]])]]),
      loopCount: 0,
      loopProgress: 0,
      npc: { currentMessage: null },
    } as any;

    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    const fs = loaded.finaleState! as any;
    expect(fs.vote.questionsAnsweredByUser).toBeInstanceOf(Map);
    expect(fs.vote.questionsAnsweredByUser.get('u1')).toBe(3);
    expect(fs.pool.availableByChapter).toBeInstanceOf(Map);
    expect(fs.pool.availableByChapter.get('ambition')).toBe(10);
    expect(fs.trackMap).toBeInstanceOf(Map);
    expect(fs.trackMap.get('bass')!.get(1)).toEqual([12, 13]);
    expect(fs.queue).toBeInstanceOf(Map);
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

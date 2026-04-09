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
  const makeAttempt = (chapter: 'ambition' | 'love' | 'avoidance') => ({
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
      assignmentMode: 'auto',
      bothOptionsSurvive: true,
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
      quilt: {
        maxColumns: 4,
        loopBars: 8,
        overflowMode: 'spectator' as const,
        previewTimerMs: 20000,
        assignmentTimerMs: 30000,
        audienceRemix: {
          enabled: true,
          scope: 'own_cell' as const,
          allowCrossRowSwaps: true,
          cooldownLoops: 1,
          allowSongChange: false,
        },
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

  test('preserves finaleState Maps/Sets (V3.3 quilt cells, trackMap, preview, remix)', () => {
    const state = createInitialState(createTestConfig(), 'show-1');
    state.finaleState = {
      phase: 'assignment',
      availableFragments: [],
      allFragments: [],
      quilt: {
        rows: 6,
        columns: 2,
        barsPerCell: 4,
        cells: new Map([
          ['0:0', { id: '0:0', rowIndex: 0, columnIndex: 0, granularType: 'bass', songIndex: 1, chapter: 'love' as const, ownerId: 'u1' }],
        ]),
        columnOrder: [0, 1],
        playheadColumn: 0,
        loopCount: 0,
      },
      availableSongs: [0, 1, 2],
      trackMap: new Map([['bass', new Map([[0, 10], [1, 11]])]]),
      assignment: { mode: 'auto', timerRemaining: null },
      preview: { lockedInUsers: new Set(['u1']), timerRemaining: null },
      remix: {
        lockedCells: new Set(['0:0']),
        mutedCells: new Set(),
        lastMoveByUser: new Map([['u1', 2]]),
        liveTracksActive: [],
        frozenColumn: null,
        frozenActiveTracks: new Map(),
      },
      npc: { currentMessage: null },
      elegyOptedIn: new Set(['u1']),
      arc: null,
    };

    const loaded = loadBackup(createBackup(state, TEST_BACKUP_DIR));

    const fs = loaded.finaleState!;
    expect(fs.quilt.cells).toBeInstanceOf(Map);
    expect(fs.quilt.cells.get('0:0')?.songIndex).toBe(1);
    expect(fs.trackMap).toBeInstanceOf(Map);
    expect(fs.trackMap.get('bass')!.get(1)).toBe(11);
    expect(fs.preview.lockedInUsers).toBeInstanceOf(Set);
    expect(fs.preview.lockedInUsers.has('u1')).toBe(true);
    expect(fs.remix.lockedCells).toBeInstanceOf(Set);
    expect(fs.remix.lockedCells.has('0:0')).toBe(true);
    expect(fs.remix.lastMoveByUser).toBeInstanceOf(Map);
    expect(fs.remix.lastMoveByUser.get('u1')).toBe(2);
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

/**
 * Assignment Tests (V3.3 — Cell Claiming)
 *
 * Tests for auto-assign and self-select cell claiming in the quilt grid.
 */

import { describe, test, expect } from '@jest/globals';
import { autoAssignCells, getConnectedUserIds, getUnclaimedUsers } from '../assignment';
import { createQuiltGrid } from '../quilt';
import type { UserId, User, GranularType, QuiltConfig } from '../types';

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

function makeConfig(): QuiltConfig {
  return {
    maxColumns: 4,
    loopBars: 8,
    columnTiming: 'divided',
    overflowMode: 'spectator',
    previewTimerMs: 20000,
    assignmentTimerMs: 30000,
    audienceRemix: {
      enabled: true,
      scope: 'own_cell',
      allowCrossRowSwaps: true,
      cooldownLoops: 1,
      allowSongChange: false,
    },
  };
}

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

// ============================================================================
// getConnectedUserIds
// ============================================================================

describe('getConnectedUserIds', () => {
  test('returns only connected users', () => {
    const users = new Map<UserId, User>();
    users.set('u1', { id: 'u1', seatId: null, connected: true, joinedAt: 0 });
    users.set('u2', { id: 'u2', seatId: null, connected: false, joinedAt: 0 });
    users.set('u3', { id: 'u3', seatId: null, connected: true, joinedAt: 0 });
    const ids = getConnectedUserIds(users);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('u1');
    expect(ids).toContain('u3');
  });
});

// ============================================================================
// autoAssignCells
// ============================================================================

describe('autoAssignCells', () => {
  test('assigns all connected users to cells', () => {
    const users = makeUsers(12);
    const grid = createQuiltGrid(12, makeConfig(), TEST_GRANULAR_TYPES);
    const assignments = autoAssignCells(grid, users);
    expect(assignments).toHaveLength(12);

    const assignedUsers = new Set(assignments.map(a => a.userId));
    expect(assignedUsers.size).toBe(12);
  });

  test('caps at available cells when more users than cells', () => {
    const users = makeUsers(20);
    const grid = createQuiltGrid(12, makeConfig(), TEST_GRANULAR_TYPES); // 6×2 = 12 cells
    const assignments = autoAssignCells(grid, users);
    expect(assignments).toHaveLength(12);
  });

  test('excludes disconnected users', () => {
    const users = new Map<UserId, User>();
    users.set('u1', { id: 'u1', seatId: null, connected: true, joinedAt: 0 });
    users.set('u2', { id: 'u2', seatId: null, connected: false, joinedAt: 0 });
    const grid = createQuiltGrid(6, makeConfig(), TEST_GRANULAR_TYPES);
    const assignments = autoAssignCells(grid, users);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].userId).toBe('u1');
  });

  test('each user appears in exactly one cell', () => {
    const users = makeUsers(20);
    const grid = createQuiltGrid(20, makeConfig(), TEST_GRANULAR_TYPES);
    const assignments = autoAssignCells(grid, users);

    const assignedUsers = new Set<string>();
    for (const a of assignments) {
      expect(assignedUsers.has(a.userId)).toBe(false);
      assignedUsers.add(a.userId);
    }
  });

  test('handles 0 users', () => {
    const users = makeUsers(0);
    const grid = createQuiltGrid(6, makeConfig(), TEST_GRANULAR_TYPES);
    const assignments = autoAssignCells(grid, users);
    expect(assignments).toHaveLength(0);
  });
});

// ============================================================================
// getUnclaimedUsers
// ============================================================================

describe('getUnclaimedUsers', () => {
  test('returns users without cells', () => {
    const users = makeUsers(3);
    const grid = createQuiltGrid(12, makeConfig(), TEST_GRANULAR_TYPES);
    grid.cells.get('0:0')!.ownerId = 'user-0';

    const unclaimed = getUnclaimedUsers(users, grid);
    expect(unclaimed).toHaveLength(2);
    expect(unclaimed).toContain('user-1');
    expect(unclaimed).toContain('user-2');
  });

  test('returns empty when all claimed', () => {
    const users = makeUsers(2);
    const grid = createQuiltGrid(12, makeConfig(), TEST_GRANULAR_TYPES);
    grid.cells.get('0:0')!.ownerId = 'user-0';
    grid.cells.get('0:1')!.ownerId = 'user-1';

    const unclaimed = getUnclaimedUsers(users, grid);
    expect(unclaimed).toHaveLength(0);
  });
});

/**
 * Quilt Tests (V3.3)
 *
 * Tests for pure quilt functions: grid creation, cell claiming,
 * song choice, audience remix, performer operations, track resolution,
 * and playhead advancement.
 */

import { describe, test, expect } from '@jest/globals';
import {
  createQuiltGrid,
  deriveColumnCount,
  claimCell,
  releaseCell,
  setCellSong,
  lockInChoice,
  assignDefaultSongs,
  assignRemainingUsers,
  moveCell,
  changeCellSong,
  reorderColumn,
  swapCells,
  lockCell,
  unlockCell,
  muteCell,
  unmuteCell,
  overrideCellSong,
  resolveTrack,
  advancePlayhead,
  findUserCell,
} from '../quilt';
import type { QuiltGrid } from '../quilt';
import type { QuiltConfig, AudienceRemixConfig, GranularType } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

const GRANULAR_TYPES: GranularType[] = [
  { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
  { id: 'drums', label: 'Drums', color: '#000', symbol: '▲' },
  { id: 'pad', label: 'Pad', color: '#000', symbol: '◆' },
  { id: 'melody', label: 'Melody', color: '#000', symbol: '◎' },
  { id: 'harmony', label: 'Harmony', color: '#000', symbol: '●' },
  { id: 'fx', label: 'FX', color: '#000', symbol: '~' },
];

function makeConfig(overrides?: Partial<QuiltConfig>): QuiltConfig {
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
    ...overrides,
  };
}

function makeRemixConfig(overrides?: Partial<AudienceRemixConfig>): AudienceRemixConfig {
  return {
    enabled: true,
    scope: 'own_cell',
    allowCrossRowSwaps: true,
    cooldownLoops: 1,
    allowSongChange: false,
    ...overrides,
  };
}

function makeGrid(columns: number = 2): QuiltGrid {
  return createQuiltGrid(columns * 6, makeConfig({ maxColumns: columns }), GRANULAR_TYPES);
}

// ============================================================================
// Grid Creation & Scaling
// ============================================================================

describe('createQuiltGrid', () => {
  test('creates a 6×2 grid for 12 audience members', () => {
    const grid = createQuiltGrid(12, makeConfig(), GRANULAR_TYPES);
    expect(grid.rows).toBe(6);
    expect(grid.columns).toBe(2);
    expect(grid.cells.size).toBe(12);
    expect(grid.barsPerCell).toBe(4); // 8 / 2
    expect(grid.columnOrder).toEqual([0, 1]);
    expect(grid.playheadColumn).toBe(0);
    expect(grid.loopCount).toBe(0);
  });

  test('creates a 6×1 grid for 6 or fewer audience members', () => {
    const grid = createQuiltGrid(4, makeConfig(), GRANULAR_TYPES);
    expect(grid.columns).toBe(1);
    expect(grid.cells.size).toBe(6);
    expect(grid.barsPerCell).toBe(8);
  });

  test('caps at maxColumns', () => {
    const grid = createQuiltGrid(100, makeConfig({ maxColumns: 4 }), GRANULAR_TYPES);
    expect(grid.columns).toBe(4);
    expect(grid.cells.size).toBe(24);
  });

  test('each cell has correct granularType from row', () => {
    const grid = createQuiltGrid(12, makeConfig(), GRANULAR_TYPES);
    expect(grid.cells.get('0:0')!.granularType).toBe('bass');
    expect(grid.cells.get('1:0')!.granularType).toBe('drums');
    expect(grid.cells.get('5:1')!.granularType).toBe('fx');
  });

  test('all cells start unclaimed with no song', () => {
    const grid = createQuiltGrid(12, makeConfig(), GRANULAR_TYPES);
    for (const cell of grid.cells.values()) {
      expect(cell.ownerId).toBeNull();
      expect(cell.songIndex).toBeNull();
      expect(cell.chapter).toBeNull();
    }
  });
});

describe('deriveColumnCount', () => {
  test('returns 1 for audience size <= 6', () => {
    expect(deriveColumnCount(6, makeConfig())).toBe(1);
    expect(deriveColumnCount(3, makeConfig())).toBe(1);
  });

  test('scales up with audience size', () => {
    expect(deriveColumnCount(12, makeConfig())).toBe(2);
    expect(deriveColumnCount(24, makeConfig())).toBe(4);
  });

  test('respects maxColumns cap', () => {
    expect(deriveColumnCount(100, makeConfig({ maxColumns: 3 }))).toBe(3);
  });

  test('respects loopBars minimum (1 bar per cell)', () => {
    expect(deriveColumnCount(100, makeConfig({ maxColumns: 16, loopBars: 4 }))).toBe(4);
  });
});

// ============================================================================
// Cell Claiming
// ============================================================================

describe('claimCell', () => {
  test('claims an empty cell', () => {
    const grid = makeGrid();
    const result = claimCell(grid, 'user-1', '0:0');
    expect(result.ok).toBe(true);
    expect(grid.cells.get('0:0')!.ownerId).toBe('user-1');
  });

  test('rejects claiming an occupied cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = claimCell(grid, 'user-2', '0:0');
    expect(result.ok).toBe(false);
  });

  test('rejects claiming when user already owns a cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = claimCell(grid, 'user-1', '1:0');
    expect(result.ok).toBe(false);
  });

  test('rejects claiming a nonexistent cell', () => {
    const grid = makeGrid();
    const result = claimCell(grid, 'user-1', '99:99');
    expect(result.ok).toBe(false);
  });
});

describe('releaseCell', () => {
  test('releases a claimed cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = releaseCell(grid, 'user-1');
    expect(result.ok).toBe(true);
    expect(grid.cells.get('0:0')!.ownerId).toBeNull();
  });

  test('clears song choice on release', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    releaseCell(grid, 'user-1');
    expect(grid.cells.get('0:0')!.songIndex).toBeNull();
  });

  test('fails when user has no cell', () => {
    const grid = makeGrid();
    const result = releaseCell(grid, 'user-1');
    expect(result.ok).toBe(false);
  });
});

describe('assignRemainingUsers', () => {
  test('assigns unclaimed users to empty cells', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = assignRemainingUsers(grid, ['user-2', 'user-3']);
    expect(result.assignments).toHaveLength(2);
    // Check that the assigned cells now have owners
    for (const assignment of result.assignments) {
      const cell = grid.cells.get(assignment.cellId)!;
      expect(cell.ownerId).toBe(assignment.userId);
    }
  });

  test('does not exceed available empty cells', () => {
    const grid = createQuiltGrid(6, makeConfig({ maxColumns: 1 }), GRANULAR_TYPES);
    // 6 cells total, claim 5
    for (let i = 0; i < 5; i++) {
      claimCell(grid, `user-${i}`, `${i}:0`);
    }
    const result = assignRemainingUsers(grid, ['extra-1', 'extra-2', 'extra-3']);
    expect(result.assignments).toHaveLength(1); // Only 1 empty cell
  });
});

// ============================================================================
// Song Choice (Preview Phase)
// ============================================================================

describe('setCellSong', () => {
  test('sets song choice for owned cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = setCellSong(grid, 'user-1', 1, [0, 1, 2]);
    expect(result.ok).toBe(true);
    expect(grid.cells.get('0:0')!.songIndex).toBe(1);
    expect(grid.cells.get('0:0')!.chapter).toBe('love');
  });

  test('rejects invalid song index', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    const result = setCellSong(grid, 'user-1', 5, [0, 1, 2]);
    expect(result.ok).toBe(false);
  });

  test('rejects when user has no cell', () => {
    const grid = makeGrid();
    const result = setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    expect(result.ok).toBe(false);
  });

  test('maps song indices to chapters correctly', () => {
    const grid = makeGrid();
    claimCell(grid, 'u1', '0:0');
    claimCell(grid, 'u2', '1:0');
    claimCell(grid, 'u3', '2:0');

    setCellSong(grid, 'u1', 0, [0, 1, 2]);
    setCellSong(grid, 'u2', 1, [0, 1, 2]);
    setCellSong(grid, 'u3', 2, [0, 1, 2]);

    expect(grid.cells.get('0:0')!.chapter).toBe('ambition');
    expect(grid.cells.get('1:0')!.chapter).toBe('love');
    expect(grid.cells.get('2:0')!.chapter).toBe('avoidance');
  });
});

describe('lockInChoice', () => {
  test('locks in a user with a song choice', () => {
    const grid = makeGrid();
    const lockedIn = new Set<string>();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    const result = lockInChoice(grid, 'user-1', lockedIn);
    expect(result.ok).toBe(true);
    expect(lockedIn.has('user-1')).toBe(true);
  });

  test('rejects lock-in without song choice', () => {
    const grid = makeGrid();
    const lockedIn = new Set<string>();
    claimCell(grid, 'user-1', '0:0');
    const result = lockInChoice(grid, 'user-1', lockedIn);
    expect(result.ok).toBe(false);
  });

  test('reports already locked', () => {
    const grid = makeGrid();
    const lockedIn = new Set<string>();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    lockInChoice(grid, 'user-1', lockedIn);
    const result = lockInChoice(grid, 'user-1', lockedIn);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.alreadyLocked).toBe(true);
  });
});

describe('assignDefaultSongs', () => {
  test('assigns random songs to cells without choices', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    claimCell(grid, 'user-2', '1:0');
    setCellSong(grid, 'user-1', 1, [0, 1, 2]); // user-1 chose
    // user-2 did not choose

    assignDefaultSongs(grid, [0, 1, 2]);

    expect(grid.cells.get('0:0')!.songIndex).toBe(1); // Preserved
    expect(grid.cells.get('1:0')!.songIndex).not.toBeNull(); // Assigned
  });

  test('does not change cells without owners', () => {
    const grid = makeGrid();
    assignDefaultSongs(grid, [0, 1, 2]);
    for (const cell of grid.cells.values()) {
      expect(cell.songIndex).toBeNull();
    }
  });
});

// ============================================================================
// Cell Movement (Audience Remix)
// ============================================================================

describe('moveCell', () => {
  function setupPlaybackGrid(): {
    grid: QuiltGrid;
    lockedCells: Set<string>;
    lastMoveByUser: Map<string, number>;
  } {
    const grid = makeGrid(2);
    claimCell(grid, 'user-1', '0:0');
    claimCell(grid, 'user-2', '0:1');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    setCellSong(grid, 'user-2', 1, [0, 1, 2]);
    return { grid, lockedCells: new Set(), lastMoveByUser: new Map() };
  }

  test('moves cell to empty position', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    const result = moveCell(
      grid, 'user-1', '1:0', makeRemixConfig(), lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(true);
    // user-1's cell should now be at row 1, col 0
    const cell = findUserCell(grid, 'user-1')!;
    expect(cell.rowIndex).toBe(1);
    expect(cell.columnIndex).toBe(0);
  });

  test('swaps with occupied cell', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    const result = moveCell(
      grid, 'user-1', '0:1', makeRemixConfig(), lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(true);
    // user-1 should be at 0:1, user-2 at 0:0
    const cell1 = findUserCell(grid, 'user-1')!;
    const cell2 = findUserCell(grid, 'user-2')!;
    expect(cell1.columnIndex).toBe(1);
    expect(cell2.columnIndex).toBe(0);
  });

  test('rejects move when remix disabled', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    const result = moveCell(
      grid, 'user-1', '1:0', makeRemixConfig({ enabled: false }), lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(false);
  });

  test('rejects cross-row move when not allowed', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    const result = moveCell(
      grid, 'user-1', '1:0', makeRemixConfig({ allowCrossRowSwaps: false }),
      lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(false);
  });

  test('rejects move on locked cell', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    lockedCells.add('0:0');
    const result = moveCell(
      grid, 'user-1', '1:0', makeRemixConfig(), lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(false);
  });

  test('enforces cooldown', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    // First move at loop 0
    moveCell(grid, 'user-1', '1:0', makeRemixConfig({ cooldownLoops: 2 }), lockedCells, lastMoveByUser, 0);
    // Try to move again at loop 1 (should fail, cooldown = 2)
    const result = moveCell(
      grid, 'user-1', '2:0', makeRemixConfig({ cooldownLoops: 2 }), lockedCells, lastMoveByUser, 1,
    );
    expect(result.ok).toBe(false);
    // Should succeed at loop 2
    const result2 = moveCell(
      grid, 'user-1', '2:0', makeRemixConfig({ cooldownLoops: 2 }), lockedCells, lastMoveByUser, 2,
    );
    expect(result2.ok).toBe(true);
  });

  test('rejects move to same position', () => {
    const { grid, lockedCells, lastMoveByUser } = setupPlaybackGrid();
    const result = moveCell(
      grid, 'user-1', '0:0', makeRemixConfig(), lockedCells, lastMoveByUser, 0,
    );
    expect(result.ok).toBe(false);
  });
});

describe('changeCellSong', () => {
  test('changes song when allowed', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    const result = changeCellSong(
      grid, 'user-1', 2,
      makeRemixConfig({ allowSongChange: true }), [0, 1, 2], new Set(),
    );
    expect(result.ok).toBe(true);
    expect(grid.cells.get('0:0')!.songIndex).toBe(2);
    expect(grid.cells.get('0:0')!.chapter).toBe('avoidance');
  });

  test('rejects song change when not allowed', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    const result = changeCellSong(
      grid, 'user-1', 2,
      makeRemixConfig({ allowSongChange: false }), [0, 1, 2], new Set(),
    );
    expect(result.ok).toBe(false);
  });

  test('rejects song change on locked cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    const lockedCells = new Set(['0:0']);
    const result = changeCellSong(
      grid, 'user-1', 2,
      makeRemixConfig({ allowSongChange: true }), [0, 1, 2], lockedCells,
    );
    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// Performer Operations
// ============================================================================

describe('reorderColumn', () => {
  test('moves a column to a new position', () => {
    const grid = makeGrid(4);
    expect(grid.columnOrder).toEqual([0, 1, 2, 3]);
    const result = reorderColumn(grid, 0, 2);
    expect(result.ok).toBe(true);
    expect(grid.columnOrder).toEqual([1, 2, 0, 3]);
  });

  test('no-op for same position', () => {
    const grid = makeGrid(4);
    const result = reorderColumn(grid, 1, 1);
    expect(result.ok).toBe(true);
    expect(grid.columnOrder).toEqual([0, 1, 2, 3]);
  });

  test('rejects invalid indices', () => {
    const grid = makeGrid(2);
    expect(reorderColumn(grid, -1, 0).ok).toBe(false);
    expect(reorderColumn(grid, 0, 5).ok).toBe(false);
  });
});

describe('swapCells', () => {
  test('swaps two cells', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    claimCell(grid, 'user-2', '1:1');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    setCellSong(grid, 'user-2', 1, [0, 1, 2]);

    const result = swapCells(grid, '0:0', '1:1');
    expect(result.ok).toBe(true);

    // user-1's cell should now be at position 1:1
    const cell1 = findUserCell(grid, 'user-1')!;
    expect(cell1.rowIndex).toBe(1);
    expect(cell1.columnIndex).toBe(1);
    expect(cell1.granularType).toBe('drums');
    expect(cell1.songIndex).toBe(0); // Song choice travels with cell

    // user-2's cell should now be at position 0:0
    const cell2 = findUserCell(grid, 'user-2')!;
    expect(cell2.rowIndex).toBe(0);
    expect(cell2.columnIndex).toBe(0);
    expect(cell2.granularType).toBe('bass');
  });

  test('rejects nonexistent cell', () => {
    const grid = makeGrid();
    expect(swapCells(grid, '0:0', '99:99').ok).toBe(false);
  });

  test('no-op for same cell', () => {
    const grid = makeGrid();
    expect(swapCells(grid, '0:0', '0:0').ok).toBe(true);
  });
});

describe('lockCell / unlockCell', () => {
  test('locks and unlocks a cell', () => {
    const grid = makeGrid();
    const locked = new Set<string>();
    expect(lockCell(locked, '0:0', grid).ok).toBe(true);
    expect(locked.has('0:0')).toBe(true);
    expect(unlockCell(locked, '0:0').ok).toBe(true);
    expect(locked.has('0:0')).toBe(false);
  });

  test('rejects locking nonexistent cell', () => {
    const grid = makeGrid();
    expect(lockCell(new Set(), '99:99', grid).ok).toBe(false);
  });

  test('rejects unlocking non-locked cell', () => {
    expect(unlockCell(new Set(), '0:0').ok).toBe(false);
  });
});

describe('muteCell / unmuteCell', () => {
  test('mutes and unmutes a cell', () => {
    const grid = makeGrid();
    const muted = new Set<string>();
    expect(muteCell(muted, '0:0', grid).ok).toBe(true);
    expect(muted.has('0:0')).toBe(true);
    expect(unmuteCell(muted, '0:0').ok).toBe(true);
    expect(muted.has('0:0')).toBe(false);
  });
});

describe('overrideCellSong', () => {
  test('overrides song choice', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '0:0');
    setCellSong(grid, 'user-1', 0, [0, 1, 2]);
    const result = overrideCellSong(grid, '0:0', 2, [0, 1, 2]);
    expect(result.ok).toBe(true);
    expect(grid.cells.get('0:0')!.songIndex).toBe(2);
    expect(grid.cells.get('0:0')!.chapter).toBe('avoidance');
  });

  test('rejects invalid song index', () => {
    const grid = makeGrid();
    expect(overrideCellSong(grid, '0:0', 5, [0, 1, 2]).ok).toBe(false);
  });

  test('rejects nonexistent cell', () => {
    const grid = makeGrid();
    expect(overrideCellSong(grid, '99:99', 0, [0, 1, 2]).ok).toBe(false);
  });
});

// ============================================================================
// Track Resolution
// ============================================================================

describe('resolveTrack', () => {
  test('resolves granularType + songIndex to track index', () => {
    const trackMap = new Map<string, Map<number, number>>([
      ['bass', new Map([[0, 10], [1, 11], [2, 12]])],
      ['drums', new Map([[0, 20], [1, 21], [2, 22]])],
    ]);
    expect(resolveTrack(trackMap, 'bass', 0)).toBe(10);
    expect(resolveTrack(trackMap, 'bass', 2)).toBe(12);
    expect(resolveTrack(trackMap, 'drums', 1)).toBe(21);
  });

  test('returns null for unknown granular type', () => {
    const trackMap = new Map<string, Map<number, number>>();
    expect(resolveTrack(trackMap, 'bass', 0)).toBeNull();
  });

  test('returns null for unknown song index', () => {
    const trackMap = new Map<string, Map<number, number>>([
      ['bass', new Map([[0, 10]])],
    ]);
    expect(resolveTrack(trackMap, 'bass', 5)).toBeNull();
  });
});

// ============================================================================
// Playhead
// ============================================================================

describe('advancePlayhead', () => {
  test('advances through column order', () => {
    const grid = makeGrid(4);
    expect(grid.playheadColumn).toBe(0);

    const r1 = advancePlayhead(grid);
    expect(r1.columnIndex).toBe(1);
    expect(r1.loopWrapped).toBe(false);

    advancePlayhead(grid);
    advancePlayhead(grid); // At column 3

    const r4 = advancePlayhead(grid); // Wraps
    expect(r4.columnIndex).toBe(0);
    expect(r4.loopWrapped).toBe(true);
    expect(grid.loopCount).toBe(1);
  });

  test('respects reordered columns', () => {
    const grid = makeGrid(3);
    reorderColumn(grid, 0, 2); // [1, 2, 0]

    const r1 = advancePlayhead(grid); // playhead was at 0, find index of 0 in [1,2,0] = index 2, next = index 0 (wraps)
    // Wait, initial playheadColumn = 0. indexOf(0) in [1,2,0] = 2. Next = (2+1)%3 = 0. columnOrder[0] = 1
    expect(r1.columnIndex).toBe(1);
    expect(r1.loopWrapped).toBe(true); // wrapped because nextOrderIndex is 0
  });

  test('increments loopCount on wrap', () => {
    const grid = makeGrid(1);
    expect(grid.loopCount).toBe(0);
    const result = advancePlayhead(grid);
    expect(result.loopWrapped).toBe(true);
    expect(grid.loopCount).toBe(1);
  });
});

// ============================================================================
// findUserCell
// ============================================================================

describe('findUserCell', () => {
  test('finds claimed cell', () => {
    const grid = makeGrid();
    claimCell(grid, 'user-1', '2:1');
    const cell = findUserCell(grid, 'user-1');
    expect(cell).not.toBeNull();
    expect(cell!.id).toBe('2:1');
  });

  test('returns null for unclaimed user', () => {
    const grid = makeGrid();
    expect(findUserCell(grid, 'nobody')).toBeNull();
  });
});

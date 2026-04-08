/**
 * Quilt Arc Tests (V3.3)
 *
 * Tests for pure arc functions: cell size computation, arc scheduling,
 * energy scoring, sorting algorithm (single-pass and multi-pass),
 * and position map application.
 */

import { describe, test, expect } from '@jest/globals';
import {
  computeBarsPerCell,
  computeArcSchedule,
  initArcState,
  computeCellEnergy,
  computeColumnEnergy,
  sortGrid,
  applyPositionMap,
  resolveTracksForRows,
  resolveAllTracksForRows,
  deriveSortMode,
} from '../quilt-arc';
import type { QuiltCell, ArcConfig } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

const GRANULAR_TYPES = ['drums', 'bass', 'melody', 'harmony', 'pad', 'fx'];

function makeArcConfig(overrides?: Partial<ArcConfig>): ArcConfig {
  return {
    enabled: true,
    cellSizeThreshold: 4,
    fullLoopBarsPerCell: 8,
    halfLoopBarsPerCell: 4,
    sortModeThresholdBars: 16,
    songEnergy: [
      { songIndex: 0, energy: 1.0 },
      { songIndex: 1, energy: 0.5 },
      { songIndex: 2, energy: 0.2 },
    ],
    rowWeight: {
      drums: 0.9,
      bass: 0.8,
      melody: 0.5,
      harmony: 0.4,
      pad: 0.3,
      fx: 0.2,
    },
    rowPriority: ['drums', 'bass', 'melody', 'harmony', 'pad', 'fx'],
    entrySchedule: [
      { granularTypes: ['drums', 'bass'], abletonLoopIndex: 0 },
      { granularTypes: ['melody', 'harmony'], abletonLoopIndex: 1 },
      { granularTypes: ['pad', 'fx'], abletonLoopIndex: 2 },
    ],
    exitSchedule: [
      { granularTypes: ['fx', 'pad'], abletonLoopIndex: 0 },
      { granularTypes: ['melody', 'harmony'], abletonLoopIndex: 1 },
      { granularTypes: ['bass', 'drums'], abletonLoopIndex: 2 },
    ],
    multiPassTargets: [0.5, 1.0, 0.2],
    allowCrossRowSort: true,
    allowSortMuting: true,
    ...overrides,
  };
}

/** Create a cell at a given position with a song choice. */
function makeCell(
  row: number,
  col: number,
  songIndex: number | null,
  ownerId: string | null = 'user',
): QuiltCell {
  const chapters = ['ambition', 'love', 'avoidance'] as const;
  return {
    id: `${row}:${col}`,
    rowIndex: row,
    columnIndex: col,
    granularType: GRANULAR_TYPES[row],
    songIndex,
    chapter: songIndex !== null ? chapters[songIndex] : null,
    ownerId,
  };
}

/** Create a full grid of cells with a given song pattern. */
function makeGrid(
  rows: number,
  columns: number,
  songPattern: (row: number, col: number) => number | null,
): Map<string, QuiltCell> {
  const cells = new Map<string, QuiltCell>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = makeCell(r, c, songPattern(r, c));
      cells.set(cell.id, cell);
    }
  }
  return cells;
}

// ============================================================================
// computeBarsPerCell
// ============================================================================

describe('computeBarsPerCell', () => {
  const config = makeArcConfig();

  test('below threshold returns fullLoopBarsPerCell', () => {
    expect(computeBarsPerCell(1, config)).toBe(8);
    expect(computeBarsPerCell(2, config)).toBe(8);
    expect(computeBarsPerCell(3, config)).toBe(8);
  });

  test('at threshold returns halfLoopBarsPerCell', () => {
    expect(computeBarsPerCell(4, config)).toBe(4);
  });

  test('above threshold returns halfLoopBarsPerCell', () => {
    expect(computeBarsPerCell(5, config)).toBe(4);
    expect(computeBarsPerCell(8, config)).toBe(4);
    expect(computeBarsPerCell(12, config)).toBe(4);
  });

  test('custom threshold', () => {
    const custom = makeArcConfig({ cellSizeThreshold: 6 });
    expect(computeBarsPerCell(5, custom)).toBe(8); // Below 6
    expect(computeBarsPerCell(6, custom)).toBe(4); // At 6
  });
});

// ============================================================================
// deriveSortMode
// ============================================================================

describe('deriveSortMode', () => {
  const config = makeArcConfig();

  test('grid loop >= threshold → single_pass', () => {
    expect(deriveSortMode(16, config)).toBe('single_pass');
    expect(deriveSortMode(24, config)).toBe('single_pass');
    expect(deriveSortMode(32, config)).toBe('single_pass');
  });

  test('grid loop < threshold → multi_pass', () => {
    expect(deriveSortMode(8, config)).toBe('multi_pass');
    expect(deriveSortMode(12, config)).toBe('multi_pass');
    expect(deriveSortMode(15, config)).toBe('multi_pass');
  });
});

// ============================================================================
// computeArcSchedule
// ============================================================================

describe('computeArcSchedule', () => {
  const config = makeArcConfig();

  test('2 columns: 8 bars/cell, 16 bar grid loop, single_pass', () => {
    const schedule = computeArcSchedule(2, config);
    expect(schedule.barsPerCell).toBe(8);
    expect(schedule.gridLoopBars).toBe(16);
    expect(schedule.sortMode).toBe('single_pass');
    expect(schedule.sortedPassCount).toBe(1);
  });

  test('3 columns: 8 bars/cell, 24 bar grid loop, single_pass', () => {
    const schedule = computeArcSchedule(3, config);
    expect(schedule.barsPerCell).toBe(8);
    expect(schedule.gridLoopBars).toBe(24);
    expect(schedule.sortMode).toBe('single_pass');
  });

  test('1 column: 8 bars/cell, 8 bar grid loop, multi_pass', () => {
    const schedule = computeArcSchedule(1, config);
    expect(schedule.barsPerCell).toBe(8);
    expect(schedule.gridLoopBars).toBe(8);
    expect(schedule.sortMode).toBe('multi_pass');
    expect(schedule.sortedPassCount).toBe(3); // multiPassTargets.length
  });

  test('4 columns: 4 bars/cell, 16 bar grid loop, single_pass', () => {
    const schedule = computeArcSchedule(4, config);
    expect(schedule.barsPerCell).toBe(4);
    expect(schedule.gridLoopBars).toBe(16);
    expect(schedule.sortMode).toBe('single_pass');
  });

  test('6 columns: 4 bars/cell, 24 bar grid loop, single_pass', () => {
    const schedule = computeArcSchedule(6, config);
    expect(schedule.barsPerCell).toBe(4);
    expect(schedule.gridLoopBars).toBe(24);
    expect(schedule.sortMode).toBe('single_pass');
  });

  test('entry/exit Ableton loop counts match schedule lengths', () => {
    const schedule = computeArcSchedule(4, config);
    expect(schedule.entryAbletonLoops).toBe(3); // 3 groups at loops 0, 1, 2
    expect(schedule.exitAbletonLoops).toBe(3);
  });
});

// ============================================================================
// initArcState
// ============================================================================

describe('initArcState', () => {
  test('creates initial state with entry phase', () => {
    const schedule = computeArcSchedule(4, makeArcConfig());
    const state = initArcState(schedule);
    expect(state.phase).toBe('entry');
    expect(state.currentPassIndex).toBe(0);
    expect(state.enteredRowGroups).toEqual([]);
    expect(state.exitedRowGroups).toEqual([]);
    expect(state.gridLoopsInPhase).toBe(0);
  });
});

// ============================================================================
// computeCellEnergy
// ============================================================================

describe('computeCellEnergy', () => {
  const config = makeArcConfig();

  test('empty cell returns -1', () => {
    const cell = makeCell(0, 0, null); // drums row, no song
    expect(computeCellEnergy(cell, config)).toBe(-1);
  });

  test('drums + Ambition (song 0) = 0.9 * 1.0 = 0.9', () => {
    const cell = makeCell(0, 0, 0); // drums row, song 0
    expect(computeCellEnergy(cell, config)).toBeCloseTo(0.9);
  });

  test('drums + Love (song 1) = 0.9 * 0.5 = 0.45', () => {
    const cell = makeCell(0, 0, 1);
    expect(computeCellEnergy(cell, config)).toBeCloseTo(0.45);
  });

  test('fx + Ambition (song 0) = 0.2 * 1.0 = 0.2', () => {
    const cell = makeCell(5, 0, 0); // fx row, song 0
    expect(computeCellEnergy(cell, config)).toBeCloseTo(0.2);
  });

  test('fx + Avoidance (song 2) = 0.2 * 0.2 = 0.04', () => {
    const cell = makeCell(5, 0, 2);
    expect(computeCellEnergy(cell, config)).toBeCloseTo(0.04);
  });

  test('drums energy >> fx energy for same song', () => {
    const drumCell = makeCell(0, 0, 0);
    const fxCell = makeCell(5, 0, 0);
    expect(computeCellEnergy(drumCell, config)).toBeGreaterThan(
      computeCellEnergy(fxCell, config) * 3,
    );
  });
});

// ============================================================================
// computeColumnEnergy
// ============================================================================

describe('computeColumnEnergy', () => {
  const config = makeArcConfig();

  test('all-Ambition column has highest possible energy', () => {
    const cells = makeGrid(6, 1, () => 0);
    const energy = computeColumnEnergy(cells, 0, 6, config);
    // Sum: 0.9 + 0.8 + 0.5 + 0.4 + 0.3 + 0.2 = 3.1 (all * 1.0)
    expect(energy).toBeCloseTo(3.1);
  });

  test('all-Avoidance column has low energy', () => {
    const cells = makeGrid(6, 1, () => 2);
    const energy = computeColumnEnergy(cells, 0, 6, config);
    // Sum: (0.9+0.8+0.5+0.4+0.3+0.2) * 0.2 = 0.62
    expect(energy).toBeCloseTo(0.62);
  });

  test('empty column has zero energy', () => {
    const cells = makeGrid(6, 1, () => null);
    const energy = computeColumnEnergy(cells, 0, 6, config);
    expect(energy).toBe(0);
  });

  test('mixed column energy is between extremes', () => {
    const cells = makeGrid(6, 2, (r, c) => c === 0 ? 0 : 2);
    const highEnergy = computeColumnEnergy(cells, 0, 6, config);
    const lowEnergy = computeColumnEnergy(cells, 1, 6, config);
    expect(highEnergy).toBeGreaterThan(lowEnergy);
  });
});

// ============================================================================
// sortGrid — Single-pass
// ============================================================================

describe('sortGrid single-pass', () => {
  const config = makeArcConfig();

  test('1 column grid returns empty position map (nothing to sort)', () => {
    const cells = makeGrid(6, 1, () => 0);
    const result = sortGrid(cells, 1, 6, config, 'single');
    expect(result.size).toBe(0);
  });

  test('all same song returns empty or minimal position map', () => {
    const cells = makeGrid(6, 4, () => 0);
    const result = sortGrid(cells, 4, 6, config, 'single');
    // All cells have same song, already consolidated — no moves needed
    expect(result.size).toBe(0);
  });

  test('alternating songs get consolidated into runs', () => {
    // Use 6 columns for enough room: alternating [0, 1, 0, 1, 0, 1]
    const cells = makeGrid(6, 6, (_r, c) => c % 2);
    const result = sortGrid(cells, 6, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Check drums row (row 0) for consolidation
    const drumsRow = [];
    for (let c = 0; c < 6; c++) {
      drumsRow.push(cells.get(`0:${c}`)?.songIndex);
    }

    // Count transitions — original had 5 (alternating every cell)
    let transitions = 0;
    for (let i = 1; i < drumsRow.length; i++) {
      if (drumsRow[i] !== drumsRow[i - 1]) transitions++;
    }
    // Sorted should have fewer transitions than pure alternation
    expect(transitions).toBeLessThan(5);
  });

  test('high-energy songs concentrate in middle zone (climax)', () => {
    // 6 columns with mixed songs
    const songPattern = [0, 2, 1, 0, 2, 1]; // Varied energy
    const cells = makeGrid(6, 6, (_r, c) => songPattern[c]);
    const result = sortGrid(cells, 6, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Compute column energies after sort
    const energies = [];
    for (let c = 0; c < 6; c++) {
      energies.push(computeColumnEnergy(cells, c, 6, config));
    }

    // Middle zone (cols 2-3) should have higher energy than final zone (cols 4-5)
    const middleEnergy = energies[2] + energies[3];
    const finalEnergy = energies[4] + energies[5];
    expect(middleEnergy).toBeGreaterThanOrEqual(finalEnergy);
  });

  test('empty cells migrate to cool-down zone (end of row)', () => {
    // Use 6 columns: 4 filled, 2 empty per row
    const cells = makeGrid(6, 6, (_r, c) => {
      if (c >= 4) return null; // Last 2 columns empty
      return 0; // All song 0
    });
    // Scatter the empties by swapping positions
    // Put empties at cols 1, 3 instead of 4, 5
    for (let r = 0; r < 6; r++) {
      // Swap cell content: col 1 ↔ col 4, col 3 ↔ col 5
      const c1 = cells.get(`${r}:1`)!;
      const c4 = cells.get(`${r}:4`)!;
      c1.songIndex = null; c1.chapter = null; c1.ownerId = null;
      c4.songIndex = 0; c4.chapter = 'ambition'; c4.ownerId = 'user';

      const c3 = cells.get(`${r}:3`)!;
      const c5 = cells.get(`${r}:5`)!;
      c3.songIndex = null; c3.chapter = null; c3.ownerId = null;
      c5.songIndex = 0; c5.chapter = 'ambition'; c5.ownerId = 'user';
    }

    const result = sortGrid(cells, 6, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Check drums row: empty cells should be in the last zone (cols 4-5)
    const drumsRow = [];
    for (let c = 0; c < 6; c++) {
      drumsRow.push(cells.get(`0:${c}`)?.songIndex);
    }

    // Count nulls in the last 2 columns (zone 3)
    const nullsInZone3 = drumsRow.slice(4).filter(s => s === null).length;
    // Count nulls in first 4 columns
    const nullsInZone12 = drumsRow.slice(0, 4).filter(s => s === null).length;
    // More empty cells should be in zone 3 than in zones 1+2
    expect(nullsInZone3).toBeGreaterThanOrEqual(nullsInZone12);
  });

  test('drums row gets better consolidation than fx row', () => {
    // Create a challenging pattern: 3 songs alternating
    const cells = makeGrid(6, 6, (_r, c) => c % 3);
    const result = sortGrid(cells, 6, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Count transitions in drums row vs fx row
    function countTransitions(rowIndex: number): number {
      let transitions = 0;
      for (let c = 1; c < 6; c++) {
        const prev = cells.get(`${rowIndex}:${c - 1}`)?.songIndex;
        const curr = cells.get(`${rowIndex}:${c}`)?.songIndex;
        if (prev !== curr) transitions++;
      }
      return transitions;
    }

    const drumsTransitions = countTransitions(0);
    const fxTransitions = countTransitions(5);
    // Drums should have <= transitions than fx (better consolidation)
    expect(drumsTransitions).toBeLessThanOrEqual(fxTransitions);
  });

  test('song choices are never changed by sorting', () => {
    const originalSongs = new Map<string, number | null>();
    const cells = makeGrid(6, 4, (_r, c) => c % 3);

    // Record original song choices
    for (const [id, cell] of cells) {
      originalSongs.set(id, cell.songIndex);
    }

    const result = sortGrid(cells, 4, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Every original cell's songIndex must still exist somewhere in the grid
    const allSongs = new Map<string, number | null>();
    for (const cell of cells.values()) {
      // Find this cell's original ID by matching ownerId
      allSongs.set(cell.id, cell.songIndex);
    }

    // Count songs before and after — must match
    const countBefore = new Map<number, number>();
    const countAfter = new Map<number, number>();
    for (const song of originalSongs.values()) {
      if (song !== null) countBefore.set(song, (countBefore.get(song) ?? 0) + 1);
    }
    for (const cell of cells.values()) {
      if (cell.songIndex !== null) countAfter.set(cell.songIndex, (countAfter.get(cell.songIndex) ?? 0) + 1);
    }
    expect(countAfter).toEqual(countBefore);
  });
});

// ============================================================================
// sortGrid — Multi-pass
// ============================================================================

describe('sortGrid multi-pass', () => {
  const config = makeArcConfig();

  test('high energy target concentrates Ambition songs', () => {
    const cells = makeGrid(6, 3, (_r, c) => c); // cols: 0, 1, 2
    const result = sortGrid(cells, 3, 6, config, 'multi', 1.0);
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Song 0 (energy 1.0) should be consolidated in drums row
    const drumsRow = [];
    for (let c = 0; c < 3; c++) {
      drumsRow.push(cells.get(`0:${c}`)?.songIndex);
    }

    // At least drums row should start with song 0 (highest energy = target 1.0)
    const song0Count = drumsRow.filter(s => s === 0).length;
    expect(song0Count).toBeGreaterThan(0);
  });

  test('low energy target concentrates Avoidance songs', () => {
    const cells = makeGrid(6, 3, (_r, c) => c); // cols: 0, 1, 2
    const result = sortGrid(cells, 3, 6, config, 'multi', 0.2);
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Song 2 (energy 0.2 = target) should be favored
    const drumsRow = [];
    for (let c = 0; c < 3; c++) {
      drumsRow.push(cells.get(`0:${c}`)?.songIndex);
    }
    const song2Count = drumsRow.filter(s => s === 2).length;
    expect(song2Count).toBeGreaterThan(0);
  });

  test('preserves all song choices across multi-pass', () => {
    const cells = makeGrid(6, 3, (_r, c) => c % 3);

    const songCountBefore = new Map<number, number>();
    for (const cell of cells.values()) {
      if (cell.songIndex !== null) {
        songCountBefore.set(cell.songIndex, (songCountBefore.get(cell.songIndex) ?? 0) + 1);
      }
    }

    // Run all 3 passes
    for (const target of [0.5, 1.0, 0.2]) {
      const result = sortGrid(cells, 3, 6, config, 'multi', target);
      applyPositionMap(cells, result, GRANULAR_TYPES);
    }

    const songCountAfter = new Map<number, number>();
    for (const cell of cells.values()) {
      if (cell.songIndex !== null) {
        songCountAfter.set(cell.songIndex, (songCountAfter.get(cell.songIndex) ?? 0) + 1);
      }
    }

    expect(songCountAfter).toEqual(songCountBefore);
  });
});

// ============================================================================
// applyPositionMap
// ============================================================================

describe('applyPositionMap', () => {
  test('empty position map does nothing', () => {
    const cells = makeGrid(6, 2, () => 0);
    const moved = applyPositionMap(cells, new Map(), GRANULAR_TYPES);
    expect(moved.size).toBe(0);
  });

  test('moves cell to new position and updates ID', () => {
    const cells = makeGrid(6, 2, (_r, c) => c);
    const posMap = new Map([['0:0', { rowIndex: 0, columnIndex: 1 }]]);

    // Cell at 0:0 has song 0, cell at 0:1 has song 1
    const originalSong0 = cells.get('0:0')!.songIndex;

    const moved = applyPositionMap(cells, posMap, GRANULAR_TYPES);
    expect(moved.has('0:0')).toBe(true);

    // The cell that was at 0:0 should now be at 0:1
    const cellAt01 = cells.get('0:1');
    expect(cellAt01).toBeDefined();
    expect(cellAt01!.songIndex).toBe(originalSong0);
    expect(cellAt01!.id).toBe('0:1');
    expect(cellAt01!.rowIndex).toBe(0);
    expect(cellAt01!.columnIndex).toBe(1);
  });

  test('updates granularType when cell moves to different row', () => {
    const cells = makeGrid(6, 2, () => 0);
    // Move drums cell (row 0) to bass row (row 1)
    const posMap = new Map([['0:0', { rowIndex: 1, columnIndex: 0 }]]);

    applyPositionMap(cells, posMap, GRANULAR_TYPES);

    const movedCell = cells.get('1:0');
    expect(movedCell).toBeDefined();
    expect(movedCell!.granularType).toBe('bass'); // Row 1 = bass
  });
});

// ============================================================================
// resolveTracksForRows
// ============================================================================

describe('resolveTracksForRows', () => {
  test('resolves tracks for specified granular types at playhead column', () => {
    const cells = makeGrid(6, 2, () => 0);
    const trackMap = new Map<string, Map<number, number>>([
      ['drums', new Map([[0, 10], [1, 11]])],
      ['bass', new Map([[0, 20], [1, 21]])],
      ['melody', new Map([[0, 30]])],
    ]);

    const tracks = resolveTracksForRows(
      cells, trackMap, ['drums', 'bass'], 0, new Set(), 6,
    );
    expect(tracks).toContain(10);
    expect(tracks).toContain(20);
    expect(tracks).not.toContain(30);
  });

  test('skips muted cells', () => {
    const cells = makeGrid(6, 2, () => 0);
    const trackMap = new Map([
      ['drums', new Map([[0, 10]])],
      ['bass', new Map([[0, 20]])],
    ]);

    const tracks = resolveTracksForRows(
      cells, trackMap, ['drums', 'bass'], 0, new Set(['0:0']), 6,
    );
    expect(tracks).not.toContain(10); // drums cell muted
    expect(tracks).toContain(20);
  });

  test('skips empty cells (null songIndex)', () => {
    const cells = makeGrid(6, 2, (r) => r === 0 ? null : 0);
    const trackMap = new Map([
      ['drums', new Map([[0, 10]])],
      ['bass', new Map([[0, 20]])],
    ]);

    const tracks = resolveTracksForRows(
      cells, trackMap, ['drums', 'bass'], 0, new Set(), 6,
    );
    expect(tracks).not.toContain(10); // drums cell empty
    expect(tracks).toContain(20);
  });
});

// ============================================================================
// resolveAllTracksForRows
// ============================================================================

describe('resolveAllTracksForRows', () => {
  test('resolves all unique tracks across all columns for given types', () => {
    // 2 columns: col 0 has song 0, col 1 has song 1
    const cells = makeGrid(6, 2, (_r, c) => c);
    const trackMap = new Map([
      ['drums', new Map([[0, 10], [1, 11]])],
      ['bass', new Map([[0, 20], [1, 21]])],
    ]);

    const tracks = resolveAllTracksForRows(
      cells, trackMap, ['drums', 'bass'], new Set(),
    );
    expect(tracks.sort()).toEqual([10, 11, 20, 21]);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  const config = makeArcConfig();

  test('all empty cells — sort produces no moves', () => {
    const cells = makeGrid(6, 4, () => null);
    const result = sortGrid(cells, 4, 6, config, 'single');
    // All cells are empty, all same "energy" — nothing to sort
    expect(result.size).toBe(0);
  });

  test('single song everywhere — sort produces no moves', () => {
    const cells = makeGrid(6, 4, () => 1);
    const result = sortGrid(cells, 4, 6, config, 'single');
    expect(result.size).toBe(0);
  });

  test('2 columns with mixed songs', () => {
    const cells = makeGrid(6, 2, (_r, c) => c);
    const result = sortGrid(cells, 2, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Should still have exactly 6 cells with song 0 and 6 with song 1
    let count0 = 0, count1 = 0;
    for (const cell of cells.values()) {
      if (cell.songIndex === 0) count0++;
      if (cell.songIndex === 1) count1++;
    }
    expect(count0).toBe(6);
    expect(count1).toBe(6);
  });

  test('grid integrity: all positions filled after sort', () => {
    const cells = makeGrid(6, 4, (_r, c) => c % 3);
    const result = sortGrid(cells, 4, 6, config, 'single');
    applyPositionMap(cells, result, GRANULAR_TYPES);

    // Every position should have a cell
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        expect(cells.has(`${r}:${c}`)).toBe(true);
      }
    }
  });
});

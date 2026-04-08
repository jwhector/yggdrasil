/**
 * Quilt Arc — Pure Functions for Automated Sorting & Playback Arc (V3.3)
 *
 * The arc is the automated playback sequence that runs after the audience
 * locks in their choices: entry (staggered unmute) → raw (unmodified grid) →
 * sort + sorted playback → exit (staggered mute).
 *
 * The sorting algorithm uses two complementary mechanisms:
 * 1. Weighted energy scoring: songEnergy[songIndex] * rowWeight[granularType]
 *    so column energy totals reflect musical reality.
 * 2. Tiered consolidation: high-weight rows (drums, bass) get sorted first
 *    with optimal run lengths; low-weight rows absorb fragmentation.
 *
 * All functions are pure — no I/O, no Socket.IO, no database calls.
 */

import type {
  QuiltCell,
  ArcConfig,
  ArcSchedule,
  ArcState,
  SortMode,
} from './types';

// ============================================================================
// Cell Size & Schedule
// ============================================================================

/**
 * Compute bars per cell based on column count and the cell size threshold.
 * Below threshold: fullLoopBarsPerCell (8 bars). At/above: halfLoopBarsPerCell (4 bars).
 */
export function computeBarsPerCell(columns: number, arcConfig: ArcConfig): number {
  return columns < arcConfig.cellSizeThreshold
    ? arcConfig.fullLoopBarsPerCell
    : arcConfig.halfLoopBarsPerCell;
}

/**
 * Derive the sort mode from grid loop duration.
 */
export function deriveSortMode(gridLoopBars: number, arcConfig: ArcConfig): SortMode {
  return gridLoopBars >= arcConfig.sortModeThresholdBars ? 'single_pass' : 'multi_pass';
}

/**
 * Compute the full arc schedule from grid dimensions + config.
 */
export function computeArcSchedule(columns: number, arcConfig: ArcConfig): ArcSchedule {
  const barsPerCell = computeBarsPerCell(columns, arcConfig);
  const gridLoopBars = columns * barsPerCell;
  const sortMode = deriveSortMode(gridLoopBars, arcConfig);

  const entryAbletonLoops = arcConfig.entrySchedule.length > 0
    ? Math.max(...arcConfig.entrySchedule.map(s => s.abletonLoopIndex)) + 1
    : 1;

  const sortedPassCount = sortMode === 'single_pass'
    ? 1
    : arcConfig.multiPassTargets.length;

  const exitAbletonLoops = arcConfig.exitSchedule.length > 0
    ? Math.max(...arcConfig.exitSchedule.map(s => s.abletonLoopIndex)) + 1
    : 1;

  return {
    sortMode,
    barsPerCell,
    gridLoopBars,
    entryAbletonLoops,
    sortedPassCount,
    exitAbletonLoops,
  };
}

/**
 * Create initial arc state for the start of playback.
 */
export function initArcState(schedule: ArcSchedule): ArcState {
  return {
    phase: 'entry',
    schedule,
    currentPassIndex: 0,
    enteredRowGroups: [],
    exitedRowGroups: [],
    gridLoopsInPhase: 0,
  };
}

// ============================================================================
// Energy Scoring
// ============================================================================

/** Energy value for empty cells — below any song. */
const EMPTY_CELL_ENERGY = -1;

/**
 * Compute weighted energy for a single cell.
 * Energy = songEnergy[songIndex] * rowWeight[granularType].
 * Empty cells (null songIndex) return EMPTY_CELL_ENERGY.
 */
export function computeCellEnergy(cell: QuiltCell, arcConfig: ArcConfig): number {
  if (cell.songIndex === null) return EMPTY_CELL_ENERGY;

  const songProfile = arcConfig.songEnergy.find(s => s.songIndex === cell.songIndex);
  const songE = songProfile?.energy ?? 0;
  const rowW = arcConfig.rowWeight[cell.granularType] ?? 0;
  return songE * rowW;
}

/**
 * Compute the total weighted energy for a column.
 * Sum of computeCellEnergy for all cells in that column.
 */
export function computeColumnEnergy(
  cells: Map<string, QuiltCell>,
  columnIndex: number,
  rows: number,
  arcConfig: ArcConfig,
): number {
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const cell = cells.get(`${r}:${columnIndex}`);
    if (cell) {
      const e = computeCellEnergy(cell, arcConfig);
      if (e > 0) total += e;
    }
  }
  return total;
}

// ============================================================================
// Sorting Algorithm
// ============================================================================

/**
 * Position map: cellId → new { rowIndex, columnIndex }.
 * The sorting algorithm returns this; the conductor applies it to the grid.
 */
export type PositionMap = Map<string, { rowIndex: number; columnIndex: number }>;

/**
 * Sort the grid. Returns a position map of cellId → new position.
 * Does NOT mutate the input — caller applies the map.
 *
 * mode='single': 3-zone arc in one grid loop (opening→climax→cool-down).
 * mode='multi': uniform energy target for the entire grid (one pass at a time).
 */
export function sortGrid(
  cells: Map<string, QuiltCell>,
  columns: number,
  rows: number,
  arcConfig: ArcConfig,
  mode: 'single' | 'multi',
  targetEnergy?: number,
): PositionMap {
  if (columns <= 1) return new Map(); // Nothing to sort

  if (mode === 'single') {
    return sortGridSinglePass(cells, columns, rows, arcConfig);
  } else {
    return sortGridMultiPass(cells, columns, rows, arcConfig, targetEnergy ?? 0.5);
  }
}

/**
 * Single-pass sort: divide columns into 3 zones and build an energy arc.
 * Zone 1 (opening ~third): medium energy
 * Zone 2 (middle ~third): high energy (climax)
 * Zone 3 (final ~third): cool-down (low energy, empty cells)
 */
function sortGridSinglePass(
  cells: Map<string, QuiltCell>,
  columns: number,
  rows: number,
  arcConfig: ArcConfig,
): PositionMap {
  // Divide columns into 3 zones
  const zone1End = Math.max(1, Math.floor(columns / 3));
  const zone2End = Math.max(zone1End + 1, Math.floor((columns * 2) / 3));
  // zone3 = [zone2End, columns)

  const zones: Array<{ start: number; end: number; targetEnergy: number }> = [
    { start: 0, end: zone1End, targetEnergy: 0.5 },      // Medium
    { start: zone1End, end: zone2End, targetEnergy: 1.0 }, // High
    { start: zone2End, end: columns, targetEnergy: 0.2 },  // Cool-down
  ];

  return sortWithZones(cells, columns, rows, arcConfig, zones);
}

/**
 * Multi-pass sort: entire grid targets one energy level.
 */
function sortGridMultiPass(
  cells: Map<string, QuiltCell>,
  columns: number,
  rows: number,
  arcConfig: ArcConfig,
  targetEnergy: number,
): PositionMap {
  const zones = [{ start: 0, end: columns, targetEnergy }];
  return sortWithZones(cells, columns, rows, arcConfig, zones);
}

/**
 * Core sorting engine. All cells are treated as a shared pool.
 * Rows are filled in priority order — drums gets first pick of the best-matching
 * cells for each zone, then bass, etc. Lower-priority rows get what's left.
 *
 * This is true tiered consolidation: the rhythm section (drums, bass) shapes the
 * energy arc because they pick first; texture rows (pad, fx) absorb fragmentation.
 */
function sortWithZones(
  cells: Map<string, QuiltCell>,
  columns: number,
  rows: number,
  arcConfig: ArcConfig,
  zones: Array<{ start: number; end: number; targetEnergy: number }>,
): PositionMap {
  const positionMap: PositionMap = new Map();

  // Build a 2D target layout: [row][column] = cellId or null
  const layout: (string | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => null),
  );

  // Map granular type to row index
  const typeToRow = new Map<string, number>();
  for (const cell of cells.values()) {
    if (!typeToRow.has(cell.granularType)) {
      typeToRow.set(cell.granularType, cell.rowIndex);
    }
  }

  // Build the shared pool: all cells, available for any row
  const pool = new Set<string>();
  for (const cell of cells.values()) {
    pool.add(cell.id);
  }

  // Pre-compute song energy for each cell
  const cellEnergy = new Map<string, number>();
  for (const cell of cells.values()) {
    if (cell.songIndex === null) {
      cellEnergy.set(cell.id, -1);
    } else {
      const songE = arcConfig.songEnergy.find(s => s.songIndex === cell.songIndex)?.energy ?? 0;
      cellEnergy.set(cell.id, songE);
    }
  }

  // For each zone, pre-sort the pool by fit (distance to zone target)
  // This lets each row quickly grab the best-fitting cells for each zone
  function scoreCellForZone(cellId: string, zoneTarget: number): number {
    const e = cellEnergy.get(cellId) ?? -1;
    if (e < 0) return 1000; // Empty cells → worst fit for non-cooldown zones
    return Math.abs(e - zoneTarget);
  }

  // Process rows in priority order — drums picks first, fx picks last
  for (const granularType of arcConfig.rowPriority) {
    const rowIndex = typeToRow.get(granularType);
    if (rowIndex === undefined) continue;

    // For this row, fill each zone's columns with the best available cells
    const rowSequence: string[] = [];

    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      const zoneCapacity = zone.end - zone.start;

      // Score all remaining pool cells for this zone
      const candidates = [...pool].map(id => ({
        id,
        score: scoreCellForZone(id, zone.targetEnergy),
        songIndex: cells.get(id)!.songIndex,
      }));

      // Sort: best fit first, then by songIndex for consolidation (same-song runs)
      candidates.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        // Same fit score → group by songIndex for run consolidation
        const aSong = a.songIndex ?? 999;
        const bSong = b.songIndex ?? 999;
        return aSong - bSong;
      });

      // Take up to zoneCapacity cells
      const taken: string[] = [];
      for (const c of candidates) {
        if (taken.length >= zoneCapacity) break;
        taken.push(c.id);
        pool.delete(c.id);
      }

      // Within the taken set, sort by songIndex for run consolidation
      taken.sort((a, b) => {
        const aSong = cells.get(a)!.songIndex ?? 999;
        const bSong = cells.get(b)!.songIndex ?? 999;
        return aSong - bSong;
      });

      rowSequence.push(...taken);
    }

    // Place into layout
    for (let c = 0; c < columns && c < rowSequence.length; c++) {
      layout[rowIndex][c] = rowSequence[c];
    }
  }

  // Apply vertical unity optimization
  applyVerticalUnitySwaps(layout, cells, columns, rows, arcConfig);

  // Build position map — only include cells that actually moved
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cellId = layout[r][c];
      if (cellId !== null) {
        const cell = cells.get(cellId);
        if (cell && (cell.rowIndex !== r || cell.columnIndex !== c)) {
          positionMap.set(cellId, { rowIndex: r, columnIndex: c });
        }
      }
    }
  }

  return positionMap;
}

/**
 * Post-processing: try local swaps within each row that improve vertical
 * (column-level) song agreement, weighted by row weight.
 */
function applyVerticalUnitySwaps(
  layout: (string | null)[][],
  cells: Map<string, QuiltCell>,
  columns: number,
  rows: number,
  arcConfig: ArcConfig,
): void {
  // Score a column's vertical unity: count cells with the same songIndex,
  // weighted by rowWeight
  function columnUnityScore(col: number): number {
    const songCounts = new Map<number, number>();
    for (let r = 0; r < rows; r++) {
      const cellId = layout[r][col];
      if (cellId) {
        const cell = cells.get(cellId);
        if (cell && cell.songIndex !== null) {
          const weight = arcConfig.rowWeight[cell.granularType] ?? 0;
          songCounts.set(cell.songIndex, (songCounts.get(cell.songIndex) ?? 0) + weight);
        }
      }
    }
    // Unity = max weighted agreement for any single song
    return songCounts.size > 0 ? Math.max(...songCounts.values()) : 0;
  }

  // For each row, try swapping adjacent cells within the same zone
  // if it improves the column unity score
  for (let r = 0; r < rows; r++) {
    let improved = true;
    let iterations = 0;
    const maxIterations = columns * 2; // Prevent infinite loops

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (let c = 0; c < columns - 1; c++) {
        const cellIdA = layout[r][c];
        const cellIdB = layout[r][c + 1];
        if (!cellIdA || !cellIdB) continue;

        const cellA = cells.get(cellIdA);
        const cellB = cells.get(cellIdB);
        if (!cellA || !cellB) continue;
        if (cellA.songIndex === cellB.songIndex) continue; // Same song, no benefit

        // Score before swap
        const scoreBefore = columnUnityScore(c) + columnUnityScore(c + 1);

        // Try swap
        layout[r][c] = cellIdB;
        layout[r][c + 1] = cellIdA;

        // Score after swap
        const scoreAfter = columnUnityScore(c) + columnUnityScore(c + 1);

        if (scoreAfter > scoreBefore) {
          improved = true; // Keep the swap
        } else {
          // Revert
          layout[r][c] = cellIdA;
          layout[r][c + 1] = cellIdB;
        }
      }
    }
  }
}

// ============================================================================
// Applying Sort Results to Grid
// ============================================================================

/**
 * Apply a position map to a grid's cells. Mutates the cells map in place.
 * Handles the ID re-keying needed because cell IDs are position-based.
 *
 * Strategy: snapshot ALL cells, rebuild the entire cells map with new positions
 * for moved cells and original positions for non-moved cells. This avoids
 * complex displacement tracking.
 *
 * Returns the set of original cellIds that moved.
 */
export function applyPositionMap(
  cells: Map<string, QuiltCell>,
  positionMap: PositionMap,
  granularTypes: string[],
): Set<string> {
  if (positionMap.size === 0) return new Set();

  // Snapshot all cells
  const allCells = new Map<string, QuiltCell>();
  for (const [id, cell] of cells) {
    allCells.set(id, { ...cell });
  }

  // Build the new position for every cell:
  // - Cells in the positionMap get their new position
  // - All other cells keep their current position
  const newPositions = new Map<string, { rowIndex: number; columnIndex: number }>();
  const movingSourcePositions = new Set<string>(); // Original positions of moving cells
  const movingTargetPositions = new Set<string>(); // New positions of moving cells

  for (const [cellId, newPos] of positionMap) {
    const cell = allCells.get(cellId);
    if (cell) {
      newPositions.set(cellId, newPos);
      movingSourcePositions.add(cellId); // cellId IS the position (row:col)
      movingTargetPositions.add(`${newPos.rowIndex}:${newPos.columnIndex}`);
    }
  }

  // Non-moving cells keep their positions — but if a non-moving cell's position
  // is taken by a mover, it needs to go somewhere. Find displaced cells and
  // assign them to vacated positions.
  const nonMoving: QuiltCell[] = [];
  for (const [id, cell] of allCells) {
    if (!newPositions.has(id)) {
      nonMoving.push(cell);
    }
  }

  // Vacated positions: positions freed by movers that aren't filled by other movers
  const vacatedPositions = new Set<string>();
  for (const pos of movingSourcePositions) {
    if (!movingTargetPositions.has(pos)) {
      vacatedPositions.add(pos);
    }
  }

  // Displaced cells: non-moving cells whose position is taken by a mover
  const displaced: QuiltCell[] = [];
  const stayingInPlace: QuiltCell[] = [];
  for (const cell of nonMoving) {
    const posKey = `${cell.rowIndex}:${cell.columnIndex}`;
    if (movingTargetPositions.has(posKey)) {
      displaced.push(cell);
    } else {
      stayingInPlace.push(cell);
    }
  }

  // Assign displaced cells to vacated positions
  const vacatedList = [...vacatedPositions];
  for (let i = 0; i < displaced.length && i < vacatedList.length; i++) {
    const [row, col] = vacatedList[i].split(':').map(Number);
    newPositions.set(displaced[i].id, { rowIndex: row, columnIndex: col });
  }

  // Rebuild the cells map
  cells.clear();
  const movedIds = new Set<string>();

  // Place moving cells
  for (const [originalId, newPos] of newPositions) {
    const cell = allCells.get(originalId)!;
    const newId = `${newPos.rowIndex}:${newPos.columnIndex}`;
    cells.set(newId, {
      ...cell,
      id: newId,
      rowIndex: newPos.rowIndex,
      columnIndex: newPos.columnIndex,
      granularType: granularTypes[newPos.rowIndex] ?? cell.granularType,
    });
    if (positionMap.has(originalId)) {
      movedIds.add(originalId);
    }
  }

  // Place non-displaced cells (staying in place)
  for (const cell of stayingInPlace) {
    const posKey = `${cell.rowIndex}:${cell.columnIndex}`;
    if (!cells.has(posKey)) {
      cells.set(posKey, { ...cell });
    }
  }

  return movedIds;
}

// ============================================================================
// Track Resolution for Row Groups
// ============================================================================

/**
 * Resolve which Ableton track indices should be active for specific granular
 * types at the current playhead column. Used by entry/exit to compute which
 * tracks to unmute/mute for a row group.
 */
export function resolveTracksForRows(
  cells: Map<string, QuiltCell>,
  trackMap: Map<string, Map<number, number>>,
  granularTypes: string[],
  playheadColumn: number,
  mutedCells: Set<string>,
  rows: number,
): number[] {
  const tracks: number[] = [];

  // Map granular type to its row index
  const typeToRow = new Map<string, number>();
  for (const cell of cells.values()) {
    if (!typeToRow.has(cell.granularType)) {
      typeToRow.set(cell.granularType, cell.rowIndex);
    }
  }

  for (const gt of granularTypes) {
    const rowIndex = typeToRow.get(gt);
    if (rowIndex === undefined) continue;

    const cellId = `${rowIndex}:${playheadColumn}`;
    const cell = cells.get(cellId);
    if (!cell || cell.songIndex === null) continue;
    if (mutedCells.has(cellId)) continue;

    const typeMap = trackMap.get(gt);
    if (!typeMap) continue;
    const trackIndex = typeMap.get(cell.songIndex);
    if (trackIndex !== undefined) {
      tracks.push(trackIndex);
    }
  }

  return tracks;
}

/**
 * Resolve ALL track indices that should be active for a set of granular types
 * across ALL columns. Used for entry unmute to ensure all tracks for the
 * row group are ready regardless of which column the playhead is on.
 */
export function resolveAllTracksForRows(
  cells: Map<string, QuiltCell>,
  trackMap: Map<string, Map<number, number>>,
  granularTypes: string[],
  mutedCells: Set<string>,
): number[] {
  const trackSet = new Set<number>();

  for (const cell of cells.values()) {
    if (!granularTypes.includes(cell.granularType)) continue;
    if (cell.songIndex === null) continue;
    if (mutedCells.has(cell.id)) continue;

    const typeMap = trackMap.get(cell.granularType);
    if (!typeMap) continue;
    const trackIndex = typeMap.get(cell.songIndex);
    if (trackIndex !== undefined) {
      trackSet.add(trackIndex);
    }
  }

  return [...trackSet];
}

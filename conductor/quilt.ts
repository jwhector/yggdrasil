/**
 * Quilt — Pure Functions for V3.3 Finale Grid Operations
 *
 * The quilt is the finale's core data structure: a grid of cells where
 * rows = granular types and columns = time slices. Each cell holds a
 * song choice (0, 1, 2) that resolves to an Ableton track via:
 *   trackMap[granularType][songIndex] → trackIndex
 *
 * All functions are pure — no I/O, no Socket.IO, no database calls.
 */

import type {
  UserId,
  QuiltCell,
  QuiltConfig,
  AudienceRemixConfig,
  GranularType,
  Chapter,
  V33FinaleState,
} from './types';
import { computeBarsPerCell } from './quilt-arc';

// ============================================================================
// Types
// ============================================================================

export interface QuiltGrid {
  rows: number;
  columns: number;
  barsPerCell: number;
  cells: Map<string, QuiltCell>;
  columnOrder: number[];
  playheadColumn: number;
  loopCount: number;
}

export type QuiltResult<T = QuiltGrid> =
  | { ok: true; grid: T; }
  | { ok: false; error: string; };

// ============================================================================
// Grid Creation
// ============================================================================

/** Map song index to chapter. */
function chapterFromSongIndex(songIndex: number): Chapter {
  const chapters: Chapter[] = ['ambition', 'love', 'avoidance'];
  return chapters[songIndex] ?? 'ambition';
}

/**
 * Derive column count from audience size and config.
 * Minimum 1 column, maximum maxColumns. Each column needs at least 1 bar.
 */
export function deriveColumnCount(audienceSize: number, config: QuiltConfig): number {
  const granularTypeCount = 6; // Always 6 rows
  const rawColumns = Math.ceil(audienceSize / granularTypeCount);
  const maxByBars = Math.floor(config.loopBars / 1); // Minimum 1 bar per cell
  return Math.max(1, Math.min(rawColumns, config.maxColumns, maxByBars));
}

/**
 * Create an empty quilt grid sized for the given audience.
 */
export function createQuiltGrid(
  audienceSize: number,
  config: QuiltConfig,
  granularTypes: GranularType[],
): QuiltGrid {
  const columns = deriveColumnCount(audienceSize, config);
  const rows = granularTypes.length; // Typically 6
  // Use arc-based cell size when arc config is present, otherwise fall back to divided
  const barsPerCell = config.arc?.enabled
    ? computeBarsPerCell(columns, config.arc)
    : config.loopBars / columns;

  const cells = new Map<string, QuiltCell>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const id = `${r}:${c}`;
      cells.set(id, {
        id,
        rowIndex: r,
        columnIndex: c,
        granularType: granularTypes[r].id,
        songIndex: null,
        chapter: null,
        ownerId: null,
      });
    }
  }

  const columnOrder = Array.from({ length: columns }, (_, i) => i);

  return {
    rows,
    columns,
    barsPerCell,
    cells,
    columnOrder,
    playheadColumn: 0,
    loopCount: 0,
  };
}

// ============================================================================
// Assignment Phase: Cell Claiming
// ============================================================================

/**
 * Find which cell a user currently owns, if any.
 */
export function findUserCell(grid: QuiltGrid, userId: UserId): QuiltCell | null {
  for (const cell of grid.cells.values()) {
    if (cell.ownerId === userId) return cell;
  }
  return null;
}

/**
 * Claim a cell for a user. User must not already own a cell (release first).
 * Cell must be unclaimed.
 */
export function claimCell(
  grid: QuiltGrid,
  userId: UserId,
  cellId: string,
): QuiltResult {
  const cell = grid.cells.get(cellId);
  if (!cell) return { ok: false, error: `Cell not found: ${cellId}` };
  if (cell.ownerId !== null) return { ok: false, error: `Cell ${cellId} already claimed by ${cell.ownerId}` };

  const existing = findUserCell(grid, userId);
  if (existing) return { ok: false, error: `User ${userId} already owns cell ${existing.id}. Release first.` };

  cell.ownerId = userId;
  return { ok: true, grid };
}

/**
 * Release a user's cell claim.
 */
export function releaseCell(
  grid: QuiltGrid,
  userId: UserId,
): QuiltResult {
  const cell = findUserCell(grid, userId);
  if (!cell) return { ok: false, error: `User ${userId} does not own any cell` };

  cell.ownerId = null;
  cell.songIndex = null;
  cell.chapter = null;
  return { ok: true, grid };
}

/**
 * Assign unclaimed users to remaining empty cells (round-robin).
 * Used when assignment timer expires.
 */
export function assignRemainingUsers(
  grid: QuiltGrid,
  unclaimedUserIds: UserId[],
): { grid: QuiltGrid; assignments: Array<{ userId: UserId; cellId: string }> } {
  const emptyCells: QuiltCell[] = [];
  for (const cell of grid.cells.values()) {
    if (cell.ownerId === null) emptyCells.push(cell);
  }

  // Shuffle unclaimed users (Fisher-Yates)
  const shuffled = [...unclaimedUserIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const assignments: Array<{ userId: UserId; cellId: string }> = [];
  const count = Math.min(shuffled.length, emptyCells.length);
  for (let i = 0; i < count; i++) {
    emptyCells[i].ownerId = shuffled[i];
    assignments.push({ userId: shuffled[i], cellId: emptyCells[i].id });
  }

  return { grid, assignments };
}

// ============================================================================
// Preview Phase: Song Choice
// ============================================================================

/**
 * Set the song choice for a user's cell.
 * User must own a cell. songIndex must be in availableSongs.
 */
export function setCellSong(
  grid: QuiltGrid,
  userId: UserId,
  songIndex: number,
  availableSongs: number[],
): QuiltResult {
  const cell = findUserCell(grid, userId);
  if (!cell) return { ok: false, error: `User ${userId} does not own any cell` };
  if (!availableSongs.includes(songIndex)) {
    return { ok: false, error: `Song index ${songIndex} not available. Available: ${availableSongs.join(', ')}` };
  }

  cell.songIndex = songIndex;
  cell.chapter = chapterFromSongIndex(songIndex);
  return { ok: true, grid };
}

/**
 * Mark a user as locked in (their song choice is final).
 * Returns true if successful.
 */
export function lockInChoice(
  grid: QuiltGrid,
  userId: UserId,
  lockedInUsers: Set<UserId>,
): { ok: true; alreadyLocked: boolean } | { ok: false; error: string } {
  const cell = findUserCell(grid, userId);
  if (!cell) return { ok: false, error: `User ${userId} does not own any cell` };
  if (cell.songIndex === null) return { ok: false, error: `User ${userId} has not chosen a song yet` };

  if (lockedInUsers.has(userId)) return { ok: true, alreadyLocked: true };
  lockedInUsers.add(userId);
  return { ok: true, alreadyLocked: false };
}

/**
 * Assign default songs to users who didn't choose or lock in.
 * If they previewed a song (songIndex !== null), keep it.
 * Otherwise, assign a random available song.
 */
export function assignDefaultSongs(
  grid: QuiltGrid,
  availableSongs: number[],
): void {
  if (availableSongs.length === 0) return;
  for (const cell of grid.cells.values()) {
    if (cell.ownerId !== null && cell.songIndex === null) {
      const randomSong = availableSongs[Math.floor(Math.random() * availableSongs.length)];
      cell.songIndex = randomSong;
      cell.chapter = chapterFromSongIndex(randomSong);
    }
  }
}

// ============================================================================
// Playback Phase: Cell Movement (Audience Remix)
// ============================================================================

/**
 * Move a user's cell to a target position. If target is occupied, swap.
 * Validates against audienceRemix config.
 */
export function moveCell(
  grid: QuiltGrid,
  userId: UserId,
  targetCellId: string,
  config: AudienceRemixConfig,
  lockedCells: Set<string>,
  lastMoveByUser: Map<UserId, number>,
  currentLoopCount: number,
): QuiltResult {
  if (!config.enabled) return { ok: false, error: 'Audience remix is disabled' };

  const sourceCell = findUserCell(grid, userId);
  if (!sourceCell) return { ok: false, error: `User ${userId} does not own any cell` };

  // Scope check
  if (config.scope === 'own_cell' && sourceCell.ownerId !== userId) {
    return { ok: false, error: 'Can only move your own cell' };
  }

  const targetCell = grid.cells.get(targetCellId);
  if (!targetCell) return { ok: false, error: `Target cell not found: ${targetCellId}` };
  if (sourceCell.id === targetCellId) return { ok: false, error: 'Cannot move to same position' };

  // Locked cell check
  if (lockedCells.has(sourceCell.id)) return { ok: false, error: `Cell ${sourceCell.id} is locked by performer` };
  if (lockedCells.has(targetCellId)) return { ok: false, error: `Target cell ${targetCellId} is locked by performer` };

  // Cross-row check
  if (sourceCell.rowIndex !== targetCell.rowIndex && !config.allowCrossRowSwaps) {
    return { ok: false, error: 'Cross-row swaps are not allowed' };
  }

  // Cooldown check
  if (config.cooldownLoops > 0) {
    const lastMove = lastMoveByUser.get(userId);
    if (lastMove !== undefined && (currentLoopCount - lastMove) < config.cooldownLoops) {
      return { ok: false, error: `Cooldown: must wait ${config.cooldownLoops} loop(s) between moves` };
    }
  }

  // Perform the swap
  swapCellPositions(grid, sourceCell.id, targetCellId);

  // Record move time
  lastMoveByUser.set(userId, currentLoopCount);

  return { ok: true, grid };
}

/**
 * Change a user's cell song during playback.
 * Only valid when audienceRemix.allowSongChange is true.
 */
export function changeCellSong(
  grid: QuiltGrid,
  userId: UserId,
  songIndex: number,
  config: AudienceRemixConfig,
  availableSongs: number[],
  lockedCells: Set<string>,
): QuiltResult {
  if (!config.enabled) return { ok: false, error: 'Audience remix is disabled' };
  if (!config.allowSongChange) return { ok: false, error: 'Song change not allowed during playback' };

  const cell = findUserCell(grid, userId);
  if (!cell) return { ok: false, error: `User ${userId} does not own any cell` };
  if (lockedCells.has(cell.id)) return { ok: false, error: `Cell ${cell.id} is locked by performer` };
  if (!availableSongs.includes(songIndex)) {
    return { ok: false, error: `Song index ${songIndex} not available` };
  }

  cell.songIndex = songIndex;
  cell.chapter = chapterFromSongIndex(songIndex);
  return { ok: true, grid };
}

// ============================================================================
// Performer Operations
// ============================================================================

/**
 * Reorder a column in the playback order.
 * Moves the column at fromIndex to toIndex, shifting others.
 */
export function reorderColumn(
  grid: QuiltGrid,
  fromIndex: number,
  toIndex: number,
): QuiltResult {
  if (fromIndex < 0 || fromIndex >= grid.columnOrder.length) {
    return { ok: false, error: `Invalid fromIndex: ${fromIndex}` };
  }
  if (toIndex < 0 || toIndex >= grid.columnOrder.length) {
    return { ok: false, error: `Invalid toIndex: ${toIndex}` };
  }
  if (fromIndex === toIndex) return { ok: true, grid };

  const [removed] = grid.columnOrder.splice(fromIndex, 1);
  grid.columnOrder.splice(toIndex, 0, removed);
  return { ok: true, grid };
}

/**
 * Swap any two cells (performer operation). Swaps positions in the grid.
 */
export function swapCells(
  grid: QuiltGrid,
  cellIdA: string,
  cellIdB: string,
): QuiltResult {
  const cellA = grid.cells.get(cellIdA);
  const cellB = grid.cells.get(cellIdB);
  if (!cellA) return { ok: false, error: `Cell not found: ${cellIdA}` };
  if (!cellB) return { ok: false, error: `Cell not found: ${cellIdB}` };
  if (cellIdA === cellIdB) return { ok: true, grid };

  swapCellPositions(grid, cellIdA, cellIdB);
  return { ok: true, grid };
}

/**
 * Lock a cell — prevent audience moves.
 */
export function lockCell(
  lockedCells: Set<string>,
  cellId: string,
  grid: QuiltGrid,
): { ok: boolean; error?: string } {
  if (!grid.cells.has(cellId)) return { ok: false, error: `Cell not found: ${cellId}` };
  lockedCells.add(cellId);
  return { ok: true };
}

/**
 * Unlock a cell.
 */
export function unlockCell(
  lockedCells: Set<string>,
  cellId: string,
): { ok: boolean; error?: string } {
  if (!lockedCells.has(cellId)) return { ok: false, error: `Cell ${cellId} is not locked` };
  lockedCells.delete(cellId);
  return { ok: true };
}

/**
 * Mute a cell.
 */
export function muteCell(
  mutedCells: Set<string>,
  cellId: string,
  grid: QuiltGrid,
): { ok: boolean; error?: string } {
  if (!grid.cells.has(cellId)) return { ok: false, error: `Cell not found: ${cellId}` };
  mutedCells.add(cellId);
  return { ok: true };
}

/**
 * Unmute a cell.
 */
export function unmuteCell(
  mutedCells: Set<string>,
  cellId: string,
): { ok: boolean; error?: string } {
  if (!mutedCells.has(cellId)) return { ok: false, error: `Cell ${cellId} is not muted` };
  mutedCells.delete(cellId);
  return { ok: true };
}

/**
 * Override a cell's song choice (performer tool).
 */
export function overrideCellSong(
  grid: QuiltGrid,
  cellId: string,
  songIndex: number,
  availableSongs: number[],
): QuiltResult {
  const cell = grid.cells.get(cellId);
  if (!cell) return { ok: false, error: `Cell not found: ${cellId}` };
  if (!availableSongs.includes(songIndex)) {
    return { ok: false, error: `Song index ${songIndex} not available` };
  }

  cell.songIndex = songIndex;
  cell.chapter = chapterFromSongIndex(songIndex);
  return { ok: true, grid };
}

// ============================================================================
// Track Resolution
// ============================================================================

/**
 * Resolve a cell to an Ableton track index.
 * trackMap[granularType][songIndex] → trackIndex
 */
export function resolveTrack(
  trackMap: Map<string, Map<number, number>>,
  granularType: string,
  songIndex: number,
): number | null {
  const typeMap = trackMap.get(granularType);
  if (!typeMap) return null;
  return typeMap.get(songIndex) ?? null;
}

/**
 * Build a trackMap from the config's attempt definitions and granular types.
 * Maps granularType → songIndex → first track index from the winning option's TrackBundle.
 *
 * This uses the attempt results to determine which option (A/B) won for each layer group,
 * then extracts each granular type's track indices from the winning bundle.
 */
export function buildTrackMap(
  finaleState: V33FinaleState,
): Map<string, Map<number, number>> {
  const trackMap = new Map<string, Map<number, number>>();

  for (const fragment of finaleState.availableFragments) {
    if (!trackMap.has(fragment.granularType)) {
      trackMap.set(fragment.granularType, new Map());
    }
    const typeMap = trackMap.get(fragment.granularType)!;
    // Use the first track index for this granular type + song combination
    if (!typeMap.has(fragment.songIndex) && fragment.trackIndices.length > 0) {
      typeMap.set(fragment.songIndex, fragment.trackIndices[0]);
    }
  }

  return trackMap;
}

// ============================================================================
// Playback: Playhead
// ============================================================================

/**
 * Advance the playhead to the next column in columnOrder.
 * Wraps around and increments loopCount.
 */
export function advancePlayhead(grid: QuiltGrid): {
  columnIndex: number;
  loopWrapped: boolean;
} {
  const currentOrderIndex = grid.columnOrder.indexOf(grid.playheadColumn);
  const nextOrderIndex = (currentOrderIndex + 1) % grid.columnOrder.length;
  const loopWrapped = nextOrderIndex === 0;

  if (loopWrapped) {
    grid.loopCount++;
  }

  grid.playheadColumn = grid.columnOrder[nextOrderIndex];
  return { columnIndex: grid.playheadColumn, loopWrapped };
}

/**
 * Peek at the next column without advancing the playhead or mutating state.
 */
export function peekNextColumn(grid: QuiltGrid): number {
  const currentOrderIndex = grid.columnOrder.indexOf(grid.playheadColumn);
  const nextOrderIndex = (currentOrderIndex + 1) % grid.columnOrder.length;
  return grid.columnOrder[nextOrderIndex];
}

// ============================================================================
// Available Songs (derived from attempt results)
// ============================================================================

/**
 * Determine which songs are available based on attempt results.
 * A song is available if at least one layer was resolved (locked_in or collapsed after layer 0).
 * In practice, all 3 songs are almost always available.
 */
export function deriveAvailableSongs(
  finaleState: V33FinaleState,
): number[] {
  const available = new Set<number>();
  for (const fragment of finaleState.availableFragments) {
    available.add(fragment.songIndex);
  }
  return [...available].sort();
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Swap two cells' positions in the grid.
 * The cells exchange rowIndex, columnIndex, granularType, and their
 * position in the cells map (their IDs become swapped).
 */
function swapCellPositions(grid: QuiltGrid, cellIdA: string, cellIdB: string): void {
  const cellA = grid.cells.get(cellIdA)!;
  const cellB = grid.cells.get(cellIdB)!;

  // Swap position data
  const tmpRow = cellA.rowIndex;
  const tmpCol = cellA.columnIndex;
  const tmpGranularType = cellA.granularType;

  cellA.rowIndex = cellB.rowIndex;
  cellA.columnIndex = cellB.columnIndex;
  cellA.granularType = cellB.granularType;

  cellB.rowIndex = tmpRow;
  cellB.columnIndex = tmpCol;
  cellB.granularType = tmpGranularType;

  // Update cell IDs (position-based) and re-key in the map
  const newIdA = `${cellA.rowIndex}:${cellA.columnIndex}`;
  const newIdB = `${cellB.rowIndex}:${cellB.columnIndex}`;

  cellA.id = newIdA;
  cellB.id = newIdB;

  // Re-key: remove old, add new
  grid.cells.delete(cellIdA);
  grid.cells.delete(cellIdB);
  grid.cells.set(newIdA, cellA);
  grid.cells.set(newIdB, cellB);
}

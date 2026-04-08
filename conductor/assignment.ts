/**
 * Assignment — Cell Claiming Logic (V3.3)
 *
 * Handles the finale assignment phase where audience members claim cells
 * in the quilt grid. Auto mode distributes users across cells round-robin.
 * Self-select mode lets users claim cells individually.
 *
 * Pure functions, no I/O.
 */

import type { UserId, User } from './types';
import type { QuiltGrid } from './quilt';

/**
 * Fisher-Yates shuffle (in place).
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get connected user IDs from the users map.
 */
export function getConnectedUserIds(users: Map<UserId, User>): UserId[] {
  const ids: UserId[] = [];
  for (const [userId, user] of users) {
    if (user.connected) {
      ids.push(userId);
    }
  }
  return ids;
}

/**
 * Auto-assign: shuffle connected users and distribute across quilt cells round-robin.
 * Returns the list of assignments made.
 */
export function autoAssignCells(
  grid: QuiltGrid,
  users: Map<UserId, User>,
): Array<{ userId: UserId; cellId: string }> {
  const userIds = shuffle(getConnectedUserIds(users));
  const emptyCells: string[] = [];

  // Collect empty cells in row-major order
  for (let c = 0; c < grid.columns; c++) {
    for (let r = 0; r < grid.rows; r++) {
      const cellId = `${r}:${c}`;
      const cell = grid.cells.get(cellId);
      if (cell && cell.ownerId === null) {
        emptyCells.push(cellId);
      }
    }
  }

  const assignments: Array<{ userId: UserId; cellId: string }> = [];
  const count = Math.min(userIds.length, emptyCells.length);

  for (let i = 0; i < count; i++) {
    const cell = grid.cells.get(emptyCells[i])!;
    cell.ownerId = userIds[i];
    assignments.push({ userId: userIds[i], cellId: emptyCells[i] });
  }

  return assignments;
}

/**
 * Get user IDs not yet assigned to any cell.
 */
export function getUnclaimedUsers(
  users: Map<UserId, User>,
  grid: QuiltGrid,
): UserId[] {
  const assigned = new Set<UserId>();
  for (const cell of grid.cells.values()) {
    if (cell.ownerId) assigned.add(cell.ownerId);
  }
  return getConnectedUserIds(users).filter(id => !assigned.has(id));
}

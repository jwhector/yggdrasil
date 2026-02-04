/**
 * Faction Assignment Algorithm
 *
 * Balances two goals:
 * 1. Equal faction sizes (hard constraint: no faction > 1 member larger than another)
 * 2. Minimize same-faction adjacency (soft optimization)
 *
 * This encourages cross-faction communication since neighbors are likely
 * in different factions.
 */

import type { UserId, FactionId, SeatId, AdjacencyGraph, User } from './types';

interface UserWithSeat {
  id: UserId;
  seatId: SeatId | null;
}

/**
 * Assign factions to all users, balancing faction sizes and minimizing
 * same-faction adjacency.
 *
 * @param users - Array of users to assign
 * @param graph - Adjacency graph defining which seats are neighbors
 * @returns Map of userId to assigned factionId
 */
export function assignFactions(
  users: UserWithSeat[],
  graph: AdjacencyGraph
): Map<UserId, FactionId> {
  const assignments = new Map<UserId, FactionId>();
  const factionCounts: [number, number, number, number] = [0, 0, 0, 0];

  // Build a map of seatId to userId for quick lookups
  const seatToUser = new Map<SeatId, UserId>();
  for (const user of users) {
    if (user.seatId) {
      seatToUser.set(user.seatId, user.id);
    }
  }

  // Sort users by most-constrained-first (users with most neighbors already assigned)
  const sortedUsers = sortByConstraints(users, graph, assignments, seatToUser);

  for (const user of sortedUsers) {
    // Get factions of adjacent seats
    const neighborFactions: FactionId[] = [];
    if (user.seatId) {
      const neighborSeats = graph.getNeighbors(user.seatId);
      for (const neighborSeat of neighborSeats) {
        const neighborUserId = seatToUser.get(neighborSeat);
        if (neighborUserId) {
          const neighborFaction = assignments.get(neighborUserId);
          if (neighborFaction !== undefined) {
            neighborFactions.push(neighborFaction);
          }
        }
      }
    }

    // Score each faction: lower is better
    const scores: Array<{ factionId: FactionId; score: number }> = [0, 1, 2, 3].map(factionId => {
      const sizeScore = factionCounts[factionId] * 100; // Heavy weight on balance
      const adjacencyScore = neighborFactions.filter(f => f === factionId).length;
      return { factionId: factionId as FactionId, score: sizeScore + adjacencyScore };
    });

    // Sort by score (lowest first)
    scores.sort((a, b) => a.score - b.score);
    const chosen = scores[0].factionId;

    assignments.set(user.id, chosen);
    factionCounts[chosen]++;
  }

  return assignments;
}

/**
 * Sort users by most-constrained-first.
 * Users with more neighbors already assigned are processed first.
 */
function sortByConstraints(
  users: UserWithSeat[],
  graph: AdjacencyGraph,
  assignments: Map<UserId, FactionId>,
  seatToUser: Map<SeatId, UserId>
): UserWithSeat[] {
  return [...users].sort((a, b) => {
    const aConstraints = countAssignedNeighbors(a, graph, assignments, seatToUser);
    const bConstraints = countAssignedNeighbors(b, graph, assignments, seatToUser);
    return bConstraints - aConstraints; // Higher constraints first
  });
}

/**
 * Count how many of a user's neighbors have already been assigned.
 */
function countAssignedNeighbors(
  user: UserWithSeat,
  graph: AdjacencyGraph,
  assignments: Map<UserId, FactionId>,
  seatToUser: Map<SeatId, UserId>
): number {
  if (!user.seatId) {
    return 0;
  }

  const neighbors = graph.getNeighbors(user.seatId);
  let count = 0;

  for (const neighborSeat of neighbors) {
    const neighborUserId = seatToUser.get(neighborSeat);
    if (neighborUserId && assignments.has(neighborUserId)) {
      count++;
    }
  }

  return count;
}

/**
 * Assign a latecomer (user joining after faction assignment).
 * Assigns to the smallest faction, preferring one with fewer adjacent members.
 *
 * @param user - The user to assign
 * @param existingUsers - All currently assigned users
 * @param graph - Adjacency graph
 * @returns The assigned faction ID
 */
export function assignLatecomer(
  user: UserWithSeat,
  existingUsers: Map<UserId, User>,
  graph: AdjacencyGraph
): FactionId {
  // Count faction members
  const factionCounts: [number, number, number, number] = [0, 0, 0, 0];
  const seatToFaction = new Map<SeatId, FactionId>();

  for (const existingUser of existingUsers.values()) {
    if (existingUser.faction !== null) {
      factionCounts[existingUser.faction]++;
      if (existingUser.seatId) {
        seatToFaction.set(existingUser.seatId, existingUser.faction);
      }
    }
  }

  // Find smallest faction(s)
  const minCount = Math.min(...factionCounts);
  const smallestFactions: FactionId[] = [];
  for (let i = 0; i < 4; i++) {
    if (factionCounts[i] === minCount) {
      smallestFactions.push(i as FactionId);
    }
  }

  // If only one smallest faction, return it
  if (smallestFactions.length === 1) {
    return smallestFactions[0];
  }

  // If user has no seat, pick first smallest faction
  if (!user.seatId) {
    return smallestFactions[0];
  }

  // Get neighbor factions
  const neighborFactions: FactionId[] = [];
  const neighborSeats = graph.getNeighbors(user.seatId);
  for (const neighborSeat of neighborSeats) {
    const neighborFaction = seatToFaction.get(neighborSeat);
    if (neighborFaction !== undefined) {
      neighborFactions.push(neighborFaction);
    }
  }

  // Among smallest factions, pick one with fewest adjacent members
  let best = smallestFactions[0];
  let bestAdjacency = Infinity;

  for (const factionId of smallestFactions) {
    const adjacentCount = neighborFactions.filter(f => f === factionId).length;
    if (adjacentCount < bestAdjacency) {
      best = factionId;
      bestAdjacency = adjacentCount;
    }
  }

  return best;
}

/**
 * Create a simple adjacency graph that considers no seats adjacent.
 * Used as a fallback when no topology is configured.
 */
export class NullAdjacencyGraph implements AdjacencyGraph {
  getNeighbors(_seatId: SeatId): SeatId[] {
    return [];
  }
}

/**
 * Create an adjacency graph for theater-style rows.
 * Each seat is adjacent to:
 * - Left and right neighbors in the same row
 * - Seats directly in front and behind (same position in adjacent rows)
 */
export class TheaterRowsAdjacencyGraph implements AdjacencyGraph {
  private rows: SeatId[][];

  constructor(seats: SeatId[]) {
    // Parse seats assuming format like "A1", "A2", "B1", "B2"
    // Group by row letter, sort by number
    const rowMap = new Map<string, SeatId[]>();

    for (const seat of seats) {
      const rowLetter = seat.charAt(0);
      if (!rowMap.has(rowLetter)) {
        rowMap.set(rowLetter, []);
      }
      rowMap.get(rowLetter)!.push(seat);
    }

    // Sort each row by seat number
    this.rows = Array.from(rowMap.values()).map(row =>
      row.sort((a, b) => {
        const aNum = parseInt(a.substring(1));
        const bNum = parseInt(b.substring(1));
        return aNum - bNum;
      })
    );
  }

  getNeighbors(seatId: SeatId): SeatId[] {
    const neighbors: SeatId[] = [];

    // Find seat's position
    let rowIndex = -1;
    let seatIndex = -1;

    for (let r = 0; r < this.rows.length; r++) {
      const idx = this.rows[r].indexOf(seatId);
      if (idx !== -1) {
        rowIndex = r;
        seatIndex = idx;
        break;
      }
    }

    if (rowIndex === -1) {
      return neighbors; // Seat not found
    }

    const currentRow = this.rows[rowIndex];

    // Left neighbor
    if (seatIndex > 0) {
      neighbors.push(currentRow[seatIndex - 1]);
    }

    // Right neighbor
    if (seatIndex < currentRow.length - 1) {
      neighbors.push(currentRow[seatIndex + 1]);
    }

    // Front row (same position)
    if (rowIndex > 0 && seatIndex < this.rows[rowIndex - 1].length) {
      neighbors.push(this.rows[rowIndex - 1][seatIndex]);
    }

    // Back row (same position)
    if (rowIndex < this.rows.length - 1 && seatIndex < this.rows[rowIndex + 1].length) {
      neighbors.push(this.rows[rowIndex + 1][seatIndex]);
    }

    return neighbors;
  }
}

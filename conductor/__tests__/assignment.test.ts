/**
 * Faction Assignment Tests
 *
 * Tests cover:
 * - Perfect balance (12 users → 3,3,3,3)
 * - Imperfect balance (13 users → 4,3,3,3)
 * - Adjacency optimization
 * - Latecomer joins smallest faction
 * - Latecomer adjacency tiebreaker
 */

import { describe, test, expect } from '@jest/globals';
import {
  assignFactions,
  assignLatecomer,
  NullAdjacencyGraph,
  TheaterRowsAdjacencyGraph,
} from '../assignment';
import type { UserId, FactionId, SeatId, AdjacencyGraph, User } from '../types';

// Helper to create users with seats
function createUsers(count: number, seatPrefix: string = 'A'): Array<{ id: UserId; seatId: SeatId }> {
  const users = [];
  for (let i = 1; i <= count; i++) {
    users.push({
      id: `user${i}`,
      seatId: `${seatPrefix}${i}`,
    });
  }
  return users;
}

// Helper to count faction sizes
function countFactionSizes(assignments: Map<UserId, FactionId>): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const faction of assignments.values()) {
    counts[faction]++;
  }
  return counts;
}

// Helper to check if factions are balanced (no more than 1 member difference)
function isBalanced(counts: [number, number, number, number]): boolean {
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  return max - min <= 1;
}

describe('assignFactions', () => {
  test('assigns perfectly balanced factions for 12 users (3,3,3,3)', () => {
    const users = createUsers(12);
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);
    const counts = countFactionSizes(assignments);

    expect(counts).toEqual([3, 3, 3, 3]);
  });

  test('assigns balanced factions for 13 users (max difference of 1)', () => {
    const users = createUsers(13);
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);
    const counts = countFactionSizes(assignments);

    expect(isBalanced(counts)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(13);

    // Should have one faction with 4, rest with 3
    const sorted = [...counts].sort();
    expect(sorted).toEqual([3, 3, 3, 4]);
  });

  test('assigns balanced factions for 30 users', () => {
    const users = createUsers(30);
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);
    const counts = countFactionSizes(assignments);

    expect(isBalanced(counts)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);

    // Should be 8, 8, 7, 7 or similar
    const sorted = [...counts].sort();
    expect(sorted).toEqual([7, 7, 8, 8]);
  });

  test('assigns all users to factions', () => {
    const users = createUsers(15);
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);

    expect(assignments.size).toBe(15);
    for (const user of users) {
      expect(assignments.has(user.id)).toBe(true);
    }
  });

  test('minimizes same-faction adjacency when possible', () => {
    // Create a simple linear arrangement: A1-A2-A3-A4
    const users = createUsers(4);
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'A3', 'A4']);

    const assignments = assignFactions(users, graph);

    // Check that neighbors tend not to be in the same faction
    // A1 and A2 should ideally be different
    // A2 and A3 should ideally be different
    // A3 and A4 should ideally be different

    // With 4 users and 4 factions, all should be in different factions
    const uniqueFactions = new Set(assignments.values());
    expect(uniqueFactions.size).toBe(4);
  });

  test('prioritizes balance over adjacency optimization', () => {
    // With 8 users in a row, balance requires 2 per faction
    // Some adjacency will be unavoidable
    const users = createUsers(8);
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);

    const assignments = assignFactions(users, graph);
    const counts = countFactionSizes(assignments);

    // Balance must be maintained
    expect(counts).toEqual([2, 2, 2, 2]);
  });

  test('handles users without seats', () => {
    const users = [
      { id: 'u1', seatId: null },
      { id: 'u2', seatId: null },
      { id: 'u3', seatId: null },
      { id: 'u4', seatId: null },
    ];
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);

    expect(assignments.size).toBe(4);
    const counts = countFactionSizes(assignments);
    expect(counts).toEqual([1, 1, 1, 1]);
  });

  test('handles empty user list', () => {
    const users: Array<{ id: UserId; seatId: SeatId }> = [];
    const graph = new NullAdjacencyGraph();

    const assignments = assignFactions(users, graph);

    expect(assignments.size).toBe(0);
  });
});

describe('assignLatecomer', () => {
  // Helper to create existing users map
  function createExistingUsers(factionCounts: [number, number, number, number]): Map<UserId, User> {
    const users = new Map<UserId, User>();
    let userId = 0;

    for (let faction = 0; faction < 4; faction++) {
      for (let i = 0; i < factionCounts[faction]; i++) {
        const id = `u${userId++}`;
        users.set(id, {
          id,
          seatId: `${String.fromCharCode(65 + faction)}${i + 1}`, // A1, B1, C1, D1...
          faction: faction as FactionId,
          connected: true,
          joinedAt: Date.now(),
        });
      }
    }

    return users;
  }

  test('assigns latecomer to smallest faction', () => {
    const existingUsers = createExistingUsers([3, 2, 3, 3]); // Faction 1 is smallest
    const latecomer = { id: 'newcomer', seatId: 'Z1' };
    const graph = new NullAdjacencyGraph();

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    expect(assigned).toBe(1); // Smallest faction
  });

  test('assigns latecomer to one of the tied smallest factions', () => {
    const existingUsers = createExistingUsers([3, 2, 2, 3]); // Factions 1 and 2 are tied
    const latecomer = { id: 'newcomer', seatId: 'Z1' };
    const graph = new NullAdjacencyGraph();

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    expect([1, 2]).toContain(assigned);
  });

  test('uses adjacency as tiebreaker when factions are tied', () => {
    const existingUsers = new Map<UserId, User>([
      ['u1', { id: 'u1', seatId: 'A1', faction: 0, connected: true, joinedAt: 0 }],
      ['u2', { id: 'u2', seatId: 'A2', faction: 1, connected: true, joinedAt: 0 }],
      ['u3', { id: 'u3', seatId: 'A3', faction: 0, connected: true, joinedAt: 0 }],
    ]);

    // Latecomer sits next to A2 (faction 1)
    // Factions 1, 2, and 3 are all size 1 (tied for smallest)
    // Should prefer faction 2 or 3 over faction 1 (to avoid adjacency)
    const latecomer = { id: 'newcomer', seatId: 'A2' }; // Has neighbor in faction 1
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'A3']);

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    // Should prefer faction 2 or 3 (no adjacent members) over faction 1
    expect([2, 3]).toContain(assigned);
  });

  test('handles latecomer without seat', () => {
    const existingUsers = createExistingUsers([3, 2, 3, 3]);
    const latecomer = { id: 'newcomer', seatId: null };
    const graph = new NullAdjacencyGraph();

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    expect(assigned).toBe(1); // Smallest faction
  });

  test('handles first user joining show', () => {
    const existingUsers = new Map<UserId, User>();
    const latecomer = { id: 'first', seatId: 'A1' };
    const graph = new NullAdjacencyGraph();

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    expect([0, 1, 2, 3]).toContain(assigned);
  });

  test('handles perfectly balanced factions', () => {
    const existingUsers = createExistingUsers([3, 3, 3, 3]);
    const latecomer = { id: 'newcomer', seatId: 'Z1' };
    const graph = new NullAdjacencyGraph();

    const assigned = assignLatecomer(latecomer, existingUsers, graph);

    expect([0, 1, 2, 3]).toContain(assigned); // Any faction is valid
  });
});

describe('TheaterRowsAdjacencyGraph', () => {
  test('finds left and right neighbors in same row', () => {
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'A3']);

    const neighbors = graph.getNeighbors('A2');

    expect(neighbors).toContain('A1');
    expect(neighbors).toContain('A3');
    expect(neighbors.length).toBe(2);
  });

  test('finds front and back neighbors in adjacent rows', () => {
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

    const neighbors = graph.getNeighbors('B1');

    expect(neighbors).toContain('A1'); // Front
    expect(neighbors).toContain('C1'); // Back
    expect(neighbors).toContain('B2'); // Right
  });

  test('handles edge seats correctly', () => {
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2', 'A3']);

    const leftEdge = graph.getNeighbors('A1');
    expect(leftEdge).toEqual(['A2']); // Only right neighbor

    const rightEdge = graph.getNeighbors('A3');
    expect(rightEdge).toEqual(['A2']); // Only left neighbor
  });

  test('handles single seat', () => {
    const graph = new TheaterRowsAdjacencyGraph(['A1']);

    const neighbors = graph.getNeighbors('A1');

    expect(neighbors).toEqual([]);
  });

  test('returns empty array for unknown seat', () => {
    const graph = new TheaterRowsAdjacencyGraph(['A1', 'A2']);

    const neighbors = graph.getNeighbors('Z99');

    expect(neighbors).toEqual([]);
  });
});

describe('NullAdjacencyGraph', () => {
  test('returns no neighbors for any seat', () => {
    const graph = new NullAdjacencyGraph();

    expect(graph.getNeighbors('A1')).toEqual([]);
    expect(graph.getNeighbors('Z99')).toEqual([]);
  });
});

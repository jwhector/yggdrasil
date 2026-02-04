/**
 * Coherence Calculation Tests
 *
 * Tests cover edge cases:
 * - 100% alignment
 * - Split votes
 * - Empty factions
 * - Weighted coherence with coup multiplier
 * - Popular vote calculation
 */

import { describe, test, expect } from '@jest/globals';
import {
  calculateCoherence,
  calculateWeightedCoherence,
  calculatePopularWinner,
  getFactionBlocOption,
} from '../coherence';
import type { Vote, ShowState, FactionId, UserId } from '../types';

// Helper to create test votes
function createVote(
  userId: UserId,
  rowIndex: number,
  factionVote: string,
  personalVote: string,
  attempt: number = 0
): Vote {
  return {
    userId,
    rowIndex,
    factionVote,
    personalVote,
    timestamp: Date.now(),
    attempt,
  };
}

// Helper to create user faction map
function createUserMap(assignments: [UserId, FactionId | null][]): Map<UserId, FactionId | null> {
  return new Map(assignments);
}

describe('calculateCoherence', () => {
  test('returns 1.0 when all faction members vote for the same option', () => {
    const votes: Vote[] = [
      createVote('user1', 0, 'optionA', 'optionA'),
      createVote('user2', 0, 'optionA', 'optionB'),
      createVote('user3', 0, 'optionA', 'optionC'),
    ];
    const users = createUserMap([
      ['user1', 0],
      ['user2', 0],
      ['user3', 0],
    ]);

    const coherence = calculateCoherence(0, votes, users, 0, 0);
    expect(coherence).toBe(1.0);
  });

  test('returns 0.75 for a 6-2 split', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionA'),
      createVote('u2', 0, 'optionA', 'optionA'),
      createVote('u3', 0, 'optionA', 'optionA'),
      createVote('u4', 0, 'optionA', 'optionA'),
      createVote('u5', 0, 'optionA', 'optionA'),
      createVote('u6', 0, 'optionA', 'optionA'),
      createVote('u7', 0, 'optionB', 'optionB'),
      createVote('u8', 0, 'optionB', 'optionB'),
    ];
    const users = createUserMap([
      ['u1', 0], ['u2', 0], ['u3', 0], ['u4', 0],
      ['u5', 0], ['u6', 0], ['u7', 0], ['u8', 0],
    ]);

    const coherence = calculateCoherence(0, votes, users, 0, 0);
    expect(coherence).toBe(0.75); // 6 / 8
  });

  test('returns correct coherence for a three-way split', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionA'),
      createVote('u2', 0, 'optionA', 'optionA'),
      createVote('u3', 0, 'optionA', 'optionA'),
      createVote('u4', 0, 'optionB', 'optionB'),
      createVote('u5', 0, 'optionB', 'optionB'),
      createVote('u6', 0, 'optionC', 'optionC'),
    ];
    const users = createUserMap([
      ['u1', 1], ['u2', 1], ['u3', 1],
      ['u4', 1], ['u5', 1], ['u6', 1],
    ]);

    const coherence = calculateCoherence(1, votes, users, 0, 0);
    expect(coherence).toBe(0.5); // 3 / 6 (largest bloc)
  });

  test('returns 0 for an empty faction with no voters', () => {
    const votes: Vote[] = [];
    const users = createUserMap([]);

    const coherence = calculateCoherence(2, votes, users, 0, 0);
    expect(coherence).toBe(0);
  });

  test('returns 1.0 for a single voter', () => {
    const votes: Vote[] = [
      createVote('solo', 0, 'optionA', 'optionA'),
    ];
    const users = createUserMap([
      ['solo', 3],
    ]);

    const coherence = calculateCoherence(3, votes, users, 0, 0);
    expect(coherence).toBe(1.0);
  });

  test('filters votes by row index correctly', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionA'),
      createVote('u2', 0, 'optionA', 'optionA'),
      createVote('u3', 1, 'optionB', 'optionB'), // Different row
    ];
    const users = createUserMap([
      ['u1', 0], ['u2', 0], ['u3', 0],
    ]);

    const coherence = calculateCoherence(0, votes, users, 0, 0);
    expect(coherence).toBe(1.0); // Only row 0 votes count
  });

  test('filters votes by attempt correctly', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionA', 0),
      createVote('u2', 0, 'optionB', 'optionB', 1), // Different attempt
    ];
    const users = createUserMap([
      ['u1', 0], ['u2', 0],
    ]);

    const coherence = calculateCoherence(0, votes, users, 0, 0);
    expect(coherence).toBe(1.0); // Only attempt 0 counts
  });

  test('filters votes by faction correctly', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionA'),
      createVote('u2', 0, 'optionB', 'optionB'),
    ];
    const users = createUserMap([
      ['u1', 0],
      ['u2', 1], // Different faction
    ]);

    const coherence = calculateCoherence(0, votes, users, 0, 0);
    expect(coherence).toBe(1.0); // Only faction 0 votes count
  });
});

describe('calculateWeightedCoherence', () => {
  test('applies coup multiplier correctly', () => {
    // Create minimal show state
    const state: Partial<ShowState> = {
      currentRowIndex: 0,
      votes: [
        createVote('u1', 0, 'optionA', 'optionA'),
        createVote('u2', 0, 'optionA', 'optionA'),
        createVote('u3', 0, 'optionB', 'optionB'),
      ],
      users: new Map([
        ['u1', { id: 'u1', faction: 0, seatId: 'A1', connected: true, joinedAt: 0 }],
        ['u2', { id: 'u2', faction: 0, seatId: 'A2', connected: true, joinedAt: 0 }],
        ['u3', { id: 'u3', faction: 0, seatId: 'A3', connected: true, joinedAt: 0 }],
      ]),
      factions: [
        { id: 0, name: 'Faction 0', color: '#ff0000', coupUsed: true, coupMultiplier: 1.5, currentRowCoupVotes: new Set() },
        { id: 1, name: 'Faction 1', color: '#00ff00', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 2, name: 'Faction 2', color: '#0000ff', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 3, name: 'Faction 3', color: '#ffff00', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
      ],
      rows: [
        {
          index: 0,
          label: 'Row 0',
          type: 'layer',
          options: [{id: 'A', index: 0, audioRef: 'a'}, {id: 'B', index: 1, audioRef: 'b'}, {id: 'C', index: 2, audioRef: 'c'}, {id: 'D', index: 3, audioRef: 'd'}],
          phase: 'voting',
          committedOption: null,
          attempts: 0,
          currentAuditionIndex: null,
        },
      ],
    } as ShowState;

    const weightedCoherence = calculateWeightedCoherence(0, state as ShowState);
    // Raw coherence = 2/3, weighted = (2/3) * 1.5 = 1.0
    expect(weightedCoherence).toBeCloseTo(1.0, 5);
  });

  test('weighted coherence can exceed 1.0 with high multiplier', () => {
    const state: Partial<ShowState> = {
      currentRowIndex: 0,
      votes: [
        createVote('u1', 0, 'optionA', 'optionA'),
        createVote('u2', 0, 'optionA', 'optionA'),
        createVote('u3', 0, 'optionA', 'optionA'),
      ],
      users: new Map([
        ['u1', { id: 'u1', faction: 1, seatId: 'A1', connected: true, joinedAt: 0 }],
        ['u2', { id: 'u2', faction: 1, seatId: 'A2', connected: true, joinedAt: 0 }],
        ['u3', { id: 'u3', faction: 1, seatId: 'A3', connected: true, joinedAt: 0 }],
      ]),
      factions: [
        { id: 0, name: 'Faction 0', color: '#ff0000', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 1, name: 'Faction 1', color: '#00ff00', coupUsed: true, coupMultiplier: 1.5, currentRowCoupVotes: new Set() },
        { id: 2, name: 'Faction 2', color: '#0000ff', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
        { id: 3, name: 'Faction 3', color: '#ffff00', coupUsed: false, coupMultiplier: 1.0, currentRowCoupVotes: new Set() },
      ],
      rows: [
        {
          index: 0,
          label: 'Row 0',
          type: 'layer',
          options: [{id: 'A', index: 0, audioRef: 'a'}, {id: 'B', index: 1, audioRef: 'b'}, {id: 'C', index: 2, audioRef: 'c'}, {id: 'D', index: 3, audioRef: 'd'}],
          phase: 'voting',
          committedOption: null,
          attempts: 0,
          currentAuditionIndex: null,
        },
      ],
    } as ShowState;

    const weightedCoherence = calculateWeightedCoherence(1, state as ShowState);
    // Raw coherence = 1.0, weighted = 1.0 * 1.5 = 1.5
    expect(weightedCoherence).toBe(1.5);
  });
});

describe('calculatePopularWinner', () => {
  test('returns the option with the most personal votes', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionB'),
      createVote('u2', 0, 'optionA', 'optionB'),
      createVote('u3', 0, 'optionA', 'optionB'),
      createVote('u4', 0, 'optionC', 'optionC'),
    ];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe('optionB');
  });

  test('returns the first option alphabetically when there is a tie', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionB'),
      createVote('u2', 0, 'optionA', 'optionC'),
    ];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe('optionB'); // 'optionB' < 'optionC' alphabetically
  });

  test('returns null when there are no votes', () => {
    const votes: Vote[] = [];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe(null);
  });

  test('returns the only option when there is a single vote', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionX'),
    ];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe('optionX');
  });

  test('filters by row index correctly', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionX'),
      createVote('u2', 1, 'optionA', 'optionY'), // Different row
    ];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe('optionX');
  });

  test('filters by attempt correctly', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'optionX', 0),
      createVote('u2', 0, 'optionA', 'optionY', 1), // Different attempt
    ];

    const winner = calculatePopularWinner(votes, 0, 0);
    expect(winner).toBe('optionX');
  });
});

describe('getFactionBlocOption', () => {
  test('returns the option that the largest bloc voted for', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionA', 'any'),
      createVote('u2', 0, 'optionA', 'any'),
      createVote('u3', 0, 'optionA', 'any'),
      createVote('u4', 0, 'optionB', 'any'),
    ];
    const users = createUserMap([
      ['u1', 0], ['u2', 0], ['u3', 0], ['u4', 0],
    ]);

    const option = getFactionBlocOption(0, votes, users, 0, 0);
    expect(option).toBe('optionA');
  });

  test('returns null when faction has no votes', () => {
    const votes: Vote[] = [];
    const users = createUserMap([]);

    const option = getFactionBlocOption(0, votes, users, 0, 0);
    expect(option).toBe(null);
  });

  test('breaks ties alphabetically', () => {
    const votes: Vote[] = [
      createVote('u1', 0, 'optionC', 'any'),
      createVote('u2', 0, 'optionB', 'any'),
    ];
    const users = createUserMap([
      ['u1', 1], ['u2', 1],
    ]);

    const option = getFactionBlocOption(1, votes, users, 0, 0);
    expect(option).toBe('optionB'); // 'optionB' < 'optionC'
  });
});

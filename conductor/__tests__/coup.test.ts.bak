/**
 * Coup Mechanics Tests
 *
 * Tests cover:
 * - Successful coup at threshold
 * - Below threshold (no trigger)
 * - Faction already used coup
 * - Wrong phase (not coup_window)
 * - Multiplier applied after coup
 */

import { describe, test, expect } from '@jest/globals';
import {
  canFactionCoup,
  getCoupProgress,
  processCoupVote,
  triggerCoupManually,
  clearCoupVotesForNewRow,
  resetCoupMultipliers,
} from '../coup';
import type { ShowState, Faction, User, Row, ShowConfig } from '../types';

// Helper to create a minimal show state
function createTestState(overrides?: Partial<ShowState>): ShowState {
  const defaultState: ShowState = {
    id: 'test-show',
    version: 1,
    lastUpdated: Date.now(),
    phase: 'running',
    currentRowIndex: 0,
    rows: [
      {
        index: 0,
        label: 'Row 0',
        type: 'layer',
        options: [
          { id: 'opt0', index: 0, audioRef: 'a' },
          { id: 'opt1', index: 1, audioRef: 'b' },
          { id: 'opt2', index: 2, audioRef: 'c' },
          { id: 'opt3', index: 3, audioRef: 'd' },
        ],
        phase: 'coup_window',
        committedOption: null,
        attempts: 0,
        currentAuditionIndex: null,
      },
    ] as Row[],
    factions: [
      {
        id: 0,
        name: 'Faction 0',
        color: '#ff0000',
        coupUsed: false,
        coupMultiplier: 1.0,
        currentRowCoupVotes: new Set(),
      },
      {
        id: 1,
        name: 'Faction 1',
        color: '#00ff00',
        coupUsed: false,
        coupMultiplier: 1.0,
        currentRowCoupVotes: new Set(),
      },
      {
        id: 2,
        name: 'Faction 2',
        color: '#0000ff',
        coupUsed: false,
        coupMultiplier: 1.0,
        currentRowCoupVotes: new Set(),
      },
      {
        id: 3,
        name: 'Faction 3',
        color: '#ffff00',
        coupUsed: false,
        coupMultiplier: 1.0,
        currentRowCoupVotes: new Set(),
      },
    ],
    users: new Map(),
    votes: [],
    personalTrees: new Map(),
    paths: { factionPath: [], popularPath: [] },
    config: {
      rowCount: 7,
      factions: [],
      timing: {
        auditionLoopsPerOption: 2,
        auditionLoopsPerRow: 1,
        auditionPerOptionMs: 4000,
        votingWindowMs: 30000,
        revealDurationMs: 10000,
        coupWindowMs: 15000,
      },
      coup: {
        threshold: 0.5,
        multiplierBonus: 0.5,
      },
      lobby: {
        projectorContent: '',
        audiencePrompt: '',
      },
      rows: [],
      topology: { type: 'none' },
    } as ShowConfig,
    pausedPhase: null,
  };

  return { ...defaultState, ...overrides };
}

// Helper to add users to a faction
function addUsersToFaction(state: ShowState, factionId: number, userIds: string[]): void {
  for (const userId of userIds) {
    state.users.set(userId, {
      id: userId,
      faction: factionId,
      seatId: `seat-${userId}`,
      connected: true,
      joinedAt: Date.now(),
    } as User);
  }
}

describe('canFactionCoup', () => {
  test('returns true when faction has not used coup and phase is coup_window', () => {
    const faction: Faction = {
      id: 0,
      name: 'Test',
      color: '#fff',
      coupUsed: false,
      coupMultiplier: 1.0,
      currentRowCoupVotes: new Set(),
    };

    const result = canFactionCoup(faction, 'coup_window');
    expect(result).toBe(true);
  });

  test('returns false when faction has already used coup', () => {
    const faction: Faction = {
      id: 0,
      name: 'Test',
      color: '#fff',
      coupUsed: true,
      coupMultiplier: 1.5,
      currentRowCoupVotes: new Set(),
    };

    const result = canFactionCoup(faction, 'coup_window');
    expect(result).toBe(false);
  });

  test('returns false when phase is not coup_window', () => {
    const faction: Faction = {
      id: 0,
      name: 'Test',
      color: '#fff',
      coupUsed: false,
      coupMultiplier: 1.0,
      currentRowCoupVotes: new Set(),
    };

    expect(canFactionCoup(faction, 'voting')).toBe(false);
    expect(canFactionCoup(faction, 'revealing')).toBe(false);
    expect(canFactionCoup(faction, 'auditioning')).toBe(false);
  });
});

describe('getCoupProgress', () => {
  test('returns 0 when no faction members have voted', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2', 'u3', 'u4']);

    const progress = getCoupProgress(state.factions[0], state);
    expect(progress).toBe(0);
  });

  test('returns correct progress when some members have voted', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2', 'u3', 'u4']);
    state.factions[0].currentRowCoupVotes.add('u1');
    state.factions[0].currentRowCoupVotes.add('u2');

    const progress = getCoupProgress(state.factions[0], state);
    expect(progress).toBe(0.5); // 2/4
  });

  test('returns 1.0 when all members have voted', () => {
    const state = createTestState();
    addUsersToFaction(state, 1, ['u1', 'u2']);
    state.factions[1].currentRowCoupVotes.add('u1');
    state.factions[1].currentRowCoupVotes.add('u2');

    const progress = getCoupProgress(state.factions[1], state);
    expect(progress).toBe(1.0);
  });

  test('returns 0 when faction has no connected members', () => {
    const state = createTestState();

    const progress = getCoupProgress(state.factions[0], state);
    expect(progress).toBe(0);
  });

  test('only counts connected users', () => {
    const state = createTestState();
    state.users.set('u1', {
      id: 'u1',
      faction: 0,
      seatId: 'A1',
      connected: true,
      joinedAt: 0,
    } as User);
    state.users.set('u2', {
      id: 'u2',
      faction: 0,
      seatId: 'A2',
      connected: false, // Disconnected
      joinedAt: 0,
    } as User);
    state.factions[0].currentRowCoupVotes.add('u1');

    const progress = getCoupProgress(state.factions[0], state);
    expect(progress).toBe(1.0); // 1/1 (u2 doesn't count)
  });
});

describe('processCoupVote', () => {
  test('triggers coup when threshold is reached', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2', 'u3', 'u4']);

    // First vote (25% - below threshold)
    processCoupVote(state, 'u1');
    expect(state.factions[0].coupUsed).toBe(false);

    // Second vote (50% - at threshold)
    const events = processCoupVote(state, 'u2');

    expect(state.factions[0].coupUsed).toBe(true);
    expect(state.factions[0].coupMultiplier).toBe(1.5);
    expect(state.rows[0].attempts).toBe(1);
    expect(state.rows[0].phase).toBe('auditioning');
    expect(state.rows[0].currentAuditionIndex).toBe(0);
    expect(state.factions[0].currentRowCoupVotes.size).toBe(0); // Cleared

    // Check events
    expect(events).toContainEqual({
      type: 'COUP_TRIGGERED',
      factionId: 0,
      row: 0,
    });
    expect(events).toContainEqual({
      type: 'ROW_PHASE_CHANGED',
      row: 0,
      phase: 'auditioning',
    });
    expect(events).toContainEqual({
      type: 'AUDIO_CUE',
      cue: {
        type: 'uncommit_layer',
        rowIndex: 0,
      },
    });
  });

  test('emits COUP_METER_UPDATE event when below threshold', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2', 'u3', 'u4']);

    const events = processCoupVote(state, 'u1');

    expect(events).toContainEqual({
      type: 'COUP_METER_UPDATE',
      factionId: 0,
      progress: 0.25,
    });
    expect(state.factions[0].coupUsed).toBe(false);
  });

  test('returns empty array when faction has already used coup', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2']);
    state.factions[0].coupUsed = true;

    const events = processCoupVote(state, 'u1');

    expect(events).toEqual([]);
  });

  test('returns empty array when phase is not coup_window', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2']);
    state.rows[0].phase = 'voting';

    const events = processCoupVote(state, 'u1');

    expect(events).toEqual([]);
  });

  test('returns error when user not found', () => {
    const state = createTestState();

    const events = processCoupVote(state, 'nonexistent');

    expect(events).toContainEqual({
      type: 'ERROR',
      message: 'User not found or not assigned to faction',
    });
  });

  test('returns error when user not assigned to faction', () => {
    const state = createTestState();
    state.users.set('u1', {
      id: 'u1',
      faction: null,
      seatId: 'A1',
      connected: true,
      joinedAt: 0,
    } as User);

    const events = processCoupVote(state, 'u1');

    expect(events).toContainEqual({
      type: 'ERROR',
      message: 'User not found or not assigned to faction',
    });
  });

  test('a faction that has used their coup cannot vote to coup again', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2']);
    state.factions[0].coupUsed = true;

    const events = processCoupVote(state, 'u1');

    expect(events).toEqual([]);
    expect(state.factions[0].currentRowCoupVotes.has('u1')).toBe(false);
  });

  test('same user voting multiple times only counts once', () => {
    const state = createTestState();
    addUsersToFaction(state, 0, ['u1', 'u2', 'u3', 'u4']); // 4 users so threshold not reached

    processCoupVote(state, 'u1');
    processCoupVote(state, 'u1'); // Vote again

    expect(state.factions[0].currentRowCoupVotes.size).toBe(1);
  });
});

describe('triggerCoupManually', () => {
  test('triggers coup for a faction', () => {
    const state = createTestState();
    state.rows[0].phase = 'voting'; // Different phase

    const events = triggerCoupManually(state, 1);

    expect(state.factions[1].coupUsed).toBe(true);
    expect(state.factions[1].coupMultiplier).toBe(1.5);
    expect(state.rows[0].attempts).toBe(1);
    expect(state.rows[0].phase).toBe('auditioning');
    expect(events).toContainEqual({
      type: 'COUP_TRIGGERED',
      factionId: 1,
      row: 0,
    });
  });

  test('returns error when faction has already used coup', () => {
    const state = createTestState();
    state.factions[2].coupUsed = true;

    const events = triggerCoupManually(state, 2);

    expect(events).toContainEqual({
      type: 'ERROR',
      message: 'Faction has already used their coup',
    });
  });
});

describe('clearCoupVotesForNewRow', () => {
  test('clears coup votes for all factions', () => {
    const state = createTestState();
    state.factions[0].currentRowCoupVotes.add('u1');
    state.factions[1].currentRowCoupVotes.add('u2');
    state.factions[2].currentRowCoupVotes.add('u3');

    clearCoupVotesForNewRow(state);

    expect(state.factions[0].currentRowCoupVotes.size).toBe(0);
    expect(state.factions[1].currentRowCoupVotes.size).toBe(0);
    expect(state.factions[2].currentRowCoupVotes.size).toBe(0);
    expect(state.factions[3].currentRowCoupVotes.size).toBe(0);
  });
});

describe('resetCoupMultipliers', () => {
  test('resets coup multipliers for all factions', () => {
    const state = createTestState();
    state.factions[0].coupMultiplier = 1.5;
    state.factions[1].coupMultiplier = 1.5;
    state.factions[2].coupMultiplier = 1.0;

    resetCoupMultipliers(state);

    expect(state.factions[0].coupMultiplier).toBe(1.0);
    expect(state.factions[1].coupMultiplier).toBe(1.0);
    expect(state.factions[2].coupMultiplier).toBe(1.0);
    expect(state.factions[3].coupMultiplier).toBe(1.0);
  });
});

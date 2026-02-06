/**
 * Conductor State Machine Tests
 *
 * Tests cover:
 * - Phase transitions
 * - Vote processing
 * - Reveal logic
 * - User connection management
 * - Controller commands
 */

import { describe, test, expect } from '@jest/globals';
import { createInitialState, processCommand } from '../conductor';
import type { ShowState, ShowConfig, FactionConfig } from '../types';

// Helper to create minimal show config
function createTestConfig(): ShowConfig {
  const factions: FactionConfig[] = [
    { id: 0, name: 'Faction 0', color: '#ff0000' },
    { id: 1, name: 'Faction 1', color: '#00ff00' },
    { id: 2, name: 'Faction 2', color: '#0000ff' },
    { id: 3, name: 'Faction 3', color: '#ffff00' },
  ];

  return {
    rowCount: 3,
    factions,
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
      projectorContent: 'Welcome',
      audiencePrompt: 'What lives on your fig tree?',
    },
    rows: [
      {
        index: 0,
        label: 'Row 0',
        type: 'layer',
        options: [
          { id: 'r0-opt0', index: 0, audioRef: 'audio-0-0' },
          { id: 'r0-opt1', index: 1, audioRef: 'audio-0-1' },
          { id: 'r0-opt2', index: 2, audioRef: 'audio-0-2' },
          { id: 'r0-opt3', index: 3, audioRef: 'audio-0-3' },
        ],
      },
      {
        index: 1,
        label: 'Row 1',
        type: 'effect',
        options: [
          { id: 'r1-opt0', index: 0, audioRef: 'audio-1-0' },
          { id: 'r1-opt1', index: 1, audioRef: 'audio-1-1' },
          { id: 'r1-opt2', index: 2, audioRef: 'audio-1-2' },
          { id: 'r1-opt3', index: 3, audioRef: 'audio-1-3' },
        ],
      },
      {
        index: 2,
        label: 'Row 2',
        type: 'layer',
        options: [
          { id: 'r2-opt0', index: 0, audioRef: 'audio-2-0' },
          { id: 'r2-opt1', index: 1, audioRef: 'audio-2-1' },
          { id: 'r2-opt2', index: 2, audioRef: 'audio-2-2' },
          { id: 'r2-opt3', index: 3, audioRef: 'audio-2-3' },
        ],
      },
    ],
    topology: { type: 'none' },
  };
}

describe('createInitialState', () => {
  test('creates state in lobby phase', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show-1');

    expect(state.id).toBe('test-show-1');
    expect(state.phase).toBe('lobby');
    expect(state.version).toBe(0);
    expect(state.currentRowIndex).toBe(0);
  });

  test('creates correct number of rows', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show-1');

    expect(state.rows.length).toBe(3);
    expect(state.rows[0].label).toBe('Row 0');
    expect(state.rows[1].label).toBe('Row 1');
    expect(state.rows[2].label).toBe('Row 2');
  });

  test('creates all rows in pending phase', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show-1');

    for (const row of state.rows) {
      expect(row.phase).toBe('pending');
      expect(row.committedOption).toBe(null);
      expect(row.attempts).toBe(0);
    }
  });

  test('initializes 4 factions with default values', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show-1');

    expect(state.factions.length).toBe(4);
    for (const faction of state.factions) {
      expect(faction.coupUsed).toBe(false);
      expect(faction.coupMultiplier).toBe(1.0);
      expect(faction.currentRowCoupVotes.size).toBe(0);
    }
  });

  test('initializes empty collections', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show-1');

    expect(state.users.size).toBe(0);
    expect(state.votes.length).toBe(0);
    expect(state.personalTrees.size).toBe(0);
    expect(state.paths.factionPath.length).toBe(0);
    expect(state.paths.popularPath.length).toBe(0);
  });
});

describe('User Connection', () => {
  test('USER_CONNECT adds new user to state', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    const events = processCommand(state, {
      type: 'USER_CONNECT',
      userId: 'user1',
      seatId: 'A1',
    });

    expect(state.users.has('user1')).toBe(true);
    expect(state.users.get('user1')?.seatId).toBe('A1');
    expect(state.users.get('user1')?.faction).toBe(null);
    expect(state.users.get('user1')?.connected).toBe(true);

    expect(events).toContainEqual({
      type: 'USER_JOINED',
      userId: 'user1',
      faction: null,
    });
  });

  test('USER_CONNECT initializes personal tree', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    processCommand(state, { type: 'USER_CONNECT', userId: 'user1' });

    expect(state.personalTrees.has('user1')).toBe(true);
    expect(state.personalTrees.get('user1')?.path).toEqual([]);
    expect(state.personalTrees.get('user1')?.figTreeResponse).toBe(null);
  });

  test('USER_DISCONNECT marks user as disconnected', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    processCommand(state, { type: 'USER_CONNECT', userId: 'user1' });
    const events = processCommand(state, { type: 'USER_DISCONNECT', userId: 'user1' });

    expect(state.users.get('user1')?.connected).toBe(false);
    expect(events).toContainEqual({ type: 'USER_LEFT', userId: 'user1' });
  });

  test('USER_RECONNECT marks user as connected', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    processCommand(state, { type: 'USER_CONNECT', userId: 'user1' });
    processCommand(state, { type: 'USER_DISCONNECT', userId: 'user1' });

    const events = processCommand(state, {
      type: 'USER_RECONNECT',
      userId: 'user1',
      lastVersion: 0,
    });

    expect(state.users.get('user1')?.connected).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'USER_RECONNECTED',
        userId: 'user1',
      })
    );
  });

  test('SUBMIT_FIG_TREE_RESPONSE stores text', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    processCommand(state, { type: 'USER_CONNECT', userId: 'user1' });
    processCommand(state, {
      type: 'SUBMIT_FIG_TREE_RESPONSE',
      userId: 'user1',
      text: 'My response',
    });

    expect(state.personalTrees.get('user1')?.figTreeResponse).toBe('My response');
  });
});

describe('Faction Assignment', () => {
  test('ASSIGN_FACTIONS assigns factions to users', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    // Add users
    processCommand(state, { type: 'USER_CONNECT', userId: 'u1', seatId: 'A1' });
    processCommand(state, { type: 'USER_CONNECT', userId: 'u2', seatId: 'A2' });
    processCommand(state, { type: 'USER_CONNECT', userId: 'u3', seatId: 'A3' });
    processCommand(state, { type: 'USER_CONNECT', userId: 'u4', seatId: 'A4' });

    const events = processCommand(state, { type: 'ASSIGN_FACTIONS' });

    // All users should have factions
    expect(state.users.get('u1')?.faction).not.toBe(null);
    expect(state.users.get('u2')?.faction).not.toBe(null);
    expect(state.users.get('u3')?.faction).not.toBe(null);
    expect(state.users.get('u4')?.faction).not.toBe(null);

    expect(state.phase).toBe('assigning');

    expect(events).toContainEqual({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'assigning',
    });
  });

  test('cannot assign factions outside lobby phase', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';

    const events = processCommand(state, { type: 'ASSIGN_FACTIONS' });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'ERROR',
        message: 'Can only assign factions during lobby phase',
      })
    );
  });
});

describe('Phase Transitions', () => {
  test('START_SHOW moves from assigning to running', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'assigning';

    const events = processCommand(state, { type: 'START_SHOW' });

    expect(state.phase).toBe('running');
    expect(state.rows[0].phase).toBe('auditioning');
    expect(state.rows[0].currentAuditionIndex).toBe(0);

    expect(events).toContainEqual({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'running',
    });
    expect(events).toContainEqual({
      type: 'ROW_PHASE_CHANGED',
      row: 0,
      phase: 'auditioning',
    });
  });

  test('ADVANCE_PHASE during auditioning cycles through options', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'auditioning';
    state.rows[0].currentAuditionIndex = 0;

    // Advance through options
    let events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.rows[0].currentAuditionIndex).toBe(1);

    events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.rows[0].currentAuditionIndex).toBe(2);

    events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.rows[0].currentAuditionIndex).toBe(3);

    // Final advance should move to voting
    events = processCommand(state, { type: 'ADVANCE_PHASE' });
    expect(state.rows[0].phase).toBe('voting');
    expect(state.rows[0].currentAuditionIndex).toBe(null);
  });

  describe('Audition Loops Per Row', () => {
    test('with auditionLoopsPerRow=1, transitions to voting after 4 advances', () => {
      const config = createTestConfig();
      config.timing.auditionLoopsPerRow = 1;  // Explicit default
      const state = createInitialState(config, 'test-show');
      state.phase = 'running';
      state.rows[0].phase = 'auditioning';
      state.rows[0].currentAuditionIndex = 0;

      // Advance through all 4 options
      for (let i = 0; i < 3; i++) {
        processCommand(state, { type: 'ADVANCE_PHASE' });
        expect(state.rows[0].phase).toBe('auditioning');
      }

      processCommand(state, { type: 'ADVANCE_PHASE' });
      expect(state.rows[0].phase).toBe('voting');
    });

    test('with auditionLoopsPerRow=2, transitions to voting after 8 advances', () => {
      const config = createTestConfig();
      config.timing.auditionLoopsPerRow = 2;
      const state = createInitialState(config, 'test-show');
      state.phase = 'running';
      state.rows[0].phase = 'auditioning';
      state.rows[0].currentAuditionIndex = 0;

      // Advance through 7 steps (still in auditioning)
      for (let i = 0; i < 7; i++) {
        processCommand(state, { type: 'ADVANCE_PHASE' });
        expect(state.rows[0].phase).toBe('auditioning');
      }

      // 8th advance moves to voting
      processCommand(state, { type: 'ADVANCE_PHASE' });
      expect(state.rows[0].phase).toBe('voting');
    });

    test('AUDITION_OPTION_CHANGED always emits optionIndex 0-3', () => {
      const config = createTestConfig();
      config.timing.auditionLoopsPerRow = 2;
      const state = createInitialState(config, 'test-show');
      state.phase = 'running';
      state.rows[0].phase = 'auditioning';
      state.rows[0].currentAuditionIndex = 0;

      // Collect all option indices from events
      const optionIndices: number[] = [];
      for (let i = 0; i < 7; i++) {
        const events = processCommand(state, { type: 'ADVANCE_PHASE' });
        const optionEvent = events.find(e => e.type === 'AUDITION_OPTION_CHANGED');
        if (optionEvent && optionEvent.type === 'AUDITION_OPTION_CHANGED') {
          optionIndices.push(optionEvent.optionIndex);
        }
      }

      // Should cycle 1,2,3,0,1,2,3 (7 advances from index 0)
      expect(optionIndices).toEqual([1, 2, 3, 0, 1, 2, 3]);
    });

    test('defaults to 1 loop when auditionLoopsPerRow is not set', () => {
      const config = createTestConfig();
      delete (config.timing as any).auditionLoopsPerRow;  // Ensure not set
      const state = createInitialState(config, 'test-show');
      state.phase = 'running';
      state.rows[0].phase = 'auditioning';
      state.rows[0].currentAuditionIndex = 0;

      // Should transition after 4 advances (default behavior)
      for (let i = 0; i < 3; i++) {
        processCommand(state, { type: 'ADVANCE_PHASE' });
      }
      processCommand(state, { type: 'ADVANCE_PHASE' });
      expect(state.rows[0].phase).toBe('voting');
    });
  });

  test('ADVANCE_PHASE from voting to revealing', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.rows[0].phase).toBe('revealing');
    expect(events).toContainEqual({
      type: 'ROW_PHASE_CHANGED',
      row: 0,
      phase: 'revealing',
    });
  });

  test('ADVANCE_PHASE from revealing to coup_window', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'revealing';
    state.rows[0].committedOption = 'r0-opt0'; // Must be set during reveal

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.rows[0].phase).toBe('coup_window');
  });

  test('ADVANCE_PHASE from coup_window to committed', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'coup_window';
    state.rows[0].committedOption = 'r0-opt0';
    state.paths.popularPath.push('r0-opt0');

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.rows[0].phase).toBe('committed');
    expect(events).toContainEqual({
      type: 'ROW_COMMITTED',
      row: 0,
      optionId: 'r0-opt0',
      popularOptionId: 'r0-opt0',
    });
  });

  test('ADVANCE_PHASE from committed advances to next row', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.currentRowIndex = 0;
    state.rows[0].phase = 'committed';

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.currentRowIndex).toBe(1);
    expect(state.rows[1].phase).toBe('auditioning');
    expect(state.rows[1].currentAuditionIndex).toBe(0);
  });

  test('ADVANCE_PHASE after last row moves to finale', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.currentRowIndex = 2; // Last row
    state.rows[2].phase = 'committed';

    const events = processCommand(state, { type: 'ADVANCE_PHASE' });

    expect(state.phase).toBe('finale');
    expect(events).toContainEqual({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'finale',
    });
  });
});

describe('Vote Processing', () => {
  test('SUBMIT_VOTE stores vote for user', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    state.users.get('u1')!.faction = 0;

    const events = processCommand(state, {
      type: 'SUBMIT_VOTE',
      userId: 'u1',
      factionVote: 'r0-opt1',
      personalVote: 'r0-opt2',
    });

    expect(state.votes.length).toBe(1);
    expect(state.votes[0].userId).toBe('u1');
    expect(state.votes[0].factionVote).toBe('r0-opt1');
    expect(state.votes[0].personalVote).toBe('r0-opt2');

    expect(events).toContainEqual({
      type: 'VOTE_RECEIVED',
      userId: 'u1',
      row: 0,
    });
  });

  test('SUBMIT_VOTE updates personal tree', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    state.users.get('u1')!.faction = 0;

    processCommand(state, {
      type: 'SUBMIT_VOTE',
      userId: 'u1',
      factionVote: 'r0-opt1',
      personalVote: 'r0-opt2',
    });

    expect(state.personalTrees.get('u1')?.path[0]).toBe('r0-opt2');
  });

  test('SUBMIT_VOTE replaces previous vote from same user', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    state.users.get('u1')!.faction = 0;

    // First vote
    processCommand(state, {
      type: 'SUBMIT_VOTE',
      userId: 'u1',
      factionVote: 'r0-opt1',
      personalVote: 'r0-opt1',
    });

    // Second vote
    processCommand(state, {
      type: 'SUBMIT_VOTE',
      userId: 'u1',
      factionVote: 'r0-opt2',
      personalVote: 'r0-opt2',
    });

    // Should only have one vote
    expect(state.votes.length).toBe(1);
    expect(state.votes[0].factionVote).toBe('r0-opt2');
  });

  test('SUBMIT_VOTE returns empty array during wrong phase', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'auditioning'; // Wrong phase

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    state.users.get('u1')!.faction = 0;

    const events = processCommand(state, {
      type: 'SUBMIT_VOTE',
      userId: 'u1',
      factionVote: 'r0-opt1',
      personalVote: 'r0-opt2',
    });

    expect(events).toEqual([]);
    expect(state.votes.length).toBe(0);
  });
});

describe('Controller Commands', () => {
  test('PAUSE pauses the show', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';

    const events = processCommand(state, { type: 'PAUSE' });

    expect(state.phase).toBe('paused');
    expect(state.pausedPhase).toBe('running');
    expect(events).toContainEqual({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'paused',
    });
  });

  test('RESUME resumes the show', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'paused';
    state.pausedPhase = 'running';

    const events = processCommand(state, { type: 'RESUME' });

    expect(state.phase).toBe('running');
    expect(state.pausedPhase).toBe(null);
  });

  test('SKIP_ROW marks row as committed with default option', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    const events = processCommand(state, { type: 'SKIP_ROW' });

    expect(state.rows[0].phase).toBe('committed');
    expect(state.rows[0].committedOption).toBe('r0-opt0');
    expect(state.paths.factionPath).toContain('r0-opt0');
  });

  test('RESTART_ROW resets row to auditioning', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';
    state.rows[0].phase = 'voting';

    const events = processCommand(state, { type: 'RESTART_ROW' });

    expect(state.rows[0].phase).toBe('auditioning');
    expect(state.rows[0].currentAuditionIndex).toBe(0);
    expect(state.rows[0].attempts).toBe(1);
  });

  test('FORCE_FINALE moves directly to finale', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';

    const events = processCommand(state, { type: 'FORCE_FINALE' });

    expect(state.phase).toBe('finale');
    expect(events).toContainEqual({
      type: 'SHOW_PHASE_CHANGED',
      phase: 'finale',
    });
  });

  test('RESET_TO_LOBBY resets to lobby phase', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');
    state.phase = 'running';

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    state.users.get('u1')!.faction = 0;

    const events = processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: true });

    expect(state.phase).toBe('lobby');
    expect(state.users.has('u1')).toBe(true);
    expect(state.users.get('u1')?.faction).toBe(null);
    expect(state.votes.length).toBe(0);
  });

  test('RESET_TO_LOBBY can clear all users', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });

    processCommand(state, { type: 'RESET_TO_LOBBY', preserveUsers: false });

    expect(state.users.size).toBe(0);
    expect(state.personalTrees.size).toBe(0);
  });
});

describe('Version Tracking', () => {
  test('version increments with every command', () => {
    const config = createTestConfig();
    const state = createInitialState(config, 'test-show');

    expect(state.version).toBe(0);

    processCommand(state, { type: 'USER_CONNECT', userId: 'u1' });
    expect(state.version).toBe(1);

    processCommand(state, { type: 'USER_CONNECT', userId: 'u2' });
    expect(state.version).toBe(2);

    processCommand(state, { type: 'PAUSE' });
    expect(state.version).toBe(3);
  });
});

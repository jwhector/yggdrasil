/**
 * Live Mix Tests (V3.2)
 *
 * Tests for majority voting, recency tiebreak, lock/unlock, override/clear,
 * and initial fragment computation.
 */

import { describe, test, expect } from '@jest/globals';
import { getActiveFragment, recalculateActiveFragments, computeInitialFragments } from '../live-mix';
import { createInitialState, processCommand } from '../conductor';
import type {
  ShowState,
  ShowConfig,
  V32AttemptConfig,
  V32LayerConfig,
  V32FinaleState,
  LiveMixVote,
  GranularFragment,
  UserId,
  AttemptState,
} from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeVotes(entries: Array<[string, string, number]>): Map<UserId, LiveMixVote> {
  const votes = new Map<UserId, LiveMixVote>();
  for (const [userId, fragmentId, timestamp] of entries) {
    votes.set(userId, { fragmentId, timestamp });
  }
  return votes;
}

const LAYER_GROUPS = ['bones', 'flesh', 'spark'] as const;

function makeV32LayerConfig(index: number): V32LayerConfig {
  return {
    index,
    group: LAYER_GROUPS[index % LAYER_GROUPS.length],
    labelA: `Layer ${index} A`,
    labelB: `Layer ${index} B`,
    optionA: { tracks: [{ granularType: 'bass', trackIndices: [index * 4] }, { granularType: 'drums', trackIndices: [index * 4 + 1] }] },
    optionB: { tracks: [{ granularType: 'bass', trackIndices: [index * 4 + 2] }, { granularType: 'drums', trackIndices: [index * 4 + 3] }] },
  };
}

function makeAttemptConfig(
  chapter: 'ambition' | 'love' | 'avoidance',
): V32AttemptConfig {
  return {
    chapter,
    title: chapter.charAt(0).toUpperCase() + chapter.slice(1),
    liveSeed: { trackIndices: [99], label: 'seed' },
    layers: Array.from({ length: 3 }, (_, i) => makeV32LayerConfig(i)),
    thresholds: [0.5, 0.5, 0.5],
    tempos: [120, 120, 120],
    auditionBars: [4, 4, 4],
    auditionCycles: [1, 1, 1],
  };
}

function createTestConfig(): ShowConfig {
  return {
    layersPerAttempt: 3,
    attempts: [
      makeAttemptConfig('ambition'),
      makeAttemptConfig('love'),
      makeAttemptConfig('avoidance'),
    ],
    finale: {
      assignmentMode: 'auto',
      assignmentTimerMs: 30000,
      bothOptionsSurvive: true,
      crossSongConstraint: false,
      audioPreviewPath: '/audio/previews',
      npcMessages: [],
    },
    granularTypes: [
      { id: 'bass', label: 'Bass', color: '#000', symbol: '■' },
      { id: 'drums', label: 'Drums', color: '#000', symbol: '▲' },
    ],
    timing: {
      revealSequenceDurationMs: 5000,
      rejectionEffectDurationMs: 3000,
      loopBoundaryBeats: 32,
    },
    lobby: { waitingMessage: 'Welcome' },
    seatIds: [],
  };
}

function createTestState(): ShowState {
  return createInitialState(createTestConfig(), 'test-show');
}

function advanceToBuild(state: ShowState): void {
  processCommand(state, { type: 'ADVANCE_PHASE' }); // lobby → opener
  processCommand(state, { type: 'ADVANCE_PHASE' }); // opener → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // attempt_story → attempt_build
}

function completeSingleLayer(state: ShowState, voters: string[], choice: 'A' | 'B' = 'A'): void {
  processCommand(state, { type: 'START_AUDITION' });
  for (const userId of voters) {
    processCommand(state, { type: 'SUBMIT_VOTE', userId, choice });
  }
  processCommand(state, { type: 'CLOSE_VOTING' });
  processCommand(state, { type: 'ADVANCE_FROM_REVEAL' });
}

function completeAllLayers(state: ShowState, voters: string[]): void {
  for (let i = 0; i < 3; i++) {
    completeSingleLayer(state, voters, 'A');
  }
}

function setupFinaleWithFragments(state: ShowState, voters: string[]): void {
  // Complete attempt 0
  advanceToBuild(state);
  completeAllLayers(state, voters);
  processCommand(state, { type: 'TRIGGER_REJECTION' }); // attempt_resolve → rejection

  // Complete attempt 1
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_build
  completeAllLayers(state, voters);
  processCommand(state, { type: 'TRIGGER_REJECTION' });

  // Complete attempt 2
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_story
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → attempt_build
  completeAllLayers(state, voters);
  processCommand(state, { type: 'TRIGGER_REJECTION' });

  // Advance to finale
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_elegy
  processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_assignment
}

// ============================================================================
// getActiveFragment
// ============================================================================

describe('getActiveFragment', () => {
  test('returns null for empty votes', () => {
    expect(getActiveFragment(new Map())).toBeNull();
  });

  test('returns the only fragment when one voter', () => {
    const votes = makeVotes([['user-1', 'frag-A', 1000]]);
    expect(getActiveFragment(votes)).toBe('frag-A');
  });

  test('returns majority fragment', () => {
    const votes = makeVotes([
      ['user-1', 'frag-A', 1000],
      ['user-2', 'frag-A', 1001],
      ['user-3', 'frag-B', 1002],
    ]);
    expect(getActiveFragment(votes)).toBe('frag-A');
  });

  test('uses recency tiebreak on tie', () => {
    const votes = makeVotes([
      ['user-1', 'frag-A', 1000],
      ['user-2', 'frag-B', 2000],
    ]);
    // Tie: 1-1. user-2 voted more recently for frag-B
    expect(getActiveFragment(votes)).toBe('frag-B');
  });

  test('recency tiebreak picks latest vote among tied fragments', () => {
    const votes = makeVotes([
      ['user-1', 'frag-A', 1000],
      ['user-2', 'frag-B', 900],
      ['user-3', 'frag-C', 500],
      ['user-4', 'frag-A', 800],
      ['user-5', 'frag-B', 700],
      ['user-6', 'frag-C', 600],
    ]);
    // Tie: A=2, B=2, C=2. Most recent among all: user-1 for frag-A at 1000
    expect(getActiveFragment(votes)).toBe('frag-A');
  });

  test('a single person switching breaks a tie', () => {
    // 3 on A, 3 on B — user-6 switches from B to A most recently
    const votes = makeVotes([
      ['user-1', 'frag-A', 1000],
      ['user-2', 'frag-A', 1001],
      ['user-3', 'frag-B', 1002],
      ['user-4', 'frag-B', 1003],
      ['user-5', 'frag-A', 1004],
      ['user-6', 'frag-B', 1005],
    ]);
    // 3 vs 3 tie. Most recent vote is user-6 for frag-B at 1005
    expect(getActiveFragment(votes)).toBe('frag-B');
  });
});

// ============================================================================
// recalculateActiveFragments
// ============================================================================

describe('recalculateActiveFragments', () => {
  function makeFinaleState(overrides?: Partial<V32FinaleState>): V32FinaleState {
    return {
      phase: 'live_mix',
      availableFragments: [],
      allFragments: [],
      assignment: { mode: 'auto', groups: new Map(), timerRemaining: null },
      liveMix: {
        votes: new Map(),
        activeFragments: new Map(),
        lockedTypes: [],
        performerOverrides: new Map(),
        liveTracksActive: [],
        loopPosition: 0,
        loopCount: 0,
      },
      npc: { currentMessage: null },
      ...overrides,
    };
  }

  test('calculates active fragments from votes', () => {
    const fs = makeFinaleState();
    fs.liveMix.votes.set('bass', makeVotes([
      ['u1', 'frag-bass-A', 1000],
      ['u2', 'frag-bass-A', 1001],
      ['u3', 'frag-bass-B', 1002],
    ]));
    fs.liveMix.votes.set('drums', makeVotes([
      ['u4', 'frag-drums-B', 1000],
    ]));

    const result = recalculateActiveFragments(fs);
    expect(result.get('bass')).toBe('frag-bass-A');
    expect(result.get('drums')).toBe('frag-drums-B');
  });

  test('skips locked types, preserving current active', () => {
    const fs = makeFinaleState();
    fs.liveMix.votes.set('bass', makeVotes([
      ['u1', 'frag-bass-B', 2000], // Majority for B
    ]));
    fs.liveMix.activeFragments.set('bass', 'frag-bass-A'); // Currently A
    fs.liveMix.lockedTypes.push('bass');

    const result = recalculateActiveFragments(fs);
    expect(result.get('bass')).toBe('frag-bass-A'); // Preserved, not recalculated
  });

  test('uses performer override when set', () => {
    const fs = makeFinaleState();
    fs.liveMix.votes.set('bass', makeVotes([
      ['u1', 'frag-bass-A', 1000],
      ['u2', 'frag-bass-A', 1001],
    ]));
    fs.liveMix.performerOverrides.set('bass', 'frag-bass-B');

    const result = recalculateActiveFragments(fs);
    expect(result.get('bass')).toBe('frag-bass-B'); // Override, not vote result
  });
});

// ============================================================================
// Conductor handler integration tests
// ============================================================================

describe('Live Mix conductor handlers', () => {
  test('SET_LIVE_MIX_PREFERENCE updates votes and changes active fragment', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1', 'user-2', 'user-3'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    expect(state.finaleState!.phase).toBe('live_mix');
    expect(state.finaleState!.liveMix.activeFragments.size).toBeGreaterThan(0);

    // Find the user's assigned granular type
    let userType: string | null = null;
    for (const [gt, members] of state.finaleState!.assignment.groups) {
      if (members.includes('user-0')) { userType = gt; break; }
    }
    expect(userType).not.toBeNull();

    // With bothOptionsSurvive=true, allFragments may have more options
    const allForType = state.finaleState!.allFragments.filter(f => f.granularType === userType);

    if (allForType.length >= 2) {
      const currentActive = state.finaleState!.liveMix.activeFragments.get(userType!);
      const alternative = allForType.find(f => f.id !== currentActive);
      if (alternative) {
        // Have all users in this group switch to the alternative
        const groupMembers = state.finaleState!.assignment.groups.get(userType!) ?? [];
        let sawFragmentChange = false;
        for (const member of groupMembers) {
          const events = processCommand(state, {
            type: 'SET_LIVE_MIX_PREFERENCE',
            userId: member,
            granularType: userType!,
            fragmentId: alternative.id,
          });
          if (events.some(e => e.type === 'ACTIVE_FRAGMENT_CHANGED')) {
            sawFragmentChange = true;
          }
        }
        // After all members switch, the active fragment should be the alternative
        expect(state.finaleState!.liveMix.activeFragments.get(userType!)).toBe(alternative.id);
        // At some point during the switches, ACTIVE_FRAGMENT_CHANGED should have fired
        expect(sawFragmentChange).toBe(true);
      }
    }
  });

  test('SET_LIVE_MIX_PREFERENCE rejects wrong granular type', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    // Find a type the user is NOT assigned to
    let userType: string | null = null;
    let otherType: string | null = null;
    for (const [gt, members] of state.finaleState!.assignment.groups) {
      if (members.includes('user-0')) userType = gt;
      else if (!otherType) otherType = gt;
    }

    if (otherType) {
      const events = processCommand(state, {
        type: 'SET_LIVE_MIX_PREFERENCE',
        userId: 'user-0',
        granularType: otherType,
        fragmentId: 'any-fragment',
      });
      expect(events.some(e => e.type === 'ERROR')).toBe(true);
    }
  });

  test('SET_LIVE_MIX_PREFERENCE rejects when type is locked', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    let userType: string | null = null;
    for (const [gt, members] of state.finaleState!.assignment.groups) {
      if (members.includes('user-0')) { userType = gt; break; }
    }

    // Lock the type
    processCommand(state, { type: 'LOCK_GRANULAR_TYPE', granularType: userType! });

    const events = processCommand(state, {
      type: 'SET_LIVE_MIX_PREFERENCE',
      userId: 'user-0',
      granularType: userType!,
      fragmentId: 'any-fragment',
    });
    expect(events.some(e => e.type === 'ERROR')).toBe(true);
  });

  test('LOCK_GRANULAR_TYPE emits GRANULAR_TYPE_LOCKED', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    const events = processCommand(state, { type: 'LOCK_GRANULAR_TYPE', granularType: 'bass' });
    expect(events).toEqual([{ type: 'GRANULAR_TYPE_LOCKED', granularType: 'bass' }]);
    expect(state.finaleState!.liveMix.lockedTypes).toContain('bass');
  });

  test('UNLOCK_GRANULAR_TYPE emits GRANULAR_TYPE_UNLOCKED', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    processCommand(state, { type: 'LOCK_GRANULAR_TYPE', granularType: 'bass' });
    const events = processCommand(state, { type: 'UNLOCK_GRANULAR_TYPE', granularType: 'bass' });

    expect(events.some(e => e.type === 'GRANULAR_TYPE_UNLOCKED')).toBe(true);
    expect(state.finaleState!.liveMix.lockedTypes).not.toContain('bass');
  });

  test('OVERRIDE_FRAGMENT changes active fragment', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    const bassFragments = state.finaleState!.allFragments.filter(f => f.granularType === 'bass');
    if (bassFragments.length >= 2) {
      const currentActive = state.finaleState!.liveMix.activeFragments.get('bass');
      const other = bassFragments.find(f => f.id !== currentActive)!;

      const events = processCommand(state, {
        type: 'OVERRIDE_FRAGMENT',
        granularType: 'bass',
        fragmentId: other.id,
      });

      expect(state.finaleState!.liveMix.activeFragments.get('bass')).toBe(other.id);
      expect(state.finaleState!.liveMix.performerOverrides.get('bass')).toBe(other.id);
      expect(events.some(e => e.type === 'ACTIVE_FRAGMENT_CHANGED')).toBe(true);
    }
  });

  test('CLEAR_OVERRIDE reverts to vote-based active fragment', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    const bassFragments = state.finaleState!.allFragments.filter(f => f.granularType === 'bass');
    if (bassFragments.length >= 2) {
      const voteActive = state.finaleState!.liveMix.activeFragments.get('bass');
      const other = bassFragments.find(f => f.id !== voteActive)!;

      // Override to something else
      processCommand(state, { type: 'OVERRIDE_FRAGMENT', granularType: 'bass', fragmentId: other.id });
      expect(state.finaleState!.liveMix.activeFragments.get('bass')).toBe(other.id);

      // Clear override — should revert to vote-based result
      processCommand(state, { type: 'CLEAR_OVERRIDE', granularType: 'bass' });
      expect(state.finaleState!.liveMix.performerOverrides.has('bass')).toBe(false);
      // Active fragment should be determined by votes (initial votes were set to voteActive)
      expect(state.finaleState!.liveMix.activeFragments.get('bass')).toBe(voteActive);
    }
  });

  test('START_LIVE_MIX computes initial fragments and initializes votes', () => {
    const state = createTestState();
    const voters = ['user-0', 'user-1', 'user-2', 'user-3'];
    for (const v of voters) processCommand(state, { type: 'USER_CONNECT', userId: v });

    setupFinaleWithFragments(state, voters);
    const events = processCommand(state, { type: 'ADVANCE_PHASE' }); // → finale_live_mix

    expect(state.finaleState!.phase).toBe('live_mix');

    // Initial fragments should be set for each granular type that has fragments
    expect(state.finaleState!.liveMix.activeFragments.size).toBeGreaterThan(0);

    // Votes should be initialized for assigned users
    for (const [granularType, members] of state.finaleState!.assignment.groups) {
      const typeVotes = state.finaleState!.liveMix.votes.get(granularType);
      if (state.finaleState!.liveMix.activeFragments.has(granularType)) {
        expect(typeVotes).toBeDefined();
        for (const member of members) {
          expect(typeVotes!.has(member)).toBe(true);
        }
      }
    }

    // Should have LIVE_MIX_STARTED event with initialFragments
    const startedEvent = events.find(e => e.type === 'LIVE_MIX_STARTED');
    expect(startedEvent).toBeDefined();

    // Should have AUDIO_CUE for initial unmute
    const audioCue = events.find(e => e.type === 'AUDIO_CUE' && (e as any).cue.type === 'live_mix_start');
    expect(audioCue).toBeDefined();
  });
});

// ============================================================================
// computeInitialFragments
// ============================================================================

describe('computeInitialFragments', () => {
  test('picks fragment with highest winning proportion per type', () => {
    const fragments: GranularFragment[] = [
      { id: 'f1', songIndex: 0, layerGroupId: 'bones', granularType: 'bass', option: 'A', chapter: 'ambition', trackIndices: [0], wonVote: true, previewAudioPath: '' },
      { id: 'f2', songIndex: 1, layerGroupId: 'bones', granularType: 'bass', option: 'B', chapter: 'love', trackIndices: [1], wonVote: true, previewAudioPath: '' },
    ];

    const attempts: AttemptState[] = [
      {
        index: 0, chapter: 'ambition', layerPlan: [],
        currentLayerIndex: 0, currentLayerPhase: 'locked_in',
        layerResults: [{ layerIndex: 0, group: 'bones', status: 'locked_in', chosenOption: 'A', winningProportion: 0.7, thresholdRequired: 0.5, passed: true }],
        votes: [], status: 'completed', collapsedAtLayer: null,
        currentAuditionOption: null, auditionLoopIndex: 0, currentVoteResult: null,
      },
      {
        index: 1, chapter: 'love', layerPlan: [],
        currentLayerIndex: 0, currentLayerPhase: 'locked_in',
        layerResults: [{ layerIndex: 0, group: 'bones', status: 'locked_in', chosenOption: 'B', winningProportion: 0.9, thresholdRequired: 0.5, passed: true }],
        votes: [], status: 'completed', collapsedAtLayer: null,
        currentAuditionOption: null, auditionLoopIndex: 0, currentVoteResult: null,
      },
    ];

    const result = computeInitialFragments(fragments, attempts);
    // Song 1 had 0.9 proportion, Song 0 had 0.7 — should pick f2
    expect(result.get('bass')).toBe('f2');
  });

  test('falls back to first fragment when no vote data', () => {
    const fragments: GranularFragment[] = [
      { id: 'f1', songIndex: 0, layerGroupId: 'bones', granularType: 'bass', option: 'A', chapter: 'ambition', trackIndices: [0], wonVote: true, previewAudioPath: '' },
    ];

    const result = computeInitialFragments(fragments, []);
    expect(result.get('bass')).toBe('f1');
  });
});

import { describe, test, expect } from '@jest/globals';
import {
  initializeDeliberation,
  submitGroupVote,
  getGroupVoteCounts,
  resolveDeliberation,
  volunteerAsAmbassador,
  resolveAmbassadors,
  getAvailableFragmentsForLayer,
} from '../deliberation';
import type { Fragment, FinaleConfig, LayerType, UserId } from '../types';

const ALL_LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

function makeFinaleConfig(): FinaleConfig {
  return {
    assemblyTimerMs: 60000,
    assemblyGracePeriodMs: 15000,
    deliberationTimerMs: 120000,
    ambassadorVolunteerTimerMs: 15000,
    ceremonyLayerOrder: ['bass', 'drums', 'pad', 'melody', 'harmony', 'fx1', 'fx2'],
    audioPreviewPath: '/audio/previews',
    layerLabels: new Map(),
    npcMessages: [],
  };
}

function makeFragment(id: string, layerType: LayerType, attemptIndex = 0, layerIndex = 0): Fragment {
  return {
    id,
    attemptIndex,
    layerIndex,
    option: 'A',
    chapter: 'ambition',
    layerType,
    displayLabel: `${layerType} ${id}`,
    audioRef: { trackIndex: 0 },
    previewAudioPath: `/audio/previews/preview-${attemptIndex}-${layerIndex}-A.mp3`,
  };
}

function makeGroups(assignments: Partial<Record<LayerType, UserId[]>>): Map<LayerType, UserId[]> {
  const groups = new Map<LayerType, UserId[]>();
  for (const lt of ALL_LAYER_TYPES) {
    groups.set(lt, assignments[lt] ?? []);
  }
  return groups;
}

describe('initializeDeliberation', () => {
  test('creates empty votes and null choices for all 7 layer types', () => {
    const groups = makeGroups({});
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    expect(delib.groupVotes.size).toBe(7);
    expect(delib.chosenFragments.size).toBe(7);
    for (const lt of ALL_LAYER_TYPES) {
      expect(delib.groupVotes.get(lt)?.size).toBe(0);
      expect(delib.chosenFragments.get(lt)).toBeNull();
      expect(delib.ambassadors.get(lt)).toBeNull();
    }
    expect(delib.volunteerTimerRemaining).toBeNull();
  });

  test('sets timer from config', () => {
    const delib = initializeDeliberation(makeGroups({}), [], makeFinaleConfig());
    expect(delib.timerRemaining).toBe(120000);
  });
});

describe('getAvailableFragmentsForLayer', () => {
  test('filters fragments by layer type', () => {
    const fragments = [
      makeFragment('f1', 'melody'),
      makeFragment('f2', 'drums'),
      makeFragment('f3', 'melody'),
    ];
    const result = getAvailableFragmentsForLayer(fragments, 'melody');
    expect(result).toHaveLength(2);
    expect(result.map(f => f.id)).toContain('f1');
    expect(result.map(f => f.id)).toContain('f3');
  });

  test('returns empty array when no fragments match', () => {
    const fragments = [makeFragment('f1', 'drums')];
    expect(getAvailableFragmentsForLayer(fragments, 'melody')).toHaveLength(0);
  });
});

describe('submitGroupVote', () => {
  test('records vote for valid group member', () => {
    const groups = makeGroups({ melody: ['u1', 'u2'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    const { accepted } = submitGroupVote(delib, groups, 'u1', 'melody', 'frag-1');
    expect(accepted).toBe(true);
    expect(delib.groupVotes.get('melody')?.get('u1')).toBe('frag-1');
  });

  test('rejects vote from user not in group', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    const { accepted } = submitGroupVote(delib, groups, 'u99', 'melody', 'frag-1');
    expect(accepted).toBe(false);
  });

  test('allows changing vote', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    submitGroupVote(delib, groups, 'u1', 'melody', 'frag-1');
    submitGroupVote(delib, groups, 'u1', 'melody', 'frag-2');
    expect(delib.groupVotes.get('melody')?.get('u1')).toBe('frag-2');
  });
});

describe('getGroupVoteCounts', () => {
  test('returns correct vote distribution', () => {
    const groups = makeGroups({ melody: ['u1', 'u2', 'u3'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    submitGroupVote(delib, groups, 'u1', 'melody', 'frag-a');
    submitGroupVote(delib, groups, 'u2', 'melody', 'frag-a');
    submitGroupVote(delib, groups, 'u3', 'melody', 'frag-b');
    const counts = getGroupVoteCounts(delib, 'melody');
    expect(counts.get('frag-a')).toBe(2);
    expect(counts.get('frag-b')).toBe(1);
  });
});

describe('resolveDeliberation', () => {
  test('picks majority winner', () => {
    const groups = makeGroups({ melody: ['u1', 'u2', 'u3'] });
    const fragments = [makeFragment('f-a', 'melody'), makeFragment('f-b', 'melody')];
    const delib = initializeDeliberation(groups, fragments, makeFinaleConfig());
    submitGroupVote(delib, groups, 'u1', 'melody', 'f-a');
    submitGroupVote(delib, groups, 'u2', 'melody', 'f-a');
    submitGroupVote(delib, groups, 'u3', 'melody', 'f-b');
    resolveDeliberation(delib, groups, fragments);
    expect(delib.chosenFragments.get('melody')).toBe('f-a');
  });

  test('auto-wins single-fragment layer', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const fragments = [makeFragment('f-only', 'melody')];
    const delib = initializeDeliberation(groups, fragments, makeFinaleConfig());
    resolveDeliberation(delib, groups, fragments);
    expect(delib.chosenFragments.get('melody')).toBe('f-only');
  });

  test('returns null for empty group', () => {
    const groups = makeGroups({}); // melody has 0 members
    const fragments = [makeFragment('f-a', 'melody')];
    const delib = initializeDeliberation(groups, fragments, makeFinaleConfig());
    resolveDeliberation(delib, groups, fragments);
    expect(delib.chosenFragments.get('melody')).toBeNull();
  });

  test('breaks ties randomly (run 100x, verify not always same)', () => {
    const groups = makeGroups({ melody: ['u1', 'u2'] });
    const fragments = [makeFragment('f-a', 'melody'), makeFragment('f-b', 'melody')];
    const winners = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const delib = initializeDeliberation(groups, fragments, makeFinaleConfig());
      submitGroupVote(delib, groups, 'u1', 'melody', 'f-a');
      submitGroupVote(delib, groups, 'u2', 'melody', 'f-b');
      resolveDeliberation(delib, groups, fragments);
      winners.add(delib.chosenFragments.get('melody') ?? '');
    }

    expect(winners.size).toBeGreaterThan(1);
  });

  test('picks randomly when no votes cast', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const fragments = [makeFragment('f-a', 'melody'), makeFragment('f-b', 'melody')];
    const winners = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const delib = initializeDeliberation(groups, fragments, makeFinaleConfig());
      resolveDeliberation(delib, groups, fragments);
      winners.add(delib.chosenFragments.get('melody') ?? '');
    }

    expect(winners.size).toBeGreaterThan(1);
  });
});

describe('volunteerAsAmbassador', () => {
  test('adds user to volunteer list', () => {
    const groups = makeGroups({ melody: ['u1', 'u2'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    const { accepted } = volunteerAsAmbassador(delib, groups, 'u1', 'melody');
    expect(accepted).toBe(true);
    expect(delib.ambassadorVolunteers.get('melody')).toContain('u1');
  });

  test('rejects volunteer from user not in group', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    const { accepted } = volunteerAsAmbassador(delib, groups, 'u99', 'melody');
    expect(accepted).toBe(false);
  });

  test('does not add duplicate volunteers', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    volunteerAsAmbassador(delib, groups, 'u1', 'melody');
    volunteerAsAmbassador(delib, groups, 'u1', 'melody');
    expect(delib.ambassadorVolunteers.get('melody')).toHaveLength(1);
  });
});

describe('resolveAmbassadors', () => {
  test('selects single volunteer', () => {
    const groups = makeGroups({ melody: ['u1', 'u2'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    volunteerAsAmbassador(delib, groups, 'u1', 'melody');
    const { forfeitedLayers } = resolveAmbassadors(delib, groups);
    expect(delib.ambassadors.get('melody')).toBe('u1');
    expect(forfeitedLayers).not.toContain('melody');
  });

  test('picks randomly from multiple volunteers (run 100x, verify distribution)', () => {
    const groups = makeGroups({ melody: ['u1', 'u2', 'u3'] });
    const selected = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const delib = initializeDeliberation(groups, [], makeFinaleConfig());
      volunteerAsAmbassador(delib, groups, 'u1', 'melody');
      volunteerAsAmbassador(delib, groups, 'u2', 'melody');
      volunteerAsAmbassador(delib, groups, 'u3', 'melody');
      resolveAmbassadors(delib, groups);
      selected.add(delib.ambassadors.get('melody') ?? '');
    }

    expect(selected.size).toBeGreaterThan(1);
  });

  test('forfeits layer when 0 volunteers (group has members)', () => {
    const groups = makeGroups({ melody: ['u1', 'u2'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    // No one volunteers
    const { forfeitedLayers } = resolveAmbassadors(delib, groups);
    expect(delib.ambassadors.get('melody')).toBeNull();
    expect(forfeitedLayers).toContain('melody');
  });

  test('auto-selects single-member group as ambassador', () => {
    const groups = makeGroups({ melody: ['u1'] });
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    // u1 does NOT volunteer — should be auto-selected
    const { forfeitedLayers } = resolveAmbassadors(delib, groups);
    expect(delib.ambassadors.get('melody')).toBe('u1');
    expect(forfeitedLayers).not.toContain('melody');
  });

  test('forfeits empty group', () => {
    const groups = makeGroups({}); // melody has 0 members
    const delib = initializeDeliberation(groups, [], makeFinaleConfig());
    const { forfeitedLayers } = resolveAmbassadors(delib, groups);
    expect(delib.ambassadors.get('melody')).toBeNull();
    expect(forfeitedLayers).toContain('melody');
  });
});

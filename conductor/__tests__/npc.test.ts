import { evaluateAutoTriggers, NpcGameState } from '../npc';
import type { Fragment, LayerType, NpcTriggerConfig } from '../types';

function makeFragment(id: string, layerType: LayerType): Fragment {
  return {
    id,
    attemptIndex: 0,
    layerIndex: 0,
    option: 'A',
    chapter: 'ambition',
    layerType,
    displayLabel: `Fragment ${id}`,
    audioRef: { trackIndex: 0 },
  };
}

function makeState(overrides: Partial<NpcGameState> = {}): NpcGameState {
  return {
    consecutiveFailures: 0,
    lastConvergence: 0,
    threshold: 0.4,
    lockedRoles: new Map(),
    availableFragments: [],
    recentLockHistory: [],
    ...overrides,
  };
}

describe('evaluateAutoTriggers', () => {
  test('returns null when no triggers match', () => {
    const state = makeState();
    const configs: NpcTriggerConfig[] = [
      { condition: 'consecutive_failures', threshold: 3, message: 'failing' },
    ];
    expect(evaluateAutoTriggers(state, configs)).toBeNull();
  });

  test('returns first matching trigger message', () => {
    const state = makeState({ consecutiveFailures: 3 });
    const configs: NpcTriggerConfig[] = [
      { condition: 'consecutive_failures', threshold: 3, message: 'first match' },
      { condition: 'consecutive_failures', threshold: 2, message: 'second match' },
    ];
    expect(evaluateAutoTriggers(state, configs)).toBe('first match');
  });

  test('returns null for empty trigger list', () => {
    const state = makeState({ consecutiveFailures: 5 });
    expect(evaluateAutoTriggers(state, [])).toBeNull();
  });

  describe('consecutive_failures', () => {
    const config: NpcTriggerConfig = {
      condition: 'consecutive_failures',
      threshold: 2,
      message: "we're falling apart",
    };

    test('fires when consecutiveFailures >= threshold', () => {
      expect(evaluateAutoTriggers(makeState({ consecutiveFailures: 2 }), [config])).toBe(
        "we're falling apart",
      );
      expect(evaluateAutoTriggers(makeState({ consecutiveFailures: 5 }), [config])).toBe(
        "we're falling apart",
      );
    });

    test('does not fire when consecutiveFailures < threshold', () => {
      expect(evaluateAutoTriggers(makeState({ consecutiveFailures: 1 }), [config])).toBeNull();
    });
  });

  describe('same_song_streak', () => {
    const config: NpcTriggerConfig = {
      condition: 'same_song_streak',
      threshold: 3,
      message: 'again? we know that one works',
    };

    test('fires when last N locks are from same attempt', () => {
      const state = makeState({
        recentLockHistory: [
          { attemptIndex: 0 },
          { attemptIndex: 1 },
          { attemptIndex: 1 },
          { attemptIndex: 1 },
        ],
      });
      expect(evaluateAutoTriggers(state, [config])).toBe('again? we know that one works');
    });

    test('does not fire when locks are from different attempts', () => {
      const state = makeState({
        recentLockHistory: [{ attemptIndex: 0 }, { attemptIndex: 1 }, { attemptIndex: 2 }],
      });
      expect(evaluateAutoTriggers(state, [config])).toBeNull();
    });

    test('does not fire when history is shorter than threshold', () => {
      const state = makeState({
        recentLockHistory: [{ attemptIndex: 1 }, { attemptIndex: 1 }],
      });
      expect(evaluateAutoTriggers(state, [config])).toBeNull();
    });
  });

  describe('near_miss', () => {
    const config: NpcTriggerConfig = {
      condition: 'near_miss',
      message: "so close... you're almost there",
    };

    test('fires when convergence is just below threshold (within 5%)', () => {
      // threshold=0.4, convergence=0.36 → delta=0.04 < 0.05
      const state = makeState({ lastConvergence: 0.36, threshold: 0.4 });
      expect(evaluateAutoTriggers(state, [config])).toBe("so close... you're almost there");
    });

    test('fires at exactly threshold - 5%', () => {
      const state = makeState({ lastConvergence: 0.35, threshold: 0.4 });
      expect(evaluateAutoTriggers(state, [config])).toBe("so close... you're almost there");
    });

    test('does not fire when convergence is far below threshold', () => {
      const state = makeState({ lastConvergence: 0.1, threshold: 0.4 });
      expect(evaluateAutoTriggers(state, [config])).toBeNull();
    });

    test('does not fire when convergence meets threshold (success, not near-miss)', () => {
      const state = makeState({ lastConvergence: 0.4, threshold: 0.4 });
      expect(evaluateAutoTriggers(state, [config])).toBeNull();
    });
  });

  describe('first_success', () => {
    const config: NpcTriggerConfig = { condition: 'first_success', message: 'yes! keep going!' };

    test('fires when exactly 1 role is locked', () => {
      const lockedRoles = new Map<LayerType, string>([['melody', 'frag-1']]);
      expect(evaluateAutoTriggers(makeState({ lockedRoles }), [config])).toBe('yes! keep going!');
    });

    test('does not fire with 0 roles locked', () => {
      expect(evaluateAutoTriggers(makeState(), [config])).toBeNull();
    });

    test('does not fire with 2+ roles locked', () => {
      const lockedRoles = new Map<LayerType, string>([
        ['melody', 'frag-1'],
        ['drums', 'frag-2'],
      ]);
      expect(evaluateAutoTriggers(makeState({ lockedRoles }), [config])).toBeNull();
    });
  });

  describe('final_fragment', () => {
    const config: NpcTriggerConfig = {
      condition: 'final_fragment',
      message: 'one more. make it count.',
    };

    test('fires when 6 roles are locked (one remaining)', () => {
      const lockedRoles = new Map<LayerType, string>([
        ['melody', 'f1'],
        ['drums', 'f2'],
        ['pad', 'f3'],
        ['bass', 'f4'],
        ['harmony', 'f5'],
        ['fx1', 'f6'],
      ]);
      expect(evaluateAutoTriggers(makeState({ lockedRoles }), [config])).toBe(
        'one more. make it count.',
      );
    });

    test('does not fire with fewer than 6 roles locked', () => {
      const lockedRoles = new Map<LayerType, string>([['melody', 'f1']]);
      expect(evaluateAutoTriggers(makeState({ lockedRoles }), [config])).toBeNull();
    });
  });

  describe('single_option_role', () => {
    const config: NpcTriggerConfig = {
      condition: 'single_option_role',
      message: 'only one path forward here',
    };

    test('fires when an unlocked role has only one available fragment', () => {
      const available = [
        makeFragment('f-melody-1', 'melody'),
        makeFragment('f-drums-1', 'drums'),
        makeFragment('f-drums-2', 'drums'),
      ];
      const state = makeState({ availableFragments: available });
      expect(evaluateAutoTriggers(state, [config])).toBe('only one path forward here');
    });

    test('does not fire when all unlocked roles have multiple fragments', () => {
      const available = [
        makeFragment('f-melody-1', 'melody'),
        makeFragment('f-melody-2', 'melody'),
        makeFragment('f-drums-1', 'drums'),
        makeFragment('f-drums-2', 'drums'),
      ];
      expect(evaluateAutoTriggers(makeState({ availableFragments: available }), [config])).toBeNull();
    });

    test('ignores already-locked roles when counting', () => {
      // melody is locked, drums has only one fragment
      const available = [
        makeFragment('f-melody-1', 'melody'),
        makeFragment('f-drums-1', 'drums'),
        makeFragment('f-drums-2', 'drums'),
      ];
      const lockedRoles = new Map<LayerType, string>([['melody', 'f-melody-1']]);
      // drums has 2 fragments → no single-option role
      expect(
        evaluateAutoTriggers(makeState({ availableFragments: available, lockedRoles }), [config]),
      ).toBeNull();
    });
  });
});

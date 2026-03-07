import { calculateConvergence, resolveRound, adjustThreshold } from '../consensus-game';
import type { Fragment, LayerType } from '../types';

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

describe('calculateConvergence', () => {
  test('40 users, 16 vote for fragment X → convergence = 0.4', () => {
    const votes = new Map<string, string>();
    for (let i = 0; i < 16; i++) votes.set(`user-${i}`, 'frag-X');
    for (let i = 16; i < 40; i++) votes.set(`user-${i}`, `frag-${i}`);

    const result = calculateConvergence(votes);
    expect(result.convergence).toBeCloseTo(0.4);
    expect(result.leadingFragment).toBe('frag-X');
    expect(result.distribution.get('frag-X')).toBe(16);
  });

  test('returns convergence=0 and empty leadingFragment when no votes', () => {
    const result = calculateConvergence(new Map());
    expect(result.convergence).toBe(0);
    expect(result.leadingFragment).toBe('');
    expect(result.distribution.size).toBe(0);
  });

  test('vote changes update convergence correctly (user switches from A to B)', () => {
    const votes = new Map<string, string>();
    // 5 users vote for frag-A
    for (let i = 0; i < 5; i++) votes.set(`user-${i}`, 'frag-A');

    const before = calculateConvergence(votes);
    expect(before.convergence).toBeCloseTo(1.0);

    // user-0 switches to frag-B
    votes.set('user-0', 'frag-B');
    const after = calculateConvergence(votes);
    expect(after.convergence).toBeCloseTo(0.8); // 4/5
    expect(after.leadingFragment).toBe('frag-A');
  });

  test('distribution map counts votes per fragment', () => {
    const votes = new Map([
      ['u1', 'frag-A'],
      ['u2', 'frag-A'],
      ['u3', 'frag-B'],
    ]);
    const { distribution } = calculateConvergence(votes);
    expect(distribution.get('frag-A')).toBe(2);
    expect(distribution.get('frag-B')).toBe(1);
  });
});

describe('resolveRound', () => {
  const melody: LayerType = 'melody';
  const drums: LayerType = 'drums';

  test('round succeeds when convergence >= threshold', () => {
    const votes = new Map<string, string>();
    for (let i = 0; i < 8; i++) votes.set(`u${i}`, 'frag-melody');
    for (let i = 8; i < 10; i++) votes.set(`u${i}`, 'frag-other');

    const fragments = [makeFragment('frag-melody', melody)];
    const result = resolveRound(votes, 0.7, fragments, new Map());

    expect(result.success).toBe(true);
    expect(result.winningFragment?.id).toBe('frag-melody');
    expect(result.convergence).toBeCloseTo(0.8);
  });

  test('round fails when convergence < threshold', () => {
    const votes = new Map<string, string>();
    for (let i = 0; i < 3; i++) votes.set(`u${i}`, 'frag-melody');
    // 7 users each vote for a different fragment so no single fragment dominates
    for (let i = 3; i < 10; i++) votes.set(`u${i}`, `frag-unique-${i}`);

    const fragments = [makeFragment('frag-melody', melody)];
    const result = resolveRound(votes, 0.5, fragments, new Map());

    // Leading fragment is frag-melody with 3/10 = 0.3 < 0.5 threshold
    expect(result.success).toBe(false);
    expect(result.winningFragment).toBeUndefined();
    expect(result.convergence).toBeCloseTo(3 / 10);
  });

  test('round fails when leading fragment role is already locked', () => {
    const votes = new Map([['u1', 'frag-melody'], ['u2', 'frag-melody']]);
    const fragments = [makeFragment('frag-melody', melody)];
    const lockedRoles = new Map<LayerType, string>([[melody, 'some-other-fragment']]);

    const result = resolveRound(votes, 0.5, fragments, lockedRoles);
    expect(result.success).toBe(false);
  });

  test('round fails when leading fragment not in availableFragments', () => {
    const votes = new Map([['u1', 'frag-unknown'], ['u2', 'frag-unknown']]);
    const fragments = [makeFragment('frag-melody', melody)];

    const result = resolveRound(votes, 0.5, fragments, new Map());
    expect(result.success).toBe(false);
  });

  test('round fails when no votes', () => {
    const result = resolveRound(new Map(), 0.5, [], new Map());
    expect(result.success).toBe(false);
    expect(result.convergence).toBe(0);
  });

  test('when all 7 roles are locked, game is complete (lockedRoles.size === 7)', () => {
    const allLayerTypes: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];
    const lockedRoles = new Map<LayerType, string>(
      allLayerTypes.map(lt => [lt, `frag-${lt}`]),
    );
    expect(lockedRoles.size).toBe(7);

    // Any vote attempt on a locked role fails
    const votes = new Map([['u1', 'frag-drums']]);
    const fragments = [makeFragment('frag-drums', drums)];
    const result = resolveRound(votes, 0.5, fragments, lockedRoles);
    expect(result.success).toBe(false);
  });
});

describe('adjustThreshold', () => {
  test('threshold decreases by decay amount per consecutive failure', () => {
    expect(adjustThreshold(0.4, 1, 0.05, 0.25)).toBeCloseTo(0.35);
    expect(adjustThreshold(0.4, 2, 0.05, 0.25)).toBeCloseTo(0.30);
    expect(adjustThreshold(0.4, 3, 0.05, 0.25)).toBeCloseTo(0.25);
  });

  test('threshold never drops below minimum', () => {
    expect(adjustThreshold(0.4, 10, 0.05, 0.25)).toBeCloseTo(0.25);
    expect(adjustThreshold(0.4, 100, 0.05, 0.25)).toBeCloseTo(0.25);
  });

  test('threshold resets to initial after success (consecutiveFailures=0)', () => {
    // After success, caller passes consecutiveFailures=0 so current stays unchanged
    expect(adjustThreshold(0.4, 0, 0.05, 0.25)).toBeCloseTo(0.4);
  });

  test('zero failures does not decay', () => {
    expect(adjustThreshold(0.4, 0, 0.05, 0.25)).toBeCloseTo(0.4);
  });
});

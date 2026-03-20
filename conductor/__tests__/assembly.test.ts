import { describe, test, expect } from '@jest/globals';
import { initializeAssembly, joinGroup, assignUndecided, getGroupSizes, getEmptyGroups } from '../assembly';
import type { User, FinaleConfig, UserId } from '../types';

const ALL_LAYER_TYPES = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'] as const;

function makeUser(id: UserId, connected = true): User {
  return { id, seatId: null, connected, joinedAt: 0 };
}

function makeFinaleConfig(): FinaleConfig {
  return {
    bothOptionsSurvive: true,
    assemblyTimerMs: 60000,
    assemblyGracePeriodMs: 15000,
    deliberationTimerMs: 120000,
    ambassadorVolunteerTimerMs: 15000,
    ceremonyLayerOrder: ['bass', 'drums', 'pad', 'melody', 'harmony', 'fx'],
    audioPreviewPath: '/audio/previews',
    layerLabels: new Map([
      ['melody', 'The Voice'],
      ['drums', 'The Heartbeat'],
      ['pad', 'The Warmth'],
      ['bass', 'The Ground'],
      ['harmony', 'The Color'],
      ['fx', 'The Shimmer'],
    ]),
    npcMessages: [],
  };
}

describe('initializeAssembly', () => {
  test('puts all connected users in undecidedUsers', () => {
    const users = new Map([
      ['u1', makeUser('u1')],
      ['u2', makeUser('u2')],
      ['u3', makeUser('u3')],
    ]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    expect(assembly.undecidedUsers).toHaveLength(3);
    expect(assembly.undecidedUsers).toContain('u1');
    expect(assembly.undecidedUsers).toContain('u2');
    expect(assembly.undecidedUsers).toContain('u3');
  });

  test('excludes disconnected users from undecidedUsers', () => {
    const users = new Map([
      ['u1', makeUser('u1', true)],
      ['u2', makeUser('u2', false)],
    ]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    expect(assembly.undecidedUsers).toHaveLength(1);
    expect(assembly.undecidedUsers).toContain('u1');
    expect(assembly.undecidedUsers).not.toContain('u2');
  });

  test('creates empty groups for all 6 layer types', () => {
    const users = new Map();
    const assembly = initializeAssembly(users, makeFinaleConfig());
    expect(assembly.groups.size).toBe(6);
    for (const layerType of ALL_LAYER_TYPES) {
      expect(assembly.groups.get(layerType)).toEqual([]);
    }
  });

  test('sets timer from config', () => {
    const users = new Map();
    const config = makeFinaleConfig();
    config.assemblyTimerMs = 45000;
    const assembly = initializeAssembly(users, config);
    expect(assembly.timerRemaining).toBe(45000);
    expect(assembly.timerDuration).toBe(45000);
  });
});

describe('joinGroup', () => {
  test('moves user from undecided to group', () => {
    const users = new Map([['u1', makeUser('u1')]]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    joinGroup(assembly, 'u1', 'melody');
    expect(assembly.undecidedUsers).not.toContain('u1');
    expect(assembly.groups.get('melody')).toContain('u1');
  });

  test('moves user from one group to another', () => {
    const users = new Map([['u1', makeUser('u1')]]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    joinGroup(assembly, 'u1', 'melody');
    joinGroup(assembly, 'u1', 'drums');
    expect(assembly.groups.get('melody')).not.toContain('u1');
    expect(assembly.groups.get('drums')).toContain('u1');
  });

  test('user appears in exactly one group', () => {
    const users = new Map([['u1', makeUser('u1')]]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    joinGroup(assembly, 'u1', 'bass');
    let count = 0;
    for (const members of assembly.groups.values()) {
      if (members.includes('u1')) count++;
    }
    expect(count).toBe(1);
    expect(assembly.undecidedUsers).not.toContain('u1');
  });
});

describe('assignUndecided', () => {
  test('moves all undecided users to groups', () => {
    const users = new Map([
      ['u1', makeUser('u1')],
      ['u2', makeUser('u2')],
      ['u3', makeUser('u3')],
    ]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    assignUndecided(assembly);
    expect(assembly.undecidedUsers).toHaveLength(0);
    let totalInGroups = 0;
    for (const members of assembly.groups.values()) {
      totalInGroups += members.length;
    }
    expect(totalInGroups).toBe(3);
  });

  test('with 0 undecided users is a no-op', () => {
    const users = new Map();
    const assembly = initializeAssembly(users, makeFinaleConfig());
    assignUndecided(assembly);
    expect(assembly.undecidedUsers).toHaveLength(0);
    let totalInGroups = 0;
    for (const members of assembly.groups.values()) {
      totalInGroups += members.length;
    }
    expect(totalInGroups).toBe(0);
  });

  test('distributes users across groups (run 100x, verify variation)', () => {
    const userIds = Array.from({ length: 35 }, (_, i) => `u${i}`);
    const groupCounts = new Map<string, number>();
    for (const lt of ALL_LAYER_TYPES) groupCounts.set(lt, 0);

    for (let run = 0; run < 100; run++) {
      const users = new Map(userIds.map(id => [id, makeUser(id)]));
      const assembly = initializeAssembly(users, makeFinaleConfig());
      assignUndecided(assembly);
      for (const [lt, members] of assembly.groups) {
        groupCounts.set(lt, (groupCounts.get(lt) ?? 0) + members.length);
      }
    }

    // Each group should have received at least some users across 100 runs
    for (const [, count] of groupCounts) {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('disconnected users are not randomly assigned', () => {
    const users = new Map([
      ['u1', makeUser('u1', true)],
      ['u2', makeUser('u2', false)],
    ]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    assignUndecided(assembly);
    // u2 was never in undecidedUsers, so should not appear in any group
    for (const members of assembly.groups.values()) {
      expect(members).not.toContain('u2');
    }
  });
});

describe('getGroupSizes', () => {
  test('returns correct sizes', () => {
    const users = new Map([
      ['u1', makeUser('u1')],
      ['u2', makeUser('u2')],
    ]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    joinGroup(assembly, 'u1', 'melody');
    joinGroup(assembly, 'u2', 'melody');
    const sizes = getGroupSizes(assembly);
    expect(sizes.get('melody')).toBe(2);
    expect(sizes.get('drums')).toBe(0);
  });
});

describe('getEmptyGroups', () => {
  test('returns all groups when no users joined', () => {
    const users = new Map();
    const assembly = initializeAssembly(users, makeFinaleConfig());
    const empty = getEmptyGroups(assembly);
    expect(empty).toHaveLength(6);
  });

  test('excludes groups with members', () => {
    const users = new Map([['u1', makeUser('u1')]]);
    const assembly = initializeAssembly(users, makeFinaleConfig());
    joinGroup(assembly, 'u1', 'melody');
    const empty = getEmptyGroups(assembly);
    expect(empty).not.toContain('melody');
    expect(empty).toHaveLength(5);
  });
});

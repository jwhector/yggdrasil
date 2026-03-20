import { describe, test, expect } from '@jest/globals';
import {
  initializeCeremony,
  callNextAmbassador,
  processAltarLockIn,
  isCeremonyComplete,
  forceLockIn,
  forfeitLayer,
  skipToLayer,
} from '../ceremony';
import type { LayerType } from '../types';

const LAYER_ORDER: LayerType[] = ['bass', 'drums', 'pad', 'melody', 'harmony', 'fx'];

function makeChosenFragments(entries: Partial<Record<LayerType, string | null>> = {}): Map<LayerType, string | null> {
  const map = new Map<LayerType, string | null>();
  for (const lt of LAYER_ORDER) {
    map.set(lt, entries[lt] ?? `frag-${lt}`);
  }
  return map;
}

function makeAmbassadors(entries: Partial<Record<LayerType, string | null>> = {}): Map<LayerType, string | null> {
  const map = new Map<LayerType, string | null>();
  for (const lt of LAYER_ORDER) {
    map.set(lt, entries[lt] ?? `ambassador-${lt}`);
  }
  return map;
}

describe('initializeCeremony', () => {
  test('starts with currentIndex -1 and empty lockedLayers', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    expect(ceremony.currentIndex).toBe(-1);
    expect(ceremony.lockedLayers.size).toBe(0);
    expect(ceremony.currentAmbassador).toBeNull();
    expect(ceremony.ceremonyComplete).toBe(false);
  });

  test('stores forfeited layers', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), ['fx']);
    expect(ceremony.forfeitedLayers).toContain('fx');
  });
});

describe('callNextAmbassador', () => {
  test('advances to first layer on initial call', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    const ambassadors = makeAmbassadors();
    const { layerType, ambassador, skipped } = callNextAmbassador(ceremony, ambassadors);
    expect(layerType).toBe('bass');
    expect(ambassador).toBe('ambassador-bass');
    expect(skipped).toHaveLength(0);
    expect(ceremony.currentIndex).toBe(0);
  });

  test('skips forfeited layers and reports them', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), ['bass', 'drums']);
    const ambassadors = makeAmbassadors();
    const { layerType, skipped } = callNextAmbassador(ceremony, ambassadors);
    expect(layerType).toBe('pad');
    expect(skipped).toContain('bass');
    expect(skipped).toContain('drums');
  });

  test('returns null layerType when all remaining layers are forfeited', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), LAYER_ORDER);
    const ambassadors = makeAmbassadors();
    const { layerType, skipped } = callNextAmbassador(ceremony, ambassadors);
    expect(layerType).toBeNull();
    expect(skipped).toHaveLength(LAYER_ORDER.length);
  });

  test('advances sequentially through layers', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    const ambassadors = makeAmbassadors();
    const { layerType: lt1 } = callNextAmbassador(ceremony, ambassadors);
    const { layerType: lt2 } = callNextAmbassador(ceremony, ambassadors);
    expect(lt1).toBe('bass');
    expect(lt2).toBe('drums');
  });
});

describe('processAltarLockIn', () => {
  test('accepts valid ambassador and layerType', () => {
    const chosenFragments = makeChosenFragments({ bass: 'frag-bass' });
    const ambassadors = makeAmbassadors({ bass: 'ambassador-bass' });
    const ceremony = initializeCeremony(LAYER_ORDER, chosenFragments, ambassadors, []);
    callNextAmbassador(ceremony, ambassadors); // currentIndex → 0 (bass)

    const { accepted, fragmentId } = processAltarLockIn(ceremony, chosenFragments, 'ambassador-bass', 'bass');
    expect(accepted).toBe(true);
    expect(fragmentId).toBe('frag-bass');
    expect(ceremony.lockedLayers.get('bass')).toBe('frag-bass');
  });

  test('rejects wrong ambassador', () => {
    const chosenFragments = makeChosenFragments({ bass: 'frag-bass' });
    const ambassadors = makeAmbassadors({ bass: 'ambassador-bass' });
    const ceremony = initializeCeremony(LAYER_ORDER, chosenFragments, ambassadors, []);
    callNextAmbassador(ceremony, ambassadors);

    const { accepted } = processAltarLockIn(ceremony, chosenFragments, 'wrong-user', 'bass');
    expect(accepted).toBe(false);
    expect(ceremony.lockedLayers.has('bass')).toBe(false);
  });

  test('rejects wrong layerType', () => {
    const chosenFragments = makeChosenFragments();
    const ambassadors = makeAmbassadors();
    const ceremony = initializeCeremony(LAYER_ORDER, chosenFragments, ambassadors, []);
    callNextAmbassador(ceremony, ambassadors); // current layer is 'bass'

    const { accepted } = processAltarLockIn(ceremony, chosenFragments, 'ambassador-drums', 'drums');
    expect(accepted).toBe(false);
  });
});

describe('isCeremonyComplete', () => {
  test('returns false when layers not yet locked', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    expect(isCeremonyComplete(ceremony)).toBe(false);
  });

  test('returns true when all non-forfeited layers are locked', () => {
    const forfeited: LayerType[] = ['fx'];
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), forfeited);
    // Lock all non-forfeited layers
    for (const lt of LAYER_ORDER) {
      if (!forfeited.includes(lt)) {
        ceremony.lockedLayers.set(lt, `frag-${lt}`);
      }
    }
    expect(isCeremonyComplete(ceremony)).toBe(true);
  });

  test('returns false if even one non-forfeited layer is unlocked', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    for (const lt of LAYER_ORDER.slice(0, 5)) {
      ceremony.lockedLayers.set(lt, `frag-${lt}`);
    }
    // 'fx' not locked
    expect(isCeremonyComplete(ceremony)).toBe(false);
  });
});

describe('forceLockIn', () => {
  test('locks current layer without ambassador validation', () => {
    const chosenFragments = makeChosenFragments({ bass: 'frag-bass' });
    const ceremony = initializeCeremony(LAYER_ORDER, chosenFragments, makeAmbassadors(), []);
    callNextAmbassador(ceremony, makeAmbassadors());
    const { fragmentId } = forceLockIn(ceremony, chosenFragments, 'bass');
    expect(fragmentId).toBe('frag-bass');
    expect(ceremony.lockedLayers.get('bass')).toBe('frag-bass');
  });
});

describe('forfeitLayer', () => {
  test('adds layer to forfeitedLayers', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    forfeitLayer(ceremony, 'melody');
    expect(ceremony.forfeitedLayers).toContain('melody');
  });

  test('does not duplicate if already forfeited', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), ['melody']);
    forfeitLayer(ceremony, 'melody');
    expect(ceremony.forfeitedLayers.filter(lt => lt === 'melody')).toHaveLength(1);
  });

  test('does not auto-advance currentIndex', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    callNextAmbassador(ceremony, makeAmbassadors()); // at bass (index 0)
    forfeitLayer(ceremony, 'bass');
    expect(ceremony.currentIndex).toBe(0); // not auto-advanced
  });
});

describe('skipToLayer', () => {
  test('jumps currentIndex to target layer', () => {
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), makeAmbassadors(), []);
    skipToLayer(ceremony, 'harmony');
    expect(ceremony.currentIndex).toBe(LAYER_ORDER.indexOf('harmony'));
  });

  test('resets currentAmbassador and altarReady', () => {
    const ambassadors = makeAmbassadors();
    const ceremony = initializeCeremony(LAYER_ORDER, makeChosenFragments(), ambassadors, []);
    callNextAmbassador(ceremony, ambassadors);
    skipToLayer(ceremony, 'fx');
    expect(ceremony.currentAmbassador).toBeNull();
    expect(ceremony.altarReady).toBe(false);
  });
});

import { queueChange, cancelPending, firePendingChanges } from '../performer-mix';
import type { LayerType, PendingChange } from '../types';

const melody: LayerType = 'melody';
const drums: LayerType = 'drums';
const pad: LayerType = 'pad';

describe('queueChange', () => {
  test('queuing a fragment adds it to pending', () => {
    const result = queueChange([], melody, 'frag-A');
    expect(result).toHaveLength(1);
    expect(result[0].layerType).toBe(melody);
    expect(result[0].fragmentId).toBe('frag-A');
  });

  test('queuing null queues a mute', () => {
    const result = queueChange([], melody, null);
    expect(result).toHaveLength(1);
    expect(result[0].fragmentId).toBeNull();
  });

  test('queuing for a layer with an existing pending change replaces it', () => {
    const initial = queueChange([], melody, 'frag-A');
    const updated = queueChange(initial, melody, 'frag-B');
    expect(updated).toHaveLength(1);
    expect(updated[0].fragmentId).toBe('frag-B');
  });

  test('queuing different layers adds separate entries', () => {
    const p1 = queueChange([], melody, 'frag-A');
    const p2 = queueChange(p1, drums, 'frag-B');
    expect(p2).toHaveLength(2);
    expect(p2.find(p => p.layerType === melody)?.fragmentId).toBe('frag-A');
    expect(p2.find(p => p.layerType === drums)?.fragmentId).toBe('frag-B');
  });
});

describe('cancelPending', () => {
  test('cancel removes pending for that layer', () => {
    const pending = queueChange([], melody, 'frag-A');
    const result = cancelPending(pending, melody);
    expect(result).toHaveLength(0);
  });

  test('cancel does not affect other layers', () => {
    let pending = queueChange([], melody, 'frag-A');
    pending = queueChange(pending, drums, 'frag-B');
    const result = cancelPending(pending, melody);
    expect(result).toHaveLength(1);
    expect(result[0].layerType).toBe(drums);
  });

  test('cancel on non-existent layer returns unchanged array', () => {
    const pending = queueChange([], melody, 'frag-A');
    const result = cancelPending(pending, drums);
    expect(result).toHaveLength(1);
    expect(result[0].layerType).toBe(melody);
  });
});

describe('firePendingChanges', () => {
  test('fire applies all pending and returns firedChanges', () => {
    let pending: PendingChange[] = [];
    pending = queueChange(pending, melody, 'frag-melody');
    pending = queueChange(pending, drums, 'frag-drums');

    const activeLayers = new Map<LayerType, string | null>();
    const { activeLayers: updated, firedChanges } = firePendingChanges(activeLayers, pending);

    expect(updated.get(melody)).toBe('frag-melody');
    expect(updated.get(drums)).toBe('frag-drums');
    expect(firedChanges).toHaveLength(2);
  });

  test('only one fragment active per layer after firing', () => {
    // Start with melody active
    const activeLayers = new Map<LayerType, string | null>([[melody, 'frag-old']]);
    const pending = queueChange([], melody, 'frag-new');

    const { activeLayers: updated } = firePendingChanges(activeLayers, pending);
    expect(updated.get(melody)).toBe('frag-new');
    expect(updated.size).toBe(1);
  });

  test('firing with null mutes the layer', () => {
    const activeLayers = new Map<LayerType, string | null>([[melody, 'frag-A']]);
    const pending = queueChange([], melody, null);

    const { activeLayers: updated } = firePendingChanges(activeLayers, pending);
    expect(updated.get(melody)).toBeNull();
  });

  test('fire with empty pending returns unchanged activeLayers and empty firedChanges', () => {
    const activeLayers = new Map<LayerType, string | null>([[melody, 'frag-A']]);
    const { activeLayers: updated, firedChanges } = firePendingChanges(activeLayers, []);

    expect(updated.get(melody)).toBe('frag-A');
    expect(firedChanges).toHaveLength(0);
  });

  test('fire does not mutate original activeLayers', () => {
    const activeLayers = new Map<LayerType, string | null>([[melody, 'frag-old']]);
    const pending = queueChange([], melody, 'frag-new');

    firePendingChanges(activeLayers, pending);
    expect(activeLayers.get(melody)).toBe('frag-old'); // unchanged
  });

  test('multiple layers fire simultaneously', () => {
    let pending: PendingChange[] = [];
    pending = queueChange(pending, melody, 'frag-melody');
    pending = queueChange(pending, drums, null);
    pending = queueChange(pending, pad, 'frag-pad');

    const activeLayers = new Map<LayerType, string | null>();
    const { activeLayers: updated } = firePendingChanges(activeLayers, pending);

    expect(updated.get(melody)).toBe('frag-melody');
    expect(updated.get(drums)).toBeNull();
    expect(updated.get(pad)).toBe('frag-pad');
  });
});

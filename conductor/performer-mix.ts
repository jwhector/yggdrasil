/**
 * Performer Mix — Pending Changes Queue
 *
 * Pure functions for the performer mixing surface. Changes are queued and fire
 * simultaneously at the next loop boundary. Null fragmentId = mute that layer.
 */

import type { LayerType, PendingChange } from './types';

/**
 * Queue a fragment change for a layer. If a pending change already exists
 * for this layerType, it is replaced.
 */
export function queueChange(
  pending: PendingChange[],
  layerType: LayerType,
  fragmentId: string | null,
): PendingChange[] {
  const filtered = pending.filter(p => p.layerType !== layerType);
  return [...filtered, { layerType, fragmentId, queuedAt: Date.now() }];
}

/**
 * Cancel the pending change for a layer. Returns array unchanged if no
 * pending change exists for that layerType.
 */
export function cancelPending(
  pending: PendingChange[],
  layerType: LayerType,
): PendingChange[] {
  return pending.filter(p => p.layerType !== layerType);
}

/**
 * Apply all pending changes to activeLayers, clearing the pending queue.
 * Returns the updated activeLayers map and the list of changes that fired.
 */
export function firePendingChanges(
  activeLayers: Map<LayerType, string | null>,
  pending: PendingChange[],
): {
  activeLayers: Map<LayerType, string | null>;
  firedChanges: PendingChange[];
} {
  const updated = new Map(activeLayers);
  for (const change of pending) {
    updated.set(change.layerType, change.fragmentId);
  }
  return { activeLayers: updated, firedChanges: [...pending] };
}

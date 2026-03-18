/**
 * Ceremony — Ambassador Lock-In Sequence
 *
 * Handles the finale ceremony phase where ambassadors lock fragments at the
 * altar via accelerometer. Sequential, no going backwards. Pure functions, no I/O.
 */

import type { LayerType, UserId, FinaleState } from './types';

/**
 * Set up ceremony state from layer order, chosen fragments, ambassadors, and forfeited layers.
 * currentIndex starts at -1; callNextAmbassador advances to the first layer.
 */
export function initializeCeremony(
  layerOrder: LayerType[],
  chosenFragments: Map<LayerType, string | null>,
  ambassadors: Map<LayerType, UserId | null>,
  forfeitedLayers: LayerType[],
): FinaleState['ceremony'] {
  return {
    layerOrder,
    currentIndex: -1,
    currentAmbassador: null,
    altarReady: false,
    lockedLayers: new Map(),
    forfeitedLayers: [...forfeitedLayers],
    ceremonyComplete: false,
  };
}

/**
 * Advance to the next non-forfeited layer and set the current ambassador.
 * Returns the layer and ambassador being called, plus any skipped layers.
 * Returns layerType: null if all remaining layers are forfeited or done.
 */
export function callNextAmbassador(
  ceremony: FinaleState['ceremony'],
  ambassadors: Map<LayerType, UserId | null>,
): {
  ceremony: FinaleState['ceremony'];
  layerType: LayerType | null;
  ambassador: UserId | null;
  skipped: LayerType[];
} {
  const skipped: LayerType[] = [];
  let nextIndex = ceremony.currentIndex + 1;

  while (nextIndex < ceremony.layerOrder.length) {
    const layerType = ceremony.layerOrder[nextIndex];
    if (ceremony.forfeitedLayers.includes(layerType)) {
      skipped.push(layerType);
      nextIndex++;
    } else {
      // Found a non-forfeited layer
      ceremony.currentIndex = nextIndex;
      ceremony.currentAmbassador = ambassadors.get(layerType) ?? null;
      ceremony.altarReady = false;
      return { ceremony, layerType, ambassador: ceremony.currentAmbassador, skipped };
    }
  }

  // All remaining layers exhausted or forfeited
  ceremony.currentIndex = nextIndex;
  ceremony.currentAmbassador = null;
  return { ceremony, layerType: null, ambassador: null, skipped };
}

/**
 * Validate and process altar lock-in from the correct ambassador.
 * Validates userId matches currentAmbassador AND layerType matches current layer.
 */
export function processAltarLockIn(
  ceremony: FinaleState['ceremony'],
  chosenFragments: Map<LayerType, string | null>,
  userId: UserId,
  layerType: LayerType,
): { ceremony: FinaleState['ceremony']; accepted: boolean; fragmentId: string | null } {
  const currentLayerType = ceremony.layerOrder[ceremony.currentIndex];

  if (layerType !== currentLayerType) {
    return { ceremony, accepted: false, fragmentId: null };
  }

  if (userId !== ceremony.currentAmbassador) {
    return { ceremony, accepted: false, fragmentId: null };
  }

  const fragmentId = chosenFragments.get(layerType) ?? null;
  if (fragmentId) {
    ceremony.lockedLayers.set(layerType, fragmentId);
  }
  ceremony.altarReady = true;

  return { ceremony, accepted: true, fragmentId };
}

/**
 * Check if all non-forfeited layers are locked.
 */
export function isCeremonyComplete(
  ceremony: FinaleState['ceremony'],
): boolean {
  for (const layerType of ceremony.layerOrder) {
    if (!ceremony.forfeitedLayers.includes(layerType) && !ceremony.lockedLayers.has(layerType)) {
      return false;
    }
  }
  return true;
}

/**
 * Controller override: force lock-in for the current layer without altar.
 */
export function forceLockIn(
  ceremony: FinaleState['ceremony'],
  chosenFragments: Map<LayerType, string | null>,
  layerType: LayerType,
): { ceremony: FinaleState['ceremony']; fragmentId: string | null } {
  const fragmentId = chosenFragments.get(layerType) ?? null;
  if (fragmentId) {
    ceremony.lockedLayers.set(layerType, fragmentId);
  }
  return { ceremony, fragmentId };
}

/**
 * Mark a layer as forfeited mid-ceremony.
 * Does not auto-advance; conductor must call callNextAmbassador.
 */
export function forfeitLayer(
  ceremony: FinaleState['ceremony'],
  layerType: LayerType,
): FinaleState['ceremony'] {
  if (!ceremony.forfeitedLayers.includes(layerType)) {
    ceremony.forfeitedLayers.push(layerType);
  }
  return ceremony;
}

/**
 * Controller override: jump to a specific layer in the order.
 */
export function skipToLayer(
  ceremony: FinaleState['ceremony'],
  layerType: LayerType,
): FinaleState['ceremony'] {
  const idx = ceremony.layerOrder.indexOf(layerType);
  if (idx !== -1) {
    ceremony.currentIndex = idx;
    ceremony.currentAmbassador = null;
    ceremony.altarReady = false;
  }
  return ceremony;
}

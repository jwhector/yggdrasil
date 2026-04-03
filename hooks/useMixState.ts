/**
 * useMixState — Resolves mix_state socket events into chapter colors per node.
 *
 * Subscribes to high-frequency mix_state events (~4 Hz) during finale_live_mix,
 * maps active fragment IDs to their chapter names via the fragment metadata,
 * and returns a stable MixStateInput for the projector canvas.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { GranularFragment, ProjectorFinaleView } from '@/conductor/types';
import type { MixStateInput } from '@/components/projector/useProjectorState';

interface MixStatePayload {
  activeFragments: Array<{ granularType: string; fragmentId: string }>;
  voteDistributions: Array<{ granularType: string; votes: Array<{ fragmentId: string; count: number }> }>;
  lockedTypes: string[];
  loopPosition: number;
}

export function useMixState(
  socket: Socket | null,
  finaleState: ProjectorFinaleView | null,
): MixStateInput | null {
  const [mixPayload, setMixPayload] = useState<MixStatePayload | null>(null);

  // Build fragment lookup from allFragments (stable across mix_state updates)
  const fragmentMap = useMemo(() => {
    if (!finaleState) return null;
    const map = new Map<string, GranularFragment>();
    for (const f of finaleState.allFragments) {
      map.set(f.id, f);
    }
    return map;
  }, [finaleState]);

  // Subscribe to mix_state socket events
  useEffect(() => {
    if (!socket) return;
    const handler = (data: MixStatePayload) => setMixPayload(data);
    socket.on('mix_state', handler);
    return () => { socket.off('mix_state', handler); };
  }, [socket]);

  // Resolve fragment IDs → chapter names
  return useMemo(() => {
    if (!fragmentMap) return null;

    // Use mix_state data if available, fall back to finaleState
    const activeFragments = mixPayload?.activeFragments ?? finaleState?.activeFragments;
    const loopPosition = mixPayload?.loopPosition ?? finaleState?.loopPosition ?? 0;

    if (!activeFragments) return null;

    const nodeChapters: Record<string, string> = {};
    for (const { granularType, fragmentId } of activeFragments) {
      const fragment = fragmentMap.get(fragmentId);
      if (fragment) {
        nodeChapters[granularType] = fragment.chapter;
      }
    }

    return { nodeChapters, loopPosition };
  }, [fragmentMap, mixPayload, finaleState]);
}

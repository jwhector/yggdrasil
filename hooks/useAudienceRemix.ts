/**
 * useAudienceRemix Hook (V3.4 — Swarm Orbs)
 *
 * Manages audience-side orb state during finale_remix.
 * Subscribes to node_tally, orb_decayed, and scatter socket events.
 * Provides place/recall actions via socket emit.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudienceOrb } from '@/conductor/types';

export interface NodeTally {
  granularType: string;
  votes: Array<{ chapterId: string; count: number }>;
  dominantChapter: string | null;
  locked: boolean;
}

export interface UseAudienceRemixReturn {
  orbs: AudienceOrb[];
  tallies: NodeTally[];
  placeOrb: (orbIndex: number, granularType: string) => void;
  recallOrb: (orbIndex: number) => void;
}

export function useAudienceRemix(
  socket: Socket | null,
  initialOrbs: AudienceOrb[],
  initialTallies: NodeTally[],
): UseAudienceRemixReturn {
  const [orbs, setOrbs] = useState<AudienceOrb[]>(initialOrbs);
  const [tallies, setTallies] = useState<NodeTally[]>(initialTallies);

  // Sync from props when state_sync arrives with new data
  const prevInitialRef = useRef(initialOrbs);
  useEffect(() => {
    if (initialOrbs !== prevInitialRef.current) {
      prevInitialRef.current = initialOrbs;
      setOrbs(initialOrbs);
    }
  }, [initialOrbs]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleTally = (data: { tallies: NodeTally[] }) => {
      setTallies(data.tallies);
    };

    const handleDecayed = (data: { orbIndex: number }) => {
      setOrbs(prev => prev.map((orb, i) =>
        i === data.orbIndex ? { ...orb, placedOnNode: null, placedAtLoop: 0 } : orb
      ));
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(50);
    };

    const handleScatter = (_data: { granularType: string | null }) => {
      // Server has already updated state; next state_sync will reconcile.
      // Optimistically return all orbs to hand for immediate feedback.
      setOrbs(prev => prev.map(orb => ({ ...orb, placedOnNode: null, placedAtLoop: 0 })));
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    };

    socket.on('node_tally', handleTally);
    socket.on('orb_decayed', handleDecayed);
    socket.on('scatter', handleScatter);

    return () => {
      socket.off('node_tally', handleTally);
      socket.off('orb_decayed', handleDecayed);
      socket.off('scatter', handleScatter);
    };
  }, [socket]);

  const placeOrb = useCallback((orbIndex: number, granularType: string) => {
    if (!socket) return;
    // Optimistic update
    setOrbs(prev => prev.map((orb, i) =>
      i === orbIndex ? { ...orb, placedOnNode: granularType } : orb
    ));
    socket.emit('place_orb', { orbIndex, granularType });
    if (navigator.vibrate) navigator.vibrate(15);
  }, [socket]);

  const recallOrb = useCallback((orbIndex: number) => {
    if (!socket) return;
    // Optimistic update
    setOrbs(prev => prev.map((orb, i) =>
      i === orbIndex ? { ...orb, placedOnNode: null, placedAtLoop: 0 } : orb
    ));
    socket.emit('recall_orb', { orbIndex });
  }, [socket]);

  return { orbs, tallies, placeOrb, recallOrb };
}

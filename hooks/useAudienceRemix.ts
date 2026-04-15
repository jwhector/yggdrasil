/**
 * useAudienceRemix Hook (V3.4 — Swarm Orbs)
 *
 * Manages tally state and socket event subscriptions during finale_remix.
 * Orb visual state is managed separately by useFloatingOrbs.
 * This hook handles: node_tally broadcasts, orb_decayed/scatter events,
 * and place_orb/recall_orb socket emissions.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';

export interface NodeTally {
  granularType: string;
  votes: Array<{ chapterId: string; count: number }>;
  dominantChapter: string | null;
  locked: boolean;
}

export interface UseAudienceRemixReturn {
  tallies: NodeTally[];
  emitPlaceOrb: (orbIndex: number, granularType: string) => void;
  emitRecallOrb: (orbIndex: number) => void;
}

export function useAudienceRemix(
  socket: Socket | null,
  initialTallies: NodeTally[],
  onOrbDecayed?: (orbIndex: number) => void,
  onScatter?: (granularType: string | null) => void,
): UseAudienceRemixReturn {
  const [tallies, setTallies] = useState<NodeTally[]>(initialTallies);

  // Sync tallies from props when state_sync arrives
  const prevInitialRef = useRef(initialTallies);
  useEffect(() => {
    if (initialTallies !== prevInitialRef.current) {
      prevInitialRef.current = initialTallies;
      setTallies(initialTallies);
    }
  }, [initialTallies]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleTally = (data: { tallies: NodeTally[] }) => {
      setTallies(data.tallies);
    };

    const handleDecayed = (data: { orbIndex: number }) => {
      onOrbDecayed?.(data.orbIndex);
      if (navigator.vibrate) navigator.vibrate(50);
    };

    const handleScatter = (data: { granularType: string | null }) => {
      onScatter?.(data.granularType);
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
  }, [socket, onOrbDecayed, onScatter]);

  const emitPlaceOrb = useCallback((orbIndex: number, granularType: string) => {
    if (!socket) return;
    socket.emit('place_orb', { orbIndex, granularType });
    if (navigator.vibrate) navigator.vibrate(15);
  }, [socket]);

  const emitRecallOrb = useCallback((orbIndex: number) => {
    if (!socket) return;
    socket.emit('recall_orb', { orbIndex });
  }, [socket]);

  return { tallies, emitPlaceOrb, emitRecallOrb };
}

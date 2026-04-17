/**
 * useAudienceRemix Hook (V3.4 — Swarm Orbs)
 *
 * Manages tally state and socket event subscriptions during finale_remix.
 * Orb visual state is managed separately by useFloatingOrbs.
 * This hook handles: node_tally broadcasts, orb_decayed/scatter events,
 * place_orb/recall_orb socket emissions, and collective scatter voting.
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
  enabledNodes: string[];
  emitPlaceOrb: (orbIndex: number, granularType: string) => void;
  emitRecallOrb: (orbIndex: number) => void;
  // Collective scatter vote
  scatterVoteCount: number;
  scatterVoteThreshold: number;
  hasVotedScatter: boolean;
  emitScatterVote: () => void;
}

export function useAudienceRemix(
  socket: Socket | null,
  initialTallies: NodeTally[],
  initialEnabledNodes: string[],
  onOrbDecayed?: (orbIndex: number) => void,
  onScatter?: (granularType: string | null) => void,
): UseAudienceRemixReturn {
  const [tallies, setTallies] = useState<NodeTally[]>(initialTallies);
  const [enabledNodes, setEnabledNodes] = useState<string[]>(initialEnabledNodes);

  // Collective scatter vote state
  const [scatterVoteCount, setScatterVoteCount] = useState(0);
  const [scatterVoteThreshold, setScatterVoteThreshold] = useState(0);
  const [hasVotedScatter, setHasVotedScatter] = useState(false);

  // Sync tallies and enabledNodes from props when state_sync arrives
  const prevInitialRef = useRef(initialTallies);
  const prevEnabledRef = useRef(initialEnabledNodes);
  useEffect(() => {
    if (initialTallies !== prevInitialRef.current) {
      prevInitialRef.current = initialTallies;
      setTallies(initialTallies);
    }
    if (initialEnabledNodes !== prevEnabledRef.current) {
      prevEnabledRef.current = initialEnabledNodes;
      setEnabledNodes(initialEnabledNodes);
    }
  }, [initialTallies, initialEnabledNodes]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleTally = (data: { tallies: NodeTally[]; enabledNodes?: string[] }) => {
      setTallies(data.tallies);
      if (data.enabledNodes) setEnabledNodes(data.enabledNodes);
    };

    const handleDecayed = (data: { orbIndex: number }) => {
      onOrbDecayed?.(data.orbIndex);
      if (navigator.vibrate) navigator.vibrate(50);
    };

    const handleScatter = (data: { granularType: string | null }) => {
      onScatter?.(data.granularType);
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
      // Reset local scatter vote — new cycle begins
      setHasVotedScatter(false);
    };

    const handleScatterVoteCount = (data: { count: number; threshold: number }) => {
      setScatterVoteCount(data.count);
      setScatterVoteThreshold(data.threshold);
      // If count reset to 0, clear local vote flag (new cycle)
      if (data.count === 0) {
        setHasVotedScatter(false);
      }
    };

    socket.on('node_tally', handleTally);
    socket.on('orb_decayed', handleDecayed);
    socket.on('scatter', handleScatter);
    socket.on('scatter_vote_count', handleScatterVoteCount);

    return () => {
      socket.off('node_tally', handleTally);
      socket.off('orb_decayed', handleDecayed);
      socket.off('scatter', handleScatter);
      socket.off('scatter_vote_count', handleScatterVoteCount);
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

  const emitScatterVote = useCallback(() => {
    if (!socket || hasVotedScatter) return;
    socket.emit('vote_scatter');
    setHasVotedScatter(true);
    if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
  }, [socket, hasVotedScatter]);

  return {
    tallies, enabledNodes,
    emitPlaceOrb, emitRecallOrb,
    scatterVoteCount, scatterVoteThreshold, hasVotedScatter, emitScatterVote,
  };
}

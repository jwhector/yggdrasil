// @ts-nocheck — deprecated V3.2 code, to be deleted/rewritten in V3.3 Phase 2
/**
 * useLiveMix Hook
 *
 * Manages live mix state for the audience during finale_live_mix phase.
 * Primary data comes from AudienceFinaleView (via state_sync).
 * Also listens for high-frequency `mix_state` events when available.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudienceFinaleView, GranularFragment } from '@/conductor/types';
import { MUTE_FRAGMENT_ID } from '@/conductor/types';

export interface LiveMixState {
  myGroupFragments: GranularFragment[];
  myVote: string | null;
  activeFragment: string | null;
  voteDistribution: Map<string, number>; // fragmentId → count
  totalVotes: number;
  isLocked: boolean;
  isMuted: boolean;
  otherTypesActive: Array<{ granularType: string; fragmentId: string }>;
  setPreference: (fragmentId: string) => void;
}

interface MixStateUpdate {
  activeFragment: string | null;
  voteDistribution: Array<{ fragmentId: string; count: number }>;
  lockedTypes: string[];
}

export function useLiveMix(
  socket: Socket | null,
  myFinale: AudienceFinaleView | null,
): LiveMixState {
  // High-frequency override from mix_state events
  const [hfState, setHfState] = useState<MixStateUpdate | null>(null);
  const myTypeRef = useRef<string | null>(null);
  myTypeRef.current = myFinale?.myGranularType ?? null;

  // Listen for high-frequency mix_state updates (future server feature)
  useEffect(() => {
    if (!socket) return;

    const handleMixState = (data: MixStateUpdate) => {
      setHfState(data);
    };

    socket.on('mix_state', handleMixState);
    return () => {
      socket.off('mix_state', handleMixState);
    };
  }, [socket]);

  // Clear high-frequency state when phase changes away from live_mix
  useEffect(() => {
    if (myFinale?.finalePhase !== 'live_mix') {
      setHfState(null);
    }
  }, [myFinale?.finalePhase]);

  const setPreference = useCallback(
    (fragmentId: string) => {
      if (!socket?.connected) return;
      socket.emit('set_preference', { fragmentId });
    },
    [socket],
  );

  if (!myFinale || myFinale.finalePhase !== 'live_mix') {
    return {
      myGroupFragments: [],
      myVote: null,
      activeFragment: null,
      voteDistribution: new Map(),
      totalVotes: 0,
      isLocked: false,
      isMuted: false,
      otherTypesActive: [],
      setPreference,
    };
  }

  // Use high-frequency data if available, fall back to state_sync
  const activeFragment = hfState?.activeFragment ?? myFinale.myGroupActiveFragment;
  const lockedTypes = hfState?.lockedTypes ?? myFinale.lockedTypes;

  const rawDistribution = hfState?.voteDistribution ?? myFinale.myGroupVoteDistribution;
  const voteDistribution = new Map<string, number>();
  let totalVotes = 0;
  for (const { fragmentId, count } of rawDistribution) {
    voteDistribution.set(fragmentId, count);
    totalVotes += count;
  }

  const isLocked = myFinale.myGranularType != null
    && lockedTypes.includes(myFinale.myGranularType);

  const isMuted = activeFragment === MUTE_FRAGMENT_ID;

  const otherTypesActive = myFinale.activeFragments.filter(
    (af) => af.granularType !== myFinale.myGranularType,
  );

  return {
    myGroupFragments: myFinale.myGroupFragments,
    myVote: myFinale.myVote,
    activeFragment,
    voteDistribution,
    totalVotes,
    isLocked,
    isMuted,
    otherTypesActive,
    setPreference,
  };
}

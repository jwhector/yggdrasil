'use client';

/**
 * RevealSequence
 *
 * Orchestrates the 4-beat post-vote reveal animation:
 *   1. Tension   (~1s)   — both cards shown equal size, muted, no result
 *   2. Split     (~2s)   — winner grows, loser shrinks proportionally
 *   3. Drain     (~1.5s) — HealthBar drainShadow previews then animates drain
 *   4. Lock-in   (~0.5s) — winner gets a brief accent
 *
 * Total: ~5s, designed to match revealSequenceDurationMs.
 * Audience: no exact vote counts shown.
 * Projector: can show exact vote counts alongside visual split.
 */

import { useEffect, useState } from 'react';
import type { LayerConfig } from '@/conductor/types';
import { getLayerIdentity } from '@/lib/identity';
import { HealthBar } from './HealthBar';

export interface RevealSequenceProps {
  voteResult: {
    winner: 'A' | 'B';
    consensus: number;         // 0.0–1.0 (winning side's proportion)
    votesA?: number;           // Only shown in projector variant
    votesB?: number;
    totalVotes?: number;
  };
  drain: {
    drainAmount: number;
    healthAfter: number;
  };
  /** Health value before drain was applied */
  healthBefore: number;
  layerConfig: LayerConfig;
  variant: 'audience' | 'projector';
}

type RevealBeat = 'tension' | 'split' | 'drain' | 'lockin';

const BEAT_DURATIONS: Record<RevealBeat, number> = {
  tension: 900,
  split: 2000,
  drain: 1500,
  lockin: 500,
};

export function RevealSequence({
  voteResult,
  drain,
  healthBefore,
  layerConfig,
  variant,
}: RevealSequenceProps) {
  const [beat, setBeat] = useState<RevealBeat>('tension');
  const [showDrainShadow, setShowDrainShadow] = useState(false);

  useEffect(() => {
    // Progress through beats
    const t1 = setTimeout(() => setBeat('split'), BEAT_DURATIONS.tension);
    const t2 = setTimeout(() => {
      setBeat('drain');
      // Show drain shadow briefly, then let it animate away
      setShowDrainShadow(true);
      setTimeout(() => setShowDrainShadow(false), 600);
    }, BEAT_DURATIONS.tension + BEAT_DURATIONS.split);
    const t3 = setTimeout(
      () => setBeat('lockin'),
      BEAT_DURATIONS.tension + BEAT_DURATIONS.split + BEAT_DURATIONS.drain,
    );

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const identity = getLayerIdentity(layerConfig.type);
  const winner = voteResult.winner;
  const loser: 'A' | 'B' = winner === 'A' ? 'B' : 'A';
  const consensus = voteResult.consensus; // 0.5–1.0

  // Card sizing during split — winner gets consensus%, loser gets (1-consensus)%
  const winnerFlex = beat === 'tension' ? 1 : consensus * 2;
  const loserFlex = beat === 'tension' ? 1 : (1 - consensus) * 2;

  // Health bar value to show
  const displayHealth = beat === 'drain' || beat === 'lockin'
    ? drain.healthAfter
    : healthBefore;
  const drainShadowAmount = showDrainShadow ? drain.drainAmount : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: variant === 'projector' ? '24px' : '14px',
        width: '100%',
      }}
    >
      {/* Health bar with drain animation */}
      <HealthBar
        health={displayHealth}
        drainShadow={drainShadowAmount}
        variant={variant}
      />

      {/* Card split */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          width: '100%',
          alignItems: 'stretch',
          transition: 'all 0.4s ease',
        }}
      >
        {(['A', 'B'] as const).map((option) => {
          const isWinner = option === winner;
          const flex = isWinner ? winnerFlex : loserFlex;
          const isRevealedWinner = beat !== 'tension' && isWinner;
          const isRevealedLoser = beat !== 'tension' && !isWinner;
          const isA = option === 'A';

          const colorStyle: React.CSSProperties = isA
            ? { backgroundColor: identity.color, color: '#000', border: '2px solid transparent' }
            : { backgroundColor: 'transparent', border: `2px solid ${identity.color}`, color: identity.color };

          const label = option === 'A' ? layerConfig.labelA : layerConfig.labelB;

          return (
            <div
              key={option}
              style={{
                flex,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                minHeight: variant === 'projector' ? '160px' : '120px',
                borderRadius: '10px',
                padding: '16px 10px',
                opacity: beat === 'tension' ? 0.6 : isRevealedLoser ? 0.25 : 1,
                ...colorStyle,
                boxShadow: beat === 'lockin' && isWinner
                  ? `0 0 0 2px #fff, 0 0 12px 2px ${identity.color}`
                  : 'none',
                transition: 'flex 0.6s ease, opacity 0.4s ease, box-shadow 0.3s ease',
              }}
            >
              <span style={{ fontSize: variant === 'projector' ? '2.5rem' : '1.8rem', lineHeight: 1 }}>
                {identity.symbol}
              </span>

              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  opacity: 0.7,
                }}
              >
                {option}
              </span>

              <span
                style={{
                  fontSize: variant === 'projector' ? '1rem' : '0.85rem',
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {label}
              </span>

              {/* Projector: show vote counts after tension beat */}
              {variant === 'projector' && beat !== 'tension' && voteResult.votesA !== undefined && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    opacity: 0.6,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    marginTop: '4px',
                  }}
                >
                  {option === 'A' ? voteResult.votesA : voteResult.votesB}
                </span>
              )}

              {/* Winner label on lock-in */}
              {beat === 'lockin' && isWinner && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    opacity: 0.8,
                  }}
                >
                  CHOSEN
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

/**
 * RevealSequence
 *
 * Orchestrates the 4-beat post-vote reveal animation:
 *   1. Tension    (~0.9s) — both cards shown equal size, muted, no result
 *   2. Split      (~2s)   — winner grows, loser shrinks proportionally
 *   3. Threshold  (~1.5s) — consensus bar animates toward the doubt threshold line
 *                           Pass: bar clears line → relief → lock-in glow
 *                           Fail: bar stops short → red pulse
 *   4. Lock-in    (~0.5s) — winner gets accent glow (pass only)
 *
 * Total: ~5s, designed to match revealSequenceDurationMs.
 * Audience: no exact vote counts shown.
 * Projector: shows exact vote counts alongside visual split.
 */

import { useEffect, useState } from 'react';
import type { V32LayerConfig, Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

export interface RevealSequenceProps {
  voteResult: {
    winner: 'A' | 'B';
    consensus: number;         // 0.0–1.0 (winning side's proportion)
    votesA?: number;           // Only shown in projector variant
    votesB?: number;
  };
  thresholdCheck: {
    winningProportion: number;
    threshold: number;
    passed: boolean;
  };
  layerConfig: V32LayerConfig;
  variant: 'audience' | 'projector';
  chapter?: Chapter;
}

type RevealBeat = 'tension' | 'split' | 'threshold' | 'lockin';

const BEAT_DURATIONS: Record<RevealBeat, number> = {
  tension: 900,
  split: 2000,
  threshold: 1500,
  lockin: 500,
};

export function RevealSequence({
  voteResult,
  thresholdCheck,
  layerConfig,
  variant,
  chapter,
}: RevealSequenceProps) {
  const [beat, setBeat] = useState<RevealBeat>('tension');
  const [barProgress, setBarProgress] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setBeat('split'), BEAT_DURATIONS.tension);
    const t2 = setTimeout(() => {
      setBeat('threshold');
      // Animate bar from 0 to winningProportion over ~800ms
      setBarProgress(0);
      const animFrame = setTimeout(() => setBarProgress(thresholdCheck.winningProportion), 50);
      return () => clearTimeout(animFrame);
    }, BEAT_DURATIONS.tension + BEAT_DURATIONS.split);

    let t3: ReturnType<typeof setTimeout> | undefined;
    if (thresholdCheck.passed) {
      t3 = setTimeout(
        () => setBeat('lockin'),
        BEAT_DURATIONS.tension + BEAT_DURATIONS.split + BEAT_DURATIONS.threshold,
      );
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (t3 !== undefined) clearTimeout(t3);
    };
  }, [thresholdCheck.passed, thresholdCheck.winningProportion]);

  const chapterIdentity = chapter ? getChapterIdentity(chapter) : null;
  const baseColor = '#6b7280';
  const identity = { symbol: layerConfig.group?.[0]?.toUpperCase() ?? '?', color: baseColor, label: layerConfig.group ?? '' };
  const colorA = chapterIdentity?.colorA ?? baseColor;
  const colorB = chapterIdentity?.colorB ?? baseColor;
  const winner = voteResult.winner;
  const consensus = voteResult.consensus; // 0.5–1.0

  // Card sizing during split — winner gets consensus%, loser gets (1-consensus)%
  const winnerFlex = beat === 'tension' ? 1 : consensus * 2;
  const loserFlex = beat === 'tension' ? 1 : (1 - consensus) * 2;

  // Threshold bar colors
  const barColor = beat === 'threshold' || beat === 'lockin'
    ? thresholdCheck.passed ? '#4ade80' : '#ef4444'
    : identity.color;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: variant === 'projector' ? '24px' : '14px',
        width: '100%',
      }}
    >
      {/* Threshold bar visualization */}
      <ThresholdBar
        winningProportion={barProgress}
        threshold={thresholdCheck.threshold}
        passed={thresholdCheck.passed}
        barColor={barColor}
        active={beat === 'threshold' || beat === 'lockin'}
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
          const isRevealedLoser = beat !== 'tension' && !isWinner;
          const isA = option === 'A';

          const optColor = isA ? colorA : colorB;
          const colorStyle: React.CSSProperties = isA
            ? { backgroundColor: optColor, color: '#000', border: '2px solid transparent' }
            : { backgroundColor: 'transparent', border: `2px solid ${optColor}`, color: optColor };

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
                boxShadow: beat === 'lockin' && isWinner && thresholdCheck.passed
                  ? `0 0 0 2px #fff, 0 0 12px 2px ${optColor}`
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
              {beat === 'lockin' && isWinner && thresholdCheck.passed && (
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

// ---------------------------------------------------------------------------
// ThresholdBar — inline sub-component used only by RevealSequence
// ---------------------------------------------------------------------------

interface ThresholdBarProps {
  winningProportion: number;
  threshold: number;
  passed: boolean;
  barColor: string;
  active: boolean;
  variant: 'audience' | 'projector';
}

function ThresholdBar({ winningProportion, threshold, passed, barColor, active, variant }: ThresholdBarProps) {
  const height = variant === 'projector' ? 20 : 10;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: height / 2,
        overflow: 'visible',
      }}
    >
      {/* Consensus fill bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${winningProportion * 100}%`,
          backgroundColor: barColor,
          borderRadius: height / 2,
          transition: 'width 0.8s ease-out, background-color 0.4s ease',
          boxShadow: active && passed ? `0 0 8px 2px ${barColor}` : 'none',
        }}
      />

      {/* Threshold line */}
      <div
        style={{
          position: 'absolute',
          top: '-4px',
          bottom: '-4px',
          left: `${threshold * 100}%`,
          width: 2,
          backgroundColor: active
            ? passed ? '#4ade80' : '#ef4444'
            : 'rgba(255,255,255,0.4)',
          transition: 'background-color 0.4s ease',
          transform: 'translateX(-50%)',
        }}
      />

      {/* Threshold percentage label (projector only) */}
      {variant === 'projector' && (
        <span
          style={{
            position: 'absolute',
            top: '-20px',
            left: `${threshold * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: '0.6rem',
            opacity: 0.5,
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
          }}
        >
          {Math.round(threshold * 100)}%
        </span>
      )}
    </div>
  );
}

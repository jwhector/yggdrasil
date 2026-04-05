'use client';

/**
 * OptionCards
 *
 * Two large side-by-side tappable cards for A/B voting during song-building.
 * Also supports a reveal mode where vote results display inside the cards.
 *
 * Card states:
 * - Inactive: very subtle bg, thin border, dim text
 * - Active (NOW PLAYING): option-color tinted bg, brighter border, NOW PLAYING label
 * - Selected (voted): option-color bg, thick border, YOUR VOTE label
 * - Other card when voted: very dim
 * - Reveal: fill bar inside card showing vote proportion, winner enlarged
 */

import type { V32LayerConfig, Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

export interface RevealResult {
  winner: 'A' | 'B';
  proportionA: number;
  proportionB: number;
  passed: boolean;
}

export interface OptionCardsProps {
  layerConfig: V32LayerConfig;
  myVote: 'A' | 'B' | null;
  disabled: boolean;
  onVote: (choice: 'A' | 'B') => void;
  currentAuditionOption?: 'A' | 'B' | null;
  chapter?: Chapter;
  revealResult?: RevealResult | null;
  dimmed?: boolean;
}

export function OptionCards({
  layerConfig,
  myVote,
  disabled,
  onVote,
  currentAuditionOption,
  chapter,
  revealResult,
  dimmed,
}: OptionCardsProps) {
  const chapterIdentity = chapter ? getChapterIdentity(chapter) : null;
  const colorA = chapterIdentity?.colorA ?? '#6b7280';
  const colorB = chapterIdentity?.colorB ?? '#6b7280';

  return (
    <div
      style={{
        display: 'flex',
        gap: '14px',
        width: '100%',
        padding: '0 14px',
        opacity: dimmed ? 0.3 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <OptionCard
        option="A"
        label={layerConfig.labelA}
        color={colorA}
        myVote={myVote}
        disabled={disabled}
        onVote={onVote}
        isAuditioning={currentAuditionOption === 'A'}
        revealResult={revealResult}
      />
      <OptionCard
        option="B"
        label={layerConfig.labelB}
        color={colorB}
        myVote={myVote}
        disabled={disabled}
        onVote={onVote}
        isAuditioning={currentAuditionOption === 'B'}
        revealResult={revealResult}
      />
    </div>
  );
}

interface OptionCardProps {
  option: 'A' | 'B';
  label: string;
  color: string;
  myVote: 'A' | 'B' | null;
  disabled: boolean;
  onVote: (choice: 'A' | 'B') => void;
  isAuditioning: boolean;
  revealResult?: RevealResult | null;
}

function OptionCard({
  option,
  label,
  color,
  myVote,
  disabled,
  onVote,
  isAuditioning,
  revealResult,
}: OptionCardProps) {
  const isSelected = myVote === option;
  const hasVoted = myVote !== null;
  const isReveal = !!revealResult;
  const isWinner = revealResult?.winner === option;
  const proportion = revealResult
    ? (option === 'A' ? revealResult.proportionA : revealResult.proportionB)
    : 0;

  // --- Determine visual state ---
  let bg = 'rgba(255,255,255,0.015)';
  let border = 'rgba(255,255,255,0.06)';
  let borderWidth = 0.5;
  let letterAlpha = 0.45;
  let labelAlpha = 0.35;
  let cardOpacity = 1;
  let scale = 1;

  if (isReveal) {
    // Reveal mode
    if (isWinner) {
      bg = `${color}12`;
      border = color;
      borderWidth = 2.5;
      letterAlpha = 0.9;
      labelAlpha = 0.5;
      scale = 1.03;
    } else {
      bg = 'rgba(255,255,255,0.01)';
      border = 'rgba(255,255,255,0.04)';
      borderWidth = 0.5;
      letterAlpha = 0.15;
      labelAlpha = 0.08;
      cardOpacity = 0.6;
    }
  } else if (isSelected) {
    bg = `${color}14`;
    border = color;
    borderWidth = 2.5;
    letterAlpha = 0.9;
    labelAlpha = 0.5;
  } else if (isAuditioning) {
    bg = `${color}08`;
    border = `${color}AA`;
    borderWidth = 1.5;
    letterAlpha = 0.7;
    labelAlpha = 0.4;
  } else if (hasVoted) {
    // Other card after voting
    bg = 'rgba(255,255,255,0.01)';
    border = 'rgba(255,255,255,0.04)';
    letterAlpha = 0.12;
    labelAlpha = 0.06;
    cardOpacity = 0.4;
  }

  return (
    <button
      onClick={() => { if (!disabled && !isReveal) onVote(option); }}
      disabled={disabled || isReveal}
      aria-pressed={isSelected}
      aria-label={`Option ${option}: ${label}`}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        minHeight: '280px',
        borderRadius: '12px',
        cursor: disabled || isReveal ? 'default' : 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        outline: 'none',
        padding: '20px 12px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'opacity 0.3s ease, transform 0.4s ease, border-color 0.2s ease, background-color 0.2s ease',
        backgroundColor: bg,
        border: `${borderWidth}px solid ${border}`,
        color: '#fff',
        opacity: cardOpacity,
        transform: `scale(${scale})`,
      }}
    >
      {/* Reveal fill bar (background) */}
      {isReveal && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${proportion * 100}%`,
            backgroundColor: `${color}18`,
            transition: 'height 1.2s ease-out',
            borderRadius: '0 0 10px 10px',
          }}
        />
      )}

      {/* NOW PLAYING micro-label */}
      {isAuditioning && !isReveal && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            color,
            opacity: 0.5,
          }}
        >
          NOW PLAYING
        </span>
      )}

      {/* Option letter */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: '3rem',
          fontWeight: 500,
          color,
          opacity: letterAlpha,
          lineHeight: 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        {option}
      </span>

      {/* Emotional tagline */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: '0.8rem',
          textAlign: 'center',
          lineHeight: 1.3,
          color,
          opacity: labelAlpha,
          transition: 'opacity 0.3s ease',
        }}
      >
        {label}
      </span>

      {/* Vote dot */}
      {!isReveal && (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            marginTop: '4px',
            transition: 'all 0.2s ease',
            ...(isSelected
              ? { backgroundColor: color, opacity: 0.6 }
              : { border: `1.5px solid ${color}`, opacity: hasVoted ? 0.08 : 0.2 }
            ),
          }}
        />
      )}

      {/* YOUR VOTE label */}
      {isSelected && !isReveal && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: '0.6rem',
            letterSpacing: '0.12em',
            color,
            opacity: 0.45,
          }}
        >
          YOUR VOTE
        </span>
      )}

      {/* Reveal: percentage */}
      {isReveal && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: '0.9rem',
            fontWeight: 600,
            color,
            opacity: isWinner ? 0.8 : 0.25,
            letterSpacing: '0.05em',
            transition: 'opacity 0.4s ease',
          }}
        >
          {Math.round(proportion * 100)}%
        </span>
      )}

      {/* Reveal: CHOSEN badge */}
      {isReveal && isWinner && revealResult?.passed && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: '0.55rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color,
            opacity: 0.6,
          }}
        >
          CHOSEN
        </span>
      )}
    </button>
  );
}

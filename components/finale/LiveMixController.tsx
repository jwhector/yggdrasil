/**
 * LiveMixController
 *
 * Audience phone UI for the live mix phase. Shows tappable fragment cards
 * for the user's assigned granular type. Group majority determines what plays.
 *
 * Design: large tap targets, organic consensus visualization (fill bars),
 * chapter colors as accents, dark background.
 */

'use client';

import type { GranularFragment, LayerType, Chapter } from '@/conductor/types';
import { MUTE_FRAGMENT_ID } from '@/conductor/types';
import { getLayerIdentity, getChapterIdentity } from '@/lib/identity';

export interface LiveMixControllerProps {
  fragments: GranularFragment[];
  myVote: string | null;
  activeFragment: string | null;
  voteDistribution: Map<string, number>;
  totalVotes: number;
  isLocked: boolean;
  isMuted: boolean;
  granularType: string;
  onSelectFragment: (fragmentId: string) => void;
}

export function LiveMixController({
  fragments,
  myVote,
  activeFragment,
  voteDistribution,
  totalVotes,
  isLocked,
  isMuted,
  granularType,
  onSelectFragment,
}: LiveMixControllerProps) {
  const identity = getLayerIdentity(granularType as LayerType);

  return (
    <div style={{
      width: '100%',
      opacity: isLocked ? 0.3 : 1,
      pointerEvents: isLocked ? 'none' : 'auto',
      transition: 'opacity 0.3s ease',
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '0 4px 16px',
      }}>
        <span style={{
          fontSize: '1.6rem',
          color: isMuted ? 'rgba(255,255,255,0.2)' : identity.color,
          lineHeight: 1,
          transition: 'color 0.3s ease',
        }}>
          {identity.symbol}
        </span>
        <span style={{
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.5)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          {identity.label}
        </span>
      </div>

      {/* Fragment cards + mute option */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {fragments.map((fragment) => (
          <FragmentCard
            key={fragment.id}
            fragment={fragment}
            isActive={fragment.id === activeFragment}
            isSelected={fragment.id === myVote}
            proportion={totalVotes > 0 ? (voteDistribution.get(fragment.id) ?? 0) / totalVotes : 0}
            typeColor={identity.color}
            onTap={() => onSelectFragment(fragment.id)}
          />
        ))}

        {/* Mute option — voteable like any fragment */}
        <MuteCard
          isActive={isMuted}
          isSelected={myVote === MUTE_FRAGMENT_ID}
          proportion={totalVotes > 0 ? (voteDistribution.get(MUTE_FRAGMENT_ID) ?? 0) / totalVotes : 0}
          onTap={() => onSelectFragment(MUTE_FRAGMENT_ID)}
        />
      </div>

      {/* Locked overlay */}
      {isLocked && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            fontSize: '0.8rem',
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: '8px 20px',
            borderRadius: '4px',
          }}>
            LOCKED
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fragment Card
// ---------------------------------------------------------------------------

function FragmentCard({
  fragment,
  isActive,
  isSelected,
  proportion,
  typeColor,
  onTap,
}: {
  fragment: GranularFragment;
  isActive: boolean;
  isSelected: boolean;
  proportion: number;
  typeColor: string;
  onTap: () => void;
}) {
  const chapter = getChapterIdentity(fragment.chapter as Chapter);
  const optColor = fragment.option === 'A' ? chapter.colorA : chapter.colorB;

  // Border: active = type color glow, selected = white ring, default = subtle
  const borderColor = isActive
    ? typeColor
    : isSelected
      ? 'rgba(255,255,255,0.6)'
      : 'rgba(255,255,255,0.08)';

  const boxShadow = isActive
    ? `0 0 12px 2px ${typeColor}40, inset 0 0 8px ${typeColor}15`
    : isSelected
      ? '0 0 0 2px rgba(255,255,255,0.3)'
      : 'none';

  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '72px',
        padding: '16px 16px 16px 20px',
        border: `2px solid ${borderColor}`,
        borderLeft: `4px solid ${optColor}`,
        borderRadius: '12px',
        backgroundColor: 'rgba(255,255,255,0.03)',
        boxShadow,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        WebkitTapHighlightColor: 'transparent',
        outline: 'none',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      {/* Consensus fill bar (behind content) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: `${Math.max(proportion * 100, 0)}%`,
          backgroundColor: `${optColor}20`,
          transition: 'width 0.3s ease',
          borderRadius: '10px 0 0 10px',
        }}
      />

      {/* Card content */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{
          fontSize: '1rem',
          color: optColor,
          fontWeight: 500,
        }}>
          {chapter.label}
        </span>
        <span style={{
          fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.35)',
          letterSpacing: '0.06em',
        }}>
          Song {fragment.songIndex + 1} · {fragment.option}
        </span>
      </div>

      {/* NOW badge for active fragment */}
      {isActive && (
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: typeColor,
            boxShadow: `0 0 6px ${typeColor}`,
          }} />
          <span style={{
            fontSize: '0.6rem',
            color: typeColor,
            letterSpacing: '0.15em',
            fontWeight: 600,
          }}>
            NOW
          </span>
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mute Card — voteable silence option
// ---------------------------------------------------------------------------

function MuteCard({
  isActive,
  isSelected,
  proportion,
  onTap,
}: {
  isActive: boolean;
  isSelected: boolean;
  proportion: number;
  onTap: () => void;
}) {
  const borderColor = isActive
    ? 'rgba(255,255,255,0.5)'
    : isSelected
      ? 'rgba(255,255,255,0.6)'
      : 'rgba(255,255,255,0.08)';

  const boxShadow = isActive
    ? '0 0 12px 2px rgba(255,255,255,0.1)'
    : isSelected
      ? '0 0 0 2px rgba(255,255,255,0.3)'
      : 'none';

  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '56px',
        padding: '14px 16px 14px 20px',
        border: `2px solid ${borderColor}`,
        borderLeft: '4px solid rgba(255,255,255,0.15)',
        borderRadius: '12px',
        backgroundColor: 'rgba(255,255,255,0.02)',
        boxShadow,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        WebkitTapHighlightColor: 'transparent',
        outline: 'none',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      {/* Consensus fill bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: `${Math.max(proportion * 100, 0)}%`,
          backgroundColor: 'rgba(255,255,255,0.06)',
          transition: 'width 0.3s ease',
          borderRadius: '10px 0 0 10px',
        }}
      />

      <span style={{
        position: 'relative',
        zIndex: 1,
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.35)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        Silence
      </span>

      {isActive && (
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.5)',
          }} />
          <span style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.15em',
            fontWeight: 600,
          }}>
            NOW
          </span>
        </div>
      )}
    </button>
  );
}

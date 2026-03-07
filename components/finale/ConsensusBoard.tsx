'use client';

/**
 * ConsensusBoard
 *
 * Interactive fragment voting board for the audience during the consensus game.
 * Displays available (winning) fragments organized by role row.
 * Users tap to vote; currently-voted tile shows bright highlight border.
 * Locked roles compress to small badges at the top.
 * Animates on round success/failure.
 */

import { useState, useEffect } from 'react';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { Fragment, LayerType } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

interface ConsensusBoardProps {
  availableFragments: Array<{ fragment: Fragment; locked: boolean }>;
  myVote: string | null;
  lockedRoles: Array<{ layerType: LayerType; fragmentId: string }>;
  roundActive: boolean;
  onVote: (fragmentId: string) => void;
  // Pass to trigger animations externally
  roundFailureCount?: number;   // increment to trigger shake
  roundSuccessRole?: LayerType | null;  // set to trigger success burst
}

export function ConsensusBoard({
  availableFragments,
  myVote,
  lockedRoles,
  roundActive,
  onVote,
  roundFailureCount = 0,
  roundSuccessRole = null,
}: ConsensusBoardProps) {
  const [shaking, setShaking] = useState(false);
  const [shakePrev, setShakePrev] = useState(roundFailureCount);
  const [burstRole, setBurstRole] = useState<LayerType | null>(null);

  // Trigger shake on round failure
  useEffect(() => {
    if (roundFailureCount > shakePrev) {
      setShakePrev(roundFailureCount);
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
    }
  }, [roundFailureCount, shakePrev]);

  // Trigger burst on round success
  useEffect(() => {
    if (roundSuccessRole) {
      setBurstRole(roundSuccessRole);
      setTimeout(() => setBurstRole(null), 1200);
    }
  }, [roundSuccessRole]);

  // Group available fragments by layerType
  const byLayer: Map<LayerType, Fragment[]> = new Map();
  for (const { fragment, locked } of availableFragments) {
    if (!locked) {
      const arr = byLayer.get(fragment.layerType) ?? [];
      arr.push(fragment);
      byLayer.set(fragment.layerType, arr);
    }
  }

  // Locked roles set
  const lockedRoleSet = new Set(lockedRoles.map(r => r.layerType));
  // Locked role map: layerType → fragmentId
  const lockedRoleMap = new Map(lockedRoles.map(r => [r.layerType, r.fragmentId]));

  // All available fragments flat (for finding locked fragment details)
  const allFragmentsFlat = availableFragments.map(a => a.fragment);

  const unlocked = LAYER_ORDER.filter(lt => !lockedRoleSet.has(lt) && byLayer.has(lt));

  const shakeStyle: React.CSSProperties = shaking
    ? { animation: undefined, transform: 'translateX(0)' }
    : {};

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        gap: '6px',
      }}
    >
      {/* Locked role badges */}
      {lockedRoles.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            paddingBottom: '8px',
            borderBottom: '1px solid #222',
          }}
        >
          {lockedRoles.map(({ layerType, fragmentId }) => {
            const layer = getLayerIdentity(layerType);
            const fragment = allFragmentsFlat.find(f => f.id === fragmentId);
            const chapter = fragment ? getChapterIdentity(fragment.chapter) : null;
            return (
              <LockedBadge
                key={layerType}
                layerSymbol={layer.symbol}
                layerColor={layer.color}
                chapterColor={chapter?.color ?? '#888'}
              />
            );
          })}
        </div>
      )}

      {/* Unlocked role rows */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          ...(shaking ? shakeAnimation : {}),
        }}
      >
        {unlocked.map(layerType => {
          const layer = getLayerIdentity(layerType);
          const fragments = byLayer.get(layerType) ?? [];
          const isBursting = burstRole === layerType;

          return (
            <RoleRow
              key={layerType}
              layerSymbol={layer.symbol}
              layerColor={layer.color}
              fragments={fragments}
              myVote={myVote}
              roundActive={roundActive}
              isBursting={isBursting}
              onVote={onVote}
            />
          );
        })}
      </div>

      {unlocked.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: '0.85rem',
            padding: '24px',
          }}
        >
          All roles locked
        </div>
      )}
    </div>
  );
}

// Shake animation via inline keyframe-like state cycling
const shakeAnimation: React.CSSProperties = {
  transform: 'translateX(-4px)',
  transition: 'transform 0.08s ease',
};

function LockedBadge({
  layerSymbol,
  layerColor,
  chapterColor,
}: {
  layerSymbol: string;
  layerColor: string;
  chapterColor: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        backgroundColor: chapterColor + '22',
        border: `1px solid ${chapterColor}55`,
        borderRadius: '12px',
        boxShadow: `0 0 8px ${chapterColor}44`,
      }}
    >
      <span style={{ fontSize: '0.7rem', color: layerColor }}>{layerSymbol}</span>
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: chapterColor,
        }}
      />
    </div>
  );
}

function RoleRow({
  layerSymbol,
  layerColor,
  fragments,
  myVote,
  roundActive,
  isBursting,
  onVote,
}: {
  layerSymbol: string;
  layerColor: string;
  fragments: Fragment[];
  myVote: string | null;
  roundActive: boolean;
  isBursting: boolean;
  onVote: (fragmentId: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {/* Layer icon */}
      <div
        style={{
          width: '28px',
          flexShrink: 0,
          textAlign: 'center',
          fontSize: '1rem',
          color: layerColor,
        }}
      >
        {layerSymbol}
      </div>

      {/* Fragment tiles */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        {fragments.map(fragment => {
          const isVoted = myVote === fragment.id;
          const chapter = getChapterIdentity(fragment.chapter);

          return (
            <button
              key={fragment.id}
              onClick={() => roundActive && onVote(fragment.id)}
              disabled={!roundActive}
              style={{
                flex: 1,
                minWidth: '80px',
                minHeight: '52px',
                padding: '8px',
                borderRadius: '6px',
                border: isVoted
                  ? '2px solid #fff'
                  : `1px solid ${chapter.color}55`,
                backgroundColor: isVoted
                  ? chapter.color + '55'
                  : chapter.color + '22',
                cursor: roundActive ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                opacity: roundActive ? 1 : 0.5,
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
                boxShadow: isBursting
                  ? `0 0 24px ${chapter.color}aa`
                  : isVoted
                  ? `0 0 8px ${chapter.color}66`
                  : 'none',
                transform: isBursting ? 'scale(1.05)' : 'scale(1)',
                // Remove default button styles
                fontFamily: 'inherit',
                textAlign: 'center',
              }}
            >
              {/* Chapter color indicator */}
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: chapter.color,
                  flexShrink: 0,
                }}
              />
              {/* Emotional label */}
              <span
                style={{
                  fontSize: '0.65rem',
                  color: 'rgba(255,255,255,0.9)',
                  fontWeight: isVoted ? 600 : 400,
                  lineHeight: 1.2,
                  textAlign: 'center',
                }}
              >
                {fragment.displayLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

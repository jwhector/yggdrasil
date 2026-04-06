'use client';

/**
 * ElegyGrid
 *
 * Non-interactive display of all fragments from all 3 songs, organized by role (layer type).
 * Winning fragments glow with chapter color; losing/unreached fragments are dimmed.
 *
 * Supports audience (compact, phone-sized) and projector (large, dramatic) variants.
 */

import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { GranularFragment, LayerType } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['seed', 'drums', 'pad', 'bass', 'harmony', 'fx'];

interface ElegyGridProps {
  availableFragments: GranularFragment[];   // winners — glowing
  lockedFragments: GranularFragment[];      // losers + unreached — dimmed
  variant?: 'audience' | 'projector';
}

export function ElegyGrid({
  availableFragments,
  lockedFragments,
  variant = 'audience',
}: ElegyGridProps) {
  const isProjector = variant === 'projector';

  // Build a map: granularType → { winners: GranularFragment[], losers: GranularFragment[] }
  const byLayer: Record<LayerType, { winners: GranularFragment[]; losers: GranularFragment[] }> = {
    seed:    { winners: [], losers: [] },
    drums:   { winners: [], losers: [] },
    pad:     { winners: [], losers: [] },
    bass:    { winners: [], losers: [] },
    harmony: { winners: [], losers: [] },
    fx:      { winners: [], losers: [] },
  };

  for (const f of availableFragments) {
    byLayer[f.granularType as LayerType]?.winners.push(f);
  }
  for (const f of lockedFragments) {
    byLayer[f.granularType as LayerType]?.losers.push(f);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: isProjector ? '16px' : '8px',
        width: '100%',
        padding: isProjector ? '40px' : '16px',
        boxSizing: 'border-box',
      }}
    >
      {LAYER_ORDER.map(layerType => {
        const layer = getLayerIdentity(layerType);
        const { winners, losers } = byLayer[layerType];
        const allFragments = [...winners, ...losers].sort(
          (a, b) => a.songIndex - b.songIndex || a.option.localeCompare(b.option)
        );
        if (allFragments.length === 0) return null;

        return (
          <div key={layerType} style={{ display: 'flex', alignItems: 'center', gap: isProjector ? '16px' : '8px' }}>
            {/* Row header: layer symbol + label */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flexShrink: 0,
                width: isProjector ? '64px' : '36px',
              }}
            >
              <span
                style={{
                  fontSize: isProjector ? '1.4rem' : '1rem',
                  color: layer.color,
                  lineHeight: 1,
                }}
              >
                {layer.symbol}
              </span>
              {isProjector && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    color: 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginTop: '4px',
                    textAlign: 'center',
                  }}
                >
                  {layer.label}
                </span>
              )}
            </div>

            {/* Fragment tiles */}
            <div
              style={{
                display: 'flex',
                flex: 1,
                gap: isProjector ? '12px' : '6px',
                flexWrap: 'wrap',
              }}
            >
              {allFragments.map(fragment => {
                const isWinner = winners.some(w => w.id === fragment.id);
                return (
                  <FragmentTile
                    key={fragment.id}
                    fragment={fragment}
                    isWinner={isWinner}
                    isProjector={isProjector}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FragmentTile({
  fragment,
  isWinner,
  isProjector,
}: {
  fragment: GranularFragment;
  isWinner: boolean;
  isProjector: boolean;
}) {
  const chapter = getChapterIdentity(fragment.chapter);
  const layer = getLayerIdentity(fragment.granularType as LayerType);
  const optColor = fragment.option === 'A' ? chapter.colorA : chapter.colorB;

  const tileWidth = isProjector ? 160 : 80;
  const tileHeight = isProjector ? 80 : 48;

  const winnerStyle: React.CSSProperties = {
    backgroundColor: optColor + '33',
    border: `1px solid ${optColor}`,
    boxShadow: `0 0 ${isProjector ? 20 : 10}px ${optColor}66`,
    opacity: 1,
  };

  const loserStyle: React.CSSProperties = {
    backgroundColor: '#111',
    border: '1px solid #2a2a2a',
    opacity: 0.25,
    filter: 'saturate(0)',
  };

  return (
    <div
      style={{
        width: tileWidth,
        height: tileHeight,
        borderRadius: isProjector ? '8px' : '4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        padding: '4px',
        boxSizing: 'border-box',
        ...(isWinner ? winnerStyle : loserStyle),
      }}
    >
      {/* Chapter color dot */}
      <div
        style={{
          width: isProjector ? '10px' : '6px',
          height: isProjector ? '10px' : '6px',
          borderRadius: '50%',
          backgroundColor: isWinner ? optColor : '#444',
          flexShrink: 0,
        }}
      />
      {/* Emotional label */}
      <span
        style={{
          fontSize: isProjector ? '0.75rem' : '0.55rem',
          color: isWinner ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
          textAlign: 'center',
          fontWeight: isWinner ? 600 : 400,
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          width: '100%',
        }}
      >
        {fragment.layerGroupId} {fragment.option}
      </span>
      {/* Song indicator */}
      <span
        style={{
          fontSize: isProjector ? '0.6rem' : '0.45rem',
          color: isWinner ? optColor : '#444',
          letterSpacing: '0.05em',
        }}
      >
        {layer.symbol} {fragment.option}
      </span>
    </div>
  );
}

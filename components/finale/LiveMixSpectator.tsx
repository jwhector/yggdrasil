/**
 * LiveMixSpectator
 *
 * Read-only compact rows showing what other granular types are currently playing.
 * Displayed below the user's LiveMixController during the live mix phase.
 */

'use client';

import type { LayerType, Chapter } from '@/conductor/types';
import { getLayerIdentity, getChapterIdentity } from '@/lib/identity';

const SONG_CHAPTERS: Chapter[] = ['ambition', 'love', 'avoidance'];

export interface LiveMixSpectatorProps {
  activeFragments: Array<{ granularType: string; fragmentId: string }>;
}

/** Extract chapter from fragment ID format: "{songIndex}-{layerGroupId}-{granularType}-{option}" */
function chapterFromFragmentId(fragmentId: string): Chapter | null {
  const songIndex = parseInt(fragmentId.split('-')[0], 10);
  if (isNaN(songIndex) || songIndex < 0 || songIndex >= SONG_CHAPTERS.length) return null;
  return SONG_CHAPTERS[songIndex];
}

export function LiveMixSpectator({
  activeFragments,
}: LiveMixSpectatorProps) {
  if (activeFragments.length === 0) return null;

  return (
    <div style={{
      width: '100%',
      paddingTop: '24px',
    }}>
      <div style={{
        fontSize: '0.6rem',
        color: 'rgba(255,255,255,0.2)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        paddingBottom: '8px',
        paddingLeft: '4px',
      }}>
        Others
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        {activeFragments.map(({ granularType, fragmentId }) => {
          const typeIdentity = getLayerIdentity(granularType as LayerType);
          const chapter = chapterFromFragmentId(fragmentId);
          const chapterIdentity = chapter ? getChapterIdentity(chapter) : null;

          return (
            <div
              key={granularType}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                backgroundColor: 'rgba(0,0,0,0.3)',
              }}
            >
              {/* Type symbol */}
              <span style={{
                fontSize: '0.9rem',
                color: typeIdentity.color,
                width: '20px',
                textAlign: 'center',
                flexShrink: 0,
              }}>
                {typeIdentity.symbol}
              </span>

              {/* Type label */}
              <span style={{
                fontSize: '0.7rem',
                color: 'rgba(255,255,255,0.4)',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {typeIdentity.label}
              </span>

              {/* Active fragment indicator */}
              {chapterIdentity ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: chapterIdentity.color,
                  }} />
                  <span style={{
                    fontSize: '0.65rem',
                    color: chapterIdentity.color,
                    opacity: 0.8,
                  }}>
                    {chapterIdentity.label}
                  </span>
                </div>
              ) : (
                <span style={{
                  fontSize: '0.6rem',
                  color: 'rgba(255,255,255,0.15)',
                }}>
                  --
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

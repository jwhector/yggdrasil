'use client';

/**
 * LayerDots
 *
 * Three small circles showing layer progress during song-building.
 * - Completed: filled with winning option's color
 * - Current: outlined with chapter color, pulsing
 * - Future: outlined with dim white
 */

import type { LayerResult, Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

interface LayerDotsProps {
  layerCount: number;
  currentLayerIndex: number;
  layerResults: LayerResult[];
  chapter: Chapter;
}

export function LayerDots({ layerCount, currentLayerIndex, layerResults, chapter }: LayerDotsProps) {
  const chapterIdentity = getChapterIdentity(chapter);
  const slots = Array.from({ length: layerCount }, (_, i) => i);

  return (
    <div style={{ display: 'flex', gap: '32px', justifyContent: 'center', padding: '8px 0' }}>
      {slots.map((i) => {
        const result = layerResults.find(r => r.layerIndex === i);
        const isCompleted = result?.status === 'locked_in';
        const isCurrent = i === currentLayerIndex;
        const isCollapsed = result?.status === 'collapsed';

        let fillColor: string | undefined;
        let borderColor = 'rgba(255,255,255,0.1)';

        if (isCompleted) {
          fillColor = result?.chosenOption === 'A'
            ? chapterIdentity.colorA
            : result?.chosenOption === 'B'
            ? chapterIdentity.colorB
            : chapterIdentity.color;
        } else if (isCollapsed) {
          borderColor = 'rgba(239,68,68,0.4)';
        } else if (isCurrent) {
          borderColor = chapterIdentity.color;
        }

        return (
          <div
            key={i}
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              transition: 'all 0.3s ease',
              ...(fillColor
                ? { backgroundColor: fillColor, opacity: 0.6 }
                : {
                    border: `2px solid ${borderColor}`,
                    animation: isCurrent ? 'dotPulse 2s ease-in-out infinite' : 'none',
                  }
              ),
            }}
          />
        );
      })}

      <style>{`
        @keyframes dotPulse {
          0%, 100% { box-shadow: none; opacity: 0.6; }
          50% { box-shadow: 0 0 0 4px rgba(255,255,255,0.08); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

'use client';

/**
 * LayerProgress
 *
 * Horizontal strip showing all 7 layers for the current attempt.
 * - Completed (locked_in): layer type symbol with chapter color background
 * - Current: highlighted border, subtle pulse if active
 * - Future: dim locked appearance
 * - Collapsed: red-tinted
 */

import type { LayerResult, LayerPhase, Chapter, LayerConfig } from '@/conductor/types';
import { getLayerIdentity, getChapterIdentity } from '@/lib/identity';

export interface LayerProgressProps {
  layerResults: LayerResult[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerCount: number;
  chapter: Chapter;
  /** Full layer plan needed to show layer type icons for upcoming layers */
  layerPlan?: LayerConfig[];
}

export function LayerProgress({
  layerResults,
  currentLayerIndex,
  currentLayerPhase,
  layerCount,
  chapter,
  layerPlan,
}: LayerProgressProps) {
  const chapterIdentity = getChapterIdentity(chapter);
  const slots = Array.from({ length: layerCount }, (_, i) => i);

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 0',
      }}
    >
      {slots.map((slotIndex) => {
        const result = layerResults.find((r) => r.layerIndex === slotIndex);
        const layerConfig = layerPlan?.[slotIndex];
        const identity = layerConfig ? getLayerIdentity(layerConfig.type) : null;
        const isCurrent = slotIndex === currentLayerIndex;
        const isCompleted = result?.status === 'locked_in';
        const isCollapsed = result?.status === 'unreached' && slotIndex < currentLayerIndex;
        const isFuture = slotIndex > currentLayerIndex;
        const isCurrentCollapsed = isCurrent && currentLayerPhase === 'collapsed';

        const size = 28;

        let backgroundColor = 'rgba(255,255,255,0.06)';
        let borderColor = 'rgba(255,255,255,0.12)';
        let textColor = 'rgba(255,255,255,0.25)';
        let symbol = identity?.symbol ?? '·';

        if (isCompleted) {
          backgroundColor = chapterIdentity.color;
          borderColor = chapterIdentity.color;
          textColor = '#000';
        } else if (isCurrentCollapsed) {
          backgroundColor = 'rgba(239,68,68,0.15)';
          borderColor = 'rgba(239,68,68,0.5)';
          textColor = 'rgba(239,68,68,0.7)';
        } else if (isCurrent) {
          backgroundColor = 'rgba(255,255,255,0.08)';
          borderColor = 'rgba(255,255,255,0.5)';
          textColor = 'rgba(255,255,255,0.8)';
        }

        const isPulsing = isCurrent && (currentLayerPhase === 'voting' || currentLayerPhase === 'auditioning');

        return (
          <div
            key={slotIndex}
            title={layerConfig ? `${layerConfig.type} (layer ${slotIndex + 1})` : `Layer ${slotIndex + 1}`}
            style={{
              width: size,
              height: size,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              backgroundColor,
              border: `1.5px solid ${borderColor}`,
              color: textColor,
              flexShrink: 0,
              opacity: isFuture ? 0.4 : 1,
              animation: isPulsing ? 'layerPulse 2s ease-in-out infinite' : 'none',
              transition: 'background-color 0.3s ease, border-color 0.3s ease',
            }}
          >
            {symbol}
          </div>
        );
      })}

      {/* Pulse keyframe injected once */}
      <style>{`
        @keyframes layerPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.0); }
          50% { box-shadow: 0 0 0 3px rgba(255,255,255,0.15); }
        }
      `}</style>
    </div>
  );
}

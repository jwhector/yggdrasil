'use client';

/**
 * MixingMirror (Projector)
 *
 * Simplified, beautified read-only view of the performer mixing surface.
 * 7 rows showing the active fragment per layer with chapter color.
 * Pending changes pulse on their row.
 * Loop position indicator at bottom.
 */

import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { LoopIndicator } from '@/components/finale/LoopIndicator';
import type { Fragment, LayerType, PendingChange } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

interface MixingMirrorProps {
  activeLayers: Array<{ layerType: LayerType; fragmentId: string | null }>;
  pendingChanges: PendingChange[];
  loopPosition: number;
  loopCount: number;
  allFragments: Fragment[];
}

export function MixingMirror({
  activeLayers,
  pendingChanges,
  loopPosition,
  loopCount,
  allFragments,
}: MixingMirrorProps) {
  const activeMap = new Map(activeLayers.map(a => [a.layerType, a.fragmentId]));
  const pendingSet = new Set(pendingChanges.map(p => p.layerType));
  const fragmentMap = new Map(allFragments.map(f => [f.id, f]));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        padding: '40px',
        boxSizing: 'border-box',
      }}
    >
      {LAYER_ORDER.map(layerType => {
        const layer = getLayerIdentity(layerType);
        const fragmentId = activeMap.get(layerType) ?? null;
        const fragment = fragmentId ? fragmentMap.get(fragmentId) : null;
        const chapter = fragment ? getChapterIdentity(fragment.chapter) : null;
        const isPending = pendingSet.has(layerType);
        const pendingChange = pendingChanges.find(p => p.layerType === layerType);
        const pendingFragment = pendingChange?.fragmentId
          ? fragmentMap.get(pendingChange.fragmentId)
          : null;
        const pendingChapter = pendingFragment ? getChapterIdentity(pendingFragment.chapter) : null;

        return (
          <div
            key={layerType}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: chapter ? chapter.color + '11' : '#111',
              border: isPending
                ? `1px solid ${pendingChapter?.color ?? '#888'}66`
                : chapter
                ? `1px solid ${chapter.color}33`
                : '1px solid #222',
              transition: 'border-color 0.3s ease, background-color 0.3s ease',
              boxShadow: isPending
                ? `0 0 12px ${pendingChapter?.color ?? '#888'}33`
                : 'none',
            }}
          >
            {/* Layer icon */}
            <div
              style={{
                width: '40px',
                flexShrink: 0,
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: '1.2rem', color: layer.color }}>{layer.symbol}</span>
              <div
                style={{
                  fontSize: '0.55rem',
                  color: '#555',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginTop: '2px',
                }}
              >
                {layer.label}
              </div>
            </div>

            {/* Active fragment info */}
            <div style={{ flex: 1 }}>
              {fragment ? (
                <div>
                  <div
                    style={{
                      fontSize: '1rem',
                      fontWeight: 600,
                      color: chapter?.color ?? '#fff',
                    }}
                  >
                    {fragment.displayLabel}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '2px' }}>
                    Song {fragment.attemptIndex + 1} · Option {fragment.option}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#333' }}>—</div>
              )}
            </div>

            {/* Pending indicator */}
            {isPending && pendingFragment && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: (pendingChapter?.color ?? '#888') + '22',
                  border: `1px solid ${pendingChapter?.color ?? '#888'}66`,
                }}
              >
                <span style={{ fontSize: '0.65rem', color: '#888' }}>→</span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: pendingChapter?.color ?? '#888',
                    fontWeight: 600,
                  }}
                >
                  {pendingFragment.displayLabel}
                </span>
              </div>
            )}

            {isPending && !pendingFragment && (
              <div
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: '#222',
                  border: '1px solid #444',
                }}
              >
                <span style={{ fontSize: '0.7rem', color: '#888' }}>→ mute</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Loop indicator */}
      <div style={{ marginTop: '8px' }}>
        <LoopIndicator
          loopPosition={loopPosition}
          loopCount={loopCount}
          pendingCount={pendingChanges.length}
        />
      </div>
    </div>
  );
}

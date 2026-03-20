'use client';

/**
 * MixingSurface (Controller)
 *
 * 7×6 grid: 7 layer types × (3 songs × 2 options) = up to 6 fragment tiles per row.
 * Active fragments are highlighted, pending changes pulse.
 * Tap to queue/dequeue/cancel. Fire button applies all pending at next loop boundary.
 */

import { useState, useEffect } from 'react';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { LoopIndicator } from '@/components/finale/LoopIndicator';
import type { ShowState, ConductorCommand, LayerType, Fragment } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

interface MixingSurfaceProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function MixingSurface({ fullState, sendCommand }: MixingSurfaceProps) {
  const { finaleState } = fullState;
  if (!finaleState || finaleState.phase !== 'performer_mix') return null;

  const { allFragments, performerMix } = finaleState;
  const { activeLayers, pendingChanges, loopPosition, loopCount } = performerMix;

  // Build maps for quick lookup
  const activeMap = new Map<LayerType, string | null>(activeLayers);
  const pendingMap = new Map<LayerType, string | null>(
    pendingChanges.map(p => [p.layerType, p.fragmentId])
  );

  // Group allFragments by layerType, sorted by attemptIndex then option
  const byLayer = new Map<LayerType, Fragment[]>();
  for (const layer of LAYER_ORDER) {
    byLayer.set(
      layer,
      allFragments
        .filter(f => f.layerType === layer)
        .sort((a, b) => a.attemptIndex - b.attemptIndex || a.option.localeCompare(b.option))
    );
  }

  const handleTile = (layerType: LayerType, fragmentId: string) => {
    const activeId = activeMap.get(layerType);
    const pendingId = pendingMap.has(layerType) ? pendingMap.get(layerType) : undefined;

    if (pendingId !== undefined) {
      // There's a pending change for this layer
      if (pendingMap.get(layerType) === fragmentId) {
        // Tap pending tile → cancel
        sendCommand({ type: 'CANCEL_PENDING', layerType });
      } else {
        // Tap different tile → replace pending
        sendCommand({ type: 'QUEUE_FRAGMENT', layerType, fragmentId });
      }
    } else if (activeId === fragmentId) {
      // Tap active tile → queue mute
      sendCommand({ type: 'QUEUE_FRAGMENT', layerType, fragmentId: null });
    } else {
      // Tap available tile → queue activation
      sendCommand({ type: 'QUEUE_FRAGMENT', layerType, fragmentId });
    }
  };

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Mixing Surface</h2>
        <div style={styles.headerRight}>
          {pendingChanges.length > 0 && (
            <button
              onClick={() => sendCommand({ type: 'FIRE_PENDING_CHANGES' })}
              style={styles.fireBtn}
            >
              Fire {pendingChanges.length} change{pendingChanges.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Loop indicator */}
      <div style={{ marginBottom: '12px' }}>
        <LoopIndicator
          loopPosition={loopPosition}
          loopCount={loopCount}
          pendingCount={pendingChanges.length}
        />
      </div>

      {/* Grid */}
      <div style={styles.grid}>
        {LAYER_ORDER.map(layerType => {
          const layer = getLayerIdentity(layerType);
          const fragments = byLayer.get(layerType) ?? [];
          const activeId = activeMap.get(layerType) ?? null;
          const pendingId = pendingMap.has(layerType) ? pendingMap.get(layerType) : undefined;

          return (
            <div key={layerType} style={styles.row}>
              {/* Row label */}
              <div style={styles.rowLabel}>
                <span style={{ fontSize: '0.9rem', color: layer.color }}>{layer.symbol}</span>
                <span style={{ fontSize: '0.55rem', color: '#555', marginTop: '2px' }}>
                  {layer.label}
                </span>
              </div>

              {/* Fragment tiles */}
              <div style={styles.tilesRow}>
                {fragments.map(fragment => {
                  const chapter = getChapterIdentity(fragment.chapter);
                  const isActive = activeId === fragment.id;
                  const isPending = pendingId === fragment.id;
                  const isPendingMute = pendingId === null && pendingMap.has(layerType);

                  return (
                    <FragmentTile
                      key={fragment.id}
                      fragment={fragment}
                      chapterColor={chapter.color}
                      isActive={isActive}
                      isPending={isPending}
                      onTap={() => handleTile(layerType, fragment.id)}
                    />
                  );
                })}

                {/* Mute pending indicator */}
                {pendingId === null && pendingMap.has(layerType) && (
                  <div style={styles.mutePending}>
                    <span style={{ fontSize: '0.65rem', color: '#888' }}>→ mute</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FragmentTile({
  fragment,
  chapterColor,
  isActive,
  isPending,
  onTap,
}: {
  fragment: Fragment;
  chapterColor: string;
  isActive: boolean;
  isPending: boolean;
  onTap: () => void;
}) {
  // Pulsing animation for pending tiles via useState cycling
  const [pulseOpacity, setPulseOpacity] = useState(1);

  useEffect(() => {
    if (!isPending) {
      setPulseOpacity(1);
      return;
    }
    let val = 1;
    let dir = -1;
    const id = setInterval(() => {
      val += dir * 0.08;
      if (val <= 0.4) dir = 1;
      if (val >= 1) dir = -1;
      setPulseOpacity(val);
    }, 50);
    return () => clearInterval(id);
  }, [isPending]);

  return (
    <button
      onClick={onTap}
      style={{
        width: '72px',
        minHeight: '52px',
        padding: '6px',
        borderRadius: '4px',
        border: isActive
          ? `2px solid ${chapterColor}`
          : isPending
          ? `2px dashed ${chapterColor}88`
          : `1px solid ${chapterColor}33`,
        backgroundColor: isActive
          ? chapterColor + '44'
          : isPending
          ? chapterColor + '22'
          : chapterColor + '11',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px',
        opacity: isPending ? pulseOpacity : 1,
        boxShadow: isActive ? `0 0 8px ${chapterColor}55` : 'none',
        transition: isActive ? 'box-shadow 0.2s ease' : 'none',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          fontSize: '0.55rem',
          color: chapterColor,
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        {isActive ? '▶ ' : ''}S{fragment.attemptIndex + 1}{fragment.option}
      </span>
      <span
        style={{
          fontSize: '0.6rem',
          color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
          textAlign: 'center',
          lineHeight: 1.2,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          width: '100%',
          fontWeight: isActive ? 600 : 400,
        }}
      >
        {fragment.displayLabel}
      </span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '16px 20px', borderBottom: '1px solid #2a2a2a' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  fireBtn: {
    padding: '10px 16px',
    fontSize: '0.85rem',
    fontWeight: 700,
    backgroundColor: '#1a4a2a',
    color: '#4ade80',
    border: '1px solid #2d6a3f',
    borderRadius: '6px',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  grid: { display: 'flex', flexDirection: 'column', gap: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px' },
  rowLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '44px',
    flexShrink: 0,
  },
  tilesRow: { display: 'flex', gap: '4px', flexWrap: 'wrap', flex: 1 },
  mutePending: {
    width: '72px',
    minHeight: '52px',
    padding: '6px',
    borderRadius: '4px',
    border: '2px dashed #555',
    backgroundColor: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

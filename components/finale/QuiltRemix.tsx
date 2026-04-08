'use client';

/**
 * QuiltRemix (V3.3)
 *
 * Audience phone view during the playback phase when audienceRemix is enabled.
 * Shows the quilt grid with own cell highlighted and drag-to-move interaction
 * for cell repositioning. Cooldown indicator. Song change UI when allowed.
 */

import { useState, useRef, useCallback } from 'react';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { QuiltGrid } from './QuiltGrid';
import type { QuiltCellView, QuiltGridState } from '@/hooks/useQuilt';
import type { GranularType, Chapter, AudienceRemixConfig } from '@/conductor/types';

const CHAPTER_BY_SONG: Chapter[] = ['ambition', 'love', 'avoidance'];

interface QuiltRemixProps {
  grid: QuiltGridState;
  myCell: QuiltCellView;
  myCellId: string;
  availableSongs: number[];
  granularTypes: GranularType[];
  remixConfig: AudienceRemixConfig;
  lockedCells: Set<string>;
  mutedCells: Set<string>;
  onMoveCell: (targetCellId: string) => void;
  onChangeSong: (songIndex: number) => void;
}

export function QuiltRemix({
  grid,
  myCell,
  myCellId,
  availableSongs,
  granularTypes,
  remixConfig,
  lockedCells,
  mutedCells,
  onMoveCell,
  onChangeSong,
}: QuiltRemixProps) {
  const [cooldownActive, setCooldownActive] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCellTap = useCallback((cellId: string) => {
    if (cellId === myCellId) return; // Tapped own cell
    if (cooldownActive) return;
    if (lockedCells.has(cellId)) return;

    onMoveCell(cellId);

    // Visual cooldown feedback (actual enforcement is server-side)
    if (remixConfig.cooldownLoops > 0) {
      setCooldownActive(true);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      // Rough estimate: ~8 bars at ~120 bpm = ~16s per loop
      cooldownTimerRef.current = setTimeout(() => setCooldownActive(false), 16000 * remixConfig.cooldownLoops);
    }
  }, [myCellId, cooldownActive, lockedCells, onMoveCell, remixConfig.cooldownLoops]);

  const layer = getLayerIdentity(myCell.granularType);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        padding: '8px 12px',
        gap: '12px',
        boxSizing: 'border-box',
      }}
    >
      {/* Cell identity */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span style={{ fontSize: '1rem', color: layer.color }}>{layer.symbol}</span>
        <span
          style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {layer.label}
        </span>
        {myCell.chapter && (
          <span
            style={{
              fontSize: '0.55rem',
              color: getChapterIdentity(myCell.chapter).color,
              letterSpacing: '0.06em',
            }}
          >
            {getChapterIdentity(myCell.chapter).label}
          </span>
        )}
      </div>

      {/* Quilt grid — tappable for moves */}
      <QuiltGrid
        grid={grid}
        variant="audience"
        granularTypes={granularTypes}
        myCellId={myCellId}
        onCellTap={cooldownActive ? undefined : handleCellTap}
        lockedCells={lockedCells}
        mutedCells={mutedCells}
        showPlayhead
      />

      {/* Cooldown indicator */}
      {cooldownActive && (
        <div
          style={{
            fontSize: '0.55rem',
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          COOLDOWN
        </div>
      )}

      {/* Tap hint */}
      {!cooldownActive && (
        <div
          style={{
            fontSize: '0.55rem',
            color: 'rgba(255,255,255,0.15)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          TAP A CELL TO SWAP
        </div>
      )}

      {/* Song change UI (when allowed) */}
      {remixConfig.allowSongChange && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '4px',
          }}
        >
          {availableSongs.map(songIndex => {
            const chapter = CHAPTER_BY_SONG[songIndex];
            const identity = getChapterIdentity(chapter);
            const isSelected = myCell.songIndex === songIndex;

            return (
              <button
                key={songIndex}
                onClick={() => onChangeSong(songIndex)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: isSelected
                    ? `2px solid ${identity.color}`
                    : '1px solid rgba(255,255,255,0.1)',
                  backgroundColor: isSelected
                    ? identity.color + '44'
                    : 'rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: identity.color,
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

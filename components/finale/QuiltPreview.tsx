'use client';

/**
 * QuiltPreview (V3.3)
 *
 * Audience phone view during the preview phase. Room is silent — audience
 * privately explores song options for their cell.
 *
 * Shows: cell position in mini grid, 3 tappable song cards (chapter colors),
 * "LOCK IN" button. Tapping a card plays a private audio preview on the phone.
 */

import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { useAudioPreview } from '@/hooks/useAudioPreview';
import { QuiltGrid } from './QuiltGrid';
import type { QuiltCellView, QuiltGridState } from '@/hooks/useQuilt';
import type { GranularType, Chapter } from '@/conductor/types';

const CHAPTER_BY_SONG: Chapter[] = ['ambition', 'love', 'avoidance'];

interface QuiltPreviewProps {
  grid: QuiltGridState;
  myCell: QuiltCellView;
  myCellId: string;
  availableSongs: number[];
  lockedIn: boolean;
  timerRemaining: number | null;
  granularTypes: GranularType[];
  audioPreviewPath: string;
  onSetSong: (songIndex: number) => void;
  onLockIn: () => void;
}

export function QuiltPreview({
  grid,
  myCell,
  myCellId,
  availableSongs,
  lockedIn,
  timerRemaining,
  granularTypes,
  audioPreviewPath,
  onSetSong,
  onLockIn,
}: QuiltPreviewProps) {
  const audio = useAudioPreview();
  const layer = getLayerIdentity(myCell.granularType);

  const handleSongTap = (songIndex: number) => {
    onSetSong(songIndex);
    // Play private audio preview: preview-{songIndex}-{granularType}-A.mp3
    const url = `${audioPreviewPath}/preview-${songIndex}-${myCell.granularType}-A.mp3`;
    audio.play(`preview-${songIndex}-${myCell.granularType}`, url);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        padding: '12px 16px',
        gap: '16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Timer */}
      {timerRemaining !== null && (
        <div
          style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {Math.ceil(timerRemaining / 1000)}s
        </div>
      )}

      {/* Cell position label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '1.2rem', color: layer.color }}>{layer.symbol}</span>
        <span
          style={{
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {layer.label} — Col {myCell.columnIndex + 1}
        </span>
      </div>

      {/* Mini quilt grid showing cell position */}
      <div style={{ transform: 'scale(0.65)', transformOrigin: 'center', margin: '-16px 0' }}>
        <QuiltGrid
          grid={grid}
          variant="audience"
          granularTypes={granularTypes}
          myCellId={myCellId}
        />
      </div>

      {/* Song cards */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        {availableSongs.map(songIndex => {
          const chapter = CHAPTER_BY_SONG[songIndex];
          const identity = getChapterIdentity(chapter);
          const isSelected = myCell.songIndex === songIndex;
          const isPlaying = audio.currentId === `preview-${songIndex}-${myCell.granularType}` && audio.isPlaying;

          return (
            <button
              key={songIndex}
              onClick={() => handleSongTap(songIndex)}
              disabled={lockedIn}
              style={{
                flex: 1,
                maxWidth: '100px',
                padding: '14px 8px',
                borderRadius: '8px',
                border: isSelected
                  ? `2px solid ${identity.color}`
                  : '1px solid rgba(255,255,255,0.1)',
                backgroundColor: isSelected
                  ? identity.color + '33'
                  : 'rgba(255,255,255,0.04)',
                color: isSelected ? identity.color : 'rgba(255,255,255,0.5)',
                cursor: lockedIn ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                opacity: lockedIn && !isSelected ? 0.3 : 1,
                transition: 'all 0.2s ease',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            >
              {/* Chapter color dot */}
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: identity.color,
                  boxShadow: isPlaying ? `0 0 8px ${identity.color}` : 'none',
                }}
              />
              {/* Chapter label */}
              <span
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {identity.label}
              </span>
              {/* Playing indicator */}
              {isPlaying && (
                <span
                  style={{
                    fontSize: '0.5rem',
                    color: identity.color,
                    letterSpacing: '0.08em',
                  }}
                >
                  PLAYING
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Lock in button */}
      {!lockedIn ? (
        <button
          onClick={onLockIn}
          disabled={myCell.songIndex === null}
          style={{
            padding: '12px 32px',
            borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.3)',
            backgroundColor: myCell.songIndex !== null ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: myCell.songIndex !== null ? '#fff' : 'rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: myCell.songIndex !== null ? 'pointer' : 'default',
            fontFamily: 'inherit',
            transition: 'all 0.2s ease',
          }}
        >
          LOCK IN
        </button>
      ) : (
        <div
          style={{
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          LOCKED IN
        </div>
      )}
    </div>
  );
}

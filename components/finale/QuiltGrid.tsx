'use client';

/**
 * QuiltGrid (V3.3)
 *
 * Renders the 6×N quilt grid. Cells show chapter color (amber/coral/teal) when
 * a song is chosen, dim when empty. Supports both audience phone (compact) and
 * projector (large) layouts via variant prop.
 *
 * During assignment: cells are tappable to claim. During playback: playhead
 * sweeps across columns. Locked/muted cells show indicators.
 */

import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { QuiltCellView, QuiltGridState } from '@/hooks/useQuilt';
import type { GranularType, LayerType, ArcPhase } from '@/conductor/types';

const ROW_ORDER: LayerType[] = ['bass', 'drums', 'pad', 'seed', 'harmony', 'fx'];

interface QuiltGridProps {
  grid: QuiltGridState;
  variant: 'audience' | 'projector';
  granularTypes: GranularType[];
  // Interaction
  myCellId?: string | null;
  onCellTap?: (cellId: string) => void;
  // State decorations
  lockedCells?: Set<string>;
  mutedCells?: Set<string>;
  // Playback
  showPlayhead?: boolean;
  // Arc
  arcPhase?: ArcPhase | null;
  /** Granular types that have entered (during arc entry phase). Null = all entered. */
  enteredTypes?: Set<string> | null;
}

export function QuiltGrid({
  grid,
  variant,
  granularTypes,
  myCellId,
  onCellTap,
  lockedCells,
  mutedCells,
  showPlayhead = false,
  arcPhase,
  enteredTypes,
}: QuiltGridProps) {
  const isProjector = variant === 'projector';
  const cellSize = isProjector ? 80 : 44;
  const gap = isProjector ? 6 : 3;
  const headerWidth = isProjector ? 56 : 32;

  // Build row → cells mapping sorted by columnOrder
  const cellsByRow = new Map<number, QuiltCellView[]>();
  for (const cell of grid.cells) {
    const arr = cellsByRow.get(cell.rowIndex) ?? [];
    arr.push(cell);
    cellsByRow.set(cell.rowIndex, arr);
  }
  // Sort cells within each row by column order position
  const colOrderMap = new Map(grid.columnOrder.map((col, i) => [col, i]));
  for (const [, cells] of cellsByRow) {
    cells.sort((a, b) => (colOrderMap.get(a.columnIndex) ?? 0) - (colOrderMap.get(b.columnIndex) ?? 0));
  }

  // Determine row rendering order from granularTypes config
  const rowOrder = granularTypes.length > 0
    ? granularTypes.map((_, i) => i)
    : Array.from({ length: grid.rows }, (_, i) => i);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: `${gap}px`,
        padding: isProjector ? '24px' : '8px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Column playhead indicator */}
      {showPlayhead && (
        <div
          style={{
            display: 'flex',
            gap: `${gap}px`,
            paddingLeft: `${headerWidth + gap}px`,
          }}
        >
          {grid.columnOrder.map((colIdx) => {
            const isActive = colIdx === grid.playheadColumn;
            return (
              <div
                key={colIdx}
                style={{
                  width: cellSize,
                  height: isProjector ? 6 : 3,
                  borderRadius: 2,
                  backgroundColor: isActive ? '#fff' : 'rgba(255,255,255,0.08)',
                  transition: 'background-color 0.15s ease',
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>
      )}

      {rowOrder.map(rowIndex => {
        const cells = cellsByRow.get(rowIndex) ?? [];
        const gt = granularTypes[rowIndex];
        const layerId = gt?.id ?? ROW_ORDER[rowIndex] ?? 'bass';
        const layer = getLayerIdentity(layerId);

        // During arc entry, dim rows that haven't entered yet
        const isRowEntered = !enteredTypes || enteredTypes.has(layerId);
        const rowDimmed = arcPhase === 'entry' && !isRowEntered;
        // During arc exit, dim rows that have exited (handled via muted cells in practice)

        return (
          <div
            key={rowIndex}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: `${gap}px`,
              opacity: rowDimmed ? 0.2 : 1,
              transition: 'opacity 0.5s ease',
            }}
          >
            {/* Row header */}
            <div
              style={{
                width: headerWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontSize: isProjector ? '1.2rem' : '0.8rem',
                  color: layer.color,
                  lineHeight: 1,
                }}
              >
                {layer.symbol}
              </span>
              {isProjector && (
                <span
                  style={{
                    fontSize: '0.5rem',
                    color: 'rgba(255,255,255,0.35)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginTop: '2px',
                    textAlign: 'center',
                    lineHeight: 1.1,
                  }}
                >
                  {layer.label}
                </span>
              )}
            </div>

            {/* Cells */}
            {cells.map(cell => (
              <QuiltCellTile
                key={cell.id}
                cell={cell}
                size={cellSize}
                isProjector={isProjector}
                isMine={cell.id === myCellId}
                isLocked={lockedCells?.has(cell.id) ?? false}
                isMuted={mutedCells?.has(cell.id) ?? false}
                isPlayheadColumn={showPlayhead && cell.columnIndex === grid.playheadColumn}
                onTap={onCellTap ? () => onCellTap(cell.id) : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell tile
// ---------------------------------------------------------------------------

function QuiltCellTile({
  cell,
  size,
  isProjector,
  isMine,
  isLocked,
  isMuted,
  isPlayheadColumn,
  onTap,
}: {
  cell: QuiltCellView;
  size: number;
  isProjector: boolean;
  isMine: boolean;
  isLocked: boolean;
  isMuted: boolean;
  isPlayheadColumn: boolean;
  onTap?: () => void;
}) {
  const hasSong = cell.songIndex !== null && cell.chapter !== null;
  const isClaimed = cell.ownerId !== null;
  const chapter = cell.chapter ? getChapterIdentity(cell.chapter) : null;
  const bgColor = hasSong ? chapter!.color : (isClaimed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)');

  return (
    <div
      onClick={onTap}
      style={{
        width: size,
        height: size,
        borderRadius: isProjector ? 6 : 3,
        backgroundColor: isMuted ? 'rgba(255,255,255,0.03)' : bgColor,
        border: isMine
          ? '2px solid rgba(255,255,255,0.8)'
          : isPlayheadColumn
            ? `1px solid rgba(255,255,255,0.25)`
            : '1px solid rgba(255,255,255,0.06)',
        opacity: isMuted ? 0.3 : 1,
        cursor: onTap ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease',
        boxShadow: isPlayheadColumn && hasSong && !isMuted
          ? `0 0 ${isProjector ? 12 : 6}px ${chapter!.color}44`
          : 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* Lock icon */}
      {isLocked && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            fontSize: isProjector ? '0.6rem' : '0.45rem',
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1,
          }}
        >
          {'\u{1F512}'}
        </span>
      )}

      {/* "Mine" dot indicator for audience */}
      {isMine && !isProjector && (
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: '#fff',
          }}
        />
      )}
    </div>
  );
}

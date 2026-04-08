'use client';

/**
 * QuiltGrid (V3.3)
 *
 * Renders the 6×N quilt grid with absolute positioning so cells can animate
 * between positions during sorting. Cells are keyed by ownerId (stable across
 * sorts) so React preserves DOM nodes → CSS transitions handle the movement.
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
  const playheadHeight = showPlayhead ? (isProjector ? 6 : 3) + gap : 0;
  const padding = isProjector ? 24 : 8;

  // Map column index → visual position (respects columnOrder)
  const colOrderMap = new Map(grid.columnOrder.map((col, i) => [col, i]));

  // Determine row order from granularTypes config
  const rowOrder = granularTypes.length > 0
    ? granularTypes.map((_, i) => i)
    : Array.from({ length: grid.rows }, (_, i) => i);

  // Total container size
  const totalWidth = headerWidth + gap + grid.columns * (cellSize + gap) - gap;
  const totalHeight = playheadHeight + grid.rows * (cellSize + gap) - gap;

  // Compute cell position
  function cellX(columnIndex: number): number {
    const visualCol = colOrderMap.get(columnIndex) ?? 0;
    return headerWidth + gap + visualCol * (cellSize + gap);
  }
  function cellY(rowIndex: number): number {
    return playheadHeight + rowIndex * (cellSize + gap);
  }

  return (
    <div
      style={{
        position: 'relative',
        width: totalWidth + padding * 2,
        height: totalHeight + padding * 2,
        padding,
        boxSizing: 'border-box',
      }}
    >
      {/* Column playhead indicator */}
      {showPlayhead && grid.columnOrder.map((colIdx) => {
        const isActive = colIdx === grid.playheadColumn;
        return (
          <div
            key={`ph-${colIdx}`}
            style={{
              position: 'absolute',
              left: padding + cellX(colIdx),
              top: padding,
              width: cellSize,
              height: isProjector ? 6 : 3,
              borderRadius: 2,
              backgroundColor: isActive ? '#fff' : 'rgba(255,255,255,0.08)',
              transition: 'background-color 0.15s ease',
            }}
          />
        );
      })}

      {/* Row headers (fixed position) */}
      {rowOrder.map(rowIndex => {
        const gt = granularTypes[rowIndex];
        const layerId = gt?.id ?? ROW_ORDER[rowIndex] ?? 'bass';
        const layer = getLayerIdentity(layerId);
        const isRowEntered = !enteredTypes || enteredTypes.has(layerId);
        const rowDimmed = arcPhase === 'entry' && !isRowEntered;

        return (
          <div
            key={`hdr-${rowIndex}`}
            style={{
              position: 'absolute',
              left: padding,
              top: padding + cellY(rowIndex),
              width: headerWidth,
              height: cellSize,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: rowDimmed ? 0.2 : 1,
              transition: 'opacity 0.5s ease',
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
        );
      })}

      {/* Cells (absolute positioned, keyed by owner for animation) */}
      {grid.cells.map(cell => {
        const gt = granularTypes[cell.rowIndex];
        const layerId = gt?.id ?? ROW_ORDER[cell.rowIndex] ?? 'bass';
        const isRowEntered = !enteredTypes || enteredTypes.has(layerId);
        const rowDimmed = arcPhase === 'entry' && !isRowEntered;

        // Stable key: ownerId for owned cells, position-based for empty
        const stableKey = cell.ownerId ?? `empty-${cell.id}`;

        return (
          <QuiltCellTile
            key={stableKey}
            cell={cell}
            size={cellSize}
            x={padding + cellX(cell.columnIndex)}
            y={padding + cellY(cell.rowIndex)}
            isProjector={isProjector}
            isMine={cell.id === myCellId}
            isLocked={lockedCells?.has(cell.id) ?? false}
            isMuted={mutedCells?.has(cell.id) ?? false}
            isPlayheadColumn={showPlayhead && cell.columnIndex === grid.playheadColumn}
            rowDimmed={rowDimmed}
            onTap={onCellTap ? () => onCellTap(cell.id) : undefined}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell tile (absolutely positioned with CSS transitions for sort animation)
// ---------------------------------------------------------------------------

function QuiltCellTile({
  cell,
  size,
  x,
  y,
  isProjector,
  isMine,
  isLocked,
  isMuted,
  isPlayheadColumn,
  rowDimmed,
  onTap,
}: {
  cell: QuiltCellView;
  size: number;
  x: number;
  y: number;
  isProjector: boolean;
  isMine: boolean;
  isLocked: boolean;
  isMuted: boolean;
  isPlayheadColumn: boolean;
  rowDimmed: boolean;
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
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: isProjector ? 6 : 3,
        backgroundColor: isMuted ? 'rgba(255,255,255,0.03)' : bgColor,
        border: isMine
          ? '2px solid rgba(255,255,255,0.8)'
          : isPlayheadColumn
            ? '1px solid rgba(255,255,255,0.25)'
            : '1px solid rgba(255,255,255,0.06)',
        opacity: rowDimmed ? 0.2 : (isMuted ? 0.3 : 1),
        cursor: onTap ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Sort animation: left/top transitions for position changes
        transition: 'left 0.5s ease, top 0.5s ease, background-color 0.2s ease, border-color 0.2s ease, opacity 0.3s ease',
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

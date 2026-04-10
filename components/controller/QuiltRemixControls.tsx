'use client';

/**
 * QuiltRemixControls (V3.3)
 *
 * Performer controller interface for quilt remix during finale phases.
 * Full quilt grid with per-cell actions: lock/unlock, mute/unmute, override song.
 * Column reorder and cell swap via click-to-select workflow.
 */

import { useState, useCallback } from 'react';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { ShowState, ConductorCommand, QuiltCell, V33FinaleState, Chapter } from '@/conductor/types';

const CHAPTER_BY_SONG: Chapter[] = ['ambition', 'love', 'avoidance'];

interface QuiltRemixControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function QuiltRemixControls({ fullState, sendCommand }: QuiltRemixControlsProps) {
  const fs = fullState.finaleState as V33FinaleState | null;
  if (!fs) return null;

  const granularTypes = fullState.config.granularTypes ?? [];
  const { quilt } = fs;
  const cells = Array.from(quilt.cells.values());

  // Build row → cells mapping sorted by columnOrder
  const cellsByRow = new Map<number, QuiltCell[]>();
  for (const cell of cells) {
    const arr = cellsByRow.get(cell.rowIndex) ?? [];
    arr.push(cell);
    cellsByRow.set(cell.rowIndex, arr);
  }
  const colOrderMap = new Map(quilt.columnOrder.map((col, i) => [col, i]));
  for (const [, rowCells] of cellsByRow) {
    rowCells.sort((a, b) => (colOrderMap.get(a.columnIndex) ?? 0) - (colOrderMap.get(b.columnIndex) ?? 0));
  }

  const rowOrder = granularTypes.length > 0
    ? granularTypes.map((_, i) => i)
    : Array.from({ length: quilt.rows }, (_, i) => i);

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Quilt Remix</h2>

      {/* Phase action buttons */}
      <PhaseActions phase={fs.phase} sendCommand={sendCommand} />

      {/* Column reorder controls */}
      <ColumnReorder
        columnOrder={quilt.columnOrder}
        playheadColumn={quilt.playheadColumn}
        sendCommand={sendCommand}
      />

      {/* Freeze column controls */}
      {fs.phase === 'playback' && (
        <FreezeColumnControls
          columnOrder={quilt.columnOrder}
          playheadColumn={quilt.playheadColumn}
          frozenColumn={fs.remix.frozenColumn}
          sendCommand={sendCommand}
        />
      )}

      {/* Quilt grid with per-cell actions */}
      <div style={styles.gridContainer}>
        {/* Column headers */}
        <div style={{ display: 'flex', gap: '2px', paddingLeft: '72px', marginBottom: '4px' }}>
          {quilt.columnOrder.map((colIdx) => (
            <div
              key={colIdx}
              style={{
                width: 72,
                textAlign: 'center',
                fontSize: '0.6rem',
                color: colIdx === quilt.playheadColumn ? '#fff' : 'rgba(255,255,255,0.3)',
                fontWeight: colIdx === quilt.playheadColumn ? 700 : 400,
              }}
            >
              Col {colIdx + 1}
              {colIdx === quilt.playheadColumn && ' \u25B6'}
              {colIdx === fs.remix.frozenColumn && ' *'}
            </div>
          ))}
        </div>

        {rowOrder.map(rowIndex => {
          const rowCells = cellsByRow.get(rowIndex) ?? [];
          const gt = granularTypes[rowIndex];
          const layerId = gt?.id ?? 'bass';
          const layer = getLayerIdentity(layerId);

          return (
            <div key={rowIndex} style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '2px' }}>
              {/* Row header */}
              <div style={{ width: 70, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '1rem', color: layer.color }}>{layer.symbol}</span>
                <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {layer.label}
                </span>
              </div>

              {/* Cells */}
              {rowCells.map(cell => (
                <CellTile
                  key={cell.id}
                  cell={cell}
                  finaleState={fs}
                  availableSongs={fs.availableSongs}
                  sendCommand={sendCommand}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Sort + Simulate tools */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => sendCommand({ type: 'TRIGGER_SORT' })}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid rgba(124, 58, 237, 0.5)',
            background: 'rgba(124, 58, 237, 0.15)',
            color: '#c4b5fd',
            fontSize: '0.8rem',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Sort Grid
        </button>
        <SimulateGridTool sendCommand={sendCommand} />
      </div>
      <SwapTool cells={cells} sendCommand={sendCommand} />

      {/* Stats */}
      <div style={styles.statsRow}>
        <span style={styles.statItem}>Cells: {cells.length}</span>
        <span style={styles.statItem}>Claimed: {cells.filter(c => c.ownerId !== null).length}</span>
        <span style={styles.statItem}>Songs set: {cells.filter(c => c.songIndex !== null).length}</span>
        <span style={styles.statItem}>Locked: {fs.remix.lockedCells.size}</span>
        <span style={styles.statItem}>Muted: {fs.remix.mutedCells.size}</span>
        <span style={styles.statItem}>Loop: {quilt.loopCount}</span>
        {fs.arc && (
          <span style={{ ...styles.statItem, color: '#7c3aed', fontWeight: 600 }}>
            Arc: {fs.arc.phase}{fs.arc.schedule.sortMode === 'multi_pass' && fs.arc.phase === 'sorted_playback' ? ` (pass ${fs.arc.currentPassIndex + 1}/${fs.arc.schedule.sortedPassCount})` : ''}
          </span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase action buttons
// ---------------------------------------------------------------------------

function PhaseActions({
  phase,
  sendCommand,
}: {
  phase: V33FinaleState['phase'];
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  return (
    <div style={styles.buttonRow}>
      {phase === 'elegy' && (
        <button
          onClick={() => sendCommand({ type: 'START_ASSIGNMENT' })}
          style={{ ...styles.btn, ...styles.btnPrimary }}
        >
          Start Assignment
        </button>
      )}
      {phase === 'assignment' && (
        <>
          <button
            onClick={() => sendCommand({ type: 'ASSIGNMENT_COMPLETE' })}
            style={{ ...styles.btn, ...styles.btnPrimary }}
          >
            Complete Assignment
          </button>
          <button
            onClick={() => sendCommand({ type: 'START_PREVIEW' })}
            style={{ ...styles.btn, ...styles.btnSecondary }}
          >
            Skip to Preview
          </button>
        </>
      )}
      {phase === 'preview' && (
        <>
          <button
            onClick={() => sendCommand({ type: 'PREVIEW_COMPLETE' })}
            style={{ ...styles.btn, ...styles.btnPrimary }}
          >
            Complete Preview
          </button>
          <button
            onClick={() => sendCommand({ type: 'START_PLAYBACK' })}
            style={{ ...styles.btn, ...styles.btnSecondary }}
          >
            Skip to Playback
          </button>
        </>
      )}
      {phase === 'playback' && (
        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>
          LIVE — Playback active
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column reorder
// ---------------------------------------------------------------------------

function ColumnReorder({
  columnOrder,
  playheadColumn,
  sendCommand,
}: {
  columnOrder: number[];
  playheadColumn: number;
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const handleMove = (fromIndex: number, direction: -1 | 1) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= columnOrder.length) return;
    sendCommand({ type: 'REORDER_COLUMN', fromIndex, toIndex });
  };

  return (
    <div style={{ ...styles.subsection, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={styles.subLabel}>Column order:</span>
      {columnOrder.map((colIdx, orderIdx) => (
        <div key={colIdx} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={() => handleMove(orderIdx, -1)}
            disabled={orderIdx === 0}
            style={styles.arrowBtn}
            title="Move left"
          >
            {'<'}
          </button>
          <span style={{
            padding: '2px 8px',
            borderRadius: '3px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor: colIdx === playheadColumn ? '#7c3aed' : '#222',
            color: colIdx === playheadColumn ? '#fff' : 'rgba(255,255,255,0.5)',
            border: '1px solid #444',
            minWidth: '24px',
            textAlign: 'center',
          }}>
            {colIdx + 1}
          </span>
          <button
            onClick={() => handleMove(orderIdx, 1)}
            disabled={orderIdx === columnOrder.length - 1}
            style={styles.arrowBtn}
            title="Move right"
          >
            {'>'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Freeze column — loop a single column for simpler mixing
// ---------------------------------------------------------------------------

function FreezeColumnControls({
  columnOrder,
  playheadColumn,
  frozenColumn,
  sendCommand,
}: {
  columnOrder: number[];
  playheadColumn: number;
  frozenColumn: number | null;
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  return (
    <div style={{ ...styles.subsection, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={styles.subLabel}>Freeze column:</span>
      {frozenColumn !== null && (
        <button
          onClick={() => sendCommand({ type: 'UNFREEZE_COLUMN' })}
          style={{
            ...styles.arrowBtn,
            backgroundColor: '#dc2626',
            color: '#fff',
            padding: '2px 10px',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}
        >
          Unfreeze
        </button>
      )}
      {columnOrder.map((colIdx) => {
        const isFrozen = frozenColumn === colIdx;
        const isPlayhead = playheadColumn === colIdx;
        return (
          <button
            key={colIdx}
            onClick={() => {
              if (isFrozen) {
                sendCommand({ type: 'UNFREEZE_COLUMN' });
              } else {
                sendCommand({ type: 'FREEZE_COLUMN', columnIndex: colIdx });
              }
            }}
            style={{
              padding: '2px 8px',
              borderRadius: '3px',
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: isFrozen ? '#2563eb' : '#222',
              color: isFrozen ? '#fff' : isPlayhead ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
              border: isFrozen ? '2px solid #60a5fa' : '1px solid #444',
              minWidth: '24px',
              textAlign: 'center' as const,
              cursor: 'pointer',
            }}
            title={isFrozen ? `Unfreeze column ${colIdx + 1}` : `Freeze column ${colIdx + 1}`}
          >
            {colIdx + 1}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-cell tile with action popup
// ---------------------------------------------------------------------------

function CellTile({
  cell,
  finaleState,
  availableSongs,
  sendCommand,
}: {
  cell: QuiltCell;
  finaleState: V33FinaleState;
  availableSongs: number[];
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const isLocked = finaleState.remix.lockedCells.has(cell.id);
  const isMuted = finaleState.remix.mutedCells.has(cell.id);
  const hasSong = cell.songIndex !== null && cell.chapter !== null;
  const isClaimed = cell.ownerId !== null;
  const chapter = cell.chapter ? getChapterIdentity(cell.chapter) : null;

  const bgColor = isMuted
    ? 'rgba(255,255,255,0.03)'
    : hasSong
      ? chapter!.color + '55'
      : isClaimed
        ? 'rgba(255,255,255,0.1)'
        : 'rgba(255,255,255,0.03)';

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setShowMenu(!showMenu)}
        style={{
          width: 72,
          height: 48,
          borderRadius: 4,
          backgroundColor: bgColor,
          border: isLocked
            ? '2px solid #fbbf24'
            : isMuted
              ? '1px dashed #555'
              : '1px solid rgba(255,255,255,0.08)',
          opacity: isMuted ? 0.4 : 1,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1px',
          fontSize: '0.5rem',
          color: 'rgba(255,255,255,0.6)',
          boxSizing: 'border-box',
          transition: 'background-color 0.15s ease',
        }}
      >
        {/* Song indicator */}
        {hasSong && (
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: chapter!.color,
          }} />
        )}
        {/* Status icons */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {isLocked && <span title="Locked">{'\u{1F512}'}</span>}
          {isMuted && <span title="Muted" style={{ opacity: 0.7 }}>M</span>}
        </div>
        {/* Owner indicator */}
        {isClaimed && !hasSong && (
          <span style={{ fontSize: '0.45rem', color: 'rgba(255,255,255,0.3)' }}>claimed</span>
        )}
      </div>

      {/* Action menu */}
      {showMenu && (
        <CellMenu
          cell={cell}
          isLocked={isLocked}
          isMuted={isMuted}
          availableSongs={availableSongs}
          sendCommand={sendCommand}
          onClose={() => setShowMenu(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell action menu
// ---------------------------------------------------------------------------

function CellMenu({
  cell,
  isLocked,
  isMuted,
  availableSongs,
  sendCommand,
  onClose,
}: {
  cell: QuiltCell;
  isLocked: boolean;
  isMuted: boolean;
  availableSongs: number[];
  sendCommand: (cmd: ConductorCommand) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 20,
        backgroundColor: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: 6,
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        minWidth: '120px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ fontSize: '0.55rem', color: '#666', padding: '2px 4px', letterSpacing: '0.06em' }}>
        {cell.id} {cell.granularType}
      </div>

      {/* Lock / Unlock */}
      <MenuButton
        label={isLocked ? 'Unlock' : 'Lock'}
        color={isLocked ? '#4ade80' : '#fbbf24'}
        onClick={() => {
          sendCommand(isLocked
            ? { type: 'UNLOCK_CELL', cellId: cell.id }
            : { type: 'LOCK_CELL', cellId: cell.id });
          onClose();
        }}
      />

      {/* Mute / Unmute */}
      <MenuButton
        label={isMuted ? 'Unmute' : 'Mute'}
        color={isMuted ? '#4ade80' : '#f87171'}
        onClick={() => {
          sendCommand(isMuted
            ? { type: 'UNMUTE_CELL', cellId: cell.id }
            : { type: 'MUTE_CELL', cellId: cell.id });
          onClose();
        }}
      />

      {/* Override song */}
      <div style={{ borderTop: '1px solid #333', paddingTop: '3px', marginTop: '2px' }}>
        <div style={{ fontSize: '0.5rem', color: '#666', padding: '1px 4px' }}>Override Song</div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {availableSongs.map(songIndex => {
            const ch = CHAPTER_BY_SONG[songIndex];
            const identity = getChapterIdentity(ch);
            const isActive = cell.songIndex === songIndex;
            return (
              <button
                key={songIndex}
                onClick={() => {
                  sendCommand({ type: 'OVERRIDE_CELL_SONG', cellId: cell.id, songIndex });
                  onClose();
                }}
                style={{
                  width: 28,
                  height: 24,
                  borderRadius: 3,
                  border: isActive ? `2px solid ${identity.color}` : '1px solid #444',
                  backgroundColor: isActive ? identity.color + '44' : '#222',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
                title={identity.label}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: identity.color }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Close */}
      <MenuButton label="Close" color="#666" onClick={onClose} />
    </div>
  );
}

function MenuButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 8px',
        fontSize: '0.7rem',
        fontWeight: 600,
        color,
        backgroundColor: '#222',
        border: '1px solid #333',
        borderRadius: 3,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Simulate grid tool — generate random grid for testing
// ---------------------------------------------------------------------------

function SimulateGridTool({
  sendCommand,
}: {
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const [count, setCount] = useState(24);

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <input
        type="number"
        min={6}
        max={72}
        value={count}
        onChange={e => setCount(Math.max(6, Math.min(72, parseInt(e.target.value) || 6)))}
        style={{
          width: 48,
          padding: '5px 6px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)',
          color: '#e5e7eb',
          fontSize: '0.8rem',
          textAlign: 'center',
        }}
      />
      <button
        onClick={() => sendCommand({ type: 'SIMULATE_FINALE_GRID', audienceCount: count })}
        style={{
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid rgba(34, 197, 94, 0.5)',
          background: 'rgba(34, 197, 94, 0.15)',
          color: '#86efac',
          fontSize: '0.8rem',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Simulate Grid
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swap tool — select two cells to swap
// ---------------------------------------------------------------------------

function SwapTool({
  cells,
  sendCommand,
}: {
  cells: QuiltCell[];
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const [cellA, setCellA] = useState<string | null>(null);
  const [cellB, setCellB] = useState<string | null>(null);

  const handleSwap = useCallback(() => {
    if (!cellA || !cellB || cellA === cellB) return;
    sendCommand({ type: 'SWAP_CELLS', cellIdA: cellA, cellIdB: cellB });
    setCellA(null);
    setCellB(null);
  }, [cellA, cellB, sendCommand]);

  const cellIds = cells.map(c => c.id).sort();

  return (
    <div style={{ ...styles.subsection, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={styles.subLabel}>Swap cells:</span>
      <select
        value={cellA ?? ''}
        onChange={e => setCellA(e.target.value || null)}
        style={styles.selectSmall}
      >
        <option value="">Cell A</option>
        {cellIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <span style={{ color: '#666' }}>{'\u2194'}</span>
      <select
        value={cellB ?? ''}
        onChange={e => setCellB(e.target.value || null)}
        style={styles.selectSmall}
      >
        <option value="">Cell B</option>
        {cellIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <button
        onClick={handleSwap}
        disabled={!cellA || !cellB || cellA === cellB}
        style={{
          ...styles.btn,
          ...styles.btnSecondary,
          padding: '6px 12px',
          fontSize: '0.75rem',
          opacity: (!cellA || !cellB || cellA === cellB) ? 0.4 : 1,
        }}
      >
        Swap
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  section: {
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginBottom: '12px',
  },
  gridContainer: {
    overflowX: 'auto' as const,
    padding: '8px 0',
  },
  subsection: {
    marginTop: '10px',
    padding: '8px 0',
  },
  subLabel: {
    fontSize: '0.7rem',
    color: '#888',
    fontWeight: 600,
  },
  statsRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const,
    marginTop: '10px',
    padding: '6px 0',
  },
  statItem: {
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.4)',
  },
  btn: {
    padding: '10px 16px',
    fontSize: '0.85rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnPrimary: {
    backgroundColor: '#f0f0f0',
    color: '#111',
  } as React.CSSProperties,
  btnSecondary: {
    backgroundColor: '#222',
    color: '#f0f0f0',
    border: '1px solid #444',
  } as React.CSSProperties,
  btnDanger: {
    backgroundColor: '#450a0a',
    color: '#f87171',
    border: '1px solid #7f1d1d',
  } as React.CSSProperties,
  arrowBtn: {
    width: 20,
    height: 20,
    padding: 0,
    backgroundColor: '#222',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid #444',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: '0.65rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  selectSmall: {
    padding: '4px 8px',
    backgroundColor: '#1a1a1a',
    color: '#f0f0f0',
    border: '1px solid #444',
    borderRadius: 4,
    fontSize: '0.75rem',
    cursor: 'pointer',
  } as React.CSSProperties,
};

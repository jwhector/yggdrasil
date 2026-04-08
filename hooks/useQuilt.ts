/**
 * useQuilt Hook (V3.3)
 *
 * Manages quilt state for audience and projector during finale phases.
 * Subscribes to quilt_state, cell_claimed, cell_moved, playhead_update,
 * column_reordered socket events. Emits claim_cell, release_cell, set_song,
 * lock_in, move_cell, change_song.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudienceFinaleView, ProjectorFinaleView, Chapter, UserId } from '@/conductor/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuiltCellView {
  id: string;
  rowIndex: number;
  columnIndex: number;
  granularType: string;
  songIndex: number | null;
  chapter: Chapter | null;
  ownerId: UserId | null;
}

export interface QuiltGridState {
  rows: number;
  columns: number;
  cells: QuiltCellView[];
  columnOrder: number[];
  playheadColumn: number;
}

export interface UseQuiltReturn {
  grid: QuiltGridState | null;
  myCellId: string | null;
  myCell: QuiltCellView | null;
  lockedIn: boolean;
  availableSongs: number[];
  lockedCells: Set<string>;
  mutedCells: Set<string>;
  assignmentTimerRemaining: number | null;
  previewTimerRemaining: number | null;
  // Actions
  claimCell: (cellId: string) => void;
  releaseCell: () => void;
  setSong: (songIndex: number) => void;
  lockIn: () => void;
  moveCell: (targetCellId: string) => void;
  changeSong: (songIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Input can be audience or projector finale view — both have quilt grid data. */
type QuiltInput = AudienceFinaleView | ProjectorFinaleView | null;

export function useQuilt(
  socket: Socket | null,
  myFinale: QuiltInput,
): UseQuiltReturn {
  // High-frequency quilt state from dedicated socket events
  const [hfGrid, setHfGrid] = useState<QuiltGridState | null>(null);
  const [hfPlayhead, setHfPlayhead] = useState<number | null>(null);
  const [hfColumnOrder, setHfColumnOrder] = useState<number[] | null>(null);

  // Subscribe to high-frequency quilt events
  useEffect(() => {
    if (!socket) return;

    const handleQuiltState = (data: {
      cells: QuiltCellView[];
      columnOrder: number[];
      playheadColumn: number;
      rows?: number;
      columns?: number;
    }) => {
      setHfGrid({
        rows: data.rows ?? 6,
        columns: data.columns ?? data.columnOrder.length,
        cells: data.cells,
        columnOrder: data.columnOrder,
        playheadColumn: data.playheadColumn,
      });
    };

    const handleCellClaimed = (data: { cellId: string; userId: string }) => {
      setHfGrid(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          cells: prev.cells.map(c =>
            c.id === data.cellId ? { ...c, ownerId: data.userId } : c
          ),
        };
      });
    };

    const handleCellMoved = (data: {
      cellId: string;
      fromPosition: { row: number; col: number };
      toPosition: { row: number; col: number };
      swappedWithCellId: string | null;
    }) => {
      // Full state will arrive via quilt_state; this is for optimistic feedback
      // No-op — rely on quilt_state for authoritative grid updates
    };

    const handlePlayheadUpdate = (data: { columnIndex: number }) => {
      setHfPlayhead(data.columnIndex);
    };

    const handleColumnReordered = (data: { columnOrder: number[] }) => {
      setHfColumnOrder(data.columnOrder);
    };

    socket.on('quilt_state', handleQuiltState);
    socket.on('cell_claimed', handleCellClaimed);
    socket.on('cell_moved', handleCellMoved);
    socket.on('playhead_update', handlePlayheadUpdate);
    socket.on('column_reordered', handleColumnReordered);

    return () => {
      socket.off('quilt_state', handleQuiltState);
      socket.off('cell_claimed', handleCellClaimed);
      socket.off('cell_moved', handleCellMoved);
      socket.off('playhead_update', handlePlayheadUpdate);
      socket.off('column_reordered', handleColumnReordered);
    };
  }, [socket]);

  // Clear HF state when finale phase changes away from quilt phases
  const phaseRef = useRef(myFinale?.finalePhase);
  useEffect(() => {
    if (myFinale?.finalePhase !== phaseRef.current) {
      phaseRef.current = myFinale?.finalePhase;
      setHfGrid(null);
      setHfPlayhead(null);
      setHfColumnOrder(null);
    }
  }, [myFinale?.finalePhase]);

  // Derive grid: prefer HF data, fall back to state_sync
  const grid: QuiltGridState | null = (() => {
    if (hfGrid) {
      return {
        ...hfGrid,
        playheadColumn: hfPlayhead ?? hfGrid.playheadColumn,
        columnOrder: hfColumnOrder ?? hfGrid.columnOrder,
      };
    }
    if (myFinale?.quilt) {
      return {
        rows: myFinale.quilt.rows,
        columns: myFinale.quilt.columns,
        cells: myFinale.quilt.cells,
        columnOrder: hfColumnOrder ?? myFinale.quilt.columnOrder,
        playheadColumn: hfPlayhead ?? myFinale.quilt.playheadColumn,
      };
    }
    return null;
  })();

  const isAudience = myFinale && 'myCellId' in myFinale;
  const myCellId = (isAudience ? (myFinale as AudienceFinaleView).myCellId : null) ?? null;
  const myCell = grid?.cells.find(c => c.id === myCellId) ?? null;
  const lockedIn = (isAudience ? (myFinale as AudienceFinaleView).lockedIn : false) ?? false;
  const availableSongs = myFinale?.availableSongs ?? [];
  const lockedCells = new Set(myFinale?.lockedCells ?? []);
  const mutedCells = new Set(myFinale?.mutedCells ?? []);

  // Actions
  const claimCell = useCallback((cellId: string) => {
    socket?.emit('claim_cell', { cellId });
  }, [socket]);

  const releaseCell = useCallback(() => {
    socket?.emit('release_cell');
  }, [socket]);

  const setSong = useCallback((songIndex: number) => {
    socket?.emit('set_song', { songIndex });
  }, [socket]);

  const lockIn = useCallback(() => {
    socket?.emit('lock_in');
  }, [socket]);

  const moveCell = useCallback((targetCellId: string) => {
    socket?.emit('move_cell', { targetCellId });
  }, [socket]);

  const changeSong = useCallback((songIndex: number) => {
    socket?.emit('change_song', { songIndex });
  }, [socket]);

  return {
    grid,
    myCellId,
    myCell,
    lockedIn,
    availableSongs,
    lockedCells,
    mutedCells,
    assignmentTimerRemaining: myFinale?.assignmentTimerRemaining ?? null,
    previewTimerRemaining: (isAudience ? (myFinale as AudienceFinaleView).previewTimerRemaining : null) ?? null,
    claimCell,
    releaseCell,
    setSong,
    lockIn,
    moveCell,
    changeSong,
  };
}

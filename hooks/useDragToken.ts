/**
 * useDragToken Hook (V3.4)
 *
 * iPad touch drag state for the projector finale remix view.
 * Tracks touchstart/touchmove/touchend on token dots, reports drag position,
 * and detects drop targets (pentagon nodes).
 *
 * Uses touch events (NOT HTML5 drag API) for mobile Safari compatibility.
 * CSS touch-action: none must be set on the container element.
 */

'use client';

import { useCallback, useRef, useState } from 'react';

export interface DragState {
  /** Whether a drag is currently active. */
  isDragging: boolean;
  /** Chapter ID of the token being dragged (null if not dragging). */
  dragChapterId: string | null;
  /** Current drag position in client coordinates. */
  dragPosition: { x: number; y: number } | null;
  /** The granular type node the drag is currently over (null if not over any). */
  hoverTarget: string | null;
}

export interface DropZone {
  id: string;  // granularType
  x: number;
  y: number;
  radius: number;
}

export interface UseDragTokenReturn extends DragState {
  /** Call on touchstart over a token dot. */
  startDrag: (chapterId: string, x: number, y: number) => void;
  /** Call on touchmove. */
  moveDrag: (x: number, y: number) => void;
  /** Call on touchend. Returns the drop target granularType or null. */
  endDrag: () => string | null;
  /** Register pentagon node drop zones for hit testing. */
  setDropZones: (zones: DropZone[]) => void;
  /** Hit-test a point against registered drop zones. Returns granularType or null. */
  findTarget: (x: number, y: number) => string | null;
}

const SNAP_RADIUS_MULTIPLIER = 1.8;  // Magnetic snap zone = node radius * this

export function useDragToken(): UseDragTokenReturn {
  const [state, setState] = useState<DragState>({
    isDragging: false,
    dragChapterId: null,
    dragPosition: null,
    hoverTarget: null,
  });

  const dropZonesRef = useRef<DropZone[]>([]);

  const setDropZones = useCallback((zones: DropZone[]) => {
    dropZonesRef.current = zones;
  }, []);

  const findTarget = useCallback((x: number, y: number): string | null => {
    for (const zone of dropZonesRef.current) {
      const dx = x - zone.x;
      const dy = y - zone.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < zone.radius * SNAP_RADIUS_MULTIPLIER) {
        return zone.id;
      }
    }
    return null;
  }, []);

  const startDrag = useCallback((chapterId: string, x: number, y: number) => {
    setState({
      isDragging: true,
      dragChapterId: chapterId,
      dragPosition: { x, y },
      hoverTarget: findTarget(x, y),
    });
  }, [findTarget]);

  const moveDrag = useCallback((x: number, y: number) => {
    setState(prev => {
      if (!prev.isDragging) return prev;
      return {
        ...prev,
        dragPosition: { x, y },
        hoverTarget: findTarget(x, y),
      };
    });
  }, [findTarget]);

  const endDrag = useCallback((): string | null => {
    const target = state.hoverTarget;
    setState({
      isDragging: false,
      dragChapterId: null,
      dragPosition: null,
      hoverTarget: null,
    });
    return target;
  }, [state.hoverTarget]);

  return {
    ...state,
    startDrag,
    moveDrag,
    endDrag,
    setDropZones,
    findTarget,
  };
}

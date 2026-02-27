/**
 * useTriangle
 *
 * Two hooks for triangle steering:
 *
 * useTriangleInput — Audience: converts touch/pointer drag inside an equilateral
 *   triangle SVG to barycentric weights (wAmbition + wLove + wAvoidance = 1).
 *   Throttles position callbacks to ~250ms.
 *
 * useTriangleCentroid — Projector: listens to 'centroid' socket events and
 *   interpolates between received positions via requestAnimationFrame for
 *   smooth animation (~4 Hz incoming, rendered at 60 fps).
 */

'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { TrianglePosition } from '@/conductor/types';

// ---------------------------------------------------------------------------
// Triangle geometry helpers
// ---------------------------------------------------------------------------

/** Vertices of the equilateral triangle in normalized SVG space (0..1). */
export interface TriangleVertices {
  ambition: [number, number];  // top center
  love: [number, number];      // bottom left
  avoidance: [number, number]; // bottom right
}

/**
 * Default vertices for a centered equilateral triangle in a square viewBox.
 * Ambition = top, Love = bottom-left, Avoidance = bottom-right.
 */
export function defaultVertices(size: number): TriangleVertices {
  const cx = size / 2;
  const margin = size * 0.1;
  const top = margin;
  const bottom = size - margin;
  const halfWidth = (bottom - top) / Math.sqrt(3) * 1;
  return {
    ambition:  [cx, top],
    love:      [cx - halfWidth, bottom],
    avoidance: [cx + halfWidth, bottom],
  };
}

/**
 * Convert a 2D point to barycentric coordinates relative to three triangle vertices.
 * All weights are clamped >= 0 and normalized to sum = 1, so the point is always
 * inside (or on the boundary of) the triangle.
 */
export function pointToBarycentric(
  px: number,
  py: number,
  v0: [number, number], // ambition
  v1: [number, number], // love
  v2: [number, number], // avoidance
): TrianglePosition {
  const d = (v1[1] - v2[1]) * (v0[0] - v2[0]) + (v2[0] - v1[0]) * (v0[1] - v2[1]);
  if (d === 0) {
    return { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };
  }
  let wA = ((v1[1] - v2[1]) * (px - v2[0]) + (v2[0] - v1[0]) * (py - v2[1])) / d;
  let wL = ((v2[1] - v0[1]) * (px - v2[0]) + (v0[0] - v2[0]) * (py - v2[1])) / d;
  let wV = 1 - wA - wL;

  // Clamp all weights to [0, 1] then renormalize
  wA = Math.max(0, wA);
  wL = Math.max(0, wL);
  wV = Math.max(0, wV);
  const total = wA + wL + wV;
  if (total === 0) return { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };

  return {
    wAmbition: wA / total,
    wLove: wL / total,
    wAvoidance: wV / total,
  };
}

/**
 * Convert barycentric weights back to a 2D point in SVG space.
 */
export function barycentricToPoint(
  pos: TrianglePosition,
  v0: [number, number],
  v1: [number, number],
  v2: [number, number],
): [number, number] {
  return [
    pos.wAmbition * v0[0] + pos.wLove * v1[0] + pos.wAvoidance * v2[0],
    pos.wAmbition * v0[1] + pos.wLove * v1[1] + pos.wAvoidance * v2[1],
  ];
}

// ---------------------------------------------------------------------------
// useTriangleInput — Audience drag input
// ---------------------------------------------------------------------------

export interface UseTriangleInputOptions {
  /** Called with new position, throttled to ~throttleMs. */
  onPositionChange: (pos: TrianglePosition) => void;
  /** Throttle interval in ms. Default 250. */
  throttleMs?: number;
  /** Whether interaction is enabled. Default true. */
  enabled?: boolean;
  /** Triangle size in SVG units (matches viewBox width/height). Default 300. */
  size?: number;
}

export interface UseTriangleInputReturn {
  /** Attach to the SVG element. */
  containerRef: React.RefObject<SVGSVGElement>;
  /** Current local position (updates immediately for responsive UI). */
  position: TrianglePosition;
  isDragging: boolean;
}

const CENTER: TrianglePosition = { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };

export function useTriangleInput({
  onPositionChange,
  throttleMs = 250,
  enabled = true,
  size = 300,
}: UseTriangleInputOptions): UseTriangleInputReturn {
  const containerRef = useRef<SVGSVGElement>(null);
  const [position, setPosition] = useState<TrianglePosition>(CENTER);
  const [isDragging, setIsDragging] = useState(false);

  const isDraggingRef = useRef(false);
  const lastEmitRef = useRef(0);
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;

  const verticesRef = useRef<TriangleVertices>(defaultVertices(size));
  // Recompute vertices when size changes
  useEffect(() => {
    verticesRef.current = defaultVertices(size);
  }, [size]);

  const getSVGPoint = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = containerRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const vb = size;
    const scaleX = vb / rect.width;
    const scaleY = vb / rect.height;
    return [
      (clientX - rect.left) * scaleX,
      (clientY - rect.top) * scaleY,
    ];
  }, [size]);

  const handlePosition = useCallback((clientX: number, clientY: number) => {
    const pt = getSVGPoint(clientX, clientY);
    if (!pt) return;
    const v = verticesRef.current;
    const pos = pointToBarycentric(pt[0], pt[1], v.ambition, v.love, v.avoidance);
    setPosition(pos);

    const now = Date.now();
    if (now - lastEmitRef.current >= throttleMs) {
      lastEmitRef.current = now;
      onPositionChangeRef.current(pos);
    }
  }, [getSVGPoint, throttleMs]);

  useEffect(() => {
    const svg = containerRef.current;
    if (!svg || !enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      setIsDragging(true);
      handlePosition(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      handlePosition(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      // Emit final position immediately
      const pt = getSVGPoint(e.clientX, e.clientY);
      if (pt) {
        const v = verticesRef.current;
        const pos = pointToBarycentric(pt[0], pt[1], v.ambition, v.love, v.avoidance);
        lastEmitRef.current = Date.now();
        onPositionChangeRef.current(pos);
      }
    };

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    return () => {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
    };
  }, [enabled, handlePosition, getSVGPoint]);

  return { containerRef, position, isDragging };
}

// ---------------------------------------------------------------------------
// useTriangleCentroid — Projector interpolation
// ---------------------------------------------------------------------------

export interface UseTriangleCentroidOptions {
  socket: Socket | null;
  /** Interpolation duration in ms. Default 250 (matches broadcast rate). */
  interpolationMs?: number;
}

export interface UseTriangleCentroidReturn {
  centroid: TrianglePosition;
}

export function useTriangleCentroid({
  socket,
  interpolationMs = 250,
}: UseTriangleCentroidOptions): UseTriangleCentroidReturn {
  const [centroid, setCentroid] = useState<TrianglePosition>(CENTER);

  // Interpolation state held in refs to avoid re-render on each frame
  const fromRef = useRef<TrianglePosition>(CENTER);
  const toRef = useRef<TrianglePosition>(CENTER);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const interpolationMsRef = useRef(interpolationMs);
  interpolationMsRef.current = interpolationMs;

  const animate = useCallback(() => {
    const start = startTimeRef.current;
    if (start === null) return;

    const elapsed = Date.now() - start;
    const t = Math.min(elapsed / interpolationMsRef.current, 1);

    const from = fromRef.current;
    const to = toRef.current;
    const current: TrianglePosition = {
      wAmbition: from.wAmbition + (to.wAmbition - from.wAmbition) * t,
      wLove: from.wLove + (to.wLove - from.wLove) * t,
      wAvoidance: from.wAvoidance + (to.wAvoidance - from.wAvoidance) * t,
    };

    setCentroid(current);

    if (t < 1) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      startTimeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleCentroid = (data: TrianglePosition) => {
      // Start interpolating from current rendered position to new target
      fromRef.current = { ...centroid };
      toRef.current = data;
      startTimeRef.current = Date.now();

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };

    socket.on('centroid', handleCentroid);
    return () => {
      socket.off('centroid', handleCentroid);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, animate]);

  return { centroid };
}

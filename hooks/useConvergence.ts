'use client';

/**
 * useConvergence
 *
 * Subscribes to high-frequency 'convergence_update' socket events and applies
 * spring interpolation for smooth, analog-feel meter animation.
 *
 * Mirrors the pattern from useTriangleCentroid in hooks/useTriangle.ts.
 */

import { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

interface UseConvergenceOptions {
  socket: Socket | null;
  threshold: number;
  timeRemaining: number;
}

interface UseConvergenceReturn {
  animatedValue: number;
  isAboveThreshold: boolean;
  timeRemaining: number;
}

// Spring tau: controls how quickly the animated value catches up to the target.
// Lower = snappier, higher = more sluggish/inertia feel.
const SPRING_TAU_MS = 100;

export function useConvergence({
  socket,
  threshold,
  timeRemaining,
}: UseConvergenceOptions): UseConvergenceReturn {
  const [animatedValue, setAnimatedValue] = useState(0);
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Listen for server-pushed convergence updates
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { value: number }) => {
      targetRef.current = Math.max(0, Math.min(1, data.value));
    };
    socket.on('convergence_update', handler);
    return () => { socket.off('convergence_update', handler); };
  }, [socket]);

  // RAF loop: spring-interpolate current toward target
  useEffect(() => {
    const animate = (timestamp: number) => {
      const dt = lastFrameRef.current ? timestamp - lastFrameRef.current : 16;
      lastFrameRef.current = timestamp;

      const target = targetRef.current;
      const current = currentRef.current;
      const factor = 1 - Math.exp(-dt / SPRING_TAU_MS);
      const next = current + (target - current) * factor;

      currentRef.current = next;
      setAnimatedValue(next);

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    animatedValue,
    isAboveThreshold: animatedValue >= threshold,
    timeRemaining,
  };
}

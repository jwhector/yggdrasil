/**
 * ProjectorCanvas — Single Canvas 2D component for the projector visualization.
 *
 * Renders the pentagon skeleton, node states, membranes, connectors,
 * A/B audition labels, header, and two-beat reveal on a fullscreen <canvas>.
 *
 * Uses requestAnimationFrame for 60fps rendering with pure drawing functions.
 * Visual state is derived from conductor state via useProjectorState().
 */

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectorState } from './useProjectorState';
import type { ProjectorVisualState } from './useProjectorState';
import { BG_COLOR, ease } from './renderers/shared';
import { drawSkeleton } from './renderers/skeleton';
import { drawHeader, drawABLabels } from './renderers/audition';
import { drawStakes, drawVerdict } from './renderers/reveal';
import type { ProjectorClientState, AttemptState, AuditionProgress } from '@/conductor/types';

interface ProjectorCanvasProps {
  state: ProjectorClientState;
  currentAttempt: AttemptState | null;
  auditionProgress: AuditionProgress | null;
}

export function ProjectorCanvas({ state, currentAttempt, auditionProgress }: ProjectorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const stateRef = useRef<ProjectorVisualState | null>(null);
  const revealStartRef = useRef<number>(0);
  const prevModeRef = useRef<string>('dark');

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Track window size
  useEffect(() => {
    function updateSize() {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Derive visual state from props
  const visualState = useProjectorState(state, currentAttempt, auditionProgress, dimensions.width, dimensions.height);

  // Track mode transitions for reveal timing
  useEffect(() => {
    const prevMode = prevModeRef.current;
    const newMode = visualState.mode;

    // Record start time when entering stakes or verdict mode
    if (newMode !== prevMode && (newMode === 'stakes' || newMode === 'verdict')) {
      revealStartRef.current = performance.now();
    }

    prevModeRef.current = newMode;
    stateRef.current = visualState;
  }, [visualState]);

  // Set up canvas DPR scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, [dimensions]);

  // Render loop
  const render = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const s = stateRef.current;

    if (!ctx || !s || s.canvasWidth === 0) {
      animFrameRef.current = requestAnimationFrame(render);
      return;
    }

    const W = s.canvasWidth;
    const H = s.canvasHeight;
    const t = time * 0.001; // seconds
    const now = performance.now();

    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    // Draw based on mode
    switch (s.mode) {
      case 'skeleton':
        drawHeader(ctx, s, t);
        drawSkeleton(ctx, s, t, 1);
        drawABLabels(ctx, s, t);
        break;

      case 'stakes': {
        drawHeader(ctx, s, t);
        const stakesElapsed = now - revealStartRef.current;
        // Skeleton fades out over first 600ms
        const skelAlpha = 1 - ease(Math.min(1, stakesElapsed / 600));
        if (skelAlpha > 0) {
          drawSkeleton(ctx, s, t, skelAlpha);
        }
        drawStakes(ctx, s, t, stakesElapsed);
        break;
      }

      case 'verdict': {
        drawHeader(ctx, s, t);
        const verdictElapsed = now - revealStartRef.current;
        drawVerdict(ctx, s, t, verdictElapsed);
        break;
      }

      // 'dark' mode: just the background
    }

    animFrameRef.current = requestAnimationFrame(render);
  }, []);

  // Start/stop animation loop
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(render);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100vw',
        height: '100vh',
        backgroundColor: BG_COLOR,
      }}
    />
  );
}

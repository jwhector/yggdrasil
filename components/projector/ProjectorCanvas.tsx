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
import { BG_COLOR, ease, clamp01 } from './renderers/shared';
import { drawSkeleton } from './renderers/skeleton';
import { drawHeader, drawABLabels } from './renderers/audition';
import { drawStakes, drawVerdict } from './renderers/reveal';
import { drawFinale, resetFinaleState } from './renderers/finale';
import {
  drawLockinTransition,
  drawCollapseTransition,
  drawCompleteTransition,
  TRANSITION_DURATIONS,
} from './renderers/transitions';
import type { TransitionState } from './renderers/transitions';
import type { MixStateInput } from './useProjectorState';
import type { ProjectorClientState, AttemptState, AuditionProgress } from '@/conductor/types';

interface ProjectorCanvasProps {
  state: ProjectorClientState;
  currentAttempt: AttemptState | null;
  auditionProgress: AuditionProgress | null;
  mixStateData?: MixStateInput | null;
}

export function ProjectorCanvas({ state, currentAttempt, auditionProgress, mixStateData }: ProjectorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const stateRef = useRef<ProjectorVisualState | null>(null);
  const revealStartRef = useRef<number>(0);
  const prevModeRef = useRef<string>('dark');
  const transitionRef = useRef<TransitionState | null>(null);
  const skeletonFadeInRef = useRef<number>(0);

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
  const visualState = useProjectorState(state, currentAttempt, auditionProgress, dimensions.width, dimensions.height, mixStateData);

  // Track mode transitions for reveal timing and animated transitions
  useEffect(() => {
    const prevMode = prevModeRef.current;
    const newMode = visualState.mode;
    const now = performance.now();

    if (newMode !== prevMode) {
      console.log(`[ProjectorCanvas] mode: ${prevMode} → ${newMode}`, {
        voteResult: !!visualState.voteResult,
        thresholdCheck: !!visualState.thresholdCheck,
        layerPhase: currentAttempt?.currentLayerPhase,
        revealStakesShown: currentAttempt?.revealStakesShown,
      });

      // Detect transitions that need animation
      if (prevMode === 'verdict' && stateRef.current) {
        const fromState = { ...stateRef.current };
        const fromRevealElapsed = now - revealStartRef.current;

        if (newMode === 'skeleton') {
          // Lock-in: verdict → skeleton (next layer)
          transitionRef.current = {
            fromState,
            fromRevealElapsed,
            startTime: now,
            type: 'lockin',
          };
        } else if (newMode === 'dark') {
          // Collapse or completion → dark
          const passed = fromState.thresholdCheck?.passed ?? true;
          transitionRef.current = {
            fromState,
            fromRevealElapsed,
            startTime: now,
            type: passed ? 'complete_to_dark' : 'collapse_to_dark',
          };
        }
      } else if (prevMode === 'dark' && (newMode === 'skeleton' || newMode === 'finale')) {
        // New attempt or finale beginning: fade in
        skeletonFadeInRef.current = now;
        if (newMode === 'finale') resetFinaleState();
      }
    }

    // Record start time when entering stakes or verdict mode
    if (newMode !== prevMode && (newMode === 'stakes' || newMode === 'verdict')) {
      revealStartRef.current = now;
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

    // Handle active transitions (takes priority over normal mode rendering)
    const transition = transitionRef.current;
    if (transition) {
      const transElapsed = now - transition.startTime;
      const duration = TRANSITION_DURATIONS[transition.type];

      if (transElapsed >= duration) {
        // Transition complete — clear and fall through to normal rendering
        transitionRef.current = null;
      } else {
        switch (transition.type) {
          case 'lockin':
            drawLockinTransition(ctx, transition.fromState, s, t, transElapsed, transition.fromRevealElapsed);
            break;
          case 'collapse_to_dark':
            drawCollapseTransition(ctx, transition.fromState, t, transElapsed, transition.fromRevealElapsed);
            break;
          case 'complete_to_dark':
            drawCompleteTransition(ctx, transition.fromState, t, transElapsed, transition.fromRevealElapsed);
            break;
        }
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }
    }

    // Draw based on mode
    switch (s.mode) {
      case 'skeleton': {
        drawHeader(ctx, s, t);
        // Fade in from dark (new attempt starting)
        let skelAlpha = 1;
        if (skeletonFadeInRef.current > 0) {
          const fadeElapsed = now - skeletonFadeInRef.current;
          skelAlpha = ease(clamp01(fadeElapsed / 800));
          if (fadeElapsed >= 800) {
            skeletonFadeInRef.current = 0; // Done fading in
          }
        }
        drawSkeleton(ctx, s, t, skelAlpha);
        drawABLabels(ctx, s, t);
        break;
      }

      case 'stakes': {
        drawHeader(ctx, s, t);
        const stakesElapsed = now - revealStartRef.current;
        // Skeleton fades out over first 600ms
        const skelFadeAlpha = 1 - ease(Math.min(1, stakesElapsed / 600));
        if (skelFadeAlpha > 0) {
          drawSkeleton(ctx, s, t, skelFadeAlpha);
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

      case 'finale': {
        let finaleAlpha = 1;
        if (skeletonFadeInRef.current > 0) {
          const fadeElapsed = now - skeletonFadeInRef.current;
          finaleAlpha = ease(clamp01(fadeElapsed / 800));
          if (fadeElapsed >= 800) {
            skeletonFadeInRef.current = 0;
          }
        }
        drawFinale(ctx, s, t, finaleAlpha);
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

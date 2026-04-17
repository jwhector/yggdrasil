/**
 * ProjectorFinale (V3.4)
 *
 * Projector component for finale_vote and finale_remix phases.
 * Composes TokenPool (floating dots) + PentagonRemix (pentagon nodes).
 * Manages drag interaction layer (enabled during finale_remix — touch and mouse).
 * Handles screen wake lock to prevent iPad sleep during performance.
 */

'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChapterConfig, GranularType, ShowPhase, ProjectorFinaleView } from '@/conductor/types';
import { useTokenPool } from '@/hooks/useTokenPool';
import { useDragToken } from '@/hooks/useDragToken';
import { TokenPool, type CollisionZone, type TokenPoolHandle } from './TokenPool';
import { PentagonRemix } from './PentagonRemix';
import { computeLayout, hexToRgb } from '@/components/projector/renderers/shared';

interface NodeTallyData {
  granularType: string;
  votes: Array<{ chapterId: string; count: number }>;
  dominantChapter: string | null;
  locked: boolean;
}

interface ProjectorFinaleProps {
  socket: Socket | null;
  phase: ShowPhase;
  finaleView: ProjectorFinaleView;
  chapters: ChapterConfig[];
  granularTypes: GranularType[];
}

export function ProjectorFinale({
  socket,
  phase,
  finaleView,
  chapters,
  granularTypes,
}: ProjectorFinaleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tokenPoolRef = useRef<TokenPoolHandle>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Node tally state from high-frequency socket event
  const [nodeTallies, setNodeTallies] = useState<NodeTallyData[]>([]);

  // Flying orbs state
  const [flyingOrbs, setFlyingOrbs] = useState<Array<{ id: string; chapterId: string; targetX: number; targetY: number }>>([]);

  // Drag trail — tracked in parent so it survives DragDot unmount
  const activeTrailRef = useRef<Array<{ x: number; y: number }>>([]);
  const [decayingTrails, setDecayingTrails] = useState<Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    chapterId: string;
    createdAt: number;
  }>>([]);

  // High-frequency pool state from dedicated socket event
  const poolState = useTokenPool(socket);

  // Drag state for touch interaction
  const drag = useDragToken();

  const isRemix = phase === 'finale_remix';
  const interactionEnabled = isRemix;

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Screen wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Wake lock not supported or denied — fall through to video fallback
      }
    };

    requestWakeLock();

    // Re-acquire on visibility change (wake lock releases on tab hide)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLock?.release();
    };
  }, []);

  // Subscribe to node_tally for orbit dot assignments
  useEffect(() => {
    if (!socket) return;
    const handleTally = (data: { tallies: NodeTallyData[] }) => {
      setNodeTallies(data.tallies);
    };
    socket.on('node_tally', handleTally);
    return () => { socket.off('node_tally', handleTally); };
  }, [socket]);

  // Listen for token_fly events from audience votes — throttled to avoid DOM explosion
  // Batch fly-ins arriving within 200ms into a single animation
  const flyThrottleRef = useRef<{ pending: string[]; timer: ReturnType<typeof setTimeout> | null }>({ pending: [], timer: null });

  useEffect(() => {
    if (!socket) return;

    const flushPending = () => {
      const batch = flyThrottleRef.current.pending;
      flyThrottleRef.current.pending = [];
      flyThrottleRef.current.timer = null;

      if (batch.length === 0) return;

      // Show one fly animation per batch (use the first chapter, visual represents all)
      const chapterId = batch[0];
      const targetX = Math.random() * size.width * 0.7 + size.width * 0.15;
      const targetY = Math.random() * size.height * 0.5 + size.height * 0.05;
      const id = `fly-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Queue landing positions for all in batch (pool reconciliation spawns the dots)
      for (const ch of batch) {
        const lx = Math.random() * size.width * 0.7 + size.width * 0.15;
        const ly = Math.random() * size.height * 0.5 + size.height * 0.05;
        tokenPoolRef.current?.queueLandingPosition(ch, lx, ly);
      }

      setFlyingOrbs(prev => [...prev, { id, chapterId, targetX, targetY }]);
      setTimeout(() => {
        setFlyingOrbs(prev => prev.filter(o => o.id !== id));
      }, 800);
    };

    const handleTokenFly = (data: { chapterId: string }) => {
      flyThrottleRef.current.pending.push(data.chapterId);
      if (!flyThrottleRef.current.timer) {
        flyThrottleRef.current.timer = setTimeout(flushPending, 200);
      }
    };

    socket.on('token_fly', handleTokenFly);
    return () => {
      socket.off('token_fly', handleTokenFly);
      if (flyThrottleRef.current.timer) clearTimeout(flyThrottleRef.current.timer);
    };
  }, [socket, size.width, size.height]);

  // Use pool_state (high-frequency) if available, fall back to state_sync data
  const availableByChapter = poolState.totalRemaining > 0
    ? poolState.availableByChapter
    : finaleView.pool.availableByChapter;

  // Handle dot drag start (touch or mouse)
  const handleDotDragStart = useCallback((chapterId: string, x: number, y: number) => {
    drag.startDrag(chapterId, x, y);
  }, [drag]);

  // Build a set of valid granular types for the currently-dragged chapter
  const validForDragChapter = useMemo(() => {
    const set = new Set<string>();
    for (const vn of finaleView.validNodes) {
      set.add(`${vn.granularType}:${vn.chapterId}`);
    }
    return set;
  }, [finaleView.validNodes]);

  // Drop handler — shared between touch and mouse
  const handleDrop = useCallback(() => {
    if (!drag.isDragging) return;
    const chapterId = drag.dragChapterId;
    const trail = activeTrailRef.current;

    // Snapshot trail for decay animation before clearing
    if (trail.length > 1 && chapterId) {
      const id = `trail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setDecayingTrails(prev => [...prev, {
        id,
        points: [...trail],
        chapterId,
        createdAt: performance.now(),
      }]);
    }
    activeTrailRef.current = [];

    const target = drag.endDrag();
    if (target && chapterId && socket) {
      // Only allow drop if this granularType+chapter combo has valid tracks
      if (!validForDragChapter.has(`${target}:${chapterId}`)) return;
      socket.emit('command', {
        type: 'QUEUE_TOKEN',
        granularType: target,
        chapterId,
        instant: finaleView.audienceInteraction,
      });
    }
  }, [drag, socket, finaleView.audienceInteraction, validForDragChapter]);

  // Touch handlers
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!drag.isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    drag.moveDrag(touch.clientX, touch.clientY);
  }, [drag]);

  // Mouse handlers (desktop testing)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.isDragging) return;
    drag.moveDrag(e.clientX, e.clientY);
  }, [drag]);

  // Node tap — requires down AND up on the same node.
  // On down, record the hit node. On up, confirm the same node is still under the pointer.
  // If a drag starts in between, the down target is cleared.
  const touchHandledRef = useRef(false);
  const nodeDownTargetRef = useRef<string | null>(null);

  const hitTestNode = useCallback((clientX: number, clientY: number): string | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return drag.findTarget(clientX - rect.left, clientY - rect.top);
  }, [drag]);

  const handleNodeDown = useCallback((clientX: number, clientY: number) => {
    if (drag.isDragging || !interactionEnabled) return;
    nodeDownTargetRef.current = hitTestNode(clientX, clientY);
  }, [drag.isDragging, interactionEnabled, hitTestNode]);

  const handleNodeUp = useCallback((clientX: number, clientY: number) => {
    const downTarget = nodeDownTargetRef.current;
    nodeDownTargetRef.current = null;
    if (!downTarget || drag.isDragging || !interactionEnabled || !socket) return;
    const upTarget = hitTestNode(clientX, clientY);
    if (upTarget === downTarget) {
      socket.emit('command', { type: 'ADVANCE_NODE', granularType: downTarget });
    }
  }, [drag.isDragging, interactionEnabled, socket, hitTestNode]);

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (touchHandledRef.current) {
      touchHandledRef.current = false;
      return;
    }
    handleNodeDown(e.clientX, e.clientY);
  }, [handleNodeDown]);

  const handleContainerMouseUp = useCallback((e: React.MouseEvent) => {
    handleDrop();
    handleNodeUp(e.clientX, e.clientY);
  }, [handleDrop, handleNodeUp]);

  const handleContainerTouchStart = useCallback((e: React.TouchEvent) => {
    touchHandledRef.current = true;
    if (e.touches.length > 0) {
      handleNodeDown(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [handleNodeDown]);

  const handleContainerTouchEnd = useCallback((e: React.TouchEvent) => {
    handleDrop();
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      handleNodeUp(touch.clientX, touch.clientY);
    }
  }, [handleDrop, handleNodeUp]);

  // Layout metrics for collision zones + orbit positions
  const layoutMetrics = useMemo(() => {
    if (size.width === 0) return null;
    return computeLayout(size.width, size.height);
  }, [size.width, size.height]);

  // Collision zone — single large circle around the entire pentagon skeleton
  // so floating dots stay well outside the orbit area during remix
  const collisionZones: CollisionZone[] = useMemo(() => {
    if (!isRemix || !layoutMetrics) return [];
    // orbitRadius covers node centers; add node radius + orbit ring distance + buffer
    const skeletonRadius = layoutMetrics.orbitRadius + layoutMetrics.nodeRadius * 3.5;
    return [{
      x: layoutMetrics.centerX,
      y: layoutMetrics.centerY,
      radius: skeletonRadius,
    }];
  }, [isRemix, layoutMetrics]);

  // Node positions + radius for orbit dots (includes seed at center)
  const nodePositions = useMemo(() => {
    if (!layoutMetrics) return undefined;
    return {
      ...layoutMetrics.positions,
      seed: { x: layoutMetrics.centerX, y: layoutMetrics.centerY },
    };
  }, [layoutMetrics]);

  const nodeRadiusForOrbit = layoutMetrics?.nodeRadius;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#090909',
        overflow: 'hidden',
        touchAction: 'none',
      }}
      onTouchStart={handleContainerTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleContainerTouchEnd}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleContainerMouseUp}
    >
      {size.width > 0 && size.height > 0 && (
        <>
          {/* Floating token dots */}
          <TokenPool
            ref={tokenPoolRef}
            availableByChapter={availableByChapter}
            chapters={chapters}
            width={size.width}
            height={size.height}
            interactionEnabled={interactionEnabled}
            collisionZones={collisionZones}
            onDotDragStart={handleDotDragStart}
            nodeTallies={isRemix ? nodeTallies : undefined}
            nodePositions={isRemix ? nodePositions : undefined}
            nodeRadius={nodeRadiusForOrbit}
          />

          {/* Pentagon nodes — only during remix */}
          {isRemix && <PentagonRemix
            width={size.width}
            height={size.height}
            activeNodes={finaleView.active}
            queueDepths={finaleView.queueDepth}
            loopProgress={poolState.loopProgress}
            chapters={chapters}
            granularTypes={granularTypes}
            hoverTarget={drag.hoverTarget}
            dragChapterId={drag.dragChapterId}
            validNodes={finaleView.validNodes}
            audienceInteraction={finaleView.audienceInteraction}
            onDropZonesComputed={drag.setDropZones}
            nodeTallies={nodeTallies}
          />}
        </>
      )}

      {/* Drag indicator — follows pointer */}
      {drag.isDragging && drag.dragPosition && drag.dragChapterId && (
        <DragDot
          x={drag.dragPosition.x}
          y={drag.dragPosition.y}
          chapterId={drag.dragChapterId}
          chapters={chapters}
          containerRef={containerRef}
          trailRef={activeTrailRef}
        />
      )}

      {/* Decaying trails from completed drags */}
      {decayingTrails.map(trail => (
        <DecayingTrail
          key={trail.id}
          points={trail.points}
          chapterId={trail.chapterId}
          createdAt={trail.createdAt}
          chapters={chapters}
          containerRef={containerRef}
          onComplete={() => setDecayingTrails(prev => prev.filter(t => t.id !== trail.id))}
        />
      ))}

      {/* Pool counter — per-chapter remaining tokens */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 20,
        display: 'flex',
        gap: '10px',
        fontSize: '0.65rem',
        color: 'rgba(255,255,255,0.12)',
        letterSpacing: '0.06em',
        fontFamily: 'system-ui',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {chapters.map(ch => {
          const count = availableByChapter.find(e => e.chapterId === ch.id)?.count ?? 0;
          const label = ch.id === 'ambition' ? 'C' : ch.id === 'love' ? 'L' : 'A';
          return (
            <span key={ch.id} style={{ color: `${ch.color}44` }}>
              {label}:{count}
            </span>
          );
        })}
      </div>

      {/* Flying orbs — token_fly animations from audience */}
      {flyingOrbs.map(orb => {
        const chapter = chapters.find(c => c.id === orb.chapterId);
        const color = chapter?.color ?? '#888';
        return (
          <div
            key={orb.id}
            style={{
              position: 'absolute',
              left: orb.targetX,
              top: size.height + 20,
              width: 0,
              height: 0,
              animation: 'tokenFlyIn 0.8s ease-out forwards',
              '--fly-target-y': `${orb.targetY}px`,
              '--fly-start-y': `${size.height + 20}px`,
              pointerEvents: 'none',
              zIndex: 50,
            } as React.CSSProperties}
          >
            {/* Outer haze */}
            <div style={{
              position: 'absolute',
              width: 60,
              height: 60,
              marginLeft: -30,
              marginTop: -30,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${color}20 0%, ${color}08 40%, transparent 70%)`,
              animation: 'tokenFlyHaze 0.8s ease-out forwards',
            }} />
            {/* Mid glow */}
            <div style={{
              position: 'absolute',
              width: 30,
              height: 30,
              marginLeft: -15,
              marginTop: -15,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${color}55 0%, ${color}18 50%, transparent 100%)`,
              animation: 'tokenFlyGlow 0.8s ease-out forwards',
            }} />
            {/* Core */}
            <div style={{
              position: 'absolute',
              width: 14,
              height: 14,
              marginLeft: -7,
              marginTop: -7,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${color}ee 0%, ${color}99 40%, transparent 100%)`,
              animation: 'tokenFlyCore 0.8s ease-out forwards',
            }} />
          </div>
        );
      })}
      {flyingOrbs.length > 0 && (
        <style>{`
          @keyframes tokenFlyIn {
            0% {
              transform: translateY(0) scale(1.8);
              filter: blur(12px);
              -webkit-filter: blur(12px);
            }
            60% {
              filter: blur(4px);
              -webkit-filter: blur(4px);
            }
            100% {
              transform: translateY(calc(var(--fly-target-y) - var(--fly-start-y))) scale(1);
              filter: blur(0px);
              -webkit-filter: blur(0px);
            }
          }
          @keyframes tokenFlyHaze {
            0% { opacity: 0.3; transform: scale(2); }
            100% { opacity: 0.6; transform: scale(1); }
          }
          @keyframes tokenFlyGlow {
            0% { opacity: 0.2; transform: scale(1.8); }
            100% { opacity: 0.8; transform: scale(1); }
          }
          @keyframes tokenFlyCore {
            0% { opacity: 0.4; transform: scale(1.5); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      )}

      {/* Hidden video fallback for wake lock on older Safari */}
      <WakeLockVideoFallback />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag dot with trail effect
// ---------------------------------------------------------------------------

const TRAIL_MAX_POINTS = 24;
const TRAIL_POINT_INTERVAL = 16; // ms between recorded points
const TRAIL_DECAY_MS = 1000; // how long decaying trails last

function DragDot({
  x,
  y,
  chapterId,
  chapters,
  containerRef,
  trailRef,
}: {
  x: number;
  y: number;
  chapterId: string;
  chapters: ChapterConfig[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  trailRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPointTimeRef = useRef(0);
  const animRef = useRef(0);

  const chapter = chapters.find(c => c.id === chapterId);
  const color = chapter?.color ?? '#888';
  const rgbColor = hexToRgb(color);

  const rect = containerRef.current?.getBoundingClientRect();
  const relX = rect ? x - rect.left : x;
  const relY = rect ? y - rect.top : y;

  // Record trail points at a throttled rate into the parent's ref
  const now = performance.now();
  if (now - lastPointTimeRef.current > TRAIL_POINT_INTERVAL) {
    lastPointTimeRef.current = now;
    trailRef.current.push({ x: relX, y: relY });
    if (trailRef.current.length > TRAIL_MAX_POINTS) {
      trailRef.current.shift();
    }
  }

  // Render trail + head on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parentW = containerRef.current?.clientWidth ?? 0;
    const parentH = containerRef.current?.clientHeight ?? 0;
    if (parentW === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = parentW * dpr;
    canvas.height = parentH * dpr;
    canvas.style.width = `${parentW}px`;
    canvas.style.height = `${parentH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const draw = () => {
      ctx.clearRect(0, 0, parentW, parentH);
      drawTrailPoints(ctx, trailRef.current, rgbColor, 1);

      // Draw glow around head
      ctx.beginPath();
      ctx.arc(relX, relY, 20, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgbColor.r},${rgbColor.g},${rgbColor.b},0.1)`;
      ctx.fill();

      // Draw head dot
      ctx.beginPath();
      ctx.arc(relX, relY, 14, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgbColor.r},${rgbColor.g},${rgbColor.b},0.8)`;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  });

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Decaying trail — persists after drop, fades out over TRAIL_DECAY_MS
// ---------------------------------------------------------------------------

function DecayingTrail({
  points,
  chapterId,
  createdAt,
  chapters,
  containerRef,
  onComplete,
}: {
  points: Array<{ x: number; y: number }>;
  chapterId: string;
  createdAt: number;
  chapters: ChapterConfig[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onComplete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  const chapter = chapters.find(c => c.id === chapterId);
  const color = chapter?.color ?? '#888';
  const rgbColor = hexToRgb(color);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parentW = containerRef.current?.clientWidth ?? 0;
    const parentH = containerRef.current?.clientHeight ?? 0;
    if (parentW === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = parentW * dpr;
    canvas.height = parentH * dpr;
    canvas.style.width = `${parentW}px`;
    canvas.style.height = `${parentH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const elapsed = performance.now() - createdAt;
      const fade = 1 - Math.min(1, elapsed / TRAIL_DECAY_MS);

      if (fade <= 0) {
        onComplete();
        return;
      }

      ctx.clearRect(0, 0, parentW, parentH);
      drawTrailPoints(ctx, points, rgbColor, fade);
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [points, rgbColor, createdAt, containerRef, onComplete]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 99,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared trail drawing
// ---------------------------------------------------------------------------

function drawTrailPoints(
  ctx: CanvasRenderingContext2D,
  trail: Array<{ x: number; y: number }>,
  color: { r: number; g: number; b: number },
  globalFade: number,
): void {
  for (let i = 0; i < trail.length; i++) {
    const t = i / trail.length; // 0 = oldest, 1 = newest
    const alpha = t * 0.4 * globalFade;
    const r = 4 + t * 6;

    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Wake lock video fallback for older Safari
// ---------------------------------------------------------------------------

function WakeLockVideoFallback() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Only use fallback if wakeLock API is not available
    if ('wakeLock' in navigator) return;

    const video = videoRef.current;
    if (!video) return;

    // Create a tiny silent video that loops to keep the screen alive
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.loop = true;

    // Minimal 1-second silent video (base64 encoded)
    video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAA5tZGF0AAAA';

    video.play().catch(() => {
      // Autoplay blocked — not critical, wake lock is best-effort
    });

    return () => {
      video.pause();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

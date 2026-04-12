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
import { computeLayout, PENTAGON_NODES, hexToRgb } from '@/components/projector/renderers/shared';

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

  // Flying orbs state
  const [flyingOrbs, setFlyingOrbs] = useState<Array<{ id: string; chapterId: string; targetX: number; targetY: number }>>([]);

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

  // Listen for token_fly events from audience votes
  useEffect(() => {
    if (!socket) return;

    const handleTokenFly = (data: { chapterId: string }) => {
      // Pick a random landing position in the upper 60% of the screen
      const targetX = Math.random() * size.width * 0.7 + size.width * 0.15;
      const targetY = Math.random() * size.height * 0.5 + size.height * 0.05;
      const id = `fly-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Queue the landing position so reconciliation spawns the dot there
      tokenPoolRef.current?.queueLandingPosition(data.chapterId, targetX, targetY);

      setFlyingOrbs(prev => [...prev, { id, chapterId: data.chapterId, targetX, targetY }]);

      // Remove the fly-in orb after animation completes (pool_state reconciliation handles the dot)
      setTimeout(() => {
        setFlyingOrbs(prev => prev.filter(o => o.id !== id));
      }, 800);
    };

    socket.on('token_fly', handleTokenFly);
    return () => { socket.off('token_fly', handleTokenFly); };
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

  const handleTouchEnd = useCallback(() => handleDrop(), [handleDrop]);

  // Mouse handlers (desktop testing)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.isDragging) return;
    drag.moveDrag(e.clientX, e.clientY);
  }, [drag]);

  const handleMouseUp = useCallback(() => handleDrop(), [handleDrop]);

  // Track whether a drag just ended (to suppress click after drop)
  const wasDraggingRef = useRef(false);

  // Node tap — advance node when clicking/tapping a pentagon node (not during drag)
  const handleNodeTap = useCallback((clientX: number, clientY: number) => {
    if (!interactionEnabled || !socket) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const target = drag.findTarget(x, y);
    if (target) {
      socket.emit('command', { type: 'ADVANCE_NODE', granularType: target });
    }
  }, [drag, interactionEnabled, socket]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Suppress click that fires after a drag-and-drop
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    handleNodeTap(e.clientX, e.clientY);
  }, [handleNodeTap]);

  const handleTouchEndForTap = useCallback((e: React.TouchEvent) => {
    if (drag.isDragging) {
      wasDraggingRef.current = true;
      handleDrop();
    } else if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      handleNodeTap(touch.clientX, touch.clientY);
    }
  }, [drag.isDragging, handleDrop, handleNodeTap]);

  // Also mark drag end for mouse
  const handleMouseUpWithFlag = useCallback(() => {
    if (drag.isDragging) wasDraggingRef.current = true;
    handleDrop();
  }, [drag.isDragging, handleDrop]);

  // Collision zones — keep dots away from pentagon nodes during remix
  const collisionZones: CollisionZone[] = useMemo(() => {
    if (!isRemix || size.width === 0) return [];
    const layout = computeLayout(size.width, size.height);
    const buffer = layout.nodeRadius * 2.5;
    const zones: CollisionZone[] = PENTAGON_NODES.map(n => ({
      x: layout.positions[n.id].x,
      y: layout.positions[n.id].y,
      radius: buffer,
    }));
    zones.push({ x: layout.centerX, y: layout.centerY, radius: layout.seedRadius * 2 });
    return zones;
  }, [isRemix, size.width, size.height]);

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
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEndForTap}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpWithFlag}
      onClick={handleClick}
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
        />
      )}

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
              left: orb.targetX - 6,
              top: size.height + 20,
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: color,
              boxShadow: `0 0 24px ${color}88`,
              animation: 'tokenFlyIn 0.8s ease-out forwards',
              '--fly-target-x': `${orb.targetX - 6}px`,
              '--fly-target-y': `${orb.targetY - 6}px`,
              pointerEvents: 'none',
              zIndex: 50,
            } as React.CSSProperties}
          />
        );
      })}
      {flyingOrbs.length > 0 && (
        <style>{`
          @keyframes tokenFlyIn {
            0% {
              transform: translateY(0) scale(1.5);
              opacity: 1;
            }
            100% {
              transform: translateY(calc(var(--fly-target-y) - ${size.height + 20}px)) scale(0.8);
              opacity: 0.3;
            }
          }
        `}</style>
      )}

      {/* Hidden video fallback for wake lock on older Safari */}
      <WakeLockVideoFallback />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag dot indicator (follows finger during touch drag)
// ---------------------------------------------------------------------------

function DragDot({
  x,
  y,
  chapterId,
  chapters,
  containerRef,
}: {
  x: number;
  y: number;
  chapterId: string;
  chapters: ChapterConfig[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const chapter = chapters.find(c => c.id === chapterId);
  const color = chapter?.color ?? '#888';

  // Convert client coords to container-relative
  const rect = containerRef.current?.getBoundingClientRect();
  const relX = rect ? x - rect.left : x;
  const relY = rect ? y - rect.top : y;

  return (
    <div
      style={{
        position: 'absolute',
        left: relX - 14,
        top: relY - 14,
        width: 28,
        height: 28,
        borderRadius: '50%',
        backgroundColor: color,
        opacity: 0.8,
        pointerEvents: 'none',
        boxShadow: `0 0 20px ${color}66`,
        transition: 'none',
        zIndex: 100,
      }}
    />
  );
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

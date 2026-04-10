/**
 * ProjectorFinale (V3.4)
 *
 * Projector component for finale_vote and finale_remix phases.
 * Composes TokenPool (floating dots) + PentagonRemix (pentagon nodes).
 * Manages touch interaction layer (enabled only during finale_remix on touch devices).
 * Handles screen wake lock to prevent iPad sleep during performance.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChapterConfig, GranularType, ShowPhase, ProjectorFinaleView } from '@/conductor/types';
import { useTokenPool } from '@/hooks/useTokenPool';
import { useDragToken } from '@/hooks/useDragToken';
import { TokenPool } from './TokenPool';
import { PentagonRemix } from './PentagonRemix';

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
  const [size, setSize] = useState({ width: 0, height: 0 });

  // High-frequency pool state from dedicated socket event
  const poolState = useTokenPool(socket);

  // Drag state for touch interaction
  const drag = useDragToken();

  // Detect touch capability
  const [isTouchDevice] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );

  const isRemix = phase === 'finale_remix';
  const touchEnabled = isRemix && isTouchDevice;

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

  // Use pool_state (high-frequency) if available, fall back to state_sync data
  const availableByChapter = poolState.totalRemaining > 0
    ? poolState.availableByChapter
    : finaleView.pool.availableByChapter;

  // Handle dot touch start — begin drag
  const handleDotTouchStart = useCallback((chapterId: string, x: number, y: number) => {
    drag.startDrag(chapterId, x, y);
  }, [drag]);

  // Touch move/end on the container
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!drag.isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    drag.moveDrag(touch.clientX, touch.clientY);
  }, [drag]);

  const handleTouchEnd = useCallback(() => {
    if (!drag.isDragging) return;
    const target = drag.endDrag();
    if (target && drag.dragChapterId && socket) {
      // Send QUEUE_TOKEN command
      socket.emit('command', {
        type: 'QUEUE_TOKEN',
        granularType: target,
        chapterId: drag.dragChapterId,
        instant: finaleView.audienceInteraction,
      });
    }
  }, [drag, socket, finaleView.audienceInteraction]);

  // Pool counter text
  const totalRemaining = poolState.totalRemaining > 0
    ? poolState.totalRemaining
    : finaleView.pool.totalRemaining;

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
      onTouchEnd={handleTouchEnd}
    >
      {size.width > 0 && size.height > 0 && (
        <>
          {/* Floating token dots */}
          <TokenPool
            availableByChapter={availableByChapter}
            chapters={chapters}
            width={size.width}
            height={size.height}
            touchEnabled={touchEnabled}
            onDotTouchStart={handleDotTouchStart}
          />

          {/* Pentagon nodes */}
          <PentagonRemix
            width={size.width}
            height={size.height}
            activeNodes={finaleView.active}
            queueDepths={finaleView.queueDepth}
            loopProgress={finaleView.loopProgress}
            chapters={chapters}
            granularTypes={granularTypes}
            hoverTarget={drag.hoverTarget}
            audienceInteraction={finaleView.audienceInteraction}
            onDropZonesComputed={drag.setDropZones}
          />
        </>
      )}

      {/* Drag indicator — follows finger */}
      {drag.isDragging && drag.dragPosition && drag.dragChapterId && (
        <DragDot
          x={drag.dragPosition.x}
          y={drag.dragPosition.y}
          chapterId={drag.dragChapterId}
          chapters={chapters}
          containerRef={containerRef}
        />
      )}

      {/* Pool counter */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        right: 20,
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.15)',
        letterSpacing: '0.08em',
        fontFamily: 'system-ui',
      }}>
        {totalRemaining} remaining
      </div>

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

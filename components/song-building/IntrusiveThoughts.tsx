'use client';

/**
 * IntrusiveThoughts
 *
 * DOM overlay of falling text elements during reveal stakes phase.
 * Thoughts fall one-by-one, pile up, and each is individually draggable/swipeable.
 * Once all thoughts are dismissed, onDismiss fires.
 *
 * Designed for easy visual iteration — all styling is in separated constants.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

// ============================================================================
// Tunable constants (grouped for easy iteration)
// ============================================================================

/** Styling for individual thought elements. */
const THOUGHT_STYLE: React.CSSProperties = {
  fontSize: '0.85rem',
  fontFamily: 'monospace',
  padding: '8px 16px',
  borderRadius: '6px',
  background: 'rgba(20, 8, 8, 0.85)',
  border: '1px solid rgba(200, 60, 60, 0.2)',
  color: 'rgba(255, 180, 180, 0.7)',
  maxWidth: '80%',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  touchAction: 'none',
};

/** Animation timing parameters. */
const FALL_TIMING = {
  staggerMs: 600,           // Delay between each thought spawning
  fallDurationMs: 1800,     // Slow, low-gravity fall
  easing: 'linear',
  spawnOffsetPx: -80,       // Start above the viewport top
  xSpawnRange: 60,          // Random horizontal spawn offset (px, ±)
};

/** Pile-up geometry. */
const PILE_CONFIG = {
  landingPct: 35,           // % from top of viewport where first thought lands
  yOffsetPx: 48,            // Vertical spacing between stacked thoughts
  rotationRange: 5,
  xOffsetRange: 30,         // Horizontal scatter at landing position
};

/** Fling dismissal animation. */
const FLING_CONFIG = {
  swipeThresholdPx: 60,
  flingDurationMs: 350,
  flingDistancePx: 400,
  flingRotationDeg: 25,
};

// ============================================================================
// Component
// ============================================================================

interface IntrusiveThoughtsProps {
  thoughts: string[];
  active: boolean;
  dismissed: boolean;
  onDismiss: () => void;
  chapter: Chapter;
}

interface ThoughtItem {
  text: string;
  spawned: boolean;        // Mounted in DOM at spawn position (above viewport)
  falling: boolean;        // Transition to landing position triggered
  flung: boolean;
  flingDirection: 'left' | 'right';
  rotation: number;
  xOffset: number;         // Landing x scatter
  xSpawn: number;          // Spawn x offset (where it enters from)
  index: number;
  // Live drag state
  dragX: number;
  dragging: boolean;
}

export function IntrusiveThoughts({
  thoughts,
  active,
  dismissed,
  onDismiss,
  chapter,
}: IntrusiveThoughtsProps) {
  const [items, setItems] = useState<ThoughtItem[]>([]);
  const chapterIdentity = getChapterIdentity(chapter);

  // Seed randomized positions when thoughts activate (only once per activation)
  const seededRef = useRef(false);
  useEffect(() => {
    if (!active || dismissed) { seededRef.current = false; return; }
    if (seededRef.current) return;
    seededRef.current = true;

    const newItems: ThoughtItem[] = thoughts.map((text, i) => ({
      text,
      spawned: false,
      falling: false,
      flung: false,
      flingDirection: 'right' as const,
      rotation: (Math.random() - 0.5) * 2 * PILE_CONFIG.rotationRange,
      xOffset: (Math.random() - 0.5) * 2 * PILE_CONFIG.xOffsetRange,
      xSpawn: (Math.random() - 0.5) * 2 * FALL_TIMING.xSpawnRange,
      index: i,
      dragX: 0,
      dragging: false,
    }));
    setItems(newItems);

    // Two-phase stagger: first spawn (mount at top, no transition), then fall on next frame
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < newItems.length; i++) {
      // Phase 1: spawn into DOM at top of screen
      timers.push(setTimeout(() => {
        setItems(prev => prev.map((item, j) =>
          j === i ? { ...item, spawned: true } : item
        ));
        // Phase 2: trigger fall on next frame so CSS transition animates
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setItems(prev => prev.map((item, j) =>
              j === i ? { ...item, falling: true } : item
            ));
          });
        });
      }, FALL_TIMING.staggerMs * i));
    }

    return () => timers.forEach(clearTimeout);
  }, [active, dismissed, thoughts]);

  // Check if all are flung → fire onDismiss
  useEffect(() => {
    if (items.length > 0 && items.every(i => i.flung)) {
      const timer = setTimeout(() => {
        onDismiss();
        setItems([]);
      }, FLING_CONFIG.flingDurationMs + 50);
      return () => clearTimeout(timer);
    }
  }, [items, onDismiss]);

  // Clear on external dismiss
  useEffect(() => {
    if (dismissed && items.length > 0) {
      const timer = setTimeout(() => setItems([]), FLING_CONFIG.flingDurationMs + 100);
      return () => clearTimeout(timer);
    }
  }, [dismissed, items.length]);

  const handleDragStart = useCallback((index: number) => {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, dragging: true } : item
    ));
  }, []);

  const handleDragMove = useCallback((index: number, dx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, dragX: dx } : item
    ));
  }, []);

  const handleDragEnd = useCallback((index: number) => {
    setItems(prev => {
      const item = prev[index];
      if (!item) return prev;

      if (Math.abs(item.dragX) >= FLING_CONFIG.swipeThresholdPx) {
        // Fling it
        return prev.map((it, i) =>
          i === index ? { ...it, flung: true, flingDirection: it.dragX > 0 ? 'right' : 'left', dragging: false, dragX: 0 } : it
        );
      }
      // Snap back
      return prev.map((it, i) =>
        i === index ? { ...it, dragging: false, dragX: 0 } : it
      );
    });
  }, []);

  if (!active && items.length === 0) return null;

  const allVisible = items.length > 0 && items.every(i => i.falling);
  const anyNotFlung = items.some(i => !i.flung);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Swipe hint */}
      {allVisible && anyNotFlung && !dismissed && (
        <div
          style={{
            position: 'absolute',
            bottom: '16%',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.15)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            animation: 'swipeHintPulse 2s ease-in-out infinite',
            zIndex: 41,
            pointerEvents: 'none',
          }}
        >
          swipe to dismiss
        </div>
      )}

      {/* Individual draggable thought elements */}
      {items.filter(i => i.spawned).map((item) => (
        <DraggableThought
          key={item.index}
          item={item}
          totalCount={items.length}
          chapterColor={chapterIdentity.color}
          onDragStart={() => handleDragStart(item.index)}
          onDragMove={(dx) => handleDragMove(item.index, dx)}
          onDragEnd={() => handleDragEnd(item.index)}
        />
      ))}

      <style>{`
        @keyframes swipeHintPulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Individual draggable thought
// ============================================================================

function DraggableThought({
  item,
  totalCount,
  chapterColor,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: ThoughtItem;
  totalCount: number;
  chapterColor: string;
  onDragStart: () => void;
  onDragMove: (dx: number) => void;
  onDragEnd: () => void;
}) {
  const touchStartRef = useRef<{ x: number } | null>(null);
  // First thought (index 0) lands at bottom of pile, later ones stack above
  const reverseIndex = (totalCount - 1) - item.index;
  const landY = `calc(${PILE_CONFIG.landingPct}vh + ${reverseIndex * PILE_CONFIG.yOffsetPx}px)`;

  // Unified pointer start (touch + mouse)
  const pointerStart = useCallback((clientX: number) => {
    if (item.flung) return;
    touchStartRef.current = { x: clientX };
    onDragStart();
  }, [item.flung, onDragStart]);

  const pointerMove = useCallback((clientX: number) => {
    if (!touchStartRef.current || item.flung) return;
    onDragMove(clientX - touchStartRef.current.x);
  }, [item.flung, onDragMove]);

  const pointerEnd = useCallback(() => {
    if (!touchStartRef.current || item.flung) return;
    touchStartRef.current = null;
    onDragEnd();
  }, [item.flung, onDragEnd]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => pointerStart(e.touches[0].clientX), [pointerStart]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => pointerMove(e.touches[0].clientX), [pointerMove]);
  const handleTouchEnd = useCallback(() => pointerEnd(), [pointerEnd]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    pointerStart(e.clientX);

    const moveHandler = (ev: MouseEvent) => pointerMove(ev.clientX);
    const upHandler = () => {
      pointerEnd();
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
    };
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
  }, [pointerStart, pointerMove, pointerEnd]);

  // Compute transform
  let transform: string;
  let opacity: number;
  let transition: string;

  if (item.flung) {
    const dist = item.flingDirection === 'right' ? FLING_CONFIG.flingDistancePx : -FLING_CONFIG.flingDistancePx;
    const rot = item.flingDirection === 'right' ? FLING_CONFIG.flingRotationDeg : -FLING_CONFIG.flingRotationDeg;
    transform = `translateX(calc(-50% + ${item.xOffset}px + ${dist}px)) rotate(${rot}deg)`;
    opacity = 0;
    transition = `transform ${FLING_CONFIG.flingDurationMs}ms ease-in, opacity ${FLING_CONFIG.flingDurationMs * 0.7}ms ease-in`;
  } else if (item.dragging) {
    const dragRotation = item.dragX * 0.05;
    transform = `translateX(calc(-50% + ${item.xOffset + item.dragX}px)) rotate(${item.rotation + dragRotation}deg)`;
    opacity = Math.max(0.3, 1 - Math.abs(item.dragX) / FLING_CONFIG.flingDistancePx);
    transition = 'none';
  } else if (item.falling) {
    // Falling → landed at pile position (CSS transition animates the travel)
    transform = `translateX(calc(-50% + ${item.xOffset}px)) rotate(${item.rotation}deg)`;
    opacity = 1;
    transition = `transform ${FALL_TIMING.fallDurationMs}ms ${FALL_TIMING.easing}, opacity ${FALL_TIMING.fallDurationMs * 0.3}ms ease-out`;
  } else if (item.spawned) {
    // Just spawned: positioned above the viewport, visible, no transition yet
    transform = `translateX(calc(-50% + ${item.xSpawn}px)) translateY(calc(-${PILE_CONFIG.landingPct}vh + ${FALL_TIMING.spawnOffsetPx}px)) rotate(0deg)`;
    opacity = 0.85;
    transition = 'none';
  } else {
    // Not yet in DOM — hidden
    transform = `translateX(-50%) translateY(${FALL_TIMING.spawnOffsetPx}px)`;
    opacity = 0;
    transition = 'none';
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: '50%',
        top: landY,
        transform,
        opacity,
        transition,
        ...THOUGHT_STYLE,
        borderColor: `${chapterColor}25`,
        zIndex: 40 + item.index,
        pointerEvents: item.flung ? 'none' : 'auto',
        cursor: item.flung ? 'default' : 'grab',
      }}
    >
      {item.text}
    </div>
  );
}

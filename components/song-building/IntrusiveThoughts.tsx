'use client';

/**
 * IntrusiveThoughts
 *
 * DOM overlay of falling text elements during reveal phases.
 * Thoughts are server-assigned with unique IDs. Each is individually draggable/swipeable.
 * When dismissed, the parent is notified with the thought ID + direction.
 *
 * Designed for easy visual iteration — all styling is in separated constants.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

// ============================================================================
// Tunable constants (grouped for easy iteration)
// ============================================================================

/** Styling for individual thought bubble elements. */
const THOUGHT_STYLE: React.CSSProperties = {
  fontSize: '0.85rem',
  fontFamily: 'monospace',
  padding: '10px 18px',
  borderRadius: '20px',
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

/** Styling for the sub-bubble tail. */
const TAIL_SIZE = 8;
const TAIL_OFFSET_X = 12;  // px from bubble edge

/** Animation timing parameters. */
const FALL_TIMING = {
  staggerMs: 600,
  fallDurationMs: 1800,
  easing: 'linear',
  spawnOffsetPx: -80,
  xSpawnRange: 60,
};

/** Pile-up geometry. */
const PILE_CONFIG = {
  landingPct: 35,
  yOffsetPx: 48,
  rotationRange: 5,
  xOffsetRange: 30,
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
  thoughts: { id: string; text: string }[];
  active: boolean;
  onDismiss: (thoughtId: string, direction: 'left' | 'right') => void;
  chapter: Chapter;
}

interface ThoughtItem {
  id: string;
  text: string;
  spawned: boolean;
  falling: boolean;
  flung: boolean;
  gone: boolean;             // True after fling animation completes (hidden but keeps slot)
  flingDirection: 'left' | 'right';
  rotation: number;
  xOffset: number;
  xSpawn: number;
  index: number;
  dragX: number;
  dragging: boolean;
  tailSide: 'left' | 'right';
}

export function IntrusiveThoughts({
  thoughts,
  active,
  onDismiss,
  chapter,
}: IntrusiveThoughtsProps) {
  const [items, setItems] = useState<ThoughtItem[]>([]);
  const chapterIdentity = getChapterIdentity(chapter);
  const seededRef = useRef(false);

  // Build items from server-assigned thoughts (only once per activation)
  useEffect(() => {
    if (!active || thoughts.length === 0) {
      seededRef.current = false;
      setItems([]);
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;

    const newItems: ThoughtItem[] = thoughts.map((t, i) => ({
      id: t.id,
      text: t.text,
      spawned: false,
      falling: false,
      flung: false,
      gone: false,
      flingDirection: 'right' as const,
      rotation: (Math.random() - 0.5) * 2 * PILE_CONFIG.rotationRange,
      xOffset: (Math.random() - 0.5) * 2 * PILE_CONFIG.xOffsetRange,
      xSpawn: (Math.random() - 0.5) * 2 * FALL_TIMING.xSpawnRange,
      index: i,
      dragX: 0,
      dragging: false,
      tailSide: Math.random() > 0.5 ? 'right' : 'left',
    }));
    setItems(newItems);

    // Two-phase stagger: spawn at top, then trigger fall on next frame
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < newItems.length; i++) {
      timers.push(setTimeout(() => {
        setItems(prev => prev.map((item, j) =>
          j === i ? { ...item, spawned: true } : item
        ));
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
  }, [active, thoughts]);

  // Mark flung items as gone (hidden) after animation, but don't remove from array
  // so that remaining items keep stable indices/positions.
  useEffect(() => {
    const flungItems = items.filter(i => i.flung && !i.gone);
    if (flungItems.length === 0) return;
    const timer = setTimeout(() => {
      setItems(prev => prev.map(i => i.flung ? { ...i, gone: true } : i));
    }, FLING_CONFIG.flingDurationMs + 50);
    return () => clearTimeout(timer);
  }, [items]);

  const handleDragStart = useCallback((id: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, dragging: true } : item
    ));
  }, []);

  const handleDragMove = useCallback((id: string, dx: number) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, dragX: dx } : item
    ));
  }, []);

  const handleDragEnd = useCallback((id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (!item) return prev;

      if (Math.abs(item.dragX) >= FLING_CONFIG.swipeThresholdPx) {
        const direction = item.dragX > 0 ? 'right' as const : 'left' as const;
        onDismiss(item.id, direction);
        return prev.map(it =>
          it.id === id ? { ...it, flung: true, flingDirection: direction, dragging: false, dragX: 0 } : it
        );
      }
      return prev.map(it =>
        it.id === id ? { ...it, dragging: false, dragX: 0 } : it
      );
    });
  }, [onDismiss]);

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
      {allVisible && anyNotFlung && (
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
      {items.filter(i => i.spawned && !i.gone).map((item) => (
        <DraggableThought
          key={item.id}
          item={item}
          totalCount={items.length}
          chapterColor={chapterIdentity.color}
          onDragStart={() => handleDragStart(item.id)}
          onDragMove={(dx) => handleDragMove(item.id, dx)}
          onDragEnd={() => handleDragEnd(item.id)}
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

  // Unified pointer handlers
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

  const handleTouchStart = useCallback((e: React.TouchEvent) => pointerStart(e.touches[0].clientX), [pointerStart]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => pointerMove(e.touches[0].clientX), [pointerMove]);
  const handleTouchEnd = useCallback(() => pointerEnd(), [pointerEnd]);

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
    transform = `translateX(calc(-50% + ${item.xOffset}px)) rotate(${item.rotation}deg)`;
    opacity = 1;
    transition = `transform ${FALL_TIMING.fallDurationMs}ms ${FALL_TIMING.easing}, opacity ${FALL_TIMING.fallDurationMs * 0.3}ms ease-out`;
  } else if (item.spawned) {
    transform = `translateX(calc(-50% + ${item.xSpawn}px)) translateY(calc(-${PILE_CONFIG.landingPct}vh + ${FALL_TIMING.spawnOffsetPx}px)) rotate(0deg)`;
    opacity = 0.85;
    transition = 'none';
  } else {
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
      {/* Sub-bubble tail */}
      <div
        style={{
          position: 'absolute',
          bottom: -TAIL_SIZE - 3,
          [item.tailSide]: TAIL_OFFSET_X,
          width: TAIL_SIZE,
          height: TAIL_SIZE,
          borderRadius: '50%',
          background: 'inherit',
          border: 'inherit',
        }}
      />
    </div>
  );
}

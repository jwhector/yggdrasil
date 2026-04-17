'use client';

/**
 * IntrusiveThoughts
 *
 * DOM overlay of falling text elements that appear after a collapse.
 * Thoughts are server-assigned with unique IDs. They fall and pile up,
 * then get auto-cleared by the server when the show advances.
 */

import { useEffect, useState, useRef } from 'react';
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

// ============================================================================
// Component
// ============================================================================

interface IntrusiveThoughtsProps {
  thoughts: { id: string; text: string }[];
  active: boolean;
  chapter: Chapter;
}

interface ThoughtItem {
  id: string;
  text: string;
  spawned: boolean;
  falling: boolean;
  rotation: number;
  xOffset: number;
  xSpawn: number;
  index: number;
  tailSide: 'left' | 'right';
}

export function IntrusiveThoughts({
  thoughts,
  active,
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
      rotation: (Math.random() - 0.5) * 2 * PILE_CONFIG.rotationRange,
      xOffset: (Math.random() - 0.5) * 2 * PILE_CONFIG.xOffsetRange,
      xSpawn: (Math.random() - 0.5) * 2 * FALL_TIMING.xSpawnRange,
      index: i,
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

  if (!active && items.length === 0) return null;

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
      {items.filter(i => i.spawned).map((item) => {
        const totalCount = items.length;
        // First thought (index 0) lands at bottom of pile, later ones stack above
        const reverseIndex = (totalCount - 1) - item.index;
        const landY = `calc(${PILE_CONFIG.landingPct}vh + ${reverseIndex * PILE_CONFIG.yOffsetPx}px)`;

        let transform: string;
        let opacity: number;
        let transition: string;

        if (item.falling) {
          transform = `translateX(calc(-50% + ${item.xOffset}px)) rotate(${item.rotation}deg)`;
          opacity = 1;
          transition = `transform ${FALL_TIMING.fallDurationMs}ms ${FALL_TIMING.easing}, opacity ${FALL_TIMING.fallDurationMs * 0.3}ms ease-out`;
        } else {
          transform = `translateX(calc(-50% + ${item.xSpawn}px)) translateY(calc(-${PILE_CONFIG.landingPct}vh + ${FALL_TIMING.spawnOffsetPx}px)) rotate(0deg)`;
          opacity = 0.85;
          transition = 'none';
        }

        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: '50%',
              top: landY,
              transform,
              opacity,
              transition,
              ...THOUGHT_STYLE,
              borderColor: `${chapterIdentity.color}25`,
              zIndex: 40 + item.index,
              pointerEvents: 'none',
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
      })}
    </div>
  );
}

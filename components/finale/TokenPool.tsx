/**
 * TokenPool (V3.4)
 *
 * Projector canvas component: floating colored dots representing tokens.
 * Each dot = one available token, colored by chapter.
 * Dots drift gently with simple physics. Bloom on creation, absorb into
 * pentagon on spend. Rendered with canvas 2D + requestAnimationFrame.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { ChapterConfig } from '@/conductor/types';
import { hexToRgb } from '@/components/projector/renderers/shared';
import type { RGB } from '@/components/projector/renderers/shared';

interface TokenPoolProps {
  /** Available tokens per chapter from pool_state. */
  availableByChapter: Array<{ chapterId: string; count: number }>;
  /** Chapter configs for color resolution. */
  chapters: ChapterConfig[];
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  /** Called when a dot drag starts (touch or mouse). */
  onDotDragStart?: (chapterId: string, x: number, y: number) => void;
  /** Whether drag interaction is enabled (finale_remix). */
  interactionEnabled?: boolean;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: RGB;
  chapterId: string;
  age: number;       // 0-1, for bloom animation
  opacity: number;
}

const DOT_RADIUS = 6;
const DOT_SPACING = 2.5;  // Minimum spacing between dots as multiplier of radius
const DRIFT_SPEED = 0.15;
const DAMPING = 0.98;
const BLOOM_DURATION = 0.5;  // Seconds for bloom-in animation
const TOUCH_TARGET_RADIUS = 22;  // ~44pt touch target

export function TokenPool({
  availableByChapter,
  chapters,
  width,
  height,
  onDotDragStart,
  interactionEnabled = false,
}: TokenPoolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Build chapter color map
  const chapterColors = useRef<Map<string, RGB>>(new Map());
  useEffect(() => {
    const map = new Map<string, RGB>();
    for (const ch of chapters) {
      map.set(ch.id, hexToRgb(ch.color));
    }
    chapterColors.current = map;
  }, [chapters]);

  // Reconcile dots with pool state
  useEffect(() => {
    const existing = dotsRef.current;
    const newDots: Dot[] = [];

    for (const { chapterId, count } of availableByChapter) {
      const color = chapterColors.current.get(chapterId) ?? { r: 128, g: 128, b: 128 };

      // Count existing dots for this chapter
      const existingForChapter = existing.filter(d => d.chapterId === chapterId);
      const needed = count - existingForChapter.length;

      // Keep existing dots (up to count)
      for (let i = 0; i < Math.min(existingForChapter.length, count); i++) {
        newDots.push(existingForChapter[i]);
      }

      // Add new dots if needed
      if (needed > 0) {
        for (let i = 0; i < needed; i++) {
          newDots.push({
            x: Math.random() * width * 0.8 + width * 0.1,
            y: Math.random() * height * 0.6 + height * 0.05,
            vx: (Math.random() - 0.5) * DRIFT_SPEED,
            vy: (Math.random() - 0.5) * DRIFT_SPEED,
            radius: DOT_RADIUS + (Math.random() - 0.5) * 2,
            color,
            chapterId,
            age: 0,
            opacity: 1,
          });
        }
      }
    }

    dotsRef.current = newDots;
  }, [availableByChapter, width, height]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    lastTimeRef.current = performance.now();

    const animate = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      ctx.clearRect(0, 0, width, height);

      const dots = dotsRef.current;
      for (const dot of dots) {
        // Age bloom
        if (dot.age < 1) {
          dot.age = Math.min(1, dot.age + dt / BLOOM_DURATION);
        }

        // Drift physics
        dot.vx += (Math.random() - 0.5) * 0.02;
        dot.vy += (Math.random() - 0.5) * 0.02;
        dot.vx *= DAMPING;
        dot.vy *= DAMPING;
        dot.x += dot.vx;
        dot.y += dot.vy;

        // Bounce off edges (with padding)
        const pad = dot.radius * 2;
        if (dot.x < pad) { dot.x = pad; dot.vx = Math.abs(dot.vx); }
        if (dot.x > width - pad) { dot.x = width - pad; dot.vx = -Math.abs(dot.vx); }
        if (dot.y < pad) { dot.y = pad; dot.vy = Math.abs(dot.vy); }
        if (dot.y > height - pad) { dot.y = height - pad; dot.vy = -Math.abs(dot.vy); }

        // Draw
        const bloomScale = easeOut(dot.age);
        const r = dot.radius * bloomScale;
        const alpha = dot.opacity * bloomScale;

        if (r > 0.5 && alpha > 0.01) {
          // Glow
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, r * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${dot.color.r},${dot.color.g},${dot.color.b},${alpha * 0.08})`;
          ctx.fill();

          // Core
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${dot.color.r},${dot.color.g},${dot.color.b},${alpha * 0.85})`;
          ctx.fill();
        }
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height]);

  // Hit-test: find closest dot within target radius
  const findClosestDot = useCallback((canvasX: number, canvasY: number): Dot | null => {
    if (!interactionEnabled || !onDotDragStart) return null;
    const dots = dotsRef.current;
    let closestDot: Dot | null = null;
    let closestDist = TOUCH_TARGET_RADIUS;

    for (const dot of dots) {
      const dx = canvasX - dot.x;
      const dy = canvasY - dot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestDot = dot;
      }
    }
    return closestDot;
  }, [interactionEnabled, onDotDragStart]);

  // Start drag from a dot (shared between touch and mouse)
  const startDragFromDot = useCallback((dot: Dot, clientX: number, clientY: number) => {
    dotsRef.current = dotsRef.current.filter(d => d !== dot);
    onDotDragStart!(dot.chapterId, clientX, clientY);
  }, [onDotDragStart]);

  // Touch handling
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    const dot = findClosestDot(touch.clientX - rect.left, touch.clientY - rect.top);
    if (dot) {
      e.preventDefault();
      startDragFromDot(dot, touch.clientX, touch.clientY);
    }
  }, [findClosestDot, startDragFromDot]);

  // Mouse handling (desktop)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dot = findClosestDot(e.clientX - rect.left, e.clientY - rect.top);
    if (dot) {
      e.preventDefault();
      startDragFromDot(dot, e.clientX, e.clientY);
    }
  }, [findClosestDot, startDragFromDot]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        position: 'absolute',
        top: 0,
        left: 0,
        touchAction: 'none',
        pointerEvents: interactionEnabled ? 'auto' : 'none',
        cursor: interactionEnabled ? 'grab' : 'default',
      }}
      onTouchStart={handleTouchStart}
      onMouseDown={handleMouseDown}
    />
  );
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, t), 3);
}

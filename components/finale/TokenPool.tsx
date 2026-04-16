/**
 * TokenPool (V3.4)
 *
 * Projector canvas component: floating colored dots representing tokens.
 * Each dot = one available token, colored by chapter.
 * Dots drift gently with simple physics. Bloom on creation, absorb into
 * pentagon on spend. Rendered with canvas 2D + requestAnimationFrame.
 *
 * Exposes injectDot() via ref for coordinated fly-in animations.
 */

'use client';

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { ChapterConfig } from '@/conductor/types';
import { hexToRgb } from '@/components/projector/renderers/shared';
import type { RGB } from '@/components/projector/renderers/shared';

export interface CollisionZone {
  x: number;
  y: number;
  radius: number;
}

export interface TokenPoolHandle {
  /** Queue a landing position so the next reconciled dot for this chapter spawns there. */
  queueLandingPosition: (chapterId: string, x: number, y: number) => void;
}

interface NodeTallyData {
  granularType: string;
  votes: Array<{ chapterId: string; count: number }>;
}

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
  /** Circles that dots should avoid (pentagon nodes). */
  collisionZones?: CollisionZone[];
  /** Audience tally per node — drives orbit assignments. */
  nodeTallies?: NodeTallyData[];
  /** Node center positions (from pentagon layout). */
  nodePositions?: Record<string, { x: number; y: number }>;
  /** Node radius for orbit distance. */
  nodeRadius?: number;
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
  // Orbit state — null when floating freely
  orbitNode: string | null;
  orbitAngle: number;
  orbitSpeed: number;     // radians per second
  orbitRadius: number;    // distance from node center
  transitionT: number;    // 0→1 lerp progress (float↔orbit)
}

const DOT_RADIUS = 6;
const DRIFT_SPEED = 0.15;
const DAMPING = 0.98;
const BLOOM_DURATION = 0.5;  // Seconds for bloom-in animation
const MAX_VISIBLE_DOTS = 150; // Cap rendered dots for performance headroom
const TOUCH_TARGET_RADIUS = 22;  // ~44pt touch target
const ORBIT_TRANSITION_SPEED = 0.1; // 0→1 in ~0.4s
const ORBIT_BASE_SPEED = 0.6; // radians/sec base orbit speed
const ORBIT_SPEED_VARIANCE = 0.3; // +/- variance per dot
const ORBIT_RADIUS_VARIANCE = 8; // +/- pixels variance per dot

export const TokenPool = forwardRef<TokenPoolHandle, TokenPoolProps>(function TokenPool({
  availableByChapter,
  chapters,
  width,
  height,
  onDotDragStart,
  interactionEnabled = false,
  collisionZones = [],
  nodeTallies,
  nodePositions,
  nodeRadius = 30,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Queued landing positions from fly-in animations — reconciliation pops from here
  const landingQueueRef = useRef<Map<string, Array<{ x: number; y: number }>>>(new Map());

  // Build chapter color map
  const chapterColors = useRef<Map<string, RGB>>(new Map());
  useEffect(() => {
    const map = new Map<string, RGB>();
    for (const ch of chapters) {
      map.set(ch.id, hexToRgb(ch.color));
    }
    chapterColors.current = map;
  }, [chapters]);

  // Expose queueLandingPosition via ref
  useImperativeHandle(ref, () => ({
    queueLandingPosition(chapterId: string, x: number, y: number) {
      const queue = landingQueueRef.current.get(chapterId) ?? [];
      queue.push({ x, y });
      landingQueueRef.current.set(chapterId, queue);
    },
  }), []);

  // Reconcile dots with pool state
  useEffect(() => {
    const existing = dotsRef.current;
    const newDots: Dot[] = [];

    // Cap total dots for performance — distribute proportionally across chapters
    const totalAvailable = availableByChapter.reduce((s, e) => s + e.count, 0);
    const dotScale = totalAvailable > MAX_VISIBLE_DOTS ? MAX_VISIBLE_DOTS / totalAvailable : 1;

    for (const { chapterId, count } of availableByChapter) {
      const color = chapterColors.current.get(chapterId) ?? { r: 128, g: 128, b: 128 };
      const cappedCount = Math.round(count * dotScale);

      // Count existing dots for this chapter
      const existingForChapter = existing.filter(d => d.chapterId === chapterId);
      const needed = cappedCount - existingForChapter.length;

      // Keep existing dots (up to capped count)
      for (let i = 0; i < Math.min(existingForChapter.length, cappedCount); i++) {
        newDots.push(existingForChapter[i]);
      }

      // Spawn new dots — use queued landing positions first, then random
      if (needed > 0) {
        const queue = landingQueueRef.current.get(chapterId) ?? [];

        for (let i = 0; i < needed; i++) {
          const queued = queue.shift();
          let x: number, y: number;

          if (queued) {
            // Use the fly-in landing position
            x = queued.x;
            y = queued.y;
          } else {
            // Fall back to random position
            let attempts = 0;
            do {
              x = Math.random() * width * 0.8 + width * 0.1;
              y = Math.random() * height * 0.6 + height * 0.05;
              attempts++;
            } while (
              attempts < 20 &&
              collisionZones.some(z => {
                const dx = x - z.x, dy = y - z.y;
                return dx * dx + dy * dy < z.radius * z.radius;
              })
            );
          }

          newDots.push({
            x,
            y,
            vx: (Math.random() - 0.5) * DRIFT_SPEED,
            vy: (Math.random() - 0.5) * DRIFT_SPEED,
            radius: DOT_RADIUS + (Math.random() - 0.5) * 2,
            color,
            chapterId,
            age: 0,
            opacity: 1,
            orbitNode: null,
            orbitAngle: Math.random() * Math.PI * 2,
            orbitSpeed: ORBIT_BASE_SPEED + (Math.random() - 0.5) * ORBIT_SPEED_VARIANCE,
            orbitRadius: nodeRadius * 1.7 + (Math.random() - 0.5) * ORBIT_RADIUS_VARIANCE,
            transitionT: 0,
          });
        }
      }
    }

    dotsRef.current = newDots;
  }, [availableByChapter, width, height, nodeRadius]);

  // Store tallies + positions in refs so animation loop can access them
  const nodeTalliesRef = useRef(nodeTallies);
  const nodePositionsRef = useRef(nodePositions);
  nodeTalliesRef.current = nodeTallies;
  nodePositionsRef.current = nodePositions;

  // Tally-driven orbit reassignment — runs when tallies change
  useEffect(() => {
    if (!nodeTallies || !nodePositions) return;
    const dots = dotsRef.current;

    // Build desired orbit counts: { "bass:ambition": 3, ... }
    const desired = new Map<string, number>();
    for (const nt of nodeTallies) {
      for (const v of nt.votes) {
        if (v.count > 0) {
          desired.set(`${nt.granularType}:${v.chapterId}`, v.count);
        }
      }
    }

    // Scale desired counts to fit within MAX_VISIBLE_DOTS
    const totalDesiredOrbiting = Array.from(desired.values()).reduce((s, c) => s + c, 0);
    const totalDots = dots.length;
    const orbitScale = totalDesiredOrbiting > totalDots * 0.8
      ? (totalDots * 0.8) / totalDesiredOrbiting : 1;

    const scaledDesired = new Map<string, number>();
    for (const [key, count] of desired) {
      scaledDesired.set(key, Math.round(count * orbitScale));
    }

    // Count current orbiting dots per key
    const currentOrbiting = new Map<string, number>();
    for (const dot of dots) {
      if (dot.orbitNode) {
        const key = `${dot.orbitNode}:${dot.chapterId}`;
        currentOrbiting.set(key, (currentOrbiting.get(key) ?? 0) + 1);
      }
    }

    // Release excess orbiting dots — scatter away from nodes
    for (const [key, current] of currentOrbiting) {
      const want = scaledDesired.get(key) ?? 0;
      if (current > want) {
        let toRelease = current - want;
        for (const dot of dots) {
          if (toRelease <= 0) break;
          if (dot.orbitNode && `${dot.orbitNode}:${dot.chapterId}` === key) {
            const nodePos = nodePositions[dot.orbitNode];
            // Direction away from the node center
            const dx = dot.x - nodePos.x;
            const dy = dot.y - nodePos.y;
            // Add angular spread so dots fan out rather than all going radially
            const spread = (Math.random() - 0.5) * 1.2;
            const baseAngle = Math.atan2(dy, dx) + spread;
            const speed = 2.5 + Math.random() * 1.5;
            dot.orbitNode = null;
            dot.transitionT = 0;
            dot.vx = Math.cos(baseAngle) * speed;
            dot.vy = Math.sin(baseAngle) * speed;
            toRelease--;
          }
        }
      }
    }

    // Assign floating dots to orbit where more are needed
    for (const [key, want] of scaledDesired) {
      const current = currentOrbiting.get(key) ?? 0;
      if (want > current) {
        const [granularType, chapterId] = key.split(':');
        let toAssign = want - current;
        for (const dot of dots) {
          if (toAssign <= 0) break;
          if (dot.orbitNode === null && dot.chapterId === chapterId) {
            dot.orbitNode = granularType;
            dot.transitionT = 0;
            dot.orbitAngle = Math.random() * Math.PI * 2;
            dot.orbitSpeed = ORBIT_BASE_SPEED + (Math.random() - 0.5) * ORBIT_SPEED_VARIANCE;
            dot.orbitRadius = nodeRadius * 1.7 + (Math.random() - 0.5) * ORBIT_RADIUS_VARIANCE;
            toAssign--;
          }
        }
      }
    }
  }, [nodeTallies, nodePositions, nodeRadius]);

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
      const positions = nodePositionsRef.current;

      for (const dot of dots) {
        // Age bloom
        if (dot.age < 1) {
          dot.age = Math.min(1, dot.age + dt / BLOOM_DURATION);
        }

        // Transition progress (float↔orbit lerp)
        if (dot.transitionT < 1) {
          dot.transitionT = Math.min(1, dot.transitionT + dt * ORBIT_TRANSITION_SPEED);
        }

        if (dot.orbitNode && positions && positions[dot.orbitNode]) {
          // Orbiting dot — circular motion around the node
          const nodePos = positions[dot.orbitNode];
          dot.orbitAngle += dot.orbitSpeed * dt;

          const targetX = nodePos.x + Math.cos(dot.orbitAngle) * dot.orbitRadius;
          const targetY = nodePos.y + Math.sin(dot.orbitAngle) * dot.orbitRadius;

          if (dot.transitionT < 1) {
            // Lerp toward orbit path
            const t = easeOut(dot.transitionT);
            dot.x += (targetX - dot.x) * t * 0.15;
            dot.y += (targetY - dot.y) * t * 0.15;
          } else {
            dot.x = targetX;
            dot.y = targetY;
          }
          // Zero drift velocity while orbiting
          dot.vx = 0;
          dot.vy = 0;
        } else {
          // Floating dot — existing Brownian drift

          if (dot.transitionT < 1) {
            // Just released from orbit — light damping so scatter velocity carries far
            dot.vx *= 0.99;
            dot.vy *= 0.99;
            dot.x += dot.vx;
            dot.y += dot.vy;
          } else {
            dot.vx += (Math.random() - 0.5) * 0.02;
            dot.vy += (Math.random() - 0.5) * 0.02;
            dot.vx *= DAMPING;
            dot.vy *= DAMPING;
            dot.x += dot.vx;
            dot.y += dot.vy;
          }

          // Repulsion from collision zones (pentagon nodes) — only for fully floating dots
          if (dot.transitionT >= 1) {
            for (const zone of collisionZones) {
              const dx = dot.x - zone.x;
              const dy = dot.y - zone.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < zone.radius && dist > 0.1) {
                const overlap = zone.radius - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                dot.x += nx * overlap * 0.3;
                dot.y += ny * overlap * 0.3;
                dot.vx += nx * 0.05;
                dot.vy += ny * 0.05;
              }
            }
          }
        }

        // Bounce off edges (with padding)
        const pad = dot.radius * 2;
        if (dot.x < pad) { dot.x = pad; dot.vx = Math.abs(dot.vx); }
        if (dot.x > width - pad) { dot.x = width - pad; dot.vx = -Math.abs(dot.vx); }
        if (dot.y < pad) { dot.y = pad; dot.vy = Math.abs(dot.vy); }
        if (dot.y > height - pad) { dot.y = height - pad; dot.vy = -Math.abs(dot.vy); }

        // Draw — layered radial gradients for a soft, luminous look
        const bloomScale = easeOut(dot.age);
        const r = dot.radius * bloomScale;
        const alpha = dot.opacity * bloomScale;
        const { r: cr, g: cg, b: cb } = dot.color;

        if (r > 0.5 && alpha > 0.01) {
          // Outer haze — wide, very faint
          const hazeR = r * 5;
          const haze = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, hazeR);
          haze.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 0.12})`);
          haze.addColorStop(0.4, `rgba(${cr},${cg},${cb},${alpha * 0.04})`);
          haze.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, hazeR, 0, Math.PI * 2);
          ctx.fillStyle = haze;
          ctx.fill();

          // Mid glow — soft bloom
          const glowR = r * 2.5;
          const glow = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, glowR);
          glow.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 0.35})`);
          glow.addColorStop(0.5, `rgba(${cr},${cg},${cb},${alpha * 0.1})`);
          glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();

          // Core — bright center with soft edge
          const coreR = r * 1.2;
          const core = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, coreR);
          core.addColorStop(0, `rgba(${Math.min(cr + 60, 255)},${Math.min(cg + 60, 255)},${Math.min(cb + 60, 255)},${alpha * 0.9})`);
          core.addColorStop(0.4, `rgba(${cr},${cg},${cb},${alpha * 0.6})`);
          core.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, coreR, 0, Math.PI * 2);
          ctx.fillStyle = core;
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
});

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, t), 3);
}

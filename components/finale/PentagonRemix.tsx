/**
 * PentagonRemix (V3.4)
 *
 * Projector component: 6 pentagon nodes (5 outer + center seed) as drop targets
 * for the performer's token drag interaction. Shows active chapter color,
 * loop progress ring, and queue depth indicators.
 *
 * Layout mirrors the song-building projector pentagon (see renderers/shared.ts).
 */

'use client';

import { useEffect, useRef, useMemo } from 'react';
import type { ChapterConfig, GranularType } from '@/conductor/types';
import {
  PENTAGON_NODES,
  computeLayout,
  drawMembrane,
  hexToRgb,
  rgb,
  smoothNoise,
} from '@/components/projector/renderers/shared';
import type { RGB } from '@/components/projector/renderers/shared';
import type { DropZone } from '@/hooks/useDragToken';

interface ActiveNodeView {
  granularType: string;
  chapterId: string;
  trackIndices: number[];
  persistent: boolean;
}

interface QueueDepthView {
  granularType: string;
  depth: number;
  nextChapterId: string | null;
}

interface ValidNode {
  granularType: string;
  chapterId: string;
}

interface PentagonRemixProps {
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  /** Active nodes (currently playing). */
  activeNodes: ActiveNodeView[];
  /** Queue depth per granular type. */
  queueDepths: QueueDepthView[];
  /** Loop progress 0-1 for progress ring. */
  loopProgress: number;
  /** Chapter configs for color resolution. */
  chapters: ChapterConfig[];
  /** Granular types for labels. */
  granularTypes: GranularType[];
  /** Drag hover target (granular type ID or null). */
  hoverTarget: string | null;
  /** Chapter ID of the token being dragged (null if not dragging). */
  dragChapterId: string | null;
  /** Valid granularType+chapter combos (have tracks from song-building). */
  validNodes: ValidNode[];
  /** Whether audience interaction mode is active. */
  audienceInteraction: boolean;
  /** Callback to register drop zones for drag hit testing. */
  onDropZonesComputed?: (zones: DropZone[]) => void;
}

const SEED_ID = 'seed';

export function PentagonRemix({
  width,
  height,
  activeNodes,
  queueDepths,
  loopProgress,
  chapters,
  granularTypes,
  hoverTarget,
  dragChapterId,
  validNodes,
  audienceInteraction,
  onDropZonesComputed,
}: PentagonRemixProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());

  // Build chapter color map
  const chapterColorMap = useMemo(() => {
    const map = new Map<string, RGB>();
    for (const ch of chapters) {
      map.set(ch.id, hexToRgb(ch.color));
    }
    return map;
  }, [chapters]);

  // Build active/queue lookup maps
  const activeMap = useMemo(() => {
    const map = new Map<string, ActiveNodeView>();
    for (const node of activeNodes) {
      map.set(node.granularType, node);
    }
    return map;
  }, [activeNodes]);

  const queueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of queueDepths) {
      map.set(q.granularType, q.depth);
    }
    return map;
  }, [queueDepths]);

  const nextChapterMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const q of queueDepths) {
      map.set(q.granularType, q.nextChapterId);
    }
    return map;
  }, [queueDepths]);

  // Build set of granular types that are valid for the currently-dragged chapter
  const validForDrag = useMemo(() => {
    if (!dragChapterId) return null;  // Not dragging — no highlighting
    const set = new Set<string>();
    for (const vn of validNodes) {
      if (vn.chapterId === dragChapterId) set.add(vn.granularType);
    }
    return set;
  }, [dragChapterId, validNodes]);

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

    const layout = computeLayout(width, height);

    // Report drop zones for drag hit testing
    if (onDropZonesComputed) {
      const zones: DropZone[] = PENTAGON_NODES.map(node => ({
        id: node.id,
        x: layout.positions[node.id].x,
        y: layout.positions[node.id].y,
        radius: layout.nodeRadius,
      }));
      // Add seed node
      zones.push({
        id: SEED_ID,
        x: layout.centerX,
        y: layout.centerY,
        radius: layout.seedRadius,
      });
      onDropZonesComputed(zones);
    }

    const animate = () => {
      const t = (performance.now() - startTimeRef.current) / 1000;
      ctx.clearRect(0, 0, width, height);

      // Draw radial lines (dim connectors)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (const node of PENTAGON_NODES) {
        const pos = layout.positions[node.id];
        ctx.beginPath();
        ctx.moveTo(layout.centerX, layout.centerY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }

      // Global loop ring (interpolated for smooth 60fps)
      const smoothLoop = getInterpolatedLoopPosition(loopProgress);
      drawLoopRing(ctx, layout.centerX, layout.centerY, layout.orbitRadius, layout.nodeRadius, smoothLoop);

      // Draw nodes
      for (const nodeDef of PENTAGON_NODES) {
        const pos = layout.positions[nodeDef.id];
        const active = activeMap.get(nodeDef.id);
        const queueDepth = queueMap.get(nodeDef.id) ?? 0;
        const isHovered = hoverTarget === nodeDef.id;
        const dragValidity = validForDrag === null ? 'none' as const
          : validForDrag.has(nodeDef.id) ? 'valid' as const : 'invalid' as const;
        const nextChapter = nextChapterMap.get(nodeDef.id) ?? null;

        drawRemixNode(ctx, pos.x, pos.y, layout.nodeRadius, nodeDef, active, queueDepth, isHovered, dragValidity, nextChapter, chapterColorMap, t);
      }

      // Draw seed node (center)
      {
        const active = activeMap.get(SEED_ID);
        const queueDepth = queueMap.get(SEED_ID) ?? 0;
        const isHovered = hoverTarget === SEED_ID;
        const dragValidity = validForDrag === null ? 'none' as const
          : validForDrag.has(SEED_ID) ? 'valid' as const : 'invalid' as const;
        const nextChapter = nextChapterMap.get(SEED_ID) ?? null;
        drawRemixNode(ctx, layout.centerX, layout.centerY, layout.seedRadius, { id: SEED_ID, symbol: '\u25CE', label: 'SEED' }, active, queueDepth, isHovered, dragValidity, nextChapter, chapterColorMap, t);
      }

      // Audience interaction indicator
      if (audienceInteraction) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('AUDIENCE MODE', layout.centerX, height - 20);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, activeMap, queueMap, nextChapterMap, loopProgress, hoverTarget, validForDrag, chapterColorMap, audienceInteraction, onDropZonesComputed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Node drawing
// ---------------------------------------------------------------------------

function drawRemixNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  nodeDef: { id: string; symbol: string; label: string },
  active: { chapterId: string; persistent: boolean } | undefined,
  queueDepth: number,
  isHovered: boolean,
  dragValidity: 'none' | 'valid' | 'invalid',
  nextQueuedChapterId: string | null,
  chapterColors: Map<string, RGB>,
  t: number,
): void {
  const emptyColor: RGB = { r: 50, g: 50, b: 45 };
  const isDimmed = dragValidity === 'invalid';

  // Valid target highlight (pulsing ring when dragging a compatible token)
  if (dragValidity === 'valid' && !isHovered) {
    const pulseAlpha = 0.12 + 0.08 * Math.sin(t * 3);
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${pulseAlpha})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hover glow (brighter when valid, suppressed when invalid)
  if (isHovered && dragValidity !== 'invalid') {
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Apply dimming for invalid targets during drag
  if (isDimmed) ctx.globalAlpha = 0.25;

  if (active) {
    const activeColor = chapterColors.get(active.chapterId) ?? emptyColor;
    const queuedColor = nextQueuedChapterId
      ? chapterColors.get(nextQueuedChapterId) ?? undefined
      : undefined;
    const seed = hashSeed(nodeDef.id);

    // Active membrane — fill and stroke can independently show queued vs active color
    const pulseAlpha = 0.7 + 0.3 * Math.sin(t * 2.5);
    drawMembrane(ctx, x, y, radius * 1.5, activeColor, pulseAlpha, 0.12, 0, t, seed, activeColor, queuedColor);

    // Filled core
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgb(activeColor, 0.7);
    ctx.fill();

    // Persistent indicator (double ring)
    if (active.persistent) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(activeColor, 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  } else if (nextQueuedChapterId) {
    // Silent node with queued token — stroke-only membrane in queued color
    const qColor = chapterColors.get(nextQueuedChapterId) ?? emptyColor;
    const seed = hashSeed(nodeDef.id);
    const pulseAlpha = 0.4 + 0.2 * Math.sin(t * 2);
    drawMembrane(ctx, x, y, radius * 1.5, emptyColor, pulseAlpha, 0.08, 0, t, seed, emptyColor, qColor);

    // Dim core
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgb(emptyColor, 0.25);
    ctx.fill();
  } else {
    // Empty node — nothing active or queued
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgb(emptyColor, 0.25);
    ctx.fill();
    ctx.strokeStyle = rgb(emptyColor, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Symbol
  ctx.fillStyle = active
    ? 'rgba(0,0,0,0.5)'
    : 'rgba(255,255,255,0.2)';
  ctx.font = `${radius * 0.7}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nodeDef.symbol, x, y);

  // Label below
  ctx.fillStyle = active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
  ctx.font = '9px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillText(nodeDef.label, x, y + radius + 6);
  ctx.textBaseline = 'middle';

  // Restore alpha before badge (badge should always be visible)
  if (isDimmed) ctx.globalAlpha = 1;

  // Queue depth badge
  if (queueDepth > 0) {
    const badgeX = x + radius * 0.9;
    const badgeY = y - radius * 0.9;
    const badgeR = 8;

    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${queueDepth}`, badgeX, badgeY);
  }
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Loop position interpolation (smooth 60fps from ~4 Hz server updates)
// ---------------------------------------------------------------------------

let loopInterp = {
  lastServerPos: 0,
  lastServerTime: 0,
  velocity: 0,
};

function getInterpolatedLoopPosition(serverPos: number): number {
  const now = performance.now();

  if (serverPos !== loopInterp.lastServerPos) {
    const dt = now - loopInterp.lastServerTime;
    if (loopInterp.lastServerTime > 0 && dt > 0 && dt < 2000) {
      let delta = serverPos - loopInterp.lastServerPos;
      if (delta < -0.5) delta += 1; // wrapped around
      loopInterp.velocity = delta / dt;
    }
    loopInterp.lastServerPos = serverPos;
    loopInterp.lastServerTime = now;
  }

  const elapsed = now - loopInterp.lastServerTime;
  if (loopInterp.velocity <= 0 || elapsed > 1000) {
    return serverPos;
  }

  const extrapolated = loopInterp.lastServerPos + loopInterp.velocity * elapsed;
  // Reset to 0 when wrapping past 1
  return extrapolated % 1;
}

/** Reset interpolation state (call when entering/leaving finale). */
export function resetLoopInterp(): void {
  loopInterp = { lastServerPos: 0, lastServerTime: 0, velocity: 0 };
}

// ---------------------------------------------------------------------------
// Global loop ring around pentagon orbit
// ---------------------------------------------------------------------------

function drawLoopRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  orbitRadius: number,
  nodeRadius: number,
  loopPosition: number,
): void {
  const ringRadius = orbitRadius + nodeRadius * 2.2;
  const startAngle = -Math.PI / 2; // 12 o'clock

  // Dim full-circle track
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Progress arc
  if (loopPosition > 0.001) {
    const endAngle = startAngle + loopPosition * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Leading dot
    const dotX = cx + Math.cos(endAngle) * ringRadius;
    const dotY = cy + Math.sin(endAngle) * ringRadius;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
  }
}

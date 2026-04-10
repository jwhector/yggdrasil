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
  hexToRgb,
  rgb,
  smoothNoise,
} from '@/components/projector/renderers/shared';
import type { RGB } from '@/components/projector/renderers/shared';
import type { DropZone } from '@/hooks/useDragToken';

interface ActiveNodeView {
  granularType: string;
  chapterId: string;
  trackIndex: number;
  persistent: boolean;
}

interface QueueDepthView {
  granularType: string;
  depth: number;
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

      // Draw nodes
      for (const nodeDef of PENTAGON_NODES) {
        const pos = layout.positions[nodeDef.id];
        const active = activeMap.get(nodeDef.id);
        const queueDepth = queueMap.get(nodeDef.id) ?? 0;
        const isHovered = hoverTarget === nodeDef.id;

        drawRemixNode(ctx, pos.x, pos.y, layout.nodeRadius, nodeDef, active, queueDepth, loopProgress, isHovered, chapterColorMap, t);
      }

      // Draw seed node (center)
      {
        const active = activeMap.get(SEED_ID);
        const queueDepth = queueMap.get(SEED_ID) ?? 0;
        const isHovered = hoverTarget === SEED_ID;
        drawRemixNode(ctx, layout.centerX, layout.centerY, layout.seedRadius, { id: SEED_ID, symbol: '\u25CE', label: 'SEED' }, active, queueDepth, loopProgress, isHovered, chapterColorMap, t);
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
  }, [width, height, activeMap, queueMap, loopProgress, hoverTarget, chapterColorMap, audienceInteraction, onDropZonesComputed]);

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
  loopProgress: number,
  isHovered: boolean,
  chapterColors: Map<string, RGB>,
  t: number,
): void {
  const emptyColor: RGB = { r: 50, g: 50, b: 45 };

  // Hover glow
  if (isHovered) {
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (active) {
    const color = chapterColors.get(active.chapterId) ?? emptyColor;

    // Active glow (membrane)
    const pulseAlpha = 0.5 + 0.2 * Math.sin(t * 2.5);
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = rgb(color, pulseAlpha * 0.15);
    ctx.fill();

    // Loop progress ring
    if (loopProgress > 0) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * loopProgress);
      ctx.strokeStyle = rgb(color, 0.5);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // Filled core
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgb(color, 0.7);
    ctx.fill();

    // Persistent indicator (double ring)
    if (active.persistent) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(color, 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  } else {
    // Empty node
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

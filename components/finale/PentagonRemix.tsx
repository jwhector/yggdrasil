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

interface NodeTallyData {
  granularType: string;
  votes: Array<{ chapterId: string; count: number }>;
  dominantChapter: string | null;
  locked: boolean;
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
  /** High-frequency tally data — overrides node color when audience interaction is active. */
  nodeTallies?: NodeTallyData[];
  /** Which nodes are currently enabled (accepting orbs). Disabled nodes fade out. */
  enabledNodes?: string[];
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
  nodeTallies,
  enabledNodes,
}: PentagonRemixProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());

  // Per-node opacity for smooth fade in/out based on enabledNodes
  const nodeOpacityRef = useRef<Map<string, number>>(new Map());
  // Per-node interpolated color for smooth chapter transitions
  const nodeColorRef = useRef<Map<string, RGB>>(new Map());
  const enabledSetRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    enabledSetRef.current = new Set(enabledNodes ?? []);
  }, [enabledNodes]);

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

  // Tally-driven dominant chapter per node — overrides activeMap when audience interaction is on
  const tallyDominantMap = useMemo(() => {
    if (!audienceInteraction || !nodeTallies) return null;
    const map = new Map<string, string>();
    for (const nt of nodeTallies) {
      if (nt.dominantChapter) {
        map.set(nt.granularType, nt.dominantChapter);
      }
    }
    return map;
  }, [audienceInteraction, nodeTallies]);

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

      // Lerp per-node opacity toward target (enabled=1, disabled=0)
      const OPACITY_LERP = 0.03;
      const enabledSet = enabledSetRef.current;
      const allNodes = [...PENTAGON_NODES.map(n => n.id), SEED_ID];
      for (const id of allNodes) {
        const current = nodeOpacityRef.current.get(id) ?? 1;
        // If enabledNodes is empty, no nodes have been enabled yet — hide all
        // If enabledNodes has entries, show only those in the set
        const target = enabledSet.size === 0 ? 0 : enabledSet.has(id) ? 1 : 0;
        const next = current + (target - current) * OPACITY_LERP;
        nodeOpacityRef.current.set(id, next);
      }

      // Draw radial lines (dim connectors) — fade with node opacity
      ctx.lineWidth = 1;
      for (const node of PENTAGON_NODES) {
        const opacity = nodeOpacityRef.current.get(node.id) ?? 1;
        if (opacity < 0.01) continue;
        const pos = layout.positions[node.id];
        ctx.strokeStyle = `rgba(255,255,255,${0.06 * opacity})`;
        ctx.beginPath();
        ctx.moveTo(layout.centerX, layout.centerY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }

      // Lerp per-node color toward target chapter color
      const COLOR_LERP = 0.04;
      const emptyColor: RGB = { r: 50, g: 50, b: 45 };
      const lerpNodeColor = (nodeId: string, targetColor: RGB) => {
        const current = nodeColorRef.current.get(nodeId) ?? { ...targetColor };
        current.r += (targetColor.r - current.r) * COLOR_LERP;
        current.g += (targetColor.g - current.g) * COLOR_LERP;
        current.b += (targetColor.b - current.b) * COLOR_LERP;
        nodeColorRef.current.set(nodeId, current);
        return current;
      };

      // Resolve effective active state for a node — tally dominant overrides activeMap
      const getEffectiveActive = (nodeId: string) => {
        const tallyChapter = tallyDominantMap?.get(nodeId);
        if (tallyChapter) {
          // Use tally dominant as the displayed chapter, preserving other active fields
          const existing = activeMap.get(nodeId);
          return {
            chapterId: tallyChapter,
            persistent: existing?.persistent ?? false,
            trackIndices: existing?.trackIndices ?? [],
            granularType: existing?.granularType ?? nodeId,
          };
        }
        return activeMap.get(nodeId);
      };

      // Draw nodes — fade with enabled state, interpolate color
      for (const nodeDef of PENTAGON_NODES) {
        const opacity = nodeOpacityRef.current.get(nodeDef.id) ?? 1;
        if (opacity < 0.01) continue;
        ctx.globalAlpha = opacity;
        const pos = layout.positions[nodeDef.id];
        const active = getEffectiveActive(nodeDef.id);
        const queueDepth = queueMap.get(nodeDef.id) ?? 0;
        const isHovered = hoverTarget === nodeDef.id;
        const dragValidity = validForDrag === null ? 'none' as const
          : validForDrag.has(nodeDef.id) ? 'valid' as const : 'invalid' as const;
        const nextChapter = nextChapterMap.get(nodeDef.id) ?? null;
        const targetColor = active ? (chapterColorMap.get(active.chapterId) ?? emptyColor) : emptyColor;
        const interpolatedColor = lerpNodeColor(nodeDef.id, targetColor);

        drawRemixNode(ctx, pos.x, pos.y, layout.nodeRadius, nodeDef, active, queueDepth, isHovered, dragValidity, nextChapter, chapterColorMap, t, interpolatedColor);
        ctx.globalAlpha = 1;
      }

      // Draw seed node (center) — fade with enabled state, interpolate color
      {
        const opacity = nodeOpacityRef.current.get(SEED_ID) ?? 1;
        if (opacity >= 0.01) {
          ctx.globalAlpha = opacity;
          const active = getEffectiveActive(SEED_ID);
          const queueDepth = queueMap.get(SEED_ID) ?? 0;
          const isHovered = hoverTarget === SEED_ID;
          const dragValidity = validForDrag === null ? 'none' as const
            : validForDrag.has(SEED_ID) ? 'valid' as const : 'invalid' as const;
          const nextChapter = nextChapterMap.get(SEED_ID) ?? null;
          const targetColor = active ? (chapterColorMap.get(active.chapterId) ?? emptyColor) : emptyColor;
          const interpolatedColor = lerpNodeColor(SEED_ID, targetColor);
          drawRemixNode(ctx, layout.centerX, layout.centerY, layout.seedRadius, { id: SEED_ID, symbol: '\u25CE', label: 'SEED' }, active, queueDepth, isHovered, dragValidity, nextChapter, chapterColorMap, t, interpolatedColor);
          ctx.globalAlpha = 1;
        }
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
  }, [width, height, activeMap, queueMap, nextChapterMap, loopProgress, hoverTarget, validForDrag, chapterColorMap, audienceInteraction, onDropZonesComputed, tallyDominantMap]);

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
  colorOverride?: RGB,
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
    const activeColor = colorOverride ?? chapterColors.get(active.chapterId) ?? emptyColor;

    // Soft radial halo around active node
    const haloR = radius * 2;
    const pulseAlpha = 0.7 + 0.3 * Math.sin(t * 2.5);
    const halo = ctx.createRadialGradient(x, y, radius * 0.8, x, y, haloR);
    halo.addColorStop(0, rgb(activeColor, pulseAlpha * 0.15));
    halo.addColorStop(0.6, rgb(activeColor, pulseAlpha * 0.05));
    halo.addColorStop(1, rgb(activeColor, 0));
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

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
    // Silent node with queued token — dim halo in queued color
    const qColor = chapterColors.get(nextQueuedChapterId) ?? emptyColor;
    const haloR = radius * 1.8;
    const pulseAlpha = 0.4 + 0.2 * Math.sin(t * 2);
    const halo = ctx.createRadialGradient(x, y, radius * 0.8, x, y, haloR);
    halo.addColorStop(0, rgb(qColor, pulseAlpha * 0.08));
    halo.addColorStop(1, rgb(qColor, 0));
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

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

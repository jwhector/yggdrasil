'use client';

/**
 * MiniSkeleton
 *
 * Small canvas-drawn pentagon motif for the audience phone during song-building.
 * Shows 5 granular-type nodes + center seed node with active/filled/empty states.
 * Reuses geometry and drawing primitives from the projector renderer.
 */

import { useRef, useEffect } from 'react';
import type { Chapter, LayerResult, LayerPhase, V32LayerConfig, LayerGroupConfig } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';
import {
  PENTAGON_NODES,
  LAYER_GROUP_NODES,
  EMPTY_COLOR,
  COLLAPSED_COLOR,
  smoothNoise,
  rgb,
  hexToRgb,
  drawMembrane,
} from '@/components/projector/renderers/shared';
import type { RGB } from '@/components/projector/renderers/shared';

interface MiniSkeletonProps {
  chapter: Chapter;
  currentLayerIndex: number;
  layerResults: LayerResult[];
  layerPlan: V32LayerConfig[];
  layerPhase: LayerPhase;
  currentAuditionOption: 'A' | 'B' | null;
  layerGroups: LayerGroupConfig[];
  width?: number;
  height?: number;
}

interface NodeState {
  state: 'empty' | 'active' | 'filled' | 'collapsed';
  color: RGB;
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return h;
}

function deriveNodeStates(
  chapter: Chapter,
  layerPlan: V32LayerConfig[],
  layerResults: LayerResult[],
  currentLayerIndex: number,
  layerPhase: LayerPhase,
  currentAuditionOption: 'A' | 'B' | null,
  layerGroups: LayerGroupConfig[],
): Record<string, NodeState> {
  const chapterIdentity = getChapterIdentity(chapter);
  const primaryColor = hexToRgb(chapterIdentity.color);
  const colorA = hexToRgb(chapterIdentity.colorA);
  const colorB = hexToRgb(chapterIdentity.colorB);

  // Map group → layer index
  const groupLayerIndex: Record<string, number> = {};
  for (const layer of layerPlan) {
    groupLayerIndex[layer.group] = layer.index;
  }

  // Map type → group
  const typeToGroup: Record<string, string> = {};
  if (layerGroups.length > 0) {
    for (const group of layerGroups) {
      for (const typeId of group.granularTypes) {
        typeToGroup[typeId] = group.id;
      }
    }
  } else {
    for (const [groupId, types] of Object.entries(LAYER_GROUP_NODES)) {
      for (const typeId of types) {
        typeToGroup[typeId] = groupId;
      }
    }
  }

  const nodes: Record<string, NodeState> = {};

  for (const nodeDef of PENTAGON_NODES) {
    const groupId = typeToGroup[nodeDef.id];
    const groupLayerIdx = groupLayerIndex[groupId];

    if (groupLayerIdx === undefined) {
      nodes[nodeDef.id] = { state: 'empty', color: EMPTY_COLOR };
      continue;
    }

    const layerResult = layerResults.find(r => r.layerIndex === groupLayerIdx);

    if (groupLayerIdx > currentLayerIndex) {
      nodes[nodeDef.id] = { state: 'empty', color: EMPTY_COLOR };
    } else if (groupLayerIdx === currentLayerIndex) {
      if (layerPhase === 'auditioning' || layerPhase === 'revealing') {
        const audColor = currentAuditionOption === 'A' ? colorA : currentAuditionOption === 'B' ? colorB : primaryColor;
        nodes[nodeDef.id] = { state: 'active', color: audColor };
      } else if (layerPhase === 'locked_in') {
        const optColor = layerResult?.chosenOption === 'A' ? colorA : layerResult?.chosenOption === 'B' ? colorB : primaryColor;
        nodes[nodeDef.id] = { state: 'filled', color: optColor };
      } else if (layerPhase === 'collapsed') {
        nodes[nodeDef.id] = { state: 'collapsed', color: COLLAPSED_COLOR };
      } else {
        nodes[nodeDef.id] = { state: 'empty', color: EMPTY_COLOR };
      }
    } else {
      if (layerResult?.status === 'locked_in') {
        const optColor = layerResult.chosenOption === 'A' ? colorA : layerResult.chosenOption === 'B' ? colorB : primaryColor;
        nodes[nodeDef.id] = { state: 'filled', color: optColor };
      } else if (layerResult?.status === 'collapsed') {
        nodes[nodeDef.id] = { state: 'collapsed', color: COLLAPSED_COLOR };
      } else {
        nodes[nodeDef.id] = { state: 'empty', color: EMPTY_COLOR };
      }
    }
  }

  return nodes;
}

export function MiniSkeleton({
  chapter,
  currentLayerIndex,
  layerResults,
  layerPlan,
  layerPhase,
  currentAuditionOption,
  layerGroups,
  width = 260,
  height = 200,
}: MiniSkeletonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cw = width * dpr;
  const ch = height * dpr;

  const chapterIdentity = getChapterIdentity(chapter);
  const seedColor = hexToRgb(chapterIdentity.color);

  const nodeStates = deriveNodeStates(
    chapter, layerPlan, layerResults, currentLayerIndex,
    layerPhase, currentAuditionOption, layerGroups,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = cw / 2;
    const cy = ch * 0.48;
    const orbitR = Math.min(cw, ch) * 0.30;
    const nodeR = orbitR * 0.22;
    const seedR = nodeR * 1.2;

    function draw(time: number) {
      const t = time * 0.001;
      ctx!.clearRect(0, 0, cw, ch);

      // Radial lines
      for (const nodeDef of PENTAGON_NODES) {
        const nx = cx + Math.cos(nodeDef.angle) * orbitR;
        const ny = cy + Math.sin(nodeDef.angle) * orbitR;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(nx, ny);
        const nodeState = nodeStates[nodeDef.id];
        const isActive = nodeState?.state === 'active' || nodeState?.state === 'filled';
        ctx!.strokeStyle = `rgba(255,255,255,${isActive ? 0.1 : 0.04})`;
        ctx!.lineWidth = dpr * 0.5;
        ctx!.stroke();
      }

      // Seed node
      drawMembrane(ctx!, cx, cy, seedR * 1.3, seedColor, 0.5, 0.05, 0, t, 999);
      ctx!.beginPath();
      ctx!.arc(cx, cy, seedR, 0, Math.PI * 2);
      ctx!.strokeStyle = rgb(seedColor, 0.5);
      ctx!.lineWidth = dpr;
      ctx!.stroke();
      ctx!.fillStyle = rgb(seedColor, 0.7);
      ctx!.font = `${Math.round(seedR * 0.9)}px system-ui, sans-serif`;
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      ctx!.fillText('\u2726', cx, cy);

      // Pentagon nodes
      for (const nodeDef of PENTAGON_NODES) {
        const nx = cx + Math.cos(nodeDef.angle) * orbitR;
        const ny = cy + Math.sin(nodeDef.angle) * orbitR;
        const nodeState = nodeStates[nodeDef.id];
        if (!nodeState) continue;

        const { state: nState, color } = nodeState;

        // Membrane for active/filled
        if (nState === 'active') {
          const pulseAlpha = 0.6 + 0.3 * Math.sin(t * 2.5);
          drawMembrane(ctx!, nx, ny, nodeR * 1.5, color, pulseAlpha, 0.1, 0, t, hashSeed(nodeDef.id));
        } else if (nState === 'filled') {
          drawMembrane(ctx!, nx, ny, nodeR * 1.5, color, 0.7, 0.04, 0, t, hashSeed(nodeDef.id));
        }

        // Circle
        ctx!.beginPath();
        ctx!.arc(nx, ny, nodeR, 0, Math.PI * 2);
        if (nState === 'empty') {
          ctx!.fillStyle = 'rgba(20,20,18,0.6)';
          ctx!.fill();
          ctx!.strokeStyle = rgb(EMPTY_COLOR, 0.4);
          ctx!.lineWidth = dpr * 0.5;
        } else if (nState === 'active') {
          const pulseAlpha = 0.6 + 0.3 * Math.sin(t * 2.5);
          ctx!.fillStyle = rgb(color, 0.06);
          ctx!.fill();
          ctx!.strokeStyle = rgb(color, pulseAlpha * 0.7);
          ctx!.lineWidth = dpr;
        } else if (nState === 'filled') {
          ctx!.fillStyle = rgb(color, 0.08);
          ctx!.fill();
          ctx!.strokeStyle = rgb(color, 0.7);
          ctx!.lineWidth = dpr;
        } else if (nState === 'collapsed') {
          ctx!.fillStyle = 'rgba(20,20,18,0.6)';
          ctx!.fill();
          ctx!.strokeStyle = rgb(COLLAPSED_COLOR, 0.4);
          ctx!.lineWidth = dpr * 0.5;
          ctx!.setLineDash([4 * dpr, 3 * dpr]);
        }
        ctx!.stroke();
        ctx!.setLineDash([]);

        // Symbol
        const symbolAlpha = nState === 'empty' ? 0.35 : nState === 'collapsed' ? 0.3 : 0.8;
        const symbolColor = nState === 'empty' ? EMPTY_COLOR : nState === 'collapsed' ? COLLAPSED_COLOR : color;
        ctx!.fillStyle = rgb(symbolColor, symbolAlpha);
        ctx!.font = `${Math.round(nodeR * 0.8)}px system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(nodeDef.symbol, nx, ny);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  });

  return (
    <canvas
      ref={canvasRef}
      width={cw}
      height={ch}
      style={{
        width,
        height,
        display: 'block',
        margin: '0 auto',
      }}
    />
  );
}

/**
 * AudienceRemix (V3.4 — Swarm Orbs)
 *
 * Phone UI for audience during finale_remix.
 * Renders the SVG pentagon with 5 granular nodes + seed center + tally wedges.
 * Orb rendering and drag state are managed by the parent (FloatingOrbLayer).
 * This component exposes node positions for the parent's drag hit-testing.
 *
 * Reuses PENTAGON_NODES geometry from the projector renderer.
 */

'use client';

import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { ChapterConfig, GranularType } from '@/conductor/types';
import type { NodeTally } from '@/hooks/useAudienceRemix';
import { getLayerIdentity } from '@/lib/identity';
import { PENTAGON_NODES } from '@/components/projector/renderers/shared';

// ============================================================================
// Types
// ============================================================================

export interface AudienceRemixProps {
  tallies: NodeTally[];
  chapters: ChapterConfig[];
  granularTypes: GranularType[];
  fallbackMode: boolean;
  hoverNode: string | null;  // Which node is being hovered during drag
}

/** Exposed to parent for drag hit-testing. */
export interface AudienceRemixHandle {
  /** Hit-test a viewport coordinate against pentagon nodes. Returns granularType or null. */
  findNode: (viewportX: number, viewportY: number) => string | null;
  /** Get the viewport position of a node (for positioning placed orbs). */
  getNodeViewportPosition: (nodeId: string) => { x: number; y: number } | null;
}

interface NodePosition {
  id: string;
  x: number;      // container-relative
  y: number;
  label: string;
  symbol: string;
  color: string;
}

// ============================================================================
// Layout — responsive, derived from container size
// ============================================================================

const RATIO = {
  node: 0.2,
  seed: 0.16,
  snap: 0.35,
  centerY: 0.42,
};

interface Layout {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  orbitRadius: number;
  nodeRadius: number;
  seedRadius: number;
  snapRadius: number;
}

/** Tally wedge max radial extension as fraction of orbit. Must match tallyMaxExtend in render. */
const TALLY_EXTEND_RATIO = 0.12;
/** Gap between node circle edge and tally wedge inner edge (px). */
const TALLY_GAP_PX = 18;

function computeLayout(w: number, h: number): Layout {
  // The widest pentagon nodes (harmony, pad) sit at sin(72deg) ~ 0.951 of orbit from center.
  // Total horizontal extent from center =
  //   orbit * sin72 + nodeRadius + TALLY_GAP_PX + tallyWedgeExtend
  // Since tallyWedgeExtend = orbit * TALLY_EXTEND_RATIO and nodeRadius = orbit * RATIO.node:
  //   halfW = orbit * (sin72 + RATIO.node + TALLY_EXTEND_RATIO) + TALLY_GAP_PX
  //   orbit = (halfW - TALLY_GAP_PX) / (sin72 + RATIO.node + TALLY_EXTEND_RATIO)
  const halfW = w / 2;
  const sin72 = 0.951;
  const orbitRadius = (halfW - TALLY_GAP_PX) / (sin72 + RATIO.node + TALLY_EXTEND_RATIO);

  return {
    width: w,
    height: h,
    centerX: w / 2,
    centerY: h * RATIO.centerY,
    orbitRadius,
    nodeRadius: orbitRadius * RATIO.node,
    seedRadius: orbitRadius * RATIO.seed,
    snapRadius: orbitRadius * RATIO.snap,
  };
}

function computeNodePositions(layout: Layout): NodePosition[] {
  return PENTAGON_NODES.map(node => {
    const identity = getLayerIdentity(node.id);
    return {
      id: node.id,
      x: layout.centerX + Math.cos(node.angle) * layout.orbitRadius,
      y: layout.centerY + Math.sin(node.angle) * layout.orbitRadius,
      label: node.label,
      symbol: identity.symbol,
      color: identity.color,
    };
  });
}

/** Compute container height from layout so nothing overflows. */
function computeHeight(w: number): number {
  const halfW = w / 2;
  const sin72 = 0.951;
  const orbit = (halfW - TALLY_GAP_PX) / (sin72 + RATIO.node + TALLY_EXTEND_RATIO);
  const nodeR = orbit * RATIO.node;
  const wedgeExtend = orbit * TALLY_EXTEND_RATIO;
  const labelGap = Math.max(10, nodeR * 0.5);
  // Use the actual orbit + computed centerY position
  // centerY = h * RATIO.centerY, but h depends on centerY — solve:
  // We need h such that centerY + orbit + nodeR + wedgeExtend + labelGap fits with padding.
  // Pentagon top = centerY - orbit - nodeR - wedgeExtend
  // Pentagon bottom = centerY + orbit + nodeR + wedgeExtend + labelGap
  // We want the pentagon vertically centered, so:
  const pentagonExtent = orbit + nodeR + TALLY_GAP_PX + wedgeExtend + labelGap + 10;
  return pentagonExtent * 2 + 20; // symmetric top/bottom + padding
}

// ============================================================================
// Component
// ============================================================================

export const AudienceRemix = forwardRef<AudienceRemixHandle, AudienceRemixProps>(
  function AudienceRemix({ tallies, chapters, fallbackMode, hoverNode }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    // Measure container width, derive height from layout
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) {
            setSize({ width: w, height: computeHeight(w) });
          }
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    const layout = computeLayout(size.width || 320, size.height || 300);
    const nodePositions = computeNodePositions(layout);
    const allNodePositions = [
      ...nodePositions,
      { id: 'seed', x: layout.centerX, y: layout.centerY, label: 'SEED', symbol: '\u2726', color: '#e5e5e5' },
    ];

    // Expose node hit-testing to parent
    useImperativeHandle(ref, () => ({
      findNode(viewportX: number, viewportY: number): string | null {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const localX = viewportX - rect.left;
        const localY = viewportY - rect.top;
        for (const node of allNodePositions) {
          const dx = localX - node.x;
          const dy = localY - node.y;
          if (Math.sqrt(dx * dx + dy * dy) < layout.snapRadius) {
            return node.id;
          }
        }
        return null;
      },
      getNodeViewportPosition(nodeId: string): { x: number; y: number } | null {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const node = allNodePositions.find(n => n.id === nodeId);
        if (!node) return null;
        return { x: rect.left + node.x, y: rect.top + node.y };
      },
    }), [allNodePositions, layout.snapRadius]);

    if (fallbackMode) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            LISTEN
          </p>
        </div>
      );
    }

    const tallyMaxExtend = layout.orbitRadius * TALLY_EXTEND_RATIO;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: '100vh',
          boxSizing: 'border-box',
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            height: size.height || 'auto',
          }}
        >
          {size.width > 0 && (
            <svg
              width={layout.width}
              height={layout.height}
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              {/* Radial connectors */}
              {nodePositions.map(node => (
                <line
                  key={`line-${node.id}`}
                  x1={layout.centerX}
                  y1={layout.centerY}
                  x2={node.x}
                  y2={node.y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
              ))}

              {/* Node circles */}
              {allNodePositions.map(node => {
                const isHover = hoverNode === node.id;
                const tally = tallies.find(t => t.granularType === node.id);
                const hasTally = tally && tally.votes.length > 0;
                const r = node.id === 'seed' ? layout.seedRadius : layout.nodeRadius;

                return (
                  <g key={node.id}>
                    {hasTally && (
                      <TallyArcs
                        tally={tally!}
                        cx={node.x}
                        cy={node.y}
                        radius={r + 4}
                        maxExtend={tallyMaxExtend}
                        chapters={chapters}
                      />
                    )}

                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={r}
                      fill={isHover ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'}
                      stroke={isHover ? 'rgba(255,255,255,0.4)' : tally?.locked ? `${node.color}88` : 'rgba(255,255,255,0.1)'}
                      strokeWidth={isHover ? 2 : 1}
                      strokeDasharray={tally?.locked ? '3 2' : undefined}
                    />

                    <text
                      x={node.x}
                      y={node.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="rgba(255,255,255,0.35)"
                      fontSize={Math.round(r * 0.7)}
                    >
                      {node.symbol}
                    </text>

                    {node.id !== 'seed' && (
                      <text
                        x={node.x}
                        y={node.y + r + Math.max(10, r * 0.5)}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.2)"
                        fontSize={Math.max(7, Math.round(r * 0.35))}
                        fontWeight={500}
                        letterSpacing="0.08em"
                      >
                        {node.label}
                      </text>
                    )}

                    {tally?.locked && (
                      <text
                        x={node.x + r - 4}
                        y={node.y - r + 8}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.5)"
                        fontSize={Math.max(8, Math.round(r * 0.4))}
                      >
                        🔒
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <p style={{
          color: 'rgba(255,255,255,0.15)',
          fontSize: '0.7rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginTop: '16px',
          textAlign: 'center',
        }}>
          YOUR ORBS SHAPE THE MUSIC
        </p>
      </div>
    );
  }
);

// ============================================================================
// Tally Wedges — polar plot visualization of votes per node
//
// Each chapter gets a fixed 120-degree wedge (always in the same angular position).
// The wedge extends radially outward from the node circle proportional to vote count.
// This creates a radar/spider chart effect: "bigger = more votes."
// ============================================================================

function TallyArcs({
  tally,
  cx,
  cy,
  radius,
  maxExtend,
  chapters,
}: {
  tally: NodeTally;
  cx: number;
  cy: number;
  radius: number;
  maxExtend: number;
  chapters: ChapterConfig[];
}) {
  const maxCount = Math.max(...tally.votes.map(v => v.count), 1);
  const hasVotes = tally.votes.some(v => v.count > 0);
  if (!hasVotes) return null;

  const WEDGE_SWEEP = (2 * Math.PI) / 3;
  const GAP = 0.06;

  return (
    <g>
      {chapters.map((chapter, i) => {
        const vote = tally.votes.find(v => v.chapterId === chapter.id);
        const count = vote?.count ?? 0;
        if (count === 0) return null;

        const fraction = count / maxCount;
        const outerRadius = radius + maxExtend * fraction;

        const wedgeStart = -Math.PI / 2 + i * WEDGE_SWEEP + GAP / 2;
        const wedgeEnd = wedgeStart + WEDGE_SWEEP - GAP;

        const innerStart = { x: cx + Math.cos(wedgeStart) * radius, y: cy + Math.sin(wedgeStart) * radius };
        const innerEnd = { x: cx + Math.cos(wedgeEnd) * radius, y: cy + Math.sin(wedgeEnd) * radius };
        const outerStart = { x: cx + Math.cos(wedgeStart) * outerRadius, y: cy + Math.sin(wedgeStart) * outerRadius };
        const outerEnd = { x: cx + Math.cos(wedgeEnd) * outerRadius, y: cy + Math.sin(wedgeEnd) * outerRadius };

        const d = [
          `M ${innerStart.x} ${innerStart.y}`,
          `A ${radius} ${radius} 0 0 1 ${innerEnd.x} ${innerEnd.y}`,
          `L ${outerEnd.x} ${outerEnd.y}`,
          `A ${outerRadius} ${outerRadius} 0 0 0 ${outerStart.x} ${outerStart.y}`,
          'Z',
        ].join(' ');

        const isDominant = tally.dominantChapter === chapter.id;

        return (
          <path
            key={chapter.id}
            d={d}
            fill={chapter.color}
            fillOpacity={isDominant ? 0.35 : 0.15}
            stroke={chapter.color}
            strokeWidth={isDominant ? 1.5 : 0.5}
            strokeOpacity={isDominant ? 0.8 : 0.4}
          />
        );
      })}
    </g>
  );
}

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
  enabledNodes: string[];    // Which nodes are currently accepting orbs
  onResetOrbs?: () => void;  // Return all orbs to floating positions
  // Collective scatter vote
  scatterVoteCount: number;
  scatterVoteThreshold: number;
  hasVotedScatter: boolean;
  onScatterVote?: () => void;
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
  seed: 0.28,   // Larger than outer nodes (0.2) — matches projector skeleton proportions
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
  function AudienceRemix({ tallies, chapters, fallbackMode, hoverNode, enabledNodes, onResetOrbs, scatterVoteCount, scatterVoteThreshold, hasVotedScatter, onScatterVote }, ref) {
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
      { id: 'seed', x: layout.centerX, y: layout.centerY, label: 'HEART', symbol: '\u2726', color: '#e5e5e5' },
    ];

    const enabledSet = new Set(enabledNodes);

    // Expose node hit-testing to parent
    useImperativeHandle(ref, () => ({
      findNode(viewportX: number, viewportY: number): string | null {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const localX = viewportX - rect.left;
        const localY = viewportY - rect.top;
        for (const node of allNodePositions) {
          if (!enabledSet.has(node.id)) continue; // Skip disabled nodes
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
    }), [allNodePositions, layout.snapRadius, enabledSet]);

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
          // Orb row sits at ~12vh + glow extent. Pad top to clear it,
          // pad bottom less so the pentagon centers in the remaining space.
          paddingTop: 'calc(12vh + 50px)',
          paddingBottom: 20,
          boxSizing: 'border-box',
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 420,
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
              {nodePositions.map(node => {
                const isEnabled = enabledSet.has(node.id);
                return (
                  <line
                    key={`line-${node.id}`}
                    x1={layout.centerX}
                    y1={layout.centerY}
                    x2={node.x}
                    y2={node.y}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth={1}
                    style={{
                      opacity: isEnabled ? 1 : 0,
                      transition: 'opacity 0.6s ease-out',
                    }}
                  />
                );
              })}

              {/* Node circles */}
              {allNodePositions.map(node => {
                const isEnabled = enabledSet.has(node.id);
                const isHover = isEnabled && hoverNode === node.id;
                const tally = tallies.find(t => t.granularType === node.id);
                const hasTally = tally && tally.votes.length > 0;
                const r = node.id === 'seed' ? layout.seedRadius : layout.nodeRadius;

                // Resolve dominant chapter color for node fill
                const dominantId = tally?.dominantChapter ?? null;
                const dominantChapter = dominantId ? chapters.find(c => c.id === dominantId) : null;
                const activeColor = dominantChapter?.color ?? null;

                return (
                  <g
                    key={node.id}
                    style={{
                      opacity: isEnabled ? 1 : 0,
                      transition: 'opacity 0.6s ease-out',
                    }}
                  >
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
                      fill={isHover ? 'rgba(255,255,255,0.06)' : 'none'}
                      stroke={
                        isHover ? 'rgba(255,255,255,0.4)'
                        : activeColor ? `${activeColor}88`
                        : tally?.locked ? `${node.color}88`
                        : 'rgba(255,255,255,0.1)'
                      }
                      strokeWidth={isHover ? 2 : activeColor ? 1.5 : 1}
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

                    <text
                      x={node.x}
                      y={node.y + r + TALLY_GAP_PX + tallyMaxExtend + Math.max(6, r * 0.3)}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.2)"
                      fontSize={Math.max(7, Math.round(layout.nodeRadius * 0.35))}
                      fontWeight={500}
                      letterSpacing="0.08em"
                    >
                      {node.label}
                    </text>

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

        <div style={{
          marginTop: '16px',
          textAlign: 'center',
          maxWidth: 280,
        }}>
          <p style={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: '1rem',
            lineHeight: 1.6,
            margin: '0 0 6px 0',
          }}>
            Drag as many of your intentions into the sigil as you&apos;d like.
          </p>
          <p style={{
            color: 'rgba(255,255,255,0.75)',
            fontSize: '0.7rem',
            letterSpacing: '0.08em',
            margin: 0,
          }}>
            Each node shapes a different part of the music. See what you can manifest.
          </p>
        </div>

        {onResetOrbs && (() => {
          const c0 = chapters[0]?.color ?? '#e63946';
          const c1 = chapters[1]?.color ?? '#f4a261';
          const c2 = chapters[2]?.color ?? '#457b9d';
          const animName = 'recallGlow';
          return (
            <>
              <style>{`
                @keyframes ${animName} {
                  0%, 100% {
                    color: ${c0};
                    box-shadow: 0 0 12px ${c0}44, 0 0 4px ${c0}22;
                    border-color: ${c0}44;
                  }
                  33% {
                    color: ${c1};
                    box-shadow: 0 0 12px ${c1}44, 0 0 4px ${c1}22;
                    border-color: ${c1}44;
                  }
                  66% {
                    color: ${c2};
                    box-shadow: 0 0 12px ${c2}44, 0 0 4px ${c2}22;
                    border-color: ${c2}44;
                  }
                }
              `}</style>
              <button
                onClick={onResetOrbs}
                style={{
                  position: 'fixed',
                  top: 16,
                  right: 16,
                  zIndex: 70,
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation',
                  outline: 'none',
                  animation: `${animName} 6s ease-in-out infinite`,
                }}
              >
                Recall intentions
              </button>
            </>
          );
        })()}

        {onScatterVote && (
          <ScatterVoteButton
            count={scatterVoteCount}
            threshold={scatterVoteThreshold}
            hasVoted={hasVotedScatter}
            onVote={onScatterVote}
            chapters={chapters}
          />
        )}
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

/** Parse hex to r,g,b. */
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

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
  const GAP = .03;

  return (
    <g>
      {/* One radial gradient per chapter — fades from inner edge outward */}
      <defs>
        <filter id="tallyGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" />
        </filter>
        {chapters.map((chapter, i) => {
          const { r, g, b } = hexRgb(chapter.color);
          const isDominant = tally.dominantChapter === chapter.id;
          const innerAlpha = isDominant ? 0.45 : 0.2;
          const outerAlpha = isDominant ? 0.05 : 0.02;
          const gradId = `tally-${cx.toFixed(0)}-${cy.toFixed(0)}-${i}`;

          return (
            <radialGradient
              key={gradId}
              id={gradId}
              cx={cx}
              cy={cy}
              r={radius + maxExtend}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset={`${(radius / (radius + maxExtend)) * 100}%`} stopColor={`rgba(${r},${g},${b},${innerAlpha})`} />
              <stop offset="100%" stopColor={`rgba(${r},${g},${b},${outerAlpha})`} />
            </radialGradient>
          );
        })}
      </defs>

      {chapters.map((chapter, i) => {
        const vote = tally.votes.find(v => v.chapterId === chapter.id);
        const count = vote?.count ?? 0;
        if (count === 0) return null;

        const fraction = count / maxCount;
        const outerRadius = radius + maxExtend * fraction;
        const isDominant = tally.dominantChapter === chapter.id;
        const gradId = `tally-${cx.toFixed(0)}-${cy.toFixed(0)}-${i}`;

        const wedgeStart = -Math.PI / 2 + i * WEDGE_SWEEP + GAP / 2;
        const wedgeEnd = wedgeStart + WEDGE_SWEEP - GAP;

        const innerStart = { x: cx + Math.cos(wedgeStart) * radius, y: cy + Math.sin(wedgeStart) * radius };
        const innerEnd = { x: cx + Math.cos(wedgeEnd) * radius, y: cy + Math.sin(wedgeEnd) * radius };
        const outerStart = { x: cx + Math.cos(wedgeStart) * outerRadius, y: cy + Math.sin(wedgeStart) * outerRadius };
        const outerEnd = { x: cx + Math.cos(wedgeEnd) * outerRadius, y: cy + Math.sin(wedgeEnd) * outerRadius };

        // Wedge fill shape
        const fillPath = [
          `M ${innerStart.x} ${innerStart.y}`,
          `A ${radius} ${radius} 0 0 1 ${innerEnd.x} ${innerEnd.y}`,
          `L ${outerEnd.x} ${outerEnd.y}`,
          `A ${outerRadius} ${outerRadius} 0 0 0 ${outerStart.x} ${outerStart.y}`,
          'Z',
        ].join(' ');

        // Side edges only (the two radial lines)
        const edgePath = [
          `M ${innerStart.x} ${innerStart.y} L ${outerStart.x} ${outerStart.y}`,
          `M ${innerEnd.x} ${innerEnd.y} L ${outerEnd.x} ${outerEnd.y}`,
        ].join(' ');

        // Outer arc only (the curved edge at the outerRadius)
        const outerArcPath = `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`;

        return (
          <g key={chapter.id}>
            {/* Soft glowing fill — gradient fades outward */}
            <path
              d={fillPath}
              fill={`url(#${gradId})`}
              stroke="none"
              style={{ transition: 'fill-opacity 0.5s ease-out' }}
              fillOpacity={isDominant ? 1 : 0.7}
            />
            {/* Glowing outer arc — blurred for soft neon effect */}
            <path
              d={outerArcPath}
              fill="none"
              stroke={chapter.color}
              strokeWidth={isDominant ? 3 : 2}
              strokeLinecap="round"
              filter="url(#tallyGlow)"
              style={{ transition: 'stroke-opacity 0.5s ease-out, stroke-width 0.4s ease-out' }}
              strokeOpacity={isDominant ? 0.5 : 0.25}
            />
            {/* Sharp outer arc on top for definition */}
            <path
              d={outerArcPath}
              fill="none"
              stroke={chapter.color}
              strokeWidth={isDominant ? 1.2 : 0.7}
              strokeLinecap="round"
              style={{ transition: 'stroke-opacity 0.5s ease-out, stroke-width 0.4s ease-out' }}
              strokeOpacity={isDominant ? 0.8 : 0.4}
            />
            {/* Crisp side edges for legibility */}
            <path
              d={edgePath}
              fill="none"
              stroke={chapter.color}
              strokeWidth={isDominant ? 1.2 : 0.6}
              strokeLinecap="round"
              style={{ transition: 'stroke-opacity 0.5s ease-out, stroke-width 0.4s ease-out' }}
              strokeOpacity={isDominant ? 0.7 : 0.3}
            />
          </g>
        );
      })}
    </g>
  );
}

// ============================================================================
// Scatter Vote Button — collective vote to scatter all orbs
//
// Shows a fill bar that grows as more audience members vote.
// Disabled after voting until the cycle resets (scatter fires or count resets).
// ============================================================================

function ScatterVoteButton({
  count,
  threshold,
  hasVoted,
  onVote,
  chapters,
}: {
  count: number;
  threshold: number;
  hasVoted: boolean;
  onVote: () => void;
  chapters: ChapterConfig[];
}) {
  const fill = threshold > 0 ? Math.min(count / threshold, 1) : 0;
  const c0 = chapters[0]?.color ?? '#e63946';
  const c1 = chapters[1]?.color ?? '#f4a261';
  const c2 = chapters[2]?.color ?? '#457b9d';

  return (
    <button
      onClick={hasVoted ? undefined : onVote}
      disabled={hasVoted}
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 70,
        overflow: 'hidden',
        padding: '8px 18px',
        borderRadius: '8px',
        border: `1px solid ${hasVoted ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)'}`,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        fontSize: '0.72rem',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase' as const,
        color: hasVoted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
        cursor: hasVoted ? 'default' : 'pointer',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation' as const,
        outline: 'none',
        transition: 'color 0.3s ease, border-color 0.3s ease',
      }}
    >
      {/* Fill bar — gradient using chapter colors */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: `${fill * 100}%`,
          background: `linear-gradient(90deg, ${c0}44, ${c1}44, ${c2}44)`,
          transition: 'width 0.4s ease-out',
          pointerEvents: 'none',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1 }}>
        {hasVoted
          ? `Voted ${count}/${threshold}`
          : count > 0
            ? `Scatter ${count}/${threshold}`
            : 'Scatter all'
        }
      </span>
    </button>
  );
}

/**
 * AudienceRemix (V3.4 — Swarm Orbs)
 *
 * Phone UI for audience during finale_remix.
 * Shows a mini pentagon with 5 granular nodes + seed center.
 * The audience's personal orbs float freely or nestle inside nodes.
 * Drag an orb onto a node to vote; drag off to recall.
 *
 * Reuses PENTAGON_NODES geometry from the projector renderer.
 * Uses touch events (not HTML5 drag) for mobile Safari compatibility.
 */

'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudienceOrb, ChapterConfig, GranularType } from '@/conductor/types';
import { useAudienceRemix, type NodeTally } from '@/hooks/useAudienceRemix';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { PENTAGON_NODES } from '@/components/projector/renderers/shared';

// ============================================================================
// Types
// ============================================================================

interface AudienceRemixProps {
  socket: Socket | null;
  orbs: AudienceOrb[];
  nodeTallies: NodeTally[];
  chapters: ChapterConfig[];
  granularTypes: GranularType[];
  fallbackMode: boolean;
}

interface NodePosition {
  id: string;
  x: number;
  y: number;
  label: string;
  symbol: string;
  color: string;
}

// ============================================================================
// Layout
// ============================================================================

const LAYOUT = {
  width: 320,
  height: 360,
  centerX: 160,
  centerY: 155,
  orbitRadius: 95,
  nodeRadius: 28,
  seedRadius: 22,
  orbRadius: 16,
  placedOrbRadius: 10,
  snapRadius: 45,
};

function computeNodePositions(): NodePosition[] {
  return PENTAGON_NODES.map(node => {
    const identity = getLayerIdentity(node.id);
    return {
      id: node.id,
      x: LAYOUT.centerX + Math.cos(node.angle) * LAYOUT.orbitRadius,
      y: LAYOUT.centerY + Math.sin(node.angle) * LAYOUT.orbitRadius,
      label: node.label,
      symbol: identity.symbol,
      color: identity.color,
    };
  });
}

// Seed node position
const SEED_POS = { x: LAYOUT.centerX, y: LAYOUT.centerY };

// Floating orb home positions — arranged in a row below the pentagon
function getFloatingPositions(count: number): Array<{ x: number; y: number }> {
  const y = LAYOUT.height - 45;
  const spacing = Math.min(48, (LAYOUT.width - 40) / Math.max(count, 1));
  const startX = LAYOUT.centerX - ((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * spacing,
    y,
  }));
}

// ============================================================================
// Main Component
// ============================================================================

export function AudienceRemix({
  socket,
  orbs: initialOrbs,
  nodeTallies: initialTallies,
  chapters,
  granularTypes,
  fallbackMode,
}: AudienceRemixProps) {
  const { orbs, tallies, placeOrb, recallOrb } = useAudienceRemix(
    socket,
    initialOrbs,
    initialTallies,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    orbIndex: number;
    x: number;
    y: number;
    hoverNode: string | null;
  } | null>(null);

  const nodePositions = computeNodePositions();
  // Add seed as a node position for drop targeting
  const allNodePositions = [
    ...nodePositions,
    { id: 'seed', x: SEED_POS.x, y: SEED_POS.y, label: 'SEED', symbol: '✦', color: '#e5e5e5' },
  ];
  const floatingPositions = getFloatingPositions(orbs.length);

  // Hit test: find which node a point is over
  const findNode = useCallback((x: number, y: number): string | null => {
    for (const node of allNodePositions) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (Math.sqrt(dx * dx + dy * dy) < LAYOUT.snapRadius) {
        return node.id;
      }
    }
    return null;
  }, [allNodePositions]);

  // Touch handlers
  const handleTouchStart = useCallback((orbIndex: number, e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setDragState({ orbIndex, x, y, hoverNode: findNode(x, y) });
  }, [findNode]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setDragState(prev => prev ? { ...prev, x, y, hoverNode: findNode(x, y) } : null);
  }, [dragState, findNode]);

  const handleTouchEnd = useCallback(() => {
    if (!dragState) return;
    const { orbIndex, hoverNode } = dragState;
    const orb = orbs[orbIndex];

    if (hoverNode) {
      // Drop on a node
      if (orb.placedOnNode !== hoverNode) {
        placeOrb(orbIndex, hoverNode);
      }
    } else {
      // Drop in empty space — recall if placed
      if (orb.placedOnNode !== null) {
        recallOrb(orbIndex);
      }
    }
    setDragState(null);
  }, [dragState, orbs, placeOrb, recallOrb]);

  // Compute orb positions
  const orbPositions = orbs.map((orb, i) => {
    // If this orb is being dragged, use drag position
    if (dragState && dragState.orbIndex === i) {
      return { x: dragState.x, y: dragState.y, placed: false };
    }
    if (orb.placedOnNode) {
      const node = allNodePositions.find(n => n.id === orb.placedOnNode);
      if (node) {
        // Offset placed orbs slightly so multiple don't stack exactly
        const offsetAngle = (i * Math.PI * 2) / orbs.length;
        const offsetR = 8;
        return {
          x: node.x + Math.cos(offsetAngle) * offsetR,
          y: node.y + Math.sin(offsetAngle) * offsetR,
          placed: true,
        };
      }
    }
    // Floating in home row
    return { x: floatingPositions[i]?.x ?? LAYOUT.centerX, y: floatingPositions[i]?.y ?? LAYOUT.height - 45, placed: false };
  });

  if (fallbackMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          LISTEN
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '16px',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: LAYOUT.width,
          height: LAYOUT.height,
        }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => setDragState(null)}
      >
        {/* SVG layer — connectors + nodes + tallies */}
        <svg
          width={LAYOUT.width}
          height={LAYOUT.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {/* Radial connectors */}
          {nodePositions.map(node => (
            <line
              key={`line-${node.id}`}
              x1={SEED_POS.x}
              y1={SEED_POS.y}
              x2={node.x}
              y2={node.y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}

          {/* Node circles */}
          {allNodePositions.map(node => {
            const isHover = dragState?.hoverNode === node.id;
            const tally = tallies.find(t => t.granularType === node.id);
            const hasTally = tally && tally.votes.length > 0;

            return (
              <g key={node.id}>
                {/* Tally arcs */}
                {hasTally && <TallyArcs tally={tally!} cx={node.x} cy={node.y} radius={LAYOUT.nodeRadius + 6} chapters={chapters} />}

                {/* Node circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.id === 'seed' ? LAYOUT.seedRadius : LAYOUT.nodeRadius}
                  fill={isHover ? `rgba(255,255,255,0.08)` : 'rgba(255,255,255,0.02)'}
                  stroke={isHover ? 'rgba(255,255,255,0.4)' : tally?.locked ? `${node.color}88` : 'rgba(255,255,255,0.1)'}
                  strokeWidth={isHover ? 2 : 1}
                  strokeDasharray={tally?.locked ? '3 2' : undefined}
                />

                {/* Node symbol */}
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={`rgba(255,255,255,0.35)`}
                  fontSize={node.id === 'seed' ? 14 : 11}
                >
                  {node.symbol}
                </text>

                {/* Node label */}
                {node.id !== 'seed' && (
                  <text
                    x={node.x}
                    y={node.y + LAYOUT.nodeRadius + 12}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.2)"
                    fontSize={8}
                    fontWeight={500}
                    letterSpacing="0.08em"
                  >
                    {node.label}
                  </text>
                )}

                {/* Lock icon */}
                {tally?.locked && (
                  <text
                    x={node.x + LAYOUT.nodeRadius - 4}
                    y={node.y - LAYOUT.nodeRadius + 8}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.5)"
                    fontSize={10}
                  >
                    🔒
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Orb DOM elements — on top of SVG for touch handling */}
        {orbs.map((orb, i) => {
          const pos = orbPositions[i];
          const isDragging = dragState?.orbIndex === i;
          const chapter = getChapterIdentity(orb.chapterId);
          const radius = pos.placed && !isDragging ? LAYOUT.placedOrbRadius : LAYOUT.orbRadius;

          return (
            <div
              key={i}
              onTouchStart={(e) => handleTouchStart(i, e)}
              style={{
                position: 'absolute',
                left: pos.x - radius,
                top: pos.y - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: '50%',
                backgroundColor: chapter.color,
                border: `2px solid ${isDragging ? 'rgba(255,255,255,0.6)' : pos.placed ? 'transparent' : `${chapter.color}88`}`,
                opacity: pos.placed && !isDragging ? 0.6 : 1,
                filter: pos.placed && !isDragging ? 'blur(1px)' : 'none',
                transform: isDragging ? 'scale(1.3)' : 'scale(1)',
                transition: isDragging ? 'none' : 'all 0.25s ease',
                zIndex: isDragging ? 100 : 10,
                cursor: 'grab',
                touchAction: 'none',
                boxShadow: isDragging
                  ? `0 0 20px ${chapter.color}66`
                  : pos.placed
                    ? 'none'
                    : `0 0 8px ${chapter.color}33`,
              }}
            />
          );
        })}
      </div>

      {/* Hint text */}
      <p style={{
        color: 'rgba(255,255,255,0.15)',
        fontSize: '0.7rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        marginTop: '16px',
        textAlign: 'center',
      }}>
        {orbs.every(o => o.placedOnNode === null)
          ? 'DRAG AN ORB TO A NODE'
          : 'YOUR ORBS SHAPE THE MUSIC'}
      </p>
    </div>
  );
}

// ============================================================================
// Tally Wedges — polar plot visualization of votes per node
//
// Each chapter gets a fixed 120-degree wedge (always in the same angular position).
// The wedge extends radially outward from the node circle proportional to vote count.
// This creates a radar/spider chart effect: "bigger = more votes."
// ============================================================================

/** Max radial extension beyond the node circle (in px). */
const TALLY_MAX_EXTEND = 18;

function TallyArcs({
  tally,
  cx,
  cy,
  radius,
  chapters,
}: {
  tally: NodeTally;
  cx: number;
  cy: number;
  radius: number;
  chapters: ChapterConfig[];
}) {
  const maxCount = Math.max(...tally.votes.map(v => v.count), 1);
  const hasVotes = tally.votes.some(v => v.count > 0);
  if (!hasVotes) return null;

  // Each chapter gets a fixed 120-degree wedge.
  // Assign wedge positions based on chapter order in the config.
  const WEDGE_SWEEP = (2 * Math.PI) / 3; // 120 degrees
  const GAP = 0.06; // Small gap between wedges (radians)

  return (
    <g>
      {chapters.map((chapter, i) => {
        const vote = tally.votes.find(v => v.chapterId === chapter.id);
        const count = vote?.count ?? 0;
        if (count === 0) return null;

        // Fraction of max — drives radial extension
        const fraction = count / maxCount;
        const outerRadius = radius + TALLY_MAX_EXTEND * fraction;

        // Fixed angular position: wedge i starts at -90deg + i*120deg
        const wedgeStart = -Math.PI / 2 + i * WEDGE_SWEEP + GAP / 2;
        const wedgeEnd = wedgeStart + WEDGE_SWEEP - GAP;

        // Build a filled wedge path: inner arc → line → outer arc → line → close
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

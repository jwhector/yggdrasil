/**
 * SongTree Component
 *
 * Core visualization showing the song construction as a tree of options.
 * Displays dual paths: faction path (solid) and popular path (ghost/dashed).
 *
 * Features:
 * - Bottom-to-top row progression (row 0 at bottom)
 * - Grid layout during 'running' phase
 * - River delta layout during 'finale' phase (tight root, organically spreading tributaries)
 * - Smooth Catmull-Rom curved paths
 * - Animated individual audience paths during finale
 */

'use client';

import { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import type { DualPaths, OptionId, RowPhase, ShowConfig, ShowPhase, FinaleTimeline } from '@/conductor/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SongTreeProps {
  rows: Array<{
    index: number;
    label: string;
    type: string;
    options: Array<{
      id: OptionId;
      index: number;
      audioRef: string;
      harmonicGroup?: string;
    }>;
    phase: RowPhase;
    committedOption: OptionId | null;
    currentAuditionIndex: number | null;
    attempts: number;
  }>;
  paths: DualPaths;
  currentRowIndex: number;
  config?: ShowConfig;
  // New props for finale support
  showPhase: ShowPhase;
  finalePhase?: 'popular_song' | 'individual_timelines' | null;
  currentFinaleTimeline?: FinaleTimeline | null;
  factionColors?: string[];
  audienceTimelines?: FinaleTimeline[];
}

interface Point {
  x: number;
  y: number;
}

interface LayoutConfig {
  width: number;
  height: number;
  rows: number;
  options: number;
}

type LayoutMode = 'grid' | 'tree' | 'transitioning';

// ─── Constants ──────────────────────────────────────────────────────────────

const SVG_WIDTH = 800;
const SVG_HEIGHT = 700;
const OPTIONS_PER_ROW = 4;

const FACTION_COLORS = ['#e05c5c', '#5cb8e0', '#5ce08a', '#e0c55c'];
const DOT_RADIUS = 8;
const WINNER_RADIUS = 11;

// Grid layout spacing
const GRID_COL_SPACING = 70;
const GRID_ROW_SPACING = 56;

// Transition duration
const TRANSITION_DURATION_MS = 1500;

// ─── Layout Functions ───────────────────────────────────────────────────────

/**
 * Grid position - linear layout used during 'running' phase
 * Bottom-to-top: row 0 at bottom, higher rows at top
 */
function gridPosition(row: number, option: number, config: LayoutConfig): Point {
  const { width, height } = config;
  const x = width / 2 - GRID_COL_SPACING * 1.5 + option * GRID_COL_SPACING;
  const y = height - 70 - row * GRID_ROW_SPACING;
  return { x, y };
}

/**
 * Delta position - river delta / tributary layout used during 'finale' phase
 * Single source at bottom, paths branch outward with organic spread.
 * Jitter increases with row depth for natural asymmetry.
 */
function deltaPosition(
  row: number,
  option: number,
  config: LayoutConfig,
  jitter: Record<string, { dx: number; dy: number }>
): Point {
  const { width, height } = config;

  // Bottom-to-top Y positioning with increasing spacing toward the top
  const y0 = height - 60;
  const yTop = 60;
  const totalH = y0 - yTop;

  // Use a slight power curve so upper rows get more room to spread
  const t = row / (config.rows - 1); // 0 at bottom, 1 at top
  let y = y0 - t * totalH;

  // Spread increases as a power curve — tight at the root, wide at the tips
  const spread = 20 + Math.pow(row, 1.8) * 14;

  // 4 options evenly distributed across the spread
  const offsets = [-1.5, -0.5, 0.5, 1.5];
  let x = width / 2 + offsets[option] * spread;

  // Apply stable jitter — increases with row for organic feel
  const key = `${row}-${option}`;
  if (jitter[key]) {
    x += jitter[key].dx;
    y += jitter[key].dy;
  }

  return { x, y };
}

/**
 * Interpolate between grid and tree positions
 */
function interpolatedPosition(
  row: number,
  option: number,
  config: LayoutConfig,
  progress: number,
  jitter: Record<string, { dx: number; dy: number }>
): Point {
  const gridPos = gridPosition(row, option, config);
  const deltaPos = deltaPosition(row, option, config, jitter);

  return {
    x: gridPos.x + (deltaPos.x - gridPos.x) * progress,
    y: gridPos.y + (deltaPos.y - gridPos.y) * progress,
  };
}

/**
 * Generate stable jitter for delta layout.
 * Jitter magnitude increases with row index — tight at root, loose at tips.
 * Row 0 gets no jitter (common source), higher rows spread organically.
 */
function generateDeltaJitter(seed: number, numRows: number): Record<string, { dx: number; dy: number }> {
  let s = seed;
  const rand = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const jitter: Record<string, { dx: number; dy: number }> = {};
  for (let row = 0; row < numRows; row++) {
    for (let opt = 0; opt < OPTIONS_PER_ROW; opt++) {
      // Scale jitter: none at row 0, increasing toward top rows
      const magnitude = row <= 1 ? 0 : Math.pow(row - 1, 1.2) * 4;
      jitter[`${row}-${opt}`] = {
        dx: (rand() - 0.5) * magnitude,
        dy: (rand() - 0.5) * magnitude * 0.6,
      };
    }
  }
  return jitter;
}

// ─── Curve Generation ───────────────────────────────────────────────────────

/**
 * Calculate distance between two points
 */
function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/**
 * Generate a Catmull-Rom spline path string
 * Alpha 0.5 = centripetal (avoids cusps and self-intersections)
 */
function catmullRomPath(points: Point[], alpha: number = 0.5): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  // Duplicate first and last points for end tangents
  const extended = [points[0], ...points, points[points.length - 1]];

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];

    const d1 = distance(p0, p1);
    const d2 = distance(p1, p2);
    const d3 = distance(p2, p3);

    // Avoid division by zero
    if (d1 < 0.001 || d2 < 0.001 || d3 < 0.001) {
      path += ` L ${p2.x},${p2.y}`;
      continue;
    }

    const d1a = Math.pow(d1, alpha);
    const d2a = Math.pow(d2, alpha);
    const d3a = Math.pow(d3, alpha);

    const d1a2 = Math.pow(d1, 2 * alpha);
    const d2a2 = Math.pow(d2, 2 * alpha);
    const d3a2 = Math.pow(d3, 2 * alpha);

    // Control point 1
    const denom1 = 3 * d1a * (d1a + d2a);
    const cp1x = denom1 !== 0
      ? (d1a2 * p2.x - d2a2 * p0.x + (2 * d1a2 + 3 * d1a * d2a + d2a2) * p1.x) / denom1
      : (p1.x + p2.x) / 2;
    const cp1y = denom1 !== 0
      ? (d1a2 * p2.y - d2a2 * p0.y + (2 * d1a2 + 3 * d1a * d2a + d2a2) * p1.y) / denom1
      : (p1.y + p2.y) / 2;

    // Control point 2
    const denom2 = 3 * d3a * (d3a + d2a);
    const cp2x = denom2 !== 0
      ? (d3a2 * p1.x - d2a2 * p3.x + (2 * d3a2 + 3 * d3a * d2a + d2a2) * p2.x) / denom2
      : (p1.x + p2.x) / 2;
    const cp2y = denom2 !== 0
      ? (d3a2 * p1.y - d2a2 * p3.y + (2 * d3a2 + 3 * d3a * d2a + d2a2) * p2.y) / denom2
      : (p1.y + p2.y) / 2;

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Parse option index from optionId (e.g., "r0-opt2" → 2)
 */
function parseOptionIndex(optionId: OptionId): number {
  const match = optionId.match(/opt(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Easing function for smooth animation
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── AnimatedPath Component ─────────────────────────────────────────────────

interface AnimatedPathProps {
  path: string;
  color: string;
  strokeWidth: number;
  dashArray?: string;
  opacity?: number;
  delay?: number;
  duration?: number;
}

const AnimatedPath = memo(function AnimatedPath({
  path,
  color,
  strokeWidth,
  dashArray,
  opacity = 1,
  delay = 0,
  duration = 1200,
}: AnimatedPathProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  // Track how much of the path we've already animated (revealed)
  const animatedLengthRef = useRef(0);
  // Animation state: 'idle' | 'preparing' | 'animating'
  const [animState, setAnimState] = useState<'idle' | 'preparing' | 'animating'>('idle');
  // Store the offset to animate from
  const [targetOffset, setTargetOffset] = useState(0);

  // Measure path length when path changes
  useEffect(() => {
    if (!pathRef.current || !path) return;
    const totalLength = pathRef.current.getTotalLength();
    setPathLength(totalLength);
  }, [path]);

  // Detect new segments and trigger animation
  useEffect(() => {
    if (pathLength === 0) return;

    const newSegmentLength = pathLength - animatedLengthRef.current;

    if (newSegmentLength > 0.5) {
      // New segment to animate - set up the starting offset
      setTargetOffset(newSegmentLength);
      setAnimState('preparing');
    }
  }, [pathLength]);

  // Handle animation state machine
  useEffect(() => {
    if (animState === 'preparing') {
      // Wait for the "hidden" state to render, then start animation
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const timer = setTimeout(() => {
            setAnimState('animating');
            // Mark this length as animated after the animation completes
            setTimeout(() => {
              animatedLengthRef.current = pathLength;
              setAnimState('idle');
            }, duration);
          }, delay);
          return () => clearTimeout(timer);
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [animState, pathLength, delay, duration]);

  if (!path) return null;

  // Calculate dash offset based on animation state
  let dashOffset = 0;
  if (animState === 'preparing') {
    dashOffset = targetOffset; // Hidden - new segment not visible
  } else if (animState === 'animating') {
    dashOffset = 0; // Revealed - animate to this
  }
  // When idle, offset is 0 (fully visible)

  // For solid lines: use pathLength as single dash for animation
  // For dashed lines: use the custom pattern (animation won't work as smoothly)
  const effectiveDashArray = dashArray || `${pathLength}`;

  return (
    <path
      ref={pathRef}
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={effectiveDashArray}
      strokeDashoffset={dashOffset}
      opacity={opacity}
      style={{
        transition: animState === 'animating'
          ? `stroke-dashoffset ${duration}ms ease-in-out, opacity 1s ease`
          : 'none',
      }}
    />
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

export const SongTree = memo(function SongTree({
  rows,
  paths,
  currentRowIndex,
  showPhase,
  finalePhase,
  currentFinaleTimeline,
  factionColors = FACTION_COLORS,
  audienceTimelines,
}: SongTreeProps) {
  // Defensive check: ensure rows exist
  if (!rows || rows.length === 0) {
    return (
      <div style={styles.container}>
        <div style={{ color: '#999', fontSize: '1.5rem', textAlign: 'center' }}>
          Loading song tree...
        </div>
      </div>
    );
  }

  // Layout state - always start in grid mode, let useEffect handle transition
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid');
  const [layoutProgress, setLayoutProgress] = useState(0);

  // Generate mock audience timelines for testing (30 users with random paths)
  const mockTimelines = useMemo(() => {
    const timelines: FinaleTimeline[] = [];
    const numRows = rows.length;

    // Seeded random for reproducibility
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < 30; i++) {
      const path: string[] = [];
      for (let r = 0; r < numRows; r++) {
        const optionIdx = Math.floor(rand() * OPTIONS_PER_ROW);
        path.push(`r${r}-opt${optionIdx}`);
      }
      timelines.push({
        userId: `mock-user-${i}`,
        path: path as OptionId[],
        figTreeResponse: '',
        harmonicGroup: 'A',
      });
    }
    return timelines;
  }, [rows.length]);

  // Accumulated audience timelines for finale
  const [revealedTimelines, setRevealedTimelines] = useState<FinaleTimeline[]>([]);

  // Use provided timelines, or mock timelines for testing when in finale
  const effectiveTimelines = audienceTimelines ?? (showPhase === 'finale' ? mockTimelines : []);

  // Generate stable delta jitter
  const deltaJitter = useMemo(() => generateDeltaJitter(123, rows.length), [rows.length]);

  // Layout configuration
  const layoutConfig: LayoutConfig = useMemo(
    () => ({
      width: SVG_WIDTH,
      height: SVG_HEIGHT,
      rows: rows.length,
      options: OPTIONS_PER_ROW,
    }),
    [rows.length]
  );

  // Transition animation when entering finale
  useEffect(() => {
    if (showPhase === 'finale' && layoutMode !== 'tree') {
      setLayoutMode('transitioning');
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / TRANSITION_DURATION_MS, 1);
        const eased = easeInOutCubic(progress);
        setLayoutProgress(eased);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setLayoutMode('tree');
        }
      };

      requestAnimationFrame(animate);
    } else if (showPhase === 'running' && layoutMode === 'tree') {
      // Reset to grid (instant) if returning to running
      setLayoutMode('grid');
      setLayoutProgress(0);
      setRevealedTimelines([]);
    }
  }, [showPhase, layoutMode]);

  // Accumulate revealed timelines during finale
  useEffect(() => {
    if (
      currentFinaleTimeline &&
      !revealedTimelines.find((t) => t.userId === currentFinaleTimeline.userId)
    ) {
      setRevealedTimelines((prev) => [...prev, currentFinaleTimeline]);
    }
  }, [currentFinaleTimeline, revealedTimelines]);

  // Position function based on layout mode
  const getPosition = useCallback(
    (row: number, option: number): Point => {
      if (layoutMode === 'grid' || layoutProgress === 0) {
        return gridPosition(row, option, layoutConfig);
      }
      if (layoutMode === 'tree' || layoutProgress === 1) {
        return deltaPosition(row, option, layoutConfig, deltaJitter);
      }
      return interpolatedPosition(row, option, layoutConfig, layoutProgress, deltaJitter);
    },
    [layoutMode, layoutProgress, layoutConfig, deltaJitter]
  );

  // Build full path strings for smooth Catmull-Rom curves
  const factionPathString = useMemo(() => {
    if (paths.factionPath.length === 0) return '';
    const points = paths.factionPath.map((optionId, rowIdx) => {
      const optionIdx = parseOptionIndex(optionId);
      return getPosition(rowIdx, optionIdx);
    });
    return catmullRomPath(points);
  }, [paths.factionPath, getPosition]);

  const popularPathString = useMemo(() => {
    if (paths.popularPath.length === 0) return '';
    const points = paths.popularPath.map((optionId, rowIdx) => {
      const optionIdx = parseOptionIndex(optionId);
      return getPosition(rowIdx, optionIdx);
    });
    return catmullRomPath(points);
  }, [paths.popularPath, getPosition]);

  // Build audience timeline path strings
  const audiencePathStrings = useMemo(() => {
    return effectiveTimelines.map((timeline, idx) => {
      const points = timeline.path.map((optionId, rowIdx) => {
        const optionIdx = parseOptionIndex(optionId);
        return getPosition(rowIdx, optionIdx);
      });
      return {
        userId: timeline.userId,
        path: catmullRomPath(points),
        // Determine faction from userId - for now use modulo as placeholder
        // In production, this would come from user data
        factionIndex: idx % 4,
      };
    });
  }, [effectiveTimelines, getPosition]);

  const isTreeMode = layoutMode === 'tree' || layoutProgress > 0;
  const isTransitioning = layoutMode === 'transitioning';
  const hasAudiencePaths = effectiveTimelines.length > 0;

  return (
    <div style={styles.container}>
      <svg
        style={styles.svg}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Audience timeline paths (finale - individual_timelines phase) */}
        {finalePhase === 'individual_timelines' &&
          audiencePathStrings.map((ap, idx) => (
            <AnimatedPath
              key={ap.userId}
              path={ap.path}
              color={factionColors[ap.factionIndex] || FACTION_COLORS[0]}
              strokeWidth={2}
              opacity={0.5}
              delay={idx * 100}
              duration={1000}
            />
          ))}

        {/* Popular path (ghost/dashed) */}
        <AnimatedPath
          path={popularPathString}
          color="#666"
          strokeWidth={3}
          dashArray="8 4"
          opacity={hasAudiencePaths ? 0.2 : 0.5}
          delay={0}
          duration={paths.popularPath.length * 300}
        />

        {/* Faction path (solid/winner) */}
        <AnimatedPath
          path={factionPathString}
          color="#fff"
          strokeWidth={4}
          opacity={hasAudiencePaths ? 0.15 : 1}
          delay={0}
          duration={paths.factionPath.length * 300}
        />

        {/* Option nodes */}
        {rows.map((row) =>
          row.options.map((option, optIdx) => {
            const pos = getPosition(row.index, optIdx);
            const visible = row.phase !== 'pending' || row.index <= currentRowIndex;
            const isCommitted = row.committedOption === option.id;
            const isInFactionPath = paths.factionPath.includes(option.id);
            const isWinner = visible && (isCommitted || isInFactionPath);
            const isCurrent = row.index === currentRowIndex && row.phase !== 'pending';

            return (
              <g key={option.id}>
                {/* Winner glow ring */}
                {isWinner && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={WINNER_RADIUS + 6}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={1}
                    opacity={0.12}
                    style={{
                      transition: isTransitioning ? 'none' : 'cx 1.5s ease-in-out, cy 1.5s ease-in-out',
                    }}
                  />
                )}
                {/* Current row glow */}
                {isCurrent && !isWinner && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={DOT_RADIUS + 8}
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth={2}
                    opacity={0.4}
                    style={{
                      transition: isTransitioning ? 'none' : 'cx 1.5s ease-in-out, cy 1.5s ease-in-out',
                    }}
                  />
                )}
                {/* Main node circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isWinner ? WINNER_RADIUS : DOT_RADIUS}
                  fill={!visible ? '#1a1a22' : isWinner ? '#fff' : '#3a3a44'}
                  stroke={!visible ? '#2a2a32' : isWinner ? '#fff' : '#4a4a54'}
                  strokeWidth={visible ? 1.5 : 0.5}
                  opacity={visible ? 1 : 0.35}
                  style={{
                    transition: isTransitioning
                      ? 'r 0.4s ease, fill 0.4s ease, opacity 0.4s ease'
                      : 'cx 1.5s ease-in-out, cy 1.5s ease-in-out, r 0.4s ease, fill 0.4s ease, opacity 0.4s ease',
                  }}
                />
                {/* Option label */}
                {visible && (
                  <text
                    x={pos.x}
                    y={pos.y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={9}
                    fontWeight={700}
                    fill={isWinner ? '#0b0b0f' : '#666'}
                    style={{
                      transition: isTransitioning ? 'none' : 'x 1.5s ease-in-out, y 1.5s ease-in-out',
                      pointerEvents: 'none',
                    }}
                  >
                    {String.fromCharCode(65 + optIdx)}
                  </text>
                )}
              </g>
            );
          })
        )}

        {/* Row labels */}
        {rows.map((row) => {
          const visible = row.phase !== 'pending' || row.index <= currentRowIndex;
          if (!visible) return null;

          const leftPos = getPosition(row.index, 0);
          const labelX = isTreeMode
            ? Math.min(leftPos.x, getPosition(row.index, OPTIONS_PER_ROW - 1).x) - 30
            : leftPos.x - 40;

          return (
            <text
              key={`label-${row.index}`}
              x={labelX}
              y={leftPos.y + 1}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={10}
              fill="#444"
              style={{
                transition: isTransitioning ? 'none' : 'x 1.5s ease-in-out, y 1.5s ease-in-out',
              }}
            >
              {row.label || `R${row.index + 1}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
});

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  } as React.CSSProperties,

  svg: {
    width: '90%',
    height: '90%',
    maxWidth: SVG_WIDTH,
    maxHeight: SVG_HEIGHT,
  } as React.CSSProperties,
};

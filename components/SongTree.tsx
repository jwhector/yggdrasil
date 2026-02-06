/**
 * SongTree Component
 *
 * Core visualization showing the song construction as a tree of options.
 * Displays dual paths: faction path (solid) and popular path (ghost/dashed).
 *
 * This is the most complex projector component - handles:
 * - Grid layout of rows × options
 * - SVG path drawing and animation
 * - Current row highlighting
 * - Option state visualization (pending/committed/popular)
 */

'use client';

import { useEffect, useRef, memo } from 'react';
import type { DualPaths, OptionId, RowPhase, ShowConfig } from '@/conductor/types';

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
  config?: ShowConfig; // Optional since we now get data from rows
}

// Grid layout constants (in pixels)
const OPTION_SPACING = 150;
const ROW_SPACING = 100;
const MARGIN_LEFT = 100;
const MARGIN_TOP = 80;
const OPTION_SIZE = 60;

/**
 * Parse option index from optionId (e.g., "r0-opt2" → 2)
 */
function parseOptionIndex(optionId: OptionId): number {
  const match = optionId.match(/opt(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Calculate SVG path coordinates from a path array
 */
function calculatePathCoordinates(path: OptionId[]): string {
  if (path.length === 0) return '';

  const points = path.map((optionId, rowIdx) => {
    const optionIdx = parseOptionIndex(optionId);
    const x = MARGIN_LEFT + optionIdx * OPTION_SPACING + OPTION_SIZE / 2;
    const y = MARGIN_TOP + rowIdx * ROW_SPACING + OPTION_SIZE / 2;
    return { x, y };
  });

  return points.reduce((acc, pt, idx) => {
    if (idx === 0) return `M ${pt.x},${pt.y}`;
    return `${acc} L ${pt.x},${pt.y}`;
  }, '');
}

/**
 * AnimatedPath component - handles SVG path drawing animation
 */
const AnimatedPath = memo(({
  path,
  color,
  strokeWidth,
  dashArray,
  pathLength,
}: {
  path: string;
  color: string;
  strokeWidth: number;
  dashArray?: string;
  pathLength: number;
}) => {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!pathRef.current || pathLength === 0) return;

    const pathElement = pathRef.current;
    const length = pathElement.getTotalLength();

    // Set up starting position
    pathElement.style.strokeDasharray = `${length}`;
    pathElement.style.strokeDashoffset = `${length}`;

    // Trigger animation
    requestAnimationFrame(() => {
      pathElement.style.transition = 'stroke-dashoffset 800ms ease-out';
      pathElement.style.strokeDashoffset = '0';
    });
  }, [pathLength]);

  if (!path) return null;

  return (
    <path
      ref={pathRef}
      d={path}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={dashArray}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});

AnimatedPath.displayName = 'AnimatedPath';

export const SongTree = memo(function SongTree({
  rows,
  paths,
  currentRowIndex,
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

  // Calculate SVG viewBox dimensions
  const svgWidth = MARGIN_LEFT * 2 + OPTION_SPACING * 3 + OPTION_SIZE;
  const svgHeight = MARGIN_TOP * 2 + ROW_SPACING * (rows.length - 1) + OPTION_SIZE;

  // Calculate path strings
  const factionPathString = calculatePathCoordinates(paths.factionPath);
  const popularPathString = calculatePathCoordinates(paths.popularPath);

  return (
    <div style={styles.container}>
      {/* SVG overlay for paths */}
      <svg
        style={styles.svgOverlay}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Popular path (ghost/dashed) - drawn first so it appears behind */}
        <AnimatedPath
          path={popularPathString}
          color="#666"
          strokeWidth={3}
          dashArray="8 4"
          pathLength={paths.popularPath.length}
        />

        {/* Faction path (solid) - drawn second so it appears on top */}
        <AnimatedPath
          path={factionPathString}
          color="#fff"
          strokeWidth={4}
          pathLength={paths.factionPath.length}
        />
      </svg>

      {/* Grid of rows and options */}
      <div style={styles.grid}>
        {rows.map((row, rowIdx) => {
          const isCurrentRow = rowIdx === currentRowIndex;

          return (
            <div key={row.index} style={styles.row}>
              {/* Row label */}
              <div style={styles.rowLabel}>
                <div style={{ fontSize: '0.875rem', color: '#999' }}>
                  Row {row.index}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>
                  {row.label || `Row ${row.index}`}
                </div>
              </div>

              {/* Options */}
              <div style={styles.optionsContainer}>
                {row.options.map((option, optionIdx) => {
                  const isCommitted = row.committedOption === option.id;
                  const isInFactionPath = paths.factionPath.includes(option.id);
                  const isInPopularPath = paths.popularPath.includes(option.id);

                  // Determine option visual state
                  let optionStyle = { ...styles.option };

                  if (isCommitted || isInFactionPath) {
                    // Committed (faction path)
                    optionStyle = {
                      ...optionStyle,
                      ...styles.optionCommitted,
                    };
                  } else if (isInPopularPath) {
                    // Popular path (ghost)
                    optionStyle = {
                      ...optionStyle,
                      ...styles.optionPopular,
                    };
                  }

                  // Current row highlighting
                  if (isCurrentRow) {
                    optionStyle = {
                      ...optionStyle,
                      ...styles.optionCurrent,
                    };
                  }

                  return (
                    <div
                      key={option.id}
                      style={optionStyle}
                      title={`${row.label} - Option ${optionIdx}`}
                    >
                      <div style={{ fontSize: '0.75rem', color: '#999' }}>
                        {optionIdx}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

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

  svgOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    height: '90%',
    pointerEvents: 'none',
    zIndex: 1,
  } as React.CSSProperties,

  grid: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: `${ROW_SPACING - OPTION_SIZE}px`,
    padding: '2rem',
  } as React.CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '2rem',
  } as React.CSSProperties,

  rowLabel: {
    width: '120px',
    textAlign: 'right',
    flexShrink: 0,
  } as React.CSSProperties,

  optionsContainer: {
    display: 'flex',
    gap: `${OPTION_SPACING - OPTION_SIZE}px`,
  } as React.CSSProperties,

  option: {
    width: `${OPTION_SIZE}px`,
    height: `${OPTION_SIZE}px`,
    borderRadius: '50%',
    border: '2px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    transition: 'all 0.3s ease',
  } as React.CSSProperties,

  optionCommitted: {
    backgroundColor: '#4ade80',
    border: '2px solid #4ade80',
  } as React.CSSProperties,

  optionPopular: {
    border: '2px dashed #666',
    backgroundColor: 'transparent',
  } as React.CSSProperties,

  optionCurrent: {
    boxShadow: '0 0 20px rgba(74, 222, 128, 0.6)',
    transform: 'scale(1.05)',
  } as React.CSSProperties,
};

/**
 * TriangleSteering
 *
 * SVG equilateral triangle with chapter-labeled corners and a draggable dot.
 *
 * Audience mode (interactive=true): user drags dot to express their steering
 * preference. Uses useTriangleInput for touch/pointer handling.
 *
 * Projector mode (interactive=false): displays the collective centroid dot
 * (interpolated from server broadcasts) and chapter corner labels.
 *
 * Corner layout:
 *   Ambition = top center (#e63946 / ▲)
 *   Love = bottom left   (#f4a261 / ●)
 *   Avoidance = bottom right (#457b9d / ◆)
 */

'use client';

import type { TrianglePosition } from '@/conductor/types';
import { defaultVertices, barycentricToPoint, useTriangleInput } from '@/hooks/useTriangle';

export interface TriangleSteeringProps {
  // --- Audience (interactive) ---
  position?: TrianglePosition;
  onPositionChange?: (pos: TrianglePosition) => void;
  interactive?: boolean;

  // --- Projector (display) ---
  centroid?: TrianglePosition;
  showCentroid?: boolean;

  // --- Shared ---
  /** SVG viewBox dimension. Default 300. */
  size?: number;
}

const CHAPTER_COLORS = {
  ambition: '#e63946',
  love: '#f4a261',
  avoidance: '#457b9d',
} as const;

const CENTER: TrianglePosition = { wAmbition: 1 / 3, wLove: 1 / 3, wAvoidance: 1 / 3 };

export function TriangleSteering({
  position,
  onPositionChange,
  interactive = true,
  centroid,
  showCentroid = false,
  size = 300,
}: TriangleSteeringProps) {
  const vertices = defaultVertices(size);

  // Audience input hook (only attaches events when interactive=true)
  const { containerRef, position: localPosition } = useTriangleInput({
    onPositionChange: onPositionChange ?? (() => {}),
    enabled: interactive,
    size,
  });

  // Decide which position to show the user dot at
  const dotPosition = interactive ? localPosition : (position ?? CENTER);
  const dotXY = barycentricToPoint(
    dotPosition,
    vertices.ambition,
    vertices.love,
    vertices.avoidance,
  );

  // Centroid dot (projector)
  const centroidXY = centroid
    ? barycentricToPoint(centroid, vertices.ambition, vertices.love, vertices.avoidance)
    : null;

  const trianglePoints = [
    vertices.ambition.join(','),
    vertices.love.join(','),
    vertices.avoidance.join(','),
  ].join(' ');

  // Label offsets from vertices (push labels slightly outside)
  const labelPad = size * 0.1;
  const labelPositions = {
    ambition: { x: vertices.ambition[0], y: vertices.ambition[1] - labelPad * 0.6, anchor: 'middle' as const },
    love:     { x: vertices.love[0] - labelPad * 0.4, y: vertices.love[1] + labelPad * 0.8, anchor: 'end' as const },
    avoidance:{ x: vertices.avoidance[0] + labelPad * 0.4, y: vertices.avoidance[1] + labelPad * 0.8, anchor: 'start' as const },
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: `${size}px`,
        padding: '16px',
      }}
    >
      <svg
        ref={interactive ? containerRef : undefined}
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: interactive ? 'crosshair' : 'default',
          display: 'block',
        }}
      >
        {/* Triangle fill — subtle gradient regions near corners */}
        <defs>
          <radialGradient id="grad-ambition" cx={vertices.ambition[0] / size} cy={vertices.ambition[1] / size} r="0.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={CHAPTER_COLORS.ambition} stopOpacity="0.12" />
            <stop offset="100%" stopColor={CHAPTER_COLORS.ambition} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="grad-love" cx={vertices.love[0] / size} cy={vertices.love[1] / size} r="0.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={CHAPTER_COLORS.love} stopOpacity="0.12" />
            <stop offset="100%" stopColor={CHAPTER_COLORS.love} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="grad-avoidance" cx={vertices.avoidance[0] / size} cy={vertices.avoidance[1] / size} r="0.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={CHAPTER_COLORS.avoidance} stopOpacity="0.12" />
            <stop offset="100%" stopColor={CHAPTER_COLORS.avoidance} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Triangle background fills */}
        <polygon points={trianglePoints} fill="url(#grad-ambition)" />
        <polygon points={trianglePoints} fill="url(#grad-love)" />
        <polygon points={trianglePoints} fill="url(#grad-avoidance)" />

        {/* Triangle outline */}
        <polygon
          points={trianglePoints}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1.5"
        />

        {/* Corner accent dots */}
        <circle cx={vertices.ambition[0]} cy={vertices.ambition[1]} r="4" fill={CHAPTER_COLORS.ambition} />
        <circle cx={vertices.love[0]} cy={vertices.love[1]} r="4" fill={CHAPTER_COLORS.love} />
        <circle cx={vertices.avoidance[0]} cy={vertices.avoidance[1]} r="4" fill={CHAPTER_COLORS.avoidance} />

        {/* Corner labels */}
        <text
          x={labelPositions.ambition.x}
          y={labelPositions.ambition.y}
          textAnchor={labelPositions.ambition.anchor}
          fill={CHAPTER_COLORS.ambition}
          fontSize="10"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="1"
        >
          AMBITION
        </text>
        <text
          x={labelPositions.love.x}
          y={labelPositions.love.y}
          textAnchor={labelPositions.love.anchor}
          fill={CHAPTER_COLORS.love}
          fontSize="10"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="1"
        >
          LOVE
        </text>
        <text
          x={labelPositions.avoidance.x}
          y={labelPositions.avoidance.y}
          textAnchor={labelPositions.avoidance.anchor}
          fill={CHAPTER_COLORS.avoidance}
          fontSize="10"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="1"
        >
          AVOIDANCE
        </text>

        {/* Projector centroid dot (blended color) */}
        {showCentroid && centroidXY && (
          <>
            <circle
              cx={centroidXY[0]}
              cy={centroidXY[1]}
              r="10"
              fill="rgba(255,255,255,0.08)"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
            />
            <circle
              cx={centroidXY[0]}
              cy={centroidXY[1]}
              r="5"
              fill="rgba(255,255,255,0.7)"
            />
          </>
        )}

        {/* User / audience dot */}
        {interactive && (
          <>
            <circle
              cx={dotXY[0]}
              cy={dotXY[1]}
              r="14"
              fill="rgba(255,255,255,0.06)"
            />
            <circle
              cx={dotXY[0]}
              cy={dotXY[1]}
              r="8"
              fill="#fff"
              style={{ transition: 'cx 0.05s ease, cy 0.05s ease' }}
            />
          </>
        )}
      </svg>

      {/* Helper text (audience only) */}
      {interactive && (
        <p
          style={{
            color: 'rgba(255,255,255,0.3)',
            fontSize: '0.7rem',
            textAlign: 'center',
            letterSpacing: '0.08em',
            marginTop: '8px',
          }}
        >
          Drag to steer the sound
        </p>
      )}

      {/* TODO: Auto-recenter drift when idle (triangleDriftTimeoutMs from config) */}
      {/* TODO: Underrepresented chapter glow on corners */}
    </div>
  );
}

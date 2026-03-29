'use client';

/**
 * ThresholdDisplay
 *
 * Projector-only component. Shows the doubt threshold line during attempt_build,
 * visible before the vote opens. Displays all 6 thresholds as stepped marks to
 * preview the escalation curve — current layer's threshold is emphasized.
 *
 * This is the single most important visualization: the audience and performer can
 * see at a glance how hard each layer will be to survive.
 */

import type { LayerType } from '@/conductor/types';

export interface ThresholdDisplayProps {
  /** Current layer's doubt threshold (0.0–1.0) */
  threshold: number;
  /** Current layer index (0–5) */
  layerIndex: number;
  /** All thresholds for this attempt (length 6) */
  allThresholds: number[];
  /** Layer identity color for theming */
  layerColor: string;
}

export function ThresholdDisplay({
  threshold,
  layerIndex,
  allThresholds,
  layerColor,
}: ThresholdDisplayProps) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {/* Label */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            fontSize: '0.6rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            opacity: 0.4,
          }}
        >
          Doubt Threshold
        </span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: layerColor,
          }}
        >
          {Math.round(threshold * 100)}%
        </span>
      </div>

      {/* Bar with threshold marks */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 20,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderRadius: 10,
          overflow: 'visible',
        }}
      >
        {/* Filled region up to threshold — shows "required" consensus */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${threshold * 100}%`,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderRadius: 10,
          }}
        />

        {/* Threshold marks for all layers */}
        {allThresholds.map((t, i) => {
          const isCurrent = i === layerIndex;
          const isPast = i < layerIndex;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: isCurrent ? '-6px' : '2px',
                bottom: isCurrent ? '-6px' : '2px',
                left: `${t * 100}%`,
                width: isCurrent ? 3 : 1,
                backgroundColor: isCurrent
                  ? layerColor
                  : isPast
                    ? 'rgba(255,255,255,0.15)'
                    : 'rgba(255,255,255,0.25)',
                transform: 'translateX(-50%)',
                transition: 'all 0.3s ease',
                borderRadius: 1,
              }}
            />
          );
        })}

        {/* Current threshold label tick */}
        <div
          style={{
            position: 'absolute',
            top: '-22px',
            left: `${threshold * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: '0.55rem',
            opacity: 0.6,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap' as const,
            color: layerColor,
          }}
        >
          Layer {layerIndex + 1}
        </div>
      </div>
    </div>
  );
}

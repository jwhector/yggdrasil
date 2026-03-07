'use client';

/**
 * ConvergenceMeter
 *
 * Full-width animated gauge showing convergence (0 to 1) with NO numbers.
 * Threshold zone is marked; entering the success zone triggers a visual shift.
 * Subtle round timer integrated below the bar.
 *
 * Uses animated values from useConvergence hook for spring-like smoothness.
 */

interface ConvergenceMeterProps {
  animatedValue: number;    // 0.0 to 1.0, spring-interpolated
  threshold: number;        // success zone threshold
  timeRemaining: number;    // ms remaining in current round
  roundDurationMs: number;  // total round duration (for computing timer fraction)
  roundActive: boolean;
}

export function ConvergenceMeter({
  animatedValue,
  threshold,
  timeRemaining,
  roundDurationMs,
  roundActive,
}: ConvergenceMeterProps) {
  const isAbove = animatedValue >= threshold && roundActive;
  const fillPct = Math.round(Math.max(0, Math.min(1, animatedValue)) * 100);
  const timerPct = roundDurationMs > 0
    ? Math.round(Math.max(0, Math.min(1, timeRemaining / roundDurationMs)) * 100)
    : 0;

  const fillColor = isAbove
    ? '#4ade80'       // success green
    : roundActive
    ? '#e5e5e5'       // active white
    : '#444';         // inactive gray

  const glowStyle: React.CSSProperties = isAbove
    ? { boxShadow: '0 0 20px rgba(74, 222, 128, 0.5)' }
    : {};

  return (
    <div style={styles.container}>
      {/* Main bar */}
      <div style={styles.track}>
        {/* Threshold zone: right portion above threshold */}
        <div
          style={{
            ...styles.thresholdZone,
            left: `${Math.round(threshold * 100)}%`,
            width: `${100 - Math.round(threshold * 100)}%`,
          }}
        />

        {/* Threshold tick mark */}
        <div
          style={{
            ...styles.thresholdTick,
            left: `${Math.round(threshold * 100)}%`,
          }}
        />

        {/* Fill bar */}
        <div
          style={{
            ...styles.fill,
            width: `${fillPct}%`,
            backgroundColor: fillColor,
            transition: 'background-color 0.3s ease',
            ...glowStyle,
          }}
        />
      </div>

      {/* Round timer: thin line below, shrinks from right */}
      <div style={styles.timerTrack}>
        <div
          style={{
            ...styles.timerFill,
            width: `${timerPct}%`,
            backgroundColor: timerPct < 20 ? '#ef4444' : 'rgba(255,255,255,0.25)',
            transition: 'background-color 0.5s ease',
          }}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  track: {
    position: 'relative',
    width: '100%',
    height: '12px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  thresholdZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(74, 222, 128, 0.08)',
    pointerEvents: 'none',
  },
  thresholdTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '2px',
    backgroundColor: 'rgba(74, 222, 128, 0.4)',
    transform: 'translateX(-1px)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    borderRadius: '6px',
    willChange: 'width',
  },
  timerTrack: {
    width: '100%',
    height: '3px',
    backgroundColor: '#111',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    borderRadius: '2px',
    float: 'right',  // shrinks from right to left
  },
};

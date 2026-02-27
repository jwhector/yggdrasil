/**
 * DoubtMeter (Projector)
 *
 * Shows the current consensus relative to the doubt threshold.
 * When consensus falls below the threshold, the attempt is at risk of collapse.
 *
 * Hidden when doubtThreshold is null (no threshold for this layer).
 */

'use client';

export interface DoubtMeterProps {
  consensus: number | null;
  doubtThreshold: number | null;
  isActive: boolean;
  collapsed: boolean;
}

export function DoubtMeter({ consensus, doubtThreshold, isActive, collapsed }: DoubtMeterProps) {
  if (doubtThreshold === null) return null;

  const pct = consensus !== null ? Math.round(consensus * 100) : 0;
  const thresholdPct = Math.round(doubtThreshold * 100);
  const atRisk = consensus !== null && consensus < doubtThreshold;

  const fillColor = collapsed
    ? '#ef4444'
    : atRisk
    ? '#f97316' // orange warning
    : '#22c55e'; // green safe

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: '0.8rem',
          color: collapsed ? '#fca5a5' : atRisk ? '#fdba74' : 'rgba(255,255,255,0.5)',
        }}
      >
        <span style={{ letterSpacing: '0.08em', fontWeight: 600 }}>
          {collapsed ? 'COLLAPSED' : atRisk ? 'AT RISK' : 'CONSENSUS'}
        </span>
        <span>
          need ≥ {thresholdPct}%
        </span>
      </div>

      {/* Gauge */}
      <div
        style={{
          position: 'relative',
          height: '16px',
          borderRadius: '8px',
          overflow: 'visible',
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            backgroundColor: fillColor,
            borderRadius: '8px',
            transition: 'width 0.4s ease, background-color 0.3s ease',
            opacity: isActive ? 1 : 0.5,
          }}
        />

        {/* Threshold line */}
        <div
          style={{
            position: 'absolute',
            left: `${thresholdPct}%`,
            top: '-4px',
            bottom: '-4px',
            width: '2px',
            backgroundColor: '#fff',
            opacity: 0.6,
            transform: 'translateX(-50%)',
            borderRadius: '1px',
          }}
        />

        {/* Threshold label */}
        <div
          style={{
            position: 'absolute',
            left: `${thresholdPct}%`,
            top: '-20px',
            transform: 'translateX(-50%)',
            fontSize: '0.65rem',
            color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap',
          }}
        >
          {thresholdPct}%
        </div>
      </div>

      {/* Current pct */}
      {consensus !== null && (
        <div
          style={{
            textAlign: 'right',
            fontSize: '0.8rem',
            color: fillColor,
            fontWeight: 600,
          }}
        >
          {pct}%
        </div>
      )}
    </div>
  );
}

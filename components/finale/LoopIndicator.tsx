'use client';

/**
 * LoopIndicator
 *
 * Shows position within the current 8-bar loop (0.0 to 1.0).
 * Used by MixingSurface (controller) and MixingMirror (projector).
 * When pendingCount > 0 and near a loop boundary, highlights in amber.
 */

interface LoopIndicatorProps {
  loopPosition: number;     // 0.0 to 1.0
  loopCount: number;
  pendingCount?: number;
}

export function LoopIndicator({
  loopPosition,
  loopCount,
  pendingCount = 0,
}: LoopIndicatorProps) {
  const pct = Math.round(Math.max(0, Math.min(1, loopPosition)) * 100);
  const nearBoundary = loopPosition > 0.85;
  const hasPending = pendingCount > 0;
  const highlight = hasPending && nearBoundary;

  const fillColor = highlight ? '#fbbf24' : 'rgba(255,255,255,0.3)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '0.65rem',
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Loop {loopCount + 1}
        </span>
        {hasPending && (
          <span
            style={{
              fontSize: '0.65rem',
              color: highlight ? '#fbbf24' : '#888',
              transition: 'color 0.3s ease',
            }}
          >
            {pendingCount} change{pendingCount !== 1 ? 's' : ''} pending
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: '100%',
          height: '4px',
          backgroundColor: '#1a1a1a',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: fillColor,
            borderRadius: '2px',
            transition: 'background-color 0.3s ease',
            boxShadow: highlight ? '0 0 6px #fbbf2488' : 'none',
          }}
        />
      </div>
    </div>
  );
}

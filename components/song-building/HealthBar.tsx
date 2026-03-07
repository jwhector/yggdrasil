'use client';

/**
 * HealthBar
 *
 * Visual gauge showing song vitality (0–100). No numeric labels.
 * Color shifts from healthy (green) to critical (red) as health decreases.
 *
 * During the reveal sequence, pass drainShadow to preview the incoming drain
 * before it animates to the new actual value.
 */

export interface HealthBarProps {
  /** Current health value 0–100 */
  health: number;
  /** Pending drain amount (shown as translucent red shadow before animating) */
  drainShadow?: number;
  /** 'audience' = compact (phones), 'projector' = large and dramatic */
  variant: 'audience' | 'projector';
}

/** Interpolate color from green → yellow → red based on health 0–100 */
function healthColor(health: number): string {
  if (health >= 60) {
    // Green → yellow (100 → 60)
    const t = (health - 60) / 40; // 1.0 at full, 0.0 at 60
    const r = Math.round(34 + (245 - 34) * (1 - t));   // 34 (green) → 245 (yellow)
    const g = Math.round(197 + (197 - 197) * (1 - t)); // steady green channel
    const b = Math.round(94 + (66 - 94) * (1 - t));
    // Simpler: just use fixed stops
    const ratio = (health - 60) / 40;
    return ratio > 0.5
      ? `hsl(${Math.round(80 + ratio * 40)}, 70%, 45%)`
      : `hsl(${Math.round(40 + ratio * 40)}, 85%, 50%)`;
  } else if (health >= 30) {
    // Yellow → orange (60 → 30)
    const ratio = (health - 30) / 30;
    return `hsl(${Math.round(20 + ratio * 20)}, 90%, 50%)`;
  } else {
    // Orange → red (30 → 0)
    const ratio = health / 30;
    return `hsl(${Math.round(ratio * 20)}, 90%, 45%)`;
  }
}

export function HealthBar({ health, drainShadow = 0, variant }: HealthBarProps) {
  const clampedHealth = Math.max(0, Math.min(100, health));
  const clampedShadow = Math.max(0, Math.min(drainShadow, clampedHealth));

  const barHeight = variant === 'projector' ? 20 : 10;
  const borderRadius = barHeight / 2;
  const glow = variant === 'projector' && clampedHealth > 20
    ? `0 0 8px 1px ${healthColor(clampedHealth)}55`
    : 'none';

  return (
    <div
      style={{
        width: '100%',
        height: barHeight,
        borderRadius,
        backgroundColor: 'rgba(255,255,255,0.08)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Drain shadow — preview of pending damage */}
      {clampedShadow > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${clampedHealth}%`,
            borderRadius,
            backgroundColor: 'rgba(239,68,68,0.35)',
            transition: 'width 0.15s ease',
          }}
        />
      )}

      {/* Health fill */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${clampedHealth - clampedShadow}%`,
          borderRadius,
          backgroundColor: healthColor(clampedHealth),
          boxShadow: glow,
          transition: 'width 0.8s ease-out, background-color 0.4s ease',
        }}
      />
    </div>
  );
}

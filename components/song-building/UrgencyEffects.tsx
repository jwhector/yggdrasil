'use client';

/**
 * UrgencyEffects
 *
 * Wrapper component for audience phone during attempt_build. Applies CSS urgency
 * classes based on layerIndex to create atmospheric destabilization effects.
 *
 * All effects are purely cosmetic — tap targets remain mechanically unchanged
 * because transforms affect the visual container, not the underlying elements'
 * event handling. At the 2–4px drift magnitudes used, any tap coordinate offset
 * is within acceptable tolerance. Per spec: if playtesters miss taps due to
 * jitter, reduce the effect in globals.css.
 *
 * Urgency levels:
 *   0–1: Clean, stable, calm
 *   2: Timer text shifts toward red
 *   3: Option cards subtle drift (±2px), timer pulses faster
 *   4: Increased drift (±4px), colors desaturate, timer digits jitter
 *   5: Full destabilization — drift, color shift, visual noise
 *
 * When collapsed=true, all effects are stripped instantly (collapse is release).
 */

interface UrgencyEffectsProps {
  layerIndex: number;
  collapsed: boolean;
  children: React.ReactNode;
}

export function UrgencyEffects({ layerIndex, collapsed, children }: UrgencyEffectsProps) {
  const urgencyClass = collapsed ? '' : `urgency-${Math.min(layerIndex, 5)}`;

  return (
    <div className={urgencyClass} style={{ width: '100%' }}>
      {children}
    </div>
  );
}

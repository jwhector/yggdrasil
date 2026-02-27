/**
 * SlotCard
 *
 * Displays a single active slot on the projector. Shows:
 * - Chapter color / layer symbol for the active fragment
 * - Fragment display name
 * - Steward indicator
 * - Energy-driven glow from audio metering data (boxShadow intensity)
 *
 * Empty slots show a dark placeholder with the slot number.
 */

'use client';

import type { ActiveSlot } from '@/conductor/types';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';

export interface SlotCardProps {
  slot: ActiveSlot | null;
  energy: number;   // 0.0–1.0 from metering
  slotIndex: number;
}

export function SlotCard({ slot, energy, slotIndex }: SlotCardProps) {
  if (!slot) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.06)',
          backgroundColor: 'rgba(255,255,255,0.02)',
          padding: '16px 8px',
          minHeight: '120px',
          flex: 1,
        }}
      >
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em' }}>
          SLOT {slotIndex + 1}
        </span>
      </div>
    );
  }

  const chapter = getChapterIdentity(slot.fragment.chapter);
  const layer = getLayerIdentity(slot.fragment.layerType);

  // Energy-driven glow: 0 energy = no glow; 1.0 = full glow
  const glowOpacity = Math.min(energy * 1.2, 1);
  const glowSpread = Math.round(energy * 20);
  const glowBlur = Math.round(energy * 30);
  const glowShadow = energy > 0.05
    ? `0 0 ${glowBlur}px ${glowSpread}px ${chapter.color}${Math.round(glowOpacity * 80).toString(16).padStart(2, '0')}`
    : 'none';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: '10px',
        border: `1px solid ${chapter.color}40`,
        backgroundColor: `${chapter.color}12`,
        padding: '12px 8px',
        minHeight: '120px',
        flex: 1,
        boxShadow: glowShadow,
        transition: 'box-shadow 0.15s ease',
        gap: '6px',
      }}
    >
      {/* Slot number + chapter indicator */}
      <div
        style={{
          fontSize: '0.6rem',
          color: chapter.color,
          letterSpacing: '0.1em',
          opacity: 0.7,
        }}
      >
        {slotIndex + 1}
      </div>

      {/* Layer symbol */}
      <div style={{ fontSize: '1.8rem', color: layer.color, lineHeight: 1 }}>
        {layer.symbol}
      </div>

      {/* Chapter icon */}
      <div style={{ fontSize: '1rem', color: chapter.color, lineHeight: 1 }}>
        {chapter.icon}
      </div>

      {/* Fragment display name */}
      <div
        style={{
          fontSize: '0.6rem',
          color: 'rgba(255,255,255,0.6)',
          textAlign: 'center',
          lineHeight: 1.3,
          letterSpacing: '0.04em',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {slot.fragment.displayName}
      </div>

      {/* Steward indicator */}
      <div
        style={{
          fontSize: '0.55rem',
          color: chapter.color,
          letterSpacing: '0.08em',
          opacity: 0.8,
          backgroundColor: `${chapter.color}20`,
          borderRadius: '4px',
          padding: '2px 5px',
        }}
      >
        STEWARD
      </div>
    </div>
  );
}

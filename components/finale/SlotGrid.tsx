/**
 * SlotGrid
 *
 * Projector component. Arranges 7 SlotCards in a horizontal row.
 * Energy levels for each slot come from the dedicated 'meter' socket event
 * (NOT state_sync), passed in from the parent as a Map<slotIndex, energy>.
 */

'use client';

import type { ActiveSlot } from '@/conductor/types';
import { SlotCard } from './SlotCard';

export interface SlotGridProps {
  activeSlots: (ActiveSlot | null)[];
  /** slotIndex → energy (0.0–1.0). Missing entries default to 0. */
  meterLevels: Map<number, number>;
}

export function SlotGrid({ activeSlots, meterLevels }: SlotGridProps) {
  // Ensure we always render exactly 7 slots
  const slots: (ActiveSlot | null)[] = Array.from({ length: 7 }, (_, i) => activeSlots[i] ?? null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '8px',
        width: '100%',
      }}
    >
      {slots.map((slot, i) => (
        <SlotCard
          key={i}
          slot={slot}
          energy={meterLevels.get(i) ?? 0}
          slotIndex={i}
        />
      ))}
    </div>
  );
}

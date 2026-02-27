/**
 * Audio Metering Service
 *
 * Receives RMS energy levels from M4L envelope follower devices via OSC
 * and broadcasts per-slot levels to the projector for glow/pulse animations.
 *
 * Data flow:
 *   M4L (15–30 Hz per slot) → OSC → updateSlotLevel() → projector 'meter' event (~10 Hz)
 *
 * OSC address format: /meter/slot/<N>  (N = 0–6)
 *
 * Phase 3 stub: OSC wiring happens in Phase 4. The MeteringService interface
 * is ready; call updateSlotLevel() from the OSC handler when available.
 */

import { Server as SocketIOServer } from 'socket.io';

export interface SlotMeterLevel {
  slotIndex: number;
  energy: number;   // 0.0–1.0 RMS
}

export interface MeteringService {
  /** Called by the OSC handler (Phase 4) with each incoming meter message. */
  updateSlotLevel(slotIndex: number, energy: number): void;
  dispose(): void;
}

const METER_BROADCAST_INTERVAL_MS = 100;  // ~10 Hz
const SLOT_COUNT = 7;

/**
 * Create the metering service.
 *
 * Aggregates incoming per-slot energy levels and broadcasts
 * a consolidated 'meter' event to the projector room at ~10 Hz.
 */
export function createMeteringService(io: SocketIOServer): MeteringService {
  // Current energy level per slot
  const levels: number[] = new Array(SLOT_COUNT).fill(0);
  let dirty = false;

  const broadcastInterval = setInterval(() => {
    if (!dirty) return;
    dirty = false;

    const slots: SlotMeterLevel[] = levels.map((energy, slotIndex) => ({
      slotIndex,
      energy,
    }));

    io.to('projector').emit('meter', { slots });
  }, METER_BROADCAST_INTERVAL_MS);

  return {
    updateSlotLevel(slotIndex: number, energy: number): void {
      if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return;
      levels[slotIndex] = Math.max(0, Math.min(1, energy));
      dirty = true;
    },

    dispose(): void {
      clearInterval(broadcastInterval);
    },
  };
}

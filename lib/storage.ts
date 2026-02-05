/**
 * Client Identity Storage
 *
 * Manages localStorage for user reconnection across browser refreshes.
 * Each client stores their userId, showId, seatId, and last known version.
 */

import type { StoredClientIdentity, UserId, ShowId, SeatId } from '@/conductor/types';

const STORAGE_KEY = 'yggdrasil:client';

/**
 * Generate a unique user ID
 */
export function generateUserId(): UserId {
  return `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load client identity from localStorage
 */
export function loadClientIdentity(): StoredClientIdentity | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return parsed as StoredClientIdentity;
  } catch (err) {
    console.error('[Storage] Failed to load client identity:', err);
    return null;
  }
}

/**
 * Save client identity to localStorage
 */
export function saveClientIdentity(identity: StoredClientIdentity): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch (err) {
    console.error('[Storage] Failed to save client identity:', err);
  }
}

/**
 * Update only the lastVersion field
 */
export function updateLastVersion(version: number): void {
  const identity = loadClientIdentity();
  if (identity) {
    saveClientIdentity({ ...identity, lastVersion: version });
  }
}

/**
 * Clear client identity (for testing/reset)
 */
export function clearClientIdentity(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get or create client identity
 * If no identity exists, creates a new one with the provided params
 */
export function getOrCreateIdentity(
  showId: ShowId,
  seatId: SeatId | null = null
): StoredClientIdentity {
  let identity = loadClientIdentity();

  if (!identity) {
    identity = {
      userId: generateUserId(),
      showId,
      seatId,
      lastVersion: 0,
    };
    saveClientIdentity(identity);
  }

  // Update showId and seatId if they've changed
  if (identity.showId !== showId || identity.seatId !== seatId) {
    identity = {
      ...identity,
      showId,
      seatId: seatId || identity.seatId,
    };
    saveClientIdentity(identity);
  }

  return identity;
}

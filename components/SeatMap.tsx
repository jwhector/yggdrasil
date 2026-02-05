/**
 * SeatMap Component
 *
 * Visualizes joined users by seat during lobby phase.
 * Shows faction colors after assignment.
 */

'use client';

import type { User, Faction, SeatId } from '@/conductor/types';

export interface SeatMapProps {
  users: Map<string, User>;
  factions: Faction[];
  /** Whether factions have been assigned */
  assigned: boolean;
}

export function SeatMap({ users, factions, assigned }: SeatMapProps) {
  // Group users by seat
  const usersBySeat = new Map<SeatId, User>();
  users.forEach((user) => {
    if (user.seatId) {
      usersBySeat.set(user.seatId, user);
    }
  });

  // Get unique seats (sorted)
  const seats = Array.from(usersBySeat.keys()).sort();

  // If no seats, show a message
  if (seats.length === 0) {
    return (
      <div style={styles.emptyState}>
        <p style={{ color: '#666', margin: 0 }}>No users joined yet</p>
      </div>
    );
  }

  // Get faction color for a user
  const getFactionColor = (user: User): string => {
    if (!assigned || user.faction === null) return '#e5e5e5';
    return factions[user.faction]?.color || '#e5e5e5';
  };

  // Get faction name for a user
  const getFactionName = (user: User): string | null => {
    if (!assigned || user.faction === null) return null;
    return factions[user.faction]?.name || null;
  };

  return (
    <div style={styles.container}>
      <div style={styles.grid}>
        {seats.map((seatId) => {
          const user = usersBySeat.get(seatId)!;
          const factionColor = getFactionColor(user);
          const factionName = getFactionName(user);

          return (
            <div key={seatId} style={styles.seatCard}>
              <div
                style={{
                  ...styles.seatIndicator,
                  backgroundColor: factionColor,
                }}
              />
              <div style={styles.seatInfo}>
                <div style={styles.seatId}>{seatId}</div>
                {factionName && (
                  <div style={styles.factionName}>{factionName}</div>
                )}
                {!user.connected && (
                  <div style={styles.disconnectedBadge}>Offline</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <strong>{users.size}</strong> total users
        </div>
        <div style={styles.summaryItem}>
          <strong>{seats.length}</strong> with seats
        </div>
        {assigned && (
          <div style={styles.summaryItem}>
            <strong>Factions assigned</strong>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
  } as React.CSSProperties,

  emptyState: {
    padding: '2rem',
    textAlign: 'center' as const,
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '0.75rem',
  } as React.CSSProperties,

  seatCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  seatIndicator: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    flexShrink: 0,
  } as React.CSSProperties,

  seatInfo: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,

  seatId: {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: '#111',
  } as React.CSSProperties,

  factionName: {
    fontSize: '0.75rem',
    color: '#666',
    marginTop: '0.125rem',
  } as React.CSSProperties,

  disconnectedBadge: {
    fontSize: '0.625rem',
    color: '#dc2626',
    fontWeight: 500,
    marginTop: '0.125rem',
  } as React.CSSProperties,

  summary: {
    display: 'flex',
    gap: '1.5rem',
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  summaryItem: {
    fontSize: '0.875rem',
    color: '#666',
  } as React.CSSProperties,
};

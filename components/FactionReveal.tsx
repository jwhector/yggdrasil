/**
 * FactionReveal Component
 *
 * Personal faction reveal animation shown to audience members
 * when factions are assigned.
 */

'use client';

import { useEffect, useState } from 'react';
import type { FactionId } from '@/conductor/types';

interface FactionRevealProps {
  faction: FactionId | null;
}

const FACTION_NAMES = ['North', 'South', 'East', 'West'];
const FACTION_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];

export function FactionReveal({ faction }: FactionRevealProps) {
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    // Animate in after a brief delay
    const timer = setTimeout(() => setIsRevealed(true), 300);
    return () => clearTimeout(timer);
  }, []);

  if (faction === null) {
    return (
      <div style={styles.container}>
        <p style={styles.message}>Assigning factions...</p>
      </div>
    );
  }

  const factionName = FACTION_NAMES[faction];
  const factionColor = FACTION_COLORS[faction];

  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.revealCard,
          transform: isRevealed ? 'scale(1)' : 'scale(0.8)',
          opacity: isRevealed ? 1 : 0,
          transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <p style={styles.subtitle}>You are</p>
        <div
          style={{
            ...styles.factionBadge,
            backgroundColor: factionColor,
            boxShadow: `0 0 40px ${factionColor}80`,
          }}
        >
          <h1 style={styles.factionName}>{factionName}</h1>
        </div>
        <p style={styles.description}>
          Work together with your faction to build the song through alignment.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    minHeight: '60vh',
  },
  message: {
    fontSize: '1.5rem',
    color: '#a3a3a3',
  },
  revealCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '2rem',
    padding: '3rem',
    maxWidth: '500px',
  },
  subtitle: {
    fontSize: '1.25rem',
    color: '#a3a3a3',
    margin: 0,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  factionBadge: {
    padding: '2rem 3rem',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  factionName: {
    fontSize: '3rem',
    fontWeight: 'bold' as const,
    margin: 0,
    color: '#ffffff',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  description: {
    fontSize: '1rem',
    color: '#a3a3a3',
    textAlign: 'center' as const,
    lineHeight: 1.6,
    margin: 0,
  },
};

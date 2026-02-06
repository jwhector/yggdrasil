/**
 * CoupMeter Component
 *
 * Displayed only during coup_window phase.
 * Shows faction's progress toward coup threshold.
 * Only visible to members of the faction.
 */

'use client';

import { useState } from 'react';
import type { FactionId, ConductorCommand } from '@/conductor/types';

interface CoupMeterProps {
  faction: FactionId | null;
  coupMeter: number | null; // 0-1 progress, null if not in coup window
  canCoup: boolean;
  sendCommand: (command: ConductorCommand) => void;
}

const FACTION_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const FACTION_NAMES = ['North', 'South', 'East', 'West'];

export function CoupMeter({ faction, coupMeter, canCoup, sendCommand }: CoupMeterProps) {
  const [hasVoted, setHasVoted] = useState(false);

  if (faction === null || coupMeter === null) {
    return null;
  }

  const factionColor = FACTION_COLORS[faction];
  const factionName = FACTION_NAMES[faction];
  const progress = Math.min(coupMeter * 100, 100);

  const handleCoupVote = () => {
    if (!canCoup || hasVoted) return;

    setHasVoted(true);
    sendCommand({
      type: 'SUBMIT_COUP_VOTE',
      userId: '', // Will be filled by socket handler
    });
  };

  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.card,
          borderColor: factionColor,
        }}
      >
        <h3 style={styles.title}>Faction {factionName} — Coup Opportunity</h3>

        <p style={styles.description}>
          {canCoup
            ? 'Your faction can restart this row with a voting advantage. This can only be used once per show.'
            : 'Your faction has already used its coup this show.'}
        </p>

        {/* Progress bar */}
        <div style={styles.progressContainer}>
          <div
            style={{
              ...styles.progressBar,
              width: `${progress}%`,
              backgroundColor: factionColor,
            }}
          />
        </div>

        <p style={styles.progressText}>
          {Math.round(progress)}% of faction voting to coup
        </p>

        {/* Vote button */}
        <button
          style={{
            ...styles.coupButton,
            backgroundColor: canCoup && !hasVoted ? factionColor : '#404040',
            cursor: canCoup && !hasVoted ? 'pointer' : 'not-allowed',
            opacity: canCoup && !hasVoted ? 1 : 0.5,
          }}
          onClick={handleCoupVote}
          disabled={!canCoup || hasVoted}
        >
          {hasVoted ? 'Coup Vote Submitted' : canCoup ? 'Vote to Coup' : 'Coup Already Used'}
        </button>

        <p style={styles.warning}>
          ⚠️ Hidden from other factions. If triggered, row restarts with your faction's coherence weighted higher.
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
    padding: '2rem',
    maxWidth: '600px',
    width: '100%',
  },
  card: {
    width: '100%',
    padding: '2rem',
    backgroundColor: '#171717',
    border: '2px solid',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.5rem',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 'bold' as const,
    margin: 0,
    color: '#f5f5f5',
    textAlign: 'center' as const,
  },
  description: {
    fontSize: '0.875rem',
    color: '#a3a3a3',
    margin: 0,
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
  progressContainer: {
    width: '100%',
    height: '12px',
    backgroundColor: '#262626',
    borderRadius: '6px',
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  progressBar: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '6px',
  },
  progressText: {
    fontSize: '0.875rem',
    color: '#a3a3a3',
    margin: 0,
    textAlign: 'center' as const,
  },
  coupButton: {
    width: '100%',
    padding: '1rem',
    fontSize: '1.125rem',
    fontWeight: '600' as const,
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    transition: 'all 0.2s',
  },
  warning: {
    fontSize: '0.75rem',
    color: '#737373',
    margin: 0,
    textAlign: 'center' as const,
    lineHeight: 1.4,
  },
};

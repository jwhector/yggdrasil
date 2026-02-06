/**
 * VoteInterface Component
 *
 * Two-vote drag interaction:
 * - Faction vote (colored based on user's faction)
 * - Personal vote (neutral gray)
 *
 * Users can drag both votes to any of the 4 options.
 * Can vote same option for both.
 */

'use client';

import { useState, useEffect } from 'react';
import type { Option, FactionId, OptionId, ConductorCommand } from '@/conductor/types';

interface VoteInterfaceProps {
  options: Option[];
  rowIndex: number;
  myVote: { factionVote: OptionId; personalVote: OptionId } | null;
  faction: FactionId | null;
  sendCommand: (command: ConductorCommand) => void;
}

const FACTION_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];

export function VoteInterface({
  options,
  rowIndex,
  myVote,
  faction,
  sendCommand,
}: VoteInterfaceProps) {
  const [factionVote, setFactionVote] = useState<OptionId | null>(
    myVote?.factionVote || null
  );
  const [personalVote, setPersonalVote] = useState<OptionId | null>(
    myVote?.personalVote || null
  );

  // Update local state when myVote changes (e.g., from server sync)
  useEffect(() => {
    if (myVote) {
      setFactionVote(myVote.factionVote);
      setPersonalVote(myVote.personalVote);
    }
  }, [myVote]);

  const factionColor = faction !== null ? FACTION_COLORS[faction] : '#737373';

  const handleVoteSubmit = () => {
    if (!factionVote || !personalVote) return;

    sendCommand({
      type: 'SUBMIT_VOTE',
      userId: '', // Will be filled by socket handler
      factionVote,
      personalVote,
    });
  };

  const canSubmit = factionVote && personalVote;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Vote</h2>

      {/* Instructions */}
      <div style={styles.instructions}>
        <div style={styles.instructionRow}>
          <div
            style={{
              ...styles.voteBadge,
              backgroundColor: factionColor,
            }}
          >
            F
          </div>
          <span style={styles.instructionText}>Faction vote (collective)</span>
        </div>
        <div style={styles.instructionRow}>
          <div
            style={{
              ...styles.voteBadge,
              backgroundColor: '#737373',
            }}
          >
            P
          </div>
          <span style={styles.instructionText}>Personal vote (private)</span>
        </div>
      </div>

      {/* Options grid */}
      <div style={styles.optionsGrid}>
        {options.map((option, index) => {
          const hasFactionVote = factionVote === option.id;
          const hasPersonalVote = personalVote === option.id;

          return (
            <div
              key={option.id}
              style={{
                ...styles.optionCard,
                border: hasFactionVote || hasPersonalVote ? '2px solid #ffffff' : '2px solid #404040',
              }}
              onClick={() => {
                // Simple click interface: first click = faction vote, second click = personal vote
                if (!factionVote) {
                  setFactionVote(option.id);
                } else if (!personalVote) {
                  setPersonalVote(option.id);
                } else {
                  // Reset and start over
                  setFactionVote(option.id);
                  setPersonalVote(null);
                }
              }}
            >
              <div style={styles.optionNumber}>{index + 1}</div>

              {/* Vote indicators */}
              <div style={styles.voteIndicators}>
                {hasFactionVote && (
                  <div
                    style={{
                      ...styles.voteIndicator,
                      backgroundColor: factionColor,
                    }}
                  >
                    F
                  </div>
                )}
                {hasPersonalVote && (
                  <div
                    style={{
                      ...styles.voteIndicator,
                      backgroundColor: '#737373',
                    }}
                  >
                    P
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit button */}
      <button
        style={{
          ...styles.submitButton,
          opacity: canSubmit ? 1 : 0.5,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
        onClick={handleVoteSubmit}
        disabled={!canSubmit}
      >
        {myVote ? 'Update Vote' : 'Submit Vote'}
      </button>

      {/* Helper text */}
      <p style={styles.helperText}>
        Tap an option once for faction vote, tap again for personal vote.
        {myVote && ' You can update your vote until voting closes.'}
      </p>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '1.5rem',
    padding: '2rem',
    maxWidth: '600px',
    width: '100%',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold' as const,
    margin: 0,
    color: '#f5f5f5',
  },
  instructions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
    width: '100%',
    padding: '1rem',
    backgroundColor: '#171717',
    borderRadius: '8px',
  },
  instructionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  voteBadge: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontWeight: 'bold' as const,
    fontSize: '0.875rem',
  },
  instructionText: {
    fontSize: '0.875rem',
    color: '#a3a3a3',
  },
  optionsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
    width: '100%',
  },
  optionCard: {
    padding: '2rem 1rem',
    borderRadius: '12px',
    backgroundColor: '#262626',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    minHeight: '120px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    position: 'relative' as const,
  },
  optionNumber: {
    fontSize: '2.5rem',
    fontWeight: 'bold' as const,
    color: '#ffffff',
  },
  voteIndicators: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  voteIndicator: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontWeight: 'bold' as const,
    fontSize: '0.75rem',
  },
  submitButton: {
    width: '100%',
    padding: '1rem',
    fontSize: '1.125rem',
    fontWeight: '600' as const,
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    transition: 'all 0.2s',
    marginTop: '1rem',
  },
  helperText: {
    fontSize: '0.875rem',
    color: '#737373',
    textAlign: 'center' as const,
    margin: 0,
    lineHeight: 1.5,
  },
};

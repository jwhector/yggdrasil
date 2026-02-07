/**
 * AuditionVoteInterface Component
 *
 * Combined audition display and voting interface.
 * Users can vote while listening to options being played.
 *
 * Vote selection uses an animated popover:
 * - Tap an option → popover appears with "Faction Vote" / "Personal Vote" buttons
 * - User selects vote type → popover dismisses, vote recorded
 * - Both votes can be placed on same or different options
 */

'use client';

import { useState, useEffect } from 'react';
import type { Option, FactionId, OptionId, ConductorCommand } from '@/conductor/types';

interface AuditionVoteInterfaceProps {
  options: Option[];
  rowIndex: number;
  currentAuditionIndex: number | null;
  auditionComplete: boolean;
  myVote: { factionVote: OptionId; personalVote: OptionId } | null;
  faction: FactionId | null;
  sendCommand: (command: ConductorCommand) => void;
}

const FACTION_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];

export function AuditionVoteInterface({
  options,
  rowIndex,
  currentAuditionIndex,
  auditionComplete,
  myVote,
  faction,
  sendCommand,
}: AuditionVoteInterfaceProps) {
  const [factionVote, setFactionVote] = useState<OptionId | null>(
    myVote?.factionVote || null
  );
  const [personalVote, setPersonalVote] = useState<OptionId | null>(
    myVote?.personalVote || null
  );
  const [popoverOption, setPopoverOption] = useState<OptionId | null>(null);

  // Update local state when myVote changes (e.g., from server sync)
  useEffect(() => {
    if (myVote) {
      setFactionVote(myVote.factionVote);
      setPersonalVote(myVote.personalVote);
    }
  }, [myVote]);

  // Auto-submit votes when both are selected
  useEffect(() => {
    if (factionVote && personalVote) {
      sendCommand({
        type: 'SUBMIT_VOTE',
        userId: '', // Ignored by server - uses socket session
        factionVote,
        personalVote,
      });
    }
  }, [factionVote, personalVote, sendCommand]);

  const factionColor = faction !== null ? FACTION_COLORS[faction] : '#737373';

  const handleOptionTap = (optionId: OptionId) => {
    setPopoverOption(optionId);
  };

  const handleFactionVoteSelect = () => {
    if (popoverOption) {
      setFactionVote(popoverOption);
      setPopoverOption(null);
    }
  };

  const handlePersonalVoteSelect = () => {
    if (popoverOption) {
      setPersonalVote(popoverOption);
      setPopoverOption(null);
    }
  };

  const handlePopoverClose = () => {
    setPopoverOption(null);
  };

  const bothVotesSelected = factionVote && personalVote;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>
        {auditionComplete ? 'Vote Now!' : 'Listen & Vote'}
      </h2>

      {/* Status indicator */}
      {bothVotesSelected && (
        <div style={styles.savedIndicator}>
          ✓ Votes saved
        </div>
      )}

      {/* Now playing indicator */}
      {currentAuditionIndex !== null && (
        <div style={styles.nowPlaying}>
          Now playing: Option {(currentAuditionIndex % 4) + 1}
        </div>
      )}

      {/* Vote instructions */}
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
          const isPlaying = index === (currentAuditionIndex ?? -1) % 4;

          return (
            <div
              key={option.id}
              style={{
                ...styles.optionCard,
                border: hasFactionVote || hasPersonalVote ? '2px solid #ffffff' : '2px solid #404040',
                boxShadow: isPlaying ? '0 0 30px #3b82f680' : 'none',
                transform: isPlaying ? 'scale(1.02)' : 'scale(1)',
              }}
              onClick={() => handleOptionTap(option.id)}
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

              {/* Playing indicator */}
              {isPlaying && (
                <div style={styles.playingIndicator}>♪</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Helper text */}
      <p style={styles.helperText}>
        Tap an option to choose faction or personal vote. Votes save automatically.
      </p>

      {/* Vote selection popover */}
      {popoverOption && (
        <>
          {/* Backdrop */}
          <div style={styles.backdrop} onClick={handlePopoverClose} />

          {/* Popover */}
          <div style={styles.popover}>
            <div style={styles.popoverContent}>
              <div style={styles.popoverTitle}>
                Option {options.findIndex(o => o.id === popoverOption) + 1}
              </div>

              <button
                style={{
                  ...styles.popoverButton,
                  backgroundColor: factionColor,
                }}
                onClick={handleFactionVoteSelect}
              >
                Faction Vote
              </button>

              <button
                style={{
                  ...styles.popoverButton,
                  backgroundColor: '#737373',
                }}
                onClick={handlePersonalVoteSelect}
              >
                Personal Vote
              </button>
            </div>
          </div>
        </>
      )}
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
    position: 'relative' as const,
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold' as const,
    margin: 0,
    color: '#f5f5f5',
  },
  savedIndicator: {
    fontSize: '0.875rem',
    color: '#4ade80',
    fontWeight: '600' as const,
    padding: '0.5rem 1rem',
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
    borderRadius: '8px',
    border: '1px solid #4ade80',
  },
  nowPlaying: {
    fontSize: '1rem',
    color: '#3b82f6',
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '0.5rem 1rem',
    backgroundColor: '#1e3a5f',
    borderRadius: '8px',
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
  playingIndicator: {
    position: 'absolute' as const,
    top: '8px',
    right: '8px',
    fontSize: '1.5rem',
    animation: 'pulse 1s ease-in-out infinite',
  },
  helperText: {
    fontSize: '0.875rem',
    color: '#737373',
    textAlign: 'center' as const,
    margin: 0,
    lineHeight: 1.5,
    marginTop: '1rem',
  },
  backdrop: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 1000,
    animation: 'fadeIn 0.2s ease-out',
  },
  popover: {
    position: 'fixed' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 1001,
    animation: 'popoverIn 0.2s ease-out',
  },
  popoverContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 10px 50px rgba(0, 0, 0, 0.5)',
    border: '2px solid #404040',
    minWidth: '280px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
  },
  popoverTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold' as const,
    color: '#f5f5f5',
    textAlign: 'center' as const,
    marginBottom: '0.5rem',
  },
  popoverButton: {
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600' as const,
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};

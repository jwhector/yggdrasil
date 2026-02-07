'use client';

/**
 * Audience Page
 *
 * This page is accessed via seat-specific QR codes: /audience?seat=<seatId>
 *
 * States:
 * - Lobby: Fig tree prompt input, waiting for show to start
 * - Assigning: Faction reveal animation
 * - Running: Vote interface, coup meter
 * - Finale: Watching personal timelines
 */

import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { FigTreeInput } from '@/components/FigTreeInput';
import { WaitingState } from '@/components/WaitingState';
import { FactionReveal } from '@/components/FactionReveal';
import { AuditionVoteInterface } from '@/components/AuditionVoteInterface';
import { CoupMeter } from '@/components/CoupMeter';
import type { AudienceClientState } from '@/conductor/types';

// TODO: Get from environment or config
const SHOW_ID = 'default-show';

export default function AudiencePage() {
  const searchParams = useSearchParams();
  const seatId = searchParams.get('seat');

  const { socket, connectionState, userId } = useSocket({
    showId: SHOW_ID,
    seatId: seatId || undefined,
    mode: 'audience',
  });

  const { state, sendCommand, isLoading } = useShowState(
    socket,
    'audience',
    userId
  );

  const audienceState = state as AudienceClientState | null;

  // Connection status color
  const connectionColor =
    connectionState === 'connected'
      ? '#4ade80'
      : connectionState === 'connecting' || connectionState === 'reconnecting'
      ? '#fbbf24'
      : '#f87171';

  // Loading state
  if (isLoading || !audienceState) {
    return (
      <main style={styles.container}>
        <div style={styles.connectionIndicator}>
          <div
            style={{
              ...styles.connectionDot,
              backgroundColor: connectionColor,
            }}
          />
          <span style={styles.connectionText}>
            {connectionState === 'connected' ? 'Connected' : 'Connecting...'}
          </span>
        </div>
        <div style={styles.loadingText}>Loading...</div>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      {/* Connection indicator */}
      <div style={styles.connectionIndicator}>
        <div
          style={{
            ...styles.connectionDot,
            backgroundColor: connectionColor,
          }}
        />
      </div>

      {/* Render based on show phase */}
      {audienceState.showPhase === 'lobby' && (
        <>
          {!audienceState.figTreeResponseSubmitted ? (
            <FigTreeInput sendCommand={sendCommand} />
          ) : (
            <WaitingState />
          )}
        </>
      )}

      {audienceState.showPhase === 'assigning' && (
        <FactionReveal faction={audienceState.faction} />
      )}

      {audienceState.showPhase === 'running' && audienceState.currentRow && (
        <>
          {/* Show combined audition and vote interface during voting phase */}
          {audienceState.currentRow.phase === 'voting' && (
            <AuditionVoteInterface
              options={audienceState.currentRow.options}
              rowIndex={audienceState.currentRow.index}
              currentAuditionIndex={audienceState.currentRow.currentAuditionIndex}
              auditionComplete={audienceState.currentRow.auditionComplete}
              myVote={audienceState.myVote}
              faction={audienceState.faction}
              sendCommand={sendCommand}
            />
          )}

          {/* Show coup meter during coup window */}
          {audienceState.currentRow.phase === 'coup_window' && (
            <CoupMeter
              faction={audienceState.faction}
              coupMeter={audienceState.coupMeter}
              canCoup={audienceState.canCoup}
              sendCommand={sendCommand}
            />
          )}

          {/* Show waiting during reveal and committed phases */}
          {(audienceState.currentRow.phase === 'revealing' ||
            audienceState.currentRow.phase === 'committed') && (
            <WaitingState message="Watch the projector..." />
          )}
        </>
      )}

      {audienceState.showPhase === 'finale' && (
        <WaitingState message="Watch the projector for your personal timeline..." />
      )}

      {audienceState.showPhase === 'paused' && (
        <WaitingState message="Show paused" />
      )}

      {audienceState.showPhase === 'ended' && (
        <WaitingState message="Thank you for participating!" />
      )}
    </main>
  );
}

const styles = {
  container: {
    padding: '1rem',
    fontFamily: 'system-ui',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
    color: '#f5f5f5',
  },
  connectionIndicator: {
    position: 'absolute' as const,
    top: '1rem',
    right: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  connectionDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },
  connectionText: {
    fontSize: '0.875rem',
    color: '#a3a3a3',
  },
  loadingText: {
    fontSize: '1.25rem',
    color: '#a3a3a3',
  },
};

'use client';

/**
 * Projector Page
 *
 * Full-screen display for projection. Shows:
 * - Lobby: Thematic text (Fig Tree excerpt)
 * - Assigning: Room-wide faction reveal animation
 * - Running: Song Tree with dual paths, reveals, tiebreakers
 * - Finale: Popular path song, then individual timelines
 */

import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import type { ProjectorClientState } from '@/conductor/types';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { SongTree } from '@/components/SongTree';
import { PhaseIndicator } from '@/components/PhaseIndicator';
import { useEffect } from 'react';

// TODO: Import these once implemented
// import { FactionRevealAnimation } from '@/components/FactionRevealAnimation';
// import { RevealDisplay } from '@/components/RevealDisplay';
// import { TiebreakerAnimation } from '@/components/TiebreakerAnimation';
// import { CoupAnimation } from '@/components/CoupAnimation';
// import { FinaleDisplay } from '@/components/FinaleDisplay';

const SHOW_ID = 'default-show'; // TODO: Get from URL or config

export default function ProjectorPage() {
  // Connect to server
  const { socket, connectionState, userId } = useSocket({
    showId: SHOW_ID,
    seatId: null,
    mode: 'projector',
  });

  // Get show state
  const { state, isLoading } = useShowState(socket, 'projector', userId);
  const projectorState = state as ProjectorClientState | null;

  // Log the projector state every time it changes
  useEffect(() => {
    if (projectorState) {
      console.log('[Projector] State updated:', projectorState);
    }
  }, [projectorState]);

  // Connection status styles
  const connectionBadgeStyle: React.CSSProperties = {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    padding: '0.5rem 1rem',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 'bold',
    backgroundColor: connectionState === 'connected' ? '#22c55e' : '#ef4444',
    color: '#fff',
    zIndex: 1000,
  };

  const mainStyle: React.CSSProperties = {
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#000',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    overflow: 'hidden',
  };

  // Show loading state
  if (isLoading || !projectorState) {
    return (
      <main style={mainStyle}>
        <div style={connectionBadgeStyle}>
          {connectionState === 'connected' ? 'Connected' : 'Connecting...'}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontSize: '2rem',
          color: '#666',
        }}>
          Loading...
        </div>
      </main>
    );
  }

  const { showPhase } = projectorState;

  return (
    <main style={mainStyle}>
      {/* Connection status indicator */}
      <div style={connectionBadgeStyle}>
        {connectionState === 'connected' ? '●' : '○'} {connectionState}
      </div>

      {/* Phase-based rendering */}
      {showPhase === 'lobby' && (
        <LobbyDisplay
          content={(projectorState as any).config?.lobby?.projectorContent || 'Welcome to Yggdrasil'}
          userCount={(projectorState as any).userCount || 0}
        />
      )}

      {showPhase === 'assigning' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '2rem',
        }}>
          <h1 style={{ fontSize: '3rem', textAlign: 'center' }}>Faction Assignment</h1>
          <p style={{ color: '#666', fontSize: '1.5rem' }}>
            TODO: FactionRevealAnimation component
          </p>
        </div>
      )}

      {showPhase === 'running' && (
        <>
          <PhaseIndicator
            phase={projectorState.rows[projectorState.currentRowIndex]?.phase || 'pending'}
            currentAuditionIndex={projectorState.rows[projectorState.currentRowIndex]?.currentAuditionIndex}
            auditionComplete={projectorState.rows[projectorState.currentRowIndex]?.auditionComplete || false}
            rowIndex={projectorState.currentRowIndex}
            rowLabel={(projectorState as any).config?.rows[projectorState.currentRowIndex]?.label || `Row ${projectorState.currentRowIndex}`}
          />
          <SongTree
            rows={projectorState.rows}
            paths={projectorState.paths}
            currentRowIndex={projectorState.currentRowIndex}
            config={(projectorState as any).config}
          />
        </>
      )}

      {showPhase === 'finale' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '2rem',
        }}>
          <h1 style={{ fontSize: '3rem', textAlign: 'center' }}>Finale</h1>
          <p style={{ color: '#666', fontSize: '1.5rem' }}>
            TODO: FinaleDisplay component
          </p>
        </div>
      )}

      {showPhase === 'ended' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '2rem',
        }}>
          <h1 style={{ fontSize: '3rem', textAlign: 'center' }}>Show Ended</h1>
          <p style={{ color: '#666', fontSize: '1.5rem' }}>
            Thank you!
          </p>
        </div>
      )}

      {showPhase === 'paused' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '2rem',
        }}>
          <h1 style={{ fontSize: '3rem', textAlign: 'center' }}>Paused</h1>
          <p style={{ color: '#666', fontSize: '1.5rem' }}>
            Show is paused
          </p>
        </div>
      )}
    </main>
  );
}

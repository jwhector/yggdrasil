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

// TODO: Import these once implemented
// import { useSocket } from '@/hooks/useSocket';
// import { useShowState } from '@/hooks/useShowState';
// import { SongTree } from '@/components/SongTree';
// import { TiebreakerAnimation } from '@/components/TiebreakerAnimation';
// import { FinaleTimeline } from '@/components/FinaleTimeline';

export default function ProjectorPage() {
  return (
    <main style={{ 
      padding: '2rem', 
      fontFamily: 'system-ui',
      minHeight: '100vh',
      backgroundColor: '#000',
      color: '#fff',
    }}>
      <h1 style={{ textAlign: 'center' }}>Projector</h1>
      <p style={{ textAlign: 'center', color: '#666' }}>
        Waiting for implementation...
      </p>
      
      {/* TODO: Render based on show phase */}
      {/*
      {showPhase === 'lobby' && (
        <LobbyDisplay content={config.lobby.projectorContent} />
      )}
      {showPhase === 'assigning' && <FactionRevealAnimation />}
      {showPhase === 'running' && (
        <>
          <SongTree 
            rows={rows} 
            factionPath={paths.factionPath}
            popularPath={paths.popularPath}
          />
          {tiebreaker.active && <TiebreakerAnimation />}
        </>
      )}
      {showPhase === 'finale' && <FinaleDisplay />}
      */}
    </main>
  );
}

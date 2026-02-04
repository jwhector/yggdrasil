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

// TODO: Import these once implemented
// import { useSocket } from '@/hooks/useSocket';
// import { useShowState } from '@/hooks/useShowState';
// import { FigTreeInput } from '@/components/FigTreeInput';
// import { VoteInterface } from '@/components/VoteInterface';
// import { CoupMeter } from '@/components/CoupMeter';
// import { FactionReveal } from '@/components/FactionReveal';

export default function AudiencePage() {
  // TODO: Get seat ID from URL params
  // const searchParams = useSearchParams();
  // const seatId = searchParams.get('seat');
  
  return (
    <main style={{ 
      padding: '1rem', 
      fontFamily: 'system-ui',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <h1>Audience</h1>
      <p style={{ color: '#666' }}>
        Waiting for implementation...
      </p>
      
      {/* TODO: Render based on show phase */}
      {/* 
      {showPhase === 'lobby' && <FigTreeInput />}
      {showPhase === 'assigning' && <FactionReveal />}
      {showPhase === 'running' && (
        <>
          <VoteInterface />
          <CoupMeter />
        </>
      )}
      */}
    </main>
  );
}

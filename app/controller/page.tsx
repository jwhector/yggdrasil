'use client';

/**
 * Controller Page
 * 
 * Performer's control interface. Provides:
 * - Seat map visualization (lobby)
 * - Faction assignment trigger
 * - Phase advancement
 * - Emergency controls (pause, reset, export/import)
 * - State overview
 */

// TODO: Import these once implemented
// import { useSocket } from '@/hooks/useSocket';
// import { useShowState } from '@/hooks/useShowState';

export default function ControllerPage() {
  return (
    <main style={{ 
      padding: '1rem', 
      fontFamily: 'system-ui',
      minHeight: '100vh',
    }}>
      <h1>Controller</h1>
      <p style={{ color: '#666' }}>
        Waiting for implementation...
      </p>
      
      {/* TODO: Show state overview */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Show State</h2>
        <pre style={{ 
          backgroundColor: '#f5f5f5', 
          padding: '1rem',
          borderRadius: '4px',
          overflow: 'auto',
        }}>
          {JSON.stringify({ phase: 'not connected' }, null, 2)}
        </pre>
      </section>
      
      {/* TODO: Phase controls */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Controls</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button disabled>Assign Factions</button>
          <button disabled>Advance Phase</button>
          <button disabled>Pause</button>
          <button disabled>Skip Row</button>
        </div>
      </section>
      
      {/* TODO: Emergency controls */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Emergency</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button disabled style={{ backgroundColor: '#fee' }}>Reset to Lobby</button>
          <button disabled>Export State</button>
          <button disabled>Import State</button>
        </div>
      </section>
    </main>
  );
}

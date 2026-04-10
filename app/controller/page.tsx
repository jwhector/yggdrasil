'use client';

/**
 * Controller Page
 *
 * Performer's operator console. Provides full show control, real-time metrics,
 * and emergency overrides. Accessible only after entering a passcode.
 *
 * Auth: simple client-side passcode gate. Set NEXT_PUBLIC_CONTROLLER_PASSCODE
 * in .env.local. If empty or unset, no passcode is required.
 */

import { useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { MetricsPanel } from '@/components/controller/MetricsPanel';
import { ShowControls } from '@/components/controller/ShowControls';
import { VotingControls } from '@/components/controller/VotingControls';
import { QuiltRemixControls } from '@/components/controller/QuiltRemixControls';
import { NpcControls } from '@/components/controller/NpcControls';
import { EmergencyControls } from '@/components/controller/EmergencyControls';
import { RemixController } from '@/components/finale/RemixController';

const SHOW_ID = 'default-show';
const PASSCODE = process.env.NEXT_PUBLIC_CONTROLLER_PASSCODE ?? '';

const FINALE_PHASES = new Set(['finale_elegy', 'finale_assignment', 'finale_preview', 'finale_playback']);
const V34_FINALE_PHASES = new Set(['finale_vote', 'finale_remix']);

// ---------------------------------------------------------------------------
// Entry point — passcode gate
// ---------------------------------------------------------------------------

export default function ControllerPage() {
  const [authed, setAuthed] = useState(!PASSCODE);

  if (!authed) {
    return <PasscodeGate onAuth={() => setAuthed(true)} />;
  }

  return <ControllerContent />;
}

// ---------------------------------------------------------------------------
// Main controller UI (only rendered after auth)
// ---------------------------------------------------------------------------

function ControllerContent() {
  const { socket, connectionState, userId, reconnect } = useSocket({
    showId: SHOW_ID,
    mode: 'controller',
  });

  const { state, fullState, sendCommand, isLoading } = useShowState(
    socket,
    'controller',
    userId
  );

  if (isLoading || !fullState) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingDot} />
        <span style={styles.loadingText}>
          {connectionState === 'connected' ? 'Loading state…' : connectionState}
        </span>
      </div>
    );
  }

  const { phase } = fullState;
  const isAttemptBuild = phase === 'attempt_build';
  const isFinale = FINALE_PHASES.has(phase);
  const isV34Finale = V34_FINALE_PHASES.has(phase);

  return (
    <main style={styles.container}>
      {/* Persistent status bar */}
      <MetricsPanel
        fullState={fullState}
        connectionState={connectionState}
        reconnect={reconnect}
      />

      {/* Show phase management — always visible */}
      <ShowControls fullState={fullState} sendCommand={sendCommand} />

      {/* Song-building controls — only during attempt_build */}
      {isAttemptBuild && (
        <VotingControls fullState={fullState} sendCommand={sendCommand} />
      )}

      {/* V3.3 Finale controls */}
      {isFinale && (
        <>
          <QuiltRemixControls fullState={fullState} sendCommand={sendCommand} />
          <NpcControls fullState={fullState} sendCommand={sendCommand} />
        </>
      )}

      {/* V3.4 Finale controls */}
      {isV34Finale && (
        <RemixController fullState={fullState} sendCommand={sendCommand} socket={socket} />
      )}

      {/* Test tools — simulate finale grid (always visible) */}
      <SimulateFinaleSection sendCommand={sendCommand} />

      {/* Emergency + audio — always visible */}
      <EmergencyControls
        fullState={fullState}
        rawState={state}
        sendCommand={sendCommand}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Simulate finale grid (test tool)
// ---------------------------------------------------------------------------

function SimulateFinaleSection({ sendCommand }: { sendCommand: (cmd: import('@/conductor/types').ConductorCommand) => void }) {
  const [count, setCount] = useState(24);

  return (
    <section style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 500 }}>Test:</span>
        <input
          type="number"
          min={6}
          max={72}
          value={count}
          onChange={e => setCount(Math.max(6, Math.min(72, parseInt(e.target.value) || 6)))}
          style={{
            width: 48,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#e5e7eb',
            fontSize: '0.75rem',
            textAlign: 'center',
          }}
        />
        <button
          onClick={() => sendCommand({ type: 'SIMULATE_FINALE_GRID', audienceCount: count })}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(34, 197, 94, 0.4)',
            background: 'rgba(34, 197, 94, 0.1)',
            color: '#86efac',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Simulate Finale Grid
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Passcode gate
// ---------------------------------------------------------------------------

function PasscodeGate({ onAuth }: { onAuth: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === PASSCODE) {
      onAuth();
    } else {
      setError(true);
      setValue('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div style={styles.gateScreen}>
      <form onSubmit={handleSubmit} style={styles.gateForm}>
        <div style={styles.gateTitle}>Controller</div>
        <input
          type="password"
          value={value}
          onChange={e => { setValue(e.target.value); setError(false); }}
          placeholder="Passcode"
          autoFocus
          style={{
            ...styles.gateInput,
            borderColor: error ? '#f87171' : '#444',
          }}
        />
        {error && <div style={styles.gateError}>Incorrect passcode</div>}
        <button type="submit" style={styles.gateBtn}>Enter</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#f0f0f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  loadingScreen: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },
  loadingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#444',
  },
  loadingText: {
    fontSize: '0.875rem',
    color: '#555',
    letterSpacing: '0.08em',
  },
  gateScreen: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    width: '280px',
  },
  gateTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#f0f0f0',
    textAlign: 'center' as const,
    letterSpacing: '0.1em',
    marginBottom: '8px',
  },
  gateInput: {
    padding: '14px 16px',
    backgroundColor: '#1a1a1a',
    color: '#f0f0f0',
    border: '1px solid #444',
    borderRadius: '6px',
    fontSize: '1rem',
    outline: 'none',
    textAlign: 'center' as const,
    letterSpacing: '0.15em',
  } as React.CSSProperties,
  gateError: {
    fontSize: '0.8rem',
    color: '#f87171',
    textAlign: 'center' as const,
  },
  gateBtn: {
    padding: '14px',
    backgroundColor: '#f0f0f0',
    color: '#111',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
};

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
import { LiveMixControls } from '@/components/controller/LiveMixControls';
import { NpcControls } from '@/components/controller/NpcControls';
import { EmergencyControls } from '@/components/controller/EmergencyControls';

const SHOW_ID = 'default-show';
const PASSCODE = process.env.NEXT_PUBLIC_CONTROLLER_PASSCODE ?? '';

const FINALE_PHASES = new Set(['finale_elegy', 'finale_assignment', 'finale_live_mix']);

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

      {/* Finale controls */}
      {isFinale && (
        <NpcControls fullState={fullState} sendCommand={sendCommand} />
      )}

      {/* Live mix controls — per-type overrides, locks, vote distributions */}
      {phase === 'finale_live_mix' && fullState.finaleState && (
        <LiveMixControls
          granularTypes={fullState.config.granularTypes ?? []}
          allFragments={fullState.finaleState.allFragments ?? []}
          activeFragments={(() => {
            const af = fullState.finaleState.liveMix?.activeFragments;
            if (!af) return [];
            // Serialized format: [string, string][] tuple array
            const arr = Array.isArray(af) ? af : Array.from((af as Map<string, string>).entries());
            return arr.map(([granularType, fragmentId]: [string, string]) => ({ granularType, fragmentId }));
          })()}
          lockedTypes={fullState.finaleState.liveMix?.lockedTypes ?? []}
          sendCommand={sendCommand}
          socket={socket}
        />
      )}

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

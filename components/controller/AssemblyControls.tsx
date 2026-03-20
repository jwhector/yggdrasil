/**
 * AssemblyControls
 *
 * Operator panel for finale_assembly phase. Shows group membership,
 * timer, and override controls.
 */

'use client';

import { useState } from 'react';
import { getLayerIdentity } from '@/lib/identity';
import type { ShowState, ConductorCommand, LayerType, UserId } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

interface AssemblyControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function AssemblyControls({ fullState, sendCommand }: AssemblyControlsProps) {
  const [forceUserId, setForceUserId] = useState<UserId | ''>('');
  const [forceLayerType, setForceLayerType] = useState<LayerType | ''>('');

  const fs = fullState.finaleState;
  if (!fs || fs.phase !== 'assembly') return null;

  const { assembly } = fs;
  const timerSecs = Math.ceil(assembly.timerRemaining / 1000);
  const connectedUsers = Array.from(fullState.users.entries())
    .filter(([, u]) => u.connected)
    .map(([id]) => id);

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Assembly</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: '#888' }}>
            {assembly.undecidedUsers.length} undecided
          </span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: timerSecs <= 10 ? '#f87171' : '#888', fontVariantNumeric: 'tabular-nums' }}>
            {timerSecs}s
          </span>
        </div>
      </div>

      {/* Group sizes table */}
      <div style={styles.table}>
        {LAYER_ORDER.map(type => {
          const identity = getLayerIdentity(type);
          const count = assembly.groups.get(type)?.length ?? 0;
          return (
            <div key={type} style={styles.tableRow}>
              <span style={{ color: identity.color, fontSize: '0.9rem', minWidth: '20px' }}>{identity.symbol}</span>
              <span style={{ fontSize: '0.8rem', color: '#aaa', flex: 1 }}>{identity.label}</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: count > 0 ? '#f0f0f0' : '#444' }}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Timer controls */}
      <div style={styles.buttonGrid}>
        <button onClick={() => send({ type: 'EXTEND_ASSEMBLY_TIMER', additionalMs: 30000 })} style={{ ...btn, ...btnSecondary }}>
          +30s
        </button>
        <button onClick={() => send({ type: 'EXTEND_ASSEMBLY_TIMER', additionalMs: 60000 })} style={{ ...btn, ...btnSecondary }}>
          +60s
        </button>
        <button onClick={() => send({ type: 'FORCE_END_ASSEMBLY' })} style={{ ...btn, ...btnWarning }}>
          Force End Assembly
        </button>
      </div>

      {/* Force assign user */}
      {connectedUsers.length > 0 && (
        <div style={styles.forceAssign}>
          <span style={{ fontSize: '0.7rem', color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Force Assign User
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
            <select
              value={forceUserId}
              onChange={e => setForceUserId(e.target.value as UserId)}
              style={selectStyle}
            >
              <option value="">Select user</option>
              {connectedUsers.map(uid => (
                <option key={uid} value={uid}>{uid.slice(0, 8)}…</option>
              ))}
            </select>
            <select
              value={forceLayerType}
              onChange={e => setForceLayerType(e.target.value as LayerType)}
              style={selectStyle}
            >
              <option value="">Select group</option>
              {LAYER_ORDER.map(type => {
                const identity = getLayerIdentity(type);
                return <option key={type} value={type}>{identity.symbol} {identity.label}</option>;
              })}
            </select>
            <button
              onClick={() => {
                if (forceUserId && forceLayerType) {
                  send({ type: 'FORCE_ASSIGN_USER', userId: forceUserId as UserId, layerType: forceLayerType as LayerType });
                  setForceUserId('');
                  setForceLayerType('');
                }
              }}
              disabled={!forceUserId || !forceLayerType}
              style={{ ...btn, ...(!forceUserId || !forceLayerType ? disabled : btnWarning), fontSize: '0.8rem', padding: '8px 12px', minHeight: 'auto' }}
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const btn: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  minHeight: '48px',
};
const btnSecondary: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' };
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const disabled: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#555', border: '1px solid #333', cursor: 'not-allowed', opacity: 0.5 };

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  backgroundColor: '#1a1a1a',
  color: '#f0f0f0',
  border: '1px solid #333',
  borderRadius: '6px',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

const styles = {
  section: {
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  table: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    marginBottom: '14px',
    padding: '10px',
    backgroundColor: '#111',
    borderRadius: '6px',
    border: '1px solid #222',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  buttonGrid: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginBottom: '12px',
  },
  forceAssign: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    padding: '10px',
    backgroundColor: '#111',
    borderRadius: '6px',
    border: '1px solid #222',
  },
};

/**
 * DeliberationControls
 *
 * Operator panel for finale_deliberation phase. Shows per-group vote
 * distributions, chosen fragments, ambassador status, and override controls.
 */

'use client';

import { useState } from 'react';
import { getLayerIdentity } from '@/lib/identity';
import type { ShowState, ConductorCommand, LayerType } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

interface DeliberationControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function DeliberationControls({ fullState, sendCommand }: DeliberationControlsProps) {
  const [forceSelections, setForceSelections] = useState<Partial<Record<LayerType, string>>>({});

  const fs = fullState.finaleState;
  if (!fs || fs.phase !== 'deliberation') return null;

  const { deliberation, availableFragments } = fs;
  const timerSecs = Math.ceil(deliberation.timerRemaining / 1000);
  const volunteerSecs = deliberation.volunteerTimerRemaining !== null
    ? Math.ceil(deliberation.volunteerTimerRemaining / 1000)
    : null;

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Deliberation</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {volunteerSecs !== null && (
            <span style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
              Vol: {volunteerSecs}s
            </span>
          )}
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: timerSecs <= 15 ? '#f87171' : '#888', fontVariantNumeric: 'tabular-nums' }}>
            {timerSecs}s
          </span>
        </div>
      </div>

      {/* Per-group vote distributions */}
      <div style={styles.groupList}>
        {LAYER_ORDER.map(type => {
          const identity = getLayerIdentity(type);
          const groupFragments = availableFragments.filter(f => f.layerType === type);
          const votes = deliberation.groupVotes.get(type);
          const chosen = deliberation.chosenFragments.get(type) ?? null;
          const ambassador = deliberation.ambassadors.get(type) ?? null;
          const volunteers = deliberation.ambassadorVolunteers.get(type) ?? [];

          // Tally votes
          const voteCounts = new Map<string, number>();
          if (votes) {
            for (const fId of votes.values()) {
              voteCounts.set(fId, (voteCounts.get(fId) ?? 0) + 1);
            }
          }
          const totalVotes = Array.from(voteCounts.values()).reduce((a, b) => a + b, 0);

          return (
            <div key={type} style={styles.groupRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ color: identity.color, fontSize: '1rem' }}>{identity.symbol}</span>
                <span style={{ fontSize: '0.8rem', color: '#aaa', flex: 1 }}>{identity.label}</span>
                {chosen && (
                  <span style={{ fontSize: '0.65rem', color: '#4ade80', letterSpacing: '0.05em' }}>✓ CHOSEN</span>
                )}
                {ambassador && (
                  <span style={{ fontSize: '0.65rem', color: identity.color, letterSpacing: '0.05em' }}>
                    AMB: {ambassador.slice(0, 6)}…
                  </span>
                )}
              </div>

              {/* Vote bars */}
              {groupFragments.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                  {groupFragments.map(f => {
                    const count = voteCounts.get(f.id) ?? 0;
                    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    const isChosen = chosen === f.id;
                    return (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.7rem', color: isChosen ? '#fff' : '#666', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {f.displayLabel}
                        </span>
                        <div style={{ width: '60px', height: '4px', backgroundColor: '#222', borderRadius: '2px', flexShrink: 0 }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: isChosen ? '#4ade80' : identity.color, borderRadius: '2px' }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#666', minWidth: '24px', textAlign: 'right' as const }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: '0.7rem', color: '#444' }}>No fragments</span>
              )}

              {/* Volunteer info */}
              {volunteers.length > 0 && !ambassador && (
                <span style={{ fontSize: '0.65rem', color: '#fbbf24' }}>
                  {volunteers.length} volunteer{volunteers.length !== 1 ? 's' : ''}
                </span>
              )}

              {/* Force fragment selection */}
              {!chosen && groupFragments.length > 1 && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <select
                    value={forceSelections[type] ?? ''}
                    onChange={e => setForceSelections(prev => ({ ...prev, [type]: e.target.value }))}
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    <option value="">Force fragment…</option>
                    {groupFragments.map(f => (
                      <option key={f.id} value={f.id}>{f.displayLabel}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const fId = forceSelections[type];
                      if (fId) {
                        send({ type: 'FORCE_FRAGMENT_SELECTION', layerType: type, fragmentId: fId });
                        setForceSelections(prev => ({ ...prev, [type]: '' }));
                      }
                    }}
                    disabled={!forceSelections[type]}
                    style={{ ...btn, ...(!forceSelections[type] ? disabled : btnWarning), fontSize: '0.75rem', padding: '6px 10px', minHeight: 'auto' }}
                  >
                    Force
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Timer + force controls */}
      <div style={styles.buttonGrid}>
        <button onClick={() => send({ type: 'EXTEND_DELIBERATION_TIMER', additionalMs: 30000 })} style={{ ...btn, ...btnSecondary }}>
          +30s
        </button>
        <button onClick={() => send({ type: 'EXTEND_DELIBERATION_TIMER', additionalMs: 60000 })} style={{ ...btn, ...btnSecondary }}>
          +60s
        </button>
        <button onClick={() => send({ type: 'FORCE_END_DELIBERATION' })} style={{ ...btn, ...btnWarning }}>
          Force End
        </button>
      </div>
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
  padding: '6px 8px',
  backgroundColor: '#1a1a1a',
  color: '#f0f0f0',
  border: '1px solid #333',
  borderRadius: '6px',
  fontSize: '0.75rem',
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
  groupList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    marginBottom: '14px',
  },
  groupRow: {
    padding: '10px',
    backgroundColor: '#111',
    borderRadius: '6px',
    border: '1px solid #222',
  },
  buttonGrid: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
};

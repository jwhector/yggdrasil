'use client';

/**
 * CeremonyControls — Operator panel for finale_ceremony phase.
 *
 * Shows ceremony progress, current ambassador info, and provides
 * controls to advance, force lock-in, forfeit, or skip layers.
 */

import { useState } from 'react';
import { getLayerIdentity } from '@/lib/identity';
import type { ShowState, ConductorCommand, LayerType } from '@/conductor/types';

const LAYER_TYPES: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

interface CeremonyControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function CeremonyControls({ fullState, sendCommand }: CeremonyControlsProps) {
  const [skipTarget, setSkipTarget] = useState<LayerType | ''>('');

  const fs = fullState.finaleState;
  if (!fs || fs.phase !== 'ceremony') return null;

  const { ceremony } = fs;
  const currentLayerType = ceremony.currentIndex >= 0
    ? ceremony.layerOrder[ceremony.currentIndex] ?? null
    : null;

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Ceremony</h2>
        {ceremony.ceremonyComplete && (
          <span style={{ fontSize: '0.7rem', color: '#4ade80', letterSpacing: '0.08em' }}>
            COMPLETE
          </span>
        )}
      </div>

      {/* Current ambassador info */}
      {currentLayerType && ceremony.currentAmbassador && (
        <div style={styles.ambassadorInfo}>
          <span style={{ color: getLayerIdentity(currentLayerType).color, fontSize: '1.1rem' }}>
            {getLayerIdentity(currentLayerType).symbol}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', color: '#ccc' }}>
              {getLayerIdentity(currentLayerType).label}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#666' }}>
              Ambassador: {ceremony.currentAmbassador.slice(0, 10)}...
            </div>
          </div>
          {ceremony.altarReady && (
            <span style={{ fontSize: '0.65rem', color: '#4ade80' }}>ALTAR READY</span>
          )}
        </div>
      )}

      {/* Layer progress list */}
      <div style={styles.layerList}>
        {ceremony.layerOrder.map((lt) => {
          const identity = getLayerIdentity(lt);
          const isLocked = ceremony.lockedLayers.has(lt);
          const isForfeited = ceremony.forfeitedLayers.includes(lt);
          const isCurrent = lt === currentLayerType;
          const fragmentId = ceremony.lockedLayers.get(lt);

          let statusLabel = '';
          let statusColor = '#444';
          if (isLocked) { statusLabel = 'LOCKED'; statusColor = '#4ade80'; }
          else if (isForfeited) { statusLabel = 'FORFEITED'; statusColor = '#f87171'; }
          else if (isCurrent) { statusLabel = 'CURRENT'; statusColor = identity.color; }
          else { statusLabel = 'UPCOMING'; statusColor = '#444'; }

          return (
            <div key={lt} style={styles.layerRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: identity.color, fontSize: '0.9rem' }}>{identity.symbol}</span>
                <span style={{ fontSize: '0.75rem', color: '#aaa', flex: 1 }}>{identity.label}</span>
                <span style={{ fontSize: '0.6rem', color: statusColor, letterSpacing: '0.06em' }}>
                  {statusLabel}
                </span>
              </div>

              {/* Per-layer actions (only for non-completed layers) */}
              {!isLocked && !isForfeited && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <button
                    onClick={() => send({ type: 'FORCE_LOCK_IN', layerType: lt })}
                    style={{ ...btn, ...btnWarning, fontSize: '0.7rem', padding: '4px 10px', minHeight: 'auto' }}
                  >
                    Force Lock-In
                  </button>
                  <button
                    onClick={() => send({ type: 'FORFEIT_LAYER', layerType: lt })}
                    style={{ ...btn, ...btnDanger, fontSize: '0.7rem', padding: '4px 10px', minHeight: 'auto' }}
                  >
                    Forfeit
                  </button>
                </div>
              )}

              {/* Show fragment ID for locked layers */}
              {isLocked && fragmentId && (
                <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '2px' }}>
                  {fragmentId}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div style={styles.buttonGrid}>
        {/* Call Next Ambassador */}
        <button
          onClick={() => send({ type: 'CALL_NEXT_AMBASSADOR' })}
          disabled={ceremony.ceremonyComplete}
          style={{
            ...btn,
            ...(ceremony.ceremonyComplete ? disabled : btnPrimary),
          }}
        >
          Call Next Ambassador
        </button>

        {/* Skip to layer */}
        <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
          <select
            value={skipTarget}
            onChange={e => setSkipTarget(e.target.value as LayerType | '')}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="">Skip to layer...</option>
            {ceremony.layerOrder
              .filter(lt => !ceremony.lockedLayers.has(lt) && !ceremony.forfeitedLayers.includes(lt))
              .map(lt => (
                <option key={lt} value={lt}>{getLayerIdentity(lt).label}</option>
              ))
            }
          </select>
          <button
            onClick={() => {
              if (skipTarget) {
                send({ type: 'SKIP_TO_LAYER', layerType: skipTarget as LayerType });
                setSkipTarget('');
              }
            }}
            disabled={!skipTarget}
            style={{ ...btn, ...(skipTarget ? btnSecondary : disabled), fontSize: '0.75rem', padding: '6px 12px', minHeight: 'auto' }}
          >
            Skip
          </button>
        </div>

        {/* Start Performer Mix (only when ceremony complete) */}
        {ceremony.ceremonyComplete && (
          <button
            onClick={() => send({ type: 'START_PERFORMER_MIX' })}
            style={{ ...btn, ...btnSuccess, width: '100%' }}
          >
            Start Performer Mix
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btn: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  minHeight: '48px',
};
const btnPrimary: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' };
const btnSecondary: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' };
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const btnDanger: React.CSSProperties = { backgroundColor: '#3b0a0a', color: '#f87171', border: '1px solid #7f1d1d' };
const btnSuccess: React.CSSProperties = { backgroundColor: '#052e16', color: '#4ade80', border: '1px solid #166534' };
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
  ambassadorInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: '#111',
    borderRadius: '8px',
    border: '1px solid #222',
    marginBottom: '12px',
  },
  layerList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    marginBottom: '14px',
  },
  layerRow: {
    padding: '8px 10px',
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

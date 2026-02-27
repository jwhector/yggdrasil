/**
 * DoubtControls
 *
 * Threshold management for the current layer. Only rendered during attempt_build.
 *
 * The doubt threshold determines how high consensus must be for a layer to pass.
 * null = no threshold (simple majority wins).
 * A number (0.0–1.0) = required consensus fraction.
 *
 * FORCE_CONTINUE bypasses the threshold once; FORCE_COLLAPSE ends the attempt immediately.
 */

'use client';

import { useState, useEffect } from 'react';
import type { ShowState, ConductorCommand } from '@/conductor/types';

interface DoubtControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

const PRESETS = [0.65, 0.75, 0.85, 0.90];

export function DoubtControls({ fullState, sendCommand }: DoubtControlsProps) {
  const { currentAttemptIndex, attempts } = fullState;
  const attempt = attempts[currentAttemptIndex];
  if (!attempt) return null;

  const { currentLayerIndex, currentLayerPhase, layerPlan, votes } = attempt;
  const currentLayer = layerPlan[currentLayerIndex];
  const currentThreshold = currentLayer?.doubtThreshold ?? null;

  // Local slider state — sync with current threshold when layer changes
  const [sliderValue, setSliderValue] = useState<number>(currentThreshold ?? 0.75);
  useEffect(() => {
    setSliderValue(currentThreshold ?? 0.75);
  }, [currentLayerIndex, currentThreshold]);

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  const handleSetThreshold = (value: number) => {
    setSliderValue(value);
    send({ type: 'SET_THRESHOLD', layerIndex: currentLayerIndex, threshold: value });
  };

  const handleToggleDoubt = () => {
    if (currentThreshold === null) {
      // Enable: set to current slider value
      send({ type: 'SET_THRESHOLD', layerIndex: currentLayerIndex, threshold: sliderValue });
    } else {
      // Disable: set to null
      send({ type: 'SET_THRESHOLD', layerIndex: currentLayerIndex, threshold: null });
    }
  };

  // Current vote consensus for this layer
  const layerVotes = votes.filter(v => v.layerIndex === currentLayerIndex);
  const total = layerVotes.length;
  const votesA = layerVotes.filter(v => v.choice === 'A').length;
  const votesB = layerVotes.filter(v => v.choice === 'B').length;
  const consensus = total > 0 ? Math.max(votesA, votesB) / total : null;

  const isActive = currentLayerPhase === 'voting' || currentLayerPhase === 'resolving';
  const doubtEnabled = currentThreshold !== null;

  const thresholdMet = consensus !== null && currentThreshold !== null
    ? consensus >= currentThreshold
    : null;

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Doubt Controls</h2>

      <div style={styles.layout}>
        {/* Left: threshold display + toggle */}
        <div style={styles.thresholdPanel}>
          <div style={styles.thresholdDisplay}>
            <span style={styles.thresholdLabel}>Threshold</span>
            <span style={{
              ...styles.thresholdValue,
              color: doubtEnabled ? '#fbbf24' : '#555',
            }}>
              {doubtEnabled ? `${Math.round(currentThreshold! * 100)}%` : 'OFF'}
            </span>
          </div>

          {consensus !== null && doubtEnabled && (
            <div style={styles.consensusRow}>
              <span style={styles.dimText}>Current:</span>
              <span style={{ fontWeight: 700, color: thresholdMet ? '#4ade80' : '#f87171' }}>
                {Math.round(consensus * 100)}%
              </span>
              <span style={{ color: thresholdMet ? '#4ade80' : '#f87171', fontSize: '0.8rem' }}>
                {thresholdMet ? '✓ Met' : '✗ At risk'}
              </span>
            </div>
          )}

          <button
            onClick={handleToggleDoubt}
            style={{ ...btn, ...(doubtEnabled ? btnWarning : btnSecondary) }}
            title={doubtEnabled ? 'Disable doubt threshold' : 'Enable doubt threshold'}
          >
            Doubt: {doubtEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Right: slider + presets */}
        <div style={styles.sliderPanel}>
          <div style={styles.sliderRow}>
            <span style={styles.dimText}>
              {Math.round(sliderValue * 100)}%
            </span>
            <input
              type="range"
              min={0.50}
              max={1.00}
              step={0.05}
              value={sliderValue}
              onChange={e => setSliderValue(Number(e.target.value))}
              onMouseUp={() => handleSetThreshold(sliderValue)}
              onTouchEnd={() => handleSetThreshold(sliderValue)}
              style={styles.slider}
            />
          </div>
          <div style={styles.presetRow}>
            {PRESETS.map(p => (
              <button
                key={p}
                onClick={() => handleSetThreshold(p)}
                style={{
                  ...btn,
                  ...(currentThreshold === p ? btnWarning : btnSecondary),
                  padding: '8px 12px',
                  fontSize: '0.85rem',
                }}
              >
                {Math.round(p * 100)}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Force buttons — clearly dangerous */}
      <div style={styles.forceRow}>
        <button
          onClick={() => send({ type: 'FORCE_CONTINUE' })}
          disabled={!isActive}
          style={{ ...btn, ...(!isActive ? disabled : btnWarning) }}
          title="Bypass threshold once — advance to next layer"
        >
          Force Continue
        </button>

        <button
          onClick={() => send({ type: 'FORCE_COLLAPSE' })}
          disabled={!isActive}
          style={{ ...btn, ...(!isActive ? disabled : btnDanger) }}
          title="End this attempt immediately"
        >
          Force Collapse
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
const btnDanger: React.CSSProperties = { backgroundColor: '#450a0a', color: '#f87171', border: '1px solid #7f1d1d' };
const disabled: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#555', border: '1px solid #333', cursor: 'not-allowed', opacity: 0.5 };

const styles = {
  section: {
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  layout: {
    display: 'flex',
    gap: '20px',
    marginBottom: '14px',
    flexWrap: 'wrap' as const,
    alignItems: 'flex-start',
  },
  thresholdPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    minWidth: '140px',
  },
  thresholdDisplay: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  thresholdLabel: {
    fontSize: '0.65rem',
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  thresholdValue: {
    fontSize: '2rem',
    fontWeight: 800,
    lineHeight: 1,
  },
  consensusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.85rem',
  },
  dimText: {
    fontSize: '0.8rem',
    color: '#666',
  },
  sliderPanel: {
    flex: 1,
    minWidth: '200px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  slider: {
    flex: 1,
    height: '8px',
    accentColor: '#fbbf24',
    cursor: 'pointer',
  } as React.CSSProperties,
  presetRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
  },
  forceRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    paddingTop: '4px',
    borderTop: '1px solid #2a2a2a',
    marginTop: '4px',
  },
};

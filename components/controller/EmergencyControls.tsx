/**
 * EmergencyControls
 *
 * Always-visible panel for audio controls and emergency/recovery operations.
 * All destructive actions require a confirmation step.
 *
 * Audio controls:
 * - Transport play/stop
 * - Audio panic (hard mute all)
 *
 * Recovery controls:
 * - Export state (JSON download)
 * - Import state (file upload)
 * - Force reconnect all clients
 * - Reset to lobby (keep or discard users)
 */

'use client';

import { useState, useRef } from 'react';
import type { ShowState, ConductorCommand } from '@/conductor/types';
import type { SerializedShowState } from '@/lib/serialization';

interface EmergencyControlsProps {
  fullState: ShowState;
  rawState: SerializedShowState | null;
  sendCommand: (cmd: ConductorCommand) => void;
}

type ConfirmAction = 'reset' | 'reconnect' | 'newshow' | 'generate-finale' | null;

export function EmergencyControls({ fullState, rawState, sendCommand }: EmergencyControlsProps) {
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [collapsed, setCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  const handleExportState = () => {
    // Export the serialized state (JSON-safe: Maps as arrays)
    const exportData = rawState ?? fullState;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `show-${fullState.id}-v${fullState.version}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportState = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Server expects ShowState; sending serialized form — server will handle deserialization
      send({ type: 'IMPORT_STATE', state: parsed as ShowState });
      console.log('[Controller] Imported state from file:', file.name);
    } catch (err) {
      console.error('[Controller] Failed to parse import file:', err);
      alert('Failed to parse state file. See console for details.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <section style={styles.section}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={styles.collapseToggle}
      >
        <span style={styles.sectionTitle}>Emergency Controls</span>
        <span style={{ color: '#555', fontSize: '0.8rem' }}>{collapsed ? '▼ show' : '▲ hide'}</span>
      </button>

      {!collapsed && (
        <div style={styles.body}>
          {/* Audio controls */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Audio</div>
            <div style={styles.buttonRow}>
              <button
                onClick={() => send({ type: 'AUDIO_TRANSPORT', action: 'play' })}
                style={{ ...btn, ...btnPrimary }}
                title="Start Ableton transport"
              >
                Play
              </button>

              <button
                onClick={() => send({ type: 'AUDIO_TRANSPORT', action: 'stop' })}
                style={{ ...btn, ...btnSecondary }}
                title="Stop Ableton transport"
              >
                Stop
              </button>

              <button
                onClick={() => send({ type: 'AUDIO_PANIC' })}
                style={{ ...btn, ...btnDanger, minWidth: '120px' }}
                title="Hard mute all configured tracks and stop transport"
              >
                AUDIO PANIC
              </button>

              <button
                onClick={() => send({ type: 'MASTER_PANIC' })}
                style={{ ...btn, ...btnMasterPanic, minWidth: '140px' }}
                title="Query Ableton for ALL tracks, mute every non-group track, reset gains"
              >
                MASTER PANIC
              </button>

              <button
                onClick={() => send({ type: 'RESET_UTILITIES' })}
                style={{ ...btn, ...btnWarning }}
                title="Reset all Utility gains to 0 dB and unmute all tracks"
              >
                RESET UTILITIES
              </button>

              <button
                onClick={() => send({ type: 'MASTER_DUCK' })}
                style={{ ...btn, ...btnSecondary }}
                title="Duck master gain for speech"
              >
                DUCK
              </button>

              <button
                onClick={() => send({ type: 'MASTER_UNDUCK' })}
                style={{ ...btn, ...btnSecondary }}
                title="Restore master gain to full"
              >
                UNDUCK
              </button>
            </div>
          </div>

          {/* Recovery controls */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Recovery</div>

            {confirm === null ? (
              <div style={styles.buttonRow}>
                <button onClick={handleExportState} style={{ ...btn, ...btnSecondary }}>
                  Export State
                </button>
                <button onClick={handleImportState} style={{ ...btn, ...btnSecondary }}>
                  Import State
                </button>
                <button
                  onClick={() => setConfirm('reconnect')}
                  style={{ ...btn, ...btnWarning }}
                >
                  Force Reconnect All
                </button>
                <button
                  onClick={() => setConfirm('reset')}
                  style={{ ...btn, ...btnDanger }}
                >
                  Reset to Lobby
                </button>
                <button
                  onClick={() => setConfirm('newshow')}
                  style={{ ...btn, ...btnDanger }}
                >
                  New Show
                </button>
                <button
                  onClick={() => setConfirm('generate-finale')}
                  style={{ ...btn, ...btnWarning }}
                  title="Force-populate all attempts with default winners and jump to finale_vote"
                >
                  Generate Valid Finale
                </button>
              </div>
            ) : confirm === 'reconnect' ? (
              <div style={styles.confirmBox}>
                <p style={styles.confirmText}>Force-reconnect all clients? This will briefly drop all connections.</p>
                <div style={styles.buttonRow}>
                  <button
                    onClick={() => { send({ type: 'FORCE_RECONNECT_ALL' }); setConfirm(null); }}
                    style={{ ...btn, ...btnDanger }}
                  >
                    Confirm Reconnect All
                  </button>
                  <button onClick={() => setConfirm(null)} style={{ ...btn, ...btnSecondary }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : confirm === 'reset' ? (
              <div style={styles.confirmBox}>
                <p style={styles.confirmText}>Reset show to lobby?</p>
                <div style={styles.buttonRow}>
                  <button
                    onClick={() => { send({ type: 'RESET_TO_LOBBY', preserveUsers: true }); setConfirm(null); }}
                    style={{ ...btn, ...btnDanger }}
                  >
                    Reset (Keep Users)
                  </button>
                  <button
                    onClick={() => { send({ type: 'RESET_TO_LOBBY', preserveUsers: false }); setConfirm(null); }}
                    style={{ ...btn, ...btnDanger }}
                  >
                    Reset (Clear All)
                  </button>
                  <button onClick={() => setConfirm(null)} style={{ ...btn, ...btnSecondary }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : confirm === 'newshow' ? (
              <div style={styles.confirmBox}>
                <p style={styles.confirmText}>Start a completely new show? This generates a new show ID, reloads config from disk, and clears all users.</p>
                <div style={styles.buttonRow}>
                  <button
                    onClick={() => { send({ type: 'NEW_SHOW' }); setConfirm(null); }}
                    style={{ ...btn, ...btnDanger }}
                  >
                    Confirm New Show
                  </button>
                  <button onClick={() => setConfirm(null)} style={{ ...btn, ...btnSecondary }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={styles.confirmBox}>
                <p style={styles.confirmText}>Generate a valid finale state using default winners from config? This overwrites all attempt results and jumps to finale_vote.</p>
                <div style={styles.buttonRow}>
                  <button
                    onClick={() => { send({ type: 'GENERATE_VALID_FINALE' }); setConfirm(null); }}
                    style={{ ...btn, ...btnWarning }}
                  >
                    Confirm Generate Finale
                  </button>
                  <button onClick={() => setConfirm(null)} style={{ ...btn, ...btnSecondary }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />
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
const btnPrimary: React.CSSProperties = { backgroundColor: '#f0f0f0', color: '#111' };
const btnSecondary: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' };
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const btnDanger: React.CSSProperties = { backgroundColor: '#450a0a', color: '#f87171', border: '1px solid #7f1d1d' };
const btnMasterPanic: React.CSSProperties = { backgroundColor: '#3b0764', color: '#c084fc', border: '1px solid #6b21a8' };

const styles = {
  section: {
    borderBottom: '1px solid #2a2a2a',
  },
  collapseToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  body: {
    padding: '0 20px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  group: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  groupLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  confirmBox: {
    padding: '14px',
    backgroundColor: '#1a0505',
    borderRadius: '6px',
    border: '1px solid #7f1d1d',
  },
  confirmText: {
    margin: '0 0 12px 0',
    fontSize: '0.9rem',
    color: '#fca5a5',
  },
};

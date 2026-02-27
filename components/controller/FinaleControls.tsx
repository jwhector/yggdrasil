/**
 * FinaleControls
 *
 * Finale management. Only rendered during finale_setup, finale_rotating, finale_frozen.
 *
 * Controls:
 * - Rotation (start/stop/freeze, rate 1x/2x)
 * - Triangle steering toggle
 * - Clear Queue
 * - Queue status per chapter
 * - Active slots summary
 * - Stewardship progress
 *
 * Note: FORCE_ASSIGN_STEWARD / FORCE_INSERT_FRAGMENT send userId fields which the
 * server currently replaces with the socket's userId. Those commands are omitted
 * here until server-side controller auth is added. TODO: See server/socket.ts command handler.
 */

'use client';

import type { ShowState, ConductorCommand, Chapter } from '@/conductor/types';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';

interface FinaleControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function FinaleControls({ fullState, sendCommand }: FinaleControlsProps) {
  const { finaleState, users } = fullState;
  if (!finaleState) return null;

  const {
    rotationActive, rotationRate, frozen, triangleActive,
    queue, activeSlots, stewardshipLog, centroid,
  } = finaleState;

  const totalUsers = users.size;
  const uniqueStewards = new Set(stewardshipLog.map(e => e.userId)).size;

  // Queue counts by chapter
  const queueByChapter: Record<Chapter, number> = { ambition: 0, love: 0, avoidance: 0 };
  for (const entry of queue) {
    queueByChapter[entry.chapter] = (queueByChapter[entry.chapter] ?? 0) + 1;
  }

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Finale Controls</h2>

      <div style={styles.layout}>
        {/* Left column: controls */}
        <div style={styles.controlsCol}>
          {/* Rotation controls */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Rotation</div>
            <div style={styles.buttonRow}>
              {!rotationActive && !frozen && (
                <button
                  onClick={() => send({ type: 'START_ROTATION' })}
                  style={{ ...btn, ...btnPrimary }}
                >
                  Start Rotation
                </button>
              )}

              {rotationActive && !frozen && (
                <button
                  onClick={() => send({ type: 'STOP_ROTATION' })}
                  style={{ ...btn, ...btnWarning }}
                >
                  Stop Rotation
                </button>
              )}

              <button
                onClick={() => send({ type: 'FREEZE_ROTATION' })}
                disabled={frozen}
                style={{ ...btn, ...(frozen ? disabled : btnWarning) }}
                title="Freeze rotation and lock the current mix"
              >
                {frozen ? 'Frozen' : 'Freeze'}
              </button>
            </div>

            {/* Rotation rate */}
            {!frozen && (
              <div style={styles.rateRow}>
                <span style={styles.dimText}>Rate:</span>
                <button
                  onClick={() => send({ type: 'SET_ROTATION_RATE', rate: 1 })}
                  style={{ ...btnSmall, ...(rotationRate === 1 ? btnActive : btnInactive) }}
                >
                  1×
                </button>
                <button
                  onClick={() => send({ type: 'SET_ROTATION_RATE', rate: 2 })}
                  style={{ ...btnSmall, ...(rotationRate === 2 ? btnActive : btnInactive) }}
                >
                  2×
                </button>
                <span style={styles.dimText}>
                  ({rotationRate} slot{rotationRate > 1 ? 's' : ''} / 8 bars)
                </span>
              </div>
            )}
          </div>

          {/* Triangle + Queue */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Triangle &amp; Queue</div>
            <div style={styles.buttonRow}>
              <button
                onClick={() => send({ type: 'TOGGLE_TRIANGLE', active: !triangleActive })}
                style={{ ...btn, ...(triangleActive ? btnActive : btnSecondary) }}
              >
                Triangle: {triangleActive ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => send({ type: 'CLEAR_QUEUE' })}
                style={{ ...btn, ...btnWarning }}
                title="Empty the fragment queue for all chapters"
              >
                Clear Queue
              </button>
            </div>

            {/* Centroid display */}
            <div style={styles.centroidRow}>
              <span style={styles.dimText}>Centroid:</span>
              <CentroidBar label="Amb" value={centroid.wAmbition} color="#e63946" />
              <CentroidBar label="Love" value={centroid.wLove} color="#f4a261" />
              <CentroidBar label="Av" value={centroid.wAvoidance} color="#457b9d" />
            </div>
          </div>
        </div>

        {/* Right column: status */}
        <div style={styles.statusCol}>
          {/* Queue by chapter */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Queue</div>
            <div style={styles.chapterRow}>
              {(['ambition', 'love', 'avoidance'] as Chapter[]).map(ch => {
                const id = getChapterIdentity(ch);
                return (
                  <div key={ch} style={styles.chapterStat}>
                    <div style={{ ...styles.chapterDot, backgroundColor: id.color }} />
                    <span style={styles.chapterName}>{id.label}</span>
                    <span style={styles.chapterCount}>{queueByChapter[ch]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stewardship progress */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Stewardship</div>
            <div style={styles.stewardRow}>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f0f0f0' }}>
                {uniqueStewards}
              </span>
              <span style={styles.dimText}>/ {totalUsers} users have stewarded</span>
            </div>
            <ProgressBar value={uniqueStewards} max={totalUsers} color="#4ade80" />
          </div>

          {/* Active slots */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>
              Active Slots ({activeSlots.filter(Boolean).length}/{activeSlots.length})
            </div>
            <div style={styles.slotsList}>
              {activeSlots.map((slot, i) => {
                if (!slot) {
                  return (
                    <div key={i} style={styles.slotEmpty}>
                      <span style={styles.slotIndex}>{i}</span>
                      <span style={styles.dimText}>—</span>
                    </div>
                  );
                }
                const chId = getChapterIdentity(slot.fragment.chapter);
                const layerId = getLayerIdentity(slot.fragment.layerType);
                const stewardUser = users.get(slot.stewardUserId);
                return (
                  <div key={i} style={{ ...styles.slotActive, borderColor: chId.color + '66' }}>
                    <span style={styles.slotIndex}>{i}</span>
                    <div style={{ ...styles.slotColorDot, backgroundColor: chId.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.slotFragName}>{slot.fragment.displayName}</div>
                      <div style={styles.slotMeta}>
                        {layerId.label} · steward: {stewardUser ? stewardUser.id.slice(0, 6) : '?'}
                      </div>
                    </div>
                    <EnergyBar energy={slot.energyLevel} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CentroidBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '80px' }}>
      <span style={{ fontSize: '0.7rem', color: '#888', width: '24px' }}>{label}</span>
      <div style={{ flex: 1, height: '4px', backgroundColor: '#333', borderRadius: '2px' }}>
        <div style={{ height: '100%', width: `${Math.round(value * 100)}%`, backgroundColor: color, borderRadius: '2px' }} />
      </div>
      <span style={{ fontSize: '0.7rem', color: '#888', width: '28px' }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ height: '6px', backgroundColor: '#222', borderRadius: '3px', overflow: 'hidden', marginTop: '6px' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '3px', transition: 'width 0.3s' }} />
    </div>
  );
}

function EnergyBar({ energy }: { energy: number }) {
  const pct = Math.round(energy * 100);
  const color = energy > 0.7 ? '#4ade80' : energy > 0.3 ? '#fbbf24' : '#555';
  return (
    <div style={{ width: '4px', height: '32px', backgroundColor: '#222', borderRadius: '2px', overflow: 'hidden', alignSelf: 'center' }}>
      <div style={{ position: 'absolute' as const, bottom: 0, width: '100%', height: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// Button styles
const btn: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  minHeight: '48px',
};
const btnSmall: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '0.85rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { backgroundColor: '#f0f0f0', color: '#111' };
const btnSecondary: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' };
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const btnActive: React.CSSProperties = { backgroundColor: '#4ade80', color: '#111' };
const btnInactive: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#888', border: '1px solid #333' };
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
    gap: '24px',
    flexWrap: 'wrap' as const,
    alignItems: 'flex-start',
  },
  controlsCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    minWidth: '280px',
    flex: 1,
  },
  statusCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    minWidth: '280px',
    flex: 1,
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
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  rateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dimText: {
    fontSize: '0.8rem',
    color: '#666',
  },
  centroidRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  chapterRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const,
  },
  chapterStat: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px',
    border: '1px solid #333',
  },
  chapterDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  chapterName: {
    fontSize: '0.8rem',
    color: '#aaa',
  },
  chapterCount: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#f0f0f0',
    minWidth: '24px',
    textAlign: 'right' as const,
  },
  stewardRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
  },
  slotsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  slotEmpty: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    backgroundColor: '#111',
    borderRadius: '4px',
    border: '1px solid #222',
  },
  slotActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    backgroundColor: '#1a1a1a',
    borderRadius: '4px',
    border: '1px solid',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  slotIndex: {
    fontSize: '0.7rem',
    color: '#555',
    width: '12px',
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  slotColorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  slotFragName: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#f0f0f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  slotMeta: {
    fontSize: '0.7rem',
    color: '#666',
  },
};

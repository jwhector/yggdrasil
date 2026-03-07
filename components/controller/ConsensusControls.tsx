'use client';

/**
 * ConsensusControls
 *
 * Controller panel for the finale consensus game.
 * Shows real-time convergence data (including leading fragment — controller-only),
 * round management, threshold adjustment, and force-lock capability.
 */

import { calculateConvergence } from '@/conductor/consensus-game';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { ShowState, ConductorCommand, LayerType } from '@/conductor/types';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

interface ConsensusControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function ConsensusControls({ fullState, sendCommand }: ConsensusControlsProps) {
  const { finaleState } = fullState;
  if (!finaleState || finaleState.phase !== 'consensus_game') return null;

  const cg = finaleState.consensusGame;
  const { convergence, leadingFragment, distribution } = calculateConvergence(cg.votes);

  const lockedRoleSet = new Set(cg.lockedRoles.keys());
  const unlockedLayers = LAYER_ORDER.filter(lt => !lockedRoleSet.has(lt));

  const leadingFrag = leadingFragment
    ? finaleState.availableFragments.find(f => f.id === leadingFragment)
    : null;
  const leadingChapter = leadingFrag ? getChapterIdentity(leadingFrag.chapter) : null;

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Consensus Game</h2>

      <div style={styles.layout}>
        {/* Left: controls */}
        <div style={styles.col}>
          {/* Round management */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Round {cg.currentRound}</div>
            <div style={styles.buttonRow}>
              <button
                onClick={() => sendCommand({ type: 'START_CONSENSUS_ROUND' })}
                disabled={cg.active}
                style={{ ...btn, ...(cg.active ? disabledBtn : btnPrimary) }}
              >
                Start Round
              </button>
              <button
                onClick={() => sendCommand({ type: 'END_CONSENSUS_ROUND' })}
                disabled={!cg.active}
                style={{ ...btn, ...(!cg.active ? disabledBtn : btnWarning) }}
              >
                End Round
              </button>
            </div>
            {cg.consecutiveFailures > 0 && (
              <div style={styles.dimText}>
                {cg.consecutiveFailures} consecutive failure{cg.consecutiveFailures !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Threshold control */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>
              Threshold: {Math.round(cg.threshold * 100)}%
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(cg.threshold * 100)}
              onChange={e =>
                sendCommand({
                  type: 'SET_CONSENSUS_THRESHOLD',
                  threshold: parseInt(e.target.value) / 100,
                })
              }
              style={{ width: '100%' }}
            />
          </div>

          {/* Force-lock per role */}
          {unlockedLayers.length > 0 && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>Force Lock</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {unlockedLayers.map(lt => {
                  const layer = getLayerIdentity(lt);
                  const fragments = finaleState.availableFragments.filter(f => f.layerType === lt);
                  if (fragments.length === 0) return null;
                  return (
                    <div key={lt} style={styles.forceLockRow}>
                      <span style={{ ...styles.dimText, color: layer.color, minWidth: '16px' }}>
                        {layer.symbol}
                      </span>
                      {fragments.map(f => {
                        const ch = getChapterIdentity(f.chapter);
                        return (
                          <button
                            key={f.id}
                            onClick={() =>
                              sendCommand({
                                type: 'SUBMIT_CONSENSUS_VOTE',
                                userId: '__force__' as import('@/conductor/types').UserId,
                                fragmentId: f.id,
                              })
                            }
                            style={{
                              ...btnSmall,
                              backgroundColor: ch.color + '22',
                              border: `1px solid ${ch.color}55`,
                              color: ch.color,
                            }}
                            title={`Force-select ${f.displayLabel}`}
                          >
                            {f.displayLabel}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: real-time data */}
        <div style={styles.col}>
          {/* Convergence metrics */}
          <div style={styles.group}>
            <div style={styles.groupLabel}>Convergence</div>
            <div style={styles.metricRow}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: convergence >= cg.threshold ? '#4ade80' : '#f0f0f0' }}>
                {Math.round(convergence * 100)}%
              </span>
              <span style={styles.dimText}>/ {Math.round(cg.threshold * 100)}% needed</span>
            </div>
            <div style={styles.dimText}>
              {cg.votes.size} vote{cg.votes.size !== 1 ? 's' : ''} cast
            </div>
            {leadingFrag && (
              <div style={{ ...styles.leadingRow, borderColor: (leadingChapter?.color ?? '#888') + '55' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: leadingChapter?.color ?? '#888',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', color: '#f0f0f0', fontWeight: 600 }}>
                    {leadingFrag.displayLabel}
                  </div>
                  <div style={styles.dimText}>
                    {Math.round(convergence * 100)}% · {getLayerIdentity(leadingFrag.layerType).label}
                  </div>
                </div>
              </div>
            )}

            {/* Vote distribution */}
            {distribution.size > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
                {Array.from(distribution.entries())
                  .sort(([, a], [, b]) => b - a)
                  .map(([fragId, count]) => {
                    const f = finaleState.availableFragments.find(x => x.id === fragId);
                    if (!f) return null;
                    const ch = getChapterIdentity(f.chapter);
                    const pct = cg.votes.size > 0 ? count / cg.votes.size : 0;
                    return (
                      <div key={fragId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div
                          style={{
                            height: '3px',
                            width: `${Math.round(pct * 80)}px`,
                            backgroundColor: ch.color,
                            borderRadius: '2px',
                          }}
                        />
                        <span style={{ fontSize: '0.65rem', color: '#888' }}>
                          {f.displayLabel} ({count})
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Locked roles summary */}
          {cg.lockedRoles.size > 0 && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>Locked ({cg.lockedRoles.size}/{LAYER_ORDER.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {Array.from(cg.lockedRoles.entries()).map(([lt, fragId]) => {
                  const layer = getLayerIdentity(lt);
                  const f = finaleState.availableFragments.find(x => x.id === fragId);
                  const ch = f ? getChapterIdentity(f.chapter) : null;
                  return (
                    <div key={lt} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: layer.color, fontSize: '0.8rem' }}>{layer.symbol}</span>
                      <div
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: ch?.color ?? '#888',
                        }}
                      />
                      <span style={{ fontSize: '0.8rem', color: '#aaa' }}>
                        {f?.displayLabel ?? fragId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
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
  minHeight: '44px',
};
const btnSmall: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '0.75rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { backgroundColor: '#f0f0f0', color: '#111' };
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const disabledBtn: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#555', border: '1px solid #333', cursor: 'not-allowed', opacity: 0.5 };

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '16px 20px', borderBottom: '1px solid #2a2a2a' },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  layout: { display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' },
  col: { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '240px', flex: 1 },
  group: { display: 'flex', flexDirection: 'column', gap: '8px' },
  groupLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  buttonRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  dimText: { fontSize: '0.8rem', color: '#666' },
  metricRow: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  leadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px',
    border: '1px solid',
  },
  forceLockRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
};

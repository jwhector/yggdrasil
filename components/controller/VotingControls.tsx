/**
 * VotingControls
 *
 * Song-building vote management. Only rendered during attempt_build.
 * Shows live vote counts, open/close controls, force options, timer extend, rerun.
 */

'use client';

import type { ShowState, ConductorCommand, LayerPhase } from '@/conductor/types';

interface VotingControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

export function VotingControls({ fullState, sendCommand }: VotingControlsProps) {
  const { currentAttemptIndex, attempts } = fullState;
  const attempt = attempts[currentAttemptIndex];
  if (!attempt) return null;

  const { currentLayerIndex, currentLayerPhase, layerPlan, votes, currentAuditionOption } = attempt;
  const currentLayer = layerPlan[currentLayerIndex];
  const layerGroup = currentLayer?.group ?? null;

  const layerVotes = votes.filter(v => v.layerIndex === currentLayerIndex);
  const votesA = layerVotes.filter(v => v.choice === 'A').length;
  const votesB = layerVotes.filter(v => v.choice === 'B').length;
  const total = votesA + votesB;
  const pctA = total > 0 ? Math.round((votesA / total) * 100) : 0;
  const pctB = total > 0 ? Math.round((votesB / total) * 100) : 0;

  const isVoting = currentLayerPhase === 'auditioning';
  const isAuditioning = currentLayerPhase === 'auditioning';
  const isRevealing = currentLayerPhase === 'revealing';

  const send = (cmd: ConductorCommand) => sendCommand(cmd);

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Voting Controls</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LayerBadge
            index={currentLayerIndex}
            total={layerPlan.length}
            phase={currentLayerPhase}
            type={layerGroup ?? undefined}
          />
          {isAuditioning && currentAuditionOption && (
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: currentAuditionOption === 'A' ? '#4ade80' : '#60a5fa',
              letterSpacing: '0.05em',
            }}>
              ▶ {currentAuditionOption}
            </span>
          )}
        </div>
      </div>

      {/* Vote bar */}
      {(isVoting || isRevealing) && (
        <div style={styles.voteBar}>
          <VoteOption
            label={currentLayer?.labelA ?? 'A'}
            option="A"
            votes={votesA}
            pct={pctA}
            color="#4ade80"
            isWinning={votesA >= votesB}
          />
          <div style={styles.voteTotal}>{total} votes</div>
          <VoteOption
            label={currentLayer?.labelB ?? 'B'}
            option="B"
            votes={votesB}
            pct={pctB}
            color="#60a5fa"
            isWinning={votesB > votesA}
          />
        </div>
      )}

      {/* Control buttons */}
      <div style={styles.buttonGrid}>
        <button
          onClick={() => send({ type: 'CLOSE_VOTING' })}
          disabled={!isVoting}
          style={{ ...btn, ...(!isVoting ? disabled : btnPrimary) }}
          title="Close voting and resolve immediately"
        >
          Close Vote
        </button>

        <button
          onClick={() => send({ type: 'FORCE_OPTION', choice: 'A' })}
          disabled={!isVoting}
          style={{ ...btn, ...(!isVoting ? disabled : btnWarning) }}
          title="Force option A as winner"
        >
          Force A
        </button>

        <button
          onClick={() => send({ type: 'FORCE_OPTION', choice: 'B' })}
          disabled={!isVoting}
          style={{ ...btn, ...(!isVoting ? disabled : btnWarning) }}
          title="Force option B as winner"
        >
          Force B
        </button>

        <button
          onClick={() => send({ type: 'RERUN_VOTE' })}
          disabled={!isRevealing && !isVoting}
          style={{ ...btn, ...((!isRevealing && !isVoting) ? disabled : btnWarning) }}
          title="Rerun the vote from scratch"
        >
          Rerun Vote
        </button>
      </div>
    </section>
  );
}

function LayerBadge({
  index, total, phase, type, color,
}: {
  index: number;
  total: number;
  phase: LayerPhase;
  type?: string;
  color?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '0.8rem', color: '#888' }}>
        Layer {index + 1}/{total}
        {type && ` · ${type}`}
      </span>
      <span style={{
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 700,
        backgroundColor: phaseColor(phase),
        color: '#111',
        letterSpacing: '0.05em',
      }}>
        {phase.toUpperCase()}
      </span>
      {color && (
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: color }} />
      )}
    </div>
  );
}

function VoteOption({
  label, option, votes, pct, color, isWinning,
}: {
  label: string; option: 'A' | 'B'; votes: number; pct: number;
  color: string; isWinning: boolean;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: isWinning ? 700 : 400, color: isWinning ? color : '#888' }}>
          {option}: {label}
        </span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: isWinning ? color : '#888' }}>
          {votes} ({pct}%)
        </span>
      </div>
      <div style={{ height: '6px', backgroundColor: '#222', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          backgroundColor: color,
          borderRadius: '3px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function phaseColor(phase: LayerPhase): string {
  switch (phase) {
    case 'auditioning': return '#fbbf24';
    case 'revealing': return '#60a5fa';
    case 'locked_in': return '#818cf8';
    case 'collapsed': return '#f87171';
    default: return '#555';
  }
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
const btnWarning: React.CSSProperties = { backgroundColor: '#451a03', color: '#fbbf24', border: '1px solid #78350f' };
const disabled: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#555', border: '1px solid #333', cursor: 'not-allowed', opacity: 0.5 };

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
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  voteBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '14px',
    padding: '12px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px',
    border: '1px solid #333',
  },
  voteTotal: {
    fontSize: '0.8rem',
    color: '#666',
    whiteSpace: 'nowrap' as const,
    minWidth: '60px',
    textAlign: 'center' as const,
  },
  buttonGrid: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
};

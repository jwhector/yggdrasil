/**
 * MetricsPanel
 *
 * Persistent status dashboard at the top of the controller UI.
 * Always visible — shows show state, connection health, and phase-specific metrics.
 */

'use client';

import type { ShowState, ShowPhase, FinaleState } from '@/conductor/types';

interface MetricsPanelProps {
  fullState: ShowState;
  connectionState: string;
  reconnect: () => void;
}

const PHASE_LABELS: Record<ShowPhase, string> = {
  lobby: 'Lobby',
  opener: 'Opener',
  attempt_story: 'Story',
  attempt_build: 'Song Building',
  attempt_resolve: 'Resolve',
  finale_vote: 'Finale — Vote',
  finale_remix: 'Finale — Remix',
  ended: 'Ended',
};

const PHASE_COLORS: Record<ShowPhase, string> = {
  lobby: '#4b5563',
  opener: '#1d4ed8',
  attempt_story: '#6d28d9',
  attempt_build: '#d97706',
  attempt_resolve: '#92400e',
  finale_vote: '#0d9488',
  finale_remix: '#7c3aed',
  ended: '#374151',
};

export function MetricsPanel({ fullState, connectionState, reconnect }: MetricsPanelProps) {
  const { phase, currentAttemptIndex, paused, version, users, attempts } = fullState;
  const finaleState = fullState.finaleState as FinaleState | null;
  const currentAttempt = attempts[currentAttemptIndex];

  const connectedUsers = Array.from(users.values()).filter(u => u.connected).length;
  const totalUsers = users.size;

  // Vote metrics (attempt_build)
  const currentLayerVotes = phase === 'attempt_build' && currentAttempt
    ? currentAttempt.votes.filter(v => v.layerIndex === currentAttempt.currentLayerIndex)
    : [];
  const votesA = currentLayerVotes.filter(v => v.choice === 'A').length;
  const votesB = currentLayerVotes.filter(v => v.choice === 'B').length;
  const totalVotes = votesA + votesB;
  const consensusPct = totalVotes > 0 ? Math.round((Math.max(votesA, votesB) / totalVotes) * 100) : 0;

  const wsColor =
    connectionState === 'connected' ? '#4ade80'
    : connectionState === 'connecting' || connectionState === 'reconnecting' ? '#fbbf24'
    : '#f87171';

  const isFinalePhase = phase === 'finale_vote' || phase === 'finale_remix';

  return (
    <div style={styles.panel}>
      {/* Row 1: Phase + core stats */}
      <div style={styles.row}>
        {/* Phase badge */}
        <div style={{ ...styles.phaseBadge, backgroundColor: PHASE_COLORS[phase] }}>
          {paused && <span style={styles.pausedDot} title="Paused" />}
          {PHASE_LABELS[phase]}
          {(phase === 'attempt_build' || phase === 'attempt_story') &&
            <span style={styles.attemptTag}>· {currentAttempt?.chapter ?? `#${currentAttemptIndex + 1}`}</span>
          }
        </div>

        {/* Stat cards */}
        <StatCard label="Users" value={`${connectedUsers} / ${totalUsers}`} />
        <StatCard label="Version" value={String(version)} dim />
        <StatCard label="Show ID" value={fullState.id} dim />

        {/* WebSocket status */}
        <div style={styles.wsStatus}>
          <div style={{ ...styles.wsDot, backgroundColor: wsColor }} />
          <span style={{ color: wsColor, fontSize: '0.8rem', fontWeight: 600 }}>
            {connectionState === 'connected' ? 'WS' : connectionState.toUpperCase()}
          </span>
          {connectionState !== 'connected' && (
            <button onClick={reconnect} style={styles.reconnectBtn}>Reconnect</button>
          )}
        </div>
      </div>

      {/* Row 2: Phase-specific metrics */}
      {phase === 'attempt_build' && currentAttempt && (
        <div style={styles.row}>
          <StatCard
            label="Layer"
            value={`${currentAttempt.currentLayerIndex + 1} / ${currentAttempt.layerPlan.length}`}
          />
          <StatCard label="Layer Phase" value={currentAttempt.currentLayerPhase} />
          <StatCard label="Vote A" value={String(votesA)} color="#4ade80" />
          <StatCard label="Vote B" value={String(votesB)} color="#60a5fa" />
          <StatCard
            label="Consensus"
            value={totalVotes > 0 ? `${consensusPct}%` : '—'}
            color={consensusPct >= 75 ? '#4ade80' : '#fbbf24'}
          />
          <StatCard label="Participation" value={`${totalVotes} / ${connectedUsers}`} />
        </div>
      )}

      {isFinalePhase && finaleState && (
        <div style={styles.row}>
          <StatCard label="Finale Phase" value={finaleState.phase} />
          <StatCard label="Pool" value={`${finaleState.pool.totalRemaining} / ${finaleState.pool.targetPoolSize}`} />
          <StatCard label="Tokens" value={String(finaleState.pool.tokens.length)} />
          <StatCard label="Active" value={String(finaleState.active.size)} color="#4ade80" />
          <StatCard label="Queued" value={String(Array.from(finaleState.queue.values()).reduce((s, q) => s + q.length, 0))} />
          {finaleState.phase === 'vote' && (
            <StatCard
              label="Answered"
              value={String(finaleState.vote.questionsAnsweredByUser.size)}
              color={undefined}
            />
          )}
          {finaleState.phase === 'remix' && (
            <>
              <StatCard label="Loop" value={String(finaleState.loopCount)} />
              <StatCard label="Audience" value={finaleState.audienceInteraction ? 'On' : 'Off'} color={finaleState.audienceInteraction ? '#4ade80' : '#666'} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, dim }: { label: string; value: string; color?: string; dim?: boolean }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: color ?? (dim ? '#666' : '#f0f0f0') }}>{value}</div>
    </div>
  );
}

const styles = {
  panel: {
    backgroundColor: '#111',
    borderBottom: '1px solid #333',
    padding: '12px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  phaseBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.02em',
    minWidth: '140px',
  },
  pausedDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#fbbf24',
    flexShrink: 0,
  } as React.CSSProperties,
  attemptTag: {
    fontSize: '0.75rem',
    fontWeight: 400,
    opacity: 0.8,
    textTransform: 'capitalize' as const,
  },
  statCard: {
    padding: '4px 10px',
    backgroundColor: '#1a1a1a',
    borderRadius: '4px',
    border: '1px solid #333',
  },
  statLabel: {
    fontSize: '0.6rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  statValue: {
    fontSize: '0.95rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  wsStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    marginLeft: 'auto',
  },
  wsDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  reconnectBtn: {
    padding: '2px 8px',
    fontSize: '0.7rem',
    backgroundColor: '#222',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: '4px',
    cursor: 'pointer',
  } as React.CSSProperties,
};

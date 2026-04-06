/**
 * ShowControls
 *
 * Core show phase management: Advance, Pause/Resume, Jump to Phase.
 * Always visible.
 */

'use client';

import { useState } from 'react';
import type { ShowState, ShowPhase, ConductorCommand } from '@/conductor/types';

interface ShowControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

const ALL_PHASES: ShowPhase[] = [
  'lobby', 'opener', 'attempt_story', 'attempt_build', 'attempt_resolve',
  'finale_elegy', 'finale_assignment', 'finale_live_mix', 'ended',
];

const PHASE_LABELS: Record<ShowPhase, string> = {
  lobby: 'Lobby',
  opener: 'Opener',
  attempt_story: 'Story (attempt_story)',
  attempt_build: 'Song Building (attempt_build)',
  attempt_resolve: 'Resolve (attempt_resolve)',
  finale_elegy: 'Finale — Elegy',
  finale_assignment: 'Finale — Assignment',
  finale_live_mix: 'Finale — Live Mix',
  ended: 'Ended',
};

// Phases that require an attemptIndex
const ATTEMPT_PHASES = new Set<ShowPhase>(['attempt_story', 'attempt_build']);

export function ShowControls({ fullState, sendCommand }: ShowControlsProps) {
  const { phase, paused, currentAttemptIndex, attempts } = fullState;
  const currentAttempt = attempts[currentAttemptIndex];

  const [jumpPhase, setJumpPhase] = useState<ShowPhase>('lobby');
  const [jumpAttemptIndex, setJumpAttemptIndex] = useState<number>(0);

  const handleAdvance = () => sendCommand({ type: 'ADVANCE_PHASE' });
  const handleAdvanceSlide = () => sendCommand({ type: 'ADVANCE_SLIDE' });
  const handlePause = () => sendCommand({ type: 'PAUSE' });
  const handleResume = () => sendCommand({ type: 'RESUME' });
  const handleStartAudition = () => sendCommand({ type: 'START_AUDITION' });

  const handleJump = () => {
    const cmd: ConductorCommand = ATTEMPT_PHASES.has(jumpPhase)
      ? { type: 'JUMP_TO_PHASE', phase: jumpPhase, attemptIndex: jumpAttemptIndex }
      : { type: 'JUMP_TO_PHASE', phase: jumpPhase };
    sendCommand(cmd);
  };

  const openerSlides = fullState.config.openerSlides;
  const showSlideButton = phase === 'opener' && openerSlides && openerSlides.length > 0;

  // Compute total steps: for each slide, 1 (point) + subPoints.length, plus final blank
  const totalSteps = openerSlides
    ? openerSlides.reduce((sum, s) => sum + 1 + (s.subPoints?.length ?? 0), 0) + 1
    : 0;
  const slideState = fullState.openerSlideState;
  const currentStep = slideState === null || slideState === undefined
    ? 0
    : openerSlides
      ? openerSlides.slice(0, slideState.pointIndex).reduce((sum, s) => sum + 1 + (s.subPoints?.length ?? 0), 0) + 1 + (slideState.subPointIndex >= 0 ? slideState.subPointIndex + 1 : 0)
      : 0;

  const canStartAudition =
    phase === 'attempt_build' &&
    currentAttempt?.currentLayerPhase === 'locked';

  const canForceCollapse =
    phase === 'attempt_build' &&
    currentAttempt?.status === 'in_progress';

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Show Controls</h2>
      <div style={styles.buttonRow}>
        <button
          onClick={handleAdvance}
          style={{ ...styles.btn, ...styles.btnPrimary }}
        >
          Advance Phase
        </button>

        <button
          onClick={paused ? handleResume : handlePause}
          style={{ ...styles.btn, ...(paused ? styles.btnPrimary : styles.btnWarning) }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        {showSlideButton && (
          <button
            onClick={handleAdvanceSlide}
            style={{ ...styles.btn, ...styles.btnPrimary }}
          >
            Advance Slide ({currentStep}/{totalSteps})
          </button>
        )}

        {canStartAudition && (
          <button
            onClick={handleStartAudition}
            style={{ ...styles.btn, ...styles.btnPrimary }}
          >
            Start Audition
          </button>
        )}

        {canForceCollapse && (
          <button
            onClick={() => sendCommand({ type: 'FORCE_COLLAPSE' })}
            style={{ ...styles.btn, ...styles.btnDanger }}
            title="End this attempt immediately (health bar → 0)"
          >
            Force Collapse
          </button>
        )}
      </div>

      {/* Jump to Phase */}
      <div style={styles.jumpRow}>
        <span style={styles.jumpLabel}>Jump to:</span>
        <select
          value={jumpPhase}
          onChange={e => setJumpPhase(e.target.value as ShowPhase)}
          style={styles.select}
        >
          {ALL_PHASES.map(p => (
            <option key={p} value={p}>{PHASE_LABELS[p]}</option>
          ))}
        </select>

        {ATTEMPT_PHASES.has(jumpPhase) && (
          <select
            value={jumpAttemptIndex}
            onChange={e => setJumpAttemptIndex(Number(e.target.value))}
            style={styles.select}
          >
            <option value={0}>Attempt 1 ({fullState.config.attempts[0]?.chapter ?? 'ambition'})</option>
            <option value={1}>Attempt 2 ({fullState.config.attempts[1]?.chapter ?? 'love'})</option>
            <option value={2}>Attempt 3 ({fullState.config.attempts[2]?.chapter ?? 'avoidance'})</option>
          </select>
        )}

        <button
          onClick={handleJump}
          style={{ ...styles.btn, ...styles.btnWarning }}
        >
          Jump
        </button>
      </div>
    </section>
  );
}

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
  buttonRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginBottom: '12px',
  },
  jumpRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  jumpLabel: {
    fontSize: '0.85rem',
    color: '#888',
  },
  select: {
    padding: '10px 12px',
    backgroundColor: '#1a1a1a',
    color: '#f0f0f0',
    border: '1px solid #444',
    borderRadius: '6px',
    fontSize: '0.875rem',
    cursor: 'pointer',
  } as React.CSSProperties,
  btn: {
    padding: '12px 20px',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    minHeight: '48px',
    letterSpacing: '0.01em',
  } as React.CSSProperties,
  btnPrimary: {
    backgroundColor: '#f0f0f0',
    color: '#111',
  } as React.CSSProperties,
  btnWarning: {
    backgroundColor: '#451a03',
    color: '#fbbf24',
    border: '1px solid #78350f',
  } as React.CSSProperties,
  btnDanger: {
    backgroundColor: '#450a0a',
    color: '#f87171',
    border: '1px solid #7f1d1d',
  } as React.CSSProperties,
};

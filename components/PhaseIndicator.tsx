/**
 * PhaseIndicator Component
 *
 * Shows the current row phase at the top of the projector display.
 * Color-coded for quick visual recognition.
 */

'use client';

import type { RowPhase } from '@/conductor/types';

export interface PhaseIndicatorProps {
  phase: RowPhase;
  currentAuditionIndex: number | null;
  rowIndex: number;
  rowLabel: string;
}

/**
 * Get phase display text and color
 */
function getPhaseInfo(phase: RowPhase, currentAuditionIndex: number | null): {
  text: string;
  color: string;
  backgroundColor: string;
} {
  switch (phase) {
    case 'pending':
      return {
        text: 'Waiting...',
        color: '#999',
        backgroundColor: 'rgba(153, 153, 153, 0.1)',
      };
    case 'auditioning':
      const optionNum = currentAuditionIndex !== null ? currentAuditionIndex + 1 : '?';
      return {
        text: `Auditioning Option ${optionNum}/4`,
        color: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.1)',
      };
    case 'voting':
      return {
        text: 'Voting Now',
        color: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.1)',
      };
    case 'revealing':
      return {
        text: 'Revealing Results...',
        color: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.1)',
      };
    case 'coup_window':
      return {
        text: 'Coup Window',
        color: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
      };
    case 'committed':
      return {
        text: 'Committed',
        color: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.1)',
      };
    default:
      return {
        text: phase,
        color: '#999',
        backgroundColor: 'rgba(153, 153, 153, 0.1)',
      };
  }
}

export function PhaseIndicator({
  phase,
  currentAuditionIndex,
  rowIndex,
  rowLabel,
}: PhaseIndicatorProps) {
  const phaseInfo = getPhaseInfo(phase, currentAuditionIndex);

  // Log the currentAuditionIndex for debugging
  console.log('[PhaseIndicator] currentAuditionIndex:', currentAuditionIndex);

  return (
    <div style={{
      ...styles.container,
      backgroundColor: phaseInfo.backgroundColor,
      borderBottom: `2px solid ${phaseInfo.color}`,
    }}>
      <div style={styles.content}>
        <div style={styles.rowInfo}>
          <span style={{ color: '#999', fontSize: '0.875rem' }}>Row {rowIndex}:</span>
          <span style={{ marginLeft: '0.5rem', fontWeight: 'bold' }}>
            {rowLabel}
          </span>
        </div>

        <div style={{
          ...styles.phaseText,
          color: phaseInfo.color,
        }}>
          {phaseInfo.text}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    zIndex: 100,
    transition: 'all 0.3s ease',
  } as React.CSSProperties,

  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '2rem',
    padding: '0 2rem',
  } as React.CSSProperties,

  rowInfo: {
    fontSize: '1rem',
    color: '#fff',
  } as React.CSSProperties,

  phaseText: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
};

/**
 * ShowStepper
 *
 * Linear show progression panel. Displays a single NEXT button that always
 * does the right thing based on current show state. Shows blocked status
 * when waiting for timing engine (audition, verdict timer).
 */

'use client';

import type { StepperStep, PhoneCue } from '@/hooks/useShowStepper';

interface ShowStepperProps {
  step: StepperStep;
  phoneCue: PhoneCue;
  advance: () => void;
}

const PHONE_CUE_LABELS: Record<NonNullable<PhoneCue>, { text: string; color: string }> = {
  ready: { text: 'PHONES READY', color: '#fbbf24' },
  up: { text: 'PHONES UP', color: '#4ade80' },
  down: { text: 'PHONES DOWN', color: '#f87171' },
};

export function ShowStepper({ step, phoneCue, advance }: ShowStepperProps) {
  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.sectionTitle}>Show Stepper</h2>
        <div style={styles.badges}>
          {phoneCue && (
            <span style={{
              ...styles.badge,
              backgroundColor: PHONE_CUE_LABELS[phoneCue].color + '22',
              color: PHONE_CUE_LABELS[phoneCue].color,
              borderColor: PHONE_CUE_LABELS[phoneCue].color + '44',
            }}>
              {PHONE_CUE_LABELS[phoneCue].text}
            </span>
          )}
          <span style={styles.hint}>Space / →</span>
        </div>
      </div>

      <button
        onClick={advance}
        disabled={step.blocked}
        style={{
          ...styles.nextBtn,
          ...(step.blocked ? styles.nextBtnBlocked : styles.nextBtnActive),
        }}
      >
        <span style={styles.nextLabel}>{step.label}</span>
        {step.blocked && step.blockReason && (
          <span style={styles.blockReason}>{step.blockReason}</span>
        )}
      </button>
    </section>
  );
}

const styles = {
  section: {
    padding: '16px 20px',
    borderBottom: '2px solid #1a1a1a',
    backgroundColor: '#0d0d0d',
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
  badges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    border: '1px solid',
  } as React.CSSProperties,
  hint: {
    fontSize: '0.65rem',
    color: '#444',
    letterSpacing: '0.05em',
  },
  nextBtn: {
    width: '100%',
    padding: '18px 24px',
    fontSize: '1.1rem',
    fontWeight: 700,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    transition: 'background-color 0.15s ease, opacity 0.15s ease',
  } as React.CSSProperties,
  nextBtnActive: {
    backgroundColor: '#f0f0f0',
    color: '#111',
  } as React.CSSProperties,
  nextBtnBlocked: {
    backgroundColor: '#1a1a1a',
    color: '#555',
    border: '1px solid #333',
    cursor: 'not-allowed',
    opacity: 0.7,
  } as React.CSSProperties,
  nextLabel: {
    fontSize: '1.1rem',
    fontWeight: 700,
  },
  blockReason: {
    fontSize: '0.75rem',
    fontWeight: 400,
    opacity: 0.7,
  },
};

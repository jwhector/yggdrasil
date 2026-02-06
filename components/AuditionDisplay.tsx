/**
 * AuditionDisplay Component
 *
 * Shows which option is currently being auditioned.
 * Displays all 4 options with the current one highlighted.
 */

'use client';

import type { Option } from '@/conductor/types';

interface AuditionDisplayProps {
  options: Option[];
  currentAuditionIndex: number | null;
}

export function AuditionDisplay({ options, currentAuditionIndex }: AuditionDisplayProps) {
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Listen</h2>
      <p style={styles.subtitle}>
        Auditioning options — voting opens soon
      </p>

      <div style={styles.optionsGrid}>
        {options.map((option, index) => {
          const isActive = index === currentAuditionIndex;
          return (
            <div
              key={option.id}
              style={{
                ...styles.optionCard,
                backgroundColor: isActive ? '#3b82f6' : '#262626',
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                boxShadow: isActive ? '0 0 30px #3b82f680' : 'none',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={styles.optionNumber}>{index + 1}</div>
              {isActive && (
                <div style={styles.activeIndicator}>Now Playing</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={styles.instruction}>
        Listen carefully. You'll vote next.
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '2rem',
    padding: '2rem',
    maxWidth: '600px',
    width: '100%',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold' as const,
    margin: 0,
    color: '#f5f5f5',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#a3a3a3',
    margin: 0,
    textAlign: 'center' as const,
  },
  optionsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
    width: '100%',
    marginTop: '1rem',
  },
  optionCard: {
    padding: '2rem',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    minHeight: '120px',
    cursor: 'default',
  },
  optionNumber: {
    fontSize: '2.5rem',
    fontWeight: 'bold' as const,
    color: '#ffffff',
  },
  activeIndicator: {
    fontSize: '0.875rem',
    color: '#ffffff',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontWeight: '600' as const,
  },
  instruction: {
    fontSize: '1rem',
    color: '#737373',
    textAlign: 'center' as const,
    marginTop: '1rem',
  },
};

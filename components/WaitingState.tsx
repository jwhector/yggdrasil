/**
 * WaitingState Component
 *
 * Displays a waiting message with subtle ambient animation.
 * Used in various phases when the audience is waiting.
 */

'use client';

import { useEffect, useState } from 'react';

interface WaitingStateProps {
  message?: string;
}

export function WaitingState({ message = 'Waiting for show to start...' }: WaitingStateProps) {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPulse((p) => (p + 1) % 100);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  const opacity = 0.4 + 0.3 * Math.sin((pulse / 100) * Math.PI * 2);

  return (
    <div style={styles.container}>
      <div style={styles.iconContainer}>
        <div
          style={{
            ...styles.pulsingDot,
            opacity,
          }}
        />
      </div>
      <p style={styles.message}>{message}</p>
      <p style={styles.submessage}>Your response has been saved</p>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2rem',
    padding: '2rem',
  },
  iconContainer: {
    width: '80px',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulsingDot: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    transition: 'opacity 0.05s linear',
  },
  message: {
    fontSize: '1.5rem',
    fontWeight: '500' as const,
    textAlign: 'center' as const,
    color: '#f5f5f5',
    margin: 0,
  },
  submessage: {
    fontSize: '1rem',
    textAlign: 'center' as const,
    color: '#737373',
    margin: 0,
  },
};

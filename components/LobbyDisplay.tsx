/**
 * LobbyDisplay Component
 *
 * Shows thematic content during lobby phase with subtle ambient animation.
 * Displays user count to show participation.
 */

'use client';

import { useEffect, useState } from 'react';

export interface LobbyDisplayProps {
  content: string;
  userCount: number;
}

export function LobbyDisplay({ content, userCount }: LobbyDisplayProps) {
  const [opacity, setOpacity] = useState(0.7);
  const [increasing, setIncreasing] = useState(true);

  // Subtle pulse animation (0.7 → 1.0 → 0.7 over 3 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setOpacity((prev) => {
        if (increasing) {
          if (prev >= 1.0) {
            setIncreasing(false);
            return 1.0;
          }
          return prev + 0.01;
        } else {
          if (prev <= 0.7) {
            setIncreasing(true);
            return 0.7;
          }
          return prev - 0.01;
        }
      });
    }, 15); // 3000ms / 200 steps ≈ 15ms per step

    return () => clearInterval(interval);
  }, [increasing]);

  return (
    <div style={styles.container}>
      {/* Main content with pulse animation */}
      <div style={{
        ...styles.content,
        opacity,
      }}>
        {content}
      </div>

      {/* User count badge (bottom right) */}
      <div style={styles.userCountBadge}>
        {userCount} {userCount === 1 ? 'person' : 'people'} joined
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#000',
    position: 'relative',
    padding: '4rem',
  } as React.CSSProperties,

  content: {
    fontSize: '2.5rem',
    lineHeight: '1.6',
    textAlign: 'center',
    color: '#fff',
    maxWidth: '800px',
    transition: 'opacity 0.3s ease-in-out',
    whiteSpace: 'pre-line', // Preserve line breaks in content
  } as React.CSSProperties,

  userCountBadge: {
    position: 'fixed',
    bottom: '2rem',
    right: '2rem',
    padding: '1rem 1.5rem',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '0.5rem',
    fontSize: '1.25rem',
    color: '#999',
    backdropFilter: 'blur(10px)',
  } as React.CSSProperties,
};

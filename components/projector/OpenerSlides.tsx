'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpenerSlide, OpenerSlidePosition } from '@/conductor/types';

interface OpenerSlidesProps {
  slides: OpenerSlide[];
  position: OpenerSlidePosition | null;
}

export function OpenerSlides({ slides, position }: OpenerSlidesProps) {
  const [fadeKey, setFadeKey] = useState(0);
  const prevPositionRef = useRef<OpenerSlidePosition | null>(null);

  // Track position changes to trigger fade animations
  useEffect(() => {
    const prev = prevPositionRef.current;
    const isNewPoint = position?.pointIndex !== prev?.pointIndex;
    if (isNewPoint) {
      setFadeKey(k => k + 1);
    }
    prevPositionRef.current = position;
  }, [position]);

  if (!position) {
    return <div style={styles.container} />;
  }

  const slide = slides[position.pointIndex];
  if (!slide) {
    return <div style={styles.container} />;
  }

  const visibleSubPoints = position.subPointIndex >= 0
    ? slide.subPoints?.slice(0, position.subPointIndex + 1) ?? []
    : [];

  return (
    <div style={styles.container}>
      <div key={`point-${fadeKey}`} style={styles.content}>
        <p style={styles.point}>{slide.point}</p>
        {visibleSubPoints.length > 0 && (
          <div style={styles.bulletList}>
            {visibleSubPoints.map((sub, i) => (
              <div
                key={`${fadeKey}-sub-${i}`}
                style={{
                  ...styles.bulletItem,
                  animation: 'openerFadeIn 0.4s ease-out both',
                }}
              >
                <span style={styles.bullet}>{'\u2022'}</span>
                <span>{sub}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{keyframes}</style>
    </div>
  );
}

const keyframes = `
  @keyframes openerFadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10vw',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '3vh',
    maxWidth: '75vw',
    animation: 'openerFadeIn 0.5s ease-out both',
  },
  point: {
    color: '#ffffff',
    fontSize: '3.5vw',
    fontWeight: 300,
    textAlign: 'left',
    lineHeight: 1.3,
    margin: 0,
    letterSpacing: '0.02em',
  },
  bulletList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5vh',
    paddingLeft: '2vw',
  },
  bulletItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '1.2vw',
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '2.5vw',
    fontWeight: 300,
    textAlign: 'left',
    lineHeight: 1.4,
  },
  bullet: {
    flexShrink: 0,
    fontSize: '2vw',
  },
};

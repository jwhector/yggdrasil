'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpenerSlide, OpenerSlidePosition, SlideMedia } from '@/conductor/types';
import { SlideMediaRenderer } from './opener/SlideMediaRenderer';
import { useMediaPreloader } from './opener/useMediaPreloader';

interface OpenerSlidesProps {
  slides: OpenerSlide[];
  position: OpenerSlidePosition | null;
}

/** Derive visibility flags from the linear stepIndex. */
function deriveVisibility(slide: OpenerSlide, stepIndex: number) {
  let showMedia = false;
  const subPointVis: { label: boolean; value: boolean }[] = [];

  let step = 0;
  if (slide.media) {
    step++;
    showMedia = stepIndex >= step;
  }
  for (const _sub of slide.subPoints ?? []) {
    step++;
    const showLabel = stepIndex >= step;
    step++;
    const showValue = stepIndex >= step;
    subPointVis.push({ label: showLabel, value: showValue });
  }

  return { showMedia, subPointVis };
}

function isVisualMedia(media: SlideMedia): boolean {
  return media.type === 'image' || media.type === 'video';
}

export function OpenerSlides({ slides, position }: OpenerSlidesProps) {
  const [fadeKey, setFadeKey] = useState(0);
  const prevPointRef = useRef<number | null>(null);

  useMediaPreloader(slides);

  // Track point changes to trigger title fade animation
  useEffect(() => {
    const isNewPoint = position?.pointIndex !== prevPointRef.current;
    if (isNewPoint) {
      setFadeKey(k => k + 1);
    }
    prevPointRef.current = position?.pointIndex ?? null;
  }, [position]);

  if (!position) {
    return <div style={styles.container} />;
  }

  const slide = slides[position.pointIndex];
  if (!slide) {
    return <div style={styles.container} />;
  }

  const { showMedia, subPointVis } = deriveVisibility(slide, position.stepIndex);
  const hasVisualMedia = slide.media && isVisualMedia(slide.media) && showMedia;

  return (
    <div style={styles.container}>
      {/* Title row — pinned at top, never moves */}
      <div key={`title-${fadeKey}`} style={styles.titleRow}>
        <p style={styles.point}>{slide.point}</p>
      </div>

      {/* Content row — two-column: text left, media right */}
      <div style={{
        ...styles.contentRow,
        gridTemplateColumns: hasVisualMedia ? '1fr 1fr' : '1fr',
      }}>
        {/* Left column: sub-points */}
        <div style={styles.leftColumn}>
          {subPointVis.map((vis, i) => {
            const sub = slide.subPoints![i];
            return (
              <div key={`${fadeKey}-sub-${i}`} style={styles.subPointGroup}>
                {vis.label && (
                  <div
                    key={`${fadeKey}-label-${i}`}
                    style={{
                      ...styles.subLabel,
                      animation: 'openerFadeIn 0.4s ease-out both',
                    }}
                  >
                    {sub.label}
                  </div>
                )}
                {vis.value && (
                  <div
                    key={`${fadeKey}-value-${i}`}
                    style={{
                      ...styles.subValue,
                      animation: 'openerFadeIn 0.4s ease-out both',
                    }}
                  >
                    {sub.value}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right column: visual media */}
        {hasVisualMedia && (
          <div style={styles.rightColumn}>
            <div style={{ animation: 'openerFadeIn 0.5s ease-out both' }}>
              <SlideMediaRenderer media={slide.media!} />
            </div>
          </div>
        )}
      </div>

      {/* Audio media — non-visual, rendered outside columns */}
      {showMedia && slide.media && !isVisualMedia(slide.media) && (
        <div style={{ animation: 'openerFadeIn 0.4s ease-out both' }}>
          <SlideMediaRenderer media={slide.media} />
        </div>
      )}

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
    height: '100vh',
    width: '100vw',
    backgroundColor: '#000',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    overflow: 'hidden',
    padding: '0 8vw',
  },
  titleRow: {
    paddingTop: '8vh',
    paddingBottom: '4vh',
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
  contentRow: {
    display: 'grid',
    gap: '4vw',
    alignItems: 'start',
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3vh',
  },
  rightColumn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    maxHeight: '65vh',
  },
  subPointGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.8vh',
    paddingLeft: '2vw',
  },
  subLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '2vw',
    fontWeight: 400,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    lineHeight: 1.4,
  },
  subValue: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '2.5vw',
    fontWeight: 300,
    lineHeight: 1.4,
  },
};

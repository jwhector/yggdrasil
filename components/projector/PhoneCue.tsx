/**
 * PhoneCue
 *
 * Projector overlay using phone/no-phone SVG icons to signal audience.
 * On cue change: icon fades in large at center (1.5s), then shrinks to
 * top-left corner as a persistent reference. Fades out when cue becomes null.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import type { PhoneCue as PhoneCueType } from '@/hooks/useShowStepper';

interface PhoneCueProps {
  cue: PhoneCueType;
}

/** Map cue → SVG path and tint color */
const CUE_CONFIG: Record<NonNullable<PhoneCueType>, { src: string; color: string }> = {
  ready: { src: '/phone.svg', color: '#fbbf24' },
  up:    { src: '/phone.svg', color: '#4ade80' },
  down:  { src: '/no-phone.svg', color: '#f87171' },
};

const SPLASH_MS = 1500;
const FADE_MS = 500;

type Phase = 'hidden' | 'splash' | 'corner' | 'fading-out';

export function PhoneCue({ cue }: PhoneCueProps) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [activeCue, setActiveCue] = useState<NonNullable<PhoneCueType> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (cue === null) {
      if (phase === 'hidden') return;
      // Fade out from wherever we are
      setPhase('fading-out');
      timerRef.current = setTimeout(() => {
        setPhase('hidden');
        setActiveCue(null);
      }, FADE_MS);
      return;
    }

    // New cue: show splash
    setActiveCue(cue);
    setPhase('splash');

    timerRef.current = setTimeout(() => {
      setPhase('corner');
    }, SPLASH_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cue]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'hidden' || !activeCue) return null;

  const config = CUE_CONFIG[activeCue];
  const isSplash = phase === 'splash';
  const isFadingOut = phase === 'fading-out';

  return (
    <>
      <style>{animationStyles}</style>
      <div
        style={{
          position: 'fixed',
          zIndex: 1000,
          pointerEvents: 'none',
          // Splash: centered. Corner/fading: top-left.
          ...(isSplash ? splashPosition : cornerPosition),
          opacity: isFadingOut ? 0 : 1,
          transition: [
            `top ${FADE_MS}ms ease`,
            `left ${FADE_MS}ms ease`,
            `transform ${FADE_MS}ms ease`,
            `opacity ${FADE_MS}ms ease`,
          ].join(', '),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: isSplash ? '20px' : '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            border: `2px solid ${config.color}44`,
            backdropFilter: 'blur(8px)',
            // Splash: large container. Corner: compact.
            padding: isSplash ? '32px' : '10px',
            transition: `padding ${FADE_MS}ms ease, border-radius ${FADE_MS}ms ease`,
          }}
        >
          {/*
            Use CSS filter to tint the SVG icon to the cue color.
            The SVGs have fill="#e8e4df" — we overlay a colored tint via filter.
          */}
          <img
            src={config.src}
            alt=""
            className="phone-cue-icon"
            style={{
              width: isSplash ? '120px' : '32px',
              height: isSplash ? '120px' : '32px',
              transition: `width ${FADE_MS}ms ease, height ${FADE_MS}ms ease`,
              filter: colorToFilter(config.color),
            }}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

const splashPosition: React.CSSProperties = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

const cornerPosition: React.CSSProperties = {
  top: '24px',
  left: '24px',
  transform: 'translate(0, 0)',
};

// ---------------------------------------------------------------------------
// Color filter approximations for tinting the white-ish SVGs
// ---------------------------------------------------------------------------

function colorToFilter(hex: string): string {
  // Approximate CSS filters to tint the #e8e4df SVG fill to target colors
  switch (hex) {
    case '#fbbf24': // yellow/amber (ready)
      return 'brightness(0) saturate(100%) invert(78%) sepia(60%) saturate(600%) hue-rotate(5deg) brightness(100%)';
    case '#4ade80': // green (up)
      return 'brightness(0) saturate(100%) invert(75%) sepia(40%) saturate(500%) hue-rotate(90deg) brightness(105%)';
    case '#f87171': // red (down)
      return 'brightness(0) saturate(100%) invert(55%) sepia(80%) saturate(600%) hue-rotate(325deg) brightness(105%)';
    default:
      return 'none';
  }
}

// ---------------------------------------------------------------------------
// CSS for entrance animation
// ---------------------------------------------------------------------------

const animationStyles = `
  .phone-cue-icon {
    display: block;
  }
`;

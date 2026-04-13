/**
 * PhoneCue
 *
 * Full-width projector overlay telling the audience when to pick up or
 * put down their phones. Fades in/out on state changes.
 * The "down" cue auto-fades after a few seconds.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import type { PhoneCue as PhoneCueType } from '@/hooks/useShowStepper';

interface PhoneCueProps {
  cue: PhoneCueType;
}

const CUE_CONFIG: Record<NonNullable<PhoneCueType>, { text: string; color: string }> = {
  ready: { text: 'GET YOUR PHONES READY', color: '#fbbf24' },
  up: { text: 'VOTE NOW', color: '#4ade80' },
  down: { text: 'PHONES DOWN', color: '#f87171' },
};

const DOWN_DISPLAY_MS = 4000;
const FADE_MS = 600;

export function PhoneCue({ cue }: PhoneCueProps) {
  const [visible, setVisible] = useState(false);
  const [displayCue, setDisplayCue] = useState<NonNullable<PhoneCueType> | null>(null);
  const downTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (downTimer.current) {
      clearTimeout(downTimer.current);
      downTimer.current = null;
    }

    if (cue === null) {
      setVisible(false);
      return;
    }

    setDisplayCue(cue);
    setVisible(true);

    if (cue === 'down') {
      downTimer.current = setTimeout(() => {
        setVisible(false);
      }, DOWN_DISPLAY_MS);
    }

    return () => {
      if (downTimer.current) {
        clearTimeout(downTimer.current);
        downTimer.current = null;
      }
    };
  }, [cue]);

  if (!displayCue) return null;

  const config = CUE_CONFIG[displayCue];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        padding: '32px 0',
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <div
        style={{
          padding: '16px 48px',
          borderRadius: '12px',
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          border: `2px solid ${config.color}44`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <span
          style={{
            fontSize: '2rem',
            fontWeight: 800,
            color: config.color,
            letterSpacing: '0.12em',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {config.text}
        </span>
      </div>
    </div>
  );
}

'use client';

/**
 * AuditionProgress
 *
 * Compact progress indicator during song-building auditioning phase.
 * Shows which option (A/B) is currently playing, a bar-level progress bar,
 * and a countdown timer for the voting window.
 *
 * Receives data at ~4 Hz from the server via the useAuditionProgress hook.
 * CSS transitions smooth the 250ms update intervals.
 */

import type { AuditionProgress as AuditionProgressData } from '@/conductor/types';

interface AuditionProgressProps {
  progress: AuditionProgressData;
}

export function AuditionProgress({ progress }: AuditionProgressProps) {
  const { currentOption, barProgress, votingWindowMs, elapsedMs } = progress;

  const remainingMs = Math.max(0, votingWindowMs - elapsedMs);
  const remainingSec = Math.ceil(remainingMs / 1000);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        padding: '8px 4px',
      }}
    >
      {/* Current option indicator */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        <OptionPill option="A" active={currentOption === 'A'} />
        <OptionPill option="B" active={currentOption === 'B'} />
      </div>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: '4px',
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(barProgress * 100, 100)}%`,
            backgroundColor: 'rgba(255,255,255,0.4)',
            borderRadius: '2px',
            transition: 'width 250ms linear',
          }}
        />
      </div>

      {/* Countdown */}
      <span
        style={{
          fontSize: '0.75rem',
          color: remainingSec <= 3 ? 'rgba(255,200,100,0.9)' : 'rgba(255,255,255,0.4)',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '24px',
          textAlign: 'right',
          flexShrink: 0,
          transition: 'color 0.3s ease',
        }}
      >
        {remainingSec}s
      </span>
    </div>
  );
}

function OptionPill({ option, active }: { option: 'A' | 'B'; active: boolean }) {
  return (
    <span
      style={{
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        padding: '2px 6px',
        borderRadius: '3px',
        backgroundColor: active ? 'rgba(255,255,255,0.2)' : 'transparent',
        color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)',
        transition: 'all 0.15s ease',
      }}
    >
      {option}
    </span>
  );
}

'use client';

/**
 * AuditionBars
 *
 * Depleting progress bars during song-building audition phase.
 * - Per-option bar: depletes as the current option plays
 * - Overall bar: depletes as total voting time runs out
 * - Countdown text
 */

import type { AuditionProgress } from '@/conductor/types';
import type { Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

interface AuditionBarsProps {
  progress: AuditionProgress;
  chapter: Chapter;
  currentAuditionOption: 'A' | 'B' | null;
}

export function AuditionBars({ progress, chapter, currentAuditionOption }: AuditionBarsProps) {
  const { barProgress, votingWindowMs, elapsedMs } = progress;
  const chapterIdentity = getChapterIdentity(chapter);

  const optionColor = currentAuditionOption === 'A'
    ? chapterIdentity.colorA
    : currentAuditionOption === 'B'
    ? chapterIdentity.colorB
    : chapterIdentity.color;

  // Per-option bar depletes (1 → 0)
  const optionRemaining = Math.max(0, 1 - barProgress);

  // Overall bar depletes (1 → 0)
  const totalRemaining = Math.max(0, 1 - Math.min(1, elapsedMs / votingWindowMs));

  const remainingSec = Math.max(0, Math.ceil((votingWindowMs - elapsedMs) / 1000));

  return (
    <div style={{ width: '100%', padding: '0 14px' }}>
      {/* Per-option depleting bar */}
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${optionRemaining * 100}%`,
            backgroundColor: optionColor,
            opacity: 0.3,
            borderRadius: '4px',
            transition: 'width 250ms linear',
          }}
        />
      </div>

      {/* Overall depleting bar */}
      <div
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderRadius: '3px',
          overflow: 'hidden',
          marginTop: '14px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${totalRemaining * 100}%`,
            backgroundColor: chapterIdentity.color,
            opacity: 0.15,
            borderRadius: '3px',
            transition: 'width 250ms linear',
          }}
        />
      </div>

      {/* Countdown */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '8px',
          fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.12)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.05em',
        }}
      >
        {remainingSec}s remaining
      </div>
    </div>
  );
}

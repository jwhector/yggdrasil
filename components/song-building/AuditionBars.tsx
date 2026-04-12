'use client';

/**
 * AuditionBars
 *
 * Overall voting window timer during song-building audition phase.
 * Per-option bars now live inside OptionCards.
 * - Overall bar: depletes as total voting time runs out
 * - Countdown text
 */

import type { AuditionProgress } from '@/conductor/types';
import type { Chapter } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

interface AuditionBarsProps {
  progress: AuditionProgress;
  chapter: Chapter;
}

export function AuditionBars({ progress, chapter }: AuditionBarsProps) {
  const { votingWindowMs, elapsedMs } = progress;
  const chapterIdentity = getChapterIdentity(chapter);

  // Overall bar depletes (1 → 0)
  const totalRemaining = Math.max(0, 1 - Math.min(1, elapsedMs / votingWindowMs));

  const remainingSec = Math.max(0, Math.ceil((votingWindowMs - elapsedMs) / 1000));

  return (
    <div style={{ width: '100%', padding: '0 14px' }}>
      {/* Overall depleting bar */}
      <div
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderRadius: '3px',
          overflow: 'hidden',
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

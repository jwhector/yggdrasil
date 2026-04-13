'use client';

import { useEffect, useRef } from 'react';
import type { SlideMedia } from '@/conductor/types';

interface SlideAudioProps {
  media: SlideMedia;
}

export function SlideAudio({ media }: SlideAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.load();
    if (media.autoplay !== false) {
      el.play().catch(() => {});
    }
    return () => {
      el.pause();
      el.currentTime = 0;
    };
  }, [media.src, media.autoplay]);

  return (
    <div style={styles.container}>
      <div style={styles.indicator}>
        <span style={styles.pulse} />
        <span style={styles.label}>Playing audio</span>
      </div>
      <audio
        ref={audioRef}
        src={media.src}
        loop={media.loop ?? false}
      />
      <style>{keyframes}</style>
    </div>
  );
}

const keyframes = `
  @keyframes audioPulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.2); }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
  },
  indicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '1vw',
  },
  pulse: {
    display: 'inline-block',
    width: '1.2vw',
    height: '1.2vw',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    animation: 'audioPulse 1.5s ease-in-out infinite',
  },
  label: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '1.5vw',
    fontWeight: 300,
    fontStyle: 'italic',
  },
};

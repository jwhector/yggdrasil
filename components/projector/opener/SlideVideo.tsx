'use client';

import { useEffect, useRef } from 'react';
import type { SlideMedia } from '@/conductor/types';

interface SlideVideoProps {
  media: SlideMedia;
}

export function SlideVideo({ media }: SlideVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reset video when src changes
  useEffect(() => {
    const el = videoRef.current;
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
    <video
      ref={videoRef}
      src={media.src}
      autoPlay={media.autoplay !== false}
      loop={media.loop ?? false}
      muted={media.muted !== false}
      playsInline
      style={styles.video}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  video: {
    maxWidth: '100%',
    maxHeight: '60vh',
    objectFit: 'contain',
    borderRadius: '4px',
  },
};

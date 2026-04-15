'use client';

import { useEffect, useRef } from 'react';
import type { SlideMedia } from '@/conductor/types';

interface SlideVideoProps {
  media: SlideMedia;
  onMediaReady?: () => void;
}

export function SlideVideo({ media, onMediaReady }: SlideVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const firedRef = useRef(false);

  // Reset video when src changes
  useEffect(() => {
    firedRef.current = false;
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

  // Fire onMediaReady once the video actually starts playing
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !onMediaReady || !media.trackIndices?.length) return;

    const handlePlaying = () => {
      if (!firedRef.current) {
        firedRef.current = true;
        onMediaReady();
      }
    };

    el.addEventListener('playing', handlePlaying);
    return () => el.removeEventListener('playing', handlePlaying);
  }, [onMediaReady, media.trackIndices]);

  return (
    <video
      ref={videoRef}
      src={media.src}
      autoPlay={media.autoplay !== false}
      loop={media.loop ?? false}
      muted={media.trackIndices?.length ? true : media.muted !== false}
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

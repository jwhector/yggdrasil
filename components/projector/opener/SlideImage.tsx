'use client';

import type { SlideMedia } from '@/conductor/types';

interface SlideImageProps {
  media: SlideMedia;
}

export function SlideImage({ media }: SlideImageProps) {
  return (
    <img
      src={media.src}
      alt={media.alt ?? ''}
      style={styles.image}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  image: {
    maxWidth: '100%',
    maxHeight: '60vh',
    objectFit: 'contain',
    borderRadius: '4px',
  },
};

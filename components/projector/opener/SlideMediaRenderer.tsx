'use client';

import type { SlideMedia } from '@/conductor/types';
import { SlideImage } from './SlideImage';
import { SlideVideo } from './SlideVideo';
import { SlideAudio } from './SlideAudio';

interface SlideMediaRendererProps {
  media: SlideMedia;
  onMediaReady?: () => void;
}

export function SlideMediaRenderer({ media, onMediaReady }: SlideMediaRendererProps) {
  switch (media.type) {
    case 'image':
      return <SlideImage media={media} />;
    case 'video':
      return <SlideVideo media={media} onMediaReady={onMediaReady} />;
    case 'audio':
      return <SlideAudio media={media} onMediaReady={onMediaReady} />;
    default:
      return null;
  }
}

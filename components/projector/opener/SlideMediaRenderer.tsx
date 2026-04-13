'use client';

import type { SlideMedia } from '@/conductor/types';
import { SlideImage } from './SlideImage';
import { SlideVideo } from './SlideVideo';
import { SlideAudio } from './SlideAudio';

interface SlideMediaRendererProps {
  media: SlideMedia;
}

export function SlideMediaRenderer({ media }: SlideMediaRendererProps) {
  switch (media.type) {
    case 'image':
      return <SlideImage media={media} />;
    case 'video':
      return <SlideVideo media={media} />;
    case 'audio':
      return <SlideAudio media={media} />;
    default:
      return null;
  }
}

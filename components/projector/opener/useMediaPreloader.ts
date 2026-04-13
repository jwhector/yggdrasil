import { useEffect } from 'react';
import type { OpenerSlide } from '@/conductor/types';

/** Preload all media assets from opener slides on mount. */
export function useMediaPreloader(slides: OpenerSlide[]): void {
  useEffect(() => {
    const srcs = new Set<string>();

    for (const slide of slides) {
      if (slide.media?.src) srcs.add(slide.media.src);
    }

    for (const src of srcs) {
      if (/\.(jpe?g|png|webp|gif|svg)$/i.test(src)) {
        const img = new Image();
        img.src = src;
      } else {
        // Video/audio: prime the browser cache
        fetch(src).catch(() => {});
      }
    }
  }, [slides]);
}

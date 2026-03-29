'use client';

import { useState, useRef, useEffect } from 'react';

interface AudioPreviewHook {
  play: (fragmentId: string, url: string) => void;
  stop: () => void;
  currentId: string | null;
  isPlaying: boolean;
}

export function useAudioPreview(): AudioPreviewHook {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function play(fragmentId: string, url: string): void {
    // Same fragment — toggle pause/resume
    if (currentIdRef.current === fragmentId && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => { /* ignore */ });
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    // Different fragment — stop current and start new
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(url);
    audio.preload = 'none';
    audioRef.current = audio;
    currentIdRef.current = fragmentId;
    setCurrentId(fragmentId);

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
    });

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(() => {
      // Preview file may not exist in dev — silent failure
      setIsPlaying(false);
      setCurrentId(null);
      currentIdRef.current = null;
      audioRef.current = null;
    });
  }

  function stop(): void {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    currentIdRef.current = null;
    setCurrentId(null);
    setIsPlaying(false);
  }

  return { play, stop, currentId, isPlaying };
}

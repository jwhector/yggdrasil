/**
 * useAuditionProgress Hook
 *
 * Receives high-frequency audition progress events (~4 Hz) from the server
 * during song-building auditioning phase. Bypasses state_sync for low latency.
 */

'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AuditionProgress } from '@/conductor/types';

export function useAuditionProgress(
  socket: Socket | null,
  phase: string | undefined,
  layerPhase: string | undefined,
): AuditionProgress | null {
  const [progress, setProgress] = useState<AuditionProgress | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleProgress = (data: AuditionProgress) => {
      setProgress(data);
    };

    socket.on('audition_progress', handleProgress);
    return () => {
      socket.off('audition_progress', handleProgress);
    };
  }, [socket]);

  // Clear progress when not in auditioning phase
  useEffect(() => {
    if (phase !== 'attempt_build' || layerPhase !== 'auditioning') {
      setProgress(null);
    }
  }, [phase, layerPhase]);

  return progress;
}

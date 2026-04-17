/**
 * useProjectorThoughts Hook
 *
 * Subscribes to intrusive thought events for the projector canvas.
 * Bridges socket events to the module-level physics engine (no React re-renders).
 */

'use client';

import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { initThoughts, clearThoughts } from '@/components/projector/renderers/thoughts-physics';

interface ThoughtsStatePayload {
  thoughts: { id: string; text: string }[];
}

export function useProjectorThoughts(socket: Socket | null): void {
  useEffect(() => {
    if (!socket) return;

    const handleState = (data: ThoughtsStatePayload) => {
      initThoughts(data.thoughts);
    };

    const handleClear = () => {
      clearThoughts();
    };

    socket.on('thoughts_state', handleState);
    socket.on('thoughts_clear', handleClear);

    return () => {
      socket.off('thoughts_state', handleState);
      socket.off('thoughts_clear', handleClear);
    };
  }, [socket]);
}

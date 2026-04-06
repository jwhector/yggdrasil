/**
 * useProjectorThoughts Hook
 *
 * Subscribes to intrusive thought events for the projector canvas.
 * Bridges socket events to the module-level physics engine (no React re-renders).
 */

'use client';

import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { initThoughts, dismissThought, clearThoughts } from '@/components/projector/renderers/thoughts-physics';

interface ThoughtsStatePayload {
  thoughts: { id: string; text: string; dismissed: boolean }[];
}

interface ThoughtDismissedPayload {
  thoughtId: string;
  direction: 'left' | 'right';
}

export function useProjectorThoughts(socket: Socket | null): void {
  useEffect(() => {
    if (!socket) return;

    const handleState = (data: ThoughtsStatePayload) => {
      // Filter to non-dismissed thoughts and init the physics engine
      const active = data.thoughts.filter(t => !t.dismissed);
      initThoughts(active);
    };

    const handleDismissed = (data: ThoughtDismissedPayload) => {
      dismissThought(data.thoughtId, data.direction);
    };

    const handleClear = () => {
      clearThoughts();
    };

    socket.on('thoughts_state', handleState);
    socket.on('thought_dismissed', handleDismissed);
    socket.on('thoughts_clear', handleClear);

    return () => {
      socket.off('thoughts_state', handleState);
      socket.off('thought_dismissed', handleDismissed);
      socket.off('thoughts_clear', handleClear);
    };
  }, [socket]);
}

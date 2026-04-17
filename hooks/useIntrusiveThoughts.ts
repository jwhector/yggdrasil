/**
 * useIntrusiveThoughts Hook
 *
 * Subscribes to server-assigned intrusive thoughts after collapse.
 * Thoughts display until the server clears them on phase advance.
 */

'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

interface AssignedThought {
  id: string;
  text: string;
}

interface UseIntrusiveThoughtsResult {
  thoughts: AssignedThought[];
  hasThoughts: boolean;
}

export function useIntrusiveThoughts(
  socket: Socket | null,
  phase: string | undefined,
  layerPhase: string | undefined,
): UseIntrusiveThoughtsResult {
  const [thoughts, setThoughts] = useState<AssignedThought[]>([]);

  // Listen for server-assigned thoughts
  useEffect(() => {
    if (!socket) return;

    const handleAssigned = (data: { thoughts: AssignedThought[] }) => {
      setThoughts(data.thoughts);
    };

    const handleClear = () => {
      setThoughts([]);
    };

    socket.on('thoughts_assigned', handleAssigned);
    socket.on('thoughts_clear', handleClear);

    return () => {
      socket.off('thoughts_assigned', handleAssigned);
      socket.off('thoughts_clear', handleClear);
    };
  }, [socket]);

  // Clear thoughts when returning to auditioning (new layer started)
  useEffect(() => {
    if (layerPhase === 'auditioning' || layerPhase === 'locked') {
      setThoughts([]);
    }
  }, [layerPhase]);

  return {
    thoughts,
    hasThoughts: thoughts.length > 0,
  };
}

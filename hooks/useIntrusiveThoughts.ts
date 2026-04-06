/**
 * useIntrusiveThoughts Hook
 *
 * Subscribes to server-assigned intrusive thoughts during reveal phases.
 * Provides the current thought list and a dismiss function that notifies the server.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';

interface AssignedThought {
  id: string;
  text: string;
}

interface UseIntrusiveThoughtsResult {
  thoughts: AssignedThought[];
  dismissThought: (id: string, direction: 'left' | 'right') => void;
  allDismissed: boolean;
  hasThoughts: boolean;
}

export function useIntrusiveThoughts(
  socket: Socket | null,
  phase: string | undefined,
  layerPhase: string | undefined,
): UseIntrusiveThoughtsResult {
  const [thoughts, setThoughts] = useState<AssignedThought[]>([]);
  const hadThoughtsRef = useRef(false);

  // Listen for server-assigned thoughts
  useEffect(() => {
    if (!socket) return;

    const handleAssigned = (data: { thoughts: AssignedThought[] }) => {
      setThoughts(data.thoughts);
      hadThoughtsRef.current = true;
    };

    const handleClear = () => {
      setThoughts([]);
      hadThoughtsRef.current = false;
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
      hadThoughtsRef.current = false;
    }
  }, [layerPhase]);

  // Dismiss a thought: remove locally + notify server
  const dismissThought = useCallback((id: string, direction: 'left' | 'right') => {
    setThoughts(prev => prev.filter(t => t.id !== id));
    socket?.emit('dismiss_thought', { thoughtId: id, direction });
  }, [socket]);

  const allDismissed = hadThoughtsRef.current && thoughts.length === 0;

  return {
    thoughts,
    dismissThought,
    allDismissed,
    hasThoughts: thoughts.length > 0,
  };
}

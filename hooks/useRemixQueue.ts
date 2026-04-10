/**
 * useRemixQueue Hook (V3.4)
 *
 * Controller queue management for the performer remix phase.
 * Sends QUEUE_TOKEN and CANCEL_QUEUE commands with optimistic local state.
 * Reconciles with server state on each state_sync.
 */

'use client';

import { useCallback, useState } from 'react';
import type { ConductorCommand } from '@/conductor/types';

export interface RemixQueueActions {
  /** Queue a token for a granular type with a specific chapter. */
  queueToken: (granularType: string, chapterId: string, instant?: boolean) => void;
  /** Cancel the last queued token for a granular type. */
  cancelQueue: (granularType: string) => void;
  /** Optimistic queue depths — used for immediate UI feedback. */
  optimisticQueue: Map<string, number>;
}

export function useRemixQueue(
  sendCommand: (cmd: ConductorCommand) => void,
): RemixQueueActions {
  // Optimistic local queue depth per granular type (incremented on queue, decremented on cancel)
  const [optimisticQueue, setOptimisticQueue] = useState<Map<string, number>>(new Map());

  const queueToken = useCallback((granularType: string, chapterId: string, instant?: boolean) => {
    sendCommand({ type: 'QUEUE_TOKEN', granularType, chapterId, instant });
    setOptimisticQueue(prev => {
      const next = new Map(prev);
      next.set(granularType, (next.get(granularType) ?? 0) + 1);
      return next;
    });
  }, [sendCommand]);

  const cancelQueue = useCallback((granularType: string) => {
    sendCommand({ type: 'CANCEL_QUEUE', granularType });
    setOptimisticQueue(prev => {
      const next = new Map(prev);
      const current = next.get(granularType) ?? 0;
      if (current > 0) next.set(granularType, current - 1);
      return next;
    });
  }, [sendCommand]);

  return { queueToken, cancelQueue, optimisticQueue };
}

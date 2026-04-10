/**
 * useTokenPool Hook (V3.4)
 *
 * Subscribes to the pool_state socket event (~2 Hz) during finale_vote and
 * finale_remix phases. Provides pool counts by chapter and total remaining.
 */

'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

export interface PoolState {
  availableByChapter: Array<{ chapterId: string; count: number }>;
  totalByChapter: Array<{ chapterId: string; count: number }>;
  totalRemaining: number;
}

const EMPTY_POOL: PoolState = {
  availableByChapter: [],
  totalByChapter: [],
  totalRemaining: 0,
};

export function useTokenPool(socket: Socket | null): PoolState {
  const [pool, setPool] = useState<PoolState>(EMPTY_POOL);

  useEffect(() => {
    if (!socket) return;

    const handlePoolState = (data: PoolState) => {
      setPool(data);
    };

    socket.on('pool_state', handlePoolState);
    return () => { socket.off('pool_state', handlePoolState); };
  }, [socket]);

  return pool;
}

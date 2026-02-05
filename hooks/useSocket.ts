/**
 * useSocket Hook
 *
 * Manages Socket.IO connection with automatic reconnection and exponential backoff.
 * Handles client identity persistence and state synchronization.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { UserId, ShowId, SeatId } from '@/conductor/types';
import { getOrCreateIdentity, updateLastVersion } from '@/lib/storage';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface SocketHookReturn {
  socket: Socket | null;
  connectionState: ConnectionState;
  userId: UserId | null;
  emit: (event: string, data: any) => void;
  reconnect: () => void;
}

interface UseSocketOptions {
  showId: ShowId;
  seatId?: SeatId | null;
  mode: 'audience' | 'projector' | 'controller';
}

const MAX_BACKOFF_MS = 10000; // 10 seconds
const INITIAL_BACKOFF_MS = 1000; // 1 second

export function useSocket({ showId, seatId = null, mode }: UseSocketOptions): SocketHookReturn {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [userId, setUserId] = useState<UserId | null>(null);

  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<Socket | null>(null); // Track socket for cleanup

  // Calculate exponential backoff delay
  const getBackoffDelay = useCallback(() => {
    const delay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, reconnectAttempts.current),
      MAX_BACKOFF_MS
    );
    return delay;
  }, []);

  // Connect or reconnect to socket
  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Prevent double connections (React Strict Mode)
    if (socketRef.current?.connected) {
      console.log('[Socket] Already connected, skipping');
      return;
    }

    // Clean up existing socket if any
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setConnectionState('connecting');

    // Get or create client identity
    const identity = getOrCreateIdentity(showId, seatId);
    setUserId(identity.userId);

    // Create socket connection
    const newSocket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: false, // We'll handle reconnection manually
    });

    // Track socket in ref for cleanup
    socketRef.current = newSocket;

    // Connection established
    newSocket.on('connect', () => {
      console.log('[Socket] Connected');
      setConnectionState('connected');
      reconnectAttempts.current = 0;

      // Send join event
      newSocket.emit('join', {
        userId: identity.userId,
        showId: identity.showId,
        seatId: identity.seatId,
        mode,
        lastVersion: identity.lastVersion,
      });
    });

    // Respond to server heartbeat pings
    newSocket.on('ping', () => {
      newSocket.emit('pong');
    });

    // Connection error
    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
      setConnectionState('reconnecting');
      scheduleReconnect();
    });

    // Disconnection
    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setConnectionState('reconnecting');

      // Only auto-reconnect if not a manual disconnect
      if (reason !== 'io client disconnect') {
        scheduleReconnect();
      }
    });

    // State sync - update our version
    newSocket.on('state_sync', (data: any) => {
      if (data.state?.version) {
        updateLastVersion(data.state.version);
      }
    });

    // Forced reconnect from server
    newSocket.on('force_reconnect', (data: { reason: string }) => {
      console.log('[Socket] Force reconnect:', data.reason);
      newSocket.disconnect();
      setTimeout(() => connect(), 100);
    });

    setSocket(newSocket);
  }, [showId, seatId, mode]);

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }

    const delay = getBackoffDelay();
    console.log(`[Socket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);

    reconnectTimeout.current = setTimeout(() => {
      reconnectAttempts.current += 1;
      connect();
    }, delay);
  }, [connect, getBackoffDelay]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  // Emit helper
  const emit = useCallback((event: string, data: any) => {
    if (socket && socket.connected) {
      socket.emit(event, data);
    } else {
      console.warn('[Socket] Cannot emit - not connected:', event);
    }
  }, [socket]);

  // Initialize connection on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      // Use ref for cleanup since state may be stale
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  return {
    socket,
    connectionState,
    userId,
    emit,
    reconnect,
  };
}

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
  const lastPongTime = useRef<number>(Date.now()); // Track last successful pong
  const isConnecting = useRef(false); // Prevent concurrent connection attempts

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

    // Prevent concurrent connection attempts
    if (isConnecting.current) {
      console.log('[Socket] Connection attempt already in progress, skipping');
      return;
    }

    // Prevent double connections only if truly connected AND recently received pong
    const timeSinceLastPong = Date.now() - lastPongTime.current;
    const CONNECTION_HEALTH_THRESHOLD = 30000; // 30 seconds

    if (socketRef.current?.connected && timeSinceLastPong < CONNECTION_HEALTH_THRESHOLD) {
      console.log('[Socket] Already connected and healthy, skipping');
      return;
    }

    // Clean up existing socket if any
    if (socketRef.current) {
      console.log('[Socket] Cleaning up stale socket');
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    isConnecting.current = true;
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
      isConnecting.current = false;
      lastPongTime.current = Date.now();

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
      lastPongTime.current = Date.now();
    });

    // Connection error
    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
      setConnectionState('reconnecting');
      isConnecting.current = false;
      scheduleReconnect();
    });

    // Disconnection
    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setConnectionState('reconnecting');
      isConnecting.current = false;

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
      // Reset connecting flag for React Strict Mode double-mount
      isConnecting.current = false;
    };
  }, [connect]);

  // Handle page visibility changes (app backgrounding/foregrounding)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkConnectionHealth = () => {
      const timeSinceLastPong = Date.now() - lastPongTime.current;
      const CONNECTION_STALE_THRESHOLD = 30000; // 30 seconds

      // Force reconnect if:
      // 1. No socket exists, or
      // 2. Socket is not connected, or
      // 3. Haven't received pong in a while (stale connection)
      if (
        !socketRef.current ||
        !socketRef.current.connected ||
        timeSinceLastPong > CONNECTION_STALE_THRESHOLD
      ) {
        console.log('[Socket] Connection stale or broken, forcing reconnect', {
          hasSocket: !!socketRef.current,
          isConnected: socketRef.current?.connected,
          timeSinceLastPong,
        });

        // Force reconnect
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        isConnecting.current = false;
        reconnectAttempts.current = 0;
        connect();
      } else {
        console.log('[Socket] Connection healthy');
      }
    };

    const handleVisibilityChange = () => {
      // When page becomes visible again
      if (document.visibilityState === 'visible') {
        console.log('[Socket] Page became visible, checking connection health');
        checkConnectionHealth();
      }
    };

    const handleFocus = () => {
      // When window gains focus (backup for visibility API)
      console.log('[Socket] Window focused, checking connection health');
      checkConnectionHealth();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
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

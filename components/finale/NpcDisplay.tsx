'use client';

/**
 * NpcDisplay
 *
 * Terminal-style NPC message display. Subscribes directly to 'npc_message'
 * socket events (high-frequency channel, not state_sync).
 * Reveals text via typewriter animation, then auto-fades after a configurable duration.
 */

import { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

interface NpcDisplayProps {
  socket: Socket | null;
  fadeDurationMs?: number;  // how long to show after typewriter completes (default 5000)
}

const CHAR_INTERVAL_MS = 30;

export function NpcDisplay({ socket, fadeDurationMs = 5000 }: NpcDisplayProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  const pendingMessageRef = useRef<string | null>(null);
  const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (typeIntervalRef.current) clearInterval(typeIntervalRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  };

  const startTypewriter = (message: string) => {
    clearTimers();
    setDisplayedText('');
    setVisible(true);
    setFading(false);

    let i = 0;
    typeIntervalRef.current = setInterval(() => {
      i++;
      setDisplayedText(message.slice(0, i));
      if (i >= message.length) {
        if (typeIntervalRef.current) clearInterval(typeIntervalRef.current);
        // Start fade timer
        fadeTimerRef.current = setTimeout(() => {
          setFading(true);
          setTimeout(() => setVisible(false), 600); // fade out duration
        }, fadeDurationMs);
      }
    }, CHAR_INTERVAL_MS);
  };

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { message: string }) => {
      startTypewriter(data.message);
    };
    socket.on('npc_message', handler);
    return () => {
      socket.off('npc_message', handler);
      clearTimers();
    };
  }, [socket, fadeDurationMs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div
      style={{
        width: '100%',
        padding: '12px 0',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.6s ease',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '0.85rem',
          color: '#4ade80',
          letterSpacing: '0.03em',
          lineHeight: 1.5,
        }}
      >
        {displayedText}
        {/* Blinking cursor */}
        <span
          style={{
            display: 'inline-block',
            width: '1px',
            height: '0.85em',
            backgroundColor: '#4ade80',
            marginLeft: '2px',
            verticalAlign: 'middle',
            animation: undefined,
            opacity: fading ? 0 : 1,
          }}
        >
          {'\u2588'}
        </span>
      </span>
    </div>
  );
}

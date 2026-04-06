'use client';

import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '@/hooks/useSocket';

interface DisconnectOverlayProps {
  connectionState: ConnectionState;
  hasGivenUp: boolean;
  onReconnect: () => void;
}

const GRACE_PERIOD_MS = 4000;

export function DisconnectOverlay({ connectionState, hasGivenUp, onReconnect }: DisconnectOverlayProps) {
  const [showOverlay, setShowOverlay] = useState(false);
  const [isVisible, setIsVisible] = useState(false); // For fade-in
  const graceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Connected — hide everything
    if (connectionState === 'connected') {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      setIsVisible(false);
      // Delay unmount to allow fade-out
      const fadeOut = setTimeout(() => setShowOverlay(false), 300);
      return () => clearTimeout(fadeOut);
    }

    // Given up — show immediately
    if (hasGivenUp) {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      setShowOverlay(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      return;
    }

    // Reconnecting/connecting — start grace period
    if (!graceTimer.current && !showOverlay) {
      graceTimer.current = setTimeout(() => {
        graceTimer.current = null;
        setShowOverlay(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setIsVisible(true));
        });
      }, GRACE_PERIOD_MS);
    }

    return () => {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    };
  }, [connectionState, hasGivenUp, showOverlay]);

  if (!showOverlay) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '32px',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 600ms ease',
      }}
    >
      <p
        style={{
          fontSize: '2rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.3)',
          margin: 0,
          textAlign: 'center',
          padding: '0 24px',
        }}
      >
        STATION CONNECTION LOST
      </p>

      {hasGivenUp ? (
        <button
          onClick={onReconnect}
          style={{
            padding: '12px 32px',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '32px',
            backgroundColor: 'transparent',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '0.8rem',
            letterSpacing: '0.15em',
            cursor: 'pointer',
            textTransform: 'uppercase',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          TAP TO RECONNECT
        </button>
      ) : (
        <div
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            animation: 'disconnect-pulse 2s ease-in-out infinite',
          }}
        >
          <style>{`
            @keyframes disconnect-pulse {
              0%, 100% { opacity: 0.3; transform: scale(1); }
              50% { opacity: 1; transform: scale(1.3); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

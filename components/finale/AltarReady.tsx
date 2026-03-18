'use client';

/**
 * AltarReady — Ambassador's phone during their ceremony turn.
 *
 * Full-screen, high contrast, minimal text. The ambassador is walking
 * toward a stage — they need to glance at their phone, not read paragraphs.
 *
 * States:
 *  1. Permission needed (iOS only) → tap to enable
 *  2. Listening → "Place your phone face-down"
 *  3. Holding → progress ring filling
 *  4. Locked → confirmation glow + vibration
 *  5. Fallback → manual "Lock In" button (desktop / unsupported)
 */

import { useEffect, useRef } from 'react';
import { useAltarDetection } from '@/hooks/useAltarDetection';
import { getLayerIdentity } from '@/lib/identity';
import type { LayerType } from '@/conductor/types';

interface AltarReadyProps {
  layerType: LayerType;
  onLockIn: () => void;
}

export function AltarReady({ layerType, onLockIn }: AltarReadyProps) {
  const identity = getLayerIdentity(layerType);
  const firedRef = useRef(false);

  const {
    isSupported,
    isFaceDown,
    isStill,
    holdProgress,
    isLocked,
    permissionNeeded,
    requestPermission,
    startListening,
  } = useAltarDetection();

  // Auto-start listening once permission is granted
  useEffect(() => {
    if (isSupported && !permissionNeeded) {
      startListening();
    }
  }, [isSupported, permissionNeeded, startListening]);

  // Fire lock-in callback once
  useEffect(() => {
    if (isLocked && !firedRef.current) {
      firedRef.current = true;
      // Vibrate on lock-in
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(200);
      }
      // Small delay so user sees confirmation
      setTimeout(() => onLockIn(), 600);
    }
  }, [isLocked, onLockIn]);

  // ---- State 4: Locked confirmation ----
  if (isLocked) {
    return (
      <div
        style={{
          ...fullScreen,
          backgroundColor: identity.color,
          transition: 'background-color 0.5s ease',
        }}
      >
        <div style={{ fontSize: '4rem' }}>{identity.symbol}</div>
        <div
          style={{
            fontSize: '1.4rem',
            fontWeight: 700,
            color: '#000',
            letterSpacing: '0.15em',
            marginTop: '16px',
          }}
        >
          LOCKED
        </div>
      </div>
    );
  }

  // ---- State 5: Fallback (API not supported) ----
  if (!isSupported) {
    return (
      <div style={fullScreen}>
        <div style={{ fontSize: '3rem', color: identity.color }}>{identity.symbol}</div>
        <div style={{ ...label, color: identity.color, marginTop: '12px' }}>
          {identity.label.toUpperCase()}
        </div>
        <button
          onClick={() => {
            if (!firedRef.current) {
              firedRef.current = true;
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(200);
              }
              onLockIn();
            }
          }}
          style={{
            marginTop: '40px',
            padding: '20px 48px',
            fontSize: '1.2rem',
            fontWeight: 700,
            color: '#000',
            backgroundColor: identity.color,
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}
        >
          LOCK IN
        </button>
      </div>
    );
  }

  // ---- State 1: Permission needed (iOS) ----
  if (permissionNeeded) {
    return (
      <div style={fullScreen}>
        <div style={{ fontSize: '3rem', color: identity.color }}>{identity.symbol}</div>
        <button
          onClick={requestPermission}
          style={{
            marginTop: '32px',
            padding: '16px 32px',
            fontSize: '1rem',
            fontWeight: 600,
            color: identity.color,
            backgroundColor: 'transparent',
            border: `2px solid ${identity.color}`,
            borderRadius: '10px',
            cursor: 'pointer',
            letterSpacing: '0.08em',
          }}
        >
          TAP TO ENABLE
        </button>
        <div style={{ ...hint, marginTop: '16px' }}>
          Altar detection requires sensor access
        </div>
      </div>
    );
  }

  // ---- State 3: Holding (face-down + still, progress filling) ----
  if (holdProgress > 0) {
    const circumference = 2 * Math.PI * 44;
    const dashOffset = circumference * (1 - holdProgress);

    return (
      <div style={fullScreen}>
        {/* Progress ring */}
        <svg width="120" height="120" viewBox="0 0 100 100">
          {/* Background ring */}
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
          />
          {/* Progress arc */}
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke={identity.color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.1s linear' }}
          />
          {/* Center symbol */}
          <text
            x="50" y="55"
            textAnchor="middle"
            fill={identity.color}
            fontSize="28"
          >
            {identity.symbol}
          </text>
        </svg>
        <div style={{ ...hint, marginTop: '20px', color: 'rgba(255,255,255,0.5)' }}>
          Hold steady...
        </div>
      </div>
    );
  }

  // ---- State 2: Listening (waiting for face-down placement) ----
  return (
    <div style={fullScreen}>
      <div
        style={{
          fontSize: '3rem',
          color: identity.color,
          opacity: isFaceDown ? 1 : 0.5,
          transition: 'opacity 0.3s ease',
        }}
      >
        {identity.symbol}
      </div>

      <div
        style={{
          marginTop: '24px',
          fontSize: '1rem',
          color: 'rgba(255,255,255,0.7)',
          textAlign: 'center',
          lineHeight: 1.6,
          maxWidth: '260px',
        }}
      >
        Place your phone face-down on the altar.
      </div>

      {/* Subtle detection indicators */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginTop: '32px',
        }}
      >
        <DetectionDot active={isFaceDown} color={identity.color} label="down" />
        <DetectionDot active={isStill} color={identity.color} label="still" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetectionDot({
  active,
  color,
  label,
}: {
  active: boolean;
  color: string;
  label: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: active ? color : 'rgba(255,255,255,0.15)',
          transition: 'background-color 0.2s ease',
        }}
      />
      <span
        style={{
          fontSize: '0.6rem',
          color: active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          transition: 'color 0.2s ease',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const fullScreen: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: '100vh',
  backgroundColor: '#000',
  color: '#fff',
};

const label: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
};

const hint: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.3)',
  letterSpacing: '0.08em',
};

/**
 * StewardSlider
 *
 * Single continuous vertical slider shown to the steward while their fragment
 * is in an active slot. Controls one abstracted safe parameter (e.g., "Intensity").
 *
 * Custom touch-driven slider (not <input type="range">) for reliable mobile UX.
 * Touch events are throttled to ~50ms to prevent flooding the server.
 *
 * Local state tracks the slider value immediately for responsiveness; the server
 * is the authoritative source and will update via state_sync on reconnect.
 */

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

export interface StewardSliderProps {
  /** safeParameter.displayLabel — what the user sees (e.g., "Intensity") */
  label: string;
  /** Initial value (0.0–1.0, typically safeParameter.defaultValue) */
  value: number;
  /** safeParameter.min */
  min: number;
  /** safeParameter.max */
  max: number;
  /** Human-readable fragment name for context */
  fragmentName: string;
  /** Chapter color for visual accent */
  chapterColor: string;
  /** Called with the normalized (0–1) value, clamped to [min, max]. Throttled ~50ms. */
  onChange: (value: number) => void;
}

const THROTTLE_MS = 50;
const TRACK_HEIGHT = 260;
const TRACK_WIDTH = 48;
const THUMB_RADIUS = 20;

export function StewardSlider({
  label,
  value: initialValue,
  min,
  max,
  fragmentName,
  chapterColor,
  onChange,
}: StewardSliderProps) {
  const [localValue, setLocalValue] = useState(initialValue);
  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastEmitRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync from server when initialValue changes (reconnection recovery)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(initialValue);
    }
  }, [initialValue]);

  /** Map a clientY to a normalized [0,1] value (0 = bottom, 1 = top). */
  const clientYToValue = useCallback((clientY: number): number => {
    const track = trackRef.current;
    if (!track) return localValue;
    const rect = track.getBoundingClientRect();
    // 0 at bottom, 1 at top
    const raw = 1 - (clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(1, raw));
  }, [localValue]);

  const emitThrottled = useCallback((normalized: number) => {
    const clamped = min + normalized * (max - min);
    const now = Date.now();
    if (now - lastEmitRef.current >= THROTTLE_MS) {
      lastEmitRef.current = now;
      onChangeRef.current(clamped);
    }
  }, [min, max]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      const v = clientYToValue(e.clientY);
      setLocalValue(v);
      emitThrottled(v);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const v = clientYToValue(e.clientY);
      setLocalValue(v);
      emitThrottled(v);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const v = clientYToValue(e.clientY);
      setLocalValue(v);
      // Emit final value immediately
      const clamped = min + v * (max - min);
      lastEmitRef.current = Date.now();
      onChangeRef.current(clamped);
    };

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerUp);

    return () => {
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', onPointerUp);
      track.removeEventListener('pointercancel', onPointerUp);
    };
  }, [clientYToValue, emitThrottled, min, max]);

  // Fill height as a percentage of the track
  const fillPct = localValue * 100;
  const thumbOffsetPx = localValue * (TRACK_HEIGHT - THUMB_RADIUS * 2) + THUMB_RADIUS;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        padding: '32px 16px',
        width: '100%',
        maxWidth: '280px',
      }}
    >
      {/* Label */}
      <div
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: chapterColor,
        }}
      >
        {label}
      </div>

      {/* Slider track */}
      <div
        style={{
          position: 'relative',
          width: `${TRACK_WIDTH}px`,
          height: `${TRACK_HEIGHT}px`,
        }}
      >
        {/* Track background */}
        <div
          ref={trackRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${TRACK_WIDTH / 2}px`,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'ns-resize',
            touchAction: 'none',
            userSelect: 'none',
          }}
        />

        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${fillPct}%`,
            borderRadius: `${TRACK_WIDTH / 2}px`,
            backgroundColor: chapterColor,
            opacity: 0.7,
            pointerEvents: 'none',
            transition: isDraggingRef.current ? 'none' : 'height 0.1s ease',
          }}
        />

        {/* Thumb */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: `${thumbOffsetPx - THUMB_RADIUS}px`,
            transform: 'translateX(-50%)',
            width: `${THUMB_RADIUS * 2}px`,
            height: `${THUMB_RADIUS * 2}px`,
            borderRadius: '50%',
            backgroundColor: '#fff',
            boxShadow: `0 0 0 3px ${chapterColor}, 0 2px 8px rgba(0,0,0,0.4)`,
            pointerEvents: 'none',
            transition: isDraggingRef.current ? 'none' : 'bottom 0.1s ease',
          }}
        />
      </div>

      {/* Value readout */}
      <div
        style={{
          fontSize: '0.65rem',
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.06em',
        }}
      >
        {Math.round(localValue * 100)}%
      </div>

      {/* Context */}
      <div
        style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.25)',
          fontSize: '0.7rem',
          lineHeight: 1.5,
        }}
      >
        <div>{fragmentName}</div>
        <div style={{ marginTop: '4px', letterSpacing: '0.08em' }}>YOU ARE STEERING</div>
      </div>
    </div>
  );
}

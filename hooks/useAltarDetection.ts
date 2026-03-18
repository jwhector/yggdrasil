'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface AltarDetectionConfig {
  faceDownThreshold: number;    // degrees from perfectly face-down (default: 30)
  stillnessThreshold: number;   // max acceleration delta m/s² (default: 0.5)
  holdDurationMs: number;       // required hold time (default: 2000)
}

export interface UseAltarDetectionReturn {
  isSupported: boolean;
  isFaceDown: boolean;
  isStill: boolean;
  holdProgress: number;         // 0.0 to 1.0
  isLocked: boolean;
  permissionNeeded: boolean;    // iOS: permission not yet granted
  requestPermission: () => void;
  startListening: () => void;
  stopListening: () => void;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: AltarDetectionConfig = {
  faceDownThreshold: 30,
  stillnessThreshold: 0.5,
  holdDurationMs: 2000,
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Detects when a phone is placed face-down and held still for a duration.
 * Uses DeviceMotionEvent.accelerationIncludingGravity for face-down detection
 * and delta tracking for stillness.
 *
 * Falls back gracefully when API is unavailable (isSupported = false).
 */
export function useAltarDetection(
  config: Partial<AltarDetectionConfig> = {},
): UseAltarDetectionReturn {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const [isSupported, setIsSupported] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [isFaceDown, setIsFaceDown] = useState(false);
  const [isStill, setIsStill] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [listening, setListening] = useState(false);

  // Refs for tracking across frames
  const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const faceDownRef = useRef(false);
  const stillRef = useRef(false);

  // Face-down threshold: z must exceed gravity * cos(threshold)
  const zThreshold = 9.8 * Math.cos((cfg.faceDownThreshold * Math.PI) / 180);

  // --------------------------------------------------------------------------
  // Check support on mount
  // --------------------------------------------------------------------------
  useEffect(() => {
    const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    setIsSupported(hasMotion);

    // iOS 13+ requires permission request
    if (
      hasMotion &&
      typeof (DeviceMotionEvent as any).requestPermission === 'function'
    ) {
      setPermissionNeeded(true);
    }
  }, []);

  // --------------------------------------------------------------------------
  // iOS permission request (must be called from user gesture)
  // --------------------------------------------------------------------------
  const requestPermission = useCallback(() => {
    if (typeof (DeviceMotionEvent as any).requestPermission !== 'function') {
      setPermissionNeeded(false);
      return;
    }

    (DeviceMotionEvent as any)
      .requestPermission()
      .then((result: string) => {
        if (result === 'granted') {
          setPermissionNeeded(false);
        }
      })
      .catch(() => {
        // Permission denied — fallback to manual button
        setIsSupported(false);
        setPermissionNeeded(false);
      });
  }, []);

  // --------------------------------------------------------------------------
  // Motion event handler
  // --------------------------------------------------------------------------
  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      if (lockedRef.current) return;

      const accel = event.accelerationIncludingGravity;
      if (!accel || accel.z === null || accel.x === null || accel.y === null) return;

      const x = accel.x ?? 0;
      const y = accel.y ?? 0;
      const z = accel.z ?? 0;

      // Face-down: gravity pulls through back of phone → z ≈ +9.8
      const nowFaceDown = z > zThreshold;
      faceDownRef.current = nowFaceDown;
      setIsFaceDown(nowFaceDown);

      // Stillness: compare deltas from last reading
      const prev = lastAccel.current;
      let nowStill = false;
      if (prev) {
        const dx = Math.abs(x - prev.x);
        const dy = Math.abs(y - prev.y);
        const dz = Math.abs(z - prev.z);
        nowStill =
          dx < cfg.stillnessThreshold &&
          dy < cfg.stillnessThreshold &&
          dz < cfg.stillnessThreshold;
      }
      stillRef.current = nowStill;
      setIsStill(nowStill);
      lastAccel.current = { x, y, z };
    },
    [zThreshold, cfg.stillnessThreshold],
  );

  // --------------------------------------------------------------------------
  // Hold progress animation loop
  // --------------------------------------------------------------------------
  const tick = useCallback(() => {
    if (lockedRef.current) return;

    const now = Date.now();

    if (faceDownRef.current && stillRef.current) {
      if (holdStartRef.current === null) {
        holdStartRef.current = now;
      }
      const elapsed = now - holdStartRef.current;
      const progress = Math.min(elapsed / cfg.holdDurationMs, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        lockedRef.current = true;
        setIsLocked(true);
        return; // Stop loop
      }
    } else {
      holdStartRef.current = null;
      setHoldProgress(0);
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, [cfg.holdDurationMs]);

  // --------------------------------------------------------------------------
  // Start / stop listening
  // --------------------------------------------------------------------------
  const startListening = useCallback(() => {
    if (!isSupported || permissionNeeded || lockedRef.current) return;
    setListening(true);
  }, [isSupported, permissionNeeded]);

  const stopListening = useCallback(() => {
    setListening(false);
    holdStartRef.current = null;
    setHoldProgress(0);
    lastAccel.current = null;
  }, []);

  // --------------------------------------------------------------------------
  // Attach / detach listeners based on `listening` state
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!listening) return;

    window.addEventListener('devicemotion', handleMotion);
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [listening, handleMotion, tick]);

  // --------------------------------------------------------------------------
  // Cleanup on unmount
  // --------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return {
    isSupported,
    isFaceDown,
    isStill,
    holdProgress,
    isLocked,
    permissionNeeded,
    requestPermission,
    startListening,
    stopListening,
  };
}

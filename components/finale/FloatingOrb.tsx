/**
 * FloatingOrb (V3.4 — Swarm Orbs)
 *
 * Single floating orb DOM element with projector-style 3-layer radial gradient glow.
 * Replicates the canvas rendering from TokenPool.tsx as CSS radial gradients.
 *
 * Three concentric layers:
 *   - Outer haze (5x radius): very faint luminous corona
 *   - Mid glow (2.5x radius): soft bloom
 *   - Core (1.2x radius): bright center with brightened color (+60 RGB)
 */

'use client';

import { memo } from 'react';

interface FloatingOrbProps {
  x: number;
  y: number;
  radius: number;
  color: string;       // hex color e.g. '#e63946'
  opacity: number;     // 0-1, includes bloom
  isDragging: boolean;
  isPlaced: boolean;
  onTouchStart?: (e: React.TouchEvent) => void;
}

/** Parse hex color to RGB components. */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

export const FloatingOrb = memo(function FloatingOrb({
  x,
  y,
  radius,
  color,
  opacity,
  isDragging,
  isPlaced,
  onTouchStart,
}: FloatingOrbProps) {
  const { r, g, b } = parseHex(color);
  const br = Math.min(r + 60, 255);
  const bg = Math.min(g + 60, 255);
  const bb = Math.min(b + 60, 255);

  const a = opacity;

  // Layer sizes
  const hazeSize = radius * 10;  // 5x radius diameter
  const glowSize = radius * 5;   // 2.5x radius diameter
  const coreSize = radius * 2.4; // 1.2x radius diameter

  const placedScale = isPlaced ? 0.6 : 1;
  const dragScale = isDragging ? 1.4 : 1;
  const scale = placedScale * dragScale;

  // Touch target size — large enough for finger taps
  const touchSize = Math.max(44, coreSize);

  return (
    <div
      onTouchStart={onTouchStart}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 0,
        height: 0,
        transform: `scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
        opacity: isPlaced && !isDragging ? 0.5 : 1,
        zIndex: isDragging ? 200 : 50,
        pointerEvents: onTouchStart ? 'auto' : 'none',
        touchAction: 'none',
        willChange: 'transform',
      }}
    >
      {/* Invisible touch target */}
      {onTouchStart && (
        <div
          style={{
            position: 'absolute',
            width: touchSize,
            height: touchSize,
            left: -touchSize / 2,
            top: -touchSize / 2,
            borderRadius: '50%',
          }}
        />
      )}
      {/* Outer haze */}
      <div
        style={{
          position: 'absolute',
          width: hazeSize,
          height: hazeSize,
          left: -hazeSize / 2,
          top: -hazeSize / 2,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${r},${g},${b},${a * 0.12}) 0%, rgba(${r},${g},${b},${a * 0.04}) 40%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      {/* Mid glow */}
      <div
        style={{
          position: 'absolute',
          width: glowSize,
          height: glowSize,
          left: -glowSize / 2,
          top: -glowSize / 2,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${r},${g},${b},${a * 0.35}) 0%, rgba(${r},${g},${b},${a * 0.1}) 50%, transparent 100%)`,
          pointerEvents: 'none',
        }}
      />
      {/* Core */}
      <div
        style={{
          position: 'absolute',
          width: coreSize,
          height: coreSize,
          left: -coreSize / 2,
          top: -coreSize / 2,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${br},${bg},${bb},${a * 0.9}) 0%, rgba(${r},${g},${b},${a * 0.6}) 40%, transparent 100%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

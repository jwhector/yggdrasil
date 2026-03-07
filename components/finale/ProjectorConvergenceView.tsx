'use client';

/**
 * ProjectorConvergenceView
 *
 * Large-format projector visualization for the consensus game.
 * Uses a semi-circular SVG arc meter as the primary visual.
 * Locked roles displayed as chapter-colored icons around the arc.
 * NPC message overlay in monospace text below.
 * Subscribes to convergence_update socket events for smooth animation.
 */

import { useEffect, useRef, useState } from 'react';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { NpcDisplay } from '@/components/finale/NpcDisplay';
import type { Fragment, LayerType } from '@/conductor/types';
import type { Socket } from 'socket.io-client';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx1', 'fx2'];

// Spring constants
const SPRING_TAU_MS = 120;

interface ProjectorConvergenceViewProps {
  convergenceValue: number;         // from state_sync (also updated via socket events below)
  threshold: number;
  roundTimeRemaining: number;
  roundDurationMs: number;
  currentRound: number;
  lockedRoles: Array<{ layerType: LayerType; fragmentId: string }>;
  availableFragments: Fragment[];
  npcMessage: string | null;
  socket: Socket | null;
}

export function ProjectorConvergenceView({
  convergenceValue,
  threshold,
  roundTimeRemaining,
  roundDurationMs,
  currentRound,
  lockedRoles,
  availableFragments,
  npcMessage: _npcMessage,
  socket,
}: ProjectorConvergenceViewProps) {
  // Spring-interpolated convergence for smooth arc animation
  const targetRef = useRef(convergenceValue);
  const currentRef = useRef(convergenceValue);
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const [animatedValue, setAnimatedValue] = useState(convergenceValue);

  // Update target when state_sync arrives
  useEffect(() => {
    targetRef.current = convergenceValue;
  }, [convergenceValue]);

  // Listen for high-frequency convergence_update events
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { value: number }) => {
      targetRef.current = Math.max(0, Math.min(1, data.value));
    };
    socket.on('convergence_update', handler);
    return () => { socket.off('convergence_update', handler); };
  }, [socket]);

  // RAF spring interpolation loop
  useEffect(() => {
    const animate = (timestamp: number) => {
      const dt = lastFrameRef.current ? timestamp - lastFrameRef.current : 16;
      lastFrameRef.current = timestamp;
      const factor = 1 - Math.exp(-dt / SPRING_TAU_MS);
      const next = currentRef.current + (targetRef.current - currentRef.current) * factor;
      currentRef.current = next;
      setAnimatedValue(next);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const isAbove = animatedValue >= threshold;
  const lockedSet = new Set(lockedRoles.map(r => r.layerType));
  const fragmentMap = new Map(availableFragments.map(f => [f.id, f]));

  // SVG arc parameters
  const cx = 200, cy = 200, r = 150;
  const startAngle = 180; // degrees (left side)
  const endAngle = 0;     // degrees (right side)

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  // Arc from startAngle to a given angle
  const arcPath = (fromDeg: number, toDeg: number) => {
    const from = polarToCartesian(fromDeg);
    const to = polarToCartesian(toDeg);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    const sweep = toDeg > fromDeg ? 1 : 0;
    return `M ${from.x} ${from.y} A ${r} ${r} 0 ${large} ${sweep} ${to.x} ${to.y}`;
  };

  // Map 0-1 value to angle range 180° → 0° (left to right semi-circle)
  const valueToAngle = (v: number) => 180 - v * 180;
  const fillAngle = valueToAngle(animatedValue);
  const thresholdAngle = valueToAngle(threshold);

  const fillColor = isAbove ? '#4ade80' : '#e5e5e5';
  const glowFilter = isAbove ? 'drop-shadow(0 0 16px rgba(74,222,128,0.7))' : 'none';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        padding: '40px 60px',
        boxSizing: 'border-box',
        gap: '32px',
      }}
    >
      {/* Round info */}
      <div
        style={{
          fontSize: '0.7rem',
          color: '#555',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        Round {currentRound}
      </div>

      {/* SVG Arc Meter */}
      <div style={{ position: 'relative', width: '400px', height: '220px' }}>
        <svg viewBox="0 0 400 220" width="400" height="220">
          {/* Background arc track */}
          <path
            d={arcPath(180, 0)}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={20}
            strokeLinecap="round"
          />

          {/* Threshold zone arc (from threshold angle to 0°) */}
          <path
            d={arcPath(thresholdAngle, 0)}
            fill="none"
            stroke="rgba(74,222,128,0.12)"
            strokeWidth={20}
            strokeLinecap="round"
          />

          {/* Threshold tick mark */}
          {(() => {
            const tp = polarToCartesian(thresholdAngle);
            const inner = { x: cx + (r - 14) * Math.cos((thresholdAngle * Math.PI) / 180), y: cy + (r - 14) * Math.sin((thresholdAngle * Math.PI) / 180) };
            const outer = { x: cx + (r + 14) * Math.cos((thresholdAngle * Math.PI) / 180), y: cy + (r + 14) * Math.sin((thresholdAngle * Math.PI) / 180) };
            return (
              <line
                x1={inner.x} y1={inner.y}
                x2={outer.x} y2={outer.y}
                stroke="rgba(74,222,128,0.5)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })()}

          {/* Fill arc */}
          {animatedValue > 0 && (
            <path
              d={arcPath(180, fillAngle)}
              fill="none"
              stroke={fillColor}
              strokeWidth={18}
              strokeLinecap="round"
              style={{
                filter: glowFilter,
                transition: 'stroke 0.3s ease',
              }}
            />
          )}

          {/* Center text: large convergence indicator dot */}
          <circle
            cx={cx}
            cy={cy}
            r={12}
            fill={isAbove ? '#4ade80' : '#333'}
            style={{ transition: 'fill 0.3s ease', filter: isAbove ? 'drop-shadow(0 0 8px rgba(74,222,128,0.8))' : 'none' }}
          />
        </svg>

        {/* Timer bar below arc */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '10%',
            right: '10%',
            height: '3px',
            backgroundColor: '#111',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              float: 'right',
              width: roundDurationMs > 0
                ? `${Math.round((roundTimeRemaining / roundDurationMs) * 100)}%`
                : '0%',
              height: '100%',
              backgroundColor: roundTimeRemaining < 3000 ? '#ef4444' : 'rgba(255,255,255,0.2)',
              borderRadius: '2px',
              transition: 'background-color 0.5s ease',
            }}
          />
        </div>
      </div>

      {/* Locked roles row */}
      {lockedRoles.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {lockedRoles.map(({ layerType, fragmentId }) => {
            const layer = getLayerIdentity(layerType);
            const fragment = fragmentMap.get(fragmentId);
            const chapter = fragment ? getChapterIdentity(fragment.chapter) : null;
            return (
              <div
                key={layerType}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  backgroundColor: (chapter?.color ?? '#888') + '22',
                  border: `1px solid ${chapter?.color ?? '#888'}55`,
                  boxShadow: `0 0 10px ${chapter?.color ?? '#888'}33`,
                }}
              >
                <span style={{ fontSize: '1.2rem', color: layer.color }}>{layer.symbol}</span>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: chapter?.color ?? '#888',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* NPC message */}
      <NpcDisplay socket={socket} fadeDurationMs={5000} />
    </div>
  );
}

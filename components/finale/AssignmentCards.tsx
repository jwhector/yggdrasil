/**
 * AssignmentCards (V3.2)
 *
 * Self-select assignment UI. Shows tappable cards for each granular type
 * with live member counts. Config-driven — reads types from props, not hardcoded.
 *
 * Replaces V3.1 AssemblyCards.tsx which used hardcoded LayerType + getLayerIdentity.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import type { GranularType } from '@/conductor/types';
import type { Socket } from 'socket.io-client';

interface AssignmentCardsProps {
  myGranularType: string | null;
  granularTypes: GranularType[];
  groupSizes: Array<{ granularType: string; count: number }>;
  timerRemaining: number;
  onSelect: (granularType: string) => void;
  socket: Socket | null;
}

export function AssignmentCards({
  myGranularType,
  granularTypes,
  groupSizes: initialSizes,
  timerRemaining,
  onSelect,
  socket,
}: AssignmentCardsProps) {
  const timerDurationRef = useRef(timerRemaining);
  const [liveSizes, setLiveSizes] = useState(initialSizes);

  // Subscribe to high-frequency group_update events (~2 Hz during assignment)
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { groupSizes: Array<{ granularType: string; count: number }> }) => {
      setLiveSizes(data.groupSizes);
    };
    socket.on('group_update', handler);
    return () => { socket.off('group_update', handler); };
  }, [socket]);

  // Keep in sync with state_sync updates
  useEffect(() => {
    setLiveSizes(initialSizes);
  }, [initialSizes]);

  const timerSecs = Math.ceil(timerRemaining / 1000);
  const timerDuration = timerDurationRef.current;
  const timerPct = timerDuration > 0 ? Math.max(0, timerRemaining / timerDuration) : 0;

  const countFor = (typeId: string) =>
    liveSizes.find(s => s.granularType === typeId)?.count ?? 0;

  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: '24px', boxSizing: 'border-box' }}>
      {/* Timer bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#000', paddingTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 16px 6px', alignItems: 'baseline' }}>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Choose your role
          </span>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: timerSecs <= 10 ? '#f87171' : 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
            {timerSecs}s
          </span>
        </div>
        <div style={{ height: '3px', backgroundColor: '#1a1a1a', margin: '0 16px' }}>
          <div style={{
            height: '100%',
            width: `${timerPct * 100}%`,
            backgroundColor: timerSecs <= 10 ? '#f87171' : 'rgba(255,255,255,0.4)',
            transition: 'width 1s linear, background-color 0.3s ease',
          }} />
        </div>
        <div style={{ height: '12px' }} />
      </div>

      {/* Card grid (2 columns) */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        padding: '0 16px',
      }}>
        {granularTypes.map((gt) => {
          const count = countFor(gt.id);
          const selected = myGranularType === gt.id;

          return (
            <button
              key={gt.id}
              onClick={() => onSelect(gt.id)}
              aria-pressed={selected}
              style={{
                flex: '1 1 calc(50% - 5px)',
                minWidth: 0,
                padding: '18px 12px',
                backgroundColor: selected ? `${gt.color}18` : '#0d0d0d',
                border: selected
                  ? `2px solid ${gt.color}`
                  : '2px solid #222',
                borderRadius: '10px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                boxShadow: selected ? `0 0 16px ${gt.color}40` : 'none',
                transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              } as React.CSSProperties}
            >
              <span style={{
                fontSize: '2rem',
                lineHeight: 1,
                color: gt.color,
                filter: selected ? `drop-shadow(0 0 8px ${gt.color}80)` : 'none',
              }}>
                {gt.symbol}
              </span>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: selected ? gt.color : 'rgba(255,255,255,0.7)',
                textAlign: 'center',
                letterSpacing: '0.02em',
              }}>
                {gt.label}
              </span>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.35)',
                backgroundColor: '#1a1a1a',
                padding: '2px 8px',
                borderRadius: '10px',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

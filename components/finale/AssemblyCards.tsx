'use client';

import { useState, useEffect, useRef } from 'react';
import { getLayerIdentity } from '@/lib/identity';
import type { LayerType } from '@/conductor/types';
import type { Socket } from 'socket.io-client';

const LAYER_ORDER: LayerType[] = ['melody', 'drums', 'pad', 'bass', 'harmony', 'fx'];

interface AssemblyCardsProps {
  myGroup: LayerType | null;
  groupSizes: Array<{ layerType: LayerType; count: number }>;
  timerRemaining: number;
  onJoinGroup: (layerType: LayerType) => void;
  socket: Socket | null;
}

export function AssemblyCards({
  myGroup,
  groupSizes: initialSizes,
  timerRemaining,
  onJoinGroup,
  socket,
}: AssemblyCardsProps) {
  // Capture the initial timer value as the duration reference for the progress bar
  const timerDurationRef = useRef(timerRemaining);
  const [liveSizes, setLiveSizes] = useState<Array<{ layerType: LayerType; count: number }>>(initialSizes);

  // Subscribe to high-frequency group_update events (~2 Hz during assembly)
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { groupSizes: Array<{ layerType: LayerType; count: number }>; undecidedCount: number }) => {
      setLiveSizes(data.groupSizes);
    };
    socket.on('group_update', handler);
    return () => { socket.off('group_update', handler); };
  }, [socket]);

  // Keep initial sizes in sync with state_sync updates when no socket events arrive
  useEffect(() => {
    setLiveSizes(initialSizes);
  }, [initialSizes]);

  const timerSecs = Math.ceil(timerRemaining / 1000);
  const timerDuration = timerDurationRef.current;
  const timerPct = timerDuration > 0 ? Math.max(0, timerRemaining / timerDuration) : 0;

  const countFor = (type: LayerType) =>
    liveSizes.find(s => s.layerType === type)?.count ?? 0;

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
        {LAYER_ORDER.map((type) => {
          const identity = getLayerIdentity(type);
          const count = countFor(type);
          const selected = myGroup === type;

          return (
            <button
              key={type}
              onClick={() => onJoinGroup(type)}
              aria-pressed={selected}
              style={{
                flex: '1 1 calc(50% - 5px)',
                minWidth: 0,
                padding: '18px 12px',
                backgroundColor: selected ? `${identity.color}18` : '#0d0d0d',
                border: selected
                  ? `2px solid ${identity.color}`
                  : '2px solid #222',
                borderRadius: '10px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                boxShadow: selected ? `0 0 16px ${identity.color}40` : 'none',
                transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              } as React.CSSProperties}
            >
              <span style={{
                fontSize: '2rem',
                lineHeight: 1,
                color: identity.color,
                filter: selected ? `drop-shadow(0 0 8px ${identity.color}80)` : 'none',
              }}>
                {identity.symbol}
              </span>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: selected ? identity.color : 'rgba(255,255,255,0.7)',
                textAlign: 'center',
                letterSpacing: '0.02em',
              }}>
                {identity.label}
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

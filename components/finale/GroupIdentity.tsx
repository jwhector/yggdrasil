'use client';

import { getLayerIdentity } from '@/lib/identity';
import type { LayerType } from '@/conductor/types';

interface GroupIdentityProps {
  layerType: LayerType;
}

export function GroupIdentity({ layerType }: GroupIdentityProps) {
  const identity = getLayerIdentity(layerType);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: '100vh',
      gap: '16px',
      background: `radial-gradient(ellipse at center, ${identity.color}18 0%, #000 70%)`,
    }}>
      <div style={{
        fontSize: '4rem',
        lineHeight: 1,
        color: identity.color,
        filter: `drop-shadow(0 0 24px ${identity.color}80)`,
      }}>
        {identity.symbol}
      </div>

      <p style={{
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        margin: 0,
      }}>
        You are
      </p>

      <p style={{
        fontSize: '1.6rem',
        fontWeight: 700,
        color: identity.color,
        margin: 0,
        letterSpacing: '0.04em',
      }}>
        {identity.label}
      </p>

      <p style={{
        fontSize: '0.8rem',
        color: 'rgba(255,255,255,0.3)',
        marginTop: '16px',
        letterSpacing: '0.08em',
        textAlign: 'center',
        padding: '0 32px',
      }}>
        Find others with your symbol
      </p>
    </div>
  );
}

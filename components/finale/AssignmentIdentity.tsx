/**
 * AssignmentIdentity (V3.2)
 *
 * Full-screen display showing the user's assigned granular type after
 * assignment completes. Uses config-driven GranularType, not hardcoded LayerType.
 *
 * Replaces V3.1 GroupIdentity.tsx.
 */

'use client';

import type { GranularType } from '@/conductor/types';

interface AssignmentIdentityProps {
  granularType: GranularType;
}

export function AssignmentIdentity({ granularType }: AssignmentIdentityProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: '100vh',
      gap: '16px',
      background: `radial-gradient(ellipse at center, ${granularType.color}18 0%, #000 70%)`,
    }}>
      <div style={{
        fontSize: '4rem',
        lineHeight: 1,
        color: granularType.color,
        filter: `drop-shadow(0 0 24px ${granularType.color}80)`,
      }}>
        {granularType.symbol}
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
        color: granularType.color,
        margin: 0,
        letterSpacing: '0.04em',
      }}>
        {granularType.label}
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

'use client';

/**
 * CeremonyView — Passive audience visualization during ceremony.
 *
 * Shows a vertical sequence of layer badges building from top to bottom.
 * Each badge reflects its current status: locked, current, upcoming, forfeited.
 * When ceremony completes, all locked badges glow together.
 */

import { getLayerIdentity } from '@/lib/identity';
import type { LayerType } from '@/conductor/types';

interface CeremonyProgress {
  layerType: LayerType;
  status: 'locked' | 'forfeited' | 'current' | 'upcoming';
}

interface CeremonyViewProps {
  ceremonyProgress: CeremonyProgress[];
  npcMessage: string | null;
  ceremonyComplete?: boolean;
}

export function CeremonyView({
  ceremonyProgress,
  npcMessage,
  ceremonyComplete,
}: CeremonyViewProps) {
  return (
    <div style={container}>
      {/* NPC message */}
      {npcMessage && (
        <div style={npcStyle}>
          {npcMessage}
        </div>
      )}

      {/* Header */}
      <div style={header}>
        {ceremonyComplete ? 'THE SONG IS WHOLE' : 'CEREMONY'}
      </div>

      {/* Layer stack */}
      <div style={stack}>
        {ceremonyProgress.map(({ layerType, status }) => (
          <CeremonyBadge
            key={layerType}
            layerType={layerType}
            status={status}
            allLocked={ceremonyComplete ?? false}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function CeremonyBadge({
  layerType,
  status,
  allLocked,
}: {
  layerType: LayerType;
  status: CeremonyProgress['status'];
  allLocked: boolean;
}) {
  const identity = getLayerIdentity(layerType);

  const isLocked = status === 'locked';
  const isCurrent = status === 'current';
  const isForfeited = status === 'forfeited';
  const isUpcoming = status === 'upcoming';

  // Determine visual treatment
  let bgColor = 'rgba(255,255,255,0.03)';
  let borderColor = 'rgba(255,255,255,0.06)';
  let symbolColor = identity.color;
  let symbolOpacity = 1;
  let labelColor = 'rgba(255,255,255,0.5)';

  if (isLocked) {
    bgColor = `${identity.color}15`;
    borderColor = `${identity.color}40`;
    // When all locked, glow brighter
    if (allLocked) {
      bgColor = `${identity.color}25`;
      borderColor = `${identity.color}80`;
    }
  } else if (isCurrent) {
    bgColor = `${identity.color}10`;
    borderColor = identity.color;
  } else if (isForfeited) {
    symbolColor = 'rgba(255,255,255,0.15)';
    symbolOpacity = 0.4;
    labelColor = 'rgba(255,255,255,0.15)';
    borderColor = 'rgba(255,255,255,0.04)';
  } else if (isUpcoming) {
    symbolOpacity = 0.25;
    labelColor = 'rgba(255,255,255,0.2)';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        borderRadius: '10px',
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        transition: 'all 0.5s ease',
      }}
    >
      {/* Symbol */}
      <div
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.2rem',
          color: symbolColor,
          opacity: symbolOpacity,
          transition: 'opacity 0.4s ease',
        }}
      >
        {identity.symbol}
      </div>

      {/* Label */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '0.8rem',
            color: isCurrent ? identity.color : labelColor,
            fontWeight: isCurrent ? 600 : 400,
            transition: 'color 0.4s ease',
          }}
        >
          {identity.label}
        </div>
      </div>

      {/* Status indicator */}
      <div
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: isLocked
            ? identity.color
            : isForfeited
            ? 'rgba(255,255,255,0.15)'
            : isCurrent
            ? identity.color
            : 'transparent',
        }}
      >
        {isLocked && '✓'}
        {isForfeited && '—'}
        {isCurrent && '●'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const container: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
  minHeight: '100vh',
  padding: '24px 20px',
  boxSizing: 'border-box',
};

const header: React.CSSProperties = {
  fontSize: '0.6rem',
  color: 'rgba(255,255,255,0.25)',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  marginBottom: '20px',
};

const npcStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'rgba(255,255,255,0.6)',
  textAlign: 'center',
  fontStyle: 'italic',
  maxWidth: '280px',
  lineHeight: 1.5,
  marginBottom: '20px',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: 'rgba(255,255,255,0.03)',
};

const stack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  width: '100%',
  maxWidth: '320px',
};

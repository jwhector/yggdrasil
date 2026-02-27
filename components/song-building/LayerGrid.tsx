/**
 * LayerGrid (Audience)
 *
 * Displays all layers for the current attempt as a grid of square pairs (A | B).
 * Layers unlock sequentially from top.
 *
 * Layer state is inferred from position relative to currentLayerIndex:
 *   - index < currentLayerIndex  → resolved (locked_in or collapsed)
 *   - index === currentLayerIndex → active (phase = currentLayerPhase)
 *   - index > currentLayerIndex  → future (locked, unknown type)
 *
 * The audience state only includes:
 *   - layerResults: resolved layers (with type, chosenOption, consensus)
 *   - currentLayerConfig: config for the active layer (with type, labelA, labelB)
 *   - layerCount: total number of layers
 */

'use client';

import type { AudienceAttemptView, LayerResult } from '@/conductor/types';
import { getLayerIdentity } from '@/lib/identity';
import { OptionCard } from './OptionCard';

interface LayerGridProps {
  attempt: AudienceAttemptView;
  onVote: (choice: 'A' | 'B') => void;
}

export function LayerGrid({ attempt, onVote }: LayerGridProps) {
  const {
    currentLayerIndex,
    currentLayerPhase,
    currentLayerConfig,
    layerResults,
    layerCount,
    myVote,
    status,
    collapsedAtLayer,
  } = attempt as AudienceAttemptView & { collapsedAtLayer?: number | null };

  const rows = Array.from({ length: layerCount }, (_, i) => i);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px',
        width: '100%',
        maxWidth: '480px',
        margin: '0 auto',
      }}
    >
      {rows.map((layerIndex) => {
        const isResolved = layerIndex < currentLayerIndex;
        const isActive = layerIndex === currentLayerIndex;
        const isFuture = layerIndex > currentLayerIndex;
        const isCollapsedLayer = collapsedAtLayer === layerIndex;

        if (isResolved) {
          return (
            <ResolvedLayerRow
              key={layerIndex}
              layerResult={layerResults[layerIndex]}
              collapsed={isCollapsedLayer}
            />
          );
        }

        if (isActive && currentLayerConfig) {
          const votingOpen = currentLayerPhase === 'voting';
          const isResolvingOrDone =
            currentLayerPhase === 'resolving' ||
            currentLayerPhase === 'locked_in' ||
            currentLayerPhase === 'collapsed';

          // Determine winner for the resolving/locked_in state
          const resolvedResult = layerResults[layerIndex];
          const winner: 'A' | 'B' | null = resolvedResult?.chosenOption ?? null;

          return (
            <div key={layerIndex} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <OptionCard
                option="A"
                layerType={currentLayerConfig.type}
                label={currentLayerConfig.labelA}
                selected={myVote === 'A'}
                disabled={!votingOpen || myVote !== null}
                winner={isResolvingOrDone ? winner === 'A' : null}
                collapsed={currentLayerPhase === 'collapsed' || isCollapsedLayer}
                onSelect={() => onVote('A')}
              />
              <OptionCard
                option="B"
                layerType={currentLayerConfig.type}
                label={currentLayerConfig.labelB}
                selected={myVote === 'B'}
                disabled={!votingOpen || myVote !== null}
                winner={isResolvingOrDone ? winner === 'B' : null}
                collapsed={currentLayerPhase === 'collapsed' || isCollapsedLayer}
                onSelect={() => onVote('B')}
              />
            </div>
          );
        }

        if (isActive && !currentLayerConfig) {
          // Auditioning phase — no config yet, show placeholder
          return (
            <div key={layerIndex} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <AuditioningSquare option="A" />
              <AuditioningSquare option="B" />
            </div>
          );
        }

        if (isFuture) {
          return <LockedLayerRow key={layerIndex} />;
        }

        return null;
      })}

      {/* Attempt status banner */}
      {status === 'collapsed' && (
        <div
          style={{
            marginTop: '8px',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            textAlign: 'center',
            fontSize: '0.9rem',
            letterSpacing: '0.05em',
          }}
        >
          The song collapsed
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResolvedLayerRow({
  layerResult,
  collapsed,
}: {
  layerResult: LayerResult | undefined;
  collapsed: boolean;
}) {
  if (!layerResult || layerResult.status === 'unreached') {
    // Unreached layer (collapsed before getting here) — show as locked
    return <LockedLayerRow faded />;
  }

  const identity = getLayerIdentity(layerResult.type);
  const winner = layerResult.chosenOption;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      {(['A', 'B'] as const).map((opt) => {
        const isWinner = winner === opt;
        return (
          <div
            key={opt}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '10px 8px',
              borderRadius: '8px',
              opacity: collapsed ? 0.25 : isWinner ? 1 : 0.25,
              backgroundColor: opt === 'A' ? identity.color : 'transparent',
              border: `2px solid ${opt === 'A' ? 'transparent' : identity.color}`,
              color: opt === 'A' ? '#000' : identity.color,
              transition: 'opacity 0.3s ease',
            }}
          >
            <span style={{ fontSize: '1rem' }}>{identity.symbol}</span>
            {isWinner && (
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                {opt}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LockedLayerRow({ faded = false }: { faded?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      {(['A', 'B'] as const).map((opt) => (
        <div
          key={opt}
          style={{
            height: '48px',
            borderRadius: '8px',
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: faded ? 0.4 : 1,
          }}
        />
      ))}
    </div>
  );
}

function AuditioningSquare({ option }: { option: 'A' | 'B' }) {
  return (
    <div
      style={{
        height: '120px',
        borderRadius: '8px',
        backgroundColor: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.3)',
        fontSize: '0.75rem',
        letterSpacing: '0.1em',
      }}
    >
      {option}
    </div>
  );
}

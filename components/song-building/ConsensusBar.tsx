/**
 * ConsensusBar (Projector)
 *
 * Horizontal split bar showing live vote distribution between options A and B.
 * Used on the projector during voting and resolving phases.
 */

'use client';

import type { LayerType } from '@/conductor/types';
import { getLayerIdentity } from '@/lib/identity';

export interface ConsensusBarProps {
  votesA: number;
  votesB: number;
  totalVotes: number;
  winner: 'A' | 'B' | null;
  consensus: number | null;
  layerType: LayerType;
}

export function ConsensusBar({
  votesA,
  votesB,
  totalVotes,
  winner,
  consensus,
  layerType,
}: ConsensusBarProps) {
  const identity = getLayerIdentity(layerType);

  const pctA = totalVotes > 0 ? (votesA / totalVotes) * 100 : 50;
  const pctB = totalVotes > 0 ? (votesB / totalVotes) * 100 : 50;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {/* Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
        <span>
          A — {votesA} {votesA === 1 ? 'vote' : 'votes'} ({Math.round(pctA)}%)
        </span>
        <span>
          {Math.round(pctB)}% ({votesB} {votesB === 1 ? 'vote' : 'votes'}) — B
        </span>
      </div>

      {/* Bar */}
      <div
        style={{
          position: 'relative',
          height: '20px',
          borderRadius: '10px',
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      >
        {/* A segment */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pctA}%`,
            backgroundColor: identity.color,
            opacity: winner === 'B' ? 0.3 : 1,
            transition: 'width 0.4s ease, opacity 0.3s ease',
            borderRadius: '10px 0 0 10px',
          }}
        />
        {/* B segment */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: `${pctB}%`,
            border: `2px solid ${identity.color}`,
            opacity: winner === 'A' ? 0.3 : 1,
            transition: 'width 0.4s ease, opacity 0.3s ease',
            borderRadius: '0 10px 10px 0',
            boxSizing: 'border-box',
          }}
        />
        {/* Center divider */}
        <div
          style={{
            position: 'absolute',
            left: `${pctA}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: '#000',
            transform: 'translateX(-50%)',
            transition: 'left 0.4s ease',
          }}
        />
      </div>

      {/* Consensus stat */}
      {consensus !== null && totalVotes > 0 && (
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
          {Math.round(consensus * 100)}% consensus · {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </div>
      )}
    </div>
  );
}

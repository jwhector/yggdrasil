// @ts-nocheck — deprecated V3.2 code, to be deleted/rewritten in V3.3 Phase 2
/**
 * LiveMixProjector (V3.2)
 *
 * Projector visualization for the live mix phase. Shows all granular types
 * as rows with their current active fragment, vote consensus indicator,
 * and lock state.
 */

'use client';

import { useState, useEffect } from 'react';
import type { GranularFragment, GranularType, ProjectorFinaleView } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';
import type { Socket } from 'socket.io-client';

interface LiveMixProjectorProps {
  finaleState: ProjectorFinaleView;
  granularTypes: GranularType[];
  socket: Socket | null;
}

interface MixStatePayload {
  activeFragments: Array<{ granularType: string; fragmentId: string }>;
  voteDistributions: Array<{ granularType: string; votes: Array<{ fragmentId: string; count: number }> }>;
  lockedTypes: string[];
  loopPosition: number;
}

export function LiveMixProjector({ finaleState, granularTypes, socket }: LiveMixProjectorProps) {
  const [mixState, setMixState] = useState<MixStatePayload | null>(null);

  // Subscribe to high-frequency mix_state events (~4 Hz)
  useEffect(() => {
    if (!socket) return;
    const handler = (data: MixStatePayload) => setMixState(data);
    socket.on('mix_state', handler);
    return () => { socket.off('mix_state', handler); };
  }, [socket]);

  const activeFragments = mixState?.activeFragments ?? finaleState.activeFragments;
  const voteDistributions = mixState?.voteDistributions ?? finaleState.voteDistributions;
  const lockedTypes = mixState?.lockedTypes ?? finaleState.lockedTypes;

  // Build fragment lookup
  const fragmentMap = new Map<string, GranularFragment>();
  for (const f of finaleState.allFragments) fragmentMap.set(f.id, f);

  return (
    <main style={{
      minHeight: '100vh',
      width: '100vw',
      backgroundColor: '#000',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      padding: '40px',
      gap: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        fontSize: '0.65rem',
        color: 'rgba(255,255,255,0.2)',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}>
        Live Mix
      </div>

      {/* Granular type rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        {granularTypes.map((gt) => {
          const activeEntry = activeFragments.find(a => a.granularType === gt.id);
          const activeFrag = activeEntry ? fragmentMap.get(activeEntry.fragmentId) ?? null : null;
          const isLocked = lockedTypes.includes(gt.id);
          const distribution = voteDistributions.find(d => d.granularType === gt.id);
          const totalVotes = distribution?.votes.reduce((sum, v) => sum + v.count, 0) ?? 0;
          const topVotes = distribution?.votes.reduce((max, v) => Math.max(max, v.count), 0) ?? 0;
          const consensus = totalVotes > 0 ? topVotes / totalVotes : 0;

          return (
            <TypeRow
              key={gt.id}
              granularType={gt}
              activeFragment={activeFrag}
              isLocked={isLocked}
              consensus={consensus}
            />
          );
        })}
      </div>
    </main>
  );
}

function TypeRow({
  granularType,
  activeFragment,
  isLocked,
  consensus,
}: {
  granularType: GranularType;
  activeFragment: GranularFragment | null;
  isLocked: boolean;
  consensus: number;
}) {
  const chapterIdentity = activeFragment
    ? getChapterIdentity(activeFragment.chapter)
    : null;
  const optColor = activeFragment && chapterIdentity
    ? (activeFragment.option === 'A' ? chapterIdentity.colorA : chapterIdentity.colorB)
    : null;

  // Consensus visualization: solid when unanimous, flickers when contested
  const consensusOpacity = consensus > 0.8 ? 1 : 0.4 + consensus * 0.6;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '16px 20px',
      borderRadius: '12px',
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: `1px solid ${isLocked ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
      opacity: isLocked ? 0.5 : 1,
      transition: 'opacity 0.3s ease, border-color 0.3s ease',
    }}>
      {/* Type symbol */}
      <div style={{
        width: '48px',
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '8px',
        backgroundColor: `${granularType.color}15`,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '1.5rem',
          color: granularType.color,
          opacity: consensusOpacity,
          transition: 'opacity 0.3s ease',
        }}>
          {granularType.symbol}
        </span>
      </div>

      {/* Type info */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: granularType.color,
          }}>
            {granularType.label}
          </span>
          {isLocked && (
            <span style={{
              fontSize: '0.55rem',
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              border: '1px solid rgba(255,255,255,0.2)',
              padding: '1px 6px',
              borderRadius: '3px',
            }}>
              LOCKED
            </span>
          )}
        </div>

        {/* Active fragment info */}
        {activeFragment && chapterIdentity ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '2px',
              backgroundColor: optColor ?? chapterIdentity.color,
            }} />
            <span style={{
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.05em',
            }}>
              {chapterIdentity.label} · Song {activeFragment.songIndex + 1} · {activeFragment.option}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)' }}>—</span>
        )}
      </div>

      {/* Consensus bar */}
      <div style={{
        width: '80px',
        height: '6px',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '3px',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          height: '100%',
          width: `${consensus * 100}%`,
          backgroundColor: optColor ?? chapterIdentity?.color ?? granularType.color,
          borderRadius: '3px',
          transition: 'width 0.3s ease',
          opacity: consensusOpacity,
        }} />
      </div>
    </div>
  );
}

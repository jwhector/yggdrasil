'use client';

import { useMemo, useState, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { useTriangleCentroid } from '@/hooks/useTriangle';
import { ConsensusBar } from '@/components/song-building/ConsensusBar';
import { DoubtMeter } from '@/components/song-building/DoubtMeter';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { SlotGrid } from '@/components/finale/SlotGrid';
import { TriangleSteering } from '@/components/finale/TriangleSteering';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { LayerResult, ShowPhase } from '@/conductor/types';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);

  // --- High-frequency: centroid interpolation (~4 Hz incoming, 60 fps rendered) ---
  const { centroid } = useTriangleCentroid({ socket });

  // --- High-frequency: meter levels (~10 Hz) ---
  const [meterLevels, setMeterLevels] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (!socket) return;
    const handleMeter = (data: { slots: Array<{ slotIndex: number; energy: number }> }) => {
      setMeterLevels(prev => {
        const next = new Map(prev);
        for (const { slotIndex, energy } of data.slots) {
          next.set(slotIndex, energy);
        }
        return next;
      });
    };
    socket.on('meter', handleMeter);
    return () => { socket.off('meter', handleMeter); };
  }, [socket]);

  // Derive live vote tallies from the current layer's votes
  const liveVotes = useMemo(() => {
    if (!currentAttempt) return null;
    const layerVotes = currentAttempt.votes.filter(
      (v) => v.layerIndex === currentAttempt.currentLayerIndex
    );
    const votesA = layerVotes.filter((v) => v.choice === 'A').length;
    const votesB = layerVotes.filter((v) => v.choice === 'B').length;
    const total = votesA + votesB;
    const consensus = total > 0 ? Math.max(votesA, votesB) / total : null;
    const winner: 'A' | 'B' = votesA >= votesB ? 'A' : 'B';
    return { votesA, votesB, total, consensus, winner };
  }, [currentAttempt]);

  // Current layer config
  const currentLayerConfig = useMemo(() => {
    if (!currentAttempt) return null;
    return currentAttempt.layerPlan[currentAttempt.currentLayerIndex] ?? null;
  }, [currentAttempt]);

  if (isLoading || !state) {
    return <ProjectorDark />;
  }

  const { phase, userCount } = state;

  switch (phase) {
    case 'lobby':
      return (
        <LobbyDisplay
          content={state.config.lobby.waitingMessage}
          userCount={userCount}
        />
      );

    case 'opener':
    case 'attempt_story':
      return <ProjectorDark />;

    case 'attempt_build': {
      if (!currentAttempt || !currentLayerConfig) return <ProjectorDark />;

      const chapter = getChapterIdentity(currentAttempt.chapter);
      const layer = getLayerIdentity(currentLayerConfig.type);
      const showMeters =
        currentAttempt.currentLayerPhase === 'voting' ||
        currentAttempt.currentLayerPhase === 'resolving';

      return (
        <main
          style={{
            minHeight: '100vh',
            width: '100vw',
            backgroundColor: '#000',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            padding: '40px',
            gap: '32px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxSizing: 'border-box',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Chapter header */}
          <ProjectorChapterHeader
            chapterLabel={chapter.label}
            chapterColor={chapter.color}
            attemptIndex={state.currentAttemptIndex}
            userCount={userCount}
          />

          {/* Current layer card */}
          <ProjectorLayerCard
            layerSymbol={layer.symbol}
            layerLabel={layer.label}
            layerColor={layer.color}
            layerPhase={currentAttempt.currentLayerPhase}
            labelA={currentLayerConfig.labelA}
            labelB={currentLayerConfig.labelB}
            winner={currentAttempt.layerResults[currentAttempt.currentLayerIndex]?.chosenOption ?? null}
          />

          {/* Stack history */}
          <ProjectorStackHistory results={currentAttempt.layerResults} />

          {/* Meters */}
          {showMeters && liveVotes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: 'auto' }}>
              <ConsensusBar
                votesA={liveVotes.votesA}
                votesB={liveVotes.votesB}
                totalVotes={liveVotes.total}
                winner={liveVotes.winner}
                consensus={liveVotes.consensus}
                layerType={currentLayerConfig.type}
              />
              <DoubtMeter
                consensus={liveVotes.consensus}
                doubtThreshold={currentLayerConfig.doubtThreshold}
                isActive={currentAttempt.currentLayerPhase === 'voting'}
                collapsed={currentAttempt.status === 'collapsed'}
              />
            </div>
          )}

          {/* Collapse overlay */}
          {currentAttempt.status === 'collapsed' && (
            <CollapseOverlay />
          )}
        </main>
      );
    }

    case 'finale_setup':
    case 'finale_rotating':
    case 'finale_frozen': {
      const fs = state.finaleState;
      if (!fs) return <ProjectorDark />;

      return (
        <main
          style={{
            minHeight: '100vh',
            width: '100vw',
            backgroundColor: '#000',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            padding: '40px',
            gap: '32px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxSizing: 'border-box',
          }}
        >
          {/* Phase indicator */}
          <FinalePhaseIndicator phase={phase} frozen={fs.frozen} />

          {/* 7 slot cards with energy glow */}
          <SlotGrid activeSlots={fs.activeSlots} meterLevels={meterLevels} />

          {/* Collective triangle centroid */}
          {fs.triangleActive && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <TriangleSteering
                centroid={centroid}
                showCentroid
                interactive={false}
                size={320}
              />
            </div>
          )}

          {/* Queue status */}
          <QueueStatus queueLength={fs.queue.length} />
        </main>
      );
    }

    case 'ended':
      return <ProjectorDark />;

    default:
      return <ProjectorDark />;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProjectorDark() {
  return <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: '#000' }} />;
}

function FinalePhaseIndicator({ phase, frozen }: { phase: ShowPhase; frozen: boolean }) {
  const label = frozen
    ? 'FROZEN'
    : phase === 'finale_setup'
    ? 'SETUP'
    : 'ROTATING';

  const color = frozen ? '#457b9d' : phase === 'finale_setup' ? 'rgba(255,255,255,0.3)' : '#22c55e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      <span
        style={{
          fontSize: '0.7rem',
          color,
          letterSpacing: '0.14em',
          fontWeight: 600,
        }}
      >
        FINALE — {label}
      </span>
    </div>
  );
}

function QueueStatus({ queueLength }: { queueLength: number }) {
  if (queueLength === 0) return null;
  return (
    <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em' }}>
      {queueLength} fragment{queueLength !== 1 ? 's' : ''} in queue
    </div>
  );
}

function ProjectorChapterHeader({
  chapterLabel,
  chapterColor,
  attemptIndex,
  userCount,
}: {
  chapterLabel: string;
  chapterColor: string;
  attemptIndex: number;
  userCount: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Accent bar */}
        <div
          style={{
            width: '4px',
            height: '32px',
            borderRadius: '2px',
            backgroundColor: chapterColor,
          }}
        />
        <div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.12em' }}>
            SONG {attemptIndex + 1}
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 600, color: chapterColor }}>
            {chapterLabel}
          </div>
        </div>
      </div>

      {/* User count */}
      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)' }}>
        {userCount} {userCount === 1 ? 'person' : 'people'}
      </div>
    </div>
  );
}

function ProjectorLayerCard({
  layerSymbol,
  layerLabel,
  layerColor,
  layerPhase,
  labelA,
  labelB,
  winner,
}: {
  layerSymbol: string;
  layerLabel: string;
  layerColor: string;
  layerPhase: string;
  labelA: string;
  labelB: string;
  winner: 'A' | 'B' | null;
}) {
  const isResolved = layerPhase === 'locked_in';
  const isCollapsed = layerPhase === 'collapsed';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        padding: '40px',
        borderRadius: '16px',
        border: `1px solid ${isCollapsed ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
        backgroundColor: isCollapsed ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
        flex: 1,
      }}
    >
      {/* Layer identity */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', color: layerColor }}>{layerSymbol}</div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', marginTop: '4px' }}>
          {layerLabel.toUpperCase()}
        </div>
      </div>

      {/* Phase label */}
      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em' }}>
        {isCollapsed ? 'COLLAPSED' : layerPhase.replace('_', ' ').toUpperCase()}
      </div>

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', width: '100%', alignItems: 'center' }}>
        {/* Option A */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '20px',
            borderRadius: '12px',
            backgroundColor: layerColor,
            opacity: isResolved && winner !== 'A' ? 0.25 : 1,
            transform: isResolved && winner === 'A' ? 'scale(1.03)' : 'scale(1)',
            transition: 'opacity 0.4s ease, transform 0.3s ease',
          }}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#000', letterSpacing: '0.1em' }}>A</span>
          <span style={{ fontSize: '1rem', color: '#000', textAlign: 'center' }}>{labelA}</span>
          {isResolved && winner === 'A' && (
            <span style={{ fontSize: '0.65rem', color: '#000', opacity: 0.7, letterSpacing: '0.08em' }}>CHOSEN</span>
          )}
        </div>

        {/* vs */}
        <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem' }}>vs</div>

        {/* Option B */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '20px',
            borderRadius: '12px',
            border: `2px solid ${layerColor}`,
            color: layerColor,
            opacity: isResolved && winner !== 'B' ? 0.25 : 1,
            transform: isResolved && winner === 'B' ? 'scale(1.03)' : 'scale(1)',
            transition: 'opacity 0.4s ease, transform 0.3s ease',
          }}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em' }}>B</span>
          <span style={{ fontSize: '1rem', textAlign: 'center' }}>{labelB}</span>
          {isResolved && winner === 'B' && (
            <span style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '0.08em' }}>CHOSEN</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectorStackHistory({ results }: { results: LayerResult[] }) {
  const resolved = results.filter((r) => r.status === 'locked_in');
  if (resolved.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
        BUILT
      </span>
      {resolved.map((result) => {
        const identity = getLayerIdentity(result.type);
        const isA = result.chosenOption === 'A';
        return (
          <div
            key={result.layerIndex}
            title={`Layer ${result.layerIndex + 1}: ${result.type} (${result.chosenOption})`}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.85rem',
              backgroundColor: isA ? identity.color : 'transparent',
              border: isA ? 'none' : `2px solid ${identity.color}`,
              color: isA ? '#000' : identity.color,
            }}
          >
            {identity.symbol}
          </div>
        );
      })}
    </div>
  );
}

function CollapseOverlay() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(239,68,68,0.12)',
        border: '2px solid rgba(239,68,68,0.3)',
        borderRadius: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        // TODO: Replace with collapse animation (visual + audio sync)
      }}
    >
      <p
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          color: 'rgba(239,68,68,0.6)',
          letterSpacing: '0.2em',
        }}
      >
        COLLAPSED
      </p>
    </div>
  );
}

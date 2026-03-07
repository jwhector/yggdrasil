'use client';

import { useMemo, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { HealthBar } from '@/components/song-building/HealthBar';
import { RevealSequence } from '@/components/song-building/RevealSequence';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { ProjectorConvergenceView } from '@/components/finale/ProjectorConvergenceView';
import { MixingMirror } from '@/components/finale/MixingMirror';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import type { LayerResult, LayerType } from '@/conductor/types';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);

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
      const isRevealing = currentAttempt.currentLayerPhase === 'revealing';

      // During revealing phase: compute vote result from votes + latest drain from health history
      const latestDrain = isRevealing
        ? currentAttempt.healthBar.history[currentAttempt.healthBar.history.length - 1] ?? null
        : null;
      const revealVoteResult = isRevealing && liveVotes
        ? {
            winner: liveVotes.winner,
            consensus: liveVotes.consensus ?? 0.5,
            votesA: liveVotes.votesA,
            votesB: liveVotes.votesB,
            totalVotes: liveVotes.total,
          }
        : null;

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

          {/* Health bar — prominent, always visible */}
          <HealthBar
            health={currentAttempt.healthBar.current}
            drainShadow={isRevealing && latestDrain ? latestDrain.drainAmount : 0}
            variant="projector"
          />

          {/* Current layer card OR reveal sequence */}
          {isRevealing && revealVoteResult && latestDrain ? (
            <RevealSequence
              voteResult={revealVoteResult}
              drain={{ drainAmount: latestDrain.drainAmount, healthAfter: latestDrain.healthAfter }}
              healthBefore={currentAttempt.healthBar.current + latestDrain.drainAmount}
              layerConfig={currentLayerConfig}
              variant="projector"
            />
          ) : (
            <ProjectorLayerCard
              layerSymbol={layer.symbol}
              layerLabel={layer.label}
              layerColor={layer.color}
              layerPhase={currentAttempt.currentLayerPhase}
              labelA={currentLayerConfig.labelA}
              labelB={currentLayerConfig.labelB}
              winner={currentAttempt.layerResults[currentAttempt.currentLayerIndex]?.chosenOption ?? null}
            />
          )}

          {/* Stack history */}
          <ProjectorStackHistory results={currentAttempt.layerResults} />

          {/* Collapse overlay */}
          {currentAttempt.status === 'collapsed' && (
            <CollapseOverlay />
          )}
        </main>
      );
    }

    case 'finale_elegy': {
      const fs = state.finaleState;
      if (!fs) return <ProjectorDark />;
      return (
        <main style={projectorMainStyle}>
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.15em', textTransform: 'uppercase' as const }}>
            The Elegy
          </div>
          <ElegyGrid
            availableFragments={fs.availableFragments}
            lockedFragments={fs.lockedFragments}
            variant="projector"
          />
        </main>
      );
    }

    case 'finale_consensus': {
      const fs = state.finaleState;
      if (!fs) return <ProjectorDark />;
      return (
        <main style={projectorMainStyle}>
          <ProjectorConvergenceView
            convergenceValue={fs.convergenceValue}
            threshold={fs.threshold}
            roundTimeRemaining={fs.roundTimeRemaining}
            roundDurationMs={15000}
            currentRound={fs.currentRound}
            lockedRoles={fs.lockedRoles as Array<{ layerType: LayerType; fragmentId: string }>}
            availableFragments={fs.availableFragments}
            npcMessage={fs.npcMessage}
            socket={socket}
          />
        </main>
      );
    }

    case 'finale_performer_mix': {
      const fs = state.finaleState;
      if (!fs) return <ProjectorDark />;
      return (
        <main style={projectorMainStyle}>
          <MixingMirror
            activeLayers={fs.mixActiveLayers as Array<{ layerType: LayerType; fragmentId: string | null }>}
            pendingChanges={fs.mixPendingChanges}
            loopPosition={fs.loopPosition}
            loopCount={0}
            allFragments={fs.availableFragments}
          />
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

const projectorMainStyle: React.CSSProperties = {
  minHeight: '100vh',
  width: '100vw',
  backgroundColor: '#000',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxSizing: 'border-box',
  overflowY: 'auto',
};

function ProjectorDark() {
  return <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: '#000' }} />;
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

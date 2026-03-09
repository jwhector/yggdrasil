'use client';

import { useState } from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { HealthBar } from '@/components/song-building/HealthBar';
import { LayerProgress } from '@/components/song-building/LayerProgress';
import { OptionCards } from '@/components/song-building/OptionCards';
import { RevealSequence } from '@/components/song-building/RevealSequence';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { ConvergenceMeter } from '@/components/finale/ConvergenceMeter';
import { ConsensusBoard } from '@/components/finale/ConsensusBoard';
import { NpcDisplay } from '@/components/finale/NpcDisplay';
import { useConvergence } from '@/hooks/useConvergence';
import type { AudienceFinaleView, LayerType } from '@/conductor/types';
import type { Socket } from 'socket.io-client';

const SHOW_ID = 'default-show';

// ---------------------------------------------------------------------------
// Main export — wrapped in Suspense for useSearchParams
// ---------------------------------------------------------------------------

export default function AudiencePage() {
  return (
    <Suspense fallback={<FullDark />}>
      <AudienceContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Inner component (has access to search params)
// ---------------------------------------------------------------------------

function AudienceContent() {
  const searchParams = useSearchParams();
  const seatId = searchParams.get('seat') ?? undefined;

  const { socket, connectionState, userId, emit } = useSocket({
    showId: SHOW_ID,
    seatId: seatId ?? null,
    mode: 'audience',
  });

  const { state, isLoading, currentAttempt } = useShowState(socket, 'audience', userId);

  const handleVote = (choice: 'A' | 'B') => {
    emit('vote', { choice });
  };

  // Loading / not yet connected
  if (isLoading || !state) {
    return (
      <Screen>
        <ConnectionIndicator state={connectionState} />
        <PulsingDot />
      </Screen>
    );
  }

  const { phase, paused, config } = state;

  console.log(state);

  return (
    <Screen>
      {/* Pause overlay */}
      {paused && <PauseOverlay />}

      {/* Connection indicator (top-right corner) */}
      <ConnectionIndicator state={connectionState} />

      {/* Phase routing */}
      {phase === 'lobby' && (
        <LobbyScreen message={config.lobby.waitingMessage} />
      )}

      {(phase === 'opener' || phase === 'attempt_story') && (
        <DarkListenScreen />
      )}

      {phase === 'attempt_build' && currentAttempt && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            minHeight: '100vh',
            overflowY: 'auto',
            paddingTop: '16px',
            paddingBottom: '32px',
            gap: '12px',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          {/* Chapter label */}
          <ChapterLabel chapter={currentAttempt.chapter} attemptIndex={state.currentAttemptIndex} />

          {/* Health bar */}
          <HealthBar
            health={currentAttempt.healthBar.current}
            drainShadow={
              currentAttempt.currentLayerPhase === 'revealing' && currentAttempt.currentDrain
                ? currentAttempt.currentDrain.drainAmount
                : 0
            }
            variant="audience"
          />

          {/* Layer progress strip */}
          <LayerProgress
            layerResults={currentAttempt.layerResults}
            currentLayerIndex={currentAttempt.currentLayerIndex}
            currentLayerPhase={currentAttempt.currentLayerPhase}
            layerCount={currentAttempt.layerCount}
            chapter={currentAttempt.chapter}
          />

          {/* Voting cards OR reveal sequence */}
          {currentAttempt.currentLayerPhase === 'revealing' &&
            currentAttempt.currentVoteResult &&
            currentAttempt.currentDrain &&
            currentAttempt.currentLayerConfig ? (
            <RevealSequence
              voteResult={currentAttempt.currentVoteResult}
              drain={currentAttempt.currentDrain}
              healthBefore={currentAttempt.healthBar.current + currentAttempt.currentDrain.drainAmount}
              layerConfig={currentAttempt.currentLayerConfig}
              variant="audience"
            />
          ) : currentAttempt.currentLayerConfig ? (
            <OptionCards
              layerConfig={currentAttempt.currentLayerConfig}
              myVote={currentAttempt.myVote}
              disabled={
                (currentAttempt.currentLayerPhase !== 'auditioning' && currentAttempt.currentLayerPhase !== 'voting')
              }
              onVote={handleVote}
            />
          ) : null}

          {/* Phase hint */}
          <LayerPhaseHint phase={currentAttempt.currentLayerPhase} hasVoted={currentAttempt.myVote !== null} />
        </div>
      )}

      {phase === 'attempt_build' && !currentAttempt && (
        <DarkListenScreen />
      )}

      {(phase === 'finale_elegy' || phase === 'finale_consensus' || phase === 'finale_performer_mix') && (
        state.myFinale
          ? <FinaleAudienceView myFinale={state.myFinale} phase={phase} socket={socket} emit={emit} />
          : <DarkListenScreen />
      )}

      {phase === 'ended' && (
        <p style={{ fontSize: '1.5rem', color: 'rgba(255,255,255,0.7)' }}>Thank you</p>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Finale audience view (V2)
// ---------------------------------------------------------------------------

function FinaleAudienceView({
  myFinale,
  phase,
  socket,
  emit,
}: {
  myFinale: AudienceFinaleView;
  phase: string;
  socket: Socket | null;
  emit: (event: string, data: unknown) => void;
}) {
  const { animatedValue } = useConvergence({
    socket,
    threshold: myFinale.threshold,
    timeRemaining: myFinale.roundTimeRemaining,
  });

  console.log(phase);

  const handleVote = (fragmentId: string) => {
    emit('consensus_vote', { fragmentId });
  };

  // --- Elegy phase: show all fragments non-interactively ---
  if (phase === 'finale_elegy') {
    // Build available (winners) and locked (losers) lists from AudienceFinaleView
    // AudienceFinaleView only provides availableFragments (winners only, with locked flag)
    // We show them all in a simplified elegy grid
    const winners = myFinale.availableFragments
      .filter(a => !a.locked)
      .map(a => a.fragment);
    const locked = myFinale.availableFragments
      .filter(a => a.locked)
      .map(a => a.fragment);
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100vh',
          overflowY: 'auto',
          paddingBottom: '32px',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '24px 16px 8px',
            fontSize: '0.65rem',
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          What remains
        </div>
        <ElegyGrid
          availableFragments={winners}
          lockedFragments={locked}
          variant="audience"
        />
      </div>
    );
  }

  // --- Consensus game phase ---
  if (phase === 'finale_consensus') {
    const roundDurationMs = 15000; // default; ideally passed from config
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          minHeight: '100vh',
          padding: '16px',
          boxSizing: 'border-box',
          gap: '12px',
        }}
      >
        {/* Convergence meter — pinned at top */}
        <ConvergenceMeter
          animatedValue={animatedValue}
          threshold={myFinale.threshold}
          timeRemaining={myFinale.roundTimeRemaining}
          roundDurationMs={roundDurationMs}
          roundActive={myFinale.roundTimeRemaining > 0}
        />

        {/* NPC display */}
        <NpcDisplay socket={socket} />

        {/* Consensus board */}
        <div style={{ flex: 1 }}>
          <ConsensusBoard
            availableFragments={myFinale.availableFragments}
            myVote={myFinale.myVote}
            lockedRoles={myFinale.lockedRoles as Array<{ layerType: LayerType; fragmentId: string }>}
            roundActive={myFinale.roundTimeRemaining > 0}
            onVote={handleVote}
          />
        </div>
      </div>
    );
  }

  // --- Performer mix phase: passive dark screen (TBD) ---
  if (phase === 'finale_performer_mix') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: '100vh',
          gap: '16px',
        }}
      >
        <PulsingDot />
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem', letterSpacing: '0.15em' }}>
          FINALE IN PROGRESS
        </p>
      </div>
    );
  }

  return <DarkListenScreen />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Screen({ children }: { children?: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {children}
    </main>
  );
}

function FullDark() {
  return <div style={{ minHeight: '100vh', backgroundColor: '#000' }} />;
}

function DarkListenScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <PulsingDot />
      <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem', letterSpacing: '0.15em' }}>
        LISTEN
      </p>
    </div>
  );
}

function LobbyScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        padding: '32px',
        textAlign: 'center',
        maxWidth: '400px',
      }}
    >
      <PulsingDot />
      <p style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        {message}
      </p>
    </div>
  );
}

function PulsingDot() {
  return (
    <div
      style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: 'rgba(255,255,255,0.3)',
      }}
    />
  );
}

function ChapterLabel({ chapter, attemptIndex }: { chapter: string; attemptIndex: number }) {
  return (
    <div
      style={{
        textAlign: 'center',
        paddingBottom: '8px',
        color: 'rgba(255,255,255,0.4)',
        fontSize: '0.75rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      Song {attemptIndex + 1} · {chapter}
    </div>
  );
}

function LayerPhaseHint({ phase, hasVoted }: { phase: string; hasVoted: boolean }) {
  if (phase === 'voting' && !hasVoted) {
    return (
      <p
        style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.4)',
          fontSize: '0.8rem',
          marginTop: '16px',
          letterSpacing: '0.08em',
        }}
      >
        Tap to vote
      </p>
    );
  }
  if (phase === 'voting' && hasVoted) {
    return (
      <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', marginTop: '16px' }}>
        Vote recorded
      </p>
    );
  }
  return null;
}

function PauseOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', fontSize: '0.9rem' }}>
        PAUSED
      </p>
    </div>
  );
}

function ConnectionIndicator({ state }: { state: string }) {
  if (state === 'connected') return null;

  const color = state === 'connecting' ? '#f5c542' : '#ef4444';
  const label = state === 'connecting' ? 'connecting' : 'reconnecting';

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        right: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '20px',
        backgroundColor: 'rgba(0,0,0,0.6)',
        border: `1px solid ${color}`,
        zIndex: 100,
      }}
    >
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color }} />
      <span style={{ fontSize: '0.65rem', color, letterSpacing: '0.08em' }}>{label}</span>
    </div>
  );
}

'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { LayerProgress } from '@/components/song-building/LayerProgress';
import { OptionCards } from '@/components/song-building/OptionCards';
import { RevealSequence } from '@/components/song-building/RevealSequence';
import { UrgencyEffects } from '@/components/song-building/UrgencyEffects';
import { AuditionProgress } from '@/components/song-building/AuditionProgress';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { AssignmentCards } from '@/components/finale/AssignmentCards';
import { AssignmentIdentity } from '@/components/finale/AssignmentIdentity';
import { LiveMixController } from '@/components/finale/LiveMixController';
import { LiveMixSpectator } from '@/components/finale/LiveMixSpectator';
import { useLiveMix } from '@/hooks/useLiveMix';
import type { AudienceFinaleView, GranularType } from '@/conductor/types';
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

  const auditionProgress = useAuditionProgress(
    socket,
    state?.phase,
    currentAttempt?.currentLayerPhase,
  );

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

          {/* Layer progress strip */}
          <LayerProgress
            layerResults={currentAttempt.layerResults}
            currentLayerIndex={currentAttempt.currentLayerIndex}
            currentLayerPhase={currentAttempt.currentLayerPhase}
            layerCount={currentAttempt.layerCount}
            chapter={currentAttempt.chapter}
          />

          {/* Audition progress (during auditioning phase) */}
          {currentAttempt.currentLayerPhase === 'auditioning' && auditionProgress && (
            <AuditionProgress progress={auditionProgress} />
          )}

          {/* Reveal sequence (during revealing phase) */}
          {currentAttempt.currentLayerPhase === 'revealing'
            && currentAttempt.currentVoteResult
            && currentAttempt.lastThresholdCheck
            && currentAttempt.currentLayerConfig ? (
            <RevealSequence
              voteResult={{
                winner: currentAttempt.currentVoteResult.winner,
                consensus: currentAttempt.currentVoteResult.winningProportion,
              }}
              thresholdCheck={currentAttempt.lastThresholdCheck}
              layerConfig={currentAttempt.currentLayerConfig}
              variant="audience"
            />
          ) : null}

          {/* Voting cards (during auditioning phase) */}
          {currentAttempt.currentLayerPhase !== 'revealing' && currentAttempt.currentLayerConfig ? (
            <UrgencyEffects
              layerIndex={currentAttempt.currentLayerIndex}
              collapsed={currentAttempt.status === 'collapsed'}
            >
              <div className="urgency-cards">
                <OptionCards
                  layerConfig={currentAttempt.currentLayerConfig}
                  myVote={currentAttempt.myVote}
                  disabled={currentAttempt.currentLayerPhase !== 'auditioning'}
                  onVote={handleVote}
                  currentAuditionOption={currentAttempt.currentAuditionOption}
                />
              </div>
              <LayerPhaseHint phase={currentAttempt.currentLayerPhase} hasVoted={currentAttempt.myVote !== null} />
            </UrgencyEffects>
          ) : null}

          {/* Phase hint outside urgency wrapper (only during reveal) */}
          {currentAttempt.currentLayerPhase === 'revealing' && (
            <LayerPhaseHint phase={currentAttempt.currentLayerPhase} hasVoted={currentAttempt.myVote !== null} />
          )}
        </div>
      )}

      {phase === 'attempt_build' && !currentAttempt && (
        <DarkListenScreen />
      )}

      {(phase === 'finale_elegy' || phase === 'finale_assignment' || phase === 'finale_live_mix') && (
        state.myFinale
          ? <FinaleAudienceView myFinale={state.myFinale} phase={phase} socket={socket} emit={emit} granularTypes={state.config.granularTypes ?? []} />
          : <DarkListenScreen />
      )}

      {phase === 'ended' && (
        <p style={{ fontSize: '1.5rem', color: 'rgba(255,255,255,0.7)' }}>Thank you</p>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Finale audience view (V3.2)
// ---------------------------------------------------------------------------

function FinaleAudienceView({
  myFinale,
  phase,
  socket,
  emit,
  granularTypes,
}: {
  myFinale: AudienceFinaleView;
  phase: string;
  socket: Socket | null;
  emit: (event: string, data: unknown) => void;
  granularTypes: GranularType[];
}) {
  // --- Elegy phase: show all fragments non-interactively ---
  if (phase === 'finale_elegy') {
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
          availableFragments={myFinale.myGroupFragments}
          lockedFragments={[]}
          variant="audience"
        />
      </div>
    );
  }

  // --- Assignment phase (V3.2) ---
  if (phase === 'finale_assignment') {
    // After assignment completes, show identity
    if (myFinale.assignmentTimerRemaining != null && myFinale.assignmentTimerRemaining <= 0 && myFinale.myGranularType !== null) {
      const gt = granularTypes.find(t => t.id === myFinale.myGranularType);
      if (gt) return <AssignmentIdentity granularType={gt} />;
    }
    // Auto-assignment: show identity immediately
    if (myFinale.assignmentMode === 'auto' && myFinale.myGranularType !== null) {
      const gt = granularTypes.find(t => t.id === myFinale.myGranularType);
      if (gt) return <AssignmentIdentity granularType={gt} />;
    }
    return (
      <AssignmentCards
        myGranularType={myFinale.myGranularType}
        granularTypes={granularTypes}
        groupSizes={myFinale.groupSizes}
        timerRemaining={myFinale.assignmentTimerRemaining ?? 0}
        onSelect={(granularType) => emit('select_type', { granularType })}
        socket={socket}
      />
    );
  }

  // --- Live mix phase (V3.2) ---
  if (phase === 'finale_live_mix') {
    return (
      <LiveMixView
        myFinale={myFinale}
        socket={socket}
      />
    );
  }

  return <DarkListenScreen />;
}

// ---------------------------------------------------------------------------
// Live mix wrapper (needs hook call, so must be its own component)
// ---------------------------------------------------------------------------

function LiveMixView({
  myFinale,
  socket,
}: {
  myFinale: AudienceFinaleView;
  socket: Socket | null;
}) {
  const liveMix = useLiveMix(socket, myFinale);

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        overflowY: 'auto',
        padding: '24px 16px 48px',
        boxSizing: 'border-box',
      }}
    >
      {myFinale.myGranularType && (
        <LiveMixController
          fragments={liveMix.myGroupFragments}
          myVote={liveMix.myVote}
          activeFragment={liveMix.activeFragment}
          voteDistribution={liveMix.voteDistribution}
          totalVotes={liveMix.totalVotes}
          isLocked={liveMix.isLocked}
          isMuted={liveMix.isMuted}
          granularType={myFinale.myGranularType}
          onSelectFragment={liveMix.setPreference}
        />
      )}

      <LiveMixSpectator
        activeFragments={liveMix.otherTypesActive}
      />
    </div>
  );
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
  if (phase === 'auditioning' && !hasVoted) {
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
  if (phase === 'auditioning' && hasVoted) {
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

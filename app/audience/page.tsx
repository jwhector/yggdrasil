'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { MiniSkeleton } from '@/components/song-building/MiniSkeleton';
import { OptionCards } from '@/components/song-building/OptionCards';
import type { RevealResult } from '@/components/song-building/OptionCards';
import { AuditionBars } from '@/components/song-building/AuditionBars';
import { LayerDots } from '@/components/song-building/LayerDots';
import { IntrusiveThoughts } from '@/components/song-building/IntrusiveThoughts';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { AssignmentCards } from '@/components/finale/AssignmentCards';
import { AssignmentIdentity } from '@/components/finale/AssignmentIdentity';
import { LiveMixController } from '@/components/finale/LiveMixController';
import { LiveMixSpectator } from '@/components/finale/LiveMixSpectator';
import { useLiveMix } from '@/hooks/useLiveMix';
import type { AudienceFinaleView, AudienceAttemptView, AudienceClientState, GranularType, AuditionProgress as AuditionProgressData } from '@/conductor/types';
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
        <BuildView
          currentAttempt={currentAttempt}
          auditionProgress={auditionProgress}
          config={state.config}
          attemptIndex={state.currentAttemptIndex}
          onVote={handleVote}
        />
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

// ---------------------------------------------------------------------------
// Build View — song-building audience UI
// ---------------------------------------------------------------------------

function BuildView({
  currentAttempt,
  auditionProgress,
  config,
  attemptIndex,
  onVote,
}: {
  currentAttempt: AudienceAttemptView;
  auditionProgress: AuditionProgressData | null;
  config: AudienceClientState['config'];
  attemptIndex: number;
  onVote: (choice: 'A' | 'B') => void;
}) {
  const [thoughtsDismissed, setThoughtsDismissed] = useState(false);
  const [prevLayerKey, setPrevLayerKey] = useState('');

  const { chapter, currentLayerIndex, currentLayerPhase, layerResults, myVote } = currentAttempt;

  // Reset dismissed state when layer changes
  const currentLayerKey = `${currentAttempt.index}-${currentLayerIndex}`;
  if (currentLayerKey !== prevLayerKey) {
    setPrevLayerKey(currentLayerKey);
    setThoughtsDismissed(false);
  }
  const isRevealing = currentLayerPhase === 'revealing';
  const isAuditioning = currentLayerPhase === 'auditioning';
  const hasVoted = myVote !== null;

  // Intrusive thoughts for this attempt + layer
  const thoughtsConfig = config.intrusiveThoughts?.find(c => c.chapter === chapter);
  const thoughts = thoughtsConfig?.layers[currentLayerIndex] ?? [];
  const thoughtsActive = isRevealing && thoughts.length > 0;

  const layerKey = `${attemptIndex}-${currentLayerIndex}`;

  // Build reveal result from vote data
  let revealResult: RevealResult | null = null;
  if (isRevealing && currentAttempt.currentVoteResult && currentAttempt.lastThresholdCheck && thoughtsDismissed) {
    const vr = currentAttempt.currentVoteResult;
    revealResult = {
      winner: vr.winner,
      proportionA: vr.winner === 'A' ? vr.winningProportion : 1 - vr.winningProportion,
      proportionB: vr.winner === 'B' ? vr.winningProportion : 1 - vr.winningProportion,
      passed: currentAttempt.lastThresholdCheck.passed,
    };
  }

  // Also show reveal for locked_in / collapsed (post-reveal states)
  if ((currentLayerPhase === 'locked_in' || currentLayerPhase === 'collapsed') && currentAttempt.currentVoteResult && currentAttempt.lastThresholdCheck) {
    const vr = currentAttempt.currentVoteResult;
    revealResult = {
      winner: vr.winner,
      proportionA: vr.winner === 'A' ? vr.winningProportion : 1 - vr.winningProportion,
      proportionB: vr.winner === 'B' ? vr.winningProportion : 1 - vr.winningProportion,
      passed: currentAttempt.lastThresholdCheck.passed,
    };
  }

  const isDimmed = thoughtsActive && !thoughtsDismissed;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minHeight: '100vh',
        overflowY: 'auto',
        padding: '16px',
        paddingBottom: '32px',
        gap: '12px',
        boxSizing: 'border-box',
        alignItems: 'center',
      }}
    >
      {/* Mini pentagon skeleton */}
      <div style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.4s ease' }}>
        <MiniSkeleton
          chapter={chapter}
          currentLayerIndex={currentLayerIndex}
          layerResults={layerResults}
          layerPlan={currentAttempt.layerPlan}
          layerPhase={currentLayerPhase}
          currentAuditionOption={currentAttempt.currentAuditionOption}
          layerGroups={[]}
        />
      </div>

      {/* Option cards — visible during auditioning, locked, and reveal */}
      {currentAttempt.currentLayerConfig && (
        <OptionCards
          layerConfig={currentAttempt.currentLayerConfig}
          myVote={myVote}
          disabled={!isAuditioning}
          onVote={onVote}
          currentAuditionOption={currentAttempt.currentAuditionOption}
          chapter={chapter}
          revealResult={revealResult}
          dimmed={isDimmed}
        />
      )}

      {/* Audition depleting bars (only during auditioning, before vote) */}
      {isAuditioning && auditionProgress && (
        <div style={{ width: '100%', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.4s ease' }}>
          <AuditionBars
            progress={auditionProgress}
            chapter={chapter}
            currentAuditionOption={currentAttempt.currentAuditionOption}
          />
        </div>
      )}

      {/* Layer dots */}
      <div style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.4s ease' }}>
        <LayerDots
          layerCount={currentAttempt.layerCount}
          currentLayerIndex={currentLayerIndex}
          layerResults={layerResults}
          chapter={chapter}
        />
      </div>

      {/* Bottom text hints */}
      {isAuditioning && !hasVoted && (
        <p
          style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.15)',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: isDimmed ? 0.3 : 1,
            transition: 'opacity 0.4s ease',
          }}
        >
          TAP TO VOTE
        </p>
      )}
      {isAuditioning && hasVoted && (
        <p
          style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.12)',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: isDimmed ? 0.3 : 1,
            transition: 'opacity 0.4s ease',
          }}
        >
          VOTE LOCKED
        </p>
      )}

      {/* Intrusive thoughts overlay */}
      <IntrusiveThoughts
        key={layerKey}
        thoughts={thoughts}
        active={thoughtsActive}
        dismissed={thoughtsDismissed}
        onDismiss={() => setThoughtsDismissed(true)}
        chapter={chapter}
      />
    </div>
  );
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

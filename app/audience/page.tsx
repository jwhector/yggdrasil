'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { DisconnectOverlay } from '@/components/DisconnectOverlay';
import { MiniSkeleton } from '@/components/song-building/MiniSkeleton';
import { OptionCards } from '@/components/song-building/OptionCards';
import type { RevealResult } from '@/components/song-building/OptionCards';
import { AuditionBars } from '@/components/song-building/AuditionBars';
import { LayerDots } from '@/components/song-building/LayerDots';
import { IntrusiveThoughts } from '@/components/song-building/IntrusiveThoughts';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { useIntrusiveThoughts } from '@/hooks/useIntrusiveThoughts';
import { useQuilt } from '@/hooks/useQuilt';
import { QuiltGrid } from '@/components/finale/QuiltGrid';
import { QuiltPreview } from '@/components/finale/QuiltPreview';
import { QuiltRemix } from '@/components/finale/QuiltRemix';
import { NpcDisplay } from '@/components/finale/NpcDisplay';
import type { AudienceFinaleView, AudienceAttemptView, GranularType, AuditionProgress as AuditionProgressData } from '@/conductor/types';
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

  const { socket, connectionState, userId, emit, reconnect, hasGivenUp } = useSocket({
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
        <DisconnectOverlay connectionState={connectionState} hasGivenUp={hasGivenUp} onReconnect={reconnect} />
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

      {/* Disconnect overlay */}
      <DisconnectOverlay connectionState={connectionState} hasGivenUp={hasGivenUp} onReconnect={reconnect} />

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
          attemptIndex={state.currentAttemptIndex}
          onVote={handleVote}
          socket={socket}
        />
      )}

      {phase === 'attempt_build' && !currentAttempt && (
        <DarkListenScreen />
      )}

      {(phase === 'finale_elegy' || phase === 'finale_assignment' || phase === 'finale_preview' || phase === 'finale_playback') && (
        state.myFinale
          ? <FinaleAudienceView
              myFinale={state.myFinale}
              phase={phase}
              socket={socket}
              emit={emit}
              granularTypes={state.config.granularTypes ?? []}
            />
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
  const quilt = useQuilt(socket, myFinale);

  // --- Elegy phase: NPC briefing + opt-in ---
  if (phase === 'finale_elegy') {
    return (
      <ElegyBriefing
        socket={socket}
        optedIn={myFinale.optedIn}
        optInCount={myFinale.optInCount}
        onOptIn={() => emit('elegy_opt_in', {})}
      />
    );
  }

  // --- Non-opted-in users: minimal "Listen." screen for all subsequent phases ---
  if (!myFinale.optedIn) {
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
        }}
      >
        <div
          style={{
            color: 'rgba(255,255,255,0.2)',
            fontSize: '0.8rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          Listen.
        </div>
      </div>
    );
  }

  // --- Assignment phase (V3.3: cell claiming) ---
  if (phase === 'finale_assignment' && quilt.grid) {
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}
        >
          {quilt.assignmentTimerRemaining !== null
            ? `Pick a cell — ${Math.ceil(quilt.assignmentTimerRemaining / 1000)}s`
            : 'Pick a cell'}
        </div>
        <QuiltGrid
          grid={quilt.grid}
          variant="audience"
          granularTypes={granularTypes}
          myCellId={quilt.myCellId}
          onCellTap={(cellId) => {
            if (quilt.myCellId === cellId) {
              // Tap own cell → release it
              quilt.releaseCell();
            } else {
              // Only attempt to claim if the target cell is unclaimed
              const targetCell = quilt.grid?.cells.find(c => c.id === cellId);
              if (targetCell?.ownerId !== null) return; // Already claimed by someone else
              if (quilt.myCellId) quilt.releaseCell();
              quilt.claimCell(cellId);
            }
          }}
        />
        {quilt.myCellId && (
          <div
            style={{
              marginTop: '12px',
              fontSize: '0.6rem',
              color: 'rgba(255,255,255,0.25)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Cell claimed — tap another to switch
          </div>
        )}
      </div>
    );
  }

  // --- Preview phase (V3.3) ---
  if (phase === 'finale_preview' && quilt.grid && quilt.myCell) {
    return (
      <QuiltPreview
        grid={quilt.grid}
        myCell={quilt.myCell}
        myCellId={quilt.myCellId!}
        availableSongs={quilt.availableSongs}
        lockedIn={quilt.lockedIn}
        timerRemaining={quilt.previewTimerRemaining}
        granularTypes={granularTypes}
        audioPreviewPath={myFinale.audioPreviewPath}
        onSetSong={quilt.setSong}
        onLockIn={quilt.lockIn}
      />
    );
  }

  // --- Playback phase (V3.3) ---
  if (phase === 'finale_playback' && quilt.grid) {
    // If audience remix is enabled and user has a cell, show remix UI
    if (myFinale.audienceRemix.enabled && quilt.myCell) {
      return (
        <QuiltRemix
          grid={quilt.grid}
          myCell={quilt.myCell}
          myCellId={quilt.myCellId!}
          availableSongs={quilt.availableSongs}
          granularTypes={granularTypes}
          remixConfig={myFinale.audienceRemix}
          lockedCells={quilt.lockedCells}
          mutedCells={quilt.mutedCells}
          onMoveCell={quilt.moveCell}
          onChangeSong={quilt.changeSong}
        />
      );
    }

    // Spectator view (no cell or remix disabled): read-only grid with playhead
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 0',
        }}
      >
        <QuiltGrid
          grid={quilt.grid}
          variant="audience"
          granularTypes={granularTypes}
          myCellId={quilt.myCellId}
          lockedCells={quilt.lockedCells}
          mutedCells={quilt.mutedCells}
          showPlayhead
        />
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

// ---------------------------------------------------------------------------
// Build View — song-building audience UI
// ---------------------------------------------------------------------------

function BuildView({
  currentAttempt,
  auditionProgress,
  attemptIndex,
  onVote,
  socket,
}: {
  currentAttempt: AudienceAttemptView;
  auditionProgress: AuditionProgressData | null;
  attemptIndex: number;
  onVote: (choice: 'A' | 'B') => void;
  socket: Socket | null;
}) {
  const { chapter, currentLayerIndex, currentLayerPhase, layerResults, myVote } = currentAttempt;
  const isLocked = currentLayerPhase === 'locked';
  const isAuditioning = currentLayerPhase === 'auditioning';
  const hasVoted = myVote !== null;

  // Server-driven intrusive thoughts
  const intrusiveThoughts = useIntrusiveThoughts(socket, undefined, currentLayerPhase);
  const thoughtsBlocking = intrusiveThoughts.hasThoughts;

  const layerKey = `${attemptIndex}-${currentLayerIndex}`;

  // Build reveal result from vote data.
  // Only show after the conductor advances past revealing (locked_in / collapsed),
  // AND after the user has dismissed intrusive thoughts.
  let revealResult: RevealResult | null = null;
  const hasVoteData = currentAttempt.currentVoteResult && currentAttempt.lastThresholdCheck;
  const verdictPhase = currentLayerPhase === 'locked_in' || currentLayerPhase === 'collapsed';
  if (verdictPhase && hasVoteData && !thoughtsBlocking) {
    const vr = currentAttempt.currentVoteResult!;
    revealResult = {
      winner: vr.winner,
      proportionA: vr.winner === 'A' ? vr.winningProportion : 1 - vr.winningProportion,
      proportionB: vr.winner === 'B' ? vr.winningProportion : 1 - vr.winningProportion,
      passed: currentAttempt.lastThresholdCheck!.passed,
    };
  }

  const isDimmed = thoughtsBlocking;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minHeight: '100vh',
        overflowY: isLocked ? 'hidden' : 'auto',
        padding: '16px',
        paddingBottom: '32px',
        gap: isLocked ? '0px' : '12px',
        boxSizing: 'border-box',
        alignItems: 'center',
        transition: 'gap 0.6s ease',
      }}
    >
      {/* Skeleton — centered+scaled when locked, small at top when active */}
      <div
        style={{
          marginTop: isLocked ? 'calc(50vh - 140px)' : '0px',
          transform: isLocked ? 'scale(1.25)' : 'scale(1)',
          transition: 'margin-top 0.6s ease, transform 0.6s ease, opacity 0.4s ease',
          opacity: isDimmed ? 0.3 : 1,
          transformOrigin: 'center top',
        }}
      >
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

      {/* A/B content — fades + slides in when auditioning starts */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          opacity: isLocked ? 0 : 1,
          transform: isLocked ? 'translateY(20px)' : 'translateY(0)',
          transition: 'opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s',
          pointerEvents: isLocked ? 'none' : 'auto',
        }}
      >
        {/* Option cards — visible during auditioning and reveal */}
        {currentAttempt.currentLayerConfig && (
          <OptionCards
            layerConfig={currentAttempt.currentLayerConfig}
            myVote={myVote}
            disabled={!isAuditioning || thoughtsBlocking}
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
      </div>

      {/* Layer dots — always visible */}
      <div style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.4s ease' }}>
        <LayerDots
          layerCount={currentAttempt.layerCount}
          currentLayerIndex={currentLayerIndex}
          layerResults={layerResults}
          chapter={chapter}
        />
      </div>

      {/* Intrusive thoughts overlay */}
      <IntrusiveThoughts
        key={layerKey}
        thoughts={intrusiveThoughts.thoughts}
        active={intrusiveThoughts.hasThoughts}
        onDismiss={intrusiveThoughts.dismissThought}
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

// ---------------------------------------------------------------------------
// Elegy Briefing — NPC terminal text + opt-in button
// ---------------------------------------------------------------------------

function ElegyBriefing({
  socket,
  optedIn,
  optInCount,
  onOptIn,
}: {
  socket: Socket | null;
  optedIn: boolean;
  optInCount: number;
  onOptIn: () => void;
}) {
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        padding: '24px 20px',
        boxSizing: 'border-box',
      }}
    >
      {/* NPC terminal text — performer triggers via SEND_NPC_MESSAGE */}
      <div style={{ width: '100%', maxWidth: 360, marginBottom: '32px' }}>
        <NpcDisplay socket={socket} fadeDurationMs={999999} />
      </div>

      {/* Opt-in button */}
      {!optedIn ? (
        <button
          onClick={onOptIn}
          style={{
            padding: '14px 32px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.3)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            cursor: 'pointer',
            transition: 'background 0.2s ease, border-color 0.2s ease',
          }}
        >
          R E B U I L D
        </button>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Waiting for the mind to coalesce...
          </div>
          {optInCount > 0 && (
            <div
              style={{
                color: 'rgba(255,255,255,0.25)',
                fontSize: '0.65rem',
                letterSpacing: '0.08em',
              }}
            >
              {optInCount} {optInCount === 1 ? 'councillor' : 'councillors'} coalesced
            </div>
          )}
        </div>
      )}
    </div>
  );
}


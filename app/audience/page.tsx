'use client';

import { Suspense, useRef, useCallback, useState, useEffect } from 'react';
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
import { EmotionVote } from '@/components/finale/EmotionVote';
import { AudienceRemix, type AudienceRemixHandle } from '@/components/finale/AudienceRemix';
import { FloatingOrb } from '@/components/finale/FloatingOrb';
import { useFloatingOrbs } from '@/hooks/useFloatingOrbs';
import { useAudienceRemix } from '@/hooks/useAudienceRemix';
import { MedistationLobby } from '@/components/MedistationLobby';
import type { AudienceAttemptView, AudienceVoteView, AudienceRemixView, AuditionProgress as AuditionProgressData } from '@/conductor/types';
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

  // Floating orbs — persist across vote and remix phases
  const floatingOrbs = useFloatingOrbs();
  const remixRef = useRef<AudienceRemixHandle>(null);
  const reconciled = useRef(false);

  // Drag state for floating orbs during remix
  const [dragOrbId, setDragOrbId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  // When an orb lands after the EmotionVote fly animation
  const handleOrbLanded = useCallback((chapterId: string, position: { x: number; y: number }) => {
    floatingOrbs.addOrb(chapterId, position.x, position.y);
  }, [floatingOrbs]);

  // Reconcile floating orbs with server state when remix starts
  const phase = state?.phase;
  const remixView = phase === 'finale_remix' && state?.myFinale
    ? state.myFinale as unknown as AudienceRemixView
    : null;

  useEffect(() => {
    if (remixView && !reconciled.current) {
      reconciled.current = true;
      floatingOrbs.reconcileWithServer(remixView.orbs ?? []);
    }
  }, [remixView, floatingOrbs]);

  // Tally + socket events for remix phase
  const handleOrbDecayed = useCallback((orbIndex: number) => {
    const orb = floatingOrbs.orbs[orbIndex];
    if (orb) floatingOrbs.recallOrb(orb.id);
  }, [floatingOrbs]);

  const handleScatter = useCallback(() => {
    for (const orb of floatingOrbs.orbs) {
      if (orb.placedOnNode) floatingOrbs.recallOrb(orb.id);
    }
  }, [floatingOrbs]);

  const remix = useAudienceRemix(
    socket,
    remixView?.nodeTallies ?? [],
    handleOrbDecayed,
    handleScatter,
  );

  // Orb touch drag handlers — use document-level listeners for move/end
  // so they work regardless of pointer-events on intermediate layers
  const dragOrbIdRef = useRef<string | null>(null);

  const handleOrbTouchStart = useCallback((orbId: string, e: React.TouchEvent) => {
    if (phase !== 'finale_remix') return;
    e.preventDefault();
    setDragOrbId(orbId);
    dragOrbIdRef.current = orbId;
    floatingOrbs.setDragging(orbId);
    const touch = e.touches[0];
    setDragPos({ x: touch.clientX, y: touch.clientY });
    const node = remixRef.current?.findNode(touch.clientX, touch.clientY) ?? null;
    setHoverNode(node);
  }, [phase, floatingOrbs]);

  useEffect(() => {
    if (!dragOrbId) return;

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      setDragPos({ x: touch.clientX, y: touch.clientY });
      const node = remixRef.current?.findNode(touch.clientX, touch.clientY) ?? null;
      setHoverNode(node);
    };

    const onEnd = () => {
      const currentDragId = dragOrbIdRef.current;
      if (!currentDragId) return;
      const orb = floatingOrbs.orbs.find(o => o.id === currentDragId);

      // Use the last hover node from state for drop target
      setHoverNode(currentHover => {
        if (currentHover && orb) {
          floatingOrbs.placeOrb(currentDragId, currentHover);
          remix.emitPlaceOrb(orb.index, currentHover);
          const nodePos = remixRef.current?.getNodeViewportPosition(currentHover);
          if (nodePos) floatingOrbs.setPlacedPosition(currentDragId, nodePos.x, nodePos.y);
        } else if (orb?.placedOnNode) {
          floatingOrbs.recallOrb(currentDragId);
          remix.emitRecallOrb(orb.index);
        }
        return null;
      });

      setDragOrbId(null);
      setDragPos(null);
      dragOrbIdRef.current = null;
      floatingOrbs.setDragging(null);
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [dragOrbId, floatingOrbs, remix]);

  const handleVote = (choice: 'A' | 'B') => {
    emit('vote', { choice });
  };

  // Lock scroll during finale phases to prevent pull-to-refresh and bouncing
  useEffect(() => {
    const isFinale = phase === 'finale_vote' || phase === 'finale_remix';
    if (!isFinale) return;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';

    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    };
  }, [phase]);

  // Loading / not yet connected
  if (isLoading || !state) {
    return (
      <Screen>
        <DisconnectOverlay connectionState={connectionState} hasGivenUp={hasGivenUp} onReconnect={reconnect} />
        <PulsingDot />
      </Screen>
    );
  }

  const { paused } = state;
  const showOrbs = floatingOrbs.orbs.length > 0 && (phase === 'finale_vote' || phase === 'finale_remix');

  return (
    <Screen>
      {/* Pause overlay */}
      {paused && <PauseOverlay />}

      {/* Disconnect overlay */}
      <DisconnectOverlay connectionState={connectionState} hasGivenUp={hasGivenUp} onReconnect={reconnect} />

      {/* Persistent floating orb layer — above phase content */}
      {showOrbs && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            pointerEvents: 'none',
          }}
        >
          {floatingOrbs.orbs.map(orb => {
            const isDragging = dragOrbId === orb.id;
            const isPlaced = orb.placedOnNode !== null;
            const canDrag = phase === 'finale_remix';
            const bloom = orb.age >= 1 ? 1 : 1 - Math.pow(1 - orb.age, 3);

            // Use drag position when being dragged, otherwise orb's physics position
            const displayX = isDragging && dragPos ? dragPos.x : orb.x;
            const displayY = isDragging && dragPos ? dragPos.y : orb.y;

            return (
              <FloatingOrb
                key={orb.id}
                x={displayX}
                y={displayY}
                radius={orb.radius}
                color={orb.color}
                opacity={bloom}
                isDragging={isDragging}
                isPlaced={isPlaced}
                onTouchStart={canDrag ? (e) => handleOrbTouchStart(orb.id, e) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Phase routing */}
      {phase === 'lobby' && (
        <MedistationLobby onboardingConfig={state.config.lobby.onboarding} />
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

      {phase === 'finale_vote' && state.myFinale && (state.myFinale as unknown as AudienceVoteView).finalePhase === 'vote' && (() => {
        const voteView = state.myFinale as unknown as AudienceVoteView;
        return (
          <EmotionVote
            socket={socket}
            questions={voteView.questions ?? []}
            initialAnsweredCount={voteView.answeredCount}
            poolCapReached={voteView.poolCapReached}
            chapters={voteView.chapters}
            npcIntro={voteView.npcIntro ?? []}
            npcOutro={voteView.npcOutro ?? null}
            alarmColor={voteView.alarmColor ?? '#ff0000'}
            shuffleQuestions={voteView.shuffleQuestions ?? false}
            userId={state.userId}
            emit={emit}
            onOrbLanded={handleOrbLanded}
          />
        );
      })()}

      {phase === 'finale_remix' && remixView && (
        <AudienceRemix
          ref={remixRef}
          tallies={remix.tallies}
          chapters={remixView.chapters ?? state.config.chapters}
          granularTypes={remixView.granularTypes ?? state.config.granularTypes}
          fallbackMode={remixView.fallbackMode ?? false}
          hoverNode={hoverNode}
        />
      )}

      {phase === 'ended' && (
        <p style={{ fontSize: '1.5rem', color: 'rgba(255,255,255,0.7)' }}>Thank you</p>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Screen({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <style>{`
        .audience-screen {
          min-height: 100vh;
          min-height: 100dvh;
          width: 100%;
          background-color: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          font-family: system-ui, -apple-system, sans-serif;
        }
      `}</style>
      <main className="audience-screen">
        {children}
      </main>
    </>
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
            auditionProgress={auditionProgress}
          />
        )}

        {/* Audition depleting bars (only during auditioning, before vote) */}
        {isAuditioning && auditionProgress && (
          <div style={{ width: '100%', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.4s ease' }}>
            <AuditionBars
              progress={auditionProgress}
              chapter={chapter}
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



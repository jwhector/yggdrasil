'use client';

import { useMemo, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { MixingMirror } from '@/components/finale/MixingMirror';
import { getChapterIdentity, getLayerIdentity } from '@/lib/identity';
import { ThresholdDisplay } from '@/components/song-building/ThresholdDisplay';
import { RevealSequence } from '@/components/song-building/RevealSequence';
import type { LayerResult, LayerType } from '@/conductor/types';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);

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
      const attemptConfig = state.config.attempts[state.currentAttemptIndex];
      const allThresholds: number[] = attemptConfig?.thresholds ?? [];
      const threshold = allThresholds[currentAttempt.currentLayerIndex] ?? 0.5;

      // Derive threshold check data from layerResults during revealing phase
      const revealLayerResult = currentAttempt.currentLayerPhase === 'revealing'
        ? currentAttempt.layerResults.find(r => r.layerIndex === currentAttempt.currentLayerIndex) ?? null
        : null;
      const thresholdCheck = revealLayerResult && revealLayerResult.passed !== null
        ? { winningProportion: revealLayerResult.winningProportion!, threshold: revealLayerResult.thresholdRequired!, passed: revealLayerResult.passed }
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

          {/* Threshold display — visible before and during the vote */}
          {currentAttempt.currentLayerPhase !== 'locked_in' && currentAttempt.currentLayerPhase !== 'collapsed' && (
            <ThresholdDisplay
              threshold={threshold}
              layerIndex={currentAttempt.currentLayerIndex}
              allThresholds={allThresholds}
              layerColor={layer.color}
            />
          )}

          {/* Reveal sequence (during revealing phase) */}
          {currentAttempt.currentLayerPhase === 'revealing'
            && currentAttempt.currentVoteResult
            && thresholdCheck ? (
            <RevealSequence
              voteResult={{
                winner: currentAttempt.currentVoteResult.winner,
                consensus: currentAttempt.currentVoteResult.consensus,
                votesA: currentAttempt.currentVoteResult.votesA,
                votesB: currentAttempt.currentVoteResult.votesB,
              }}
              thresholdCheck={thresholdCheck}
              layerConfig={currentLayerConfig}
              variant="projector"
            />
          ) : (
            /* Current layer card (during auditioning / locked_in / collapsed) */
            <ProjectorLayerCard
              layerSymbol={layer.symbol}
              layerLabel={layer.label}
              layerColor={layer.color}
              layerPhase={currentAttempt.currentLayerPhase}
              labelA={currentLayerConfig.labelA}
              labelB={currentLayerConfig.labelB}
              winner={currentAttempt.layerResults[currentAttempt.currentLayerIndex]?.chosenOption ?? null}
              currentAuditionOption={currentAttempt.currentAuditionOption}
            />
          )}

          {/* Stack history */}
          <ProjectorStackHistory results={currentAttempt.layerResults} />

          {/* Collapse overlay — fade to black (collapse is release, not alarm) */}
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

    case 'finale_assembly':
    case 'finale_deliberation':
      // TODO: V3 migration — implement projector views for assembly, deliberation
      return <ProjectorDark />;

    case 'finale_ceremony': {
      const cfs = state.finaleState;
      if (!cfs) return <ProjectorDark />;

      const currentCeremonyLayerType = cfs.currentCeremonyLayer as LayerType | null;
      const currentLayerIdentity = currentCeremonyLayerType
        ? getLayerIdentity(currentCeremonyLayerType)
        : null;

      return (
        <main style={projectorMainStyle}>
          {/* NPC message */}
          {cfs.npcMessage && (
            <div style={{
              textAlign: 'center',
              fontSize: '1.1rem',
              color: 'rgba(255,255,255,0.6)',
              fontStyle: 'italic',
              padding: '24px 40px 0',
              maxWidth: '600px',
              margin: '0 auto',
            }}>
              {cfs.npcMessage}
            </div>
          )}

          {/* Current layer identity — large central display */}
          {currentLayerIdentity && currentCeremonyLayerType && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: '16px',
              padding: '40px',
            }}>
              <div style={{ fontSize: '6rem', color: currentLayerIdentity.color }}>
                {currentLayerIdentity.symbol}
              </div>
              <div style={{
                fontSize: '1.2rem',
                color: currentLayerIdentity.color,
                letterSpacing: '0.15em',
                fontWeight: 600,
              }}>
                {currentLayerIdentity.label.toUpperCase()}
              </div>
              {cfs.currentAmbassador && (
                <div style={{
                  fontSize: '0.7rem',
                  color: 'rgba(255,255,255,0.3)',
                  letterSpacing: '0.12em',
                  marginTop: '8px',
                }}>
                  AMBASSADOR CALLED
                </div>
              )}
            </div>
          )}

          {/* No current layer — ceremony complete or between layers */}
          {!currentLayerIdentity && cfs.ceremonyComplete && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: '24px',
              padding: '40px',
            }}>
              <div style={{
                fontSize: '1rem',
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.2em',
              }}>
                THE SONG IS WHOLE
              </div>
            </div>
          )}

          {/* Layer stack — building from bottom */}
          <div style={{
            display: 'flex',
            gap: '8px',
            padding: '0 40px 40px',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {cfs.ceremonyLayerOrder.map((lt: LayerType) => {
              const identity = getLayerIdentity(lt);
              const isLocked = cfs.ceremonyLockedLayers.some(
                (l: { layerType: LayerType; fragmentId: string }) => l.layerType === lt
              );
              const isForfeited = cfs.ceremonyForfeitedLayers.includes(lt);
              const isCurrent = lt === currentCeremonyLayerType;

              return (
                <div
                  key={lt}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.1rem',
                    backgroundColor: isLocked
                      ? `${identity.color}30`
                      : isForfeited
                      ? 'rgba(255,255,255,0.02)'
                      : isCurrent
                      ? `${identity.color}15`
                      : 'rgba(255,255,255,0.03)',
                    border: isLocked
                      ? `2px solid ${identity.color}`
                      : isCurrent
                      ? `2px solid ${identity.color}80`
                      : isForfeited
                      ? '1px solid rgba(255,255,255,0.05)'
                      : '1px solid rgba(255,255,255,0.06)',
                    color: isForfeited ? 'rgba(255,255,255,0.1)' : identity.color,
                    opacity: isForfeited ? 0.3 : isLocked || isCurrent ? 1 : 0.35,
                    transition: 'all 0.5s ease',
                  }}
                >
                  {identity.symbol}
                </div>
              );
            })}
          </div>
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
  currentAuditionOption,
}: {
  layerSymbol: string;
  layerLabel: string;
  layerColor: string;
  layerPhase: string;
  labelA: string;
  labelB: string;
  winner: 'A' | 'B' | null;
  currentAuditionOption?: 'A' | 'B' | null;
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
          className={currentAuditionOption === 'A' ? 'audition-glow' : undefined}
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
            ...(currentAuditionOption === 'A' ? { '--glow-color': layerColor + '99' } as React.CSSProperties : {}),
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
          className={currentAuditionOption === 'B' ? 'audition-glow' : undefined}
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
            ...(currentAuditionOption === 'B' ? { '--glow-color': layerColor + '99' } as React.CSSProperties : {}),
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
        backgroundColor: '#000',
        pointerEvents: 'none',
        animation: 'collapse-fade-in 0.6s ease-out forwards',
      }}
    >
      <style>{`
        @keyframes collapse-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

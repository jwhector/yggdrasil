'use client';

import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { useQuilt } from '@/hooks/useQuilt';
import { useProjectorThoughts } from '@/hooks/useProjectorThoughts';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { QuiltGrid } from '@/components/finale/QuiltGrid';
import { ProjectorFinale } from '@/components/finale/ProjectorFinale';
import { ProjectorCanvas } from '@/components/projector/ProjectorCanvas';
import { OpenerSlides } from '@/components/projector/OpenerSlides';
import type { ProjectorFinaleV34View } from '@/conductor/types';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);
  const auditionProgress = useAuditionProgress(socket, state?.phase, currentAttempt?.currentLayerPhase);
  const quilt = useQuilt(socket, state?.finaleState ?? null);
  useProjectorThoughts(socket);

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

    case 'opener': {
      const slides = state.config.openerSlides;
      if (slides?.length && state.openerSlideState !== undefined) {
        return <OpenerSlides slides={slides} position={state.openerSlideState} />;
      }
      return <ProjectorDark />;
    }

    case 'attempt_story':
    case 'attempt_build':
    case 'attempt_resolve':
      return <ProjectorCanvas state={state} currentAttempt={currentAttempt} auditionProgress={auditionProgress} />;

    case 'finale_elegy': {
      return <ElegyAlarm />;
    }

    case 'finale_assignment': {
      if (!quilt.grid) return <ProjectorDark />;
      const granularTypes = state.config.granularTypes ?? [];
      return (
        <main style={projectorMainStyle}>
          <div style={{ textAlign: 'center', padding: '24px 0 8px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {quilt.assignmentTimerRemaining !== null
              ? `Claim a cell — ${Math.ceil(quilt.assignmentTimerRemaining / 1000)}s`
              : 'Claim a cell'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
            <QuiltGrid
              grid={quilt.grid}
              variant="projector"
              granularTypes={granularTypes}
            />
          </div>
        </main>
      );
    }

    case 'finale_preview': {
      if (!quilt.grid) return <ProjectorDark />;
      const granularTypesPreview = state.config.granularTypes ?? [];
      return (
        <main style={projectorMainStyle}>
          <div style={{ textAlign: 'center', padding: '24px 0 8px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Choose your song
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
            <QuiltGrid
              grid={quilt.grid}
              variant="projector"
              granularTypes={granularTypesPreview}
            />
          </div>
        </main>
      );
    }

    case 'finale_playback': {
      if (!quilt.grid) return <ProjectorDark />;
      const granularTypesPlayback = state.config.granularTypes ?? [];
      return (
        <main style={projectorMainStyle}>
          <div style={{ display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
            <QuiltGrid
              grid={quilt.grid}
              variant="projector"
              granularTypes={granularTypesPlayback}
              lockedCells={quilt.lockedCells}
              mutedCells={quilt.mutedCells}
              showPlayhead
            />
          </div>
        </main>
      );
    }

    case 'finale_vote':
    case 'finale_remix': {
      const finaleV34 = state.finaleState as ProjectorFinaleV34View | null;
      if (!finaleV34) return <ProjectorDark />;
      return (
        <ProjectorFinale
          socket={socket}
          phase={phase}
          finaleView={finaleV34}
          chapters={state.config.chapters ?? []}
          granularTypes={state.config.granularTypes ?? []}
        />
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

function ElegyAlarm() {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#000',
        animation: 'elegy-alarm 1.2s ease-in-out infinite alternate',
      }}
    >
      <style>{`
        @keyframes elegy-alarm {
          0% { background-color: rgba(220, 38, 38, 0.04); }
          100% { background-color: rgba(220, 38, 38, 0.25); }
        }
      `}</style>
    </div>
  );
}


'use client';

import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { useMixState } from '@/hooks/useMixState';
import { useProjectorThoughts } from '@/hooks/useProjectorThoughts';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { ElegyGrid } from '@/components/finale/ElegyGrid';
import { ProjectorCanvas } from '@/components/projector/ProjectorCanvas';
import { OpenerSlides } from '@/components/projector/OpenerSlides';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);
  const auditionProgress = useAuditionProgress(socket, state?.phase, currentAttempt?.currentLayerPhase);
  const mixStateData = useMixState(socket, state?.finaleState ?? null);
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
      const fs = state.finaleState;
      if (!fs) return <ProjectorDark />;
      const availableIds = new Set(fs.availableFragments.map(f => f.id));
      const losers = fs.allFragments.filter(f => !availableIds.has(f.id));
      return (
        <main style={projectorMainStyle}>
          <ElegyGrid
            availableFragments={fs.availableFragments}
            lockedFragments={losers}
            variant="projector"
          />
        </main>
      );
    }

    case 'finale_assignment':
      // TODO: V3.3 Phase 4 — QuiltGrid projector cell claim display
      return <ProjectorDark />;

    case 'finale_preview':
      // TODO: V3.3 Phase 4 — QuiltGrid projector preview display
      return <ProjectorDark />;

    case 'finale_playback':
      return (
        <ProjectorCanvas
          state={state}
          currentAttempt={currentAttempt}
          auditionProgress={auditionProgress}
          mixStateData={mixStateData}
        />
      );

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


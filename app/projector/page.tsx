'use client';

import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { useAuditionProgress } from '@/hooks/useAuditionProgress';
import { useProjectorThoughts } from '@/hooks/useProjectorThoughts';
import { LobbyDisplay } from '@/components/LobbyDisplay';
import { ProjectorFinale } from '@/components/finale/ProjectorFinale';
import { ProjectorCanvas } from '@/components/projector/ProjectorCanvas';
import { OpenerSlides } from '@/components/projector/OpenerSlides';
import { PhoneCue } from '@/components/projector/PhoneCue';
import { derivePhoneCue } from '@/hooks/useShowStepper';
import type { ProjectorFinaleView } from '@/conductor/types';

const SHOW_ID = 'default-show';

export default function ProjectorPage() {
  const { socket, userId } = useSocket({ showId: SHOW_ID, mode: 'projector' });
  const { state, isLoading, currentAttempt } = useShowState(socket, 'projector', userId);
  const auditionProgress = useAuditionProgress(socket, state?.phase, currentAttempt?.currentLayerPhase);
  useProjectorThoughts(socket);

  const phoneCue = state ? derivePhoneCue(state) : null;

  if (isLoading || !state) {
    return <ProjectorDark />;
  }

  const { phase, userCount } = state;

  let content: React.ReactNode;

  switch (phase) {
    case 'lobby':
      content = (
        <LobbyDisplay
          content={state.config.lobby.waitingMessage}
          userCount={userCount}
        />
      );
      break;

    case 'opener': {
      const slides = state.config.openerSlides;
      if (slides?.length && state.openerSlideState !== undefined) {
        content = <OpenerSlides
          slides={slides}
          position={state.openerSlideState}
          onMediaReady={() => socket?.emit('command', { type: 'SLIDE_MEDIA_READY' })}
        />;
      } else {
        content = <ProjectorDark />;
      }
      break;
    }

    case 'attempt_story':
    case 'attempt_build':
    case 'attempt_resolve':
      content = <ProjectorCanvas state={state} currentAttempt={currentAttempt} auditionProgress={auditionProgress} />;
      break;

    case 'finale_vote':
    case 'finale_remix': {
      const finaleV34 = state.finaleState as ProjectorFinaleView | null;
      if (!finaleV34) {
        content = <ProjectorDark />;
      } else {
        content = (
          <ProjectorFinale
            socket={socket}
            phase={phase}
            finaleView={finaleV34}
            chapters={state.config.chapters ?? []}
            granularTypes={state.config.granularTypes ?? []}
          />
        );
      }
      break;
    }

    default:
      content = <ProjectorDark />;
  }

  return (
    <>
      {content}
      <PhoneCue cue={phoneCue} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProjectorDark() {
  return <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: '#000' }} />;
}


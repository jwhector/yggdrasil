/**
 * useShowStepper
 *
 * Linear show progression system. Derives the "next step" from the current
 * ShowState so the performer can advance the show with a single button/key.
 *
 * Exports pure derivation functions (for testing) and a React hook.
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { ShowState, ConductorCommand, ShowPhase, AttemptState } from '@/conductor/types';

// ============================================================================
// Types
// ============================================================================

export type PhoneCue = 'ready' | 'up' | 'down' | null;

export interface StepperStep {
  command: ConductorCommand | null;
  label: string;
  blocked: boolean;
  blockReason?: string;
}

export interface ShowStepperReturn {
  step: StepperStep;
  phoneCue: PhoneCue;
  advance: () => void;
}

// ============================================================================
// Pure derivation: next step
// ============================================================================

/**
 * Given the current show state, derive what the next stepper action should be.
 * Pure function — no side effects, no I/O.
 *
 * @param hasOpenerStarted - local tracking flag: true once openerSlideState
 *   has been non-null during the current opener phase (disambiguates
 *   "slides not started" from "slides exhausted" — both are null).
 */
export function deriveNextStep(
  state: ShowState,
  hasOpenerStarted: boolean,
): StepperStep {
  const { phase, currentAttemptIndex, attempts, openerSlideState } = state;
  const attempt: AttemptState | undefined = attempts[currentAttemptIndex];

  switch (phase) {
    // ------------------------------------------------------------------
    case 'lobby':
      return step('ADVANCE_PHASE', 'Start Show');

    // ------------------------------------------------------------------
    case 'opener':
      if (openerSlideState === null && hasOpenerStarted) {
        return step('ADVANCE_PHASE', 'Begin Story');
      }
      return step('ADVANCE_SLIDE', 'Next Slide');

    // ------------------------------------------------------------------
    case 'attempt_story':
      return step('ADVANCE_PHASE', 'Begin Song Building');

    // ------------------------------------------------------------------
    case 'attempt_build': {
      if (!attempt) return blocked('No active attempt');

      // Attempt already resolved but phase not yet advanced (Song 3 collapse edge case)
      if (attempt.status === 'collapsed' && attempt.currentVoteResult === null) {
        return step('ADVANCE_PHASE', currentAttemptIndex === 2 ? 'Continue to Finale' : 'Continue');
      }

      switch (attempt.currentLayerPhase) {
        case 'locked':
          return step('START_AUDITION', `Start Audition (Layer ${attempt.currentLayerIndex + 1})`);

        case 'auditioning':
          return blocked('Voting in progress...');

        case 'revealing':
          if (!attempt.revealStakesShown) {
            return step('REVEAL_STAKES', 'Show Stakes');
          }
          return step('ADVANCE_FROM_REVEAL', 'Reveal Votes');

        case 'locked_in':
          return blocked('Verdict playing...');

        case 'collapsed':
          // currentVoteResult still set → verdict timer hasn't fired yet
          return blocked('Collapse animation...');

        default:
          return blocked('Unknown layer phase');
      }
    }

    // ------------------------------------------------------------------
    case 'attempt_resolve':
      if (!attempt) return blocked('No active attempt');
      if (!attempt.songRejected) {
        return step('TRIGGER_REJECTION', 'Reject Song');
      }
      return step('ADVANCE_PHASE', currentAttemptIndex < 2 ? 'Continue' : 'Begin Finale');

    // ------------------------------------------------------------------
    case 'finale_vote':
      return step('START_REMIX', 'Start Remix');

    case 'finale_remix':
      return step('END_SHOW', 'End Show');

    case 'ended':
      return blocked('Show ended');

    default:
      return blocked(`Unknown phase: ${phase}`);
  }
}

// ============================================================================
// Pure derivation: phone cue
// ============================================================================

/** Minimal state shape accepted by derivePhoneCue (works with both ShowState and ProjectorClientState). */
interface PhoneCueState {
  phase: ShowPhase;
  attempts: Pick<AttemptState, 'currentLayerPhase' | 'status'>[];
  currentAttemptIndex: number;
}

/**
 * Derive the current phone cue from show state.
 * Pure function — works with both controller (ShowState) and projector (ProjectorClientState).
 */
export function derivePhoneCue(state: PhoneCueState): PhoneCue {
  if (state.phase === 'attempt_build') {
    const attempt = state.attempts[state.currentAttemptIndex];
    if (!attempt) return null;

    switch (attempt.currentLayerPhase) {
      case 'locked':
        return attempt.status === 'in_progress' ? 'ready' : null;
      case 'auditioning':
        return 'up';
      case 'revealing':
        return 'up';
      case 'locked_in':
      case 'collapsed':
        return 'down';
      default:
        return null;
    }
  }

  if (state.phase === 'finale_vote') return 'up';

  return null;
}

// ============================================================================
// React hook
// ============================================================================

const IDLE_STEP: StepperStep = { command: null, label: 'Loading...', blocked: true, blockReason: 'Loading' };

export function useShowStepper(
  fullState: ShowState | null,
  sendCommand: (cmd: ConductorCommand) => void,
): ShowStepperReturn {
  const hasOpenerStarted = useRef(false);

  // Reset when entering opener phase
  const phase = fullState?.phase ?? null;
  useEffect(() => {
    if (phase === 'opener') {
      hasOpenerStarted.current = false;
    }
  }, [phase]);

  // Track when slides have been shown
  const slideState = fullState?.openerSlideState;
  useEffect(() => {
    if (slideState !== null && slideState !== undefined) {
      hasOpenerStarted.current = true;
    }
  }, [slideState]);

  const currentStep = fullState
    ? deriveNextStep(fullState, hasOpenerStarted.current)
    : IDLE_STEP;
  const phoneCue = fullState ? derivePhoneCue(fullState) : null;

  const advance = useCallback(() => {
    if (!currentStep.blocked && currentStep.command) {
      sendCommand(currentStep.command);
    }
  }, [currentStep, sendCommand]);

  return { step: currentStep, phoneCue, advance };
}

// ============================================================================
// Helpers
// ============================================================================

function step(type: ConductorCommand['type'], label: string): StepperStep {
  return {
    command: { type } as ConductorCommand,
    label,
    blocked: false,
  };
}

function blocked(reason: string): StepperStep {
  return {
    command: null,
    label: reason,
    blocked: true,
    blockReason: reason,
  };
}

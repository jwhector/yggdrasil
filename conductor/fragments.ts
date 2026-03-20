/**
 * Fragments — Generate Finale Fragments from Attempt Results
 *
 * After each attempt (completed or collapsed), this module produces the fragment
 * list with correct availability for the finale:
 * - locked_in winners → selectable fragments
 * - locked_in losers → visible but locked/grayed ("what could have been")
 * - unreached layers → both options visible but locked/grayed
 *
 * Pure functions, no I/O.
 */

import type {
  AttemptState,
  AttemptConfig,
  AttemptResult,
  LayerResult,
  Fragment,
  AudioReference,
  Chapter,
  LayerType,
} from './types';

/** Describes a fragment's availability in the finale. */
export interface FragmentAvailability {
  fragment: Fragment;
  selectable: boolean;  // true = winner from locked-in layer; false = loser or unreached
}

/**
 * Extract an AttemptResult from a completed or collapsed AttemptState.
 */
export function extractAttemptResult(attempt: AttemptState): AttemptResult {
  return {
    attemptIndex: attempt.index,
    chapter: attempt.chapter,
    layers: attempt.layerResults,
    completed: attempt.status === 'completed',
    collapsedAtLayer: attempt.collapsedAtLayer,
  };
}

/**
 * Generate all fragments and their availability from attempt results.
 *
 * For each attempt that has been played (completed or collapsed):
 * - locked_in layers: winner option → selectable, loser option → not selectable
 * - unreached layers: both A and B → not selectable
 */
export function generateFragments(
  attempts: AttemptState[],
  attemptConfigs: AttemptConfig[],
  audioPreviewPath = '',
): FragmentAvailability[] {
  const fragments: FragmentAvailability[] = [];

  for (const attempt of attempts) {
    if (attempt.status === 'pending') continue;

    const config = attemptConfigs[attempt.index];
    if (!config) continue;

    for (const layerConfig of config.layers) {
      const result = attempt.layerResults.find(r => r.layerIndex === layerConfig.index);

      if (result && (result.status === 'locked_in' || result.status === 'collapsed') && result.chosenOption !== null) {
        // Winner fragment — selectable
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            result.chosenOption,
            attempt.chapter,
            layerConfig.type,
            result.chosenOption === 'A' ? layerConfig.optionA : layerConfig.optionB,
            audioPreviewPath,
            true, // wonVote
          ),
          selectable: true,
        });

        // Loser fragment — visible but locked
        const loser: 'A' | 'B' = result.chosenOption === 'A' ? 'B' : 'A';
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            loser,
            attempt.chapter,
            layerConfig.type,
            loser === 'A' ? layerConfig.optionA : layerConfig.optionB,
            audioPreviewPath,
            false, // wonVote
          ),
          selectable: false,
        });
      } else {
        // Unreached layer — both options visible but locked
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            'A',
            attempt.chapter,
            layerConfig.type,
            layerConfig.optionA,
            audioPreviewPath,
            false, // wonVote
          ),
          selectable: false,
        });

        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            'B',
            attempt.chapter,
            layerConfig.type,
            layerConfig.optionB,
            audioPreviewPath,
            false, // wonVote
          ),
          selectable: false,
        });
      }
    }
  }

  return fragments;
}

/**
 * Build a Fragment object. Display name and safe parameter use placeholders.
 */
function buildFragment(
  attemptIndex: number,
  layerIndex: number,
  option: 'A' | 'B',
  chapter: Chapter,
  layerType: LayerType,
  audioRef: AudioReference,
  audioPreviewPath: string,
  wonVote: boolean,
): Fragment {
  // TODO: See DECISIONS.md O5 — display label generation strategy TBD
  const displayLabel = `${capitalize(chapter)}: ${capitalize(layerType)} ${option}`;

  return {
    id: `${attemptIndex}-${layerIndex}-${option}`,
    attemptIndex,
    layerIndex,
    option,
    chapter,
    layerType,
    displayLabel,
    wonVote,
    audioRef,
    previewAudioPath: `${audioPreviewPath}/preview-${attemptIndex}-${layerIndex}-${option}.mp3`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

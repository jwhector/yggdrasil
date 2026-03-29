/**
 * Fragments — Generate Finale Fragments from Attempt Results
 *
 * After each attempt (completed or collapsed), this module produces the fragment
 * list with correct availability for the finale:
 * - locked_in/collapsed winners → selectable fragments
 * - locked_in/collapsed losers → selectable when bothOptionsSurvive, else locked
 * - unreached layers → both options visible but locked/grayed
 *
 * Pure functions, no I/O.
 */

import type {
  AttemptState,
  V32AttemptConfig,
  V32LayerConfig,
  AttemptResult,
  LayerResult,
  Fragment,
  GranularFragment,
  AudioReference,
  Chapter,
  LayerType,
  GranularTrackRef,
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
  attemptConfigs: V32AttemptConfig[],
  audioPreviewPath = '',
  bothOptionsSurvive = false,
): FragmentAvailability[] {
  const fragments: FragmentAvailability[] = [];

  for (const attempt of attempts) {
    if (attempt.status === 'pending') continue;

    const config = attemptConfigs[attempt.index];
    if (!config) continue;

    for (const layerConfig of config.layers) {
      const result = attempt.layerResults.find(r => r.layerIndex === layerConfig.index);
      // V3.2: derive LayerType from first track's granularType; AudioReference from first track index
      // TODO: V3.2 finale rewrite will replace Fragment entirely — this is a bridge
      const layerTypeA = (layerConfig.optionA.tracks[0]?.granularType ?? 'bass') as LayerType;
      const layerTypeB = (layerConfig.optionB.tracks[0]?.granularType ?? 'bass') as LayerType;
      const audioRefA: AudioReference = { trackIndex: layerConfig.optionA.tracks[0]?.trackIndices[0] ?? 0 };
      const audioRefB: AudioReference = { trackIndex: layerConfig.optionB.tracks[0]?.trackIndices[0] ?? 0 };

      if (result && (result.status === 'locked_in' || result.status === 'collapsed') && result.chosenOption !== null) {
        // Winner fragment — selectable
        const winnerLayerType = result.chosenOption === 'A' ? layerTypeA : layerTypeB;
        const winnerAudioRef = result.chosenOption === 'A' ? audioRefA : audioRefB;
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            result.chosenOption,
            attempt.chapter,
            winnerLayerType,
            winnerAudioRef,
            audioPreviewPath,
            true, // wonVote
          ),
          selectable: true,
        });

        // Loser fragment — selectable when bothOptionsSurvive, else locked
        const loser: 'A' | 'B' = result.chosenOption === 'A' ? 'B' : 'A';
        const loserLayerType = loser === 'A' ? layerTypeA : layerTypeB;
        const loserAudioRef = loser === 'A' ? audioRefA : audioRefB;
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            loser,
            attempt.chapter,
            loserLayerType,
            loserAudioRef,
            audioPreviewPath,
            false, // wonVote
          ),
          selectable: bothOptionsSurvive,
        });
      } else {
        // Unreached layer — both options visible but locked
        fragments.push({
          fragment: buildFragment(
            attempt.index,
            layerConfig.index,
            'A',
            attempt.chapter,
            layerTypeA,
            audioRefA,
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
            layerTypeB,
            audioRefB,
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

// ============================================================================
// V3.2 Granular Fragment Generation
// ============================================================================

/**
 * Generate GranularFragments by decomposing layer group results into per-track fragments.
 *
 * Each voted layer group (locked_in or collapsed with a chosenOption) produces one
 * GranularFragment per track in the winning option's TrackBundle. If bothOptionsSurvive
 * is true, losing option tracks also produce fragments. Individual tracks with
 * alwaysAvailable=true produce fragments regardless of vote outcome or layer reach.
 *
 * Unreached layers produce no fragments unless individual tracks have alwaysAvailable=true.
 */
export function generateGranularFragments(
  attempts: AttemptState[],
  attemptConfigs: V32AttemptConfig[],
  audioPreviewPath = '',
  bothOptionsSurvive = false,
): GranularFragment[] {
  const fragments: GranularFragment[] = [];

  for (const attempt of attempts) {
    if (attempt.status === 'pending') continue;

    const config = attemptConfigs[attempt.index];
    if (!config) continue;

    for (const layerConfig of config.layers) {
      const result = attempt.layerResults.find(r => r.layerIndex === layerConfig.index);
      const isVoted = result
        && (result.status === 'locked_in' || result.status === 'collapsed')
        && result.chosenOption !== null;

      if (isVoted) {
        const winOption = result!.chosenOption!;
        const loseOption: 'A' | 'B' = winOption === 'A' ? 'B' : 'A';
        const winBundle = winOption === 'A' ? layerConfig.optionA : layerConfig.optionB;
        const loseBundle = loseOption === 'A' ? layerConfig.optionA : layerConfig.optionB;

        // Winner tracks — always included
        for (const track of winBundle.tracks) {
          fragments.push(buildGranularFragment(
            attempt.index, layerConfig.group, track, winOption, attempt.chapter, audioPreviewPath, true,
          ));
        }

        // Loser tracks — included if bothOptionsSurvive or track is alwaysAvailable
        for (const track of loseBundle.tracks) {
          if (bothOptionsSurvive || track.alwaysAvailable) {
            fragments.push(buildGranularFragment(
              attempt.index, layerConfig.group, track, loseOption, attempt.chapter, audioPreviewPath, false,
            ));
          }
        }
      } else {
        // Unreached — only alwaysAvailable tracks
        for (const track of layerConfig.optionA.tracks) {
          if (track.alwaysAvailable) {
            fragments.push(buildGranularFragment(
              attempt.index, layerConfig.group, track, 'A', attempt.chapter, audioPreviewPath, false,
            ));
          }
        }
        for (const track of layerConfig.optionB.tracks) {
          if (track.alwaysAvailable) {
            fragments.push(buildGranularFragment(
              attempt.index, layerConfig.group, track, 'B', attempt.chapter, audioPreviewPath, false,
            ));
          }
        }
      }
    }

    // Generate seed fragment from live seed tracks
    const liveSeed = config.liveSeed;
    if (liveSeed?.trackIndices?.length) {
      fragments.push({
        id: `${attempt.index}-seed-seed-A`,
        songIndex: attempt.index,
        layerGroupId: 'seed',
        granularType: 'seed',
        option: 'A',
        chapter: attempt.chapter,
        trackIndices: liveSeed.trackIndices,
        wonVote: true,
        previewAudioPath: `${audioPreviewPath}/preview-${attempt.index}-seed-A.mp3`,
      });
    }
  }

  return fragments;
}

function buildGranularFragment(
  songIndex: number,
  layerGroupId: string,
  track: GranularTrackRef,
  option: 'A' | 'B',
  chapter: Chapter,
  audioPreviewPath: string,
  wonVote: boolean,
): GranularFragment {
  return {
    id: `${songIndex}-${layerGroupId}-${track.granularType}-${option}`,
    songIndex,
    layerGroupId,
    granularType: track.granularType,
    option,
    chapter,
    trackIndices: track.trackIndices,
    wonVote,
    previewAudioPath: `${audioPreviewPath}/preview-${songIndex}-${track.granularType}-${option}.mp3`,
  };
}

/**
 * useProjectorState — Visual state management for the projector canvas.
 *
 * Derives ProjectorVisualState from conductor state + audition progress,
 * mapping to the rendering model consumed by canvas renderers.
 */

'use client';

import { useMemo } from 'react';
import { getChapterIdentity, getLayerGroupIdentity } from '@/lib/identity';
import { hexToRgb, EMPTY_COLOR, FINALE_CHAPTER_COLORS, LAYER_GROUP_NODES } from './renderers/shared';
import type { RGB } from './renderers/shared';
import type { ProjectorClientState, AuditionProgress, AttemptState, VoteResult } from '@/conductor/types';

// ============================================================================
// Types
// ============================================================================

export interface NodeVisualState {
  state: 'empty' | 'active' | 'filled' | 'collapsed' | 'finale';
  color: RGB;
}

export interface ProjectorVisualState {
  mode: 'dark' | 'skeleton' | 'stakes' | 'verdict' | 'finale';
  canvasWidth: number;
  canvasHeight: number;

  // Skeleton
  nodes: Record<string, NodeVisualState>;

  // Audition
  currentAuditionOption: 'A' | 'B' | null;
  activeGroup: string | null;
  currentAttemptIndex: number;
  currentLayerIndex: number;
  totalLayers: number;

  // Labels
  labelA: string;
  labelB: string;
  layerGroupLabel: string;
  chapterColor: RGB;

  // Timing
  loopPosition: number;

  // Reveal state
  voteResult: VoteResult | null;
  thresholdCheck: { threshold: number; winningProportion: number; passed: boolean } | null;
}

/** Mix state data resolved from socket events for the finale. */
export interface MixStateInput {
  nodeChapters: Record<string, string>;  // granularType → chapter name
  loopPosition: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useProjectorState(
  state: ProjectorClientState | null,
  currentAttempt: AttemptState | null,
  auditionProgress: AuditionProgress | null,
  canvasWidth: number,
  canvasHeight: number,
  mixState?: MixStateInput | null,
): ProjectorVisualState {
  return useMemo(() => {
    const base: ProjectorVisualState = {
      mode: 'dark',
      canvasWidth,
      canvasHeight,
      nodes: {},
      currentAuditionOption: null,
      activeGroup: null,
      currentAttemptIndex: 0,
      currentLayerIndex: 0,
      totalLayers: 3,
      labelA: '',
      labelB: '',
      layerGroupLabel: '',
      chapterColor: EMPTY_COLOR,
      loopPosition: 0,
      voteResult: null,
      thresholdCheck: null,
    };

    if (!state) return base;

    // ---- Finale live mix ----
    if (state.phase === 'finale_live_mix' && mixState) {
      const allGranularTypes = ['bass', 'drums', 'pad', 'harmony', 'fx', 'seed'];
      const nodes: Record<string, NodeVisualState> = {};

      for (const typeId of allGranularTypes) {
        const chapter = mixState.nodeChapters[typeId];
        const color = chapter ? (FINALE_CHAPTER_COLORS[chapter] ?? EMPTY_COLOR) : EMPTY_COLOR;
        nodes[typeId] = { state: 'finale', color };
      }

      return {
        ...base,
        mode: 'finale',
        nodes,
        loopPosition: mixState.loopPosition,
      };
    }

    // ---- Song-building (attempt_build) ----
    if (!currentAttempt) return base;
    if (state.phase !== 'attempt_build') return base;

    const chapter = getChapterIdentity(currentAttempt.chapter);
    const chapterColorRgb = hexToRgb(chapter.color);
    const layerPlan = currentAttempt.layerPlan;
    const currentLayerIndex = currentAttempt.currentLayerIndex;
    const currentLayerConfig = layerPlan[currentLayerIndex];
    const layerPhase = currentAttempt.currentLayerPhase;

    // Build the group → layer index mapping from the layer plan
    const groupLayerIndex: Record<string, number> = {};
    for (const layer of layerPlan) {
      groupLayerIndex[layer.group] = layer.index;
    }

    // Determine which group each granular type belongs to
    const typeToGroup: Record<string, string> = {};
    const configGroups = state.config.layerGroups;
    if (configGroups && configGroups.length > 0) {
      for (const group of configGroups) {
        for (const typeId of group.granularTypes) {
          typeToGroup[typeId] = group.id;
        }
      }
    } else {
      for (const [groupId, types] of Object.entries(LAYER_GROUP_NODES)) {
        for (const typeId of types) {
          typeToGroup[typeId] = groupId;
        }
      }
    }

    // Resolve node states
    const nodes: Record<string, NodeVisualState> = {};
    const allGranularTypes = ['bass', 'drums', 'pad', 'harmony', 'fx'];

    for (const typeId of allGranularTypes) {
      const groupId = typeToGroup[typeId];
      const groupLayerIdx = groupLayerIndex[groupId];

      if (groupLayerIdx === undefined) {
        nodes[typeId] = { state: 'empty', color: EMPTY_COLOR };
        continue;
      }

      const layerResult = currentAttempt.layerResults.find(r => r.layerIndex === groupLayerIdx);

      if (groupLayerIdx > currentLayerIndex) {
        nodes[typeId] = { state: 'empty', color: EMPTY_COLOR };
      } else if (groupLayerIdx === currentLayerIndex) {
        if (layerPhase === 'auditioning' || layerPhase === 'revealing') {
          nodes[typeId] = { state: 'active', color: chapterColorRgb };
        } else if (layerPhase === 'locked_in') {
          nodes[typeId] = { state: 'filled', color: chapterColorRgb };
        } else if (layerPhase === 'collapsed') {
          nodes[typeId] = { state: 'collapsed', color: chapterColorRgb };
        } else {
          nodes[typeId] = { state: 'empty', color: EMPTY_COLOR };
        }
      } else {
        if (layerResult?.status === 'locked_in') {
          nodes[typeId] = { state: 'filled', color: chapterColorRgb };
        } else if (layerResult?.status === 'collapsed') {
          nodes[typeId] = { state: 'collapsed', color: chapterColorRgb };
        } else {
          nodes[typeId] = { state: 'empty', color: EMPTY_COLOR };
        }
      }
    }

    const activeGroup = currentLayerConfig?.group ?? null;

    let layerGroupLabel = activeGroup ?? '';
    if (activeGroup && state.config.layerGroups) {
      const identity = getLayerGroupIdentity(
        activeGroup,
        state.config.layerGroups,
        state.config.granularTypes ?? [],
      );
      layerGroupLabel = identity.label;
    }

    // Derive reveal data from layer results
    const layerResult = currentAttempt.layerResults.find(r => r.layerIndex === currentLayerIndex);
    const thresholdCheck = layerResult && layerResult.passed !== null
      ? {
          threshold: layerResult.thresholdRequired!,
          winningProportion: layerResult.winningProportion!,
          passed: layerResult.passed,
        }
      : null;

    // Determine mode
    let mode: ProjectorVisualState['mode'] = 'skeleton';
    if (layerPhase === 'revealing' && currentAttempt.revealStakesShown) {
      mode = 'stakes';
    } else if (layerPhase === 'locked_in' || layerPhase === 'collapsed') {
      mode = 'verdict';
    }

    return {
      mode,
      canvasWidth,
      canvasHeight,
      nodes,
      currentAuditionOption: currentAttempt.currentAuditionOption,
      activeGroup,
      currentAttemptIndex: currentAttempt.index,
      currentLayerIndex,
      totalLayers: layerPlan.length,
      labelA: currentLayerConfig?.labelA ?? '',
      labelB: currentLayerConfig?.labelB ?? '',
      layerGroupLabel,
      chapterColor: chapterColorRgb,
      loopPosition: auditionProgress?.barProgress ?? 0,
      voteResult: currentAttempt.currentVoteResult,
      thresholdCheck,
    };
  }, [state, currentAttempt, auditionProgress, canvasWidth, canvasHeight, mixState]);
}

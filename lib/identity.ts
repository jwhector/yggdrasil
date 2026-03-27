/**
 * Visual Identity System
 *
 * Maps chapters and layer types to colors, symbols, and labels.
 * All values are placeholders — lock before production.
 *
 * TODO: See DECISIONS.md O3 — chapter + layer color/symbol assignments TBD
 */

import type { Chapter, LayerType, LayerGroupId, LayerGroupConfig, GranularType } from '@/conductor/types';

export interface ChapterIdentity {
  color: string;   // CSS color
  label: string;   // Display name
  icon: string;    // Unicode symbol placeholder
}

export interface LayerIdentity {
  color: string;   // CSS color
  symbol: string;  // Unicode symbol
  label: string;   // Short thematic label
}

// TODO: See DECISIONS.md O3
export const CHAPTER_IDENTITY: Record<Chapter, ChapterIdentity> = {
  ambition:  { color: '#e63946', label: 'Ambition',  icon: '\u25B2' }, // ▲
  love:      { color: '#f4a261', label: 'Love',      icon: '\u25CF' }, // ●
  avoidance: { color: '#457b9d', label: 'Avoidance', icon: '\u25C6' }, // ◆
};

// TODO: See DECISIONS.md O3
export const LAYER_IDENTITY: Record<LayerType, LayerIdentity> = {
  melody:  { color: '#e5e5e5', symbol: '\u2726', label: 'The voice' },      // ✦
  drums:   { color: '#f5c542', symbol: '\u25B2', label: 'The heartbeat' },  // ▲
  pad:     { color: '#7b2d8b', symbol: '\u25C6', label: 'The warmth' },     // ◆
  bass:    { color: '#8b1a1a', symbol: '\u25A0', label: 'The ground' },     // ■
  harmony: { color: '#2563eb', symbol: '\u25CF', label: 'The color' },      // ●
  fx:      { color: '#22c55e', symbol: '~',      label: 'The shimmer' },
};

const FALLBACK_LAYER: LayerIdentity = {
  color: '#6b7280',
  symbol: '\u25A1', // □
  label: '',
};

/** Get layer identity with fallback for unknown/custom types. */
export function getLayerIdentity(type: LayerType): LayerIdentity {
  return LAYER_IDENTITY[type] ?? { ...FALLBACK_LAYER, label: type };
}

/** Get chapter identity. All chapters are known. */
export function getChapterIdentity(chapter: Chapter): ChapterIdentity {
  return CHAPTER_IDENTITY[chapter];
}

/** Get symbol, label, and color for a V3.2 layer group, derived from its first granular type. */
export function getLayerGroupIdentity(
  groupId: LayerGroupId,
  layerGroups: LayerGroupConfig[],
  granularTypes: GranularType[],
): { symbol: string; label: string; color: string } {
  const group = layerGroups.find((g) => g.id === groupId);
  const firstTypeId = group?.granularTypes[0];
  const granularType = granularTypes.find((t) => t.id === firstTypeId);
  return {
    symbol: granularType?.symbol ?? groupId[0].toUpperCase(),
    label: group?.label ?? groupId,
    color: granularType?.color ?? '#6b7280',
  };
}

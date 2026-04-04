/**
 * Visual Identity System
 *
 * Maps chapters and granular types to colors, symbols, and labels.
 * Config-driven: call hydrateIdentity() with the show config to populate.
 * Hardcoded fallbacks match the defaults in config/default-show.json.
 */

import type { Chapter, LayerType, LayerGroupId, LayerGroupConfig, GranularType, ChapterConfig } from '@/conductor/types';

export interface ChapterIdentity {
  color: string;   // CSS color
  label: string;   // Display name
  icon: string;    // Unicode symbol
}

export interface LayerIdentity {
  color: string;   // CSS color
  symbol: string;  // Unicode symbol
  label: string;   // Short thematic label
}

// Fallback defaults — overwritten by hydrateIdentity() when config arrives.
let chapterLookup: Record<string, ChapterIdentity> = {
  ambition:  { color: '#e63946', label: 'Ambition',  icon: '\u25B2' },
  love:      { color: '#f4a261', label: 'Love',      icon: '\u25CF' },
  avoidance: { color: '#457b9d', label: 'Avoidance', icon: '\u25C6' },
};

let layerLookup: Record<string, LayerIdentity> = {
  seed:    { color: '#e5e5e5', symbol: '◎',      label: 'The Soul' },
  drums:   { color: '#f5c542', symbol: '\u25B2', label: 'The Heartbeat' },
  pad:     { color: '#7b2d8b', symbol: '\u25C6', label: 'The Hand' },
  bass:    { color: '#8b1a1a', symbol: '\u25A0', label: 'The Mind' },
  harmony: { color: '#2563eb', symbol: '\u25CF', label: 'The Hair' },
  fx:      { color: '#22c55e', symbol: '~',      label: 'The Kidney' },
};

const FALLBACK_LAYER: LayerIdentity = {
  color: '#6b7280',
  symbol: '\u25A1', // □
  label: '',
};

/**
 * Populate identity lookup tables from show config.
 * Call once when config is received (e.g., on state_sync).
 * Idempotent — safe to call on every sync.
 */
export function hydrateIdentity(config: {
  chapters?: ChapterConfig[];
  granularTypes?: GranularType[];
}): void {
  if (config.chapters?.length) {
    chapterLookup = {};
    for (const c of config.chapters) {
      chapterLookup[c.id] = { color: c.color, label: c.label, icon: c.icon };
    }
  }
  if (config.granularTypes?.length) {
    layerLookup = {};
    for (const t of config.granularTypes) {
      layerLookup[t.id] = { color: t.color, symbol: t.symbol, label: t.label };
    }
  }
}

/** Get layer identity with fallback for unknown types. */
export function getLayerIdentity(type: LayerType | string): LayerIdentity {
  return layerLookup[type] ?? { ...FALLBACK_LAYER, label: type };
}

/** Get chapter identity. */
export function getChapterIdentity(chapter: Chapter | string): ChapterIdentity {
  return chapterLookup[chapter] ?? { color: '#6b7280', label: chapter, icon: '' };
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

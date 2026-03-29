/**
 * NPC — Event-Driven Narrative Voice
 *
 * The NPC speaks at key events during the finale. This module looks up
 * configured messages by event key and optional layer type, with support
 * for {layerLabel} template variable substitution.
 *
 * Pure function, no I/O.
 */

import type { LayerType, NpcMessageConfig } from './types';

/**
 * Look up the NPC message for a given event (and optional layer type).
 * Returns null if no message is configured for this event.
 * Supports {layerLabel} template variable replaced by the layer's display label.
 */
export function getNpcMessage(
  messages: NpcMessageConfig[],
  event: string,
  layerType?: LayerType,
  context?: { layerLabel?: string },
): string | null {
  const match = messages.find(m =>
    m.event === event && (m.layerType === undefined || m.layerType === layerType),
  );
  if (!match) return null;
  if (!match.text) return null;

  let text = match.text;
  if (context?.layerLabel) {
    text = text.replace(/\{layerLabel\}/g, context.layerLabel);
  }
  return text;
}

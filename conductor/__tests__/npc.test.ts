import { getNpcMessage } from '../npc';
import type { NpcMessageConfig } from '../types';

const messages: NpcMessageConfig[] = [
  { event: 'performer_abandonment', text: "He's gone. We need to do this ourselves." },
  { event: 'assembly_start', text: 'Choose your role. Find each other.' },
  { event: 'assembly_timer_warning', text: 'Decide now.' },
  { event: 'deliberation_start', text: 'Listen. Decide together.' },
  { event: 'empty_group', text: 'No one chose {layerLabel}. We\'ll go without it.' },
  { event: 'ambassador_selected', text: '{layerLabel} has its voice.' },
  { event: 'layer_forfeited', text: '{layerLabel} goes silent. Not every part survives.' },
  { event: 'ceremony_start', text: 'One by one. Bring it forward.' },
  { event: 'layer_locked', text: '' },
  { event: 'final_layer_locked', text: "That's all of us." },
  { event: 'ceremony_complete', text: "He's back. Show him what we built." },
];

describe('getNpcMessage', () => {
  test('returns message for a matching event', () => {
    expect(getNpcMessage(messages, 'assembly_start')).toBe('Choose your role. Find each other.');
  });

  test('returns null for unknown event', () => {
    expect(getNpcMessage(messages, 'unknown_event')).toBeNull();
  });

  test('returns null for empty message text', () => {
    expect(getNpcMessage(messages, 'layer_locked')).toBeNull();
  });

  test('returns null for empty message list', () => {
    expect(getNpcMessage([], 'assembly_start')).toBeNull();
  });

  test('replaces {layerLabel} template variable', () => {
    expect(getNpcMessage(messages, 'empty_group', undefined, { layerLabel: 'The Heartbeat' })).toBe(
      "No one chose The Heartbeat. We'll go without it.",
    );
  });

  test('replaces {layerLabel} in ambassador_selected', () => {
    expect(getNpcMessage(messages, 'ambassador_selected', undefined, { layerLabel: 'The Voice' })).toBe(
      'The Voice has its voice.',
    );
  });

  test('leaves {layerLabel} unreplaced when no context provided', () => {
    const result = getNpcMessage(messages, 'empty_group');
    expect(result).toContain('{layerLabel}');
  });

  test('matches event with optional layerType when layerType matches', () => {
    const specificMessages: NpcMessageConfig[] = [
      { event: 'layer_forfeited', layerType: 'melody', text: 'The Voice is silent.' },
      { event: 'layer_forfeited', text: '{layerLabel} goes silent.' },
    ];
    expect(getNpcMessage(specificMessages, 'layer_forfeited', 'melody')).toBe('The Voice is silent.');
  });

  test('falls back to generic message when layerType does not match specific', () => {
    const specificMessages: NpcMessageConfig[] = [
      { event: 'layer_forfeited', layerType: 'melody', text: 'The Voice is silent.' },
      { event: 'layer_forfeited', text: '{layerLabel} goes silent.' },
    ];
    expect(getNpcMessage(specificMessages, 'layer_forfeited', 'drums', { layerLabel: 'The Heartbeat' })).toBe(
      'The Heartbeat goes silent.',
    );
  });
});

/**
 * FragmentSelector
 *
 * Audience finale component. Shows the user's assigned chapter's fragments as a
 * grid of selectable cards. Winners from song-building are tappable; losers and
 * unreached layers are visible but grayed out ("what could have been").
 *
 * Layout: each layer occupies a row with up to two fragment cards (A and B).
 * Option A = solid fill with chapter color; Option B = outlined.
 */

'use client';

import type { Fragment } from '@/conductor/types';
import { getLayerIdentity } from '@/lib/identity';

export interface FragmentSelectorProps {
  fragments: Array<{ fragment: Fragment; selectable: boolean }>;
  chapterColor: string;
  chapterLabel: string;
  selectedFragmentId: string | null;
  onSelect: (fragmentId: string) => void;
}

export function FragmentSelector({
  fragments,
  chapterColor,
  chapterLabel,
  selectedFragmentId,
  onSelect,
}: FragmentSelectorProps) {
  // Group fragments by layerIndex, preserving order
  const layerMap = new Map<number, Array<{ fragment: Fragment; selectable: boolean }>>();
  for (const entry of fragments) {
    const existing = layerMap.get(entry.fragment.layerIndex) ?? [];
    existing.push(entry);
    layerMap.set(entry.fragment.layerIndex, existing);
  }
  const layers = Array.from(layerMap.entries()).sort(([a], [b]) => a - b);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '480px',
        padding: '16px',
        gap: '8px',
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: 'center',
          paddingBottom: '8px',
          color: chapterColor,
          fontSize: '0.75rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {chapterLabel} — Choose your fragment
      </div>

      {/* Fragment grid */}
      {layers.map(([layerIndex, entries]) => (
        <div
          key={layerIndex}
          style={{
            display: 'grid',
            gridTemplateColumns: entries.length === 1 ? '1fr' : '1fr 1fr',
            gap: '8px',
          }}
        >
          {entries.map(({ fragment, selectable }) => (
            <FragmentCard
              key={fragment.id}
              fragment={fragment}
              selectable={selectable}
              selected={selectedFragmentId === fragment.id}
              chapterColor={chapterColor}
              onSelect={() => onSelect(fragment.id)}
            />
          ))}
        </div>
      ))}

      {fragments.length === 0 && (
        <p
          style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontSize: '0.85rem',
            marginTop: '32px',
          }}
        >
          No fragments available yet.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FragmentCard
// ---------------------------------------------------------------------------

function FragmentCard({
  fragment,
  selectable,
  selected,
  chapterColor,
  onSelect,
}: {
  fragment: Fragment;
  selectable: boolean;
  selected: boolean;
  chapterColor: string;
  onSelect: () => void;
}) {
  const identity = getLayerIdentity(fragment.layerType);
  const isA = fragment.option === 'A';

  const colorStyle: React.CSSProperties = isA
    ? {
        backgroundColor: selectable ? chapterColor : 'rgba(255,255,255,0.06)',
        border: '2px solid transparent',
        color: selectable ? '#000' : 'rgba(255,255,255,0.25)',
      }
    : {
        backgroundColor: 'transparent',
        border: `2px solid ${selectable ? chapterColor : 'rgba(255,255,255,0.12)'}`,
        color: selectable ? chapterColor : 'rgba(255,255,255,0.25)',
      };

  const selectedGlow: React.CSSProperties = selected
    ? { boxShadow: `0 0 0 3px #fff, 0 0 0 5px ${chapterColor}` }
    : {};

  return (
    <button
      onClick={selectable ? onSelect : undefined}
      disabled={!selectable}
      aria-pressed={selected}
      aria-label={`${fragment.displayName}${selectable ? '' : ' (locked)'}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100px',
        borderRadius: '8px',
        cursor: selectable ? 'pointer' : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        transition: 'opacity 0.3s ease, transform 0.15s ease',
        padding: '12px 8px',
        gap: '6px',
        opacity: selectable ? 1 : 0.25,
        fontFamily: 'inherit',
        fontSize: 'inherit',
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
        ...colorStyle,
        ...selectedGlow,
      }}
    >
      {/* Layer type symbol */}
      <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>
        {identity.symbol}
      </span>

      {/* Option letter */}
      <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.7 }}>
        {fragment.option}
      </span>

      {/* Display name */}
      <span style={{ fontSize: '0.75rem', textAlign: 'center', lineHeight: 1.3 }}>
        {fragment.displayName}
      </span>

      {/* Selected checkmark */}
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: '5px',
            right: '7px',
            fontSize: '0.9rem',
            opacity: 0.9,
          }}
        >
          ✓
        </span>
      )}

      {/* Locked indicator for non-selectable */}
      {!selectable && (
        <span
          style={{
            position: 'absolute',
            top: '5px',
            right: '7px',
            fontSize: '0.65rem',
            opacity: 0.5,
            letterSpacing: '0.06em',
          }}
        >
          ✕
        </span>
      )}
    </button>
  );
}

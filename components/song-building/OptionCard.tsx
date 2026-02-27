/**
 * OptionCard
 *
 * Displays a single A or B option within the active layer during song-building.
 * Option A = solid fill with layer color.
 * Option B = outlined with layer color border.
 */

'use client';

import type { LayerType } from '@/conductor/types';
import { getLayerIdentity } from '@/lib/identity';

export interface OptionCardProps {
  option: 'A' | 'B';
  layerType: LayerType;
  label: string;
  selected: boolean;
  disabled: boolean;
  /** null = not yet resolved; true = this option won; false = lost */
  winner: boolean | null;
  collapsed: boolean;
  onSelect: () => void;
}

export function OptionCard({
  option,
  layerType,
  label,
  selected,
  disabled,
  winner,
  collapsed,
  onSelect,
}: OptionCardProps) {
  const identity = getLayerIdentity(layerType);
  const isA = option === 'A';

  const handleClick = () => {
    if (!disabled) onSelect();
  };

  // Visual state
  const isLoser = winner === false;
  const isWinner = winner === true;

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '120px',
    borderRadius: '8px',
    cursor: disabled ? 'default' : 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'opacity 0.3s ease, transform 0.15s ease',
    padding: '16px 12px',
    gap: '8px',
    // Dimmed if loser or collapsed
    opacity: isLoser || collapsed ? 0.3 : 1,
  };

  // Option A = solid fill; Option B = outlined
  const colorStyle: React.CSSProperties = isA
    ? {
        backgroundColor: identity.color,
        border: '2px solid transparent',
        color: '#000',
      }
    : {
        backgroundColor: 'transparent',
        border: `2px solid ${identity.color}`,
        color: identity.color,
      };

  // Selected state: subtle inner glow
  const selectedStyle: React.CSSProperties = selected
    ? { boxShadow: `0 0 0 3px #fff, 0 0 0 5px ${identity.color}` }
    : {};

  // Winner: scale up slightly
  const winnerStyle: React.CSSProperties = isWinner
    ? { transform: 'scale(1.04)' }
    : {};

  // Collapsed: red tint
  const collapsedStyle: React.CSSProperties = collapsed
    ? { borderColor: '#ef4444', filter: 'grayscale(0.6)' }
    : {};

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Option ${option}: ${label}`}
      style={{
        ...baseStyle,
        ...colorStyle,
        ...selectedStyle,
        ...winnerStyle,
        ...collapsedStyle,
        // Reset button defaults
        fontFamily: 'inherit',
        fontSize: 'inherit',
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Layer symbol */}
      <span style={{ fontSize: '2rem', lineHeight: 1 }}>
        {identity.symbol}
      </span>

      {/* Option letter */}
      <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.7 }}>
        {option}
      </span>

      {/* Label */}
      <span style={{ fontSize: '0.85rem', textAlign: 'center', lineHeight: 1.3 }}>
        {label}
      </span>

      {/* Selected checkmark */}
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: '6px',
            right: '8px',
            fontSize: '1rem',
            opacity: 0.9,
          }}
        >
          ✓
        </span>
      )}

      {/* Winner badge */}
      {isWinner && (
        <span
          style={{
            position: 'absolute',
            top: '6px',
            left: '8px',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            opacity: 0.8,
          }}
        >
          CHOSEN
        </span>
      )}
    </button>
  );
}

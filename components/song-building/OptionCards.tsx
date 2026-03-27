'use client';

/**
 * OptionCards
 *
 * Two large side-by-side tappable cards for A/B voting during song-building.
 *
 * Rules:
 * - During voting: both cards are tappable; BLIND (no live vote split shown)
 * - After the user votes: their card is subtly highlighted; vote is FINAL
 * - During auditioning/locked: cards shown but non-interactive (disabled)
 * - RevealSequence takes over during the revealing phase
 */

import type { V32LayerConfig, LayerGroupConfig, GranularType } from '@/conductor/types';
import { getLayerGroupIdentity } from '@/lib/identity';

export interface OptionCardsProps {
  layerConfig: V32LayerConfig;
  myVote: 'A' | 'B' | null;
  disabled: boolean;
  onVote: (choice: 'A' | 'B') => void;
  currentAuditionOption?: 'A' | 'B' | null;
  layerGroups?: LayerGroupConfig[];
  granularTypes?: GranularType[];
}

export function OptionCards({ layerConfig, myVote, disabled, onVote, currentAuditionOption, layerGroups = [], granularTypes = [] }: OptionCardsProps) {
  const identity = getLayerGroupIdentity(layerConfig.group, layerGroups, granularTypes);

  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        width: '100%',
        padding: '0 4px',
      }}
    >
      <OptionButton
        option="A"
        label={layerConfig.labelA}
        identity={identity}
        myVote={myVote}
        disabled={disabled}
        onVote={onVote}
        currentAuditionOption={currentAuditionOption}
      />
      <OptionButton
        option="B"
        label={layerConfig.labelB}
        identity={identity}
        myVote={myVote}
        disabled={disabled}
        onVote={onVote}
        currentAuditionOption={currentAuditionOption}
      />
    </div>
  );
}

interface OptionButtonProps {
  option: 'A' | 'B';
  label: string;
  identity: { color: string; symbol: string; label: string };
  myVote: 'A' | 'B' | null;
  disabled: boolean;
  onVote: (choice: 'A' | 'B') => void;
  currentAuditionOption?: 'A' | 'B' | null;
}

function OptionButton({ option, label, identity, myVote, disabled, onVote, currentAuditionOption }: OptionButtonProps) {
  const isSelected = myVote === option;
  const hasVoted = myVote !== null;
  const isA = option === 'A';

  const baseStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    minHeight: '160px',
    borderRadius: '10px',
    cursor: disabled ? 'default' : 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    padding: '20px 12px',
    position: 'relative',
    transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
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

  // If the user voted for the OTHER option, dim this one slightly
  const votedOtherStyle: React.CSSProperties =
    hasVoted && !isSelected
      ? { opacity: 0.4 }
      : {};

  // If this is the selected card, add a white ring glow
  const selectedStyle: React.CSSProperties = isSelected
    ? { boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${identity.color}` }
    : {};

  const isAuditioning = currentAuditionOption === option;

  return (
    <button
      onClick={() => { if (!disabled) onVote(option); }}
      disabled={disabled}
      aria-pressed={isSelected}
      aria-label={`Option ${option}: ${label}`}
      className={isAuditioning ? 'audition-glow' : undefined}
      style={{
        ...baseStyle,
        ...colorStyle,
        ...votedOtherStyle,
        ...selectedStyle,
        ...(isAuditioning ? { '--glow-color': 'yellow' + '88' } as React.CSSProperties : {}),
      }}
    >
      {/* Layer symbol */}
      <span style={{ fontSize: '2rem', lineHeight: 1 }}>
        {identity.symbol}
      </span>

      {/* Option letter */}
      <span
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          opacity: 0.7,
        }}
      >
        {option}
      </span>

      {/* Emotional tagline */}
      <span
        style={{
          fontSize: '0.9rem',
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>

      {/* Selected checkmark */}
      {isSelected && (
        <span
          style={{
            position: 'absolute',
            top: '8px',
            right: '10px',
            fontSize: '0.9rem',
            opacity: 0.85,
          }}
        >
          ✓
        </span>
      )}
    </button>
  );
}

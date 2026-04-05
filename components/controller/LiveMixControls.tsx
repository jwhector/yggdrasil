/**
 * LiveMixControls (V3.2)
 *
 * Performer controller for the live mix phase. Per-granular-type rows showing:
 * - Active fragment + vote distribution
 * - Override: force a specific fragment
 * - Lock toggle: freeze the type (audience tapping stops affecting it)
 */

'use client';

import { useState, useEffect } from 'react';
import type { GranularType, GranularFragment, ConductorCommand } from '@/conductor/types';
import { MUTE_FRAGMENT_ID } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';
import type { Socket } from 'socket.io-client';

interface LiveMixControlsProps {
  granularTypes: GranularType[];
  allFragments: GranularFragment[];
  activeFragments: Array<{ granularType: string; fragmentId: string }>;
  lockedTypes: string[];
  sendCommand: (command: ConductorCommand) => void;
  socket: Socket | null;
}

interface MixStatePayload {
  activeFragments: Array<{ granularType: string; fragmentId: string }>;
  voteDistributions: Array<{ granularType: string; votes: Array<{ fragmentId: string; count: number }> }>;
  lockedTypes: string[];
  loopPosition: number;
}

export function LiveMixControls({
  granularTypes,
  allFragments,
  activeFragments: initialActive,
  lockedTypes: initialLocked,
  sendCommand,
  socket,
}: LiveMixControlsProps) {
  const [mixState, setMixState] = useState<MixStatePayload | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: MixStatePayload) => setMixState(data);
    socket.on('mix_state', handler);
    return () => { socket.off('mix_state', handler); };
  }, [socket]);

  const activeFragments = mixState?.activeFragments ?? initialActive;
  const voteDistributions = mixState?.voteDistributions ?? [];
  const lockedTypes = mixState?.lockedTypes ?? initialLocked;

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>Live Mix</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {granularTypes.map((gt) => {
          const typeFragments = allFragments.filter(f => f.granularType === gt.id);
          const activeEntry = activeFragments.find(a => a.granularType === gt.id);
          const activeFrag = activeEntry ? typeFragments.find(f => f.id === activeEntry.fragmentId) ?? null : null;
          const isLocked = lockedTypes.includes(gt.id);
          const isMuted = activeEntry?.fragmentId === MUTE_FRAGMENT_ID;
          const distribution = voteDistributions.find(d => d.granularType === gt.id);

          return (
            <TypeControlRow
              key={gt.id}
              granularType={gt}
              fragments={typeFragments}
              activeFragment={activeFrag}
              activeFragmentId={activeEntry?.fragmentId ?? null}
              isLocked={isLocked}
              isMuted={isMuted}
              distribution={distribution?.votes ?? []}
              sendCommand={sendCommand}
            />
          );
        })}
      </div>
    </div>
  );
}

function TypeControlRow({
  granularType,
  fragments,
  activeFragment,
  activeFragmentId,
  isLocked,
  isMuted,
  distribution,
  sendCommand,
}: {
  granularType: GranularType;
  fragments: GranularFragment[];
  activeFragment: GranularFragment | null;
  activeFragmentId: string | null;
  isLocked: boolean;
  isMuted: boolean;
  distribution: Array<{ fragmentId: string; count: number }>;
  sendCommand: (command: ConductorCommand) => void;
}) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const totalVotes = distribution.reduce((s, v) => s + v.count, 0);
  const chapterIdentity = activeFragment ? getChapterIdentity(activeFragment.chapter) : null;

  const handleLockToggle = () => {
    if (isLocked) {
      sendCommand({ type: 'UNLOCK_GRANULAR_TYPE', granularType: granularType.id });
    } else {
      sendCommand({ type: 'LOCK_GRANULAR_TYPE', granularType: granularType.id });
    }
  };

  const handleOverride = (fragmentId: string) => {
    sendCommand({ type: 'OVERRIDE_FRAGMENT', granularType: granularType.id, fragmentId });
    setOverrideOpen(false);
  };

  const handleClearOverride = () => {
    sendCommand({ type: 'CLEAR_OVERRIDE', granularType: granularType.id });
    setOverrideOpen(false);
  };

  return (
    <div style={{
      padding: '10px 12px',
      backgroundColor: '#111',
      borderRadius: '8px',
      border: `1px solid ${isLocked ? 'rgba(255,255,255,0.15)' : '#222'}`,
      opacity: isMuted ? 0.5 : 1,
      transition: 'opacity 0.3s ease',
    }}>
      {/* Top row: type info + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Symbol + label */}
        <span style={{ fontSize: '1.2rem', color: granularType.color }}>{granularType.symbol}</span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: granularType.color }}>
            {granularType.label}
          </span>
          {activeFragment && chapterIdentity ? (
            <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>
              {chapterIdentity.label} · S{activeFragment.songIndex + 1} {activeFragment.option}
            </span>
          ) : (
            <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>—</span>
          )}
        </div>

        {/* Override button */}
        <button
          onClick={() => setOverrideOpen(!overrideOpen)}
          style={{
            ...btnStyle,
            backgroundColor: overrideOpen ? '#333' : '#1a1a1a',
            color: '#aaa',
            fontSize: '0.6rem',
          }}
        >
          {overrideOpen ? 'Cancel' : 'Override'}
        </button>

        {/* Muted indicator (audience-voted) */}
        {isMuted && (
          <span style={{
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: '#4a3800',
            color: '#fbbf24',
            fontSize: '0.55rem',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Muted
          </span>
        )}

        {/* Lock toggle */}
        <button
          onClick={handleLockToggle}
          style={{
            ...btnStyle,
            backgroundColor: isLocked ? '#7f1d1d' : '#1a1a1a',
            color: isLocked ? '#fca5a5' : '#aaa',
            fontSize: '0.6rem',
            minWidth: '50px',
          }}
        >
          {isLocked ? 'Unlock' : 'Lock'}
        </button>
      </div>

      {/* Vote distribution bar */}
      {distribution.length > 0 && (
        <div style={{ display: 'flex', gap: '2px', height: '4px', marginTop: '8px', borderRadius: '2px', overflow: 'hidden' }}>
          {distribution.map(({ fragmentId, count }) => {
            const frag = fragments.find(f => f.id === fragmentId);
            const chapter = frag ? getChapterIdentity(frag.chapter) : null;
            const fragOptColor = frag && chapter
              ? (frag.option === 'A' ? chapter.colorA : chapter.colorB)
              : null;
            const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
            const isActive = fragmentId === activeFragmentId;
            return (
              <div
                key={fragmentId}
                title={`${frag?.chapter ?? '?'} S${(frag?.songIndex ?? 0) + 1} ${frag?.option ?? '?'}: ${count} votes`}
                style={{
                  width: `${pct}%`,
                  backgroundColor: fragOptColor ?? '#444',
                  opacity: isActive ? 1 : 0.4,
                  transition: 'width 0.3s ease',
                }}
              />
            );
          })}
        </div>
      )}

      {/* Override dropdown */}
      {overrideOpen && (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {fragments.map((frag) => {
            const chapter = getChapterIdentity(frag.chapter);
            const fragColor = frag.option === 'A' ? chapter.colorA : chapter.colorB;
            const isActive = frag.id === activeFragmentId;
            return (
              <button
                key={frag.id}
                onClick={() => handleOverride(frag.id)}
                style={{
                  ...btnStyle,
                  padding: '4px 8px',
                  backgroundColor: isActive ? `${fragColor}30` : '#1a1a1a',
                  border: isActive ? `1px solid ${fragColor}` : '1px solid #333',
                  color: fragColor,
                  fontSize: '0.6rem',
                }}
              >
                {chapter.label[0]}·S{frag.songIndex + 1}{frag.option}
              </button>
            );
          })}
          <button
            onClick={handleClearOverride}
            style={{
              ...btnStyle,
              padding: '4px 8px',
              backgroundColor: '#1a1a1a',
              color: '#888',
              fontSize: '0.6rem',
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #222',
};

const headerStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: '#888',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '10px',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #333',
  borderRadius: '4px',
  cursor: 'pointer',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: 'inherit',
  fontWeight: 600,
};

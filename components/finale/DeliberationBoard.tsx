'use client';

import { getLayerIdentity, getChapterIdentity } from '@/lib/identity';
import { useAudioPreview } from '@/hooks/useAudioPreview';
import { useRef } from 'react';
import { AudioPreview } from './AudioPreview';
import type { LayerType, Fragment, UserId } from '@/conductor/types';

interface DeliberationBoardProps {
  myGroup: LayerType;
  myGroupFragments: Fragment[];
  groupVoteCounts: Array<{ fragmentId: string; count: number }>;
  myGroupVote: string | null;
  chosenFragment: string | null;
  isAmbassadorVolunteer: boolean;
  myAmbassadorStatus: UserId | null;
  deliberationTimerRemaining: number;
  volunteerTimerRemaining: number | null;
  onVote: (fragmentId: string) => void;
  onVolunteer: () => void;
  userId: string;
}

export function DeliberationBoard({
  myGroup,
  myGroupFragments,
  groupVoteCounts,
  myGroupVote,
  chosenFragment,
  isAmbassadorVolunteer,
  myAmbassadorStatus,
  deliberationTimerRemaining,
  volunteerTimerRemaining,
  onVote,
  onVolunteer,
  userId,
}: DeliberationBoardProps) {
  const timerDurationRef = useRef(deliberationTimerRemaining);
  const layerIdentity = getLayerIdentity(myGroup);
  const audio = useAudioPreview();

  const voteCountFor = (id: string) =>
    groupVoteCounts.find(v => v.fragmentId === id)?.count ?? 0;

  // Sub-state A: Voting active
  const isVotingActive = chosenFragment === null;

  // Sub-state B: Fragment chosen, ambassador volunteering open
  const isVolunteering = chosenFragment !== null && volunteerTimerRemaining !== null;

  // Sub-state C: Ambassador resolved (timer gone, myAmbassadorStatus set or null = forfeited)
  const isResolved = chosenFragment !== null && volunteerTimerRemaining === null;

  const deliberationTimerDuration = timerDurationRef.current;
  const timerPct = deliberationTimerDuration > 0
    ? Math.max(0, deliberationTimerRemaining / deliberationTimerDuration)
    : 0;
  const timerSecs = Math.ceil(deliberationTimerRemaining / 1000);

  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: '32px', boxSizing: 'border-box' }}>
      {/* Header: group identity */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '20px 16px 12px',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <span style={{ fontSize: '1.5rem', color: layerIdentity.color }}>{layerIdentity.symbol}</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: layerIdentity.color }}>{layerIdentity.label}</span>
      </div>

      {/* Timer bar (only during voting) */}
      {isVotingActive && (
        <div style={{ padding: '10px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: timerSecs <= 15 ? '#f87171' : 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
              {timerSecs}s
            </span>
          </div>
          <div style={{ height: '3px', backgroundColor: '#1a1a1a' }}>
            <div style={{
              height: '100%',
              width: `${timerPct * 100}%`,
              backgroundColor: timerSecs <= 15 ? '#f87171' : 'rgba(255,255,255,0.35)',
              transition: 'width 1s linear, background-color 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Sub-state A: Fragment cards for voting */}
      {isVotingActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px' }}>
          {myGroupFragments.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', textAlign: 'center', marginTop: '32px' }}>
              No fragments available
            </p>
          )}
          {myGroupFragments.map((fragment) => {
            const chapterIdentity = getChapterIdentity(fragment.chapter);
            const isVoted = myGroupVote === fragment.id;
            const count = voteCountFor(fragment.id);

            return (
              <div
                key={fragment.id}
                onClick={() => onVote(fragment.id)}
                style={{
                  backgroundColor: '#0d0d0d',
                  border: isVoted ? `2px solid ${layerIdentity.color}` : '2px solid #222',
                  borderRadius: '10px',
                  padding: '14px',
                  cursor: 'pointer',
                  boxShadow: isVoted ? `0 0 12px ${layerIdentity.color}30` : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                } as React.CSSProperties}
              >
                {/* Chapter dot + label row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: chapterIdentity.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Song {fragment.attemptIndex + 1}
                    </span>
                  </div>
                  {/* Vote count */}
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.35)',
                    backgroundColor: '#1a1a1a',
                    padding: '2px 8px',
                    borderRadius: '10px',
                  }}>
                    {count} {count === 1 ? 'vote' : 'votes'}
                  </span>
                </div>

                {/* Fragment display label */}
                <p style={{
                  margin: '0 0 12px',
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: isVoted ? '#fff' : 'rgba(255,255,255,0.75)',
                  lineHeight: 1.3,
                }}>
                  {fragment.displayLabel}
                </p>

                {/* Audio preview + vote button row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AudioPreview
                    isPlaying={audio.currentId === fragment.id && audio.isPlaying}
                    onToggle={() => audio.play(fragment.id, fragment.previewAudioPath)}
                  />
                  <button
                    onClick={e => { e.stopPropagation(); onVote(fragment.id); }}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      backgroundColor: isVoted ? layerIdentity.color : '#222',
                      color: isVoted ? '#000' : 'rgba(255,255,255,0.6)',
                      transition: 'background-color 0.15s ease, color 0.15s ease',
                      WebkitTapHighlightColor: 'transparent',
                    } as React.CSSProperties}
                  >
                    {isVoted ? 'Voted' : 'Vote'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sub-state B: Fragment chosen — ambassador volunteering */}
      {(isVolunteering || isResolved) && chosenFragment && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: '20px' }}>
          {/* Chosen fragment display */}
          <div style={{
            width: '100%',
            padding: '16px',
            backgroundColor: '#0d0d0d',
            border: `1px solid ${layerIdentity.color}40`,
            borderRadius: '10px',
            textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              Your group chose
            </p>
            <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>
              {myGroupFragments.find(f => f.id === chosenFragment)?.displayLabel ?? chosenFragment}
            </p>
          </div>

          {/* Volunteering prompt */}
          {isVolunteering && !isAmbassadorVolunteer && (
            <>
              <p style={{ margin: 0, fontSize: '1rem', color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 1.5 }}>
                Will you carry this forward?
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)' }}>
                <span>{Math.ceil((volunteerTimerRemaining ?? 0) / 1000)}s remaining</span>
              </div>
              <button
                onClick={onVolunteer}
                style={{
                  padding: '14px 32px',
                  backgroundColor: layerIdentity.color,
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                  WebkitTapHighlightColor: 'transparent',
                } as React.CSSProperties}
              >
                I volunteer
              </button>
            </>
          )}

          {isVolunteering && isAmbassadorVolunteer && (
            <>
              <p style={{ margin: 0, fontSize: '1rem', color: layerIdentity.color, textAlign: 'center' }}>
                You volunteered
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                Waiting for selection...
              </p>
            </>
          )}

          {/* Sub-state C: Ambassador resolved */}
          {isResolved && myAmbassadorStatus === userId && (
            <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: layerIdentity.color, textAlign: 'center' }}>
              You are the ambassador for {layerIdentity.label}
            </p>
          )}

          {isResolved && myAmbassadorStatus !== null && myAmbassadorStatus !== userId && (
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
              An ambassador has been chosen for {layerIdentity.label}
            </p>
          )}

          {isResolved && myAmbassadorStatus === null && (
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center', fontStyle: 'italic' }}>
              {layerIdentity.label} goes silent
            </p>
          )}
        </div>
      )}
    </div>
  );
}

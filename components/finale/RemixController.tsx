/**
 * RemixController (V3.4)
 *
 * Controller fallback UI for the performer remix phase.
 * 6x3 button grid (granular types x chapters), pool counters,
 * queue depth badges, active node indicators, audience interaction toggle.
 */

'use client';

import { useCallback, useState, useEffect } from 'react';
import type { ShowState, ConductorCommand, FinaleState, GranularType, ChapterConfig } from '@/conductor/types';
import { useRemixQueue } from '@/hooks/useRemixQueue';
import { useTokenPool, type PoolState } from '@/hooks/useTokenPool';
import type { Socket } from 'socket.io-client';

interface RemixControllerProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
  socket: Socket | null;
}

export function RemixController({ fullState, sendCommand, socket }: RemixControllerProps) {
  const finaleState = fullState.finaleState as FinaleState | null;
  const { queueToken, cancelQueue, advanceNode } = useRemixQueue(sendCommand);
  const poolState = useTokenPool(socket);

  const granularTypes = fullState.config.granularTypes ?? [];
  const chapters = fullState.config.chapters ?? [];

  if (!finaleState) return null;

  // Pool data — prefer high-frequency pool_state, fall back to state
  const availableByChapter = poolState.totalRemaining > 0
    ? new Map(poolState.availableByChapter.map(e => [e.chapterId, e.count]))
    : finaleState.pool.availableByChapter;

  // Vote progress — live from vote_progress socket event, fallback to state
  const [voteProgress, setVoteProgress] = useState({
    completedUsers: 0,
    totalUsers: fullState.users.size,
    totalOrbs: finaleState.pool.tokens.length,
  });

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { completedUsers: number; totalUsers: number; totalOrbs: number }) => {
      setVoteProgress(data);
    };
    socket.on('vote_progress', handler);
    return () => { socket.off('vote_progress', handler); };
  }, [socket]);

  // Derive from state as fallback (for initial load before any vote_progress arrives)
  const totalQuestions = fullState.config.finale?.vote?.questions?.length ?? 0;
  const stateCompletedUsers = (() => {
    let n = 0;
    for (const [, count] of finaleState.vote.questionsAnsweredByUser) {
      if (count >= totalQuestions) n++;
    }
    return n;
  })();

  const completedUsers = voteProgress.completedUsers || stateCompletedUsers;
  const totalUsers = voteProgress.totalUsers || fullState.users.size;
  const totalAnswered = voteProgress.totalOrbs || finaleState.pool.tokens.length;
  const isVotePhase = fullState.phase === 'finale_vote';

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>
        {isVotePhase ? 'Audience Voting' : 'Token Remix'}
      </h2>

      {/* Vote progress — visible during both phases */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '12px',
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>
            Completed voting
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: completedUsers === totalUsers ? '#86efac' : '#e5e7eb' }}>
            {completedUsers} / {totalUsers}
            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginLeft: '6px' }}>
              ({totalUsers > 0 ? Math.round((completedUsers / totalUsers) * 100) : 0}%)
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginTop: '4px' }}>
            <div style={{
              width: `${totalUsers > 0 ? (completedUsers / totalUsers) * 100 : 0}%`,
              height: '100%',
              borderRadius: 2,
              background: completedUsers === totalUsers ? '#86efac' : '#60a5fa',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>Total orbs</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e5e7eb' }}>{totalAnswered}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>Per person</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e5e7eb' }}>{totalQuestions}</div>
        </div>
      </div>

      {/* Pool by chapter */}
      <div style={styles.poolRow}>
        <span style={styles.poolLabel}>Pool:</span>
        {chapters.map(ch => {
          const total = finaleState.pool.totalByChapter.get(ch.id) ?? 0;
          return (
            <span key={ch.id} style={{ ...styles.poolCount, color: ch.color }}>
              {total}
            </span>
          );
        })}
        <span style={styles.poolTotal}>
          Total: {totalAnswered}
        </span>
      </div>

      {/* 6x3 grid — only during remix */}
      {!isVotePhase && (<>

      {/* 6x3 grid */}
      <div style={styles.gridContainer}>
        {/* Header row */}
        <div style={styles.gridRow}>
          <div style={styles.typeLabel} />
          {chapters.map(ch => (
            <div key={ch.id} style={{ ...styles.chapterHeader, color: ch.color }}>
              {ch.label}
            </div>
          ))}
          <div style={styles.queueHeader}>Queue</div>
        </div>

        {/* Granular type rows */}
        {granularTypes.map(gt => {
          const active = finaleState.active.get(gt.id);
          const queue = finaleState.queue.get(gt.id) ?? [];
          const queueDepth = queue.length;

          return (
            <div key={gt.id} style={styles.gridRow}>
              {/* Type label — tap to advance node (activate next queued or silence) */}
              <button
                onClick={() => advanceNode(gt.id)}
                style={{
                  ...styles.typeLabel,
                  ...styles.typeLabelButton,
                  borderColor: active
                    ? chapters.find(c => c.id === active.chapterId)?.color ?? 'rgba(255,255,255,0.15)'
                    : queueDepth > 0
                      ? 'rgba(255,255,255,0.25)'
                      : 'rgba(255,255,255,0.08)',
                }}
                title={
                  queueDepth > 0
                    ? `Advance ${gt.label}: activate next queued token`
                    : active
                      ? `Advance ${gt.label}: silence node`
                      : `${gt.label}: nothing queued or active`
                }
              >
                <span style={{ ...styles.typeSymbol, color: gt.color }}>{gt.symbol}</span>
                <span style={styles.typeName}>{gt.label}</span>
                {active && (
                  <ActiveIndicator chapterId={active.chapterId} chapters={chapters} loopProgress={finaleState.loopProgress} persistent={active.persistent} />
                )}
              </button>

              {/* Chapter buttons */}
              {chapters.map(ch => {
                const available = availableByChapter.get(ch.id) ?? 0;
                const isActive = active?.chapterId === ch.id;
                const isQueued = queue.some(q => q.chapterId === ch.id);
                const isEmpty = available <= 0;

                return (
                  <button
                    key={ch.id}
                    onClick={() => queueToken(gt.id, ch.id)}
                    onDoubleClick={() => cancelQueue(gt.id)}
                    disabled={isEmpty}
                    style={{
                      ...styles.tokenButton,
                      borderColor: isActive
                        ? ch.color
                        : isQueued
                          ? `${ch.color}88`
                          : 'rgba(255,255,255,0.1)',
                      backgroundColor: isActive
                        ? `${ch.color}22`
                        : 'rgba(255,255,255,0.03)',
                      opacity: isEmpty ? 0.3 : 1,
                    }}
                    title={`Queue ${ch.label} for ${gt.label}. Double-click to cancel.`}
                  >
                    <div style={{ ...styles.buttonDot, backgroundColor: ch.color }} />
                  </button>
                );
              })}

              {/* Queue depth */}
              <div style={styles.queueBadge}>
                {queueDepth > 0 ? `x${queueDepth}` : '\u2014'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Audience interaction toggle */}
      <div style={styles.toggleRow}>
        <button
          onClick={() => sendCommand({ type: 'TOGGLE_AUDIENCE_INTERACTION' })}
          style={{
            ...styles.toggleButton,
            backgroundColor: finaleState.audienceInteraction
              ? 'rgba(34, 197, 94, 0.15)'
              : 'rgba(255,255,255,0.05)',
            borderColor: finaleState.audienceInteraction
              ? 'rgba(34, 197, 94, 0.5)'
              : 'rgba(255,255,255,0.15)',
            color: finaleState.audienceInteraction
              ? '#86efac'
              : 'rgba(255,255,255,0.5)',
          }}
        >
          Audience Mode: {finaleState.audienceInteraction ? 'ON' : 'OFF'}
        </button>
        <span style={styles.toggleHint}>
          {finaleState.audienceInteraction
            ? 'Instant crossfade + persistent loops'
            : 'Loop-quantized, one-token-one-loop'}
        </span>
      </div>

      {/* Loop counter */}
      <div style={styles.loopInfo}>
        Loop {finaleState.loopCount} | Progress: {Math.round(finaleState.loopProgress * 100)}%
      </div>

      {/* Inject tokens (testing) */}
      <InjectTokens chapters={chapters} sendCommand={sendCommand} />

      {/* Swarm Orb Controls */}
      <SwarmControls
        finaleState={finaleState}
        granularTypes={granularTypes}
        chapters={chapters}
        sendCommand={sendCommand}
      />

      </>)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Active indicator — shows which chapter is playing on a node
// ---------------------------------------------------------------------------

function ActiveIndicator({
  chapterId,
  chapters,
  loopProgress,
  persistent,
}: {
  chapterId: string;
  chapters: ChapterConfig[];
  loopProgress: number;
  persistent: boolean;
}) {
  const chapter = chapters.find(c => c.id === chapterId);
  const color = chapter?.color ?? '#888';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
      <div style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: color,
      }} />
      <div style={{
        width: 40,
        height: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.1)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${loopProgress * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: 2,
          transition: 'width 0.1s linear',
        }} />
      </div>
      {persistent && (
        <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.3)' }}>
          HOLD
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swarm Orb Controls — decay, scatter, lock, crossfade mode, fallback
// ---------------------------------------------------------------------------

function SwarmControls({
  finaleState,
  granularTypes,
  chapters,
  sendCommand,
}: {
  finaleState: FinaleState;
  granularTypes: GranularType[];
  chapters: ChapterConfig[];
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const [lockChapterIdx, setLockChapterIdx] = useState(0);
  const selectedLockChapter = chapters[lockChapterIdx] ?? chapters[0];

  return (
    <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
      <h3 style={{ ...styles.sectionTitle, marginBottom: '8px' }}>Swarm Orbs</h3>

      {/* Enable/disable nodes */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', width: '100%', marginBottom: '2px' }}>Enable Nodes:</span>
        {granularTypes.map(gt => {
          const isEnabled = finaleState.enabledNodes.has(gt.id);
          return (
            <button
              key={gt.id}
              onClick={() => {
                if (isEnabled) {
                  sendCommand({ type: 'DISABLE_NODE', granularType: gt.id });
                } else {
                  sendCommand({ type: 'ENABLE_NODE', granularType: gt.id });
                }
              }}
              style={{
                ...styles.tokenButton,
                width: 'auto',
                height: '30px',
                padding: '0 10px',
                fontSize: '0.6rem',
                color: isEnabled ? '#86efac' : 'rgba(255,255,255,0.3)',
                borderColor: isEnabled ? 'rgba(134, 239, 172, 0.4)' : 'rgba(255,255,255,0.1)',
                backgroundColor: isEnabled ? 'rgba(134, 239, 172, 0.1)' : 'rgba(255,255,255,0.03)',
              }}
            >
              {gt.symbol} {gt.label}
            </button>
          );
        })}
        {/* Seed node */}
        {(() => {
          const seedEnabled = finaleState.enabledNodes.has('seed');
          return (
            <button
              onClick={() => {
                if (seedEnabled) {
                  sendCommand({ type: 'DISABLE_NODE', granularType: 'seed' });
                } else {
                  sendCommand({ type: 'ENABLE_NODE', granularType: 'seed' });
                }
              }}
              style={{
                ...styles.tokenButton,
                width: 'auto',
                height: '30px',
                padding: '0 10px',
                fontSize: '0.6rem',
                color: seedEnabled ? '#86efac' : 'rgba(255,255,255,0.3)',
                borderColor: seedEnabled ? 'rgba(134, 239, 172, 0.4)' : 'rgba(255,255,255,0.1)',
                backgroundColor: seedEnabled ? 'rgba(134, 239, 172, 0.1)' : 'rgba(255,255,255,0.03)',
              }}
            >
              ✦ HEART
            </button>
          );
        })()}
        <button
          onClick={() => {
            // Enable all nodes
            for (const gt of granularTypes) {
              if (!finaleState.enabledNodes.has(gt.id)) {
                sendCommand({ type: 'ENABLE_NODE', granularType: gt.id });
              }
            }
            if (!finaleState.enabledNodes.has('seed')) {
              sendCommand({ type: 'ENABLE_NODE', granularType: 'seed' });
            }
          }}
          style={{
            ...styles.tokenButton,
            width: 'auto',
            height: '30px',
            padding: '0 10px',
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            borderColor: 'rgba(255,255,255,0.15)',
          }}
        >
          Enable All
        </button>
      </div>

      {/* Decay rate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', width: 55, flexShrink: 0 }}>
          Decay: {finaleState.orbDecayLoops === 0 ? 'OFF' : `${finaleState.orbDecayLoops}L`}
        </span>
        <input
          type="range"
          min={0}
          max={8}
          value={finaleState.orbDecayLoops}
          onChange={e => sendCommand({ type: 'SET_DECAY_RATE', loops: Number(e.target.value) })}
          style={{ flex: 1, accentColor: '#86efac' }}
        />
      </div>

      {/* Crossfade mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <button
          onClick={() => sendCommand({ type: 'SET_CROSSFADE_MODE', instant: !finaleState.instantCrossfade })}
          style={{
            ...styles.toggleButton,
            padding: '6px 12px',
            minHeight: '32px',
            fontSize: '0.7rem',
            backgroundColor: finaleState.instantCrossfade
              ? 'rgba(251, 191, 36, 0.15)'
              : 'rgba(255,255,255,0.05)',
            borderColor: finaleState.instantCrossfade
              ? 'rgba(251, 191, 36, 0.5)'
              : 'rgba(255,255,255,0.15)',
            color: finaleState.instantCrossfade
              ? '#fbbf24'
              : 'rgba(255,255,255,0.5)',
          }}
        >
          Crossfade: {finaleState.instantCrossfade ? 'INSTANT' : 'LOOP'}
        </button>
      </div>

      {/* Scatter buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
        <button
          onClick={() => sendCommand({ type: 'SCATTER_ALL' })}
          style={{
            ...styles.tokenButton,
            width: 'auto',
            height: '30px',
            padding: '0 10px',
            fontSize: '0.65rem',
            color: '#f87171',
            borderColor: 'rgba(248, 113, 113, 0.3)',
          }}
        >
          Scatter All
        </button>
        {granularTypes.map(gt => (
          <button
            key={gt.id}
            onClick={() => sendCommand({ type: 'SCATTER_NODE', granularType: gt.id })}
            style={{
              ...styles.tokenButton,
              width: 'auto',
              height: '30px',
              padding: '0 8px',
              fontSize: '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              borderColor: 'rgba(255,255,255,0.1)',
            }}
          >
            {gt.symbol} Scatter
          </button>
        ))}
      </div>

      {/* Lock/unlock per node */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', width: '100%' }}>Lock Node:</span>
        <select
          value={lockChapterIdx}
          onChange={e => setLockChapterIdx(Number(e.target.value))}
          style={{
            padding: '3px 6px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#e5e7eb',
            fontSize: '0.7rem',
          }}
        >
          {chapters.map((ch, i) => (
            <option key={ch.id} value={i}>{ch.label}</option>
          ))}
        </select>
        {granularTypes.map(gt => {
          const tally = finaleState.nodeTallies.get(gt.id);
          const isLocked = tally?.locked ?? false;
          return (
            <button
              key={gt.id}
              onClick={() => {
                if (isLocked) {
                  sendCommand({ type: 'UNLOCK_NODE', granularType: gt.id });
                } else if (selectedLockChapter) {
                  sendCommand({ type: 'LOCK_NODE', granularType: gt.id, chapterId: selectedLockChapter.id });
                }
              }}
              style={{
                ...styles.tokenButton,
                width: 'auto',
                height: '28px',
                padding: '0 6px',
                fontSize: '0.6rem',
                color: isLocked ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                borderColor: isLocked ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)',
                backgroundColor: isLocked ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.03)',
              }}
            >
              {gt.symbol} {isLocked ? '🔓' : '🔒'}
            </button>
          );
        })}
      </div>

      {/* Fallback button */}
      {!finaleState.fallbackMode && (
        <button
          onClick={() => {
            if (confirm('Switch to performer fallback mode? Audience phones will go dark.')) {
              sendCommand({ type: 'FALLBACK_PERFORMER_REMIX' });
            }
          }}
          style={{
            ...styles.toggleButton,
            padding: '6px 12px',
            minHeight: '32px',
            fontSize: '0.7rem',
            color: '#f87171',
            borderColor: 'rgba(248,113,113,0.3)',
            backgroundColor: 'rgba(248,113,113,0.08)',
            marginTop: '4px',
          }}
        >
          Performer Fallback
        </button>
      )}
      {finaleState.fallbackMode && (
        <div style={{ fontSize: '0.65rem', color: '#f87171', marginTop: '4px' }}>
          FALLBACK MODE ACTIVE — audience phones dark
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inject tokens — testing tool
// ---------------------------------------------------------------------------

function InjectTokens({
  chapters,
  sendCommand,
}: {
  chapters: ChapterConfig[];
  sendCommand: (cmd: ConductorCommand) => void;
}) {
  const [count, setCount] = useState(10);
  const [chapterIdx, setChapterIdx] = useState(0);

  const selectedChapter = chapters[chapterIdx] ?? chapters[0];
  if (!selectedChapter) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
      <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>Inject:</span>
      <input
        type="number"
        min={1}
        max={200}
        value={count}
        onChange={e => setCount(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
        style={{
          width: 48,
          padding: '4px 6px',
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)',
          color: '#e5e7eb',
          fontSize: '0.75rem',
          textAlign: 'center' as const,
        }}
      />
      <select
        value={chapterIdx}
        onChange={e => setChapterIdx(Number(e.target.value))}
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)',
          color: '#e5e7eb',
          fontSize: '0.75rem',
        }}
      >
        {chapters.map((ch, i) => (
          <option key={ch.id} value={i}>{ch.label}</option>
        ))}
      </select>
      <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: selectedChapter.color, flexShrink: 0 }} />
      <button
        onClick={() => sendCommand({ type: 'INJECT_TOKENS', chapterId: selectedChapter.id, count })}
        style={{
          padding: '4px 10px',
          borderRadius: 4,
          border: '1px solid rgba(34, 197, 94, 0.4)',
          background: 'rgba(34, 197, 94, 0.1)',
          color: '#86efac',
          fontSize: '0.75rem',
          cursor: 'pointer',
        }}
      >
        Add
      </button>
      <button
        onClick={() => {
          for (const ch of chapters) {
            sendCommand({ type: 'INJECT_TOKENS', chapterId: ch.id, count });
          }
        }}
        style={{
          padding: '4px 10px',
          borderRadius: 4,
          border: '1px solid rgba(34, 197, 94, 0.4)',
          background: 'rgba(34, 197, 94, 0.1)',
          color: '#86efac',
          fontSize: '0.75rem',
          cursor: 'pointer',
        }}
      >
        All
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  section: {
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  gridContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '12px',
  },
  gridRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  typeLabel: {
    width: '160px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.75rem',
    color: 'rgba(255,255,255,0.5)',
    flexShrink: 0,
  } as React.CSSProperties,
  typeLabelButton: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    padding: '6px 8px',
    cursor: 'pointer',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'border-color 0.15s ease',
    minHeight: '36px',
  } as React.CSSProperties,
  typeSymbol: {
    fontSize: '0.9rem',
    width: '16px',
    textAlign: 'center' as const,
  },
  typeName: {
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.4)',
  },
  chapterHeader: {
    width: '80px',
    textAlign: 'center' as const,
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
  },
  queueHeader: {
    width: '48px',
    textAlign: 'center' as const,
    fontSize: '0.6rem',
    color: 'rgba(255,255,255,0.3)',
  },
  tokenButton: {
    width: '80px',
    height: '44px',
    borderRadius: '8px',
    border: '1.5px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
    outline: 'none',
  } as React.CSSProperties,
  buttonDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },
  queueBadge: {
    width: '48px',
    textAlign: 'center' as const,
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 500,
  },
  poolRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
    fontSize: '0.75rem',
  },
  poolLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 500,
  },
  poolCount: {
    fontWeight: 600,
    fontSize: '0.85rem',
  },
  poolTotal: {
    color: 'rgba(255,255,255,0.3)',
    marginLeft: 'auto',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
  },
  toggleButton: {
    padding: '10px 16px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600,
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    minHeight: '44px',
  } as React.CSSProperties,
  toggleHint: {
    fontSize: '0.65rem',
    color: 'rgba(255,255,255,0.25)',
  },
  loopInfo: {
    fontSize: '0.65rem',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: '0.05em',
  },
};

/**
 * RemixController (V3.4)
 *
 * Controller fallback UI for the performer remix phase.
 * 6x3 button grid (granular types x chapters), pool counters,
 * queue depth badges, active node indicators, audience interaction toggle.
 */

'use client';

import { useCallback, useState } from 'react';
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
  const { queueToken, cancelQueue } = useRemixQueue(sendCommand);
  const poolState = useTokenPool(socket);

  const granularTypes = fullState.config.granularTypes ?? [];
  const chapters = fullState.config.chapters ?? [];

  if (!finaleState) return null;

  // Pool data — prefer high-frequency pool_state, fall back to state
  const availableByChapter = poolState.totalRemaining > 0
    ? new Map(poolState.availableByChapter.map(e => [e.chapterId, e.count]))
    : finaleState.pool.availableByChapter;

  const totalRemaining = poolState.totalRemaining > 0
    ? poolState.totalRemaining
    : finaleState.pool.totalRemaining;

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Token Remix</h2>

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
              {/* Type label */}
              <div style={styles.typeLabel}>
                <span style={{ ...styles.typeSymbol, color: gt.color }}>{gt.symbol}</span>
                <span style={styles.typeName}>{gt.label}</span>
                {active && (
                  <ActiveIndicator chapterId={active.chapterId} chapters={chapters} loopProgress={finaleState.loopProgress} persistent={active.persistent} />
                )}
              </div>

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

      {/* Pool counters */}
      <div style={styles.poolRow}>
        <span style={styles.poolLabel}>Pool:</span>
        {chapters.map(ch => {
          const available = availableByChapter.get(ch.id) ?? 0;
          return (
            <span key={ch.id} style={{ ...styles.poolCount, color: ch.color }}>
              {available}
            </span>
          );
        })}
        <span style={styles.poolTotal}>
          Total: {totalRemaining}
        </span>
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
  },
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

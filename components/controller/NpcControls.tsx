'use client';

/**
 * NpcControls
 *
 * Controller panel for NPC message management.
 * Provides a pre-written line bank organized by category, free-text input,
 * and auto-trigger toggle.
 */

import { useState } from 'react';
import type { ShowState, ConductorCommand } from '@/conductor/types';

interface NpcControlsProps {
  fullState: ShowState;
  sendCommand: (cmd: ConductorCommand) => void;
}

const NPC_LINE_BANK: Array<{ category: string; lines: string[] }> = [
  {
    category: 'Encouragement',
    lines: [
      "Come on. You know this one.",
      "Close. So close. Try again.",
      "You've been here before. Do it again.",
      "Almost. Keep going.",
    ],
  },
  {
    category: 'Exasperation',
    lines: [
      "...again? We KNOW that one works.",
      "That one. Obviously that one. Why are we still here.",
      "Every. Single. Time.",
      "I'll wait. I have nothing but time.",
    ],
  },
  {
    category: 'Urgency',
    lines: [
      "Timer's running. Focus.",
      "Last chance. Make it count.",
      "Now. It has to be now.",
      "Running out of time. Decide.",
    ],
  },
  {
    category: 'Celebration',
    lines: [
      "That fast? You've been holding out on me.",
      "Yes. Yes! That's it.",
      "One more. Just one more.",
      "We're building something. Keep going.",
    ],
  },
];

export function NpcControls({ fullState, sendCommand }: NpcControlsProps) {
  const [freeText, setFreeText] = useState('');
  const { finaleState } = fullState;
  if (!finaleState) return null;

  const currentMessage = finaleState.npc.currentMessage;
  const autoEnabled = finaleState.npc.autoTriggersEnabled;

  const sendMessage = (message: string) => {
    if (!message.trim()) return;
    sendCommand({ type: 'SEND_NPC_MESSAGE', message: message.trim() });
  };

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>NPC Controls</h2>

      {/* Current message */}
      {currentMessage && (
        <div style={styles.currentMessage}>
          <span style={styles.currentMessageLabel}>Active: </span>
          <span style={styles.currentMessageText}>{currentMessage}</span>
        </div>
      )}

      {/* Auto-trigger toggle */}
      <div style={styles.toggleRow}>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={autoEnabled}
            onChange={e =>
              sendCommand({
                type: 'TOGGLE_NPC_AUTO_TRIGGERS' as ConductorCommand['type'],
                enabled: e.target.checked,
              } as unknown as ConductorCommand)
            }
            style={{ marginRight: '8px' }}
          />
          Auto-triggers {autoEnabled ? 'ON' : 'OFF'}
        </label>
      </div>

      {/* Line bank */}
      <div style={styles.lineBankGrid}>
        {NPC_LINE_BANK.map(({ category, lines }) => (
          <div key={category} style={styles.categoryGroup}>
            <div style={styles.categoryLabel}>{category}</div>
            <div style={styles.linesCol}>
              {lines.map((line, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(line)}
                  style={styles.lineBtn}
                >
                  {line}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Free text input */}
      <div style={styles.freeTextRow}>
        <input
          type="text"
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              sendMessage(freeText);
              setFreeText('');
            }
          }}
          placeholder="Type custom NPC line…"
          style={styles.textInput}
        />
        <button
          onClick={() => {
            sendMessage(freeText);
            setFreeText('');
          }}
          disabled={!freeText.trim()}
          style={{
            ...styles.sendBtn,
            ...(!freeText.trim() ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
          }}
        >
          Send
        </button>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '16px 20px', borderBottom: '1px solid #2a2a2a' },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  currentMessage: {
    padding: '8px 12px',
    backgroundColor: '#0d2a1a',
    border: '1px solid #1a4a2a',
    borderRadius: '6px',
    marginBottom: '12px',
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '0.8rem',
  },
  currentMessageLabel: { color: '#4ade80', marginRight: '4px' },
  currentMessageText: { color: '#86efac' },
  toggleRow: { marginBottom: '12px' },
  toggleLabel: { fontSize: '0.85rem', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  lineBankGrid: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '12px',
  },
  categoryGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '1 1 180px',
    minWidth: '180px',
  },
  categoryLabel: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '2px',
  },
  linesCol: { display: 'flex', flexDirection: 'column', gap: '3px' },
  lineBtn: {
    padding: '6px 10px',
    fontSize: '0.75rem',
    color: '#ccc',
    backgroundColor: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    cursor: 'pointer',
    textAlign: 'left',
    lineHeight: 1.3,
    fontFamily: 'inherit',
  },
  freeTextRow: { display: 'flex', gap: '8px' },
  textInput: {
    flex: 1,
    padding: '10px 12px',
    fontSize: '0.85rem',
    backgroundColor: '#111',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#f0f0f0',
    fontFamily: 'inherit',
    outline: 'none',
  },
  sendBtn: {
    padding: '10px 16px',
    fontSize: '0.85rem',
    fontWeight: 600,
    backgroundColor: '#1e3a5f',
    color: '#93c5fd',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

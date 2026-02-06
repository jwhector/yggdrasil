/**
 * FigTreeInput Component
 *
 * Lobby phase: Text input for audience to respond to the fig tree prompt.
 * "What lives on your fig tree?" — prompts about paths not taken.
 */

'use client';

import { useState } from 'react';
import type { ConductorCommand } from '@/conductor/types';

interface FigTreeInputProps {
  sendCommand: (command: ConductorCommand) => void;
}

const CHARACTER_LIMIT = 500;

export function FigTreeInput({ sendCommand }: FigTreeInputProps) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!text.trim()) return;

    setIsSubmitting(true);
    sendCommand({
      type: 'SUBMIT_FIG_TREE_RESPONSE',
      userId: '', // Will be filled by socket handler with actual userId
      text: text.trim(),
    });

    // Submission state will be updated by server via state sync
    setTimeout(() => setIsSubmitting(false), 1000);
  };

  const remainingChars = CHARACTER_LIMIT - text.length;
  const isOverLimit = remainingChars < 0;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>What lives on your fig tree?</h2>
      <p style={styles.subtitle}>
        Tell us about a path you didn't take, a version of yourself that might
        have been.
      </p>

      <textarea
        style={{
          ...styles.textarea,
          borderColor: isOverLimit ? '#ef4444' : '#404040',
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your response here..."
        rows={6}
        disabled={isSubmitting}
      />

      <div style={styles.footer}>
        <span
          style={{
            ...styles.charCount,
            color: isOverLimit ? '#ef4444' : '#737373',
          }}
        >
          {remainingChars} characters remaining
        </span>

        <button
          style={{
            ...styles.submitButton,
            opacity: !text.trim() || isOverLimit || isSubmitting ? 0.5 : 1,
            cursor:
              !text.trim() || isOverLimit || isSubmitting
                ? 'not-allowed'
                : 'pointer',
          }}
          onClick={handleSubmit}
          disabled={!text.trim() || isOverLimit || isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '600px',
    width: '100%',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.5rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    margin: 0,
    color: '#f5f5f5',
  },
  subtitle: {
    fontSize: '1rem',
    textAlign: 'center' as const,
    color: '#a3a3a3',
    margin: 0,
    lineHeight: 1.5,
  },
  textarea: {
    width: '100%',
    padding: '1rem',
    fontSize: '1rem',
    fontFamily: 'system-ui',
    backgroundColor: '#171717',
    color: '#f5f5f5',
    border: '2px solid #404040',
    borderRadius: '8px',
    resize: 'vertical' as const,
    minHeight: '150px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: {
    fontSize: '0.875rem',
  },
  submitButton: {
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    fontWeight: '600' as const,
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    transition: 'all 0.2s',
  },
};

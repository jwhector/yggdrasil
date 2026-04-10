/**
 * EmotionVote (V3.4)
 *
 * Audience component for the finale_vote phase.
 * Shows a personal question + 3 tappable chapter cards.
 * After tapping, the answer is confirmed and the next question arrives
 * via a dedicated socket event. Shows "phones down" when pool cap is reached.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChapterConfig } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

interface EmotionVoteProps {
  socket: Socket | null;
  initialQuestion: { questionIndex: number; text: string } | null;
  answeredCount: number;
  poolCapReached: boolean;
  chapters: ChapterConfig[];
  emit: (event: string, data: unknown) => void;
}

interface QuestionState {
  questionIndex: number;
  text: string;
}

export function EmotionVote({
  socket,
  initialQuestion,
  answeredCount,
  poolCapReached,
  chapters,
  emit,
}: EmotionVoteProps) {
  const [currentQuestion, setCurrentQuestion] = useState<QuestionState | null>(initialQuestion);
  const [justAnswered, setJustAnswered] = useState(false);
  const [answeredChapterId, setAnsweredChapterId] = useState<string | null>(null);
  const [phonesDown, setPhonesDown] = useState(poolCapReached);

  // Listen for next question from server
  useEffect(() => {
    if (!socket) return;

    const handleQuestion = (data: { questionIndex: number; text: string }) => {
      setCurrentQuestion(data);
      setJustAnswered(false);
      setAnsweredChapterId(null);
    };

    const handleConfirmed = () => {
      // Answer confirmed — wait for next question or pool cap
    };

    socket.on('question', handleQuestion);
    socket.on('emotion_confirmed', handleConfirmed);

    return () => {
      socket.off('question', handleQuestion);
      socket.off('emotion_confirmed', handleConfirmed);
    };
  }, [socket]);

  // Update phones-down state from props
  useEffect(() => {
    if (poolCapReached) setPhonesDown(true);
  }, [poolCapReached]);

  const handleTap = useCallback((chapterId: string) => {
    if (!currentQuestion || justAnswered || phonesDown) return;
    setJustAnswered(true);
    setAnsweredChapterId(chapterId);
    emit('submit_emotion', {
      chapterId,
      questionIndex: currentQuestion.questionIndex,
    });
  }, [currentQuestion, justAnswered, phonesDown, emit]);

  // Phones down state
  if (phonesDown) {
    return (
      <div style={styles.container}>
        <div style={styles.phonesDown}>
          <div style={styles.phonesDownText}>Put your phone down.</div>
          <div style={styles.phonesDownSub}>Listen.</div>
        </div>
      </div>
    );
  }

  // Waiting for question
  if (!currentQuestion) {
    return (
      <div style={styles.container}>
        <div style={styles.waitingDot} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Question text */}
      <div style={{
        ...styles.questionText,
        opacity: justAnswered ? 0.3 : 1,
        transition: 'opacity 0.4s ease',
      }}>
        {currentQuestion.text}
      </div>

      {/* Chapter cards */}
      <div style={styles.cardsContainer}>
        {chapters.map((chapter) => {
          const identity = getChapterIdentity(chapter.id);
          const isSelected = answeredChapterId === chapter.id;
          return (
            <button
              key={chapter.id}
              onClick={() => handleTap(chapter.id)}
              disabled={justAnswered}
              style={{
                ...styles.card,
                borderColor: isSelected
                  ? identity.color
                  : 'rgba(255,255,255,0.15)',
                backgroundColor: isSelected
                  ? `${identity.color}33`
                  : 'rgba(255,255,255,0.04)',
                opacity: justAnswered && !isSelected ? 0.3 : 1,
                transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ ...styles.cardIcon, color: identity.color }}>
                {identity.icon}
              </div>
              <div style={{ ...styles.cardLabel, color: identity.color }}>
                {identity.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Subtle count */}
      {answeredCount > 0 && !justAnswered && (
        <div style={styles.countText}>
          {answeredCount} answered
        </div>
      )}

      {/* Answered feedback */}
      {justAnswered && (
        <div style={styles.answeredText}>
          ...
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
    boxSizing: 'border-box' as const,
    background: '#000',
  },
  questionText: {
    fontSize: '1.3rem',
    fontWeight: 400,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center' as const,
    lineHeight: 1.5,
    maxWidth: '320px',
    marginBottom: '40px',
    fontStyle: 'italic' as const,
  },
  cardsContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    width: '100%',
    maxWidth: '300px',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '18px 20px',
    borderRadius: '12px',
    border: '1.5px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.04)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation' as const,
    outline: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  cardIcon: {
    fontSize: '1.4rem',
    width: '28px',
    textAlign: 'center' as const,
  },
  cardLabel: {
    fontSize: '1.05rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  countText: {
    marginTop: '24px',
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: '0.08em',
  },
  answeredText: {
    marginTop: '24px',
    fontSize: '0.8rem',
    color: 'rgba(255,255,255,0.15)',
    letterSpacing: '0.15em',
  },
  phonesDown: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '16px',
  },
  phonesDownText: {
    fontSize: '1.2rem',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: '0.08em',
  },
  phonesDownSub: {
    fontSize: '0.8rem',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
  },
  waitingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
};

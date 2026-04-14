/**
 * EmotionVote (V3.4 — Theatrical Redesign)
 *
 * Audience component for the finale_vote phase.
 * Multi-stage flow: alarm + NPC intro → question + answers → fly animation → NPC outro (once) → loop.
 * Every user starts at 'intro' stage on mount (async per-user — late joiners get the full experience).
 *
 * Questions are iterated client-side from the full questions array (no server round-trips).
 * Only submit_emotion is sent to the server.
 */

'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChapterConfig, QuestionConfig } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

// ============================================================================
// Types
// ============================================================================

type VoteStage = 'intro' | 'question' | 'fly_animation' | 'npc_outro' | 'phones_down';

interface EmotionVoteProps {
  socket: Socket | null;
  questions: QuestionConfig[];
  initialAnsweredCount: number;
  poolCapReached: boolean;
  chapters: ChapterConfig[];
  npcIntro: string[];
  npcOutro: string | null;
  alarmColor: string;
  shuffleQuestions: boolean;
  userId: string;
  emit: (event: string, data: unknown) => void;
}

// ============================================================================
// Constants
// ============================================================================

const CHAR_INTERVAL_MS = 30;
const NPC_PAUSE_BETWEEN_MS = 800;
const MORPH_DURATION_MS = 500;
const FLY_DURATION_MS = 600;
const TOTAL_FLY_MS = MORPH_DURATION_MS + FLY_DURATION_MS;

// ============================================================================
// Deterministic shuffle (mirrors conductor/question-engine.ts)
// ============================================================================

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

function nextHash(hash: number): number {
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = (hash >>> 16) ^ hash;
  return hash | 0;
}

function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let hash = hashString(seed);
  for (let i = result.length - 1; i > 0; i--) {
    hash = nextHash(hash);
    const j = Math.abs(hash) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Component
// ============================================================================

export function EmotionVote({
  socket,
  questions,
  initialAnsweredCount,
  poolCapReached,
  chapters,
  npcIntro,
  npcOutro,
  alarmColor,
  shuffleQuestions,
  userId,
  emit,
}: EmotionVoteProps) {
  const [stage, setStage] = useState<VoteStage>(poolCapReached ? 'phones_down' : 'intro');
  const [questionIndex, setQuestionIndex] = useState(initialAnsweredCount);
  const [phonesDown, setPhonesDown] = useState(poolCapReached);
  const [hasShownOutro, setHasShownOutro] = useState(false);

  // Build the ordered questions list (shuffled or linear)
  const orderedQuestions = useMemo(() => {
    if (shuffleQuestions && userId) {
      return shuffleWithSeed(questions, userId);
    }
    return questions;
  }, [questions, shuffleQuestions, userId]);

  const currentQuestion = questionIndex < orderedQuestions.length ? orderedQuestions[questionIndex] : null;

  // NPC typewriter state
  const [npcDisplayText, setNpcDisplayText] = useState('');
  const [npcTypingDone, setNpcTypingDone] = useState(false);
  const npcTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fly animation state
  const [flyChapterId, setFlyChapterId] = useState<string | null>(null);
  const [flyPhase, setFlyPhase] = useState<'morph' | 'fly' | null>(null);
  const [orbPosition, setOrbPosition] = useState<{ x: number; y: number } | null>(null);
  const [orbColor, setOrbColor] = useState<string>('#fff');
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const iconRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Intro confirmation button visibility
  const [introConfirmVisible, setIntroConfirmVisible] = useState(false);

  // ============================================================================
  // Socket listeners
  // ============================================================================

  useEffect(() => {
    if (!socket) return;

    const handlePhonesDown = () => {
      setPhonesDown(true);
      setStage('phones_down');
    };

    socket.on('phones_down', handlePhonesDown);
    return () => { socket.off('phones_down', handlePhonesDown); };
  }, [socket]);

  // Update phones-down from props
  useEffect(() => {
    if (poolCapReached) {
      setPhonesDown(true);
      setStage('phones_down');
    }
  }, [poolCapReached]);

  // ============================================================================
  // NPC Typewriter
  // ============================================================================

  const typewriterPlay = useCallback((messages: string[], onComplete: () => void) => {
    if (messages.length === 0) {
      onComplete();
      return;
    }

    let msgIndex = 0;
    let charIndex = 0;

    const tick = () => {
      const currentMsg = messages[msgIndex];
      if (charIndex <= currentMsg.length) {
        setNpcDisplayText(currentMsg.slice(0, charIndex));
        charIndex++;
        npcTimerRef.current = setTimeout(tick, CHAR_INTERVAL_MS);
      } else {
        // Message complete — pause then move to next
        msgIndex++;
        if (msgIndex < messages.length) {
          charIndex = 0;
          npcTimerRef.current = setTimeout(tick, NPC_PAUSE_BETWEEN_MS);
        } else {
          setNpcTypingDone(true);
          onComplete();
        }
      }
    };

    setNpcDisplayText('');
    setNpcTypingDone(false);
    npcTimerRef.current = setTimeout(tick, 300);

    return () => {
      if (npcTimerRef.current) clearTimeout(npcTimerRef.current);
    };
  }, []);

  // ============================================================================
  // Intro stage: alarm + NPC typewriter
  // ============================================================================

  useEffect(() => {
    if (stage !== 'intro') return;
    const cleanup = typewriterPlay(npcIntro, () => {
      setIntroConfirmVisible(true);
    });
    return cleanup;
  }, [stage, npcIntro, typewriterPlay]);

  const handleIntroConfirm = useCallback(() => {
    setStage('question');
    setNpcDisplayText('');
    setNpcTypingDone(false);
    setIntroConfirmVisible(false);
  }, []);

  // ============================================================================
  // Answer tap handler
  // ============================================================================

  const handleAnswerTap = useCallback((chapterId: string) => {
    if (!currentQuestion || stage !== 'question' || phonesDown || flyChapterId) return;

    // Capture card center for the orb overlay
    const cardEl = cardRefs.current.get(chapterId);
    const identity = getChapterIdentity(chapterId);
    setOrbColor(identity.color);

    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      setOrbPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      setOrbPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }

    // Store values for the timeout closures
    const tappedQuestionIndex = questionIndex;

    setFlyChapterId(chapterId);
    setFlyPhase('morph');

    // Phase 2: morph complete → fly upward
    setTimeout(() => {
      setFlyPhase('fly');
    }, MORPH_DURATION_MS);

    // Phase 3: fly complete → advance question, emit to server, transition stage
    setTimeout(() => {
      // Send vote to server after animation finishes (triggers projector fly-in)
      emit('submit_emotion', {
        chapterId,
        questionIndex: tappedQuestionIndex,
      });

      // Advance question index now that animation is done
      setQuestionIndex(prev => prev + 1);
      setFlyChapterId(null);
      setFlyPhase(null);
      setOrbPosition(null);

      if (phonesDown) {
        setStage('phones_down');
      } else if (!hasShownOutro) {
        setHasShownOutro(true);
        setStage('npc_outro');
      } else {
        setStage('question');
      }
    }, TOTAL_FLY_MS);
  }, [currentQuestion, stage, phonesDown, flyChapterId, emit, questionIndex, hasShownOutro]);

  // ============================================================================
  // NPC outro stage (shown once after first answer)
  // ============================================================================

  useEffect(() => {
    if (stage !== 'npc_outro') return;
    const outroMessages = npcOutro ? [npcOutro] : [];
    const cleanup = typewriterPlay(outroMessages, () => {
      // Typing done — continue button will show
    });
    return cleanup;
  }, [stage, npcOutro, typewriterPlay]);

  const handleContinue = useCallback(() => {
    setNpcDisplayText('');
    setNpcTypingDone(false);

    if (phonesDown || questionIndex >= orderedQuestions.length) {
      setStage('phones_down');
      return;
    }

    setStage('question');
  }, [phonesDown, questionIndex, orderedQuestions.length]);

  // ============================================================================
  // Render helpers
  // ============================================================================

  const renderAlarmOverlay = () => (
    <div style={styles.alarmContainer} aria-hidden>
      <div style={{ ...styles.alarmEdge, ...styles.alarmTop, background: `linear-gradient(to bottom, ${alarmColor}88, transparent)` }} />
      <div style={{ ...styles.alarmEdge, ...styles.alarmBottom, background: `linear-gradient(to top, ${alarmColor}88, transparent)` }} />
      <div style={{ ...styles.alarmEdge, ...styles.alarmLeft, background: `linear-gradient(to right, ${alarmColor}88, transparent)` }} />
      <div style={{ ...styles.alarmEdge, ...styles.alarmRight, background: `linear-gradient(to left, ${alarmColor}88, transparent)` }} />
    </div>
  );

  const renderNpc = () => (
    <div style={styles.npcContainer}>
      <span style={styles.npcText}>
        {npcDisplayText}
        {!npcTypingDone && <span style={styles.npcCursor}>|</span>}
      </span>
    </div>
  );

  // Orb overlay — appears at card center, gains glow, then flies up
  const renderOrbOverlay = () => {
    if (!orbPosition || !flyPhase) return null;

    const isMorphing = flyPhase === 'morph';
    const isFlying = flyPhase === 'fly';

    return (
      <div
        style={{
          position: 'fixed',
          left: orbPosition.x,
          top: orbPosition.y,
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: orbColor,
          // translate(-50%,-50%) keeps it centered on the coordinate
          transform: 'translate(-50%, -50%)',
          boxShadow: isMorphing
            ? `0 0 0px ${orbColor}00`
            : `0 0 24px ${orbColor}aa, 0 0 48px ${orbColor}44`,
          transition: isMorphing
            ? `box-shadow ${MORPH_DURATION_MS * 0.6}ms ease ${MORPH_DURATION_MS * 0.4}ms`
            : 'none',
          animation: isFlying ? `orbFlyUp ${FLY_DURATION_MS}ms ease-in forwards` : undefined,
          pointerEvents: 'none',
          zIndex: 1000,
        }}
      />
    );
  };

  const renderAnswerCards = () => {
    if (!currentQuestion) {
      // No more questions — treat as phones down
      return (
        <div style={styles.phonesDown}>
          <div style={styles.phonesDownText}>Put your phone down.</div>
          <div style={styles.phonesDownSub}>Listen.</div>
        </div>
      );
    }

    const answers = currentQuestion.answers;
    const isAnimating = !!flyChapterId;

    return (
      <>
        {/* Question text — word-by-word blur reveal, fades out when animating */}
        <div style={{
          ...styles.questionText,
          opacity: isAnimating ? 0 : 1,
          transition: 'opacity 0.35s ease',
        }}>
          <WordReveal key={questionIndex} text={currentQuestion.text} />
        </div>

        <div style={styles.cardsContainer}>
          {chapters.map((chapter, cardIndex) => {
            const identity = getChapterIdentity(chapter.id);
            const answerLabel = answers?.find(a => a.chapterId === chapter.id)?.label ?? identity.label;
            const isTapped = flyChapterId === chapter.id;
            const isOther = isAnimating && !isTapped;

            // Stagger cards after the word reveal finishes
            const wordCount = currentQuestion.text.split(/\s+/).length;
            const textDoneMs = (wordCount - 1) * WORD_STAGGER_MS + WORD_ANIM_MS;
            const cardDelayMs = textDoneMs + cardIndex * 500;

            return (
              <button
                key={`${questionIndex}-${chapter.id}`}
                ref={(el) => { if (el) cardRefs.current.set(chapter.id, el); }}
                onClick={() => handleAnswerTap(chapter.id)}
                disabled={isAnimating}
                style={{
                  ...styles.card,
                  borderColor: `${identity.color}44`,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  // Entrance animation (unless mid-tap animation)
                  ...(!isTapped && !isOther ? {
                    animation: `cardBlurIn 1000ms cubic-bezier(0.23, 1, 0.32, 1) ${cardDelayMs}ms both`,
                  } : {}),
                  // Tapped card: border shrinks inward and fades
                  ...(isTapped ? {
                    borderColor: identity.color,
                    transform: 'scale(0.3)',
                    opacity: 0,
                    borderRadius: '50%',
                    transition: `all ${MORPH_DURATION_MS}ms ease-in`,
                  } : {}),
                  // Other cards fade out
                  ...(isOther ? {
                    opacity: 0,
                    transition: 'opacity 0.3s ease',
                  } : {}),
                }}
              >
                {/* Icon — fades out (orb overlay replaces it) */}
                <div
                  ref={(el) => { if (el) iconRefs.current.set(chapter.id, el); }}
                  style={{
                    ...styles.cardIcon,
                    color: identity.color,
                    opacity: isTapped ? 0 : 1,
                    transition: `opacity ${MORPH_DURATION_MS * 0.3}ms ease`,
                  }}
                >
                  {identity.icon}
                </div>
                {/* Label — fades out */}
                <div style={{
                  ...styles.cardLabel,
                  color: identity.color,
                  opacity: isTapped ? 0 : 1,
                  transition: `opacity ${MORPH_DURATION_MS * 0.3}ms ease`,
                }}>
                  {answerLabel}
                </div>
              </button>
            );
          })}
        </div>

        {/* Orb overlay — appears at icon position, glows, flies up */}
        {renderOrbOverlay()}
      </>
    );
  };

  // ============================================================================
  // Stage renders
  // ============================================================================

  if (stage === 'phones_down') {
    return (
      <div style={styles.container}>
        <div style={styles.phonesDown}>
          <div style={styles.phonesDownText}>Put your phone down.</div>
          <div style={styles.phonesDownSub}>Listen.</div>
        </div>
      </div>
    );
  }

  if (stage === 'intro') {
    return (
      <div style={styles.container}>
        {renderAlarmOverlay()}
        <div style={styles.introContent}>
          {renderNpc()}
          {introConfirmVisible && (
            <button
              onClick={handleIntroConfirm}
              style={{
                ...styles.confirmButton,
                animation: 'fadeIn 0.6s ease forwards',
              }}
            >
              I understand
            </button>
          )}
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  if (stage === 'question') {
    return (
      <div style={styles.container}>
        {renderAnswerCards()}
        <style>{keyframes}</style>
      </div>
    );
  }

  if (stage === 'npc_outro') {
    return (
      <div style={styles.container}>
        <div style={styles.outroContent}>
          {renderNpc()}
          {npcTypingDone && (
            <button
              onClick={handleContinue}
              style={{
                ...styles.continueButton,
                animation: 'fadeIn 0.6s ease forwards',
              }}
            >
              Continue
            </button>
          )}
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  return null;
}

// ============================================================================
// Word-by-word blur reveal
// ============================================================================

const WORD_STAGGER_MS = 120;
const WORD_ANIM_MS = 500;

function WordReveal({ text }: { text: string }) {
  const words = text.split(/\s+/);
  return (
    <>
      {words.map((word, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            animation: `wordBlurIn ${WORD_ANIM_MS}ms cubic-bezier(0.23, 1, 0.32, 1) ${i * WORD_STAGGER_MS}ms both`,
            marginRight: '0.3em',
          }}
        >
          {word}
        </span>
      ))}
    </>
  );
}

// ============================================================================
// CSS Keyframes
// ============================================================================

const keyframes = `
  @keyframes heartbeat {
    0% { opacity: 0; }
    10% { opacity: 0.9; }
    20% { opacity: 0.15; }
    30% { opacity: 0.7; }
    40% { opacity: 0; }
    100% { opacity: 0; }
  }
  @keyframes cursorBlink {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }
  @keyframes orbFlyUp {
    0% {
      transform: translate(-50%, -50%) translateY(0) scale(1);
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) translateY(-100vh) scale(0.6);
      opacity: 0.5;
    }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes cardBlurIn {
    0% {
      opacity: 0;
      filter: blur(6px);
      -webkit-filter: blur(6px);
      transform: translateX(-8px);
    }
    100% {
      opacity: 1;
      filter: blur(0px);
      -webkit-filter: blur(0px);
      transform: translateX(0);
    }
  }
  @keyframes wordBlurIn {
    0% {
      opacity: 0;
      filter: blur(8px);
      -webkit-filter: blur(8px);
      transform: translateY(4px);
    }
    100% {
      opacity: 1;
      filter: blur(0px);
      -webkit-filter: blur(0px);
      transform: translateY(0);
    }
  }
`;

// ============================================================================
// Styles
// ============================================================================

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
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },

  // Alarm overlay — heartbeat pulse
  alarmContainer: {
    position: 'fixed' as const,
    inset: 0,
    pointerEvents: 'none' as const,
    zIndex: 10,
  },
  alarmEdge: {
    position: 'absolute' as const,
    animation: 'heartbeat 1.8s ease-in-out infinite',
  },
  alarmTop: {
    top: 0,
    left: 0,
    right: 0,
    height: '80px',
  },
  alarmBottom: {
    bottom: 0,
    left: 0,
    right: 0,
    height: '80px',
  },
  alarmLeft: {
    top: 0,
    bottom: 0,
    left: 0,
    width: '40px',
  },
  alarmRight: {
    top: 0,
    bottom: 0,
    right: 0,
    width: '40px',
  },

  // Intro stage
  introContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '32px',
    zIndex: 20,
  },

  // NPC
  npcContainer: {
    maxWidth: '320px',
    textAlign: 'center' as const,
    minHeight: '3em',
  },
  npcText: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '0.85rem',
    color: '#4ade80',
    lineHeight: 1.6,
    letterSpacing: '0.02em',
  },
  npcCursor: {
    display: 'inline-block',
    animation: 'cursorBlink 1s step-end infinite',
    marginLeft: '2px',
  },

  // Confirm / Continue buttons
  confirmButton: {
    padding: '14px 32px',
    borderRadius: '8px',
    border: '1px solid rgba(74, 222, 128, 0.3)',
    background: 'rgba(74, 222, 128, 0.08)',
    color: '#4ade80',
    fontSize: '0.9rem',
    fontWeight: 600 as const,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation' as const,
    outline: 'none',
    fontFamily: '"Courier New", Courier, monospace',
    opacity: 0,
  } as React.CSSProperties,

  continueButton: {
    padding: '14px 32px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'rgba(255, 255, 255, 0.04)',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.85rem',
    fontWeight: 500 as const,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation' as const,
    outline: 'none',
    fontFamily: 'inherit',
    opacity: 0,
  } as React.CSSProperties,

  // Question text
  questionText: {
    fontSize: '1.5rem',
    fontWeight: 300,
    fontFamily: "'Cormorant Garamond', serif",
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center' as const,
    lineHeight: 1.5,
    maxWidth: '320px',
    marginBottom: '40px',
    fontStyle: 'italic' as const,
  },

  // Answer cards
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
    textAlign: 'left' as const,
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  cardIcon: {
    fontSize: '1.4rem',
    width: '28px',
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  cardLabel: {
    fontSize: '0.95rem',
    fontWeight: 500,
    lineHeight: 1.4,
  },

  // Outro stage
  outroContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '32px',
  },

  // Phones down
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
};

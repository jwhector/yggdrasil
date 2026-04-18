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
import type { ChapterConfig, QuestionConfig } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

// ============================================================================
// Types
// ============================================================================

type VoteStage = 'intro' | 'question' | 'fly_animation' | 'done';

interface EmotionVoteProps {
  questions: QuestionConfig[];
  initialAnsweredCount: number;
  chapters: ChapterConfig[];
  npcIntro: string[];
  alarmColor: string;
  shuffleQuestions: boolean;
  userId: string;
  emit: (event: string, data: unknown) => void;
  onOrbLanded?: (chapterId: string, position: { x: number; y: number }) => void;
}

// ============================================================================
// Constants
// ============================================================================

const CHAR_INTERVAL_MS = 30;
const NPC_PAUSE_BETWEEN_MS = 800;
const COLLAPSE_DURATION_MS = 300;   // Card shell fade duration
const TOTAL_FLY_MS = 1100;          // Total spiral-up animation
// Keep old name for morph phase timing in handleAnswerTap
const MORPH_DURATION_MS = COLLAPSE_DURATION_MS;

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
  questions,
  initialAnsweredCount,
  chapters,
  npcIntro,
  alarmColor,
  shuffleQuestions,
  userId,
  emit,
  onOrbLanded,
}: EmotionVoteProps) {
  const allDone = initialAnsweredCount >= questions.length;
  const [stage, setStage] = useState<VoteStage>(allDone ? 'done' : 'intro');
  const [questionIndex, setQuestionIndex] = useState(initialAnsweredCount);

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
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Intro confirmation button visibility
  const [introConfirmVisible, setIntroConfirmVisible] = useState(false);

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
    if (!currentQuestion || stage !== 'question' || flyChapterId) return;

    const tappedQuestionIndex = questionIndex;

    // Pre-compute landing position for the persistent orb
    const landingX = window.innerWidth * (0.2 + Math.random() * 0.6);
    const landingY = window.innerHeight * (0.08 + Math.random() * 0.17);

    setFlyChapterId(chapterId);

    // After collapse + fly complete → spawn persistent orb, advance question, emit to server
    setTimeout(() => {
      onOrbLanded?.(chapterId, { x: landingX, y: landingY });

      emit('submit_emotion', {
        chapterId,
        questionIndex: tappedQuestionIndex,
      });

      const nextIndex = questionIndex + 1;
      setQuestionIndex(nextIndex);
      setFlyChapterId(null);

      // If more questions remain, show the next one; otherwise done
      if (nextIndex >= orderedQuestions.length) {
        setStage('done');
      } else {
        setStage('question');
      }
    }, TOTAL_FLY_MS);
  }, [currentQuestion, stage, flyChapterId, emit, questionIndex, orderedQuestions.length, onOrbLanded]);

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

            const wordCount = currentQuestion.text.split(/\s+/).length;
            const textDoneMs = (wordCount - 1) * WORD_STAGGER_MS + WORD_ANIM_MS;
            const cardDelayMs = textDoneMs + cardIndex * 500;

            return (
              <OrbCard
                key={`${questionIndex}-${chapter.id}`}
                chapterId={chapter.id}
                label={answerLabel}
                color={identity.color}
                index={cardIndex}
                isTapped={isTapped}
                isOther={isOther}
                entranceDelay={cardDelayMs}
                onTap={() => handleAnswerTap(chapter.id)}
                cardRef={(el) => { if (el) cardRefs.current.set(chapter.id, el); }}
              />
            );
          })}
        </div>

      </>
    );
  };

  // ============================================================================
  // Stage renders
  // ============================================================================

  if (stage === 'done') {
    return (
      <div style={styles.container}>
        <div style={styles.questionText}>
          <WordReveal text="Your intentions have been heard." />
        </div>
        <style>{keyframes}</style>
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

  return null;
}

// ============================================================================
// Orbital orb card
// ============================================================================

function OrbCard({
  chapterId,
  label,
  color,
  index,
  isTapped,
  isOther,
  entranceDelay,
  onTap,
  cardRef,
}: {
  chapterId: string;
  label: string;
  color: string;
  index: number;
  isTapped: boolean;
  isOther: boolean;
  entranceDelay: number;
  onTap: () => void;
  cardRef: (el: HTMLButtonElement | null) => void;
}) {
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orbContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const angleRef = useRef(index * 2.1);
  const collapseStartRef = useRef<number | null>(null);

  // Per-card orbit variations
  const orbConfigs = [
    { centerLeft: '65%', centerTop: '45%', radiusX: 55, tilt: 0.35, speed: 0.007 },
    { centerLeft: '55%', centerTop: '55%', radiusX: 65, tilt: 0.25, speed: 0.005 },
    { centerLeft: '70%', centerTop: '50%', radiusX: 50, tilt: 0.4,  speed: 0.009 },
  ];
  const orbCfg = orbConfigs[index % orbConfigs.length];

  // Start collapse timer when tapped
  useEffect(() => {
    if (isTapped && collapseStartRef.current === null) {
      collapseStartRef.current = performance.now();
    }
    if (!isTapped) {
      collapseStartRef.current = null;
    }
  }, [isTapped]);

  useEffect(() => {
    const speed = orbCfg.speed;
    const baseRadius = orbCfg.radiusX;
    const tilt = orbCfg.tilt;

    const animate = () => {
      const orb1 = orb1Ref.current;
      const orb2 = orb2Ref.current;
      const container = orbContainerRef.current;
      if (!orb1 || !orb2) return;

      const now = performance.now();

      // Overall progress through the entire animation (0 → 1 over TOTAL_FLY_MS)
      let t = 0;
      if (collapseStartRef.current !== null) {
        t = Math.min((now - collapseStartRef.current) / TOTAL_FLY_MS, 1);
      }

      // Ease curve: slow start, accelerating
      const ease = t * t;

      // Normal speed when idle, fast spin on tap accelerating further
      angleRef.current += t > 0 ? speed * (5 + ease * 25) : speed;
      const a = angleRef.current;
      // Radius holds for the first ~30%, then collapses with acceleration
      const radiusT = Math.max(0, (t - 0.15) / 0.85);
      const radiusEase = radiusT * radiusT;
      const radiusX = baseRadius * (1 - radiusEase);

      // Blur stays soft throughout (14 → 6)
      const blur1 = 14 - ease * 8;
      const blur2 = 12 - ease * 6;

      // Second orb fades into first as they merge
      const orb2Fade = 1 - ease * 0.9;
      const mergeScale = 1 + ease * 0.3;

      const x1 = Math.cos(a) * radiusX;
      const depth1 = Math.sin(a);
      const y1 = depth1 * radiusX * tilt;
      const scale1 = (1 + depth1 * 0.4) * mergeScale;
      const opacity1 = Math.min(0.3 + depth1 * 0.2 + ease * 0.7, 1);

      const x2 = Math.cos(a + Math.PI) * radiusX;
      const depth2 = Math.sin(a + Math.PI);
      const y2 = depth2 * radiusX * tilt;
      const scale2 = (1 + depth2 * 0.4) * mergeScale * orb2Fade;
      const opacity2 = Math.min((0.3 + depth2 * 0.2) * orb2Fade, 1);

      // Upward movement starts immediately but slowly, accelerates with the spiral
      if (t > 0 && container) {
        const flyY = -window.innerHeight * ease * 1.2;
        const flyOpacity = 1 - t * 0.5;
        container.style.transform = `translateY(${flyY}px)`;
        container.style.opacity = String(flyOpacity);
      }

      orb1.style.transform = `translate(${x1}px, ${y1}px) scale(${scale1})`;
      orb1.style.opacity = String(opacity1);
      orb1.style.filter = `blur(${blur1}px)`;
      orb1.style.zIndex = depth1 > 0 ? '3' : '1';

      orb2.style.transform = `translate(${x2}px, ${y2}px) scale(${scale2})`;
      orb2.style.opacity = String(opacity2);
      orb2.style.filter = `blur(${blur2}px)`;
      orb2.style.zIndex = depth2 > 0 ? '3' : '1';

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [index, isTapped, orbCfg.speed, orbCfg.radiusX, orbCfg.tilt]);

  const accent = color;

  return (
    <button
      ref={cardRef}
      onClick={onTap}
      disabled={isTapped || isOther}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 300,
        height: 90,
        borderRadius: 12,
        background: '#111',
        border: `1px solid ${accent}44`,
        overflow: isTapped ? 'visible' : 'hidden',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation' as const,
        outline: 'none',
        // Entrance animation
        ...(!isTapped && !isOther ? {
          animation: `cardBlurIn 1000ms cubic-bezier(0.23, 1, 0.32, 1) ${entranceDelay}ms both`,
        } : {}),
        // Tapped: card shell fades away, orbs collapse inside
        ...(isTapped ? {
          borderColor: 'transparent',
          background: 'transparent',
          transition: `border-color ${COLLAPSE_DURATION_MS * 0.6}ms ease, background ${COLLAPSE_DURATION_MS * 0.6}ms ease`,
        } : {}),
        // Others fade out
        ...(isOther ? {
          opacity: 0,
          transition: 'opacity 0.3s ease',
        } : {}),
      }}
    >
      {/* Orbital orb container — per-card positioning */}
      <div
        ref={orbContainerRef}
        style={{
          position: 'absolute',
          top: orbCfg.centerTop,
          left: orbCfg.centerLeft,
          width: 0,
          height: 0,
        }}
      >
        <div
          ref={orb1Ref}
          style={{
            position: 'absolute',
            width: 40,
            height: 40,
            marginLeft: -20,
            marginTop: -20,
            borderRadius: '50%',
            background: `radial-gradient(circle at 40% 40%, ${accent}cc, ${accent}55)`,
            filter: 'blur(14px)',
            willChange: 'transform, opacity',
          }}
        />
        <div
          ref={orb2Ref}
          style={{
            position: 'absolute',
            width: 30,
            height: 30,
            marginLeft: -15,
            marginTop: -15,
            borderRadius: '50%',
            background: `radial-gradient(circle at 40% 40%, ${accent}aa, ${accent}33)`,
            filter: 'blur(12px)',
            willChange: 'transform, opacity',
          }}
        />
      </div>

      {/* Text content */}
      <div style={{
        position: 'relative',
        zIndex: 4,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 20px',
        gap: 4,
        pointerEvents: 'none',
        opacity: isTapped ? 0 : 1,
        transition: `opacity ${MORPH_DURATION_MS * 0.3}ms ease`,
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '1.05rem',
          fontWeight: 300,
          color: '#e8e4df',
          lineHeight: 1.4,
        }}>
          {label}
        </div>
      </div>
    </button>
  );
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
    gap: '14px',
    width: '100%',
    maxWidth: '300px',
    alignItems: 'center',
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

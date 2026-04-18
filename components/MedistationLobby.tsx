'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { MedistationOnboarding } from './MedistationOnboarding';
import type { OnboardingConfig } from '@/conductor/types';

interface Props {
  onboardingConfig?: OnboardingConfig;
}

export function MedistationLobby({ onboardingConfig }: Props) {
  const [fontsReady, setFontsReady] = useState(false);
  const [view, setView] = useState<'animation' | 'exiting' | 'onboarding'>('animation');
  // Capture config on mount — static config that must not cause callback identity changes
  // when state_sync delivers a new object reference.
  const onboardingRef = useRef(onboardingConfig);
  const stageRef = useRef<HTMLDivElement>(null);
  const staircaseRef = useRef<HTMLDivElement>(null);
  const line1Ref = useRef<HTMLDivElement>(null);
  const line2Ref = useRef<HTMLDivElement>(null);
  const line3Ref = useRef<HTMLDivElement>(null);
  const fallingSRef = useRef<HTMLSpanElement>(null);
  const theURef = useRef<HTMLSpanElement>(null);
  const prefixRef = useRef<HTMLSpanElement>(null);
  const suffixRef = useRef<HTMLSpanElement>(null);
  const sTrackRef = useRef<HTMLSpanElement>(null);
  const dockedSRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const whereBtnRef = useRef<HTMLButtonElement>(null);

  // Align staircase so 's' sits above the gap — shared by both run and showFinalState
  const alignStaircase = useCallback(() => {
    const staircase = staircaseRef.current;
    const fallingS = fallingSRef.current;
    const prefix = prefixRef.current;
    if (!staircase || !fallingS || !prefix) return;

    const sRect = fallingS.getBoundingClientRect();
    const sCenterX = sRect.left + sRect.width / 2;
    const prefixRect = prefix.getBoundingClientRect();
    const gapCenterX = prefixRect.right;
    staircase.style.transform = `translateX(${gapCenterX - sCenterX}px)`;
  }, []);

  // Show the post-animation resting state without replaying (used when returning from onboarding)
  const showFinalState = useCallback(() => {
    const stage = stageRef.current;
    const staircase = staircaseRef.current;
    const line1 = line1Ref.current;
    const line2 = line2Ref.current;
    const line3 = line3Ref.current;
    const fallingS = fallingSRef.current;
    const theU = theURef.current;
    const prefix = prefixRef.current;
    const suffix = suffixRef.current;
    const sTrack = sTrackRef.current;
    const dockedS = dockedSRef.current;
    const subtitle = subtitleRef.current;
    const dot = dotRef.current;
    const ambient = ambientRef.current;
    const whereBtn = whereBtnRef.current;

    if (!stage || !staircase || !line1 || !line2 || !line3 || !fallingS || !theU || !prefix || !suffix || !sTrack || !dockedS || !subtitle || !dot || !ambient) return;

    // Staircase visible
    line1.style.opacity = '1'; line1.style.transform = 'none'; line1.style.filter = 'none';
    line2.style.opacity = '1'; line2.style.transform = 'none'; line2.style.filter = 'none';
    line3.style.opacity = '1'; line3.style.transform = 'none'; line3.style.filter = 'none';
    line1.classList.add('ms-show');
    line2.classList.add('ms-show');
    line3.classList.add('ms-show');

    // Falling S hidden, U shifted
    fallingS.style.opacity = '0';
    fallingS.style.animation = 'none';
    const sWidth = fallingS.getBoundingClientRect().width;
    theU.style.transform = `translateX(${sWidth * 0.5}px)`;

    // medi + tation visible
    prefix.style.opacity = '1'; prefix.style.filter = 'none';
    suffix.style.opacity = '1'; suffix.style.filter = 'none';
    prefix.classList.add('ms-show');
    suffix.classList.add('ms-show');

    // Gap open, docked S visible
    dockedS.style.opacity = '';
    const dWidth = dockedS.getBoundingClientRect().width;
    sTrack.style.transition = 'none';
    sTrack.style.width = dWidth + 'px';
    dockedS.classList.add('ms-visible');

    // Subtitle, dot, ambient
    subtitle.classList.add('ms-visible');
    dot.classList.add('ms-visible');
    ambient.classList.add('ms-visible');

    // Align staircase
    alignStaircase();

    // Where button
    if (whereBtn && onboardingRef.current) {
      whereBtn.classList.add('ms-btn-visible');
    }
  }, [alignStaircase]);

  const runAnimation = useCallback(() => {
    const stage = stageRef.current;
    const staircase = staircaseRef.current;
    const line1 = line1Ref.current;
    const line2 = line2Ref.current;
    const line3 = line3Ref.current;
    const fallingS = fallingSRef.current;
    const theU = theURef.current;
    const prefix = prefixRef.current;
    const suffix = suffixRef.current;
    const sTrack = sTrackRef.current;
    const dockedS = dockedSRef.current;
    const subtitle = subtitleRef.current;
    const dot = dotRef.current;
    const ambient = ambientRef.current;
    const whereBtn = whereBtnRef.current;

    if (!stage || !staircase || !line1 || !line2 || !line3 || !fallingS || !theU || !prefix || !suffix || !sTrack || !dockedS || !subtitle || !dot || !ambient) return;

    // Reset
    stage.classList.remove('ms-shake');
    [line1, line2, line3].forEach(l => { l.classList.remove('ms-show'); });
    line1.className = 'ms-stair-line ms-line-1';
    line2.className = 'ms-stair-line ms-line-2';
    line3.className = 'ms-stair-line ms-line-3';
    fallingS.className = 'ms-falling-s';
    fallingS.style.transition = '';
    fallingS.style.transform = '';
    fallingS.style.opacity = '';
    fallingS.style.color = '';
    fallingS.style.animation = '';
    theU.style.transform = '';
    prefix.className = 'ms-prefix';
    suffix.className = 'ms-suffix';
    prefix.style.opacity = '';
    suffix.style.opacity = '';
    dockedS.className = 'ms-docked-s';
    sTrack.style.transition = 'none';
    sTrack.style.width = '0';
    staircase.style.transform = '';
    subtitle.classList.remove('ms-visible');
    dot.classList.remove('ms-visible');
    ambient.classList.remove('ms-visible');
    if (whereBtn) whereBtn.classList.remove('ms-btn-visible');

    void stage.offsetHeight;

    // Measure for alignment
    line1.style.opacity = '0'; line1.style.transform = 'none';
    line2.style.opacity = '0'; line2.style.transform = 'none';
    line3.style.opacity = '0'; line3.style.transform = 'none';
    prefix.style.opacity = '0'; prefix.style.filter = 'none';
    suffix.style.opacity = '0'; suffix.style.filter = 'none';

    void stage.offsetHeight;

    alignStaircase();

    // Reset opacity for animation
    line1.style.opacity = ''; line1.style.transform = '';
    line2.style.opacity = ''; line2.style.transform = '';
    line3.style.opacity = ''; line3.style.transform = '';
    prefix.style.opacity = ''; prefix.style.filter = '';
    suffix.style.opacity = ''; suffix.style.filter = '';

    void stage.offsetHeight;

    // Timeline
    const STAIR_1 = 400;
    const STAIR_GAP = 500;
    const MEDITATION_AT = STAIR_1 + STAIR_GAP * 3 + 200;
    const UNHINGE_AT = MEDITATION_AT + 1600;
    const UNHINGE_DUR = 800;
    const GAP_OPEN_AT = UNHINGE_AT + UNHINGE_DUR + 100;
    const GAP_OPEN_DUR = 350;
    const FALL_AT = GAP_OPEN_AT + GAP_OPEN_DUR * 0.5;
    const FALL_DUR = 300;

    // Phase 1: Staircase
    setTimeout(() => line1.classList.add('ms-show'), STAIR_1);
    setTimeout(() => line2.classList.add('ms-show'), STAIR_1 + STAIR_GAP);
    setTimeout(() => line3.classList.add('ms-show'), STAIR_1 + STAIR_GAP * 2);

    // Phase 2: "meditation" fades in
    setTimeout(() => {
      prefix.classList.add('ms-show');
      suffix.classList.add('ms-show');
    }, MEDITATION_AT);

    // Phase 3: The 's' unhinges
    setTimeout(() => {
      fallingS.classList.add('ms-unhinging');
    }, UNHINGE_AT);

    // Phase 4: Gap opens
    setTimeout(() => {
      dockedS.style.opacity = '0.01';
      const sWidth = dockedS.getBoundingClientRect().width;
      dockedS.style.opacity = '0';
      sTrack.style.transition = `width ${GAP_OPEN_DUR}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      sTrack.style.width = sWidth + 'px';
    }, GAP_OPEN_AT);

    // Phase 5: S falls into the gap
    setTimeout(() => {
      const fromRect = fallingS.getBoundingClientRect();
      const gapEl = sTrack.getBoundingClientRect();
      const prefRect = prefix.getBoundingClientRect();
      const targetX = gapEl.left + gapEl.width / 2 - (fromRect.left + fromRect.width / 2);
      const targetY = prefRect.bottom - fromRect.bottom;
      const sWidth = fromRect.width;

      theU.style.transform = `translateX(${sWidth * 0.5}px)`;
      fallingS.style.animation = 'none';
      fallingS.style.transform = 'rotate(10deg) translateY(4px)';
      fallingS.style.color = '#d4a574';

      void fallingS.offsetHeight;

      fallingS.style.transition = `transform ${FALL_DUR}ms cubic-bezier(0.4, 0, 1, 1), opacity ${FALL_DUR * 0.8}ms ease`;
      fallingS.style.transform = `translate(${targetX}px, ${targetY}px) rotate(0deg) scale(0.5)`;
      fallingS.style.opacity = '0.3';

      // Impact
      setTimeout(() => {
        fallingS.style.opacity = '0';
        dockedS.style.opacity = '';
        dockedS.classList.add('ms-visible');
        dockedS.classList.add('ms-impact');

        prefix.style.opacity = '1';
        suffix.style.opacity = '1';

        stage.classList.add('ms-shake');
        prefix.classList.add('ms-jostle');
        suffix.classList.add('ms-jostle');

        setTimeout(() => subtitle.classList.add('ms-visible'), 700);
        setTimeout(() => dot.classList.add('ms-visible'), 1300);
        setTimeout(() => ambient.classList.add('ms-visible'), 400);
        // Show "Where am I?" button after afterglow
        if (whereBtn && onboardingRef.current) {
          setTimeout(() => whereBtn.classList.add('ms-btn-visible'), 2200);
        }
      }, FALL_DUR - 20);
    }, FALL_AT);
  }, [alignStaircase]);

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        setFontsReady(true);
        runAnimation();
      }
    });
    return () => { cancelled = true; };
  }, [runAnimation]);

  const handleWhereClick = () => {
    setView('exiting');
    // After fade-out completes, switch to onboarding
    setTimeout(() => setView('onboarding'), 500);
  };

  const handleBack = () => {
    setView('animation');
    // Show final state immediately on next frame
    requestAnimationFrame(() => showFinalState());
  };

  return (
    <>
      <style>{styles}</style>
      <div
        className="ms-stage"
        ref={stageRef}
        style={{
          visibility: fontsReady ? 'visible' : 'hidden',
          opacity: view === 'exiting' ? 0 : view === 'onboarding' ? 0 : 1,
          transform: view === 'exiting' ? 'translateY(-15px)' : 'translateY(0)',
          transition: 'opacity 0.5s ease, transform 0.5s ease',
          pointerEvents: view === 'onboarding' ? 'none' : 'auto',
          position: view === 'onboarding' ? 'absolute' : 'relative',
        }}
      >
        <div className="ms-ambient" ref={ambientRef} />

        <div className="ms-staircase" ref={staircaseRef}>
          <div className="ms-stair-line ms-line-1" ref={line1Ref}>Join</div>
          <div className="ms-stair-line ms-line-2" ref={line2Ref}>
            <span className="ms-the-u" ref={theURef}>U</span>
            <span className="ms-falling-s" ref={fallingSRef}>s</span>
          </div>
          <div className="ms-stair-line ms-line-3" ref={line3Ref}>In</div>
        </div>

        <div className="ms-word-row">
          <span className="ms-prefix" ref={prefixRef}>medi</span>
          <span className="ms-s-track" ref={sTrackRef}>
            <span className="ms-docked-s" ref={dockedSRef}>s</span>
          </span>
          <span className="ms-suffix" ref={suffixRef}>tation</span>
        </div>

        <div className="ms-subtitle" ref={subtitleRef}>a live experience</div>
        <div className="ms-dot" ref={dotRef} />

        {onboardingConfig && (
          <button
            className="ms-where-btn"
            ref={whereBtnRef}
            onClick={handleWhereClick}
          >
            {onboardingConfig.buttonLabel}
          </button>
        )}
      </div>

      {view === 'onboarding' && onboardingConfig && (
        <MedistationOnboarding config={onboardingConfig} onBack={handleBack} />
      )}
    </>
  );
}

const styles = `
  .ms-stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .ms-staircase {
    display: flex;
    flex-direction: column;
    margin-bottom: clamp(0.8rem, 2vh, 1.5rem);
    font-size: clamp(1.4rem, 4vw, 2.8rem);
    font-weight: 300;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-family: 'Cormorant Garamond', serif;
    line-height: 1.5;
  }

  .ms-stair-line {
    opacity: 0;
    transform: translateY(10px);
  }

  .ms-stair-line.ms-show {
    animation: msStairIn 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards;
  }

  @keyframes msStairIn {
    0% { opacity: 0; transform: translateY(10px); filter: blur(2px); }
    100% { opacity: 1; transform: translateY(0); filter: blur(0); }
  }

  .ms-line-1 { padding-left: 0px; margin-left: -10px; }
  .ms-line-2 { padding-left: clamp(2rem, 6vw, 4.5rem); color: #d4a574; }
  .ms-line-3 { padding-left: calc(clamp(2rem, 6vw, 4.5rem) * 2); }

  .ms-falling-s {
    display: inline-block;
    position: relative;
    transform-origin: top center;
    cursor: default;
  }

  .ms-the-u {
    display: inline-block;
    transition: transform 0.5s cubic-bezier(0.23, 1, 0.32, 1);
  }

  .ms-falling-s.ms-unhinging {
    animation: msUnhinge 0.8s ease-in-out forwards;
  }

  @keyframes msUnhinge {
    0%   { transform: rotate(0deg); }
    12%  { transform: rotate(-3deg); }
    24%  { transform: rotate(4deg) translateY(1px); }
    36%  { transform: rotate(-5deg); }
    48%  { transform: rotate(6deg) translateY(2px); }
    60%  { transform: rotate(-4deg) translateY(1px); }
    72%  { transform: rotate(7deg) translateY(3px); }
    85%  { transform: rotate(-3deg) translateY(2px); }
    100% { transform: rotate(10deg) translateY(4px); }
  }

  .ms-word-row {
    display: flex;
    align-items: baseline;
    font-size: clamp(3.2rem, 10vw, 7rem);
    font-weight: 300;
    letter-spacing: 0.02em;
    font-family: 'Cormorant Garamond', serif;
    color: #e8e4df;
  }

  .ms-prefix, .ms-suffix {
    display: inline-block;
    opacity: 0;
  }

  .ms-prefix.ms-show, .ms-suffix.ms-show {
    animation: msTextIn 0.9s cubic-bezier(0.23, 1, 0.32, 1) forwards;
  }

  @keyframes msTextIn {
    0% { opacity: 0; filter: blur(4px); }
    100% { opacity: 1; filter: blur(0); }
  }

  .ms-s-track {
    display: inline-block;
    width: 0;
    overflow: visible;
    position: relative;
    vertical-align: baseline;
  }

  .ms-docked-s {
    display: inline-block;
    position: relative;
    font-size: clamp(3.2rem, 10vw, 7rem);
    font-weight: 600;
    font-family: 'Cormorant Garamond', serif;
    color: #d4a574;
    opacity: 0;
    white-space: nowrap;
    pointer-events: none;
  }

  .ms-docked-s::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 40px;
    height: 40px;
    transform: translate(-50%, -50%) scale(0);
    background: radial-gradient(circle, rgba(212, 165, 116, 0.5), transparent 70%);
    border-radius: 50%;
    pointer-events: none;
    z-index: -1;
  }

  .ms-docked-s.ms-impact::after {
    animation: msImpactFlash 0.5s ease-out forwards;
  }

  @keyframes msImpactFlash {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
    40% { transform: translate(-50%, -50%) scale(4); opacity: 0.7; }
    100% { transform: translate(-50%, -50%) scale(5.5); opacity: 0; }
  }

  .ms-docked-s.ms-visible {
    opacity: 1;
    text-shadow: 0 0 20px rgba(212, 165, 116, 0.5), 0 0 50px rgba(212, 165, 116, 0.12);
  }

  .ms-stage.ms-shake {
    animation: msShake 0.3s ease-out;
  }

  @keyframes msShake {
    0%  { transform: translateY(0); }
    20% { transform: translateY(2px); }
    40% { transform: translateY(-1px); }
    60% { transform: translateY(1px); }
    100%{ transform: translateY(0); }
  }

  .ms-prefix.ms-jostle {
    animation: msJostleLeft 0.25s ease-out forwards;
  }
  .ms-suffix.ms-jostle {
    animation: msJostleRight 0.25s ease-out forwards;
  }

  @keyframes msJostleLeft {
    0%  { transform: translateX(0); opacity: 1; }
    35% { transform: translateX(-5px); }
    70% { transform: translateX(1px); }
    100%{ transform: translateX(0); opacity: 1; }
  }

  @keyframes msJostleRight {
    0%  { transform: translateX(0); opacity: 1; }
    35% { transform: translateX(5px); }
    70% { transform: translateX(-1px); }
    100%{ transform: translateX(0); opacity: 1; }
  }

  .ms-subtitle {
    font-family: 'Anybody', sans-serif;
    font-weight: 300;
    font-size: clamp(0.7rem, 1.8vw, 0.95rem);
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: rgba(232, 228, 223, 0.3);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.8s ease, transform 0.8s ease;
    margin-top: clamp(1.5rem, 3vh, 2.5rem);
  }
  .ms-subtitle.ms-visible { opacity: 1; transform: translateY(0); }

  .ms-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #d4a574;
    opacity: 0;
    transition: opacity 0.5s ease;
    margin-top: 0.8rem;
  }
  .ms-dot.ms-visible {
    opacity: 0.5;
    animation: msBreathe 3s ease-in-out 0.5s infinite;
  }

  @keyframes msBreathe {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.4); }
  }

  .ms-ambient {
    position: absolute;
    width: 400px; height: 150px;
    background: radial-gradient(ellipse, rgba(212, 165, 116, 0.05), transparent 70%);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0;
    transition: opacity 1.5s ease;
  }
  .ms-ambient.ms-visible { opacity: 1; }

  .ms-where-btn {
    background: none;
    border: 1px solid rgba(232, 228, 223, 0.15);
    color: rgba(232, 228, 223, 0.3);
    font-family: 'Anybody', sans-serif;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 0.5rem 1.2rem;
    border-radius: 2px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.5s ease, border-color 0.3s, color 0.3s;
    margin-top: 1.5rem;
    pointer-events: none;
  }
  .ms-where-btn.ms-btn-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .ms-where-btn:hover {
    border-color: #d4a574;
    color: #d4a574;
  }
`;

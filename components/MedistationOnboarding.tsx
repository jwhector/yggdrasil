'use client';

import { useEffect, useState } from 'react';
import type { OnboardingConfig } from '@/conductor/types';

interface Props {
  config: OnboardingConfig;
  onBack: () => void;
}

export function MedistationOnboarding({ config, onBack }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation on mount
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <>
      <style>{styles}</style>
      <div className={`ms-ob-container ${visible ? 'ms-ob-visible' : ''}`}>
        <div className="ms-ob-scroll">
          {config.sections.map((section, i) => {
            switch (section.type) {
              case 'narrative':
                return (
                  <div key={i} className="ms-ob-section ms-ob-narrative">
                    {section.body && <p>{section.body}</p>}
                  </div>
                );

              case 'practical':
                return (
                  <div key={i} className="ms-ob-section">
                    {section.heading && <h3 className="ms-ob-heading">{section.heading}</h3>}
                    {section.items && (
                      <ul className="ms-ob-list">
                        {section.items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );

              case 'cues':
                return (
                  <div key={i} className="ms-ob-section">
                    {section.heading && <h3 className="ms-ob-heading">{section.heading}</h3>}
                    <div className="ms-ob-cues">
                      {section.cues?.map((cue, j) => (
                        <div key={j} className="ms-ob-cue-row">
                          <div className="ms-ob-cue-icon">
                            {cue.icon === 'phone' && (
                              <img src="/phone.svg" alt="" className="ms-ob-cue-img" />
                            )}
                            {cue.icon === 'no-phone' && (
                              <img src="/no-phone.svg" alt="" className="ms-ob-cue-img" />
                            )}
                          </div>
                          <div className="ms-ob-cue-text">
                            <span className="ms-ob-cue-label">{cue.label}</span>
                            <span className="ms-ob-cue-desc">{cue.description}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );

              case 'disclaimer':
                return (
                  <div key={i} className="ms-ob-section ms-ob-subtle">
                    {section.body && <p>{section.body}</p>}
                  </div>
                );

              case 'reconnect':
                return (
                  <div key={i} className="ms-ob-section ms-ob-subtle">
                    {section.heading && <h3 className="ms-ob-heading">{section.heading}</h3>}
                    {section.body && <p>{section.body}</p>}
                  </div>
                );

              default:
                return null;
            }
          })}

          <button className="ms-ob-back" onClick={onBack}>BACK</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = `
  .ms-ob-container {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: translateY(15px);
    transition: opacity 0.6s ease, transform 0.6s ease;
    z-index: 10;
  }

  .ms-ob-container.ms-ob-visible {
    opacity: 1;
    transform: translateY(0);
  }

  .ms-ob-scroll {
    max-width: 380px;
    width: 100%;
    max-height: 100dvh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    box-sizing: border-box;
  }

  .ms-ob-section {
    color: #e8e4df;
  }

  .ms-ob-narrative {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 300;
    font-style: italic;
    font-size: clamp(1.1rem, 3vw, 1.35rem);
    line-height: 1.7;
    color: #e8e4df;
  }

  .ms-ob-heading {
    font-family: 'Anybody', sans-serif;
    font-weight: 300;
    font-size: 0.9rem;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: #d4a574;
    margin: 0 0 12px 0;
  }

  .ms-ob-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: 'Cormorant Garamond', serif;
    font-weight: 300;
    font-size: clamp(1rem, 2.5vw, 1.2rem);
    line-height: 1.5;
  }

  .ms-ob-list li::before {
    content: '—  ';
    color: rgba(212, 165, 116, 0.4);
  }

  .ms-ob-cues {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .ms-ob-cue-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .ms-ob-cue-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(212, 165, 116, 0.2);
    border-radius: 6px;
  }

  .ms-ob-cue-img {
    width: 22px;
    height: 22px;
  }

  .ms-ob-cue-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ms-ob-cue-label {
    font-family: 'Anybody', sans-serif;
    font-weight: 400;
    font-size: 0.85rem;
    letter-spacing: 0.15em;
    color: #e8e4df;
  }

  .ms-ob-cue-desc {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 300;
    font-size: clamp(0.85rem, 2.2vw, 0.95rem);
    line-height: 1.5;
    color: rgba(232, 228, 223, 0.5);
  }

  .ms-ob-subtle {
    font-family: 'Anybody', sans-serif;
    font-weight: 300;
    font-size: clamp(0.8rem, 1.8vw, 0.85rem);
    letter-spacing: 0.08em;
    line-height: 1.7;
    color: rgba(232, 228, 223, 0.25);
  }

  .ms-ob-subtle .ms-ob-heading {
    font-size: 0.85rem;
    margin-bottom: 6px;
    color: rgba(212, 165, 116, 0.7);
  }

  .ms-ob-back {
    align-self: center;
    background: none;
    border: 1px solid rgba(232, 228, 223, 0.15);
    color: rgba(232, 228, 223, 0.3);
    font-family: 'Anybody', sans-serif;
    font-size: 0.85rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 0.5rem 1.2rem;
    border-radius: 2px;
    cursor: pointer;
    margin-top: 8px;
    transition: border-color 0.3s, color 0.3s;
  }

  .ms-ob-back:hover {
    border-color: #d4a574;
    color: #d4a574;
  }
`;

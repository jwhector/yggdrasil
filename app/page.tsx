'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Landing page - redirects based on context
 * In production, audience joins via seat-specific QR codes
 */
export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    // For development, show route options
    // In production with QR codes, this page may not be reached
  }, []);
  
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Yggdrasil</h1>
      <p>Interactive Performance System</p>
      
      <nav style={{ marginTop: '2rem' }}>
        <h2>Routes:</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ margin: '1rem 0' }}>
            <a href="/audience" style={{ fontSize: '1.2rem' }}>
              /audience
            </a>
            <span style={{ color: '#666', marginLeft: '1rem' }}>
              — Audience member UI
            </span>
          </li>
          <li style={{ margin: '1rem 0' }}>
            <a href="/projector" style={{ fontSize: '1.2rem' }}>
              /projector
            </a>
            <span style={{ color: '#666', marginLeft: '1rem' }}>
              — Projector display
            </span>
          </li>
          <li style={{ margin: '1rem 0' }}>
            <a href="/controller" style={{ fontSize: '1.2rem' }}>
              /controller
            </a>
            <span style={{ color: '#666', marginLeft: '1rem' }}>
              — Performer controls
            </span>
          </li>
        </ul>
      </nav>
    </main>
  );
}

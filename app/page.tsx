'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root page — redirects to /audience
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/audience');
  }, [router]);

  return <div style={{ minHeight: '100vh', backgroundColor: '#000' }} />;
}

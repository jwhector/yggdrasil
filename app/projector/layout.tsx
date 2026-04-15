import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'medistation — projector',
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function ProjectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

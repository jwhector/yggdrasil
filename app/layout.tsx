import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yggdrasil',
  description: 'Interactive performance system for collective song-building',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

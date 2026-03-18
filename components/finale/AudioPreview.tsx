'use client';

interface AudioPreviewProps {
  isPlaying: boolean;
  onToggle: () => void;
}

export function AudioPreview({ isPlaying, onToggle }: AudioPreviewProps) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.2)',
        backgroundColor: isPlaying ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.7)',
        fontSize: '0.85rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background-color 0.15s ease',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
      aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
    >
      {isPlaying ? '⏸' : '▶'}
    </button>
  );
}

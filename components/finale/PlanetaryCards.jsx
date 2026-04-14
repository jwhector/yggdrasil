import { useState, useEffect, useRef } from "react";

const SONGS = [
  {
    name: "Ambition",
    desc: "Driving. Restless. Bright.",
    orb1: "#D4930A",
    orb2: "#EF9F27",
    border: "#854F0B",
    borderActive: "#EF9F27",
    text: "#FAEEDA",
  },
  {
    name: "Love",
    desc: "Warm. Open. Aching.",
    orb1: "#D85A30",
    orb2: "#F0997B",
    border: "#993C1D",
    borderActive: "#F0997B",
    text: "#FAECE7",
  },
  {
    name: "Avoidance",
    desc: "Evasive. Sparse. Cool.",
    orb1: "#0F6E56",
    orb2: "#5DCAA5",
    border: "#085041",
    borderActive: "#5DCAA5",
    text: "#E1F5EE",
  },
];

function OrbCard({ song, index, selected, onClick }) {
  const containerRef = useRef(null);
  const orb1Ref = useRef(null);
  const orb2Ref = useRef(null);
  const rafRef = useRef(null);
  const angleRef = useRef(index * 2.1);

  useEffect(() => {
    const speed = 0.008 + index * 0.002;
    const radiusX = 70;
    const tilt = 0.3;

    const animate = () => {
      angleRef.current += speed;
      const a = angleRef.current;

      const orb1 = orb1Ref.current;
      const orb2 = orb2Ref.current;
      if (!orb1 || !orb2) return;

      // Orb 1 position on tilted orbital plane
      const x1 = Math.cos(a) * radiusX;
      const depth1 = Math.sin(a);
      const y1 = depth1 * radiusX * tilt;
      const scale1 = 1 + depth1 * 0.45;
      const opacity1 = 0.35 + depth1 * 0.25;

      // Orb 2 is 180 degrees opposite
      const x2 = Math.cos(a + Math.PI) * radiusX;
      const depth2 = Math.sin(a + Math.PI);
      const y2 = depth2 * radiusX * tilt;
      const scale2 = 1 + depth2 * 0.45;
      const opacity2 = 0.35 + depth2 * 0.25;

      // Apply transforms — translate relative to center of card
      orb1.style.transform = `translate(${x1}px, ${y1}px) scale(${scale1})`;
      orb1.style.opacity = selected ? Math.min(opacity1 + 0.3, 0.95) : opacity1;
      orb1.style.zIndex = depth1 > 0 ? 3 : 1;

      orb2.style.transform = `translate(${x2}px, ${y2}px) scale(${scale2})`;
      orb2.style.opacity = selected ? Math.min(opacity2 + 0.3, 0.95) : opacity2;
      orb2.style.zIndex = depth2 > 0 ? 3 : 1;

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [selected, index]);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      style={{
        position: "relative",
        width: 220,
        height: 110,
        borderRadius: 12,
        background: "#151515",
        border: `1px solid ${selected ? song.borderActive + "aa" : song.border + "40"}`,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.5s ease, transform 0.35s ease",
        transform: selected ? "scale(1.04)" : "scale(1)",
      }}
    >
      {/* Orbital system container — centered in card */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: "55%",
        width: 0,
        height: 0,
      }}>
        {/* Orb 1 — primary color, larger */}
        <div
          ref={orb1Ref}
          style={{
            position: "absolute",
            width: 48,
            height: 48,
            marginLeft: -24,
            marginTop: -24,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 40%, ${song.orb2}, ${song.orb1})`,
            filter: "blur(16px)",
            willChange: "transform, opacity",
          }}
        />
        {/* Orb 2 — accent color, smaller */}
        <div
          ref={orb2Ref}
          style={{
            position: "absolute",
            width: 36,
            height: 36,
            marginLeft: -18,
            marginTop: -18,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 40%, ${song.orb2}ee, ${song.orb1}aa)`,
            filter: "blur(14px)",
            willChange: "transform, opacity",
          }}
        />
      </div>

      {/* Text content — always on top */}
      <div style={{
        position: "relative",
        zIndex: 4,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 20px",
        gap: 6,
        pointerEvents: "none",
      }}>
        <div style={{
          fontFamily: '"Georgia", "Times New Roman", serif',
          fontSize: 20,
          color: selected ? song.text : "#d4d4d4",
          transition: "color 0.4s ease",
        }}>
          {song.name}
        </div>
        <div style={{
          fontFamily: '"Courier New", monospace',
          fontSize: 11,
          letterSpacing: 1.5,
          color: selected ? song.orb2 + "dd" : "#555",
          transition: "color 0.4s ease",
        }}>
          {song.desc}
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div style={{
          position: "absolute",
          top: 12,
          right: 14,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: song.orb2,
          zIndex: 5,
          animation: "pulse 2s ease-in-out infinite",
        }} />
      )}
    </div>
  );
}

export default function PlanetaryCards() {
  const [selected, setSelected] = useState(null);

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "var(--font-sans, system-ui)" }}>
      <h2 className="sr-only">Song choice cards with planetary orbit animation</h2>

      <div style={{
        background: "#090909",
        borderRadius: 16,
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        flexWrap: "wrap",
        minHeight: 260,
        border: "1px solid #1a1a1a",
      }}>
        {SONGS.map((song, i) => (
          <OrbCard
            key={i}
            song={song}
            index={i}
            selected={selected === i}
            onClick={() => setSelected(selected === i ? null : i)}
          />
        ))}
      </div>

      <div style={{
        marginTop: 16,
        fontSize: 13,
        color: "var(--color-text-secondary, #888)",
        textAlign: "center",
      }}>
        {selected !== null
          ? `Previewing: ${SONGS[selected].name}`
          : "Tap to select"
        }
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.6); }
        }
      `}</style>
    </div>
  );
}
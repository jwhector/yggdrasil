import { useState, useMemo, useEffect, useRef } from "react";
import * as d3 from "d3";

// ─── Config ──────────────────────────────────────────────
const W = 800;
const H = 700;
const ROWS = 8;
const OPTIONS = 4;
const AUDIENCE_COUNT = 20;

const FACTION_COLORS = ["#e05c5c", "#5cb8e0", "#5ce08a", "#e0c55c"];
const FACTION_NAMES = ["Red", "Blue", "Green", "Gold"];
const DOT_RADIUS = 8;
const WINNER_RADIUS = 11;

// ─── Seeded random ───────────────────────────────────────
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Mock data ───────────────────────────────────────────
function generateMockData() {
  const rand = seededRandom(42);
  const winners = Array.from({ length: ROWS }, () =>
    Math.floor(rand() * OPTIONS)
  );
  const paths = Array.from({ length: AUDIENCE_COUNT }, (_, i) => ({
    id: i,
    faction: i % 4,
    choices: Array.from({ length: ROWS }, (_, r) =>
      rand() < 0.35 ? winners[r] : Math.floor(rand() * OPTIONS)
    ),
  }));
  return { winners, paths };
}

// ─── Generate organic decorations (stable per layout) ────
function generateTwigs(rand) {
  const twigs = [];
  for (let row = 4; row < ROWS; row++) {
    for (let opt = 0; opt < OPTIONS; opt++) {
      const count = 1 + Math.floor(rand() * 3);
      for (let t = 0; t < count; t++) {
        const angle = rand() * Math.PI * 2;
        const length = 12 + rand() * 28;
        const biasAngle =
          row >= 6 ? angle * 0.5 - Math.PI / 2 : angle;
        const hasBud = rand() > 0.35;
        const budSize = 1.5 + rand() * 2.5;
        const midOffsetX = (rand() - 0.5) * 12;
        const midOffsetY = (rand() - 0.5) * 8;
        twigs.push({
          row,
          opt,
          angle: biasAngle,
          length,
          hasBud,
          budSize,
          midOffsetX,
          midOffsetY,
          thickness: 0.5 + rand() * 1.0,
        });
      }
    }
  }
  return twigs;
}

function generateCanopyJitter(rand) {
  const jitter = {};
  for (let row = 4; row < ROWS; row++) {
    for (let opt = 0; opt < OPTIONS; opt++) {
      jitter[`${row}-${opt}`] = {
        dx: (rand() - 0.5) * 14,
        dy: (rand() - 0.5) * 10,
      };
    }
  }
  return jitter;
}

// ─── Position functions ──────────────────────────────────

function gridPos(row, option) {
  const colSpacing = 70;
  const rowSpacing = 56;
  const x = W / 2 - colSpacing * 1.5 + option * colSpacing;
  const y = H - 70 - row * rowSpacing;
  return { x, y };
}

function makeTreePosFn(canopyJitter) {
  return function treePos(row, option) {
    const yMap = [
      H - 55,
      H - 115,
      H - 175,
      H - 235,
      H - 310,
      H - 390,
      H - 465,
      H - 535,
    ];
    let y = yMap[row];

    let spread;
    if (row <= 3) {
      // TRUNK: identical spread for all 4 rows → parallel lines
      spread = 36;
    } else {
      // CANOPY: elliptical arc
      const t = (row - 4) / 3;
      const angle = 0.18 + t * 0.64;
      spread = Math.sin(angle * Math.PI) * 300;
    }

    const step = OPTIONS > 1 ? spread / (OPTIONS - 1) : 0;
    let x = W / 2 - spread / 2 + option * step;

    // Jitter for canopy nodes
    if (row >= 4) {
      const j = canopyJitter[`${row}-${option}`];
      if (j) {
        x += j.dx;
        y += j.dy;
      }
    }

    return { x, y };
  };
}

// ─── Path curve generator ────────────────────────────────
const curveGen = d3
  .line()
  .x((d) => d[0])
  .y((d) => d[1])
  .curve(d3.curveCatmullRom.alpha(0.5));

function buildPathString(choices, posFn) {
  const points = choices.map((opt, row) => {
    const p = posFn(row, opt);
    return [p.x, p.y];
  });
  return curveGen(points);
}

// ─── Animated SVG path ───────────────────────────────────
function DrawingPath({ d, color, delay = 0, duration = 1200 }) {
  const ref = useRef(null);
  const [length, setLength] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const totalLen = ref.current.getTotalLength();
      setLength(totalLen);
      setOffset(totalLen);
      const timer = setTimeout(() => setOffset(0), delay + 50);
      return () => clearTimeout(timer);
    }
  }, [d, delay]);

  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={length}
      strokeDashoffset={offset}
      opacity={0.5}
      style={{
        transition: `stroke-dashoffset ${duration}ms ease-in-out`,
      }}
    />
  );
}

// ─── Twig fiber component ────────────────────────────────
function Twig({ fromX, fromY, twig, visible, opacity }) {
  const endX = fromX + Math.cos(twig.angle) * twig.length;
  const endY = fromY + Math.sin(twig.angle) * twig.length;
  const midX = (fromX + endX) / 2 + twig.midOffsetX;
  const midY = (fromY + endY) / 2 + twig.midOffsetY;

  return (
    <g
      opacity={visible ? opacity : 0}
      style={{ transition: "opacity 1.2s ease" }}
    >
      <path
        d={`M ${fromX} ${fromY} Q ${midX} ${midY} ${endX} ${endY}`}
        fill="none"
        stroke="#3a3a3a"
        strokeWidth={twig.thickness}
        strokeLinecap="round"
      />
      {twig.hasBud && (
        <circle cx={endX} cy={endY} r={twig.budSize} fill="#2e2e36" />
      )}
    </g>
  );
}

// ─── Trunk bark texture ──────────────────────────────────
function TrunkBark({ posFn, visible }) {
  const fibers = useMemo(() => {
    const rand = seededRandom(99);
    const lines = [];
    for (let i = 0; i < 8; i++) {
      const t = rand();
      const wobble = () => (rand() - 0.5) * 4;
      const top = posFn(3, 0);
      const bot = posFn(0, 0);
      const topRight = posFn(3, OPTIONS - 1);
      const botRight = posFn(0, OPTIONS - 1);
      const leftEdge = Math.min(top.x, bot.x) - 6;
      const rightEdge = Math.max(topRight.x, botRight.x) + 6;
      const x = leftEdge + t * (rightEdge - leftEdge);
      const points = [
        [x + wobble(), bot.y + 10],
        [x + wobble(), bot.y - (bot.y - top.y) * 0.33],
        [x + wobble(), bot.y - (bot.y - top.y) * 0.66],
        [x + wobble(), top.y - 8],
      ];
      lines.push({
        d: curveGen(points),
        thickness: 0.3 + rand() * 0.6,
        opacity: 0.12 + rand() * 0.15,
      });
    }
    return lines;
  }, [posFn]);

  return (
    <g
      opacity={visible ? 1 : 0}
      style={{ transition: "opacity 1.5s ease 0.3s" }}
    >
      {fibers.map((f, i) => (
        <path
          key={i}
          d={f.d}
          fill="none"
          stroke="#4a4a4a"
          strokeWidth={f.thickness}
          opacity={f.opacity}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

// ─── Root tendrils ───────────────────────────────────────
function Roots({ posFn, visible }) {
  const roots = useMemo(() => {
    const rand = seededRandom(77);
    const rootLines = [];
    const bot = posFn(0, 0);
    const botRight = posFn(0, OPTIONS - 1);
    const cx = (bot.x + botRight.x) / 2;

    for (let i = 0; i < 5; i++) {
      const startX = cx + (rand() - 0.5) * (botRight.x - bot.x + 10);
      const startY = bot.y + 4;
      const angle = Math.PI / 2 + (rand() - 0.5) * 1.2;
      const len = 15 + rand() * 25;
      const endX = startX + Math.cos(angle) * len;
      const endY = startY + Math.sin(angle) * len;
      const midX = (startX + endX) / 2 + (rand() - 0.5) * 10;
      const midY = (startY + endY) / 2 + (rand() - 0.5) * 6;
      rootLines.push({
        d: `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`,
        thickness: 0.4 + rand() * 0.7,
      });
    }
    return rootLines;
  }, [posFn]);

  return (
    <g
      opacity={visible ? 0.3 : 0}
      style={{ transition: "opacity 1.5s ease 0.5s" }}
    >
      {roots.map((r, i) => (
        <path
          key={i}
          d={r.d}
          fill="none"
          stroke="#3a3a3a"
          strokeWidth={r.thickness}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

// ─── Main component ──────────────────────────────────────
export default function SongTreePrototype() {
  const { winners, paths } = useMemo(() => generateMockData(), []);

  const canopyJitter = useMemo(
    () => generateCanopyJitter(seededRandom(123)),
    []
  );
  const twigs = useMemo(() => generateTwigs(seededRandom(456)), []);
  const treePosFn = useMemo(
    () => makeTreePosFn(canopyJitter),
    [canopyJitter]
  );

  const [revealedRows, setRevealedRows] = useState(0);
  const [layout, setLayout] = useState("grid");
  const [drawnPaths, setDrawnPaths] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);

  const posFn = layout === "grid" ? gridPos : treePosFn;
  const isTree = layout === "tree";

  useEffect(() => {
    if (!autoPlaying) return;
    if (drawnPaths >= paths.length) {
      setAutoPlaying(false);
      return;
    }
    const timer = setTimeout(() => setDrawnPaths((d) => d + 1), 800);
    return () => clearTimeout(timer);
  }, [autoPlaying, drawnPaths, paths.length]);

  function handleNextRow() {
    if (revealedRows < ROWS) setRevealedRows((r) => r + 1);
  }

  function handleTransform() {
    setLayout("tree");
  }

  function handlePlayPaths() {
    if (drawnPaths === 0) setDrawnPaths(1);
    setAutoPlaying(true);
  }

  function handleReset() {
    setRevealedRows(0);
    setLayout("grid");
    setDrawnPaths(0);
    setAutoPlaying(false);
  }

  const winnerLinePoints = [];
  for (let r = 0; r < revealedRows; r++) {
    const p = posFn(r, winners[r]);
    winnerLinePoints.push([p.x, p.y]);
  }
  const winnerPathD =
    winnerLinePoints.length >= 2 ? curveGen(winnerLinePoints) : null;

  return (
    <div
      style={{
        background: "#0b0b0f",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#e0e0e0",
        padding: "20px 0",
      }}
    >
      <h2
        style={{
          margin: "0 0 4px",
          fontSize: 18,
          fontWeight: 400,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "#888",
        }}
      >
        Song Tree Prototype
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#555" }}>
        {!isTree
          ? revealedRows < ROWS
            ? `Row ${revealedRows} of ${ROWS} — click "Next Row" to build`
            : "All rows committed — ready to transform"
          : drawnPaths === 0
          ? 'Tree formed — click "Play Paths" to fill in'
          : `${drawnPaths} of ${paths.length} paths drawn`}
      </p>

      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: "#0b0b0f", borderRadius: 8 }}
      >
        {/* Trunk bark */}
        <TrunkBark posFn={treePosFn} visible={isTree} />

        {/* Roots */}
        <Roots posFn={treePosFn} visible={isTree} />

        {/* Twig fibers */}
        {twigs.map((twig, i) => {
          const p = posFn(twig.row, twig.opt);
          return (
            <Twig
              key={i}
              fromX={p.x}
              fromY={p.y}
              twig={twig}
              visible={isTree && twig.row < revealedRows}
              opacity={drawnPaths > 0 ? 0.35 : 0.55}
            />
          );
        })}

        {/* Audience paths */}
        {isTree &&
          paths.slice(0, drawnPaths).map((p) => (
            <DrawingPath
              key={p.id}
              d={buildPathString(p.choices, treePosFn)}
              color={FACTION_COLORS[p.faction]}
              delay={0}
              duration={1000}
            />
          ))}

        {/* Winner path */}
        {winnerPathD && (
          <path
            d={winnerPathD}
            fill="none"
            stroke="#fff"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={isTree && drawnPaths > 0 ? 0.12 : 0.5}
            style={{ transition: "opacity 1s ease" }}
          />
        )}

        {/* Option dots */}
        {Array.from({ length: ROWS }, (_, row) =>
          Array.from({ length: OPTIONS }, (_, opt) => {
            const visible = row < revealedRows;
            const isWinner = visible && winners[row] === opt;
            const pos = posFn(row, opt);

            return (
              <g key={`${row}-${opt}`}>
                {isWinner && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={WINNER_RADIUS + 6}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={1}
                    opacity={0.12}
                    style={{
                      transition:
                        "cx 1.5s ease-in-out, cy 1.5s ease-in-out",
                    }}
                  />
                )}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isWinner ? WINNER_RADIUS : DOT_RADIUS}
                  fill={
                    !visible
                      ? "#1a1a22"
                      : isWinner
                      ? "#fff"
                      : "#3a3a44"
                  }
                  stroke={
                    !visible
                      ? "#2a2a32"
                      : isWinner
                      ? "#fff"
                      : "#4a4a54"
                  }
                  strokeWidth={visible ? 1.5 : 0.5}
                  opacity={visible ? 1 : 0.35}
                  style={{
                    transition:
                      "cx 1.5s ease-in-out, cy 1.5s ease-in-out, r 0.4s ease, fill 0.4s ease, opacity 0.4s ease",
                  }}
                />
                {visible && (
                  <text
                    x={pos.x}
                    y={pos.y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={9}
                    fontWeight={700}
                    fill={isWinner ? "#0b0b0f" : "#666"}
                    style={{
                      transition:
                        "x 1.5s ease-in-out, y 1.5s ease-in-out",
                      pointerEvents: "none",
                    }}
                  >
                    {String.fromCharCode(65 + opt)}
                  </text>
                )}
              </g>
            );
          })
        )}

        {/* Row labels */}
        {Array.from({ length: ROWS }, (_, row) => {
          const visible = row < revealedRows;
          const pos = posFn(row, 0);
          const rightPos = posFn(row, OPTIONS - 1);
          const labelX =
            layout === "grid"
              ? pos.x - 40
              : Math.min(pos.x, rightPos.x) - 30;
          return (
            visible && (
              <text
                key={`label-${row}`}
                x={labelX}
                y={pos.y + 1}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={10}
                fill="#444"
                style={{
                  transition: "x 1.5s ease-in-out, y 1.5s ease-in-out",
                }}
              >
                R{row + 1}
              </text>
            )
          );
        })}
      </svg>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 16,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          onClick={handleNextRow}
          disabled={revealedRows >= ROWS}
          style={btnStyle(revealedRows >= ROWS)}
        >
          Next Row{" "}
          {revealedRows < ROWS ? `(${revealedRows + 1}/${ROWS})` : "✓"}
        </button>
        <button
          onClick={handleTransform}
          disabled={isTree || revealedRows < ROWS}
          style={btnStyle(isTree || revealedRows < ROWS)}
        >
          Transform to Tree
        </button>
        <button
          onClick={handlePlayPaths}
          disabled={!isTree || autoPlaying || drawnPaths >= paths.length}
          style={btnStyle(!isTree || drawnPaths >= paths.length)}
        >
          {drawnPaths > 0 && drawnPaths < paths.length
            ? "Playing..."
            : drawnPaths >= paths.length
            ? "All paths drawn ✓"
            : "Play Paths"}
        </button>
        <button onClick={handleReset} style={btnStyle(false)}>
          Reset
        </button>
      </div>

      {/* Legend */}
      {isTree && drawnPaths > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 12,
            fontSize: 12,
            color: "#666",
          }}
        >
          {FACTION_COLORS.map((c, i) => (
            <span
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: c,
                  display: "inline-block",
                  opacity: 0.7,
                }}
              />
              {FACTION_NAMES[i]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle(disabled) {
  return {
    padding: "8px 16px",
    borderRadius: 6,
    border: "1px solid #333",
    background: disabled ? "#1a1a1a" : "#222",
    color: disabled ? "#555" : "#ccc",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    fontFamily: "inherit",
    transition: "all 0.2s ease",
  };
}

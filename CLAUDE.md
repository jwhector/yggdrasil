# CLAUDE.md — Claude Code Agent Context

## ⚠️ MIGRATION IN PROGRESS
This codebase is being migrated from an old show design to a new one. **The old code still exists in many files.** Do not assume existing code is correct or current — always check against ARCHITECTURE.md before preserving, extending, or imitating existing patterns.

### What changed (high level)
- **REMOVED:** Factions, coherence scoring, coups, 4-option voting, song tree, dual paths, personal trees, fig tree prompt, seat topology algorithms
- **KEPT:** Next.js + custom server + Socket.IO, Conductor pattern (pure state machine), SQLite persistence, OSC/Ableton bridge, client reconnection/recovery, full-state-sync WebSocket strategy
- **NEW:** Binary A/B voting, doubt/consensus threshold, attempt collapse, 3-attempt structure, finale with triangle steering + slot rotation + stewardship + fragment selection, audio metering

### How to tell old from new
- **Old code references these → DELETE or REPLACE:** `faction`, `FactionId`, `coherence`, `coup`, `coupMeter`, `coupMultiplier`, `coupThreshold`, `personalVote`, `factionVote`, `personalTree`, `figTree`, `songTree`, `dualPath`, `popularPath`, `factionPath`, `SeatTopologyProvider`, `AdjacencyGraph`, `FactionAssigner`, `RevealPayload`, `COUP_TRIGGERED`, `COUP_METER_UPDATE`, `FactionReveal`, `TiebreakerAnimation`
- **Old code references these → KEEP and ADAPT:** `Conductor`, `ConductorCommand`, `ConductorEvent`, `ShowState`, `ShowPhase`, `ShowConfig`, `Socket.IO`, `state_sync`, `persistence`, `recovery`, `osc`, `timing`, `AudioAdapter`, `NullAdapter`, `heartbeat`, `version` (state versioning), `ADVANCE_PHASE`, `PAUSE`, `RESUME`, `USER_CONNECT`, `USER_DISCONNECT`
- **New concepts to BUILD:** `LayerVote`, `LayerPhase`, `consensus`, `doubtThreshold`, `collapse`, `AttemptState`, `AttemptResult`, `Fragment`, `FinaleState`, `ActiveSlot`, `QueueEntry`, `TrianglePosition`, `centroid`, `Stewardship`, `SafeParameter`, `Chapter`, `LayerType`, `metering`

---

## Read Order
1. **This file** (you're here — read fully before doing anything)
2. **ARCHITECTURE.md** — The authoritative spec for the NEW system. If code contradicts this, the code is wrong.
3. **DECISIONS.md** — Resolved design decisions (with rationale) and open questions (do NOT invent answers)
4. **MIGRATION.md** — Step-by-step migration plan with phases. Check which phase is current before working.
5. **conductor/types.ts** — Shared type definitions (update this when it exists for the new system)
6. **CHANGELOG.md** — Recent changes with context

---

## Critical Rules

### 1. ARCHITECTURE.md is the source of truth
If you're unsure whether existing code is old or new, check ARCHITECTURE.md. If a concept isn't in ARCHITECTURE.md, it's old and should be removed or replaced.

### 2. Don't preserve old game logic
When you encounter faction/coherence/coup logic in the Conductor, do NOT try to adapt it. The new game logic (binary voting, consensus, doubt thresholds, collapse) is fundamentally different. Write it fresh using the spec in ARCHITECTURE.md.

### 3. DO preserve infrastructure
The server scaffolding, Socket.IO setup, SQLite persistence pattern, OSC bridge, recovery protocol, heartbeat, state versioning, client reconnection, and full-state-sync strategy are all good. Adapt them to the new data shapes, but keep the patterns.

### 4. Types first
When building new features, define the types in `conductor/types.ts` FIRST. Then implement logic. Then wire up server/client. This prevents drift.

### 5. Don't invent answers to open questions
DECISIONS.md has an "Open Decisions" section. If your current task touches one of these (e.g., exact layer count, threshold schedule, color assignments), implement a configurable placeholder and add a `// TODO: See DECISIONS.md O[N]` comment. Do not hardcode a guess.

### 6. Track your work in MIGRATION.md
After completing a migration phase, update MIGRATION.md to mark it done and note anything surprising or incomplete.

---

## Project Structure (target — may not match current state during migration)

```
solo-show/
├── ARCHITECTURE.md              # Source of truth (NEW)
├── CHANGELOG.md                 # Change history with intent
├── CLAUDE.md                    # This file
├── DECISIONS.md                 # Design decisions log
├── MIGRATION.md                 # Migration checklist (DELETE when done)
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts
│   ├── conductor.ts             # State machine
│   ├── consensus.ts             # Vote tallying + doubt threshold
│   ├── finale.ts                # Queue, rotation, stewardship, triangle
│   ├── fragments.ts             # Fragment generation from attempt results
│   ├── types.ts                 # Shared types
│   └── __tests__/
│
├── server/
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO handlers
│   ├── persistence.ts           # SQLite
│   ├── recovery.ts              # Backup + restore
│   ├── timing.ts                # Quantized timing
│   ├── osc.ts                   # OSC bridge
│   ├── audio-router.ts          # AUDIO_CUE → OSC mapping
│   ├── metering.ts              # M4L audio levels → projector
│   └── __tests__/
│
├── app/                         # Next.js pages
│   ├── audience/page.tsx
│   ├── projector/page.tsx
│   └── controller/page.tsx
│
├── components/
│   ├── song-building/           # Layer grid, option cards, meters
│   ├── finale/                  # Fragment selector, triangle, steward slider, slots
│   ├── shared/                  # Chapter badge, layer icon, phase indicator
│   └── controller/              # Operator controls
│
├── hooks/
│   ├── useSocket.ts
│   ├── useShowState.ts
│   └── useTriangle.ts
│
├── lib/
│   ├── socket-client.ts
│   ├── storage.ts
│   ├── serialization.ts
│   └── identity.ts              # Chapter/layer color+symbol mappings
│
├── config/
│   ├── default-show.json
│   └── ableton-layout.json
│
└── db/
    └── schema.sql
```

---

## Commands & Testing
```bash
# Dev server
npm run dev

# Run conductor tests (most important — pure logic, no mocks)
npm test -- conductor/

# Run all tests
npm test

# Run without Ableton (testing mode)
OSC_ENABLED=false npm run dev
```

---

## Common Patterns

### Adding a new ConductorCommand
1. Add to `ConductorCommand` union in `conductor/types.ts`
2. Add handler case in `conductor/conductor.ts` → `processCommand()`
3. Emit corresponding `ConductorEvent`(s)
4. Add socket handler in `server/socket.ts`
5. Add UI control (usually in `components/controller/`)
6. Write test in `conductor/__tests__/`

### Wiring a new client → server event
1. Define event name and payload shape
2. Add socket listener in `server/socket.ts`
3. Map to a `ConductorCommand` and call `conductor.processCommand()`
4. Conductor emits events → server broadcasts state_sync
5. Client receives updated state via `useShowState` hook

### High-frequency data (triangle, metering)
These do NOT go through state_sync (too slow/heavy):
- **Triangle positions**: Client throttles to ~250ms, server computes centroid, broadcasts to projector at ~3-4 Hz
- **Audio metering**: M4L sends at ~15-30 Hz per slot, server aggregates, broadcasts to projector at ~10 Hz
- Both use dedicated socket events, not state mutations
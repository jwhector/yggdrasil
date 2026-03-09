# CLAUDE.md — Claude Code Agent Context

## Read Order
1. **This file** (you're here — read fully before doing anything)
2. **ARCHITECTURE.md** — The authoritative spec. If code contradicts this, the code is wrong.
3. **DECISIONS.md** — Resolved design decisions (with rationale) and open questions (do NOT invent answers)
4. **conductor/types.ts** — Shared type definitions
5. **CHANGELOG.md** — Recent changes with context

---

## What This System Is

Yggdrasil is an interactive live performance system. An audience collectively builds a song through binary A/B voting across 3 song attempts. Each attempt has a **health bar** that drains proportionally to vote splits — collapse is mechanical when health reaches 0. The finale features an **elegy** (display of all built fragments), a **consensus game** (audience votes to activate fragments round by round), and a **performer mixing surface** (live-mix activated layers). An **NPC character** provides auto-triggered and manually triggered narrative text throughout.

**Core architecture:** Next.js + custom server + Socket.IO, Conductor pattern (pure state machine), SQLite persistence, OSC/Ableton bridge, client reconnection/recovery, full-state-sync WebSocket strategy.

---

## Critical Rules

### 1. ARCHITECTURE.md is the source of truth
If code contradicts ARCHITECTURE.md, the code is wrong.

### 2. Types first
When building new features, define the types in `conductor/types.ts` FIRST. Then implement logic. Then wire up server/client. This prevents drift.

### 3. Don't invent answers to open questions
DECISIONS.md has an "Open Decisions" section. If your current task touches one of these (e.g., exact layer count, threshold schedule, color assignments), implement a configurable placeholder and add a `// TODO: See DECISIONS.md O[N]` comment. Do not hardcode a guess.

### 4. Conductor is pure
The `conductor/` directory contains pure game logic — no I/O, no Socket.IO, no database calls. All side effects live in `server/`. The conductor receives commands and returns events.

### 5. High-frequency data bypasses state_sync
Convergence updates and audio metering use dedicated socket events at high frequency (4–30 Hz). They do NOT go through `state_sync` or persistence.

---

## Project Structure

```
yggdrasil/
├── ARCHITECTURE.md              # Source of truth
├── CHANGELOG.md                 # Change history with intent
├── CLAUDE.md                    # This file
├── DECISIONS.md                 # Design decisions log
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts
│   ├── conductor.ts             # State machine
│   ├── voting.ts                # Vote tallying + VoteResult calculation
│   ├── health-bar.ts            # Health bar drain calculation
│   ├── consensus-game.ts        # Finale consensus game logic
│   ├── performer-mix.ts         # Performer mixing surface logic
│   ├── npc.ts                   # NPC auto-trigger evaluation
│   ├── fragments.ts             # Fragment generation from attempt results
│   ├── types.ts                 # Shared types
│   └── __tests__/
│
├── server/
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO handlers
│   ├── persistence.ts           # SQLite
│   ├── backup.ts                # Backup + restore
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
│   ├── LobbyDisplay.tsx         # Projector lobby screen
│   ├── song-building/           # Layer grid, option cards, health bar, reveal sequence
│   ├── finale/                  # ElegyGrid, ConvergenceMeter, ConsensusBoard, MixingSurface, NpcDisplay
│   └── controller/              # Operator controls
│
├── hooks/
│   ├── useSocket.ts
│   ├── useShowState.ts
│   └── useConvergence.ts        # Spring-interpolated convergence meter animation
│
├── lib/
│   ├── socket-client.ts
│   ├── storage.ts
│   ├── serialization.ts         # Maps → arrays for JSON transport
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

# Run all tests (198 tests across 9 suites)
npm test

# Type check
npx tsc --noEmit

# Run without Ableton (testing mode)
OSC_ENABLED=false npm run dev

# Network access (for testing on phones)
npm run dev:network
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

### High-frequency data (convergence, metering)
These do NOT go through state_sync (too slow/heavy):
- **Convergence updates**: Server broadcasts `convergence_update` to all clients at ~4-5 Hz during consensus game; `useConvergence` hook applies spring interpolation for analog-feel animation
- **Audio metering**: M4L sends at ~15-30 Hz per track, server aggregates, broadcasts to projector at ~10 Hz
- Both use dedicated socket events, not state mutations

### State filtering by client mode
- **Controller**: full serialized state (Maps converted to arrays)
- **Projector**: public state (no per-user data)
- **Audience**: personalized (user's vote, available fragments for consensus game, convergence value)

### Audio/OSC track layout
- Track index: `attemptIndex * (layersPerAttempt * 2) + layerIndex * 2 + optionOffset`
- 42 fragment tracks (3 attempts × 7 layers × 2 options); group (foldable) tracks are intermixed
- Gain-based control via Utility devices; mute/unmute queries is_foldable to skip group tracks
- Collapse gesture: return track 0 effects enabled, delayed mute after animation
- Song rejection gesture: return track 1 effects enabled
- Config: `config/ableton-layout.json`

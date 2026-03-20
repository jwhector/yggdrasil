# CLAUDE.md — Claude Code Agent Context

## Read Order
1. **This file** (you're here — read fully before doing anything)
2. **ARCHITECTURE.md** — The authoritative spec (index + core concepts). Then read only the `docs/` file relevant to your task:
   - Conductor song-building? → `docs/song-building.md` + `docs/data-models.md`
   - Conductor finale? → `docs/finale.md` + `docs/data-models.md`
   - UI components or pages? → `docs/client-routes.md`
   - Audio, OSC, or timing? → `docs/audio-engine.md`
   - WebSocket events or persistence? → `docs/server-protocol.md`
   - Type definitions or conductor API? → `docs/data-models.md`
3. **DECISIONS.md** — Resolved design decisions (with rationale) and open questions (do NOT invent answers)
4. **conductor/types.ts** — Shared type definitions
5. **CHANGELOG.md** — Recent changes with context

---

## What This System Is

Yggdrasil is an interactive live performance system. An audience collectively builds a song through binary A/B voting across 3 song attempts. Each attempt has 6 layers (melody, drums, pad, bass, harmony, fx), each with a **doubt threshold** — if the winning vote proportion falls below the threshold, the song collapses. Thresholds escalate per layer, representing the performer's rising inner doubt. The finale features an **elegy** (display of all built fragments), a **group assembly** (audience self-selects into 6 layer-type groups), a **deliberation** (groups preview audio and vote on fragments, then select ambassadors), a **ceremony** (ambassadors lock fragments at the altar via accelerometer), and a **performer mixing surface** (live-mix activated layers). An **NPC character** provides event-driven narrative text throughout.

**Core architecture:** Next.js + custom server + Socket.IO, Conductor pattern (pure state machine), SQLite persistence, OSC/Ableton bridge, client reconnection/recovery, full-state-sync WebSocket strategy.

**Active migration:** V3 → V3.1 in progress. See `MIGRATION-v3.1.md` for the implementation plan. When MIGRATION-v3.1.md conflicts with ARCHITECTURE.md, the migration doc is correct.

---

## Critical Rules

### 1. ARCHITECTURE.md + docs/ are the source of truth
If code contradicts ARCHITECTURE.md or any file in `docs/`, the spec is correct and the code should be updated.

### 2. Types first
When building new features, define the types in `conductor/types.ts` FIRST. Then implement logic. Then wire up server/client. This prevents drift.

### 3. Don't invent answers to open questions
DECISIONS.md has an "Open Decisions" section. If your current task touches one of these (e.g., exact layer count, threshold schedule, color assignments), implement a configurable placeholder and add a `// TODO: See DECISIONS.md O[N]` comment. Do not hardcode a guess.

### 4. Conductor is pure
The `conductor/` directory contains pure game logic — no I/O, no Socket.IO, no database calls. All side effects live in `server/`. The conductor receives commands and returns events.

### 5. High-frequency data bypasses state_sync
Group assembly updates and audio metering use dedicated socket events at high frequency (2–30 Hz). They do NOT go through `state_sync` or persistence.

---

## Project Structure

```
yggdrasil/
├── ARCHITECTURE.md              # Source of truth (index + core concepts)
├── docs/                        # Detailed specs (load per-task, see ARCHITECTURE.md index)
│   ├── song-building.md         # Layers, voting, doubt threshold, collapse, fragments
│   ├── finale.md                # Elegy, assembly, deliberation, ceremony, performer mix
│   ├── data-models.md           # TypeScript interfaces, conductor commands/events
│   ├── client-routes.md         # /audience, /projector, /controller UI + visual identity
│   ├── audio-engine.md          # Musical design, OSC protocol, track layout, env vars
│   └── server-protocol.md       # WebSocket events, SQLite schema, recovery
├── CHANGELOG.md                 # Change history with intent
├── CLAUDE.md                    # This file
├── DECISIONS.md                 # Design decisions log
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts
│   ├── conductor.ts             # State machine
│   ├── voting.ts                # Vote tallying + VoteResult calculation
│   ├── assembly.ts              # Group assembly logic
│   ├── deliberation.ts          # Group deliberation + ambassador selection
│   ├── ceremony.ts              # Ceremony ambassador lock-in sequencing
│   ├── performer-mix.ts         # Performer mixing surface logic
│   ├── npc.ts                   # NPC event-driven message lookup
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
│   ├── song-building/           # Layer grid, option cards, reveal sequence
│   ├── finale/                  # ElegyGrid, AssemblyCards, DeliberationBoard, CeremonyView, AltarReady, MixingSurface, MixingMirror, GroupIdentity
│   └── controller/              # Operator controls
│
├── hooks/
│   ├── useSocket.ts
│   ├── useShowState.ts
│   └── useAltarDetection.ts     # Device Orientation API for ceremony altar lock-in
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

# Run all tests (315 tests across 12 suites)
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

### High-frequency data (group updates, metering)
These do NOT go through state_sync (too slow/heavy):
- **Group updates**: Server broadcasts `group_update` to audience + projector at ~2 Hz during assembly phase
- **Audio metering**: M4L sends at ~15-30 Hz per track, server aggregates, broadcasts to projector at ~10 Hz
- Both use dedicated socket events, not state mutations

### State filtering by client mode
- **Controller**: full serialized state (Maps converted to arrays)
- **Projector**: public state (no per-user data)
- **Audience**: personalized (user's vote, group assignment, ceremony ambassador status, NPC messages)

### Audio/OSC track layout
- Track index: `attemptIndex * (layersPerAttempt * 2) + layerIndex * 2 + optionOffset`
- 36 fragment tracks (3 attempts × 6 layers × 2 options); group (foldable) tracks are intermixed
- Gain-based control via Utility devices; mute/unmute queries is_foldable to skip group tracks
- Collapse gesture: return track 0 effects enabled, delayed mute after animation
- Song rejection gesture: return track 1 effects enabled
- Config: `config/ableton-layout.json`

# CLAUDE.md — Claude Code Agent Context

## Read Order
1. **This file** (you're here — read fully before doing anything)
2. **ARCHITECTURE.md** — The architecture spec (index + core concepts). Then read only the `docs/` file relevant to your task:
   - Conductor song-building? → `docs/song-building.md` + `docs/data-models.md`
   - Conductor finale? → `docs/finale.md` + `docs/data-models.md`
   - UI components or pages? → `docs/client-routes.md`
   - Audio, OSC, or timing? → `docs/audio-engine.md`
   - WebSocket events or persistence? → `docs/server-protocol.md`
   - Type definitions or conductor API? → `docs/data-models.md`
3. **DECISIONS.md** — Resolved design decisions (with rationale) and open questions (do NOT invent answers)
4. **conductor/types.ts** — Shared type definitions
5. **CHANGELOG.md** — Recent changes with context

**Priority chain:** ARCHITECTURE.md + docs/ > code. If any of these conflict, the docs are correct.

---

## What This System Is

Yggdrasil is an interactive live performance system where ~40 audience members build songs in real time via their phones. The show has 3 song-building attempts, each tied to a narrative chapter (Ambition, Love, Avoidance).

**Song-building (V3.2):** Each attempt has **3 bundled layer groups** (not 6 individual layers). Each group bundles multiple Ableton tracks (e.g., "The Foundation" = bass + drums + percussion). The audience makes 3 binary A/B choices per song — each choice is a big audible vibe shift, not a single instrument swap. Each layer has a **doubt threshold** — if the winning vote proportion falls below it, the song collapses. Thresholds: `[0.50, 0.66, 0.99]`. Each song opens with a **live seed** — a prerecorded loop the performer theatrically "plays" — that anchors the harmonic and rhythmic world. Songs that survive all 3 layers are narratively rejected by the performer (self-sabotage).

**Finale (V3.2):** After the performer abandons the stage, the system **decomposes** the layer groups into their **granular types** (bass, drums, melody, pad, harmony, fx). Each audience member is assigned to one granular type (groups of ~6-7 people). Their phone becomes a live controller — tapping between available fragments, with the group's **majority determining what the room hears** in real time. Crossfades happen at bar boundaries. The performer returns and plays live over the shifting foundation. No assembly, no deliberation rounds, no ambassadors, no altar, no ceremony. Just continuous Incredibox-style collaborative mixing.

**Core architecture:** Next.js + custom server + Socket.IO, Conductor pattern (pure state machine), SQLite persistence, OSC/Ableton bridge, client reconnection/recovery, full-state-sync WebSocket strategy.

**V3.2 migration complete.** See `MIGRATION-V3.2.md` for the original design spec and `MIGRATION-V3.2-TODO.md` for final status.

---

## Critical Rules

### 1. ARCHITECTURE.md + docs/ are the source of truth
ARCHITECTURE.md and the `docs/` files have been updated to reflect V3.2. If code contradicts these docs, the docs are correct. MIGRATION-V3.2.md is retained as a historical reference.

### 2. Types first
When building new features, define the types in `conductor/types.ts` FIRST. Then implement logic. Then wire up server/client. This prevents drift.

### 3. Don't invent answers to open questions
DECISIONS.md has an "Open Decisions" section. If your current task touches one of these, implement a configurable placeholder and add a `// TODO: See DECISIONS.md O[N]` comment. Do not hardcode a guess.

### 4. Conductor is pure
The `conductor/` directory contains pure game logic — no I/O, no Socket.IO, no database calls. All side effects live in `server/`. The conductor receives commands and returns events.

### 5. High-frequency data bypasses state_sync
Live mix state, audition progress, and audio metering use dedicated socket events at high frequency (2–30 Hz). They do NOT go through `state_sync` or persistence.

---

## Project Structure

```
yggdrasil/
├── ARCHITECTURE.md              # Architecture spec (index + core concepts)
├── MIGRATION-V3.2.md            # V3.2 design spec (historical reference)
├── MIGRATION-V3.2-TODO.md       # V3.2 implementation status
├── docs/                        # Detailed specs (load per-task, see ARCHITECTURE.md index)
│   ├── song-building.md         # Layers, voting, doubt threshold, collapse, fragments
│   ├── finale.md                # Finale phases (elegy, assignment, live mix)
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
│   ├── conductor.ts             # State machine (show phases + layer phases)
│   ├── voting.ts                # Vote tallying + doubt threshold check
│   ├── threshold.ts             # Doubt threshold check
│   ├── fragments.ts             # Fragment generation (layer group → granular decomposition)
│   ├── assignment.ts            # Finale group auto/self-select assignment
│   ├── live-mix.ts              # Majority voting, recency tiebreak, initial fragment selection
│   ├── npc.ts                   # NPC event-driven message lookup
│   ├── types.ts                 # Shared types (LayerGroup, GranularType, GranularFragment, etc.)
│   └── __tests__/
│
├── server/
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO handlers + mix_state broadcast
│   ├── persistence.ts           # SQLite
│   ├── backup.ts                # Backup + restore
│   ├── timing.ts                # Quantized timing + audition progress emission
│   ├── osc.ts                   # OSC bridge
│   ├── audio-router.ts          # AUDIO_CUE → OSC mapping (track bundles + granular crossfades)
│   └── __tests__/
│
├── app/                         # Next.js pages
│   ├── audience/page.tsx
│   ├── projector/page.tsx
│   └── controller/page.tsx
│
├── components/
│   ├── LobbyDisplay.tsx         # Projector lobby screen
│   ├── song-building/
│   │   ├── OptionCards.tsx       # A/B voting cards
│   │   ├── RevealSequence.tsx   # Post-vote reveal + threshold check
│   │   ├── LayerProgress.tsx    # 3-layer progress indicator
│   │   ├── AuditionProgress.tsx # Bar-level audition progress
│   │   ├── ThresholdDisplay.tsx # Doubt threshold visualization (projector)
│   │   └── UrgencyEffects.tsx   # Layer urgency visual effects
│   ├── finale/
│   │   ├── ElegyGrid.tsx        # Fragment wreckage display
│   │   ├── AssignmentCards.tsx  # Self-select assignment UI (config-driven)
│   │   ├── AssignmentIdentity.tsx # Post-assignment type identity display
│   │   ├── LiveMixController.tsx # Audience phone: tappable fragment cards
│   │   ├── LiveMixSpectator.tsx  # Read-only view of other types
│   │   ├── LiveMixProjector.tsx  # Projector: all types + consensus viz
│   │   ├── NpcDisplay.tsx       # Terminal-style NPC text
│   │   └── LoopIndicator.tsx    # Loop position progress bar
│   └── controller/
│       ├── ShowControls.tsx     # Phase control buttons
│       ├── VotingControls.tsx   # Vote management
│       ├── LiveMixControls.tsx  # Per-type overrides, locks, vote distributions
│       ├── NpcControls.tsx      # NPC line bank + manual fire
│       ├── EmergencyControls.tsx # Audio panic, state export/import, reset
│       └── MetricsPanel.tsx     # Telemetry dashboard
│
├── hooks/
│   ├── useSocket.ts
│   ├── useShowState.ts
│   ├── useLiveMix.ts            # Live mix state management
│   ├── useAuditionProgress.ts   # High-frequency audition progress (~4 Hz)
│   └── useAudioPreview.ts       # In-browser audio preview playback
│
├── lib/
│   ├── socket-client.ts
│   ├── storage.ts
│   ├── serialization.ts         # Maps → arrays for JSON transport
│   └── identity.ts              # Chapter/layer/group color+symbol mappings
│
├── public/
│   └── audio/
│       └── previews/            # Per-granular-type preview files
│                                # Naming: preview-{songIndex}-{granularType}-{option}.mp3
│
├── config/
│   ├── default-show.json        # Layer groups, granular types, track bundles, thresholds, live seed
│   └── ableton-layout.json      # Track bundle mappings + Utility device config
│
└── db/
    └── schema.sql               # finale_assignments + finale_mix_events tables
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

### High-frequency data (live mix state, audition progress, metering)
These do NOT go through state_sync (too slow/heavy):
- **Live mix state**: Server broadcasts `mix_state` at ~4 Hz during finale_live_mix — per-type active fragments + vote distributions
- **Audition progress**: Server broadcasts `audition_progress` at ~4 Hz during song-building auditioning — bar progress, current option, time remaining
- **Audio metering**: M4L sends at ~15-30 Hz per track, server aggregates, broadcasts to projector at ~10 Hz
- All use dedicated socket events, not state mutations

### State filtering by client mode
- **Controller**: full serialized state (Maps converted to arrays)
- **Projector**: public state (no per-user data, per-type active fragments, consensus visualization)
- **Audience**: personalized (user's vote, assigned granular type, own group's vote distribution, NPC messages)

### Audio/OSC track layout (V3.2)
- **No formula.** Track indices are config-driven — defined explicitly per option per granular type in `default-show.json`
- **Song-building:** Mute/unmute a layer group option = iterate over all tracks in the TrackBundle and send individual OSC commands
- **Finale live mix:** Individual granular tracks controlled independently — crossfade at bar boundaries
- **Live seed:** Separate track group per song, unmuted at attempt_build start, muted on collapse/rejection
- Collapse gesture: return track 0 effects enabled, delayed mute after animation
- Song rejection gesture: return track 1 effects enabled
- Config: `config/default-show.json` (track bundles) + `config/ableton-layout.json`

### Show phase state machine (V3.2)
```
lobby → opener → attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 ... (3 attempts) ...
                 finale_elegy → finale_assignment → finale_live_mix → ended
```

Finale phases: `finale_elegy`, `finale_assignment`, `finale_live_mix`
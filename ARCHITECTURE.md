# Solo Show — Technical Architecture Specification (V3.4)

## Document Purpose
This document and the `docs/` directory are the **authoritative source of truth** for the Solo Show system architecture. It supersedes the V3.3 spec and reflects the V3.4 "Token Pool" redesign of the finale (token-based collaborative composition replacing quilt grid).

**When this document or any file in `docs/` conflicts with code, the spec is correct and the code should be updated.**

**V3.4 migration complete.** See `docs/finale.md` for the authoritative token pool spec.

---

## Project Overview

### What This Is
An interactive live performance system where ~40 audience members help build songs in real time across a theatrical monologue. The show consists of three story/song-building cycles and a collaborative finale. Each song starts with a **live seed** — a prerecorded loop the performer theatrically "plays" — then the audience makes 3 binary A/B choices per song. Each choice selects between **bundled layer groups** (e.g., "The Foundation" = bass + drums), making each vote a big audible vibe shift. Each layer has a **doubt threshold** — if the winning vote proportion falls below it, the song collapses. Thresholds: `[0.50, 0.66, 0.99]`. Songs that survive all 3 layers are narratively rejected by the performer (self-sabotage). In the finale, the audience — abandoned by the performer — answers emotional questions whose votes generate **tokens** (one per vote, colored by song). The performer arranges these tokens on a **pentagon of granular types**, and the remix plays with loop-quantized crossfades as tokens are moved between nodes.

### Core Metaphor
> **"If I can build a song, I can build a life."**

The audience is framed as the performer's inner council — parts of the subconscious trying to cohere into a finished creative work. Disagreement is internal conflict. A collapsing song is a moment where doubt overwhelms commitment. The performer's rejection of a completed song is self-sabotage. The finale proves that integration was always possible — the council self-organizes, each part finds its role, and the fragments fit together without the ego directing them.

### Design Principles
1. **Story is uninterrupted.** Audience phones are used only during music-building and finale phases.
2. **Music is the metaphor.** No external props are required for meaning.
3. **Central timing, distributed choice.** The system runs on a master musical clock: audience controls *what* and *how*, not *when*.
4. **Legibility over complexity.** Binary choices, consistent visual cues, minimal UI.
5. **Safety constraints.** All musical actions are quantized and bounded so outputs remain coherent.
6. **Finale = collective agency.** After the performer abandons the stage, the audience answers emotional questions whose votes generate tokens. The performer arranges tokens on a pentagon of granular types, shaping a collaborative remix.
7. **Projector tells the story, phone is the instrument.** Visual narrative lives on the projector; audience phones are input devices and personal audio preview tools.

---

## Terminology

| Term | Definition |
|------|------------|
| **Attempt** | One story/song-building cycle. The show has 3 attempts, each tied to a chapter. |
| **Chapter** | A thematic identity: Ambition (Song 1), Love (Song 2), Acceptance (Song 3). Chapters have consistent colors/icons throughout. |
| **Layer Group** | A bundled set of Ableton tracks that the audience votes on as a unit. Each attempt has **3 layer groups** (bones, flesh, spark). Each group bundles multiple granular types (e.g., bones = bass + drums). |
| **Granular Type** | An individual musical role within a layer group: bass, drums, pad, harmony, fx. Plus **seed** — the live seed tracks from song-building, which become controllable fragments in the finale. During song-building, layer groups are bundled. During the finale, they are decomposed for individual control. |
| **TrackBundle** | A collection of `GranularTrackRef` entries — the Ableton tracks for one option (A or B) of a layer group. Config-driven, not formula-based. |
| **Live Seed** | A prerecorded loop the performer theatrically "plays" at the start of each song. Anchors the harmonic and rhythmic world. Separate Ableton tracks per song, unmuted when `attempt_build` starts, muted on collapse/rejection. In the finale, live seed tracks become the **seed** granular type — one fragment per attempted song. |
| **Option** | One of 2 choices (A or B) within a layer group. Binary choice. |
| **Lock-in** | When a layer group's winning option is confirmed and becomes part of the song stack. |
| **Doubt Threshold** | A per-layer pass/fail check. Each layer has a configurable threshold. Default curve: `[0.50, 0.66, 0.99]`. Layer 0 always passes, layer 2 almost always collapses. No cumulative state — each vote is independent. |
| **Collapse** | When a layer's winning vote proportion falls below its doubt threshold. The song "falls apart" — audio collapses via OSC-triggered effect, current and all unreached layers are lost. Fragments from reached layers survive for the finale. |
| **Blind Vote** | The song-building voting mechanic. Audience votes without seeing live split feedback. Results are revealed after the window closes. |
| **Reveal** | The post-vote moment when the A/B split is shown, the threshold check is visualized, and the winning option locks in. |
| **Song Rejection** | The performer's narrative act of rejecting a **completed** song (one that survived all layers without collapsing). Triggered manually via controller; accompanied by an OSC-triggered audio effect. Only applies when the song completes — collapsed songs are already dead. |
| **Fragment** | An option from a reached layer during song-building, available in the finale. Which options survive is configurable via `bothOptionsSurvive` — when true, both A and B from voted layers are available; when false, only winners survive. |
| **Locked Fragment** | A fragment visible in the pre-game "elegy" display but not available during gameplay. Includes: both options from unreached layers (due to collapse), and losing options from voted layers when `bothOptionsSurvive` is false. Represents "what could have been." |
| **Token** | A unit generated from an audience vote during `finale_vote`. Each vote produces one token colored by the song it references (song 0, 1, or 2). Tokens are placed on pentagon nodes (granular types) during the remix. |
| **Token Pool** | The collection of all tokens generated during the vote phase. The performer draws from the pool and arranges tokens on the pentagon during the remix. |
| **Pentagon Node** | One of the granular type positions on the remix pentagon. Each node holds tokens that determine which song's audio plays for that type. Track resolution: `trackMap[granularType][songIndex] → trackIndex`. |
| **NPC** | A system-controlled narrative voice displayed on audience phones during the finale. Reacts to key events (performer abandonment, assignment, live mix start). Terminal-style typeface. Event-driven. |
| **Loop Boundary** | The downbeat of each 8-bar loop cycle. All audio changes are quantized to these boundaries. |
| **Layer Group Identity** | Consistent color + symbol for each layer group, derived from its first granular type (bones→■, flesh→✦, spark→~). |
| **Chapter Identity** | Consistent color + icon for each chapter, used across all UIs. |

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  /audience      │  /projector     │  /controller                │
│  (~40 users)    │  (1 display)    │  (performer/operator)       │
└────────┬────────┴────────┬────────┴──────────────┬──────────────┘
         │                 │                       │
         └─────────────────┼───────────────────────┘
                           │ WebSocket (Socket.IO)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SERVER (Node.js)                               │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │    Next.js     │  │    Socket.IO     │  │   Persistence    │  │
│  │  (page routes) │  │    (real-time)   │  │    (SQLite)      │  │
│  └────────────────┘  └────────┬─────────┘  └──────────────────┘  │
│                               │                                   │
│                      ┌────────▼─────────┐                        │
│                      │    Conductor     │  ← Pure state machine  │
│                      │   (show logic)   │                        │
│                      └──────────────────┘                        │
│  ┌──────────────────┐  ┌──────────────────┐                      │
│  │  Timing Engine   │  │   OSC Bridge     │  ← Ableton Live      │
│  │ (quantized       │◄─┤  (bidirectional) │    integration       │
│  │  advance)        │  └────────┬─────────┘                      │
│  └──────────────────┘          │                                  │
└──────────────────────────────────┼──────────────────────────────┘
                                   │ OSC over UDP (localhost)
                                   ▼
                    ┌──────────────────────────────┐
                    │   Ableton Live + AbletonOSC    │
                    │   (musical timing, audio)     │
                    └──────────────────────────────┘
```

### Architecture: Next.js with Custom Server

Unchanged from V1. Single process serves Next.js pages and real-time show logic via Socket.IO.

### Deployment Model

Unchanged from V1. Cloud-hosted server with local Ableton bridge.

---

## Show Phase State Machine

```
lobby → opener → attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 finale_vote → finale_remix → epilogue → ended
```

### Phase Details

```typescript
type ShowPhase =
  | 'lobby'                    // Audience joining, scanning QR codes
  | 'opener'                   // Performer monologue (phones dark)
  | 'attempt_story'            // Story phase for current attempt (phones dark)
  | 'attempt_build'            // Song-building phase: 3 bundled layer groups (phones active)
  | 'attempt_resolve'          // Song completed; performer rejects it (phones dim/watch)
  | 'finale_vote'              // Audience answers emotional questions; votes generate tokens
  | 'finale_remix'             // Performer arranges tokens on pentagon; remix plays with crossfades
  | 'epilogue'                 // Master faded out; performer closing monologue (phones dark)
  | 'ended';                   // Exit music playing; audience dismissed
```

**Note:** `attempt_story`, `attempt_build`, and `attempt_resolve` are parameterized by `currentAttemptIndex` (0, 1, 2). `attempt_resolve` is only entered when a song completes (all 3 layers pass their thresholds). Collapsed songs skip `attempt_resolve`.

### Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `lobby` | `opener` | Manual | |
| `opener` | `attempt_story` | Manual | Sets currentAttemptIndex = 0 |
| `attempt_story` | `attempt_build` | Manual | Activates voting UI |
| `attempt_build` | `attempt_resolve` | **Auto** | When all 3 layer groups voted on AND all pass their thresholds |
| `attempt_build` | `attempt_story` | **Auto** | When doubt threshold not met (collapse); increments attempt index |
| `attempt_build` (attempt 2) | `finale_vote` | **Auto** on collapse, or Manual after rejection | Song 3 → finale regardless of outcome |
| `attempt_resolve` | `attempt_story` | Manual | Performer triggers rejection + advance; increments attempt index |
| `attempt_resolve` (attempt 2) | `finale_vote` | Manual | After Song 3 rejection |
| `finale_vote` | `finale_remix` | **Auto** or Manual | When all questions answered or timer expires |
| `finale_remix` | `epilogue` | Manual (END_SHOW) or **Auto** (POOL_EMPTY) | Master fades out; deferred panic silences tracks after fade |
| `epilogue` | `ended` | Manual (END_SHOW) | Restarts transport, restores master, fades in exit music if configured |

---

## Detailed Specifications

Read the sections above first, then load only the docs relevant to your task:

| If you're working on... | Read... |
|---|---|
| Conductor song-building logic | [docs/song-building.md](docs/song-building.md) + [docs/data-models.md](docs/data-models.md) |
| Conductor finale logic | [docs/finale.md](docs/finale.md) + [docs/data-models.md](docs/data-models.md) |
| UI components or pages | [docs/client-routes.md](docs/client-routes.md) |
| Audio, OSC, or timing | [docs/audio-engine.md](docs/audio-engine.md) |
| WebSocket events or persistence | [docs/server-protocol.md](docs/server-protocol.md) |
| Type definitions or conductor API | [docs/data-models.md](docs/data-models.md) |

### Document Index

| File | Contents |
|------|----------|
| [docs/song-building.md](docs/song-building.md) | Layer structure, staggered ordering, blind vote, doubt thresholds, collapse, rejection, fragment generation |
| [docs/finale.md](docs/finale.md) | Finale sub-phases (vote, remix), token pool model, NPC system, FinaleState type |
| [docs/data-models.md](docs/data-models.md) | TypeScript interfaces (User, ShowState, ShowConfig, Fragment), Conductor commands & events, VoteResult |
| [docs/client-routes.md](docs/client-routes.md) | /audience, /projector, /controller UI specs, visual identity system (colors, symbols) |
| [docs/audio-engine.md](docs/audio-engine.md) | Musical design spec, track layout, playback modes, OSC protocol, environment variables |
| [docs/server-protocol.md](docs/server-protocol.md) | WebSocket protocol, SQLite persistence schema, recovery |

---

## Folder Structure

```
solo-show/
├── ARCHITECTURE.md              # This document (V3.4 — index + core concepts)
├── docs/                        # Detailed specifications (see index above)
│   ├── song-building.md
│   ├── finale.md
│   ├── data-models.md
│   ├── client-routes.md
│   ├── audio-engine.md
│   └── server-protocol.md
├── MIGRATION.md                 # Migration guide from V2 to V3
├── PROMPTS.md                   # AI agent implementation prompts
├── CHANGELOG.md                 # Human-readable change history with intent
├── CLAUDE.md                    # AI agent instructions and context
├── DECISIONS.md                 # Open questions and resolved decisions
├── README.md                    # Setup and run instructions
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts                 # Exports
│   ├── conductor.ts             # State machine (show phases + layer phases)
│   ├── voting.ts                # Blind vote tallying
│   ├── threshold.ts             # Doubt threshold check
│   ├── question-engine.ts       # Question delivery logic for vote phase
│   ├── remix-engine.ts          # Token pool management and remix state
│   ├── token-pool.ts            # Token generation from votes
│   ├── fragments.ts             # Fragment generation from attempt results (for elegy display)
│   ├── intrusive-thoughts.ts    # Pure thought assignment (shared pool → per-user distribution)
│   ├── npc.ts                   # NPC event-driven message logic
│   ├── types.ts                 # Shared type definitions
│   └── __tests__/               # Unit tests
│
├── server/                      # Custom server (Next.js + Socket.IO)
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO event handlers
│   ├── persistence.ts           # SQLite layer
│   ├── backup.ts                # State backup and restore
│   ├── timing.ts                # Quantized timing engine (loop boundary detection)
│   ├── osc.ts                   # OSC bridge for Ableton
│   ├── audio-router.ts          # Maps AUDIO_CUE events to OSC messages
│   ├── __tests__/
│   └── tools/
│       ├── osc-mock-ableton.ts  # Mock Ableton for testing
│       └── simulate-audience.ts # 40+ simulated audience clients for load testing
│
├── app/                         # Next.js App Router (pages)
│   ├── layout.tsx
│   ├── page.tsx                 # Landing/redirect
│   ├── audience/
│   │   └── page.tsx
│   ├── projector/
│   │   └── page.tsx
│   └── controller/
│       └── page.tsx
│
├── components/                  # React components
│   ├── LobbyDisplay.tsx         # Projector lobby screen
│   ├── projector/               # Canvas 2D projector visualization
│   │   ├── ProjectorCanvas.tsx  # Fullscreen canvas + render loop
│   │   ├── useProjectorState.ts # Visual state derivation from conductor state
│   │   └── renderers/           # Pure drawing functions
│   │       ├── shared.ts        # Noise, membrane, color utils, layout constants
│   │       ├── skeleton.ts      # Pentagon nodes, seed node, connectors, arcs
│   │       ├── audition.ts      # A/B labels, header, "NOW PLAYING" indicator
│   │       ├── reveal.ts        # Two-beat reveal: stakes + verdict animations
│   │       └── thoughts-physics.ts # Intrusive thoughts physics engine + membrane renderer
│   ├── song-building/
│   │   ├── OptionCards.tsx       # A/B voting cards with inline reveal mode (audience)
│   │   ├── MiniSkeleton.tsx     # Canvas mini pentagon for audience phones
│   │   ├── AuditionBars.tsx     # Depleting progress bars during audition
│   │   ├── LayerDots.tsx        # 3-dot layer progress indicator
│   │   ├── IntrusiveThoughts.tsx # Draggable thought bubble overlay (audience)
│   │   ├── RevealSequence.tsx   # Post-vote reveal animation (audience)
│   │   ├── ThresholdDisplay.tsx # Doubt threshold visualization (audience)
│   │   └── UrgencyEffects.tsx   # Layer urgency visual effects
│   ├── finale/
│   │   ├── ProjectorFinale.tsx  # Projector pentagon + token pool visualization
│   │   ├── NpcDisplay.tsx       # Terminal-style NPC text
│   │   └── LoopIndicator.tsx    # Loop position progress bar
│   └── controller/
│       ├── ShowControls.tsx     # Phase control buttons
│       ├── VotingControls.tsx   # Vote management
│       ├── RemixController.tsx   # Controller UI for remix phase
│       ├── NpcControls.tsx      # NPC line bank + manual fire
│       ├── EmergencyControls.tsx # Audio panic, state export/import, reset
│       └── MetricsPanel.tsx     # Telemetry dashboard
│
├── hooks/
│   ├── useSocket.ts             # Socket.IO connection + reconnection
│   ├── useShowState.ts          # Client-side state management
│   ├── useRemixState.ts         # Remix state management hook
│   ├── useAuditionProgress.ts   # High-frequency audition progress (~4 Hz)
│   ├── useAudioPreview.ts       # In-browser audio preview playback
│   ├── useIntrusiveThoughts.ts  # Audience: server-assigned thought subscription + dismiss
│   └── useProjectorThoughts.ts  # Projector: thought state → physics engine bridge
│
├── lib/
│   ├── socket-client.ts         # Socket.IO client setup
│   ├── storage.ts               # localStorage for client identity
│   ├── serialization.ts         # Map/Set JSON serialization
│   └── identity.ts              # Chapter/layer color+symbol mappings
│
├── public/
│   └── audio/
│       └── previews/            # Per-granular-type preview files
│                                # Naming: preview-{songIndex}-{granularType}-{option}.mp3
│
├── config/
│   ├── default-show.json        # Layer groups, granular types, track bundles, thresholds, live seed, finale config, NPC messages
│   └── ableton-layout.json      # Track index mappings + Utility device config
│
├── db/
│   └── schema.sql               # SQLite schema (V3.4)
│
├── next.config.js
├── tsconfig.json
├── package.json
└── .gitignore
```

---

## AI-First Development Practices

Unchanged from V1. See original architecture for context management, making changes, and handling design uncertainty guidelines.

**Updated test name examples:**
```typescript
test('layer collapses when winning proportion falls below doubt threshold', ...)
test('blind vote does not expose split during voting window', ...)
test('doubt thresholds escalate per layer index', ...)
test('completed attempt transitions to attempt_resolve for rejection', ...)
test('unreached layers are marked as locked fragments in finale', ...)
test('vote generates token with correct song index', ...)
test('question engine delivers questions in configured order', ...)
test('token placement on pentagon node triggers track crossfade', ...)
test('remix state tracks token positions across pentagon nodes', ...)
test('loop-quantized crossfade resolves at next loop boundary', ...)
```

---

## Open Questions (To Be Resolved)

- [ ] **Song rejection audio effect:** Exact Ableton effect chain and OSC trigger method. Should be distinct from collapse effect.
- [ ] **Collapse audio effect:** Exact Ableton effect chain for when a song collapses. Should be distinct from rejection effect.
- [ ] **Exact chord progression:** B minor key confirmed; specific 4-chord sequence TBD pending Ableton exploration.
- [ ] Locked color/symbol assignments for granular types + chapters
- [ ] Specific fragment display labels (emotional taglines per option)
- [ ] NPC text library (event-driven messages per phase)
- [ ] Projector visual design and animations (especially live mix consensus visualization)
- [ ] Live performance track configuration
- [x] ~~**Crossfade duration:** Implemented via `GainConfig.crossfadeBeats` (default: 1 beat).~~

---

## Appendix A: What Changed from V1 → V2

### Removed Systems
- **Per-layer doubt thresholds** → replaced by Health Bar with cumulative drain and layer multipliers (V2); **Health Bar reversed back to per-layer doubt thresholds in V3.1**
- **Chapter assignment** → no chapter assignment in finale
- **Individual fragment selection** → replaced by consensus game (V2)
- **Fragment queue / rotation system** → replaced by consensus game + performer mix (V2)
- **Stewardship / safe parameter control** → removed entirely
- **Triangle steering / centroid** → removed entirely
- **Active slots (7-slot rotation)** → replaced by role-typed layer activation
- **Audio metering (M4L → projector)** → removed (may be re-added for projector visuals)

### New Systems (V2)
- **Health Bar** with cumulative drain + configurable layer multipliers — *replaced by per-layer doubt thresholds in V3.1*
- **Mechanical collapse** when health bar reaches zero — *replaced by per-layer threshold check in V3.1*
- **Blind vote** with reveal sequence
- **Song rejection** for completed songs
- **Consensus Game** (convergence meter, timed rounds, threshold softening) — *replaced in V3*
- **NPC system** (hybrid auto/manual) — *simplified in V3*
- **Performer mixing surface** (6×6 grid, pending changes queue, loop quantization)
- **Snapshot presets** for performer mix
- **Musical design specification** (harmonic rules, EQ fencing, production guidelines)

---

## Appendix B: What Changed from V2 → V3

### Removed Systems
- **Consensus Game** — convergence meter, timed consensus rounds, threshold softening, convergence calculation. Replaced by physically embodied group assembly + deliberation + ceremony.
- **Convergence Meter** — no longer needed; groups vote transparently within themselves.
- **NPC auto-trigger system** — the complex per-round auto-trigger conditions are replaced by simpler event-driven messages tied to phase transitions and key moments.
- **`consensus_rounds` DB table** — replaced by `finale_groups`, `finale_group_votes`, and `ceremony_events` tables.
- **`useConvergence` hook** — removed (no convergence meter to animate).
- **`ConsensusBoard.tsx`** and **`ConvergenceMeter.tsx`** components — removed.
- **`consensus-game.ts`** conductor module — removed.
- **`npc-triggers.json`** config — replaced by `npc-messages.json` (event-driven).
- **Web Speech Synthesis** — considered and deferred.
- **Vibration API** — considered and deferred (except single vibration on altar lock-in confirmation).

### New Systems
- **Group Assembly** — timer-based self-selection into 6 layer-type groups with live size display. Random assignment for undecided members at timer expiry. Empty groups allowed (layer skipped).
- **Deliberation** — per-group audio preview + transparent majority voting + ambassador volunteering. Timer-based resolution. Forfeited layers when no ambassador volunteers.
- **Ambassador Ceremony** — fixed-order sequential lock-in at a physical altar. Accelerometer detection (Device Orientation API) for face-down phone placement. Immediate audio activation on lock-in.
- **Audio Preview System** — pre-rendered mp3 files per fragment, served statically, played in-browser during deliberation via HTML5 Audio API.
- **Altar Detection** — Device Orientation / Accelerometer API to detect face-down + still phone as the ceremony lock-in gesture. No external hardware required.
- **`assembly.ts`**, **`deliberation.ts`**, **`ceremony.ts`** conductor modules.
- **`useAudioPreview`** and **`useAltarDetection`** hooks.
- **`AssemblyCards`**, **`DeliberationBoard`**, **`AudioPreview`**, **`AmbassadorPrompt`**, **`CeremonyView`**, **`AltarReady`** components.
- **`finale_groups`**, **`finale_group_votes`**, **`ceremony_events`** DB tables.

### Changed Systems
- **Show phase state machine**: `finale_consensus` replaced by `finale_assembly` → `finale_deliberation` → `finale_ceremony` (three phases instead of one).
- **FinaleState type**: completely restructured — consensus game state replaced by assembly, deliberation, and ceremony state objects.
- **FinaleConfig**: consensus config (round duration, thresholds, decay) replaced by assembly/deliberation/ceremony config (timer durations, ceremony order, preview paths, layer labels).
- **Conductor commands/events**: all consensus-related commands/events removed; replaced with assembly, deliberation, and ceremony commands/events.
- **WebSocket events**: `consensus_vote` removed; `join_group`, `group_vote`, `volunteer_ambassador`, `altar_lock_in` added. `convergence_update` removed; `group_update`, `ambassador_called`, `altar_ready`, `altar_confirmed` added.
- **NPC system**: simplified from hybrid auto-trigger + manual to event-driven + manual. Messages are tied to phase transitions rather than per-round pattern matching.
- **Fragment type**: gains `previewAudioPath` field for audio preview support.
- **GainConfig**: `consensusSwellBeats` renamed to `ceremonySwellBeats`.
- **Environment variables**: consensus variables replaced with assembly/deliberation/ceremony variables.
- **Folder structure**: `consensus-game.ts` → `assembly.ts` + `deliberation.ts` + `ceremony.ts`. Component files renamed/replaced. New hooks added. `public/audio/previews/` directory added. `npc-triggers.json` → `npc-messages.json`.

---

## Appendix C: What Changed from V3 → V3.1

### Key Changes
- **Health Bar → Doubt Thresholds**: Cumulative health bar with drain replaced by per-layer pass/fail threshold checks. No cumulative state — each vote is independent. Thresholds escalate per layer.
- **7 layers → 6 layers**: FX1/FX2 consolidated into a single FX layer. Layer types: Melody, Drums, Pad, Bass, Harmony, FX.
- **`health-bar.ts` removed**: Threshold logic integrated into `voting.ts`.
- **`bothOptionsSurvive` config**: Fragment generation is configurable — both options from voted layers can survive for the finale.

---

## Appendix D: What Changed from V3.1 → V3.2

**V3.2 migration in progress.** See `MIGRATION-V3.2.md` for the full implementation plan.

### Song-Building Redesign (Complete)
- **6 individual layers → 3 bundled layer groups**: Each attempt now has 3 layer groups (bones, flesh, spark), each bundling multiple Ableton tracks. The audience makes 3 big A/B choices per song, not 6.
- **LayerConfig → V32LayerConfig**: Uses `group: LayerGroupId` + `TrackBundle` (with `GranularTrackRef[]`) instead of `type: LayerType` + `AudioReference`.
- **V32AttemptConfig**: Replaces `AttemptConfig` — includes `liveSeed: LiveSeedConfig` alongside 3-layer structure.
- **Live seed tracks**: Each song opens with prerecorded loops unmuted at `attempt_build` start, muted on collapse/rejection.
- **Threshold curve**: `[0.50, 0.66, 0.99]` — Layer 0 always passes, Layer 2 almost always collapses (needs near-unanimity).
- **Config-driven track layout**: Track indices are explicit per option per granular type in `default-show.json`, not formula-derived.
- **AudioCue changes**: `audioRef`/`otherAudioRef` → `trackBundle`/`otherTrackBundle`; `winnerAudioRef`/`loserAudioRef` → `winnerTrackBundle`/`loserTrackBundle`. New cues: `live_seed_start`, `live_seed_stop`.
- **Stagger table**: Each group (bones/flesh/spark) appears at position 0 in exactly one song across the 3 attempts.
- **`LAYERS_PER_ATTEMPT`**: Changed from 6 to 3.

### Finale Redesign (Superseded by V3.3)
- **Assembly/Deliberation/Ceremony removed**: Replaced by automatic granular type assignment + Incredibox-style live mix.
- **New phases**: `finale_assignment` (auto/self-select into granular types), `finale_live_mix` (continuous collaborative mixing).
- **Note:** The V3.2 live mix finale was superseded by the V3.3 "Quilt" model. See Appendix E.

---

## Appendix E: What Changed from V3.2 → V3.3

**V3.3 "Quilt" — superseded by V3.4.** The quilt model (grid of cells, audience claims cells, playhead sweeps columns) has been fully replaced by the V3.4 "Token Pool" model. See Appendix F.

---

## Appendix F: What Changed from V3.3 → V3.4

**V3.4 "Token Pool" migration complete.** See `docs/finale.md` for the authoritative spec.

### Removed Systems
- **Quilt grid**: 6 rows × N columns grid where each cell held a song choice. Replaced by token pool + pentagon nodes.
- **Cell claiming / assignment**: Audience claimed individual grid cells. Replaced by question-driven vote phase that generates tokens automatically.
- **Preview phase** (`finale_preview`): Private song exploration with lock-in. Removed — audience interaction is now through answering questions.
- **Playback phase** (`finale_playback`): Quilt playback with column-sweeping playhead. Replaced by `finale_remix` — continuous remix with loop-quantized crossfades.
- **Elegy phase** (`finale_elegy`): Fragment wreckage display. Removed.
- **Assignment phase** (`finale_assignment`): Cell claiming phase. Removed.
- **Column timing / column crossfade**: Column-boundary-driven track switching. Replaced by loop-quantized crossfades triggered by token placement.
- **Audience remix config** (`QuiltConfig.audienceRemix`): Cell movement permissions. No longer applicable.
- **Quilt arc system**: Automated sorting + energy scoring + staggered entry/exit. Removed.
- **`conductor/quilt.ts`**, **`conductor/quilt-arc.ts`**, **`conductor/assignment.ts`**: Removed.
- **`components/finale/QuiltGrid.tsx`**, **`QuiltPreview.tsx`**, **`QuiltRemix.tsx`**, **`ElegyGrid.tsx`**: Removed.
- **`components/controller/QuiltRemixControls.tsx`**: Removed.
- **`hooks/useQuilt.ts`**: Removed.
- **`finale_quilt_cells`** and **`finale_remix_events`** DB tables: Removed.

### New Systems
- **Question engine** (`conductor/question-engine.ts`): Delivers emotional questions to the audience during `finale_vote`. Each vote generates a token.
- **Token pool** (`conductor/token-pool.ts`): Generates tokens from votes. Each token is colored by the song it references (song 0, 1, or 2).
- **Remix engine** (`conductor/remix-engine.ts`): Manages token placement on pentagon nodes (granular types) and remix state.
- **Pentagon visualization** (`components/finale/ProjectorFinale.tsx`): Projector displays pentagon of granular types with token pool.
- **Remix controller** (`components/finale/RemixController.tsx`): Controller UI for the performer to arrange tokens during remix.
- **Remix state hook** (`hooks/useRemixState.ts`): Client-side remix state management.
- **Loop-quantized crossfades**: Track changes triggered by token placement, quantized to loop boundaries.

### Changed Systems
- **Show phase state machine**: `finale_elegy` → `finale_assignment` → `finale_preview` → `finale_playback` replaced by `finale_vote` → `finale_remix`.
- **FinaleState type**: `V34FinaleState` renamed to `FinaleState`. Quilt state replaced by token pool + remix state.
- **FinaleConfig type**: `V34FinaleConfig` renamed to `FinaleConfig`. Contains `vote: VotePhaseConfig` and `remix: RemixConfig` instead of `quilt: QuiltConfig`.
- **ShowConfig**: `finale` key uses `FinaleConfig` directly (no more `finaleV34` intermediate key).
- **ProjectorFinaleView**: `ProjectorFinaleV34View` renamed to `ProjectorFinaleView`.
- **NPC event keys**: Updated for new phases — vote and remix events replace quilt-specific events.
- **Audio cues**: Token placement and remix cues replace quilt playback/column/cell cues.

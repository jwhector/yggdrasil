# Solo Show — Technical Architecture Specification (V3)

## Document Purpose
This document and the `docs/` directory are the **authoritative source of truth** for the Solo Show system architecture. It supersedes the V2 ARCHITECTURE.md and reflects a complete redesign of the finale system — replacing the consensus game with a physically embodied, four-phase sequence (group assembly, deliberation, ambassador ceremony, performer mix).

**When this document or any file in `docs/` conflicts with code, the spec is correct and the code should be updated.**

---

## Project Overview

### What This Is
An interactive live performance system where ~40 audience members help build songs in real time across a theatrical monologue. The show consists of three story/song-building cycles and a collaborative finale. The audience makes blind binary choices to layer musical elements while a Health Bar tracks the cumulative cost of their disagreement. Each layer costs more than the last (rising resistance), and if the Health Bar reaches zero, the song collapses — unreached layers are lost. Songs that survive all layers are narratively rejected by the performer anyway (self-sabotage). In the finale, the audience — abandoned by the performer — physically self-organizes into seven groups (one per layer type), deliberates on which fragment to carry forward, selects ambassadors, and ceremonially locks each layer into the final mix at a physical altar. The fragments, drawn from three different songs and emotional chapters, reveal through sound alone that they were always harmonically compatible. The performer returns to co-create the climax.

### Core Metaphor
> **"If I can build a song, I can build a life."**

The audience is framed as the performer's inner council — parts of the subconscious trying to cohere into a finished creative work. Disagreement is internal conflict. A collapsing song is the cumulative weight of internal division. The performer's rejection of a completed song is self-sabotage. The finale proves that integration was always possible — the council self-organizes, each part finds its role, and the fragments fit together without the ego directing them.

### Design Principles
1. **Story is uninterrupted.** Audience phones are used only during music-building and finale phases.
2. **Music is the metaphor.** No external props are required for meaning.
3. **Central timing, distributed choice.** The system runs on a master musical clock: audience controls *what* and *how*, not *when*.
4. **Legibility over complexity.** Binary choices, consistent visual cues, minimal UI.
5. **Safety constraints.** All musical actions are quantized and bounded so outputs remain coherent.
6. **Finale = embodiment + integration.** Audience physically self-organizes, deliberates, and ceremonially assembles the final song. The reveal arrives through the ear, not explanation.
7. **Projector tells the story, phone is the instrument.** Visual narrative lives on the projector; audience phones are input devices and personal audio preview tools.

---

## Terminology

| Term | Definition |
|------|------------|
| **Attempt** | One story/song-building cycle. The show has 3 attempts, each tied to a chapter. |
| **Chapter** | A thematic identity: Ambition (Song 1), Love (Song 2), Avoidance (Song 3). Chapters have consistent colors/icons throughout. |
| **Layer** | A single musical element within a song attempt. Each attempt has 7 layers. Each layer has a type (Melody, Drums, Pad, Bass, Harmony, FX1, FX2). |
| **Option** | One of 2 choices (A or B) within a layer. Binary choice. |
| **Lock-in** | When a layer's winning option is confirmed and becomes part of the song stack. |
| **Health Bar** | A visible gauge representing the song's vitality. Drains after each vote based on the losing vote proportion multiplied by a configurable layer multiplier. When it reaches zero, the song **collapses** — the current and all subsequent layers are lost. |
| **Drain** | The amount subtracted from the Health Bar after a vote. Equal to the losing side's proportion × 100 × drain factor × layer multiplier. |
| **Layer Multiplier** | A configurable per-layer scaling factor for drain. Increases with layer depth, representing the rising cost of creative commitment. Early layers are cheap; late layers are expensive. |
| **Collapse** | When the Health Bar reaches zero. The song "falls apart" — audio collapses via OSC-triggered effect, current and all unreached layers are lost. Fragments from reached layers survive for the finale. |
| **Blind Vote** | The song-building voting mechanic. Audience votes without seeing live split feedback. Results are revealed after the window closes. |
| **Reveal** | The post-vote moment when the A/B split is shown, the health bar drains, and the winning option locks in. |
| **Song Rejection** | The performer's narrative act of rejecting a **completed** song (one that survived all layers without collapsing). Triggered manually via controller; accompanied by an OSC-triggered audio effect. Only applies when the song completes — collapsed songs are already dead. |
| **Fragment** | A winning option from a reached layer during song-building, available in the finale. Only winners from layers that were actually voted on survive. |
| **Locked Fragment** | A fragment visible in the pre-game "elegy" display but not available during gameplay. Includes: losing options from voted layers AND both options from unreached layers (due to collapse). Represents "what could have been." |
| **Group Assembly** | The first active finale phase. Audience members self-select into one of 7 layer-type groups by choosing a role on their phone, then physically finding others who chose the same role. Timer-based; undecided members are randomly assigned when the timer expires. |
| **Deliberation** | The second active finale phase. Each group privately previews available fragments for their layer type on their phones and votes for which fragment to carry into the final song. Timer-based; majority wins when the timer expires. |
| **Audio Preview** | In-browser playback of pre-rendered fragment audio files during deliberation. Each audience member controls playback independently on their own phone. |
| **Ambassador** | One volunteer from each group who carries the group's chosen fragment to the altar during the ceremony. Selected by volunteering; random selection if multiple volunteers; layer forfeited if no volunteer. |
| **Ceremony** | The third active finale phase. Ambassadors are called one at a time in a fixed configurable order. Each approaches the altar and locks their group's fragment into the final mix by placing their phone face-down on the altar surface. |
| **Altar** | A physical surface on stage. Requires no electronics — the ambassador's phone detects the face-down placement via the accelerometer. The altar's power is accumulated from staging and narrative, not technology. |
| **Altar Lock-in** | The gesture that activates a fragment: the ambassador places their phone face-down on the altar and holds it still for ~2 seconds. Detected via Device Orientation / Accelerometer API. Triggers immediate audio activation (quantized to next bar boundary). |
| **NPC** | A system-controlled narrative voice displayed on audience phones during the finale. Reacts to key events (performer abandonment, group formation, ceremony moments). Terminal-style typeface. Event-driven, not auto-triggered on a per-round basis. |
| **Performer Mix** | The final phase of the finale. The performer live-mixes fragments using a visual mixing surface, with changes quantized to loop boundaries. Initial state is pre-loaded from the ceremony results. |
| **Pending Changes** | Fragment activations/deactivations queued by the performer that fire simultaneously at the next loop boundary. |
| **Loop Boundary** | The downbeat of each 8-bar loop cycle. All audio changes are quantized to these boundaries. |
| **Layer Identity** | Consistent color + symbol for each layer type, used across all 3 attempts. |
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
                 finale_elegy → finale_assembly → finale_deliberation → finale_ceremony → finale_performer_mix → ended
```

### Phase Details

```typescript
type ShowPhase =
  | 'lobby'                    // Audience joining, scanning QR codes
  | 'opener'                   // Performer monologue (phones dark)
  | 'attempt_story'            // Story phase for current attempt (phones dark)
  | 'attempt_build'            // Song-building phase for current attempt (phones active)
  | 'attempt_resolve'          // Song completed; performer rejects it (phones dim/watch)
  | 'finale_elegy'             // Audience sees full fragment wreckage (phones passive)
  | 'finale_assembly'          // Audience self-selects into 7 layer-type groups (phones active)
  | 'finale_deliberation'      // Groups preview fragments, vote, select ambassadors (phones active)
  | 'finale_ceremony'          // Ambassadors lock fragments at the altar (phones active for ambassadors)
  | 'finale_performer_mix'     // Performer live-mixes and escalates (phones TBD)
  | 'ended';
```

**Note:** `attempt_story`, `attempt_build`, and `attempt_resolve` are parameterized by `currentAttemptIndex` (0, 1, 2). `attempt_resolve` is only entered when a song completes (health bar > 0 after all layers). Collapsed songs skip `attempt_resolve`.

### Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `lobby` | `opener` | Manual | |
| `opener` | `attempt_story` | Manual | Sets currentAttemptIndex = 0 |
| `attempt_story` | `attempt_build` | Manual | Activates voting UI |
| `attempt_build` | `attempt_resolve` | **Auto** | When all layers voted on AND health bar > 0 |
| `attempt_build` | `attempt_story` | **Auto** | When health bar reaches 0 (collapse); increments attempt index |
| `attempt_build` (attempt 2) | `finale_elegy` | **Auto** on collapse, or Manual after rejection | Song 3 → finale regardless of outcome |
| `attempt_resolve` | `attempt_story` | Manual | Performer triggers rejection + advance; increments attempt index |
| `attempt_resolve` (attempt 2) | `finale_elegy` | Manual | After Song 3 rejection |
| `finale_elegy` | `finale_assembly` | Manual or Auto (after timer) | NPC rallies the audience |
| `finale_assembly` | `finale_deliberation` | **Auto** | When assembly timer expires (undecided randomly assigned first) |
| `finale_deliberation` | `finale_ceremony` | **Auto** | When deliberation timer expires (majority locked, ambassadors resolved) |
| `finale_ceremony` | `finale_performer_mix` | Manual or **Auto** | When all non-forfeited layers locked in, or performer triggers transition |
| `finale_performer_mix` | `ended` | Manual | |

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
| [docs/song-building.md](docs/song-building.md) | Layer structure, staggered ordering, blind vote, health bar, collapse, rejection, fragment generation |
| [docs/finale.md](docs/finale.md) | All 5 finale sub-phases (elegy, assembly, deliberation, ceremony, performer mix), NPC system, FinaleState type |
| [docs/data-models.md](docs/data-models.md) | TypeScript interfaces (User, ShowState, ShowConfig, Fragment), Conductor commands & events, VoteResult |
| [docs/client-routes.md](docs/client-routes.md) | /audience, /projector, /controller UI specs, visual identity system (colors, symbols) |
| [docs/audio-engine.md](docs/audio-engine.md) | Musical design spec, track layout, playback modes, OSC protocol, environment variables |
| [docs/server-protocol.md](docs/server-protocol.md) | WebSocket protocol, SQLite persistence schema, recovery |

---

## Folder Structure

```
solo-show/
├── ARCHITECTURE.md              # This document (V3 — index + core concepts)
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
│   ├── voting.ts                # Blind vote tallying + health bar drain
│   ├── health-bar.ts            # Health bar state management
│   ├── assembly.ts              # Group assembly logic (join, random assign, timer)
│   ├── deliberation.ts          # Group deliberation (voting, majority, ambassador selection)
│   ├── ceremony.ts              # Ceremony sequencing (ambassador calls, altar lock-in, forfeits)
│   ├── performer-mix.ts         # Pending changes queue, mix state, snapshots
│   ├── fragments.ts             # Fragment generation from attempt results
│   ├── npc.ts                   # NPC event-driven message logic
│   ├── types.ts                 # Shared type definitions
│   └── __tests__/               # Unit tests
│
├── server/                      # Custom server (Next.js + Socket.IO)
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO event handlers
│   ├── persistence.ts           # SQLite layer
│   ├── recovery.ts              # State recovery and backup
│   ├── timing.ts                # Quantized timing engine (loop boundary detection)
│   ├── osc.ts                   # OSC bridge for Ableton
│   ├── audio-router.ts          # Maps AUDIO_CUE events to OSC messages
│   ├── __tests__/
│   └── tools/
│       └── osc-mock-ableton.ts  # Mock Ableton for testing
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
│   ├── song-building/
│   │   ├── OptionCards.tsx       # A/B voting cards
│   │   ├── RevealSequence.tsx   # Post-vote reveal animation
│   │   ├── HealthBar.tsx        # Health bar visualization
│   │   └── LayerProgress.tsx    # Completed/upcoming layer indicators
│   ├── finale/
│   │   ├── ElegyGrid.tsx        # Full fragment wreckage display
│   │   ├── AssemblyCards.tsx    # Layer-type group selection cards
│   │   ├── GroupIdentity.tsx    # "You are [Layer]" post-assignment display
│   │   ├── DeliberationBoard.tsx # Fragment preview + group voting UI
│   │   ├── AudioPreview.tsx     # In-browser audio preview player
│   │   ├── AmbassadorPrompt.tsx # Volunteer / ambassador selection UI
│   │   ├── CeremonyView.tsx     # Ceremony progress (non-ambassador audience)
│   │   ├── AltarReady.tsx       # Ambassador altar-ready mode (accelerometer listener)
│   │   ├── NpcDisplay.tsx       # Terminal-style NPC text
│   │   ├── MixingSurface.tsx    # Performer's 7×6 mixing grid (controller)
│   │   ├── MixingMirror.tsx     # Projector view of mixing state
│   │   └── LoopIndicator.tsx    # Loop position progress bar
│   ├── shared/
│   │   ├── ChapterBadge.tsx     # Chapter color/icon badge
│   │   ├── LayerIcon.tsx        # Layer type color/symbol
│   │   └── PhaseIndicator.tsx   # Current phase display
│   └── controller/
│       ├── ShowControls.tsx     # Phase control buttons
│       ├── VotingControls.tsx   # Vote management
│       ├── HealthBarControls.tsx # Drain factor adjustment
│       ├── AssemblyControls.tsx # Group size monitoring, timer control
│       ├── DeliberationControls.tsx # Per-group vote monitoring, timer control
│       ├── CeremonyControls.tsx # Ambassador management, force lock-in, forfeits
│       ├── NpcControls.tsx      # NPC line bank + manual fire
│       ├── MixingSurface.tsx    # Performer mix interface
│       ├── SnapshotPresets.tsx  # Quick-load mix configurations
│       └── MetricsPanel.tsx     # Telemetry dashboard
│
├── hooks/
│   ├── useSocket.ts             # Socket.IO connection + reconnection
│   ├── useShowState.ts          # Client-side state management
│   ├── useAudioPreview.ts       # Audio preview playback management
│   └── useAltarDetection.ts     # Device Orientation API altar lock-in detection
│
├── lib/
│   ├── socket-client.ts         # Socket.IO client setup
│   ├── storage.ts               # localStorage for client identity
│   ├── serialization.ts         # Map/Set JSON serialization
│   └── identity.ts              # Chapter/layer color+symbol mappings
│
├── public/
│   └── audio/
│       └── previews/            # Pre-rendered fragment audio files
│           ├── preview-0-0-A.mp3
│           ├── preview-0-0-B.mp3
│           └── ...              # (up to 42 files)
│
├── config/
│   ├── default-show.json        # Pre-configured attempts, layers, fragments, layer labels, ceremony order
│   ├── ableton-layout.json      # Track index mappings
│   └── npc-messages.json        # Event-driven NPC messages (replaces npc-triggers.json)
│
├── db/
│   └── schema.sql               # SQLite schema (V3)
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
test('health bar drains by losing proportion times drain factor times layer multiplier', ...)
test('blind vote does not expose split during voting window', ...)
test('attempt collapses when health bar reaches zero', ...)
test('completed attempt transitions to attempt_resolve for rejection', ...)
test('unreached layers are marked as locked fragments in finale', ...)
test('undecided users are randomly assigned to groups when assembly timer expires', ...)
test('empty groups are marked and skipped in ceremony', ...)
test('deliberation selects fragment by simple majority at timer expiry', ...)
test('ties in deliberation are broken randomly', ...)
test('ambassador is selected randomly when multiple volunteers', ...)
test('layer is forfeited when no ambassador volunteers', ...)
test('altar lock-in requires face-down + still for configured duration', ...)
test('ceremony lock-in triggers audio activation quantized to next bar boundary', ...)
test('performer mix initial state reflects ceremony lock-in results', ...)
test('performer pending changes all fire simultaneously at loop boundary', ...)
```

---

## Open Questions (To Be Resolved)

- [ ] **Audience phones during performer mix phase:** Go dark, minimal ambient visualization, or endorsement tap surface?
- [ ] **Song rejection audio effect:** Exact Ableton effect chain and OSC trigger method. Should be distinct from collapse effect.
- [ ] **Collapse audio effect:** Exact Ableton effect chain for when health bar hits zero. Should be distinct from rejection effect.
- [ ] **Exact chord progression:** B minor key confirmed; specific 4-chord sequence TBD pending Ableton exploration.
- [ ] Locked color/symbol assignments for layers + chapters
- [ ] Specific fragment display labels (emotional taglines per option)
- [ ] NPC text library (event-driven messages per phase)
- [ ] Projector visual design and animations (especially ceremony layer-by-layer build)
- [ ] Performer mix snapshot presets
- [ ] Live performance track configuration
- [ ] **Audio preview file length:** 4 bars vs full 8-bar loop — needs playtesting for deliberation flow
- [ ] **Ceremony pacing:** How long between ambassador call-ups? Performer-controlled (manual advance) or auto-timed?
- [ ] **Altar detection tuning:** Face-down threshold angle, stillness threshold, hold duration — needs device testing across iOS/Android
- [ ] **Assembly grace period:** How long after groups are assigned before deliberation timer starts? Enough for physical movement?
- [ ] **Deliberation with single-fragment layers:** Skip voting UI and go straight to ambassador selection, or show the single option for confirmation?

---

## Appendix A: What Changed from V1 → V2

### Removed Systems
- **Per-layer doubt thresholds** → replaced by Health Bar with cumulative drain and layer multipliers
- **Chapter assignment** → no chapter assignment in finale
- **Individual fragment selection** → replaced by consensus game (V2)
- **Fragment queue / rotation system** → replaced by consensus game + performer mix (V2)
- **Stewardship / safe parameter control** → removed entirely
- **Triangle steering / centroid** → removed entirely
- **Active slots (7-slot rotation)** → replaced by role-typed layer activation
- **Audio metering (M4L → projector)** → removed (may be re-added for projector visuals)

### New Systems (V2)
- **Health Bar** with cumulative drain + configurable layer multipliers
- **Mechanical collapse** when health bar reaches zero
- **Blind vote** with reveal sequence
- **Song rejection** for completed songs
- **Consensus Game** (convergence meter, timed rounds, threshold softening) — *replaced in V3*
- **NPC system** (hybrid auto/manual) — *simplified in V3*
- **Performer mixing surface** (7×6 grid, pending changes queue, loop quantization)
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
- **Group Assembly** — timer-based self-selection into 7 layer-type groups with live size display. Random assignment for undecided members at timer expiry. Empty groups allowed (layer skipped).
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

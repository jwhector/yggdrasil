# Solo Show — Technical Architecture Specification

## Document Purpose
This document is the **authoritative source of truth** for the Solo Show system architecture. It is designed to:
- Provide complete context for AI agents working on the codebase
- Define terminology, data structures, and system boundaries
- Specify the state machine and event protocols
- Guide implementation decisions

**When this document conflicts with code, this document is correct and the code should be updated.**

---

## Project Overview

### What This Is
An interactive live performance system where ~40 audience members help build songs in real time across a theatrical monologue. The show consists of three story/song-building cycles and a collaborative finale. The audience makes binary choices to layer musical elements, facing rising consensus thresholds ("Doubt") that make deeper commitment harder. In the finale, audience members discover that fragments from all three songs are compatible, and they collaboratively remix them.

### Core Metaphor
> **"If I can build a song, I can build a life."**

The audience is framed as a mirror of the performer's inner world — not antagonists. Disagreement is internal conflict. A collapsing song attempt is self-sabotage. The finale proves that integration was always possible.

### Design Principles
1. **Story is uninterrupted.** Audience phones are used only during music-building and finale phases.
2. **Music is the metaphor.** No external props are required for meaning.
3. **Central timing, distributed choice.** The system runs on a master musical clock: audience controls *what* and *how*, not *when*.
4. **Legibility over complexity.** Binary choices, consistent visual cues, minimal UI.
5. **Safety constraints.** All musical actions are quantized and bounded so outputs remain coherent.
6. **Finale = discovery + integration.** Audience discovers fragments fit together; performer re-enters to shape (not overwrite).

---

## Terminology

| Term | Definition |
|------|------------|
| **Attempt** | One story/song-building cycle. The show has 3 attempts, each tied to a chapter. |
| **Chapter** | A thematic identity: Ambition (Song 1), Love (Song 2), Avoidance (Song 3). Chapters have consistent colors/icons throughout. |
| **Layer** | A single musical element within a song attempt. Each attempt targets 5–7 layers. Each layer has a type (Foundation, Pulse, Color, Space, Voice, etc.). |
| **Option** | One of 2 choices (A or B) within a layer. Binary choice. |
| **Lock-in** | When a layer's winning option is confirmed and becomes part of the song stack. |
| **Consensus** | `max(votesA, votesB) / totalVotes` — how aligned the audience is on a choice. |
| **Doubt** | A rising consensus threshold that activates after early layers. If consensus < doubt threshold, the attempt collapses. |
| **Collapse** | When an attempt fails its doubt threshold. The song "falls apart" — audio fades/distorts, visual cue plays, system auto-advances to next story phase. |
| **Song Stack** | The set of locked-in layers for an attempt. May be incomplete if the attempt collapses. |
| **Fragment** | A single locked-in option from song-building, available in the finale. Fragments that were *not* unlocked (from layers that never got voted on due to collapse) are visible but locked in the finale. |
| **Active Slot** | One of 7 positions in the finale mix. Each slot holds one fragment at a time. |
| **Rotation** | The finale mechanic where slots swap out fragments on a quantized cadence (every 8 bars). |
| **Steward / Stewardship** | When an audience member's queued fragment enters an active slot, they gain temporary control of one safe audio parameter for that slot. |
| **Triangle Steering** | Continuous audience input during the finale. Each non-stewarding audience member positions a dot on a triangle (Ambition / Love / Avoidance corners), influencing which chapter's fragments get scheduled. |
| **Centroid** | The server-computed average of all audience triangle positions. Displayed as a single collective dot on the projector. |
| **Layer Identity** | Consistent color + symbol for each layer type (Foundation, Pulse, etc.), used across all 3 attempts. |
| **Chapter Identity** | Consistent color + icon for each chapter (Ambition, Love, Avoidance), used across all UIs. |

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
│  ┌──────────────────┐          │                                  │
│  │  Audio Metering  │◄─────────┘  ← M4L envelope followers       │
│  │  (slot energy)   │                                             │
│  └──────────────────┘                                             │
└──────────────────────────────────┼──────────────────────────────┘
                                   │ OSC over UDP (localhost)
                                   ▼
                    ┌──────────────────────────────┐
                    │   Ableton Live + AbletonOSC    │
                    │   (musical timing, audio)     │
                    └──────────────────────────────┘
```

### Architecture: Next.js with Custom Server

This project uses Next.js with a custom Node.js server to enable persistent WebSocket connections via Socket.IO. A single process serves both the Next.js pages and the real-time show logic.

**Why custom server?**
- Socket.IO requires persistent connections (not supported by Next.js API routes)
- Single process simplifies deployment and recovery for live performance
- All state lives in one place (SQLite + memory)

### Deployment Model

**Primary: Cloud-hosted server** (e.g., Fly.io, Railway, or similar)
- Audience phones connect via venue WiFi to public URL
- Avoids captive portal / "no internet" detection issues on phones
- WebSocket latency of 20-60ms is acceptable (all musical timing is quantized, voting is discrete, triangle steering is throttled)
- Choose a deployment region near the performance venue

**Ableton bridge runs locally** on the performer's machine regardless of server deployment. The local bridge connects to the cloud server via WebSocket and relays OSC commands to/from Ableton on localhost.

**Alternative: Local hosting** (compatible but not default)
- Use an internet-passthrough router (upstream to venue internet) so phones don't trigger captive portal warnings
- Server runs on performer's machine, audience connects via local IP
- Lower latency but venue-dependent

---

## Client Routes (Next.js App Router)

### `/audience` — Audience Member UI

**Join flow:**
- User scans seat-specific QR code → `/audience?seat=<seatId>`
- System records user-to-seat mapping, assigns persistent userId
- User sees "waiting for show to begin" screen

**Story phases (phones down):**
- Screen goes dark/minimal ("listen" state)

**Song-building phases:**
- Grid of all layers for the current attempt displayed as squares (up to 12 squares for 6 layers × 2 options)
- Layers unlock sequentially from top
- Current layer: both A and B options become selectable (large, tappable squares with layer color + symbol)
- After vote closes: winning option locks in visually, losing option dims/grays
- Locked layers show their chosen option prominently
- Future layers appear as locked/unexplored squares
- When Doubt is active: threshold displayed clearly ("Need ≥ X%")

**Finale phase:**
- Fragment selection: grid of layers for the user's assigned chapter only
- Locked-in winning options from song-building are **enabled** for selection
- **Locked/grayed**: Both options from unreached layers (due to collapse) AND the losing option from voted layers — all represent "what could have been"
- User selects exactly one fragment to queue
- **Triangle steering** (when not stewarding): three-corner triangle (Ambition/Love/Avoidance), user drags dot continuously
- **Steward mode** (when their fragment is in an active slot): single continuous slider controlling one abstracted parameter ("Intensity" or similar label). Parameter label is configurable. Slider maps to a safe, clamped range.

### `/projector` — Public Display

**Story phases:** Dark or minimal atmospheric display

**Song-building phases:**
- Top: Song attempt title + chapter color/icon (e.g., "Ambition" with chapter accent)
- Center: Current layer card — layer symbol + label, Option A (left) vs Option B (right)
- Stack history: icons of chosen layers so far
- Meters (when active):
  - **Consensus bar**: shows leading side and margin
  - **Doubt meter**: threshold line / rising gauge
- Collapse animation: visual + audio cue when attempt fails

**Finale phase:**
- 7 slot cards showing:
  - Chapter color/icon of active fragment
  - Fragment name/icon
  - Steward indicator (unique color/glyph) while active
  - Energy meter / glow driven by audio metering (from M4L)
- One collective steering dot on triangle + chapter-accent color blend
- Phase indicator (Rotating / Frozen / Integration)

### `/controller` — Performer/Operator Interface

**Access:** Secret route + passcode. One primary operator session; optionally allow multiple.

**Core Controls:**

| Category | Controls |
|----------|----------|
| **Show Phase** | Start Show, Stop Show, Advance Phase, Jump to Phase (dropdown) |
| **Voting** | Open Vote, Close Vote, Force Option A/B, Extend Timer (+5s/+10s), Invalidate/Re-run Vote |
| **Doubt** | Set/adjust threshold (slider or presets), Toggle Doubt active, Force Continue (bypass threshold once), Force Collapse |
| **Audio** | Transport Play/Stop, Hard Mute/Panic, Per-layer force on/off, Trigger collapse gesture |
| **Finale** | Start/Stop rotation, Rotation rate (1 or 2 slots per 8 bars), Freeze rotation, Clear/reset queue, Force assign steward, Force insert fragment into slot, Toggle triangle steering on/off |
| **Emergency** | Pause/Resume show, Export state as JSON, Import state from JSON, Force reconnect all clients, Reset to lobby |

**Metrics/Telemetry:**
- Connected clients count
- Vote counts A vs B, consensus percent, time remaining
- Finale: triangle weights, active slots, current stewards, queue length per chapter, "everyone got a turn" progress
- System health: WebSocket status, Ableton OSC status, error log tail

---

## Show Phase State Machine

```
lobby → opener → attempt_1_story → attempt_1_build →
                 attempt_2_story → attempt_2_build →
                 attempt_3_story → attempt_3_build →
                 finale_setup → finale_rotating → finale_frozen → ended
```

### Phase Details

```typescript
type ShowPhase =
  | 'lobby'              // Audience joining, scanning QR codes
  | 'opener'             // Performer monologue (phones dark)
  | 'attempt_story'      // Story phase for current attempt (phones dark)
  | 'attempt_build'      // Song-building phase for current attempt (phones active)
  | 'finale_setup'       // Transition to finale, chapter assignment, fragment selection
  | 'finale_rotating'    // Active finale with slot rotation
  | 'finale_frozen'      // Rotation frozen, performer takes over
  | 'ended';
```

**Note:** `attempt_story` and `attempt_build` are parameterized by `currentAttemptIndex` (0, 1, 2).

### Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `lobby` | `opener` | Manual (controller) | |
| `opener` | `attempt_story` | Manual | Sets currentAttemptIndex = 0 |
| `attempt_story` | `attempt_build` | Manual | Activates layer voting UI |
| `attempt_build` | `attempt_story` | **Auto** (on collapse) or Manual | Auto-advances after collapse animation; increments attempt index |
| `attempt_build` | `attempt_story` | Manual | Performer can also manually advance if attempt completes successfully |
| `attempt_build` (attempt 2) | `finale_setup` | **Auto** (on Song 3 collapse) or Manual | Manual for now; subject to change |
| `attempt_build` (attempt 2) | `finale_setup` | Manual | If Song 3 completes |
| `finale_setup` | `finale_rotating` | Manual | After audience selects fragments |
| `finale_rotating` | `finale_frozen` | Manual | Performer freezes rotation |
| `finale_frozen` | `ended` | Manual | |

**Important:** The transition from the last attempt (Song 3) to finale is **manual** regardless of whether it collapses or completes. All other collapse → next story transitions are automatic.

---

## Song-Building Phase — Detailed Mechanics

### Layer Structure

Each attempt has a configured layer plan (target: 5–7 layers). Layers are displayed as a grid of squares on audience phones from the start.

```typescript
interface LayerPlan {
  layers: LayerConfig[];
}

interface LayerConfig {
  index: number;              // 0-indexed position in the attempt
  type: LayerType;            // Foundation, Pulse, Color, Space, Voice, etc.
  optionA: AudioReference;    // Ableton clip reference
  optionB: AudioReference;    // Ableton clip reference
  labelA: string;             // Short emotional tagline for A
  labelB: string;             // Short emotional tagline for B
  doubtThreshold: number | null;  // null = no threshold (simple majority wins)
}

type LayerType =
  | 'foundation'   // The bed / the ground
  | 'pulse'        // Heartbeat / drive
  | 'color'        // Warmth / sharpness
  | 'space'        // Intimate / distant
  | 'voice'        // Clear / masked
  | string;        // Extensible for custom types
```

### Layer Phase Transitions (within `attempt_build`)

```
locked → auditioning → voting → resolving → locked_in
                                    │
                                    ▼ (if consensus < doubt threshold)
                                collapsed (attempt ends)
```

```typescript
type LayerPhase =
  | 'locked'        // Not yet reached; displayed as unexplored square
  | 'auditioning'   // Playing A and B previews
  | 'voting'        // Vote window open, audience selecting A or B
  | 'resolving'     // Vote closed, calculating result, displaying outcome
  | 'locked_in'     // Option chosen, layer committed to song stack
  | 'collapsed';    // Attempt failed at this layer (doubt exceeded consensus)
```

### Vote & Consensus

```typescript
interface LayerVote {
  userId: UserId;
  attemptIndex: number;
  layerIndex: number;
  choice: 'A' | 'B';
  timestamp: number;
}

function calculateConsensus(votes: LayerVote[]): {
  consensus: number;       // 0.0 to 1.0
  winner: 'A' | 'B';
  votesA: number;
  votesB: number;
  totalVotes: number;
} {
  const votesA = votes.filter(v => v.choice === 'A').length;
  const votesB = votes.filter(v => v.choice === 'B').length;
  const total = votesA + votesB;
  if (total === 0) return { consensus: 0, winner: 'A', votesA: 0, votesB: 0, totalVotes: 0 };

  const winner = votesA >= votesB ? 'A' : 'B';
  const consensus = Math.max(votesA, votesB) / total;
  return { consensus, winner, votesA, votesB, totalVotes: total };
}
```

### Doubt Threshold

- **Early layers** (typically layers 0–1): `doubtThreshold = null` → simple majority wins, no minimum consensus.
- **Later layers**: `doubtThreshold` is a configured value (e.g., 0.65, 0.75, 0.85). If the winning option's consensus is below this threshold, the attempt collapses.

Example threshold schedule (tunable per attempt):
| Layer | Threshold |
|-------|-----------|
| 0–1 | None (simple majority) |
| 2 | 65% |
| 3 | 75% |
| 4 | 85% |
| 5+ | 90% |

**Thematic framing:** "As we go deeper, I need more of myself to agree."

### Collapse Behavior

When `consensus < doubtThreshold`:
1. Current layer enters `collapsed` phase
2. **Audio**: Collapse gesture triggers (master return track effects activate — "womp-womp" distortion/decay)
3. **Visual**: Doubt meter visibly exceeds consensus bar on projector; phone UI shows collapse state
4. **System**: After collapse animation duration, auto-advances to next `attempt_story` phase
5. **Data**: All locked-in layers from this attempt are preserved as available finale fragments. Layers that were never reached are marked as `unreached`.

**Exception:** Song 3 collapse → transition to finale is **manual** (performer triggers).

### Song Stack & Fragment Generation

After each attempt (whether completed or collapsed), the system records:

```typescript
interface AttemptResult {
  attemptIndex: number;                // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layers: LayerResult[];
  completed: boolean;                  // True if all layers were reached and passed
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
}

interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'unreached';  // unreached = never got to vote on this layer
  chosenOption: 'A' | 'B' | null;     // null if unreached
  consensus: number | null;            // null if unreached
}
```

**Fragment availability for finale:**
- `locked_in` layers with `chosenOption = 'A'` or `'B'` → the *chosen* option becomes a **selectable** finale fragment
- `locked_in` layers → the *unchosen* (losing) option appears visible but **locked/grayed** ("what could have been")
- `unreached` layers → both options appear visible but **locked/grayed** ("what could have been")

---

## Finale System — Detailed Mechanics

### Overview
After Song 3, the performer transitions to the finale. The audience discovers that fragments from all three songs are compatible and collectively remixes them.

### Chapter Assignment
At `finale_setup`:
- Server randomly assigns each audience member to one of three chapters (Ambition / Love / Avoidance)
- Assignment is an even split (±1 per chapter for ~40 users)
- Assignment is permanent for the finale duration

### Fragment Selection
Each audience member sees a grid of layers for their assigned chapter only:
- **Selectable**: Options that were locked in during song-building for that chapter
- **Locked/grayed**: Both options from layers that were `unreached` (due to collapse)
- **Not shown**: The losing option from layers that were voted on (only the winner appears)
- User selects exactly **one** fragment to queue

```typescript
interface FragmentSelection {
  userId: UserId;
  attemptIndex: number;     // Which song attempt this fragment is from
  layerIndex: number;       // Which layer
  option: 'A' | 'B';       // Which option (always the one that won)
  chapter: Chapter;
}
```

### Fragment Metadata

```typescript
interface Fragment {
  id: string;                          // Unique identifier
  attemptIndex: number;
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayName: string;                 // Human-readable name for UI
  audioRef: AudioReference;            // Ableton track/clip identifier
  safeParameter: SafeParameter;        // The parameter stewards control
}

interface SafeParameter {
  name: string;                        // Internal parameter name
  displayLabel: string;                // What the user sees (e.g., "Intensity")
  abletonMapping: AbletonParamRef;     // Track index + device index + param index
  min: number;                         // Clamped minimum (0.0–1.0)
  max: number;                         // Clamped maximum (0.0–1.0)
  defaultValue: number;                // Neutral position
  smoothingMs: number;                 // Parameter change smoothing (prevent zipper noise)
}
```

### Master Clock
- Global **master loop** governs all changes
- Quantization unit: **8 bars**
- All slot changes happen on quantized boundaries with short crossfades

### Active Slots
- The finale mix has **7 active slots**
- Each slot holds one fragment at a time
- Slot changes happen quantized to 8-bar boundaries with ~1-bar crossfades

### Rotation
- Primary cadence: every 8 bars, rotate out **2 slots** and rotate in **2 new fragments** from the queue
- Operator can adjust rate: 1 or 2 slots per cycle
- Operator can **freeze** rotation (lock current mix)

### Queue & Scheduling

```typescript
interface FinaleQueue {
  entries: QueueEntry[];
}

interface QueueEntry {
  userId: UserId;
  fragment: Fragment;
  chapter: Chapter;
  enqueuedAt: number;
  hasBeenSteward: boolean;    // Tracks whether this user has had a turn
}
```

**Scheduling algorithm** (each rotation tick):
1. **Fairness first**: Prioritize queue entries from users who have NOT yet stewarded
2. **Chapter weighting**: Among equally fair candidates, bias toward chapters with higher centroid weight
3. **Diversity nudge**: If a chapter hasn't been featured recently, boost its scheduling priority slightly

**Effectively one pick**: The queue is expected to be long enough that most users get exactly one turn. No re-queuing is supported.

### Stewardship

When a user's queued fragment enters an active slot:
1. Their phone enters **Steward Mode**
2. They see a single continuous slider
3. Slider label is the fragment's `safeParameter.displayLabel` (configurable, e.g., "Intensity")
4. Slider maps to the configured Ableton parameter within the safe clamped range
5. Parameter changes are smoothed (configurable `smoothingMs`) to prevent zipper noise
6. When rotation swaps out their fragment, stewardship ends and their slider returns to default

**Constraints:**
- Steward cannot mute other layers or affect tempo/key
- Parameter range is clamped to musically safe bounds
- Only the slot's designated safe parameter is exposed

### Triangle Steering

**Audience UX** (when NOT stewarding):
- Three-corner triangle: Ambition / Love / Avoidance
- User drags a dot continuously within the triangle
- Position yields barycentric weights: `wA + wL + wV = 1`

**Data flow:**
- Client throttles position updates to every ~250ms
- Server receives positions, computes centroid (average of all active triangle positions)
- Server broadcasts centroid to projector at ~3-4 Hz
- Projector interpolates between received positions for smooth animation

**Nudges:**
- **Auto-recenter drift**: If a user doesn't touch the triangle for a configurable duration, their dot gently drifts toward center (equal weights)
- **Underrepresented glow**: If a chapter hasn't been featured in active slots recently, its triangle corner subtly glows on audience phones

**Effect on scheduling**: Centroid weights influence which chapter's fragments get priority in rotation (see scheduling algorithm above).

---

## Audio Engine & Ableton Integration

### Track Layout

**Song-building tracks** (3 attempts × up to 7 layers × 2 options):
- Track index: `attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset`
  - `optionOffset`: 0 for Option A, 1 for Option B
- With 7 max layers per attempt: 42 tracks total (tracks 0–41)
- Example: Attempt 0, Layer 2, Option B = `0 * 14 + 2 * 2 + 1 = track 5`
- Example: Attempt 1, Layer 0, Option A = `1 * 14 + 0 * 2 + 0 = track 14`
- Example: Attempt 2, Layer 3, Option A = `2 * 14 + 3 * 2 + 0 = track 34`

**Finale fragment tracks** are a **subset** of the song-building tracks. When a fragment is activated in a finale slot, it references the same Ableton track/clip that was used during song-building.

**Collapse gesture**: A master return track with specific effects (distortion, filter sweep, reverb tail) that are enabled briefly during collapse. All song-building tracks route through this return.

### Playback Modes

**Song-building:**
- Audition: Briefly unmute/solo Option A, then Option B (quantized transitions)
- Lock-in: Unmute chosen option's track, mute unchosen
- Stack accumulates: previously locked layers stay unmuted

**Collapse:**
- Enable collapse return track effects
- Rapid fade or filter sweep on all active tracks
- After gesture completes, mute all tracks for the collapsed attempt

**Finale:**
- Slot activation = unmute the fragment's track
- Slot deactivation = mute + crossfade (~1 bar)
- Stewardship parameter changes sent as OSC parameter updates

### OSC Protocol

Uses the **AbletonOSC** plugin (by ideoforms). All addresses follow the `/live/*` namespace.

**Server → AbletonOSC (Port 11000)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/live/test` | - | Connectivity test |
| `/live/song/start_listen/beat` | - | Subscribe to beat events |
| `/live/song/stop_listen/beat` | - | Unsubscribe from beat events |
| `/live/song/start_playing` | - | Start global transport |
| `/live/song/stop_playing` | - | Stop global transport |
| `/live/song/continue_playing` | - | Resume from current position |
| `/live/clip/fire` | `trackIndex`, `clipIndex` | Fire clip (always slot 0) |
| `/live/clip/stop` | `trackIndex`, `clipIndex` | Stop clip |
| `/live/track/set/mute` | `trackIndex`, `mute` | Mute (1) / unmute (0) track |
| `/live/device/set/parameter/value` | `trackIndex`, `deviceIndex`, `paramIndex`, `value` | Set device parameter (stewardship control) |
| `/live/return/set/mute` | `returnIndex`, `mute` | Mute/unmute return track (collapse gesture) |

**AbletonOSC → Server (Port 11001)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/live/test` | `response` | Connectivity test response |
| `/live/song/get/beat` | `beatNumber` | Beat event (when subscribed) |

### Audio Metering (M4L → Server → Projector)

Max for Live envelope follower devices on each of the 7 finale slot tracks send RMS energy levels via OSC.

**M4L → Server (Port 11001 or dedicated port)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/meter/slot/<N>` | `rmsLevel: float` | Energy level for slot N (0–6), range 0.0–1.0 |

- Send rate: ~15-30 Hz per slot (configurable in M4L device)
- Server aggregates and broadcasts to projector at ~10 Hz
- Projector uses levels to drive glow/pulse animations on slot cards

### Fallback Mode (No Ableton)

When OSC bridge is not connected:
- Timing engine uses JS timers for all phases
- Audio cues are logged but not sent
- System is fully functional for UI/logic testing

### Environment Variables

```bash
# Server
PORT=3000
DATABASE_PATH=./db/show.sqlite

# Timing
TIMING_ENGINE_ENABLED=true

# OSC
OSC_ENABLED=true
OSC_SEND_PORT=11000
OSC_RECEIVE_PORT=11001
OSC_HOST=127.0.0.1
MOCK_BPM=120                    # For testing without Ableton

# Audio Metering
METERING_ENABLED=true
METERING_PORT=11001             # Can share with OSC receive port
METERING_BROADCAST_HZ=10       # How often to push to projector
```

---

## Data Models

### User

```typescript
interface User {
  id: UserId;                   // Persistent across reconnection (stored client-side)
  seatId: SeatId | null;        // From QR code scan; null if joined without QR
  connected: boolean;
  joinedAt: number;
  finaleChapter: Chapter | null;   // Assigned at finale_setup; null before then
}
```

### Show State

```typescript
interface ShowState {
  id: string;                          // Unique show instance
  phase: ShowPhase;
  currentAttemptIndex: number;         // 0, 1, 2
  attempts: AttemptState[];            // Length 3, pre-initialized
  users: Map<UserId, User>;
  finaleState: FinaleState | null;     // Populated at finale_setup
  config: ShowConfig;
  version: number;                     // Increments on every state change
  lastUpdated: number;                 // Wall clock time
  paused: boolean;
}

interface AttemptState {
  index: number;                       // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layerPlan: LayerConfig[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];         // Populated as layers resolve
  votes: LayerVote[];                  // All votes for this attempt
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
}

type Chapter = 'ambition' | 'love' | 'avoidance';

interface FinaleState {
  chapterAssignments: Map<UserId, Chapter>;
  queue: QueueEntry[];
  activeSlots: (ActiveSlot | null)[];  // Length 7; null = empty slot
  trianglePositions: Map<UserId, TrianglePosition>;
  centroid: TrianglePosition;          // Computed average
  rotationActive: boolean;
  rotationRate: 1 | 2;                // Slots per 8-bar cycle
  frozen: boolean;
  stewardshipLog: StewardshipEntry[]; // Who has stewarded
}

interface ActiveSlot {
  slotIndex: number;                   // 0–6
  fragment: Fragment;
  stewardUserId: UserId;
  parameterValue: number;              // Current safe parameter value
  activatedAtBeat: number;
  energyLevel: number;                 // From audio metering (0.0–1.0)
}

interface TrianglePosition {
  wAmbition: number;                   // 0.0–1.0, all three sum to 1.0
  wLove: number;
  wAvoidance: number;
}

interface StewardshipEntry {
  userId: UserId;
  slotIndex: number;
  fragment: Fragment;
  startBeat: number;
  endBeat: number | null;              // null if still active
}
```

### Show Config

```typescript
interface ShowConfig {
  maxLayersPerAttempt: number;         // Used for track index calculation (default: 7)
  attempts: AttemptConfig[];           // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;            // Text displayed while waiting
  };
  seatIds: SeatId[];                   // Known seats for QR code generation
}

interface AttemptConfig {
  chapter: Chapter;
  title: string;                       // Display name (e.g., "Ambition")
  layers: LayerConfig[];               // 5–7 layers per attempt
}

interface FinaleConfig {
  slotCount: number;                   // Default: 7
  rotationBars: number;                // Default: 8
  defaultRotationRate: 1 | 2;          // Slots per cycle
  triangleDriftTimeoutMs: number;      // How long before idle dots drift to center
  triangleDriftSpeedMs: number;        // How fast drift occurs
  fragments: Fragment[];               // Pre-configured fragment library (populated from attempt results + config)
}

interface TimingConfig {
  auditionDurationMs: number;          // Per-option audition preview
  votingWindowMs: number;              // How long voting stays open
  resolveAnimationMs: number;          // Result display duration
  collapseAnimationMs: number;         // Collapse gesture duration before auto-advance
  autoAdvanceToStoryMs: number;        // Delay after collapse before transitioning
}
```

---

## Conductor (Pure State Machine)

The Conductor is a pure logic module with no I/O. It receives commands, validates them, updates state, and emits events. The server wraps it with WebSocket I/O and persistence.

### Commands (Input)

```typescript
type ConductorCommand =
  // Show flow
  | { type: 'ADVANCE_PHASE' }
  | { type: 'JUMP_TO_PHASE'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }

  // Song-building
  | { type: 'START_AUDITION' }                          // Begin auditioning current layer
  | { type: 'OPEN_VOTING' }                             // Open vote window
  | { type: 'CLOSE_VOTING' }                            // Manually close vote window
  | { type: 'SUBMIT_VOTE'; userId: UserId; choice: 'A' | 'B' }
  | { type: 'FORCE_OPTION'; choice: 'A' | 'B' }        // Override vote result
  | { type: 'EXTEND_VOTE_TIMER'; additionalMs: number }
  | { type: 'RERUN_VOTE' }                              // Invalidate and re-audition
  | { type: 'FORCE_CONTINUE' }                          // Bypass threshold once
  | { type: 'FORCE_COLLAPSE' }                          // End attempt immediately

  // Doubt
  | { type: 'SET_THRESHOLD'; layerIndex: number; threshold: number | null }
  | { type: 'TOGGLE_DOUBT'; active: boolean }

  // Finale
  | { type: 'SETUP_FINALE' }                            // Assign chapters, populate fragments
  | { type: 'SELECT_FRAGMENT'; userId: UserId; fragmentId: string }
  | { type: 'UPDATE_TRIANGLE'; userId: UserId; position: TrianglePosition }
  | { type: 'UPDATE_STEWARD_PARAM'; userId: UserId; value: number }
  | { type: 'START_ROTATION' }
  | { type: 'STOP_ROTATION' }
  | { type: 'FREEZE_ROTATION' }
  | { type: 'SET_ROTATION_RATE'; rate: 1 | 2 }
  | { type: 'FORCE_ASSIGN_STEWARD'; userId: UserId; slotIndex: number }
  | { type: 'FORCE_INSERT_FRAGMENT'; fragmentId: string; slotIndex: number }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'TOGGLE_TRIANGLE'; active: boolean }

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }                             // Hard mute all
  | { type: 'TRIGGER_COLLAPSE_GESTURE' }

  // Connection
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId }
  | { type: 'USER_DISCONNECT'; userId: UserId }

  // Recovery
  | { type: 'EXPORT_STATE' }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' }
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean };
```

### Events (Output)

```typescript
type ConductorEvent =
  // Show flow
  | { type: 'SHOW_PHASE_CHANGED'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }

  // Song-building
  | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number; consensus: number; threshold: number }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }

  // Finale
  | { type: 'FINALE_SETUP_COMPLETE'; chapterAssignments: Map<UserId, Chapter>; availableFragments: Fragment[] }
  | { type: 'FRAGMENT_QUEUED'; userId: UserId; fragment: Fragment }
  | { type: 'SLOT_ACTIVATED'; slotIndex: number; fragment: Fragment; stewardUserId: UserId }
  | { type: 'SLOT_DEACTIVATED'; slotIndex: number }
  | { type: 'STEWARDSHIP_STARTED'; userId: UserId; slotIndex: number }
  | { type: 'STEWARDSHIP_ENDED'; userId: UserId; slotIndex: number }
  | { type: 'CENTROID_UPDATED'; centroid: TrianglePosition }
  | { type: 'ROTATION_TICK'; newSlots: ActiveSlot[]; removedSlots: number[] }

  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }
  | { type: 'METER_UPDATE'; slots: { slotIndex: number; energy: number }[] }

  // State
  | { type: 'STATE_UPDATED'; version: number };

interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;
  votesA: number;
  votesB: number;
  totalVotes: number;
  thresholdMet: boolean;       // True if consensus >= doubt threshold (or no threshold)
  doubtThreshold: number | null;
}
```

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation (same as old architecture — proven approach for ~40 users):
- **Controller**: Full serialized state
- **Projector**: Public filtered state (no individual user details)
- **Audience**: Personalized state (their chapter, their votes, their stewardship status, their triangle position)

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience |
| `select_fragment` | `{ fragmentId }` | Audience |
| `triangle_update` | `{ wAmbition, wLove, wAvoidance }` | Audience (throttled ~250ms) |
| `steward_param` | `{ value: number }` | Audience (stewarding) |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered) | All (on every state change + connect) |
| `identity` | `{ userId }` | New audience members |
| `error` | `{ message }` | Controller |
| `meter` | `{ slots: [{index, energy}] }` | Projector (~10 Hz) |

**Note on metering**: Audio meter updates are sent as a separate high-frequency event to the projector only, NOT as part of state_sync (which would be too slow/heavy for ~10 Hz visual updates).

---

## Persistence Layer

### SQLite with WAL Mode

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

### Schema

```sql
CREATE TABLE shows (
  id TEXT PRIMARY KEY,
  state JSON NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  seat_id TEXT,
  finale_chapter TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  layer_index INTEGER NOT NULL,
  choice TEXT NOT NULL CHECK(choice IN ('A', 'B')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE fragment_selections (
  user_id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Persistence Strategy
Persist after EVERY state change (atomic SQLite transactions). Same pattern as old architecture.

### Recovery Protocol
On server start:
1. Load most recent show from `shows` table
2. Rehydrate `ShowState` from JSON
3. Accept reconnections; match by `userId` from client localStorage

---

## Recovery & Robustness

Carried forward from old architecture — same principles apply:

1. **Persist on every state change** (not periodic batches)
2. **Atomic writes** (SQLite transactions)
3. **Stateless clients** (all truth on server)
4. **Automatic reconnection** (exponential backoff: 1s, 2s, 4s, max 10s)
5. **Graceful degradation** (show continues if some phones disconnect)

### Heartbeat
```
Server pings every 15 seconds
Client responds within 5 seconds
2 missed pongs = marked disconnected
```

### State Versioning
Every mutation increments `version`. On reconnect, if versions match → minimal sync. If different → full state sync.

### Backup Snapshots
Rolling backup files: `show-{showId}-{version}-{timestamp}.json`

### Safety / Fallback Modes
- **No Phones Mode**: Controller runs deterministic sequence if audience network fails
- **Projection Only Mode**: Continue visuals even if some phones drop
- **Audio Only Mode**: Continue Ableton performance if web UI fails

---

## Visual Identity System

### Chapter Identity (consistent across all UIs)

| Chapter | Color | Icon | Usage |
|---------|-------|------|-------|
| Ambition | TBD | TBD | Song 1, finale triangle corner, fragment badges |
| Love | TBD | TBD | Song 2, finale triangle corner, fragment badges |
| Avoidance | TBD | TBD | Song 3, finale triangle corner, fragment badges |

### Layer Identity (consistent across all 3 attempts)

| Layer Type | Color | Symbol | Label |
|------------|-------|--------|-------|
| Foundation | Deep red | ■ | "The ground" |
| Pulse | Bright yellow | ▲ | "The heartbeat" |
| Color | Purple | ● | "The warmth" |
| Space | Blue | ~ | "The distance" |
| Voice | White | ✦ | "The voice" |

*These are placeholders — lock before production.*

### Option Identity (A vs B within a layer)
- Option A: layer color, **solid** style
- Option B: layer color, **outlined** style

---

## Folder Structure

```
solo-show/
├── ARCHITECTURE.md              # This document (source of truth)
├── CHANGELOG.md                 # Human-readable change history with intent
├── CLAUDE.md                    # AI agent instructions and context
├── DECISIONS.md                 # Open questions and resolved decisions
├── README.md                    # Setup and run instructions
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts                 # Exports
│   ├── conductor.ts             # State machine (show phases + layer phases)
│   ├── consensus.ts             # Vote tallying + doubt threshold logic
│   ├── finale.ts                # Queue scheduling, rotation, stewardship, triangle
│   ├── fragments.ts             # Fragment generation from attempt results
│   ├── types.ts                 # Shared type definitions
│   └── __tests__/               # Unit tests
│
├── server/                      # Custom server (Next.js + Socket.IO)
│   ├── index.ts                 # Entry point
│   ├── socket.ts                # Socket.IO event handlers
│   ├── persistence.ts           # SQLite layer
│   ├── recovery.ts              # State recovery and backup
│   ├── timing.ts                # Quantized timing engine
│   ├── osc.ts                   # OSC bridge for Ableton
│   ├── audio-router.ts          # Maps AUDIO_CUE events to OSC messages
│   ├── metering.ts              # Audio metering aggregation (M4L → projector)
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
│   │   ├── LayerGrid.tsx        # Grid of all layers (squares)
│   │   ├── LayerSquare.tsx      # Single layer square (locked/active/completed)
│   │   ├── OptionCard.tsx       # A/B option within active layer
│   │   ├── ConsensusBar.tsx     # Vote result visualization
│   │   └── DoubtMeter.tsx       # Rising threshold gauge
│   ├── finale/
│   │   ├── FragmentSelector.tsx # Chapter-specific fragment grid
│   │   ├── TriangleSteering.tsx # Barycentric triangle input
│   │   ├── StewardSlider.tsx    # Parameter control slider
│   │   ├── SlotCard.tsx         # Single active slot display
│   │   └── SlotGrid.tsx         # 7-slot projector display
│   ├── shared/
│   │   ├── ChapterBadge.tsx     # Chapter color/icon badge
│   │   ├── LayerIcon.tsx        # Layer type color/symbol
│   │   └── PhaseIndicator.tsx   # Current phase display
│   └── controller/
│       ├── ShowControls.tsx     # Phase control buttons
│       ├── VotingControls.tsx   # Vote management
│       ├── DoubtControls.tsx    # Threshold adjustment
│       ├── FinaleControls.tsx   # Rotation/queue management
│       └── MetricsPanel.tsx     # Telemetry dashboard
│
├── hooks/
│   ├── useSocket.ts             # Socket.IO connection + reconnection
│   ├── useShowState.ts          # Client-side state management
│   └── useTriangle.ts           # Triangle position input + throttling
│
├── lib/
│   ├── socket-client.ts         # Socket.IO client setup
│   ├── storage.ts               # localStorage for client identity
│   ├── serialization.ts         # Map/Set JSON serialization
│   └── identity.ts              # Chapter/layer color+symbol mappings
│
├── config/
│   ├── default-show.json        # Pre-configured attempts, layers, fragments
│   └── ableton-layout.json      # Track index mappings
│
├── db/
│   └── schema.sql               # SQLite schema
│
├── next.config.js
├── tsconfig.json
├── package.json
└── .gitignore
```

---

## AI-First Development Practices

### Context Management

1. **ARCHITECTURE.md is the source of truth.** Read this file first. If changes contradict it, update this document first or flag the contradiction.

2. **CHANGELOG.md tracks intent, not just diffs:**
   ```markdown
   ## [Date] — Brief title
   **Context:** Why this change is happening
   **Changes:** What was modified
   **Implications:** What else might need to change
   ```

3. **Types are documentation.** `conductor/types.ts` defines the shared language. Changes to types should be rare and deliberate.

4. **Test names are specifications:**
   ```typescript
   test('attempt collapses when consensus is below doubt threshold', ...)
   test('unreached layers are marked as locked fragments in the finale', ...)
   test('stewardship ends when fragment is rotated out of active slot', ...)
   ```

### Making Changes

1. State the goal in plain language
2. Check ARCHITECTURE.md for relevant sections
3. Identify affected components (Conductor? Server? Client? All?)
4. Make type changes first if data structures are changing
5. Update tests to reflect new behavior
6. Update ARCHITECTURE.md if system design is affected
7. Add CHANGELOG.md entry

### Handling Design Uncertainty

1. Don't invent solutions that aren't specified
2. Implement the minimal interface that allows the feature to be plugged in later
3. Add `// TODO: [description]` at integration points
4. Document open questions in DECISIONS.md

---

## Open Questions (To Be Resolved)

- [ ] Exact number of layers per attempt (target 5–7)
- [ ] Exact threshold schedule for Doubt per layer per attempt
- [ ] Locked color/symbol assignments for layers + chapters
- [ ] Audition cadence (A/B preview duration and transition style)
- [ ] Specific fragment display names
- [ ] Stewardship parameter assignments per fragment
- [ ] Finale rotation freeze behavior and when performer takes over
- [ ] Projector visual design and animations
- [ ] Controller hardware/UX details
- [ ] Musical content (Ableton session design)

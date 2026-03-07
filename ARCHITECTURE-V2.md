# Solo Show — Technical Architecture Specification (V2)

## Document Purpose
This document is the **authoritative source of truth** for the Solo Show system architecture. It supersedes the original ARCHITECTURE.md and reflects significant design changes to song-building mechanics and the finale system.

**When this document conflicts with code, this document is correct and the code should be updated.**

---

## Project Overview

### What This Is
An interactive live performance system where ~40 audience members help build songs in real time across a theatrical monologue. The show consists of three story/song-building cycles and a collaborative finale. The audience makes blind binary choices to layer musical elements while a Health Bar tracks the cumulative cost of their disagreement. Each layer costs more than the last (rising resistance), and if the Health Bar reaches zero, the song collapses — unreached layers are lost. Songs that survive all layers are narratively rejected by the performer anyway (self-sabotage). In the finale, the audience — abandoned by the performer — must find wordless consensus to resurrect fragments from the wreckage, proving the songs were compatible all along. The performer returns to co-create the climax.

### Core Metaphor
> **"If I can build a song, I can build a life."**

The audience is framed as the performer's inner council — parts of the subconscious trying to cohere into a finished creative work. Disagreement is internal conflict. A collapsing song is the cumulative weight of internal division. The performer's rejection of a completed song is self-sabotage. The finale proves that integration was always possible.

### Design Principles
1. **Story is uninterrupted.** Audience phones are used only during music-building and finale phases.
2. **Music is the metaphor.** No external props are required for meaning.
3. **Central timing, distributed choice.** The system runs on a master musical clock: audience controls *what* and *how*, not *when*.
4. **Legibility over complexity.** Binary choices, consistent visual cues, minimal UI.
5. **Safety constraints.** All musical actions are quantized and bounded so outputs remain coherent.
6. **Finale = discovery + integration.** Audience discovers fragments fit together through collective play; performer re-enters to shape the climax.
7. **Projector tells the story, phone is the instrument.** Visual narrative lives on the projector; audience phones are purely mechanical input devices.

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
| **Fragment** | A winning option from a reached layer during song-building, available in the finale consensus game. Only winners from layers that were actually voted on survive. |
| **Locked Fragment** | A fragment visible in the pre-game "elegy" display but not available during gameplay. Includes: losing options from voted layers AND both options from unreached layers (due to collapse). Represents "what could have been." |
| **Consensus Game** | The first phase of the finale. Audience collectively converges on fragments to activate them, one role at a time, through timed rounds with a live convergence meter. |
| **Convergence Meter** | A single scalar (0.0–1.0) showing how aligned the audience is during a consensus round. Does NOT show which fragment is leading. |
| **Convergence Threshold** | The minimum convergence value required for a round to succeed. Starts at ~40%, softens after consecutive failures. |
| **NPC** | A system-controlled narrative voice displayed on audience phones during the finale consensus game. Reacts to audience behavior, provides guidance, creates urgency. Terminal-style typeface. |
| **Performer Mix** | The second phase of the finale. The performer live-mixes fragments using a visual mixing surface, with changes quantized to loop boundaries. |
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

## Client Routes (Next.js App Router)

### `/audience` — Audience Member UI

**Join flow:** Unchanged from V1.

**Story phases (phones down):** Screen goes dark/minimal ("listen" state).

**Song-building phases:**
- Two large tappable cards: Option A (left) and Option B (right), styled with layer color + symbol
- **Blind vote**: no live feedback on vote split during the voting window
- After vote closes → **Reveal sequence**:
  1. Both options shown side by side, no result (tension beat)
  2. Split revealed: winning option grows, losing option shrinks proportionally
  3. Health Bar animates its drain (shadow region depletes)
  4. Winning option's audio locks into the mix
- Health Bar always visible (top of screen), showing cumulative song vitality
- Layer progress indicator showing completed layers and upcoming layers
- Personal vote history dot on each completed layer (subtle indicator of which side you voted for)

**Finale — Elegy moment (pre-game):**
- Full grid of all fragments from all three songs, organized by role
- Winners glowing, losers/locked fragments visually cracked or dimmed
- NPC text narrates: "This is what we have left. This is what we lost."
- Duration: ~10–15 seconds, purely observational, no interaction

**Finale — Consensus Game:**
- Clean game board: ONLY available (winning) fragments, organized by role row
- Each role row: role symbol + color on left, 1–3 tappable fragment tiles (one per song) to the right
- Fragment tiles show: chapter color background, short emotional label from song-building, personal history dot if user voted for this option
- Locked/completed roles compressed at top as small glowing badges
- **Convergence Meter** pinned to top: full-width, animated, with visible threshold zone
- NPC text appears below meter when active
- Tap a fragment to vote; tap a different one to change vote; must always have a vote placed
- Round timer visible (integrated into meter or alongside it)
- When convergence crosses threshold: meter visual shifts (glow, color change) — but round continues until timer expires
- Round success: winning tile bursts with chapter color, role row locks and compresses, sound fades into room
- Round failure: grid briefly shakes, votes clear, new round begins after ~3 seconds

**Finale — Performer Mix phase:**
- **TBD** — Options under consideration: phones go dark, minimal ambient visualization, or endorsement tap surface. See Open Questions.

### `/projector` — Public Display

**Story phases:** Dark or minimal atmospheric display.

**Song-building phases:**
- Top: Song attempt title + chapter color/icon
- Center: Current layer card — layer symbol + label, Option A vs Option B
- Health Bar: large, prominent, visible to whole room
- Reveal animation: vote split visualization, health bar drain
- Stack history: icons of chosen layers so far

**Finale — Consensus Game:**
- Richer view than phones: all fragments including locked ones (full history of the show)
- Convergence visualization (particles clustering, colors coalescing)
- Celebration animation when a fragment locks in
- NPC text displayed prominently

**Finale — Performer Mix:**
- Mirror of the performer's mixing surface (simplified/beautified)
- 7 rows showing active fragment per layer, chapter color
- Pending changes visible (pulsing, about to land)
- Loop position indicator
- Visual energy/density increases as mix builds
- When performer adds live performance layer (vocal, synth), new visual element appears that signals transcendence

### `/controller` — Performer/Operator Interface

**Access:** Secret route + passcode.

**Core Controls:**

| Category | Controls |
|----------|----------|
| **Show Phase** | Start Show, Stop Show, Advance Phase, Jump to Phase (dropdown) |
| **Song-Building** | Open Vote, Close Vote, Force Option A/B, Extend Timer, Rerun Vote |
| **Health Bar** | Adjust drain factor per attempt, Adjust layer multipliers, View current health, Override health value, Force Collapse |
| **Song Rejection** | Trigger rejection effect (OSC command to Ableton) — only for completed songs |
| **Audio** | Transport Play/Stop, Hard Mute/Panic, Per-layer force on/off |
| **Finale — Consensus** | Start/stop consensus rounds, Adjust threshold, View convergence data (which fragment leading, by how much), Fire NPC lines manually |
| **Finale — Performer Mix** | 7×6 mixing grid (7 layers × 6 fragments: 3 songs × 2 options), Queue/dequeue fragment changes, Mute/unmute layers, Snapshot presets, Loop position display |
| **Live Performance** | Toggle live input tracks (vocal, synth, etc.) |
| **Emergency** | Pause/Resume show, Export/Import state as JSON, Force reconnect all clients, Reset to lobby |

**Metrics/Telemetry:**
- Connected clients count
- Vote counts A vs B, consensus percent, time remaining
- Health bar status per attempt
- Consensus game: convergence value, round number, which fragment leading (controller only), failures count
- Performer mix: active layers, pending changes, loop position
- System health: WebSocket status, Ableton OSC status, error log tail

---

## Show Phase State Machine

```
lobby → opener → attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 attempt_story → attempt_build → attempt_resolve (if completed) →
                                       ↓ (if collapsed)
                 finale_elegy → finale_consensus → finale_performer_mix → ended
```

### Phase Details

```typescript
type ShowPhase =
  | 'lobby'                // Audience joining, scanning QR codes
  | 'opener'               // Performer monologue (phones dark)
  | 'attempt_story'        // Story phase for current attempt (phones dark)
  | 'attempt_build'        // Song-building phase for current attempt (phones active)
  | 'attempt_resolve'      // Song completed; performer rejects it (phones dim/watch)
  | 'finale_elegy'         // Audience sees full fragment wreckage (phones passive)
  | 'finale_consensus'     // Consensus game — audience builds base mix (phones active)
  | 'finale_performer_mix' // Performer live-mixes and escalates (phones TBD)
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
| `finale_elegy` | `finale_consensus` | Manual or Auto (after timer) | NPC takes over |
| `finale_consensus` | `finale_performer_mix` | Manual | When performer returns |
| `finale_performer_mix` | `ended` | Manual | |

---

## Song-Building Phase — Detailed Mechanics

### Layer Structure

Each attempt has exactly **7 layers**, one per layer type. The layer ordering is **staggered across songs** to ensure that across all three songs, every layer type is voted on early at least once. This creates both musical differentiation (each song builds from a different starting point) and guarantees diverse fragment availability regardless of health bar state.

```typescript
interface LayerConfig {
  index: number;              // 0-indexed position in this attempt's build order
  type: LayerType;            // Which musical role
  optionA: AudioReference;    // Ableton clip/track reference
  optionB: AudioReference;    // Ableton clip/track reference
  labelA: string;             // Short emotional tagline for A (e.g., "the ground that held")
  labelB: string;             // Short emotional tagline for B (e.g., "the ground that crumbled")
}

type LayerType =
  | 'melody'    // Defines chords, melodic hooks — harmonically specific
  | 'drums'     // Rhythmic patterns — harmonically neutral
  | 'pad'       // Sustained warmth, texture — harmonically compatible
  | 'bass'      // Low-end foundation — semi-harmonic (roots + fifths)
  | 'harmony'   // Arpeggios, counter-melodies — harmonically compatible
  | 'fx1'       // Risers, sweeps, transitions — harmonically neutral
  | 'fx2';      // Textures, atmospheres, foley — harmonically neutral
```

### Staggered Layer Ordering

| Position | Song 1 (Ambition) | Song 2 (Love) | Song 3 (Avoidance) |
|----------|-------------------|---------------|---------------------|
| Layer 0 | Bass | Melody | Pad |
| Layer 1 | Drums | Harmony | FX1 |
| Layer 2 | Pad | Bass | Drums |
| Layer 3 | Melody | Drums | Bass |
| Layer 4 | Harmony | Pad | Melody |
| Layer 5 | FX1 | FX1 | Harmony |
| Layer 6 | FX2 | FX2 | FX2 |

This ensures: every layer type appears in the first 3 layers of at least one song. FX layers are pushed toward the end as they are less structurally essential.

### Layer Phase Transitions (within `attempt_build`)

```
locked → auditioning → voting → revealing → locked_in
                                    │
                                    ▼ (if health bar reaches 0)
                                collapsed (attempt ends)
```

```typescript
type LayerPhase =
  | 'locked'        // Not yet reached; displayed as upcoming
  | 'auditioning'   // Playing A and B previews for the room
  | 'voting'        // Blind vote window open
  | 'revealing'     // Vote closed, reveal sequence playing
  | 'locked_in'     // Winner confirmed, added to song stack
  | 'collapsed';    // Health bar hit zero at this layer; attempt ends
```

### Blind Vote Mechanic

The vote window is a configurable duration (default: 10–15 seconds). During this window:
- Audience sees Option A and Option B as large tappable cards
- Each user taps once to vote; vote is final (no changing during blind vote)
- **No live feedback** on vote distribution. The audience cannot see which option is leading.
- This preserves authentic expression: you vote your preference, not the crowd's momentum

When the vote window closes, the **Reveal Sequence** plays:
1. **Tension beat** (~1s): both options displayed, no result
2. **Split reveal** (~2s): winning option grows, losing option shrinks proportionally
3. **Health bar drain** (~2s): animated depletion based on losing proportion
4. **Lock-in** (~2s): winning option's audio unmutes and enters the mix
5. **Advance**: next layer begins auditioning

### Health Bar

The Health Bar starts at 100 for each attempt and drains after every vote. Each layer costs more than the last via a configurable layer multiplier, representing the rising cost of creative commitment.

```typescript
interface HealthBarState {
  current: number;            // 0.0 to 100.0
  drainFactor: number;        // Base multiplier for drain amount (configurable per attempt)
  layerMultipliers: number[]; // Per-layer scaling factors (configurable, length = layersPerAttempt)
  history: HealthBarDrain[];  // Record of each drain event
}

interface HealthBarDrain {
  layerIndex: number;
  losingProportion: number;   // 0.0 to 0.5 (the minority side's share)
  layerMultiplier: number;    // The multiplier for this specific layer
  drainAmount: number;        // losingProportion * 100 * drainFactor * layerMultiplier
  healthAfter: number;        // Health bar value after this drain
}
```

**Drain calculation:**
```
losingProportion = min(votesA, votesB) / totalVotes
drainAmount = losingProportion * 100 * drainFactor * layerMultiplier[layerIndex]
newHealth = max(0, currentHealth - drainAmount)
```

**Default layer multipliers:** `[0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]`

Early layers are cheap — even significant disagreement barely scratches the health bar. Late layers are expensive — even moderate disagreement takes a large chunk. This guarantees that the first 2–3 layers almost always survive while making collapse increasingly likely in later layers.

**What the audience sees:** The drain amount is visually proportional to the damage. A large drain gets a dramatic animation; a small drain is barely noticeable. The health bar color shifts from healthy (green/bright) to critical (red/dark) as it decreases.

**Tuning guide** (with drainFactor = 0.5, default multipliers):
- Room averaging 70/30 splits → collapses around layer 5–6
- Room averaging 80/20 splits → survives to layer 6–7 (may complete)
- Room averaging 55/45 splits → collapses around layer 3–4

**Per-attempt tuning:** Both `drainFactor` and `layerMultipliers` can vary per song. Song 1 could be more forgiving (lower factor or gentler multiplier curve) as the audience learns. Song 3 could be harsher for dramatic tension.

### Collapse Behavior

When the health bar reaches zero after a vote's drain is applied:
1. The current layer enters `collapsed` phase — the vote's winner is still determined but the layer does NOT lock in
2. **Audio**: Collapse effect triggers via OSC (return track effects — distortion, filter sweep, reverb tail)
3. **Visual**: Health bar shatters/empties on projector; phone UI shows collapse state
4. **System**: All remaining layers for this attempt are marked `unreached`
5. **Data**: Locked-in layers from earlier in this attempt are preserved as available finale fragments. The collapsed layer and all unreached layers are lost (both options visible but locked in finale elegy).
6. After collapse animation duration, system transitions to next phase (auto-advance to `attempt_story` for Songs 1–2; manual advance to `finale_elegy` for Song 3)

### Song Completion & Rejection

If a song survives all 7 layers (health bar > 0 after final vote):
1. The complete song plays for 15–20 seconds — the audience hears their creation
2. The performer **narratively rejects** the song (self-sabotage)
3. A **rejection effect** is triggered via OSC (TBD: filter sweep, distortion, abrupt cut — configurable, distinct from collapse effect)
4. The system transitions to `attempt_resolve` phase
5. The performer advances to the next `attempt_story` when ready

**Two distinct endings:** Collapse is the cumulative weight of division killing the song — the audience's failure. Rejection is the performer killing a healthy song — the performer's failure. Both should have distinct audio and visual treatments so the audience can feel the difference.

### Song Stack & Fragment Generation

After each attempt, the system records:

```typescript
interface AttemptResult {
  attemptIndex: number;                // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layers: LayerResult[];               // Length 7 (includes unreached layers)
  completed: boolean;                  // True if all layers reached and passed
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
  healthBarFinal: number;              // Final health bar value
  healthBarHistory: HealthBarDrain[];  // Drain record for each voted layer
}

interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'unreached';  // unreached = never got to vote (collapse happened earlier)
  chosenOption: 'A' | 'B' | null;     // null if unreached
  consensus: number | null;            // null if unreached
  drainAmount: number | null;          // null if unreached
}
```

**Fragment availability for finale:**
- `locked_in` layers: the **winning** option becomes an available fragment in the finale consensus game
- `locked_in` layers: the **losing** option is visible in the elegy display but NOT available during gameplay
- `unreached` layers (due to collapse): **both** options are visible in the elegy display but NOT available during gameplay — these represent "what could have been"
- The performer's mixing surface has access to **all fragments** regardless of availability (both winners and losers from reached layers, plus both options from unreached layers)

**Fragment count depends on show performance:**
- Best case (all 3 songs complete): 21 available fragments (7 × 3)
- Typical case (songs collapse at layers 4–6): 12–18 available fragments
- Worst case (very early collapses): as few as 6–9 available fragments
- The staggered layer ordering guarantees that every layer type has at least one available fragment if each song reaches at least 2–3 layers

---

## Finale System — Detailed Mechanics

### Overview

The finale has three sub-phases:
1. **Elegy** — audience observes the wreckage of all three songs
2. **Consensus Game** — audience collectively resurrects fragments through wordless consensus
3. **Performer Mix** — performer returns to live-mix the escalation and climax

### Narrative Setup

After Song 3's rejection, the performer "abandons" the stage — stepping back, giving up, unable to finish anything. The audience's phones display NPC text in a terminal-style typeface. The NPC represents the "inner council" gaining consciousness and refusing to let the creator give up. Something like: "He's gone. We need to salvage this ourselves."

This frames the consensus game as a mutiny — the audience acting without the performer, proving integration was always possible.

### Phase 1: Finale Elegy

A 10–15 second observational moment. Phones show the full grid of all fragments from all three songs:
- Winning fragments glow with their chapter color
- Losing fragments are cracked, dimmed, desaturated
- Organized by role (7 rows)
- NPC narrates: acknowledges what survived and what was lost
- No interaction — pure narrative beat
- Transitions to consensus game when NPC rallies the audience (manual or auto-timed)

### Phase 2: Consensus Game

The core finale mechanic. The audience collectively activates fragments one at a time.

**Game Board:** The phone screen transitions from the elegy grid to a clean game board showing ONLY available fragments (21 tiles maximum, organized into 7 role rows of up to 3 tiles each). All locked fragments are hidden — the game board is purely functional.

**Round Flow:**
1. All unlocked role rows are active simultaneously; audience can vote for any fragment in any role
2. Each user taps one fragment (their vote). Can change vote freely during the round window.
3. Convergence meter (pinned to top of screen) updates in real time at ~4-5 Hz, reflecting how aligned the room is
4. Timer counts down (default: 15 seconds; first round: 20 seconds)
5. When timer expires:
   - If the most-voted fragment's convergence ≥ threshold → **SUCCESS**: fragment activates, role row locks
   - If no fragment crosses threshold → **FAILURE**: grid shakes, votes clear, NPC reacts, next round begins after ~3 seconds

**Convergence calculation:**
```typescript
function calculateConvergence(votes: Map<UserId, FragmentId>): {
  convergence: number;         // 0.0 to 1.0
  leadingFragment: FragmentId;
  distribution: Map<FragmentId, number>;  // vote counts (controller-only data)
} {
  // Count votes per fragment
  const counts = new Map<FragmentId, number>();
  for (const fragmentId of votes.values()) {
    counts.set(fragmentId, (counts.get(fragmentId) || 0) + 1);
  }
  const total = votes.size;
  if (total === 0) return { convergence: 0, leadingFragment: '', distribution: counts };

  let maxCount = 0;
  let leader = '';
  for (const [id, count] of counts) {
    if (count > maxCount) { maxCount = count; leader = id; }
  }
  return { convergence: maxCount / total, leadingFragment: leader, distribution: counts };
}
```

**Key convergence meter rules:**
- The meter shows a single scalar value (how aligned the room is). It does NOT show which fragment is leading.
- A visible threshold zone on the meter indicates the target. Below the line = not enough consensus. Above the line = success zone.
- When convergence enters the success zone, the visual treatment shifts (glow, color change) — creating a "hold it, hold it..." moment as the timer runs down.
- The round succeeds only if convergence is **above the threshold when the timer expires.** Briefly crossing and falling back is not enough.

**Threshold behavior:**
- Starting threshold: ~40% (configurable)
- After 2 consecutive failures: threshold drops to ~30%
- After 4+ consecutive failures: threshold drops to ~25%
- Threshold resets after each success
- NPC narratively acknowledges threshold softening: "we don't need everyone, just enough of us"

**Sound activation:** When a fragment locks in, its Ableton track is unmuted, quantized to the next bar boundary. Fade in over ~2 bars for a graceful entrance. The audience hears the fragment join the existing mix.

**Role locking:** When a role's fragment activates, the entire role row compresses to a small glowing badge at the top of the screen. Remaining unlocked rows spread to fill freed space.

**Game completion:** The game ends when all roles have an active fragment (7 successful consensus rounds). Alternatively, the performer can end it early by returning (manual transition from controller).

**Fragment voting interactions:**
- Tap a fragment to place vote
- Tap a different fragment to change vote (vote moves, meter responds within ~200ms)
- Cannot deselect — must always have a vote placed
- Can vote for fragments in any unlocked role (all roles available simultaneously)

### NPC System

The NPC is a reactive narrative voice during the consensus game.

**Delivery:** Terminal-style typeface on audience phones, below the convergence meter. Appears briefly, disappears between messages. Also displayed on projector.

**Control model:** Hybrid — auto-triggered for common patterns + manual overrides from controller.

**Auto-triggered conditions:**
- First failure: encouraging ("scattered... try again")
- Consecutive same-song convergence: exasperated ("again? we KNOW that one works")
- Near-miss (convergence just below threshold): hopeful ("so close... you're almost there")
- Long failure streak: vulnerable ("we're falling apart... just like before")
- First success: celebratory ("that fast? you've been holding out on me")
- Single-option role: acknowledging ("only one path forward here")
- Final fragment: climactic ("one more. make it count.")

**Manual overrides:** Performer has a bank of NPC lines on the controller, plus a free-text input for improvised lines.

**Pacing:** NPC should NOT speak every round. Best used at inflection points. Silence between messages lets the music and game breathe.

### Phase 3: Performer Mix

The performer returns to take control of the mix. This is a live performance tool.

**Mixing Surface (controller):**
- 7 rows (one per layer type) × 6 columns (Song 1 A, Song 1 B, Song 2 A, Song 2 B, Song 3 A, Song 3 B)
- Each cell is a fragment. Tapping a cell **queues** it to activate at the next loop boundary.
- Active fragment in each row is highlighted
- Pending (queued) fragment shows distinct visual (pulsing border, countdown)
- Only one fragment per row active at a time — tapping a new one in the same row queues a swap
- Tap the active fragment to queue a **mute** for that row at next boundary
- Tap a pending fragment again to **cancel** (dequeue)
- **All changes fire simultaneously at the loop boundary** — performer builds up multiple changes, they all land on the downbeat

**Loop position indicator:** Progress bar or radial timer showing position within current 8-bar loop and time until next boundary. This is the performance clock.

**Snapshot presets:** Configurable buttons that queue an entire mix state (all 7 layers set to specific fragments) in one tap. Useful for rehearsed structural jumps.

**Live performance tracks:** Additional on/off toggles for tracks not in the fragment pool — vocal mic, live synth, etc. These are the performer's secret weapon, the element the audience never had access to.

**Projector mirror:** The projector shows a simplified, beautified version of the mixing grid. Active fragments glow with chapter colors. Pending changes pulse. Loop position indicator visible. The audience watches the performer "DJ" with a legible interface.

**Pending changes queue:**
```typescript
interface PendingChange {
  layerType: LayerType;
  fragmentId: string | null;    // null = mute this layer
  queuedAt: number;
}
```

At each loop boundary, the timing engine:
1. Collects all pending changes
2. Fires corresponding OSC commands simultaneously (mute outgoing, unmute incoming)
3. Clears the pending queue
4. Broadcasts updated state to all clients

**Crossfade:** When swapping fragments in a role, Ableton handles a ~1 bar crossfade (old fragment fades out, new one fades in, overlapping at the loop boundary).

### Finale State

```typescript
interface FinaleState {
  phase: 'elegy' | 'consensus_game' | 'performer_mix';

  // Fragment availability (computed from song-building results)
  availableFragments: Fragment[];     // Winners only (for consensus game)
  allFragments: Fragment[];           // All 42 (for performer mixing surface)
  lockedFragments: Fragment[];        // Losers (for elegy display)

  // Consensus game state
  consensusGame: {
    active: boolean;
    currentRound: number;
    roundTimeRemaining: number;       // ms
    votes: Map<UserId, string>;       // userId → fragmentId
    convergenceValue: number;         // 0.0 to 1.0
    threshold: number;                // Current threshold (may decrease after failures)
    consecutiveFailures: number;
    lockedRoles: Map<LayerType, string>;  // layerType → fragmentId (activated fragments)
  };

  // NPC state
  npc: {
    currentMessage: string | null;
    autoTriggersEnabled: boolean;
  };

  // Performer mix state
  performerMix: {
    activeLayers: Map<LayerType, string | null>;  // layerType → fragmentId or null (muted)
    pendingChanges: PendingChange[];
    loopPosition: number;             // 0.0 to 1.0 within current 8-bar loop
    loopCount: number;                // Total loops since finale started
    liveTracksActive: string[];       // IDs of active live performance tracks
  };
}
```

---

## Musical Design Specification

### Shared Compatibility Universe

All fragments across all three songs share:
- **Key:** B minor (B natural minor scale: B, C#, D, E, F#, G, A)
- **BPM:** Fixed (target: 120 BPM, configurable)
- **Loop length:** Exactly 8 bars
- **Time signature:** 4/4
- **Chord progression:** Same progression across all songs
- **Harmonic rhythm:** One chord per 2 bars (4 chords across 8 bars)

### Chord Progression & Harmonic Rules

**Sync points:** Bars 1, 3, 5, and 7 are harmonic sync points. Every harmonically specific fragment must agree on the chord at these bar boundaries.

**Passing chords:** Between sync points, individual fragments may use passing chords lasting less than 1 beat. These read as melodic movement, not as competing harmony. Passing material must be short and directional (heading toward the next sync point chord).

**Harmonic specificity tiers:**
- **Harmonically specific** (Melody): defines the chord progression explicitly. Only one harmonically specific fragment should dominate at a time.
- **Harmonically compatible** (Pad, Harmony, Bass): uses chord tones, pentatonic notes, or sustained intervals that work over all chords. Emphasize roots, fifths, and pentatonic (B, D, E, F#, A) for maximum cross-fragment safety.
- **Harmonically neutral** (Drums, FX1, FX2): no pitched content or heavily filtered. Compatible with everything.

### Song Differentiation

Same key, same BPM, same progression — songs feel different via:
- **Orchestration:** Different instruments, timbres, articulations
- **Groove:** Song 1 = straight, Song 2 = swung, Song 3 = half-time feel
- **Register:** Song 1 = bright/high, Song 2 = warm/mid, Song 3 = dark/low + airy highs
- **Density & space:** Song 1 = tight and driving, Song 2 = spacious and breathing, Song 3 = sparse and evasive
- **Build order:** Staggered layer ordering makes each song start from a different musical foundation

### EQ Fencing (Spectral Separation)

Each layer type occupies a designated frequency range. EQ cuts on each track remove energy from other layers' ranges:
- **Bass:** Owns 60–200 Hz. Low-pass filter at ~250 Hz.
- **Drums:** Key hits span spectrum (kick ~60–100 Hz, snare ~200–500 Hz, hi-hats ~8kHz+). No single fence; manage via arrangement.
- **Pad:** 200–500 Hz. Cut below 200 Hz (bass territory) and above 2 kHz (melody territory).
- **Melody:** 500 Hz – 2 kHz. Cut below 400 Hz.
- **Harmony:** 1–4 kHz. Higher register than pad to avoid competition.
- **FX1, FX2:** Extremes and gaps. Very high shimmer, very low rumble, or sweeping through spectrum.

### Production Guidelines

- **Bar 1 is sacred:** clean downbeat, no fills bleeding across the loop point. All fragments must re-sync cleanly at bar 1.
- **Bars 7–8 are free:** variations, fills, builds, resolving phrases. This gives each loop a sense of "going somewhere."
- **Use silence:** fragments with rhythmic holes allow other fragments to shine through when combined.
- **Velocity dynamics:** vary note velocities within each 8-bar loop. Louder on downbeats, softer on offbeats. Slight crescendo toward bar 5.
- **Micro-timing/swing:** use Ableton's groove pool. Different swing amounts per song for differentiation.
- **Timbre evolution:** automate one parameter per fragment across 8 bars (filter opening, reverb swell, chorus depth).
- **Reverb discipline:** reverb on melody, harmony, FX. Keep bass and drums dry or nearly dry.

---

## Audio Engine & Ableton Integration

### Track Layout

**Song-building tracks** (3 songs × 7 layers × 2 options = 42 tracks):
- Track index: `songIndex * (layersPerSong * 2) + layerIndex * 2 + optionOffset`
  - `optionOffset`: 0 for Option A, 1 for Option B
- With 7 layers per song: tracks 0–41
- Example: Song 0, Layer 2, Option B = `0 * 14 + 2 * 2 + 1 = track 5`
- Example: Song 1, Layer 0, Option A = `1 * 14 + 0 * 2 + 0 = track 14`
- Example: Song 2, Layer 3, Option A = `2 * 14 + 3 * 2 + 0 = track 34`

**Live performance tracks** (beyond index 41): vocal mic, live synth, etc. Not part of the fragment system. Controlled only by the performer.

**Song rejection effect:** A return track with configurable effects (filter sweep, distortion, reverb tail) triggered via OSC. All song-building tracks route through this return.

### Playback Modes

**Song-building:**
- Audition: briefly unmute/solo Option A, then Option B (quantized transitions)
- Lock-in: unmute chosen option's track, mute unchosen
- Stack accumulates: previously locked layers stay unmuted

**Collapse:**
- Triggered when health bar reaches 0
- Collapse effect activates on return track (distortion, filter sweep, reverb tail)
- Rapid fade or filter sweep on all active tracks for this attempt
- After gesture completes, mute all tracks for the collapsed attempt

**Song rejection:**
- Triggered via controller for completed songs only
- Rejection effect on return track activates (TBD: distinct from collapse effect — configurable)
- After effect completes, all tracks for this attempt are muted

**Finale — Consensus game:**
- Each successful consensus round: unmute the winning fragment's track, quantized to next bar boundary
- Fade in over ~2 bars

**Collapse:**
- Triggered when health bar reaches 0
- Enable collapse return track effects via OSC
- Rapid fade/filter sweep on all active tracks for the collapsed attempt
- After collapse animation duration, mute all tracks for the attempt

**Finale — Performer mix:**
- Pending changes queue fires all mute/unmute commands simultaneously at loop boundary
- Swaps within a role: ~1 bar crossfade (old fades out, new fades in)
- Muting a role: fade out over ~1 bar at loop boundary

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
| `/live/device/set/parameter/value` | `trackIndex`, `deviceIndex`, `paramIndex`, `value` | Set device parameter |
| `/live/return/set/mute` | `returnIndex`, `mute` | Mute/unmute return track |

**AbletonOSC → Server (Port 11001)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/live/test` | `response` | Connectivity test response |
| `/live/song/get/beat` | `beatNumber` | Beat event (when subscribed) |

### Fallback Mode (No Ableton)

Unchanged from V1. Timing engine uses JS timers; audio cues are logged but not sent.

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
MOCK_BPM=120

# Health Bar
DEFAULT_DRAIN_FACTOR=0.5
DEFAULT_LAYER_MULTIPLIERS=0.5,0.6,0.8,1.0,1.3,1.6,2.0
COLLAPSE_ANIMATION_MS=5000

# Consensus Game
CONSENSUS_ROUND_DURATION_MS=15000
CONSENSUS_FIRST_ROUND_DURATION_MS=20000
CONSENSUS_INITIAL_THRESHOLD=0.4
CONSENSUS_FAILURE_THRESHOLD_DECAY=0.05
CONSENSUS_MIN_THRESHOLD=0.25
CONSENSUS_INTER_ROUND_DELAY_MS=3000
CONSENSUS_SUCCESS_CELEBRATION_MS=6000
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
}
```

**Note:** `finaleChapter` removed. Chapter assignment no longer exists.

### Show State

```typescript
interface ShowState {
  id: string;                          // Unique show instance
  phase: ShowPhase;
  currentAttemptIndex: number;         // 0, 1, 2
  attempts: AttemptState[];            // Length 3, pre-initialized
  users: Map<UserId, User>;
  finaleState: FinaleState | null;     // Populated at finale_elegy
  config: ShowConfig;
  version: number;                     // Increments on every state change
  lastUpdated: number;
  paused: boolean;
}

interface AttemptState {
  index: number;                       // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layerPlan: LayerConfig[];            // Always length 7
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];         // Populated as layers resolve
  votes: LayerVote[];                  // All votes for this attempt
  healthBar: HealthBarState;
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
}

type Chapter = 'ambition' | 'love' | 'avoidance';
```

### Show Config

```typescript
interface ShowConfig {
  layersPerAttempt: number;            // Always 7
  attempts: AttemptConfig[];           // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;
  };
  seatIds: SeatId[];
}

interface AttemptConfig {
  chapter: Chapter;
  title: string;
  layers: LayerConfig[];              // 7 layers, staggered per song
  drainFactor: number;                // Health bar base drain multiplier for this attempt
  layerMultipliers: number[];         // Per-layer scaling factors (length 7, e.g., [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0])
}

interface FinaleConfig {
  consensusRoundDurationMs: number;
  firstRoundDurationMs: number;
  initialThreshold: number;
  thresholdDecayPerFailure: number;
  minThreshold: number;
  interRoundDelayMs: number;
  successCelebrationMs: number;
  npcAutoTriggers: NpcTriggerConfig[];
}

interface TimingConfig {
  auditionDurationMs: number;
  votingWindowMs: number;
  revealSequenceDurationMs: number;
  rejectionEffectDurationMs: number;
}

interface Fragment {
  id: string;
  songIndex: number;                   // 0, 1, 2
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayLabel: string;               // Emotional tagline from layer config
  audioRef: AudioReference;           // Ableton track index
}
```

---

## Conductor (Pure State Machine)

The Conductor is a pure logic module with no I/O. It receives commands, validates them, updates state, and emits events.

### Commands (Input)

```typescript
type ConductorCommand =
  // Show flow
  | { type: 'ADVANCE_PHASE' }
  | { type: 'JUMP_TO_PHASE'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }

  // Song-building
  | { type: 'START_AUDITION' }
  | { type: 'OPEN_VOTING' }
  | { type: 'CLOSE_VOTING' }
  | { type: 'SUBMIT_VOTE'; userId: UserId; choice: 'A' | 'B' }
  | { type: 'FORCE_OPTION'; choice: 'A' | 'B' }
  | { type: 'EXTEND_VOTE_TIMER'; additionalMs: number }
  | { type: 'RERUN_VOTE' }

  // Health Bar
  | { type: 'SET_DRAIN_FACTOR'; factor: number }
  | { type: 'SET_HEALTH'; value: number }
  | { type: 'FORCE_COLLAPSE' }                          // End attempt immediately

  // Song Rejection
  | { type: 'TRIGGER_REJECTION' }                       // Only for completed songs

  // Finale — Consensus Game
  | { type: 'SETUP_FINALE' }
  | { type: 'START_CONSENSUS_ROUND' }
  | { type: 'SUBMIT_CONSENSUS_VOTE'; userId: UserId; fragmentId: string }
  | { type: 'END_CONSENSUS_ROUND' }
  | { type: 'SET_CONSENSUS_THRESHOLD'; threshold: number }
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Finale — Performer Mix
  | { type: 'START_PERFORMER_MIX' }
  | { type: 'QUEUE_FRAGMENT'; layerType: LayerType; fragmentId: string | null }
  | { type: 'CANCEL_PENDING'; layerType: LayerType }
  | { type: 'FIRE_PENDING_CHANGES' }
  | { type: 'LOAD_SNAPSHOT'; snapshot: Map<LayerType, string | null> }
  | { type: 'TOGGLE_LIVE_TRACK'; trackId: string }

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }

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
  | { type: 'HEALTH_BAR_DRAINED'; attemptIndex: number; layerIndex: number; drain: HealthBarDrain }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number; healthBar: HealthBarState }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }
  | { type: 'SONG_REJECTED'; attemptIndex: number }

  // Finale
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: Fragment[]; lockedFragments: Fragment[] }
  | { type: 'CONSENSUS_ROUND_STARTED'; roundNumber: number; threshold: number }
  | { type: 'CONSENSUS_VOTE_UPDATED'; convergenceValue: number }
  | { type: 'CONSENSUS_ROUND_SUCCESS'; fragmentId: string; layerType: LayerType; convergence: number }
  | { type: 'CONSENSUS_ROUND_FAILURE'; highestConvergence: number }
  | { type: 'CONSENSUS_GAME_COMPLETE' }
  | { type: 'NPC_MESSAGE'; message: string }
  | { type: 'PERFORMER_MIX_STARTED' }
  | { type: 'PENDING_CHANGES_FIRED'; changes: PendingChange[] }
  | { type: 'MIX_STATE_UPDATED'; activeLayers: Map<LayerType, string | null> }

  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }

  // State
  | { type: 'STATE_UPDATED'; version: number };

interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;           // Winning side's proportion
  votesA: number;
  votesB: number;
  totalVotes: number;
  drain: HealthBarDrain;
}
```

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation:
- **Controller**: Full serialized state
- **Projector**: Public filtered state (no individual user data; includes convergence data during consensus game)
- **Audience**: Personalized state (their votes, their view of the game board, convergence meter value)

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience (song-building) |
| `consensus_vote` | `{ fragmentId }` | Audience (finale consensus game) |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered per client type) | All |
| `identity` | `{ userId }` | New audience members |
| `convergence_update` | `{ value: number }` | Audience + Projector (~4-5 Hz during consensus rounds) |
| `npc_message` | `{ message: string }` | Audience + Projector |
| `error` | `{ message }` | Controller |

**Note on convergence updates:** Sent as a separate high-frequency event during consensus rounds, NOT as part of state_sync. This enables the responsive meter animation.

---

## Persistence Layer

### SQLite with WAL Mode

Unchanged from V1.

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

CREATE TABLE consensus_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  winning_fragment_id TEXT,          -- NULL if round failed
  convergence REAL,
  threshold REAL NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

**Removed:** `fragment_selections` table (no individual fragment selection). `finale_chapter` column removed from `users`.

### Persistence Strategy & Recovery

Unchanged from V1. Persist after EVERY state change. Atomic SQLite transactions. Stateless clients. Automatic reconnection with exponential backoff.

---

## Recovery & Robustness

Unchanged from V1. See original architecture for heartbeat, state versioning, backup snapshots, and fallback modes.

---

## Visual Identity System

### Chapter Identity (consistent across all UIs)

| Chapter | Color | Icon | Usage |
|---------|-------|------|-------|
| Ambition | TBD | TBD | Song 1, fragment badges |
| Love | TBD | TBD | Song 2, fragment badges |
| Avoidance | TBD | TBD | Song 3, fragment badges |

### Layer Identity (consistent across all 3 attempts)

| Layer Type | Color | Symbol | Label |
|------------|-------|--------|-------|
| Melody | TBD | ✦ | "The voice" |
| Drums | TBD | ▲ | "The heartbeat" |
| Pad | TBD | ◆ | "The warmth" |
| Bass | TBD | ■ | "The ground" |
| Harmony | TBD | ● | "The color" |
| FX1 | TBD | ~ | "The shimmer" |
| FX2 | TBD | ∿ | "The shadow" |

*Placeholders — lock before production.*

### Option Identity (A vs B within a layer)
- Option A: layer color, **solid** style
- Option B: layer color, **outlined** style

---

## Folder Structure

```
solo-show/
├── ARCHITECTURE.md              # This document (V2 — source of truth)
├── MIGRATION.md                 # Migration guide from V1 to V2
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
│   ├── consensus-game.ts        # Convergence calculation, round management, thresholds
│   ├── performer-mix.ts         # Pending changes queue, mix state, snapshots
│   ├── fragments.ts             # Fragment generation from attempt results
│   ├── npc.ts                   # NPC auto-trigger logic
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
│   │   ├── ConsensusBoard.tsx   # Clean game board (available fragments only)
│   │   ├── ConvergenceMeter.tsx # Real-time convergence gauge
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
│       ├── ConsensusControls.tsx # Round management, threshold, convergence data
│       ├── NpcControls.tsx      # NPC line bank + manual fire
│       ├── MixingSurface.tsx    # Performer mix interface
│       ├── SnapshotPresets.tsx  # Quick-load mix configurations
│       └── MetricsPanel.tsx     # Telemetry dashboard
│
├── hooks/
│   ├── useSocket.ts             # Socket.IO connection + reconnection
│   ├── useShowState.ts          # Client-side state management
│   └── useConvergence.ts        # Convergence meter animation + smoothing
│
├── lib/
│   ├── socket-client.ts         # Socket.IO client setup
│   ├── storage.ts               # localStorage for client identity
│   ├── serialization.ts         # Map/Set JSON serialization
│   └── identity.ts              # Chapter/layer color+symbol mappings
│
├── config/
│   ├── default-show.json        # Pre-configured attempts, layers, fragments
│   ├── ableton-layout.json      # Track index mappings
│   └── npc-triggers.json        # Auto-triggered NPC line conditions and text
│
├── db/
│   └── schema.sql               # SQLite schema (V2)
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
test('consensus round succeeds only if convergence above threshold at timer expiry', ...)
test('performer pending changes all fire simultaneously at loop boundary', ...)
test('NPC auto-triggers on consecutive same-song convergence', ...)
```

---

## Open Questions (To Be Resolved)

- [ ] **Audience phones during performer mix phase:** Go dark, minimal ambient visualization, or endorsement tap surface?
- [ ] **Song rejection audio effect:** Exact Ableton effect chain and OSC trigger method. Should be distinct from collapse effect.
- [ ] **Collapse audio effect:** Exact Ableton effect chain for when health bar hits zero. Should be distinct from rejection effect.
- [ ] **Exact chord progression:** B minor key confirmed; specific 4-chord sequence TBD pending Ableton exploration.
- [ ] Locked color/symbol assignments for layers + chapters
- [ ] Specific fragment display labels (emotional taglines per option)
- [ ] NPC text library (auto-triggered and manual lines)
- [ ] Projector visual design and animations
- [ ] Performer mix snapshot presets
- [ ] Live performance track configuration
- [ ] Consensus game: optimal round duration tuning (15s default, needs playtesting)
- [ ] Consensus game: minimum round window before instant-lock (proposed: 5 seconds)

---

## Appendix: What Changed from V1

### Removed Systems
- **Per-layer doubt thresholds** → replaced by Health Bar with cumulative drain and layer multipliers
- **Chapter assignment** → no chapter assignment in finale
- **Individual fragment selection** → replaced by consensus game
- **Fragment queue / rotation system** → replaced by consensus game + performer mix
- **Stewardship / safe parameter control** → removed entirely
- **Triangle steering / centroid** → removed entirely
- **Active slots (7-slot rotation)** → replaced by role-typed layer activation
- **Audio metering (M4L → projector)** → removed (may be re-added for projector visuals)

### New Systems
- **Health Bar** with cumulative drain + configurable layer multipliers (rising cost of commitment)
- **Mechanical collapse** when health bar reaches zero (songs can fail)
- **Blind vote** with reveal sequence (no live split feedback during voting)
- **Song rejection** for completed songs (narrative, performer-triggered, OSC effect — distinct from collapse)
- **Consensus Game** (convergence meter, timed rounds, threshold softening)
- **NPC system** (hybrid auto/manual, terminal-style display)
- **Performer mixing surface** (7×6 grid, pending changes queue, loop quantization)
- **Snapshot presets** for performer mix
- **Musical design specification** (harmonic rules, EQ fencing, production guidelines)

### Changed Systems
- **Layer types** updated: Foundation/Pulse/Color/Space/Voice → Melody/Drums/Pad/Bass/Harmony/FX1/FX2
- **Show phase state machine** restructured (collapse and rejection are distinct paths)
- **Collapse mechanic** redesigned: driven by cumulative health bar drain with layer multipliers, not per-layer threshold checks
- **AttemptState** has new `healthBar` field; `collapsedAtLayer` retained
- **Fragment** no longer has `safeParameter`
- **User** no longer has `finaleChapter`

# Solo Show — Show Architecture & System Design (Agent Context)

## Purpose
This document describes the intended design of the Solo Show performance system: a live theatrical monologue punctuated by interactive music-making on audience phones and a projector display. The show’s central metaphor is:

> **If I can build a song, I can build a life.**

The audience’s participation is framed as a **mirror of the performer’s inner world** (not antagonists). The system is designed to be legible, reliable in a live setting, and simple enough to build in ~2 months.

---

## Core Design Principles
1. **Story is uninterrupted.** Audience phones are used only during music-building phases.
2. **Music is the metaphor.** No tower/tree/faction props are required for meaning.
3. **Central timing, distributed choice.** The system runs on a master musical clock (Incredibox-like): audience controls *what* and *how*, not *when*.
4. **Legibility over complexity.** Binary choices, consistent visual cues, minimal UI.
5. **Safety constraints.** All musical actions are quantized and bounded so outputs remain coherent.
6. **Finale = discovery + integration.** Audience discovers fragments fit together; performer re-enters to shape (not overwrite).

---

## Show Structure (Theatrical Macro Flow)

### Act 0 — Opener (Phones Down)
- Performer monologue about **potential** as both fantasy and despair; a “provisional life,” indecision, never finishing.
- Thesis: **“If I can build a song, I can build a life.”**
- Audience framed as mirror of performer’s mind/subconscious; performer may address them as “Jared” / self-in-mirror.
- Performer foreshadows mechanics:
  - Starting is easy; continuing is harder.
  - Deeper commitment requires deeper internal agreement.
  - Doubt rises as depth increases.

### Acts 1–3 — Three Story Attempts (Phones Down → Phones Up)
Each attempt is:
1) **Story Phase (phones down):** complete story is told uninterrupted.
2) **Song-Building Phase (phones up):** audience helps “write a song about that story” by choosing layers and shaping interpretation.

Story attempts (current):
- **Song 1: Ambition / Becoming**
- **Song 2: Love / Presence**
- **Song 3: Avoidance / Addiction**

The story is not conditional. The **music attempt** may fragment or collapse based on consensus/doubt mechanics.

### Finale — Audience Discovery → Performer Integration
- After Song 3 fades, performer sits in silence/aftermath.
- Finale system activates: audience “gets the keys.”
- Audience layers fragments from all three songs and discovers they are compatible.
- Performer returns for light live mixing/performing to embody integration.

---

## Interactive System Overview (Technical Macro Architecture)

### Components (Three Views + Server + Audio)
- **Audience Web App (mobile):**
  - Song-building voting UI (binary choices)
  - Consensus + Doubt meter feedback
  - Finale UI (triangle steering + queue + stewardship control)
- **Projector Web App (public display):**
  - Shows current layer state, chapter identity cues, vote results, meters
  - Finale: active slots + collective dot + slot ownership indicators
- **Controller Web App (operator view):**
  - Master control over show state/timing
  - Manual overrides and safety controls
  - Metrics/telemetry during live operation
- **Server / Conductor (state + realtime):**
  - Owns show state, vote windows, threshold logic, queue scheduling, rotation timing
  - WebSocket sync for all clients (audience/projector/controller)
- **Audio Engine (Ableton Live):**
  - Plays stems and layers; receives commands (clip selection, layer enabling, macro params)
  - Optional metering back to visuals (recommended: M4L envelope follower → OSC)

---

# Song-Building Phase (Repeated 3x) — Detailed Spec
This is the core interaction the audience learns and repeats for each story attempt.

## Overview
- The performer tells a full story (phones down).
- Performer transitions into song-building with a prompt like:
  > “What does that story sound like?”
- The audience then builds the song through **a sequence of layers**.
- **Each layer is a binary choice**: Option A or Option B.
- After a certain depth, a **Consensus Threshold** applies:
  - The audience must reach a minimum consensus to proceed.
  - This threshold is thematically framed as **Doubt** that must be overcome by **Alignment/Consensus**.

## Layer Structure
Each song attempt has a fixed layer plan (target: 5–7 layers max; tune later).

Each layer step:
1) **Audition**: Play A and B (short, quantized preview; optional micro-loop).
2) **Vote Window**: Audience selects A or B.
3) **Lock-In**: Winning option becomes part of the current song stack.
4) **Proceed**: Next layer begins, or attempt collapses if threshold not met.

### Recommended Layer Types (legible to lay audience)
Avoid “drums/bass/harmony” jargon unless desired. Use emotionally legible labels that map internally to musical categories:
- **Foundation** (the bed / the ground)
- **Pulse** (heartbeat / drive)
- **Color** (warmth / sharpness)
- **Space** (intimate / distant)
- **Voice** (clear / masked) — could be performer live layer or motif layer

## Consensus Threshold (Doubt Meter)
### Goal
Create rising stakes: it gets harder to go deeper, mirroring how commitment becomes harder as meaning increases.

### Mechanic
- Early layers: simple majority decides (no threshold).
- After N layers (e.g., after Layer 2 or 3), **Doubt activates**:
  - The system requires the winning option to have consensus ≥ threshold to continue.
  - If consensus < threshold, the attempt **fails** (the song collapses/aborts) and performer transitions to the next story attempt.

### Thematic framing
- **Doubt Meter** rises as the song deepens.
- **Consensus** must meet or exceed Doubt to proceed.
- Narrative interpretation: “As we go deeper, I need more of myself to agree.”

### Example thresholds (tunable)
- Layers 1–2: no threshold, simple win
- Layer 3: threshold 65%
- Layer 4: threshold 75%
- Layer 5: threshold 85%
- Optional Layer 6+: threshold 90% (“nearly impossible”)

### What counts as “consensus”
- `consensus = max(votesA, votesB) / totalVotes`

### Failure behavior (important)
When threshold fails:
- **Audio**: current stack quickly fades or “falls apart” (short, dramatic end gesture).
- **Visual**: Doubt Meter visibly exceeds Consensus.
- **Performance**: performer reacts with narrative beat (self-sabotage / moving goalposts / despair), but frames it as **me vs me**, not audience blame.

---

# Visual Legibility System (Song-Building)
The audience must understand what they’re choosing even without hearing subtle differences.

## Requirements
1. Each layer has a consistent **identity** (color + symbol).
2. Each option (A/B) has a consistent **sub-identity** (left/right variant styling).
3. The projector reinforces identity and results so people feel anchored.

## Layer Identity (Color + Symbol)
For each layer type, assign:
- **Color** (high contrast, consistent)
- **Symbol** (simple geometric icon)
- **Short label** (human language)

Example mapping (placeholder—lock later):
- Foundation: Deep red + ■
- Pulse: Bright yellow + ▲
- Color: Purple + ●
- Space: Blue + ~
- Voice: White + ✦

Keep this mapping consistent across all three attempts so the audience “learns the language.”

## Option Identity (A vs B)
Within a layer:
- Option A: same layer color, **solid** style
- Option B: same layer color, **outlined** style
(Or A = left hatch, B = right hatch—just be consistent.)

## Projector Layout (Song-Building)
At minimum:
- Top: Song attempt title (Ambition / Love / Avoidance) + chapter color/icon
- Center: Current layer card
  - Layer symbol + label
  - Option A card (left) vs Option B card (right)
- Bottom: Stack history (icons of chosen layers so far)
- Meters when active:
  - **Consensus bar** (shows leading side and margin)
  - **Doubt meter** (threshold line / rising gauge)

Avoid raw analytics dashboards; keep it theatrical and readable.

## Phone UI (Song-Building)
- Single screen per layer:
  - Two large buttons A/B with layer color + symbol
  - Short emotional tag lines
  - When Doubt is active: show threshold clearly (“Need ≥ X%”)

---

## Audio Engine Notes (Song-Building)
- All audition and lock-in actions are quantized to the master clock.
- Audition can be implemented by:
  - briefly soloing A then B, or
  - quick A/B switching with a consistent transition stinger.
- Lock-in means:
  - chosen clip enabled in Ableton
  - non-chosen disabled/muted
- Stack = chosen clips across layers.

---

# Finale System — Detailed Spec

## Intent
The audience collectively and individually discovers that fragments from earlier “separate songs” fit together. This is the reveal: dissonance becomes harmony, not by perfection but by orchestration.

## Master Clock
- A global **master loop** governs all changes.
- Recommended: **8-bar** quantization unit (minimum).

## Active Slots
- The finale mix has a fixed number of **active slots** (target: **7**).
- Each slot holds one fragment at a time.
- Slot changes happen quantized with short fades.

## Rotation
- Primary cadence: every **8 bars**, rotate out **2 slots** and rotate in **2 new slots** (with 1-bar fades).
- Optional: slow to 1 slot per cycle when the mix becomes “magical.”
- Operator can freeze rotation.

## Stewardship (Individual Agency)
- When an audience member’s queued fragment becomes active:
  - Their phone enters **Steward Mode**
  - They control **one safe parameter** for that fragment (examples: filter cutoff, reverb amount, density, width).
- Constraints:
  - Parameter ranges are musically safe (clamped).
  - Parameter changes are smoothed (no zipper noise).
  - Steward cannot mute other layers or affect tempo/key.
- When their stewardship ends, their controls return to neutral and the slot rotates normally.

## Fairness (Audience ~40)
- Goal: **everyone gets at least one stewardship turn**.
- Scheduler prioritizes people who have not stewarded yet.
- Optional cooldown: once you’ve stewarded, you can’t re-enter until most/all have had a first turn.

## Chapter Identity Cues (Critical)
Each fragment is tagged with a story chapter:
- **Ambition** (Song 1) — chapter color/icon A
- **Love** (Song 2) — chapter color/icon B
- **Avoidance** (Song 3) — chapter color/icon C

These cues appear on:
- phone UI (triangle corners + selection)
- projector UI (slot cards, accents, glows)

## Collective Steering (Continuous Triangle)
### UX
When not stewarding, each audience member sees a triangle with corners:
- Ambition
- Love
- Avoidance

They drag a dot continuously. The dot position yields weights:
- wA, wL, wV (sum to 1)

### Aggregation
- Server computes a **collective centroid** dot (average).
- Projector displays **one collective dot** + subtle accent color blending that matches centroid blend.

### Effect on Scheduling
At each rotation tick:
1) pick next stewards primarily by fairness
2) bias which queued chapter gets inserted based on centroid weights
3) apply diversity nudges (below)

### Nudges (Simple, Non-Complex)
1) **Auto-recenter drift:** if a user doesn’t touch the triangle for some time, their dot gently drifts toward center.
2) **Underrepresented glow:** if a chapter hasn’t been featured recently, its corner subtly glows to invite exploration.

## Fragment Selection Model
### Fragment Library
- Curated set of fragments derived from earlier attempts (Songs 1–3).
- Each fragment has metadata:
  - chapter: Ambition/Love/Avoidance
  - role: drums/bass/harmony/melody/texture/etc (internal)
  - safe_parameter: the one parameter stewards control
  - default_parameter_value
  - audio routing reference (Ableton track/clip identifiers)

### Audience Choice (Finale)
- Users queue a fragment (or chapter+role) from the set of unlocked fragments.
- Chapter identity is always visible at selection time (color/icon).

## Projector Visualization Requirements (Finale)
- 7 slot cards showing:
  - chapter color/icon
  - fragment name/icon
  - steward sigil (unique color/glyph) while active
  - optional: energy meter / glow driven by audio level
- One collective steering dot + chapter-accent color blend
- Simple phase indicator (Finale Rotating / Frozen / Integration)

---

## Ableton Integration (Recommended Approach)
- Ableton is audio source of truth.
- Commands server → Ableton:
  - start/stop transport
  - activate/deactivate clips (slot content)
  - update parameters (mapped to rack macros or device parameters)
- Optional Ableton → server metering:
  - M4L envelope follower per slot track sends RMS/energy via OSC to server
  - server broadcasts to projector for responsive visuals

Avoid full waveform streaming; meters are sufficient and robust.

---

## Networking & Reliability
- Local network assumed.
- WebSocket-based real-time sync.
- Clients reconnect gracefully; server is authoritative.
- System should degrade gracefully:
  - if some phones drop, show continues
  - controller can override state
- Controller View must remain usable under partial disconnection.

---

# Controller View (Operator Console) — Detailed Spec

## Purpose
A private operator interface used by performer and/or stage manager to run the show reliably. Provides:
- Phase control (advance/reset/freeze)
- Manual overrides (audio + visuals + voting)
- Health metrics and debug signals
- Emergency fallbacks

## Access
- Secret route (e.g. `/control`) + passcode.
- One operator session required; optionally allow multiple.

## Core Controls (Must-Have)

### A) Show Phase State Machine
Buttons:
- Start Show / Stop Show
- Advance Phase
- Jump to Phase (dropdown)

Phases (example):
- Opener
- Attempt 1: Story
- Attempt 1: Build
- Attempt 2: Story
- Attempt 2: Build
- Attempt 3: Story
- Attempt 3: Build
- Finale: Setup
- Finale: Rotating
- Finale: Freeze + Performer Mix
- End

### B) Voting Window Controls (Song-Building)
- Open Vote (A/B) for current layer
- Close Vote
- Force Option A / Force Option B
- Extend Vote Timer (+5s, +10s)
- Invalidate Vote / Re-run Vote (re-audition)

### C) Threshold / Doubt Controls
- Set/adjust current threshold percentage (slider or presets)
- Toggle Doubt Active on/off
- Force Continue (ignore threshold once)
- Force Collapse (end attempt immediately)

### D) Audio Engine Controls (Ableton)
- Transport: Play / Stop
- Hard mute / panic (stop all clips)
- Per-layer override:
  - force layer on/off
  - force audition playback A/B
  - trigger “collapse gesture” audio cue

### E) Finale Controls
- Start/Stop rotation
- Rotation rate: 1 or 2 slots per 8 bars
- Freeze rotation (lock current mix)
- Clear queue / reset queue
- Force assign next steward (manual)
- Force insert specific fragment into specific slot (emergency)
- Toggle triangle steer active on/off (fallback to neutral)

## Metrics & Telemetry (Recommended)
### Audience Participation
- Connected clients count
- Vote counts A vs B
- Consensus percent
- Time remaining in vote window
- Finale triangle weights (Ambition/Love/Avoidance)

### System Health
- WebSocket server status
- Ableton connection status (OSC/MIDI)
- Error log tail (recent errors)

### Finale State
- Active slots list (7)
- Current stewards + remaining time
- Queue length per chapter
- “Everyone got a turn” progress indicator

## Override Philosophy
- Overrides must be fast and obvious.
- Always provide “Return to Auto” after forcing.
- Avoid deep menus during performance.

## Safety/Fallback Modes
- No Phones Mode: controller can run deterministic sequence if audience network fails.
- Projection Only Mode: continue visuals even if some phones drop.
- Audio Only Mode: continue Ableton performance if web UI fails.

---

## Open Decisions (Keep Short)
- Exact number of layers per attempt (target 5–7).
- Exact threshold schedule for Doubt per layer.
- Locked color/symbol assignments for layers + chapters.
- Audition cadence (A/B preview duration).
- Finale fragment selection UI: specific fragment vs chapter+role.
- Finale rotation freeze behavior and when performer takes over.

---

## Summary
The show teaches the audience a repeated ritual: **story → build a song via binary layer choices → rising Doubt threshold**. After three attempts, the finale hands the audience agency to reconstruct and remix fragments across chapters using a continuous triangle steer and individual stewardship, proving the core metaphor: the “separate songs” were always compatible, and integration is possible.
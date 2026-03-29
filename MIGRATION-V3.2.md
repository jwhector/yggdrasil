# V3.2 Migration — Bundled Layers & Incredibox Finale

## Purpose

This document captures the design changes from V3.1 to V3.2. It should be used alongside the existing architecture docs. The V3.1 migration is assumed complete.

**When this document conflicts with ARCHITECTURE.md or the V3.1 docs, this document is correct.**

---

## What Changed (Summary)

| # | Change | Scope |
|---|--------|-------|
| 1 | **Song-building: 6 layers → 3 bundled layer groups** | Core restructure |
| 2 | **LayerGroup abstraction** — audience sees groups, Ableton has granular tracks | New data model |
| 3 | **Live seed** — performer "plays" the opener of each song (prerecorded) | Song-building + audio |
| 4 | **Threshold curve: 3 layers** — 0.50, 0.66, 0.99 | Config |
| 5 | **Finale: Incredibox-style live mixing** — replaces assembly/deliberation/ceremony | Major rewrite |
| 6 | **Finale groups by granular type** — configurable count (default 6) | Finale |
| 7 | **Auto-assignment default, self-select toggle** | Config |
| 8 | **No cross-song constraint** — each group picks independently | Finale |
| 9 | **Majority with recency tiebreak** — 50/50 splits resolved by most recent vote | Finale |
| 10 | **Audition progress visualization** — bar-level progress exposed to clients | Client + server |

### Narrative context

Song-building: the audience makes 3 broad choices per song. Each choice is a big audible shift — choosing between two complete musical identities, not individual instruments. Doubt escalates. Songs collapse or get rejected. By the end of 3 songs, the audience has voted 6–9 times total.

Finale: the performer abandons the stage. Each audience member is assigned (or chooses) one granular layer type. Their phone becomes a live controller for that specific layer — tapping between available fragments, with the majority of their small group (~6–7 people) determining what the room hears. The audio changes are immediate. The performer returns and plays live over the shifting foundation.

---

## Change 1: LayerGroup Abstraction

### The two-tier model

The audience interacts with **3 layer groups** during song-building. Ableton has **N granular tracks** per group option. The system needs a `LayerGroup` concept that bundles granular tracks for audience-facing purposes but preserves individual track control for the performer.

```typescript
interface LayerGroup {
  id: string;                           // e.g., 'bones', 'flesh', 'spark'
  label: string;                        // Audience-facing name, configurable
  granularTypes: GranularType[];        // Which granular types are bundled here
}

interface GranularType {
  id: string;                           // e.g., 'bass', 'drums', 'perc', 'melody', 'pad', 'harmony', 'fx'
  label: string;                        // Finale-facing name
  color: string;                        // For finale UI
  symbol: string;                       // For finale UI
}

interface LayerGroupConfig {
  id: string;
  label: string;
  granularTypes: string[];              // References to GranularType.id
  optionA: TrackBundle;
  optionB: TrackBundle;
}

interface TrackBundle {
  tracks: GranularTrackRef[];
}

interface GranularTrackRef {
  granularType: string;                 // e.g., 'bass'
  trackIndex: number;                   // Ableton track index
}
```

### How it works

**Song-building:** When the audience votes on "Bones Option A," the system mutes/unmutes all tracks in that bundle simultaneously. The audience hears one combined vibe shift.

**Finale:** The bundle decomposes. Each granular type within the bundle becomes independently controllable. The bass group can swap their fragment while the drums group keeps theirs. The performer also has full granular access from the controller.

### Config in `default-show.json`

```json
{
  "granularTypes": [
    { "id": "bass", "label": "The Ground", "color": "#TBD", "symbol": "■" },
    { "id": "drums", "label": "The Heartbeat", "color": "#TBD", "symbol": "▲" },
    { "id": "pad", "label": "The Warmth", "color": "#TBD", "symbol": "◆" },
    { "id": "melody", "label": "The Voice", "color": "#TBD", "symbol": "✦" },
    { "id": "harmony", "label": "The Color", "color": "#TBD", "symbol": "●" },
    { "id": "fx", "label": "The Shimmer", "color": "#TBD", "symbol": "~" }
  ],
  "layerGroups": [
    {
      "id": "bones",
      "label": "The Foundation",
      "granularTypes": ["bass", "drums"]
    },
    {
      "id": "flesh",
      "label": "The Character",
      "granularTypes": ["melody", "harmony", "pad"]
    },
    {
      "id": "spark",
      "label": "The Edge",
      "granularTypes": ["fx"]
    }
  ]
}
```

The groupings can vary per song if needed. FX is alone in "spark" here, but could be bundled with an atmospheric pad in another song. The `granularTypes` array is the master registry; `layerGroups` reference it by id.

### Implications

- `LayerType` in the existing codebase becomes `GranularType.id` — the 6 existing types survive at the granular level
- A new `LayerGroupId` type is introduced for song-building: `'bones' | 'flesh' | 'spark'` (configurable)
- `LAYERS_PER_ATTEMPT` changes from 6 to 3 (for song-building audience layers)
- The number of granular types is configurable (default 6, could be 5 or 7)
- Track index calculations change — instead of one track per layer option, each option maps to a **set** of track indices

---

## Change 2: Song-Building with 3 Layers

### Structure per song

```
Live seed (always playing, not audience-controlled)
  └── 2-4 Ableton tracks: performer's "recorded" loop

Bones (audience layer 0, A/B choice)
  └── Option A: TrackBundle (e.g., bass track + drums track + perc track)
  └── Option B: TrackBundle (different bass + drums + perc)

Flesh (audience layer 1, A/B choice)
  └── Option A: TrackBundle (e.g., melody track + harmony track + pad track)
  └── Option B: TrackBundle (different melody + harmony + pad)

Spark (audience layer 2, A/B choice)
  └── Option A: TrackBundle (e.g., fx track + texture track)
  └── Option B: TrackBundle (different fx + texture)
```

### Live seed

The performer theatrically "records" a loop at the start of each song. The audio is actually prerecorded in Ableton. The system treats it as an always-on track group that is unmuted when the song-building phase begins and muted on collapse/rejection.

The live seed is **not** an audience layer. It has no A/B choice. It's a set of Ableton tracks that play throughout the song-building phase, providing the harmonic and rhythmic anchor for all fragments.

```json
{
  "attempts": [
    {
      "chapter": "ambition",
      "liveSeed": {
        "trackIndices": [0, 1, 2],
        "label": "The seed"
      },
      "layers": [
        {
          "group": "bones",
          "labelA": "Heavy. Driving.",
          "labelB": "Light. Floating.",
          "optionA": { "tracks": [{"granularType": "bass", "trackIndex": 3}, {"granularType": "drums", "trackIndex": 4}] },
          "optionB": { "tracks": [{"granularType": "bass", "trackIndex": 5}, {"granularType": "drums", "trackIndex": 6}] }
        },
        {
          "group": "flesh",
          "labelA": "Warm. Open.",
          "labelB": "Cool. Guarded.",
          "optionA": { "tracks": [{"granularType": "melody", "trackIndex": 7}, {"granularType": "pad", "trackIndex": 8}, {"granularType": "harmony", "trackIndex": 9}] },
          "optionB": { "tracks": [{"granularType": "melody", "trackIndex": 10}, {"granularType": "pad", "trackIndex": 11}, {"granularType": "harmony", "trackIndex": 12}] }
        },
        {
          "group": "spark",
          "labelA": "Bright. Sharp.",
          "labelB": "Dark. Soft.",
          "optionA": { "tracks": [{"granularType": "fx", "trackIndex": 13}] },
          "optionB": { "tracks": [{"granularType": "fx", "trackIndex": 14}] }
        }
      ]
    }
  ]
}
```

### Threshold curve (3 layers)

```json
"thresholds": [0.50, 0.66, 0.99]
```

| Layer | Threshold | What happens |
|-------|-----------|-------------|
| 0 | 0.50 | Any majority passes. Always passes. |
| 1 | 0.66 | Needs ~2/3 majority. Real test — some shows pass, some don't. |
| 2 | 0.99 | Needs 39 of 40. Almost always collapses. The doubt wins. |

Layer 0 is always voted on. Layer 1 is always voted on (even if it collapses). Layer 2 is only voted on if layer 1 passed. Collapsed layers still produce fragments (vote happened, winner determined).

### Stagger

Each layer group appears at position 0 of one song:

| Position | Song 1 | Song 2 | Song 3 |
|----------|--------|--------|--------|
| 0 | Bones | Flesh | Spark |
| 1 | Flesh | Spark | Bones |
| 2 | Spark | Bones | Flesh |

**Guaranteed fragments:** Positions 0 and 1 are always voted on → every group has ≥2 fragments across the 3 songs. Position 2 sometimes produces a 3rd fragment if layer 1 passed.

### Audition progress visualization

The client needs to show audition progress — which option is currently playing, how far through the preview, time remaining. The server should emit audition state to clients:

```typescript
interface AuditionProgress {
  layerIndex: number;
  currentOption: 'A' | 'B';
  barProgress: number;              // 0.0 to 1.0 within current option's audition
  totalBars: number;                // auditionBars for this layer
  tempo: number;                    // Current BPM
  votingWindowMs: number;           // Derived total voting window for client timer
  elapsedMs: number;                // Time since audition started
}
```

The server sends this as a lightweight event (separate from state_sync) at ~4 Hz during auditioning, derived from Ableton beat callbacks. The client uses it to render:
- A progress bar showing how far through option A/B playback
- Which option is currently playing (A highlighted, then B highlighted)
- The countdown timer (derived from `votingWindowMs - elapsedMs`)

### Track layout change

The track index formula is no longer a simple calculation — it's a config lookup. Each attempt's layers define explicit track indices per option per granular type. The `ableton-layout.json` config becomes a direct mapping rather than a formula.

The rough track count per song: live seed (2-4) + bones A (2-3) + bones B (2-3) + flesh A (2-3) + flesh B (2-3) + spark A (1-2) + spark B (1-2) = ~14-20 tracks per song, ~42-60 total. Plus live performance tracks.

---

## Change 3: Finale — Incredibox-Style Live Mixing

### Overview

The V3.1 finale phases (assembly → deliberation → ceremony → performer mix) are replaced with:

1. **Elegy** — unchanged, brief observational moment
2. **Assignment** — audience assigned (or self-selects) to a granular type
3. **Live Mix** — Incredibox-style continuous input, performer plays over it

The ambassador, altar, ceremony, and deliberation phases are **removed entirely**.

### Show phase state machine update

```typescript
type ShowPhase =
  | 'lobby'
  | 'opener'
  | 'attempt_story'
  | 'attempt_build'
  | 'attempt_resolve'
  | 'finale_elegy'
  | 'finale_assignment'           // NEW — replaces finale_assembly
  | 'finale_live_mix'             // NEW — replaces deliberation + ceremony + performer_mix
  | 'ended';
```

Removed phases: `finale_assembly`, `finale_deliberation`, `finale_ceremony`, `finale_performer_mix`

### Phase transitions update

| From | To | Trigger |
|------|----|---------|
| `finale_elegy` | `finale_assignment` | Manual or Auto |
| `finale_assignment` | `finale_live_mix` | Auto (timer expires) or Manual |
| `finale_live_mix` | `ended` | Manual |

### Phase: Assignment

Each audience member is assigned to one **granular type** (e.g., bass, drums, melody — not a bundle). With 40 people and 6 granular types, groups are ~6-7 people.

**Default: auto-assignment.** The server distributes users evenly across the configured granular types. Configurable toggle allows self-selection instead.

```json
{
  "finale": {
    "assignmentMode": "auto",
    "granularTypeCount": 6,
    "assignmentTimerMs": 30000
  }
}
```

When `assignmentMode: "auto"`:
- Server shuffles connected users and distributes evenly
- No timer needed, assignment is instant
- Phone shows: "You are The Heartbeat" with color + symbol

When `assignmentMode: "self_select"`:
- Phone shows tappable cards for each granular type with live member counts
- Timer counts down (default 30s)
- Undecided users randomly assigned at timer expiry

### Phase: Live Mix

**The core mechanic:** Each phone shows the available fragments for that user's granular type. Tapping one casts a continuous "preference" for that fragment. The fragment with the most supporters in the group is what the room hears. When the majority shifts, the audio crossfades at the next bar boundary.

**Phone UI:**

```
┌─────────────────────────────┐
│ ▲ THE HEARTBEAT             │
│                             │
│ ┌─────────┐ ┌─────────┐    │
│ │ SHAME   │ │ DOUBT   │    │
│ │ ●●●●    │ │ ●●      │    │
│ │ ▶ now   │ │         │    │
│ └─────────┘ └─────────┘    │
│                             │
│ ┌─────────┐                 │
│ │ SORROW  │                 │
│ │ ●       │                 │
│ │         │                 │
│ └─────────┘                 │
└─────────────────────────────┘
```

Each card:
- Shows chapter color + name
- Shows a visual indicator of how many group members are on this option (dots, bar fill, glow intensity — NOT exact numbers, to keep it feeling organic rather than mathematical)
- The card that's currently playing for the room is marked (e.g., "▶ now" or a glow)
- Tap to switch your preference. Immediate. No confirmation needed.

**What you see for other groups:** Beneath your active row, smaller rows show the other groups' current state — which fragment is currently playing, but no controls. You can see the song's full state. You can only steer your piece.

**Fragment availability per granular type:**

The system decomposes the layer group fragments into granular fragments. When the audience chose "Bones Option A" from Song 1, that bundle contained a bass track and a drums track. In the finale, the bass group sees "Song 1 bass" as one of their options, and the drums group sees "Song 1 drums" as one of theirs.

The availability depends on:
- Which layer groups were voted on (positions 0 and 1 always, position 2 sometimes)
- `bothOptionsSurvive` setting: when true, both A and B tracks from each voted layer are available. When false, only the winning option's tracks.
- Which granular types were bundled in the voted layer group

**Per granular type, typical fragment count:**
- `bothOptionsSurvive: true`: 4-6 options (2 per song that reached this bundle × 2 options)
- `bothOptionsSurvive: false`: 2-3 options (1 per song that reached this bundle)

### Majority with recency tiebreak

When the group's votes are tallied continuously:

```typescript
function getActiveFragment(
  votes: Map<UserId, { fragmentId: string; timestamp: number }>
): string {
  // Count votes per fragment
  const counts = new Map<string, number>();
  for (const vote of votes.values()) {
    counts.set(vote.fragmentId, (counts.get(vote.fragmentId) ?? 0) + 1);
  }

  // Find max count
  const maxCount = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([_, c]) => c === maxCount);

  if (leaders.length === 1) return leaders[0][0];

  // Tiebreak: most recent vote among the tied fragments
  let latestTimestamp = -1;
  let winner = leaders[0][0];
  for (const vote of votes.values()) {
    if (leaders.some(([id]) => id === vote.fragmentId) && vote.timestamp > latestTimestamp) {
      latestTimestamp = vote.timestamp;
      winner = vote.fragmentId;
    }
  }
  return winner;
}
```

In a group of 6, a 3-3 tie is resolved by whoever voted most recently. This means a single person switching can immediately change the audio — which is the agency goal for small groups.

### Audio crossfade mechanic

When the active fragment changes for a granular type:
1. Queue the crossfade for the next bar boundary
2. At the boundary: fade out the old fragment's track, fade in the new fragment's track
3. Crossfade duration: ~1 bar overlap

Same quantized transition mechanic as song-building. The system doesn't respond to rapid back-and-forth — only actual majority shifts that persist until the next bar boundary.

**Debounce:** If the majority flips back before the next bar boundary, cancel the queued crossfade. This prevents jitter from near-50/50 splits.

### Initial state

When `finale_live_mix` begins, the system auto-selects an initial fragment per granular type using the **highest winning proportion** from song-building. The fragment where the room agreed most strongly is the default. This means the song starts playing immediately — no silence, no waiting for consensus.

Each user's phone starts with their preference set to the auto-selected fragment for their type. They can switch immediately.

### Performer's role

The performer returns to the stage during or after assignment. They pick up their instrument. They play live over the shifting foundation. Their controller shows:

- Per-granular-type: which fragment is currently active, the group's vote distribution
- Override controls: force a specific fragment for any type (overrides audience majority)
- Lock controls: freeze a type's fragment (audience tapping stops affecting it)
- Live performance track toggles

The performer can lock types one by one as the show builds toward its climax, gradually taking full control and driving to the ending.

### Projector visualization

The projector shows a live visualization of all granular types:
- Each type represented as a row or node
- Current active fragment shown with chapter color
- Visual indication of group consensus (solid = everyone agrees, flickering = contested)
- When a fragment swap happens, the transition is visible
- The performer's live input is represented as an additional visual element

---

## Change 4: FinaleState Rewrite

```typescript
interface FinaleState {
  phase: 'elegy' | 'assignment' | 'live_mix';

  // Fragment availability (computed from song-building results)
  availableFragments: GranularFragment[];     // Decomposed from layer group fragments
  allFragments: GranularFragment[];           // All granular fragments for performer

  // Assignment state
  assignment: {
    mode: 'auto' | 'self_select';
    groups: Map<string, UserId[]>;            // granularTypeId → user IDs
    timerRemaining: number | null;            // Only for self_select mode
  };

  // Live mix state
  liveMix: {
    votes: Map<string, Map<UserId, LiveMixVote>>;  // granularTypeId → (userId → vote)
    activeFragments: Map<string, string>;           // granularTypeId → fragmentId (current majority)
    lockedTypes: string[];                          // Performer-locked granular types
    performerOverrides: Map<string, string>;        // granularTypeId → fragmentId (performer forced)
    liveTracksActive: string[];                     // Live performance track IDs
    loopPosition: number;                           // 0.0 to 1.0
    loopCount: number;
  };

  // NPC state
  npc: {
    currentMessage: string | null;
  };
}

interface LiveMixVote {
  fragmentId: string;
  timestamp: number;          // For recency tiebreak
}

interface GranularFragment {
  id: string;
  songIndex: number;
  layerGroupId: string;       // Which bundle this came from ('bones', 'flesh', 'spark')
  granularType: string;       // Which specific type ('bass', 'drums', etc.)
  option: 'A' | 'B';
  chapter: Chapter;
  trackIndex: number;         // Ableton track index for this specific granular track
  wonVote: boolean;
  previewAudioPath: string;
}
```

---

## Change 5: Conductor Commands/Events Update

### Remove

All V3.1 finale commands and events:
- Assembly: `START_ASSEMBLY`, `JOIN_GROUP`, `ASSEMBLY_TIMER_EXPIRED`, `FORCE_ASSIGN_USER`, etc.
- Deliberation: `START_DELIBERATION`, `SUBMIT_GROUP_VOTE`, `VOLUNTEER_AS_AMBASSADOR`, etc.
- Ceremony: `START_CEREMONY`, `CALL_NEXT_AMBASSADOR`, `ALTAR_LOCK_IN`, etc.
- Related events: `ASSEMBLY_STARTED`, `DELIBERATION_STARTED`, `CEREMONY_STARTED`, `AMBASSADOR_CALLED`, `ALTAR_LOCK_IN_DETECTED`, etc.

### Add

```typescript
// Finale — Assignment
| { type: 'START_ASSIGNMENT' }
| { type: 'SELECT_GRANULAR_TYPE'; userId: UserId; granularType: string }  // self_select mode
| { type: 'ASSIGNMENT_COMPLETE' }

// Finale — Live Mix
| { type: 'START_LIVE_MIX' }
| { type: 'SET_LIVE_MIX_PREFERENCE'; userId: UserId; granularType: string; fragmentId: string }
| { type: 'LOCK_GRANULAR_TYPE'; granularType: string }
| { type: 'UNLOCK_GRANULAR_TYPE'; granularType: string }
| { type: 'OVERRIDE_FRAGMENT'; granularType: string; fragmentId: string }
| { type: 'CLEAR_OVERRIDE'; granularType: string }

// Events
| { type: 'ASSIGNMENT_STARTED'; mode: 'auto' | 'self_select' }
| { type: 'GROUPS_ASSIGNED'; groups: Map<string, UserId[]> }
| { type: 'LIVE_MIX_STARTED'; initialFragments: Map<string, string> }
| { type: 'ACTIVE_FRAGMENT_CHANGED'; granularType: string; fragmentId: string; previousFragmentId: string }
| { type: 'GRANULAR_TYPE_LOCKED'; granularType: string }
| { type: 'GRANULAR_TYPE_UNLOCKED'; granularType: string }
```

### WebSocket events update

Remove: `join_group`, `group_vote`, `volunteer_ambassador`, `altar_lock_in`, `group_update`, `ambassador_called`, `altar_ready`, `altar_confirmed`

Add:

| Event | Payload | Sender |
|-------|---------|--------|
| `select_type` | `{ granularType }` | Audience (self_select assignment) |
| `set_preference` | `{ fragmentId }` | Audience (live mix) |

| Event | Payload | Recipients |
|-------|---------|------------|
| `assigned` | `{ granularType, groupSize }` | Audience (after assignment) |
| `mix_state` | `{ activeFragments, votes }` | Audience (live mix, ~4 Hz) |
| `type_locked` | `{ granularType }` | Audience (performer locked a type) |

The `mix_state` event is high-frequency (separate from state_sync) to keep the UI responsive. Contains: per-type active fragment, per-type vote distribution (for the user's own type — detailed; for other types — just the active fragment).

---

## Change 6: Audio & Ableton Updates

### Track bundling for song-building

When a layer group option is muted/unmuted during song-building, the audio-router iterates over all tracks in the bundle and sends individual OSC commands for each:

```typescript
function muteBundle(bundle: TrackBundle, mute: boolean) {
  for (const track of bundle.tracks) {
    sendOSC('/live/track/set/mute', [track.trackIndex, mute ? 1 : 0]);
  }
}
```

### Live mix crossfade

During the finale, individual granular tracks are controlled independently. The crossfade logic operates per-track, not per-bundle:

```typescript
function crossfadeGranularTrack(
  outgoing: number,       // track index fading out
  incoming: number,       // track index fading in
  fadeBars: number        // crossfade duration in bars
) {
  // Queue at next bar boundary:
  // 1. Start fading out outgoing track
  // 2. Start fading in incoming track
  // 3. After fadeBars: mute outgoing, incoming at full gain
}
```

### Live seed tracks

New audio cue type:

```typescript
| { type: 'live_seed_start'; attemptIndex: number; trackIndices: number[] }
| { type: 'live_seed_stop'; attemptIndex: number; trackIndices: number[] }
```

Live seed tracks unmute when `attempt_build` starts and mute on collapse/rejection.

### Audio preview files

Preview files are now per-granular-track, not per-layer-group. Naming:

```
preview-{songIndex}-{granularType}-{option}.mp3
```

Examples: `preview-0-bass-A.mp3`, `preview-1-melody-B.mp3`

This allows finale groups to preview individual granular tracks, not full bundles. Total file count depends on composition — roughly 2 files per granular type per option per song = up to 72 files with 6 types. Only available fragments will be served.

---

## Change 7: Files Affected

### Remove entirely

| File | Reason |
|------|--------|
| `conductor/assembly.ts` | Replaced by assignment logic |
| `conductor/deliberation.ts` | No deliberation phase |
| `conductor/ceremony.ts` | No ceremony phase |
| `components/finale/AssemblyCards.tsx` | Replaced |
| `components/finale/DeliberationBoard.tsx` | No deliberation |
| `components/finale/AudioPreview.tsx` | Replaced by live mix UI |
| `components/finale/AmbassadorPrompt.tsx` | No ambassadors |
| `components/finale/CeremonyView.tsx` | No ceremony |
| `components/finale/AltarReady.tsx` | No altar |
| `components/controller/AssemblyControls.tsx` | Replaced |
| `components/controller/DeliberationControls.tsx` | Replaced |
| `components/controller/CeremonyControls.tsx` | Replaced |
| `hooks/useAltarDetection.ts` | No altar |
| DB tables: `finale_groups`, `finale_group_votes`, `ceremony_events` | Replaced |

### New files

| File | Purpose |
|------|---------|
| `conductor/assignment.ts` | Auto/self-select assignment logic |
| `conductor/live-mix.ts` | Continuous majority tracking, recency tiebreak, fragment transitions |
| `conductor/layer-groups.ts` | LayerGroup ↔ GranularType decomposition logic |
| `components/finale/LiveMixController.tsx` | Audience phone: tappable fragment cards for your type |
| `components/finale/LiveMixSpectator.tsx` | Audience phone: read-only view of other types |
| `components/finale/LiveMixProjector.tsx` | Projector: all types + consensus visualization |
| `components/controller/LiveMixControls.tsx` | Controller: per-type overrides, locks, vote distributions |
| `components/song-building/AuditionProgress.tsx` | Bar-level progress indicator during auditioning |
| `hooks/useLiveMix.ts` | Client-side live mix state management |

### Modify

| File | Changes |
|------|---------|
| `conductor/types.ts` | Add `LayerGroup`, `GranularType`, `GranularFragment`, `LiveMixVote`, `LiveMixState`. Update `LayerConfig` for track bundles. Update `LAYERS_PER_ATTEMPT` to 3. |
| `conductor/conductor.ts` | Update phase machine (remove 4 finale phases, add 2). Handle new assignment + live mix commands. |
| `conductor/fragments.ts` | Generate `GranularFragment[]` by decomposing layer group results into per-track fragments. |
| `conductor/performer-mix.ts` | Adapt for granular-level control in live mix. May merge into `live-mix.ts`. |
| `server/audio-router.ts` | Track bundles for song-building mute/unmute. Individual track crossfades for live mix. Live seed cues. |
| `server/timing.ts` | Emit `AuditionProgress` at ~4 Hz during auditioning. |
| `server/socket.ts` | New WebSocket events for assignment + live mix. Remove old finale events. |
| `components/song-building/OptionCards.tsx` | Works with 3 layers instead of 6. No structural change needed. |
| `components/song-building/LayerProgress.tsx` | 3 layers instead of 6. |
| `components/finale/MixingSurface.tsx` | Adapt to granular types + live mix state. |
| `lib/identity.ts` | Add layer group identities alongside granular type identities. |
| `config/default-show.json` | Major restructure — layer groups, granular types, track bundles, live seed config. |
| `config/ableton-layout.json` | Track bundles instead of formula-based indices. |

### Database schema

Replace V3.1 finale tables with:

```sql
-- Replaces finale_groups
CREATE TABLE finale_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Replaces finale_group_votes with continuous preference tracking
CREATE TABLE finale_mix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('preference', 'lock', 'unlock', 'override')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

Remove: `finale_groups`, `finale_group_votes`, `ceremony_events`

---

## Change 8: Config Shape

Complete `default-show.json` structure:

```json
{
  "granularTypes": [
    { "id": "bass", "label": "The Ground", "color": "#TBD", "symbol": "■" },
    { "id": "drums", "label": "The Heartbeat", "color": "#TBD", "symbol": "▲" },
    { "id": "pad", "label": "The Warmth", "color": "#TBD", "symbol": "◆" },
    { "id": "melody", "label": "The Voice", "color": "#TBD", "symbol": "✦" },
    { "id": "harmony", "label": "The Color", "color": "#TBD", "symbol": "●" },
    { "id": "fx", "label": "The Shimmer", "color": "#TBD", "symbol": "~" }
  ],
  "layerGroups": [
    { "id": "bones", "label": "The Foundation", "granularTypes": ["bass", "drums"] },
    { "id": "flesh", "label": "The Character", "granularTypes": ["melody", "harmony", "pad"] },
    { "id": "spark", "label": "The Edge", "granularTypes": ["fx"] }
  ],
  "attempts": [
    {
      "chapter": "ambition",
      "title": "Song 1",
      "thresholds": [0.50, 0.66, 0.99],
      "tempos": [120, 130, 145],
      "auditionBars": [4, 3, 2],
      "liveSeed": { "trackIndices": [0, 1, 2] },
      "layers": [
        {
          "group": "bones",
          "labelA": "Heavy. Driving.",
          "labelB": "Light. Floating.",
          "optionA": { "tracks": [{"granularType": "bass", "trackIndex": 3}, {"granularType": "drums", "trackIndex": 4}] },
          "optionB": { "tracks": [{"granularType": "bass", "trackIndex": 5}, {"granularType": "drums", "trackIndex": 6}] }
        },
        {
          "group": "flesh",
          "labelA": "Warm. Open.",
          "labelB": "Cool. Guarded.",
          "optionA": { "tracks": [{"granularType": "melody", "trackIndex": 7}, {"granularType": "pad", "trackIndex": 8}, {"granularType": "harmony", "trackIndex": 9}] },
          "optionB": { "tracks": [{"granularType": "melody", "trackIndex": 10}, {"granularType": "pad", "trackIndex": 11}, {"granularType": "harmony", "trackIndex": 12}] }
        },
        {
          "group": "spark",
          "labelA": "Bright. Sharp.",
          "labelB": "Dark. Soft.",
          "optionA": { "tracks": [{"granularType": "fx", "trackIndex": 13}] },
          "optionB": { "tracks": [{"granularType": "fx", "trackIndex": 14}] }
        }
      ]
    }
  ],
  "finale": {
    "assignmentMode": "auto",
    "assignmentTimerMs": 30000,
    "bothOptionsSurvive": true,
    "crossSongConstraint": false
  }
}
```

### Environment variables

Remove:
```bash
ASSEMBLY_TIMER_MS=60000
ASSEMBLY_GRACE_PERIOD_MS=15000
DELIBERATION_TIMER_MS=120000
AMBASSADOR_VOLUNTEER_TIMER_MS=15000
CEREMONY_LAYER_ORDER=bass,drums,pad,melody,harmony,fx
```

Add:
```bash
FINALE_ASSIGNMENT_MODE=auto
FINALE_ASSIGNMENT_TIMER_MS=30000
```

---

## Design Notes

### Group size and agency

With 40 people and 6 granular types: ~6-7 per group. A majority flip needs 3-4 people switching. In a group of 6 with a 3-3 tie, one person's most recent vote determines the audio. This is the target level of individual agency.

With 5 granular types: ~8 per group. Still good agency. With 7 types: ~5-6 per group. Maximum agency but more types to manage in Ableton.

### No cross-song constraint

Each granular group picks independently. The room could end up with all fragments from the same song, or a mix from all three. Both are valid. The cross-song coherence comes from the shared key/progression, not from system enforcement.

### Audition progress is critical

The audience needs to see *what* is playing and *when* it will change. Without visual progress, the audition feels like ambient background. With a progress bar showing "option A is playing, 3 of 4 bars done, then B will play," the audience knows when to listen for the switch and when to cast their vote.

### The performer's ending

The performer gradually locks granular types from the controller — freezing the audience's input one type at a time. This is the transition from collaborative mix to solo performance. The audience sees their controls dim as the performer takes over. The final moments are purely the performer's — playing, singing, finishing what the audience rescued.

### Composition: 8 combinations per song

With 3 layers and 2 options each, there are 8 possible combinations per song. This is small enough to test all 8 during production. Verify that every combination sounds coherent with the live seed.

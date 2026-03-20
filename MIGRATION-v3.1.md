# V3.1 Migration — Implementation Guide

## Purpose

This document is the implementation guide for migrating from V3 ARCHITECTURE.md to V3.1. It is structured as **sequential phases** that an AI coding agent should execute in order. Each phase is self-contained, testable, and builds on the previous phase.

**When this document conflicts with ARCHITECTURE.md, this document is correct.**

**Reference:** The full V3 architecture spec is in `ARCHITECTURE.md` in the project root. Read it for context on any system not explicitly redefined here.

---

## What Changed (Summary)

| # | Change | Impact |
|---|--------|--------|
| 1 | Health Bar → Doubt Threshold (per-layer pass/fail) | Core mechanic rewrite |
| 2 | 7 layer types → 6 (FX2 removed) | System-wide constant change |
| 3 | Both options survive from voted layers (configurable) | Fragment generation + deliberation |
| 4 | Auditioning and voting merged into single phase | Layer phase machine + timing |
| 5 | Tempo configurable per layer per song | OSC + timing engine |
| 6 | Audition length configurable per layer per song | Timing engine + config |
| 7 | Voting window = audition duration (derived, not separate config) | Timing engine |
| 8 | UI urgency escalation (cosmetic degradation) | Client components |
| 9 | Audio urgency (return track degradation) | OSC commands |
| 10 | Staggered layer ordering redesigned for 6 types | Config |

### Narrative context (for understanding, not implementation)

The threshold represents the performer's **doubt** — rising inner resistance to finishing. Collapse = the doubt winning, not the audience failing. This frames the finale mutiny as justified: "he couldn't finish, so we will." The escalating urgency (tempo, audition compression, UI, audio) embodies the doubt corrupting the environment. Collapse is a sudden release — silence after frenzy.

---

## Config Reference: `default-show.json`

All per-layer, per-song values live here. This is the single source of tuning. The agent should reference this structure throughout all phases.

```json
{
  "attempts": [
    {
      "chapter": "ambition",
      "title": "Song 1",
      "thresholds": [0.50, 0.50, 0.65, 0.78, 0.88, 0.95],
      "tempos": [120, 120, 130, 140, 155, 170],
      "auditionBars": [4, 4, 4, 2, 2, 2],
      "layers": [
        { "type": "bass", "labelA": "...", "labelB": "..." },
        { "type": "drums", "labelA": "...", "labelB": "..." },
        { "type": "melody", "labelA": "...", "labelB": "..." },
        { "type": "harmony", "labelA": "...", "labelB": "..." },
        { "type": "pad", "labelA": "...", "labelB": "..." },
        { "type": "fx", "labelA": "...", "labelB": "..." }
      ]
    },
    {
      "chapter": "love",
      "title": "Song 2",
      "thresholds": [0.50, 0.50, 0.65, 0.78, 0.88, 0.95],
      "tempos": [120, 120, 130, 140, 155, 170],
      "auditionBars": [4, 4, 4, 2, 2, 2],
      "layers": [
        { "type": "melody", "labelA": "...", "labelB": "..." },
        { "type": "harmony", "labelA": "...", "labelB": "..." },
        { "type": "fx", "labelA": "...", "labelB": "..." },
        { "type": "bass", "labelA": "...", "labelB": "..." },
        { "type": "pad", "labelA": "...", "labelB": "..." },
        { "type": "drums", "labelA": "...", "labelB": "..." }
      ]
    },
    {
      "chapter": "avoidance",
      "title": "Song 3",
      "thresholds": [0.50, 0.50, 0.65, 0.78, 0.88, 0.95],
      "tempos": [120, 120, 130, 140, 155, 170],
      "auditionBars": [4, 4, 4, 2, 2, 2],
      "layers": [
        { "type": "pad", "labelA": "...", "labelB": "..." },
        { "type": "fx", "labelA": "...", "labelB": "..." },
        { "type": "drums", "labelA": "...", "labelB": "..." },
        { "type": "bass", "labelA": "...", "labelB": "..." },
        { "type": "melody", "labelA": "...", "labelB": "..." },
        { "type": "harmony", "labelA": "...", "labelB": "..." }
      ]
    }
  ],
  "finale": {
    "bothOptionsSurvive": true,
    "assemblyTimerMs": 60000,
    "assemblyGracePeriodMs": 15000,
    "deliberationTimerMs": 120000,
    "ambassadorVolunteerTimerMs": 15000,
    "ceremonyLayerOrder": ["bass", "drums", "pad", "melody", "harmony", "fx"],
    "audioPreviewPath": "/audio/previews",
    "layerLabels": {
      "melody": "The Voice",
      "drums": "The Heartbeat",
      "pad": "The Warmth",
      "bass": "The Ground",
      "harmony": "The Color",
      "fx": "The Shimmer"
    }
  }
}
```

### Stagger verification at 2 guaranteed layers

Every layer type must appear at position 0 or 1 in at least one song:

| Type | Song 1 pos | Song 2 pos | Song 3 pos | Guaranteed? |
|------|-----------|-----------|-----------|-------------|
| Bass | 0 | 3 | 3 | ✓ (Song 1) |
| Drums | 1 | 5 | 2 | ✓ (Song 1) |
| Melody | 2 | 0 | 4 | ✓ (Song 2) |
| Harmony | 3 | 1 | 5 | ✓ (Song 2) |
| Pad | 4 | 4 | 0 | ✓ (Song 3) |
| FX | 5 | 2 | 1 | ✓ (Song 3) |

All 6 covered. "Live" layers (bass, melody, pad) are at position 0 in their respective songs.

---

## Phase 1: Types & Constants -- COMPLETE (2026-03-19)

**Goal:** Update all shared type definitions and constants. Everything else depends on this.

> **Deviations:** Kept `'auditioning'` as LayerPhase name (not `'auditioning_and_voting'`) and `START_AUDITION` as command name (not `START_LAYER`). The behavioral change (concurrent voting during auditioning) was already implemented prior to V3.1. See CHANGELOG 2026-03-18.

### 1.1 Update `LayerType`

```typescript
// OLD (V3)
type LayerType = 'melody' | 'drums' | 'pad' | 'bass' | 'harmony' | 'fx1' | 'fx2';

// NEW (V3.1)
type LayerType = 'melody' | 'drums' | 'pad' | 'bass' | 'harmony' | 'fx';
```

Find and replace all occurrences of `'fx1'` → `'fx'` and remove all occurrences of `'fx2'`.

### 1.2 Update `LAYERS_PER_ATTEMPT`

```typescript
// OLD
export const LAYERS_PER_ATTEMPT = 7;

// NEW
export const LAYERS_PER_ATTEMPT = 6;
```

### 1.3 Update `LayerPhase`

```typescript
// OLD (V3)
type LayerPhase =
  | 'locked'
  | 'auditioning'
  | 'voting'
  | 'revealing'
  | 'locked_in'
  | 'collapsed';

// NEW (V3.1) — auditioning and voting merged
type LayerPhase =
  | 'locked'
  | 'auditioning_and_voting'    // Replaces separate 'auditioning' + 'voting'
  | 'revealing'
  | 'locked_in'
  | 'collapsed';
```

### 1.4 Update `AttemptConfig`

```typescript
// OLD (V3)
interface AttemptConfig {
  chapter: Chapter;
  title: string;
  layers: LayerConfig[];            // Length 7
  drainFactor: number;
  layerMultipliers: number[];       // Length 7
}

// NEW (V3.1) — all arrays configurable per layer per song
interface AttemptConfig {
  chapter: Chapter;
  title: string;
  layers: LayerConfig[];            // Length 6
  thresholds: number[];             // Length 6 — per-layer doubt thresholds
  tempos: number[];                 // Length 6 — per-layer BPM
  auditionBars: number[];           // Length 6 — bars per option during audition
  // NOTE: voting window is NOT a separate config value.
  // It equals the total audition duration: auditionBars[i] * 2 options * barsToMs(1, tempos[i])
  // The vote opens when auditioning starts and closes when auditioning ends.
}
```

### 1.5 Update `FinaleConfig`

Add the `bothOptionsSurvive` flag:

```typescript
interface FinaleConfig {
  bothOptionsSurvive: boolean;       // NEW — when false, only winners in deliberation
  assemblyTimerMs: number;
  assemblyGracePeriodMs: number;
  deliberationTimerMs: number;
  ambassadorVolunteerTimerMs: number;
  ceremonyLayerOrder: LayerType[];   // Length 6 (was 7)
  audioPreviewPath: string;
  layerLabels: Map<LayerType, string>;
  npcMessages: NpcMessageConfig[];
}
```

### 1.6 Remove `HealthBarState` and `HealthBarDrain`

Delete these interfaces entirely from `types.ts`:

```typescript
// DELETE
interface HealthBarState { ... }
interface HealthBarDrain { ... }
```

### 1.7 Update `AttemptState`

```typescript
// Remove healthBar field entirely
interface AttemptState {
  index: number;
  chapter: Chapter;
  layerPlan: LayerConfig[];       // Length 6
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];
  votes: LayerVote[];
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
}
```

### 1.8 Update `LayerResult`

```typescript
// OLD
interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'unreached';
  chosenOption: 'A' | 'B' | null;
  consensus: number | null;
  drainAmount: number | null;
}

// NEW
interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'collapsed' | 'unreached';  // 'collapsed' = threshold failed here
  chosenOption: 'A' | 'B' | null;
  winningProportion: number | null;
  thresholdRequired: number | null;
  passed: boolean | null;           // null if unreached
}
```

### 1.9 Update `Fragment`

```typescript
// Add wonVote field
interface Fragment {
  id: string;
  songIndex: number;
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayLabel: string;
  wonVote: boolean;                 // NEW — true if this option won the blind vote
  audioRef: AudioReference;
  previewAudioPath: string;
}
```

### 1.10 Update conductor commands

Remove:
- `SET_DRAIN_FACTOR`
- `SET_HEALTH`
- `START_AUDITION` (replaced by `START_LAYER`)
- `OPEN_VOTING` (merged into `START_LAYER`)

Add:
- `START_LAYER` — enters `auditioning_and_voting` phase (replaces the old `START_AUDITION` + `OPEN_VOTING` sequence)

### 1.11 Update conductor events

Remove:
- `HEALTH_BAR_DRAINED`

Add:
- `THRESHOLD_CHECK: { attemptIndex, layerIndex, winningProportion, threshold, passed: boolean }`

### Tests for Phase 1

```
- All type definitions compile with no errors
- LAYERS_PER_ATTEMPT === 6
- LayerType union has exactly 6 members (no fx1, no fx2)
- LayerPhase has 'auditioning_and_voting', not 'auditioning' or 'voting' separately
- AttemptConfig has thresholds, tempos, auditionBars (all length 6)
- FinaleConfig has bothOptionsSurvive boolean
- No references to HealthBarState, HealthBarDrain, drainFactor, layerMultipliers anywhere
- No references to 'fx1' or 'fx2' anywhere
```

---

## Phase 2: Threshold Mechanic -- COMPLETE (2026-03-19)

**Goal:** Replace the health bar with the per-layer doubt threshold. This is the core mechanic change.

> **Deviations:** `checkThreshold()` extracted to `conductor/threshold.ts` as a standalone module. Conductor calls it with raw vote counts (votesA, votesB) rather than pre-computed consensus.

### 2.1 Rewrite `health-bar.ts` → `threshold.ts`

Delete `health-bar.ts`. Create `threshold.ts`:

```typescript
/**
 * Doubt Threshold — Per-layer pass/fail consensus check.
 *
 * Each layer has a threshold (configured per song in default-show.json).
 * If the winning proportion < threshold, the song collapses.
 * No cumulative state — each vote is independent.
 */

export function checkThreshold(
  votesA: number,
  votesB: number,
  threshold: number
): { passed: boolean; winningProportion: number } {
  const total = votesA + votesB;
  if (total === 0) return { passed: false, winningProportion: 0 };
  const winningProportion = Math.max(votesA, votesB) / total;
  return {
    passed: winningProportion >= threshold,
    winningProportion,
  };
}
```

That's the entire module. ~15 lines.

### 2.2 Update `voting.ts`

After tallying votes, call `checkThreshold` with the threshold from the current attempt's config at the current layer index:

```typescript
const threshold = attemptConfig.thresholds[layerIndex];
const result = checkThreshold(votesA, votesB, threshold);
```

If `result.passed === false`, emit `THRESHOLD_CHECK` event with `passed: false` and trigger collapse. If `passed === true`, emit `THRESHOLD_CHECK` with `passed: true` and proceed to lock-in.

### 2.3 Update `conductor.ts` — collapse detection

Remove all health bar drain logic. The collapse check is now a single conditional after each vote resolves:

```typescript
// OLD: calculate drain → apply drain → check if health <= 0
// NEW: check threshold → pass or collapse

if (!thresholdResult.passed) {
  // Collapse: set layer status to 'collapsed', mark attempt as collapsed
  // Emit ATTEMPT_COLLAPSED event
} else {
  // Lock in: set layer status to 'locked_in'
  // Emit LAYER_LOCKED_IN event
}
```

### 2.4 Remove health bar from state initialization

`createHealthBar()` calls are removed. `AttemptState` no longer has a `healthBar` field. No initialization needed — the threshold is read from config on each vote.

### 2.5 Update controller

Remove `HealthBarControls.tsx`. The controller should display the current layer's threshold (read-only) and the last vote's winning proportion. Keep the `FORCE_COLLAPSE` command for emergency override.

### Default threshold values

| Layer | Threshold | Behavioral target |
|-------|-----------|-------------------|
| 0     | 0.50      | Any majority passes (guaranteed) |
| 1     | 0.50      | Any majority passes (guaranteed) |
| 2     | 0.65      | 50/50 rooms collapse here |
| 3     | 0.78      | 70/30 rooms collapse here |
| 4     | 0.88      | 80/20 rooms collapse here |
| 5     | 0.95      | Only ~95%+ alignment completes |

### Tests for Phase 2

```
- checkThreshold(30, 10, 0.50) → { passed: true, winningProportion: 0.75 }
- checkThreshold(20, 20, 0.50) → { passed: true, winningProportion: 0.50 }
- checkThreshold(26, 14, 0.65) → { passed: true, winningProportion: 0.65 }
- checkThreshold(25, 15, 0.65) → { passed: false, winningProportion: 0.625 }
- checkThreshold(0, 0, 0.50) → { passed: false, winningProportion: 0 }
- checkThreshold(39, 1, 0.95) → { passed: true, winningProportion: 0.975 }
- checkThreshold(37, 3, 0.95) → { passed: false, winningProportion: 0.925 }
- Layer with threshold 0.50 never collapses unless exact 50/50 tie (which passes at 0.50)
- Attempt transitions to 'collapsed' when threshold fails
- Attempt transitions to 'completed' when all 6 layers pass
- THRESHOLD_CHECK event emitted after every vote with correct values
- No references to drain, drainFactor, drainAmount, health bar anywhere
```

---

## Phase 3: Merged Auditioning + Voting -- COMPLETE (2026-03-19)

**Goal:** Combine the `auditioning` and `voting` phases into a single `auditioning_and_voting` phase where the vote is open from the moment the first option starts playing.

> **Deviations:** Behavioral merge was already complete (see Phase 1 deviations). Phase 3 focused on per-layer audition timing: `TimingConfig` simplified (removed `auditionDurationMs`, `votingWindowMs`, `auditionsPerLayer`; renamed `beatsPerLoop` → `loopBoundaryBeats`). Loop structure changed from A-B-A-B to A-then-B. No `votingWindowMs` state field — Ableton/timing engine is source of truth; votes accepted when phase is `'auditioning'`. Client countdown timer deferred to Phase 8.

### 3.1 Update layer phase machine

```
// OLD
locked → auditioning → voting → revealing → locked_in / collapsed

// NEW
locked → auditioning_and_voting → revealing → locked_in / collapsed
```

The `START_LAYER` command enters `auditioning_and_voting`. There is no separate `OPEN_VOTING` command.

### 3.2 Update `conductor.ts`

Replace the `START_AUDITION` → `OPEN_VOTING` sequence with a single `START_LAYER` handler that:
1. Sets `currentLayerPhase` to `'auditioning_and_voting'`
2. Sets tempo via OSC to `attemptConfig.tempos[layerIndex]`
3. Triggers audio playback of option A for `auditionBars[layerIndex]` bars, then option B for `auditionBars[layerIndex]` bars
4. Voting is open for the entire audition duration — it opens when A starts and closes when B finishes
5. When the audition completes, the vote automatically closes and the reveal begins

### 3.3 Update `timing.ts`

The voting window is exactly the audition duration — no separate timer. The timing engine schedules:
- Play option A for `auditionBars[layerIndex]` bars at `tempos[layerIndex]` BPM
- Play option B for `auditionBars[layerIndex]` bars at `tempos[layerIndex]` BPM
- When option B finishes → vote closes → reveal begins

The total voting window in milliseconds is derived:

```typescript
function votingWindowMs(auditionBars: number, tempos: number): number {
  return barsToMs(auditionBars * 2, tempos);
}

function barsToMs(bars: number, bpm: number, beatsPerBar: number = 4): number {
  const msPerBeat = 60000 / bpm;
  return bars * beatsPerBar * msPerBeat;
}
```

The client displays this derived countdown to the audience. The server sends the total duration to clients at layer start so they can render the timer.

### 3.4 Audition bar-to-ms conversion

Audition durations are in bars, but the timing engine needs ms. Convert using the current layer's tempo:

```typescript
function barsToMs(bars: number, bpm: number, beatsPerBar: number = 4): number {
  const msPerBeat = 60000 / bpm;
  return bars * beatsPerBar * msPerBeat;
}
```

Examples:
- 4 bars at 120 BPM = 8000ms
- 4 bars at 170 BPM = 5647ms
- 2 bars at 170 BPM = 2824ms

### 3.5 Update `audio-router.ts`

Audition playback is timed in **bars** (quantized to the Ableton clock). The tempo is already set at the start of the layer (step 2 of `START_LAYER`). Audition sequence:
1. Unmute option A track, play for `auditionBars[layerIndex]` bars
2. Mute option A, unmute option B, play for `auditionBars[layerIndex]` bars
3. Mute option B → audition complete → vote closes → reveal begins

### 3.6 Update client

The audience phone shows voting cards **immediately** when the layer starts — not after the audition finishes. Cards are tappable from the first moment. Timer is visible and counting down. The audience can vote after hearing only option A, or wait for both.

### Tests for Phase 3

```
- START_LAYER command transitions to 'auditioning_and_voting' phase
- No 'auditioning' or 'voting' phases exist separately
- Votes are accepted from the moment the phase starts
- Vote closes when audition finishes (option B completes its bars)
- Audition plays A then B for correct number of bars per config
- Tempo is set at start of each layer from config
- Timing engine reads auditionBars from per-attempt config
- Voting window ms = auditionBars * 2 * barsToMs(1, tempo)
- barsToMs(4, 120) === 8000
- barsToMs(2, 170) === ~2824
- Client receives derived voting window duration for timer display
```

---

## Phase 4: Tempo & Timing -- COMPLETE (2026-03-19)

**Goal:** Implement per-layer, per-song tempo changes and ensure all timing is correct with variable BPM.

> **Deviations:** Tempo sent via new `set_tempo` AudioCue (not timing engine). `NOMINAL_TEMPO_BPM` retained as fallback constant; `routerState.baseTempo` derived from config at runtime. Tempo reset added to rejection gesture (not in original spec). Finale tempo reset triggers on `SHOW_PHASE_CHANGED` → `finale_elegy` in audio-router event loop.

### 4.1 Tempo change via OSC

At the start of each layer (when entering `auditioning_and_voting`), send:

```
/live/song/set/tempo [bpm]
```

Where `bpm = attemptConfig.tempos[layerIndex]`. Each value is independently configurable per layer per song in `default-show.json`.

### 4.2 Default tempo curve

| Layer | BPM | Feel |
|-------|-----|------|
| 0     | 120 | Relaxed |
| 1     | 120 | Comfortable |
| 2     | 130 | Picking up |
| 3     | 140 | Driven |
| 4     | 155 | Frantic |
| 5     | 170 | Desperate |

These are defaults — each song can have a completely different curve.

### 4.3 Combined timing table (defaults)

The voting window equals the total audition time (both options). It shrinks naturally as tempo increases and audition bars decrease.

| Layer | BPM | Audition bars/option | Per option (ms) | Total voting window (ms) |
|-------|-----|---------------------|-----------------|--------------------------|
| 0     | 120 | 4                   | 8000            | 16000                    |
| 1     | 120 | 4                   | 8000            | 16000                    |
| 2     | 130 | 4                   | 7385            | 14769                    |
| 3     | 140 | 2                   | 3429            | 6857                     |
| 4     | 155 | 2                   | 3097            | 6194                     |
| 5     | 170 | 2                   | 2824            | 5647                     |

Layer 0: ~16 seconds to listen and vote. Layer 5: ~5.6 seconds. The compression comes from two levers working together — fewer bars AND faster tempo.

### 4.4 Tempo affects already-locked layers

When tempo increases at layer 4, all clips from layers 0–3 play at the new BPM. Ableton's warp engine handles time-stretching. The character of the music changes — a warm bass at 120 becomes driving at 155. This is intentional: the whole song accelerates together.

**Composition constraint:** All fragments must sound good across the full tempo range configured for their song.

### 4.5 Tempo reset between songs

When transitioning out of `attempt_build` (collapse or completion), reset tempo to base. The next song's layer 0 sets its own starting tempo. For the finale: reset to base tempo at `finale_elegy`.

### 4.6 Reveal sequence timing

The reveal sequence uses **millisecond** durations (wall clock), not bars. It's a UI animation, not a musical event. However, the lock-in audio activation at the end of the reveal should still be quantized to the next bar boundary at the current tempo.

### Tests for Phase 4

```
- Tempo OSC command fires at start of each layer with correct BPM from per-song config
- Different songs can have different tempo curves
- Audition duration shortens as tempo increases (same bars, faster BPM)
- Voting window = total audition duration (derived, not separate config)
- Tempo resets between songs
- Tempo resets at finale_elegy
- Lock-in audio activation still quantized to bar boundary at current tempo
```

---

## Phase 5: Fragment Generation

**Goal:** Update fragment generation to support both-options-survive (configurable).

### 5.1 Update `fragments.ts`

Check `config.finale.bothOptionsSurvive`:

```typescript
function generateFragments(
  attemptResults: AttemptResult[],
  bothOptionsSurvive: boolean
): { available: Fragment[]; locked: Fragment[] } {
  const available: Fragment[] = [];
  const locked: Fragment[] = [];

  for (const attempt of attemptResults) {
    for (const layer of attempt.layers) {
      if (layer.status === 'locked_in' || layer.status === 'collapsed') {
        // Vote happened — winner is always available
        available.push(makeFragment(attempt, layer, layer.chosenOption!, true));

        const loserOption = layer.chosenOption === 'A' ? 'B' : 'A';
        if (bothOptionsSurvive) {
          available.push(makeFragment(attempt, layer, loserOption, false));
        } else {
          locked.push(makeFragment(attempt, layer, loserOption, false));
        }
      } else {
        // 'unreached' — never voted on, both locked
        locked.push(makeFragment(attempt, layer, 'A', false));
        locked.push(makeFragment(attempt, layer, 'B', false));
      }
    }
  }

  return { available, locked };
}
```

**Note:** The `collapsed` layer (where threshold failed) still had a vote — the winner is the option with more votes even though the song died. Fragments from this layer are available.

### 5.2 Fragment count expectations

**When `bothOptionsSurvive: true`:**
- Per voted layer (locked_in or collapsed): 2 fragments
- Worst case (2 layers per song × 3 songs): 12 available
- Typical (3–4 layers): 18–24 available
- Best case (all 6 × 3): 36 available

**When `bothOptionsSurvive: false`:**
- Per voted layer: 1 fragment (winner only)
- Worst case: 6 available
- Typical: 9–12 available
- Best case: 18 available

### Tests for Phase 5

```
- bothOptionsSurvive: true → voted layers produce 2 fragments each
- bothOptionsSurvive: false → voted layers produce 1 fragment (winner only)
- Collapsed layers produce fragments (vote happened)
- Unreached layers produce 0 available fragments regardless of flag
- Fragment.wonVote is true for winners, false for losers
- Every layer type has ≥2 available fragments when bothOptionsSurvive: true and ≥2 layers per song
```

---

## Phase 6: Finale Updates (6 Layer Types) -- COMPLETE (2026-03-19)

**Goal:** Update all finale phases for 6 layer types instead of 7.

### 6.1 Assembly

- 6 tappable group cards instead of 7
- Remove FX2 from all group-related logic
- Random assignment distributes across 6 groups

### 6.2 Deliberation

- 6 groups deliberate instead of 7
- Each group sees up to 6 fragment options (`bothOptionsSurvive: true`) or up to 3 (`false`)
- When a group has many options, group the UI by song (2 per song, 3 rows)
- Single-fragment groups: deliberation trivially decided, proceed to ambassador
- Empty groups: skipped entirely

### 6.3 Ceremony

- `ceremonyLayerOrder` has 6 entries (configured in `default-show.json`)
- 6 ambassador calls instead of 7

### 6.4 Performer Mix

- Mixing surface: **6 rows** (one per layer type) × **6 columns** (3 songs × 2 options)
- The performer always has access to all fragments on the mixing surface, regardless of `bothOptionsSurvive`

### 6.5 Visual identity table

| Layer Type | Color | Symbol | Label |
|------------|-------|--------|-------|
| Melody | TBD | ✦ | "The Voice" |
| Drums | TBD | ▲ | "The Heartbeat" |
| Pad | TBD | ◆ | "The Warmth" |
| Bass | TBD | ■ | "The Ground" |
| Harmony | TBD | ● | "The Color" |
| FX | TBD | ~ | "The Shimmer" |

### Tests for Phase 6

```
- Assembly shows exactly 6 group cards
- Random assignment covers all 6 types
- Empty groups are skipped in ceremony
- Ceremony iterates over 6 positions
- Mixing surface has 6 rows × 6 columns
- No references to fx1, fx2, or 7 groups anywhere in finale code
```

---

## Phase 7: Track Layout & OSC -- COMPLETE (2026-03-19)

**Goal:** Update Ableton track mapping and all OSC commands for 36 tracks.

> **Deviations:** Track indices are config-driven (`default-show.json` layer `optionA`/`optionB` AudioReferences), not computed from a formula at runtime. The `computeTrackIndex` function in `audio-router.ts` is only used for test fixtures. Config already had correct 36-track layout from Phase 1. Phase 7 work reduced to updating `ableton-layout.json` (`maxLayersPerAttempt` 7→6, comments 42→36). Audio urgency (7.3 — return track degradation per layer) deferred to Phase 8 with other urgency effects.

### 7.1 Track index formula

```typescript
// 3 songs × 6 layers × 2 options = 36 tracks
function trackIndex(songIndex: number, layerIndex: number, option: 'A' | 'B'): number {
  const optionOffset = option === 'A' ? 0 : 1;
  return songIndex * 12 + layerIndex * 2 + optionOffset;
}

// Examples:
// Song 0, Layer 0, Option A = 0
// Song 0, Layer 5, Option B = 11
// Song 1, Layer 0, Option A = 12
// Song 2, Layer 5, Option B = 35
```

Live performance tracks start at index **36+** (was 42+).

### 7.2 Audio preview files

Up to 36 files (was 42):
- Naming: `preview-{songIndex}-{layerIndex}-{option}.mp3`
- Range: `preview-0-0-A.mp3` through `preview-2-5-B.mp3`

### 7.3 Audio urgency — return track degradation

At the start of each layer, send effect parameter values to a return track for audio degradation:

```typescript
sendOSC('/live/device/set/parameter/value', [returnTrackIndex, deviceIndex, paramIndex, urgencyValue]);
```

Exact parameter indices depend on the Ableton session's return track setup. Values are indexed by `layerIndex`. No new architecture — uses existing OSC path.

### Tests for Phase 7

```
- trackIndex(0, 0, 'A') === 0
- trackIndex(0, 0, 'B') === 1
- trackIndex(1, 0, 'A') === 12
- trackIndex(2, 5, 'B') === 35
- No track index exceeds 35 for song-building tracks
- Live performance tracks start at 36+
- Tempo OSC command fires at layer start
```

---

## Phase 8: Reveal Sequence & UI

**Goal:** Update the reveal sequence for threshold visualization and add urgency effects.

### 8.1 Update reveal sequence

```
OLD: tension beat → split reveal → health bar drain → lock-in → advance
NEW: tension beat → split reveal → threshold check → lock-in / collapse → advance
```

1. **Tension beat** (~0.9s): both options displayed equal, no result
2. **Split reveal** (~2s): winning option grows, losing shrinks. Winning proportion displayed.
3. **Threshold check** (~1.5s): winning proportion compared against doubt threshold.
   - **Pass**: clears the line → relief animation → lock-in glow
   - **Fail**: falls short → collapse triggers
4. **Lock-in** (~0.5s): winning option glows (only on pass)
5. **Advance**: next layer or collapse

### 8.2 Threshold display

Visible on projector **before** the vote opens. A line that rises each layer. After the vote: consensus bar shown approaching or failing to reach the line. This is the single most important visualization.

### 8.3 UI urgency effects (audience phone)

All effects are **purely cosmetic**. Tap targets remain fixed and full-size.

| Layer | Effect |
|-------|--------|
| 0–1 | Clean, stable, calm |
| 2 | Timer text color shifts toward red |
| 3 | Option cards: subtle drift (CSS transform, ±2px). Timer pulses faster. |
| 4 | Increased drift (±4px). Colors desaturate. Timer digits jitter. |
| 5 | Full destabilization. Drift, color shift, visual noise. |

**Critical:** The visual layer shifts but the hit area does not. If playtesters miss taps due to jitter, reduce the effect.

### 8.4 Collapse as release

When collapse triggers: all urgency effects stop instantly. Phone goes calm. Projector goes dark. Audio cuts to silence. The contrast is the payoff.

### 8.5 Component changes

Delete:
- `HealthBar.tsx`
- `HealthBarControls.tsx`

Add:
- `ThresholdDisplay.tsx` — doubt line + consensus bar
- `UrgencyEffects.tsx` — CSS urgency transforms driven by `layerIndex`

### Tests for Phase 8

```
- Reveal sequence shows threshold check instead of health bar drain
- Threshold line visible before vote opens on projector
- UI urgency effects scale with layerIndex
- Tap targets remain mechanically accurate at all urgency levels
- Collapse triggers instant UI reset
- No HealthBar or HealthBarControls components exist
```

---

## Phase 9: Config & Environment

**Goal:** Finalize all configuration changes.

### 9.1 `default-show.json`

See the full config structure in the **Config Reference** section at the top of this document.

Key points:
- Each attempt has `thresholds`, `tempos`, `auditionBars` arrays (all length 6, independently configurable per layer per song)
- Voting window is derived from `auditionBars` and `tempos` — not a separate config value
- Each attempt has `layers` array (length 6)
- `finale.bothOptionsSurvive` boolean
- `finale.ceremonyLayerOrder` has 6 entries

### 9.2 Environment variables

**Remove:**
```bash
DEFAULT_DRAIN_FACTOR=0.5
DEFAULT_LAYER_MULTIPLIERS=0.5,0.6,0.8,1.0,1.3,1.6,2.0
```

**Change:**
```bash
CEREMONY_LAYER_ORDER=bass,drums,pad,melody,harmony,fx
```

**No new env vars.** All per-layer, per-song tuning lives in `default-show.json`.

### 9.3 Database

No schema changes. LayerResult shape changes are in the JSON blob in `shows.state`. A fresh database is expected for V3.1.

### 9.4 Config validation

The config loader should validate:
- All per-layer arrays have length exactly equal to `LAYERS_PER_ATTEMPT` (6)
- Thresholds are between 0.0 and 1.0
- Tempos are positive numbers
- AuditionBars are positive integers
- `bothOptionsSurvive` is a boolean
- `ceremonyLayerOrder` has 6 entries, all valid `LayerType` values

### Tests for Phase 9

```
- default-show.json parses correctly
- Config loader validates all array lengths === 6
- Config loader rejects invalid threshold values
- No references to DEFAULT_DRAIN_FACTOR or DEFAULT_LAYER_MULTIPLIERS
```

---

## Phase 10: Integration & Smoke Testing

**Goal:** Verify all phases work together end-to-end.

### 10.1 Bot simulation script

Create `tools/simulate-audience.ts`:

```typescript
// Usage: npx tsx tools/simulate-audience.ts --bots 40 --alignment 0.7
```

Each bot connects via Socket.IO, auto-votes with configurable alignment, and supports finale phases (auto-join group, auto-vote fragment, auto-volunteer).

### 10.2 Synthetic vote controller command

Add `SIMULATE_VOTE` to the conductor:

```typescript
| { type: 'SIMULATE_VOTE'; votesA: number; votesB: number }
```

Wire to controller UI: two number inputs + "simulate" button. Step through all 6 layers in under a minute with exact distributions.

### 10.3 End-to-end scenarios

| Scenario | Alignment | Layers locked | Collapse on |
|----------|-----------|---------------|-------------|
| Max disagreement | 50/50 | 2 | Layer 2 |
| Moderate split | 70/30 | 3 | Layer 3 |
| Good alignment | 80/20 | 4 | Layer 4 |
| Strong alignment | 90/10 | 5 | Layer 5 |
| Near-perfect | 95/5 | 6 | Completes |

Verify per scenario: correct layer count, fragments generated, tempo increases, timer shrinks, 6 finale groups, correct fragment options per group.

### Tests for Phase 10

```
- Bot script connects 40 clients and completes a full show cycle
- SIMULATE_VOTE works from controller
- All 5 alignment scenarios produce expected results
- Full flow: lobby → 3 songs → finale → ended completes without errors
```

---

## File Index

| File | Action | Phase |
|------|--------|-------|
| `conductor/types.ts` | Major rewrite | 1 |
| `conductor/health-bar.ts` | **Delete** | 2 |
| `conductor/threshold.ts` | **New** (~15 lines) | 2 |
| `conductor/voting.ts` | Update (threshold check) | 2 |
| `conductor/conductor.ts` | Update (phases, collapse) | 2, 3 |
| `conductor/fragments.ts` | Update (bothOptionsSurvive) | 5 |
| `conductor/assembly.ts` | Update (6 groups) | 6 |
| `conductor/deliberation.ts` | Update (6 groups, fragments) | 6 |
| `conductor/ceremony.ts` | Update (6 positions) | 6 |
| `conductor/performer-mix.ts` | Update (6 rows) | 6 |
| `server/timing.ts` | Update (concurrent audition+vote, per-layer timing) | 3, 4 |
| `server/audio-router.ts` | Update (36 tracks, tempo, urgency) | 3, 4, 7 |
| `server/osc.ts` | No changes | — |
| `components/song-building/HealthBar.tsx` | **Delete** | 8 |
| `components/song-building/RevealSequence.tsx` | Update (threshold check) | 8 |
| `components/song-building/OptionCards.tsx` | Update (vote during audition, urgency) | 3, 8 |
| `components/song-building/LayerProgress.tsx` | Update (6 layers) | 1 |
| `components/song-building/ThresholdDisplay.tsx` | **New** | 8 |
| `components/song-building/UrgencyEffects.tsx` | **New** | 8 |
| `components/finale/AssemblyCards.tsx` | Update (6 cards) | 6 |
| `components/finale/DeliberationBoard.tsx` | Update (up to 6 fragments) | 6 |
| `components/finale/MixingSurface.tsx` | Update (6 rows) | 6 |
| `components/finale/MixingMirror.tsx` | Update (6 rows) | 6 |
| `components/controller/HealthBarControls.tsx` | **Delete** | 8 |
| `hooks/useShowState.ts` | Update (new state shape) | 1 |
| `lib/identity.ts` | Update (6 layer types) | 1 |
| `config/default-show.json` | Major rewrite | 9 |
| `config/ableton-layout.json` | Update (36 tracks) | 7 |
| `tools/simulate-audience.ts` | **New** | 10 |

---

## Design Notes

### Heckler / coordination resilience

Blind vote = primary defense. Shrinking timer = secondary. No mechanical countermeasures. If coordination completes all 6 layers, the performer triggers rejection anyway.

### Urgency is atmospheric, not mechanical

All UI destabilization is cosmetic only. Tap targets stay fixed. The chaos is around the decision, not in the way of it.

### Tempo change timing

Schedule the tempo change on the same beat-quantized boundary as the layer's audition start. Avoid mid-phrase tempo jumps.

### Composition constraint

All fragments must sound good across each song's full configured tempo range. Test at min and max tempo during Ableton production.

### Per-song tuning workflow

Start with identical defaults across all 3 songs. Adjust per song after playtesting. Song 1 can be forgiving (lower thresholds, more audition bars, slower tempo ramp). Song 3 can be harsh (higher thresholds, fewer bars, faster ramp).
# Song-Building Phase — Detailed Mechanics

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (type definitions), [audio-engine.md](audio-engine.md) (playback modes)

---

## Layer Structure

Each attempt has exactly **6 layers**, one per layer type. The layer ordering is **staggered across songs** to ensure that across all three songs, every layer type is voted on early at least once. This creates both musical differentiation (each song builds from a different starting point) and guarantees diverse fragment availability regardless of doubt threshold outcomes.

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
  | 'fx';       // Textures, atmospheres, transitions — harmonically neutral
```

## Staggered Layer Ordering

| Position | Song 1 (Ambition) | Song 2 (Love) | Song 3 (Avoidance) |
|----------|-------------------|---------------|---------------------|
| Layer 0  | Bass              | Melody        | Pad                 |
| Layer 1  | Drums             | Harmony       | FX                  |
| Layer 2  | Melody            | FX            | Drums               |
| Layer 3  | Harmony           | Bass          | Bass                |
| Layer 4  | Pad               | Pad           | Melody              |
| Layer 5  | FX                | Drums         | Harmony             |

This ensures: every layer type appears in position 0 or 1 of at least one song.

## Layer Phase Transitions (within `attempt_build`)

```
locked → auditioning → revealing → locked_in
                                      │
                                      ▼ (if doubt threshold not met)
                                collapsed (attempt ends)
```

```typescript
type LayerPhase =
  | 'locked'        // Not yet reached; displayed as upcoming
  | 'auditioning'   // Playing A and B previews for the room; voting is concurrent
  | 'revealing'     // Vote closed, reveal sequence playing
  | 'locked_in'     // Winner confirmed, added to song stack
  | 'collapsed';    // Doubt threshold not met at this layer; attempt ends
```

## Blind Vote Mechanic

The vote window equals the audition duration — it is **derived**, not separately configured. It opens when option A starts playing and closes when option B finishes. The duration is `auditionBars[layerIndex] * 2 * barsToMs(1, tempos[layerIndex])`, which naturally compresses as tempo increases and audition bars decrease (default: ~16s at layer 0, ~5.6s at layer 5).

During this window:
- Audience sees Option A and Option B as large tappable cards (shown immediately at layer start)
- Each user taps once to vote; vote is final (no changing during blind vote)
- **No live feedback** on vote distribution. The audience cannot see which option is leading.
- This preserves authentic expression: you vote your preference, not the crowd's momentum

When the audition/vote window closes, the **Reveal Sequence** plays (~5s total, matching `revealSequenceDurationMs`). The conductor pauses at `revealing` phase until `ADVANCE_FROM_REVEAL` fires from the timing engine after this duration.

1. **Tension beat** (~0.9s): both options displayed equal size, muted, no result
2. **Split reveal** (~2s): winning option grows (flex proportional to consensus), losing option shrinks + dims
3. **Threshold check** (~1.5s): the winning proportion is compared against the doubt threshold. Pass → lock-in. Fail → collapse. Projector shows exact vote counts, audience sees only the visual split
4. **Lock-in** (~0.5s): winning option gets glow accent
5. **Advance**: `ADVANCE_FROM_REVEAL` fires → `lockInLayer()` or `collapseAttempt()`; next layer begins auditioning

## Doubt Threshold

Each layer has a configurable doubt threshold (from `AttemptConfig.thresholds[]`). After votes are tallied, the winning option's proportion is compared against the threshold for that layer position. No cumulative state is carried between layers — each vote is an independent pass/fail check.

- If `winningProportion >= threshold` → **pass** (lock-in)
- If `winningProportion < threshold` → **fail** (collapse)

**Default threshold curve:** `[0.50, 0.50, 0.65, 0.78, 0.88, 0.95]`

**Tuning guide:**
- Layers 0–1 (threshold 0.50): guaranteed to pass — any majority wins
- Layer 2 (threshold 0.65): filters out near-50/50 splits
- Layer 5 (threshold 0.95): requires near-unanimity — collapse is very likely

```typescript
interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'collapsed' | 'unreached';
  chosenOption: 'A' | 'B' | null;
  winningProportion: number | null;
  thresholdRequired: number | null;
  passed: boolean | null;
}
```

**Per-attempt tuning:** The `thresholds` array can vary per song. Song 1 could use a gentler curve as the audience learns. Song 3 could use a steeper curve for dramatic tension.

## Tempo Escalation

Each layer has a configurable tempo (from `AttemptConfig.tempos[]`). At the start of each layer (when entering `auditioning` phase), the conductor emits a `set_tempo` AudioCue and the audio-router sends `/live/song/set/tempo` via OSC. This changes the global Ableton tempo — all previously locked layers play at the new BPM (Ableton's warp engine handles time-stretching).

**Default tempo curve:** `[120, 120, 130, 140, 155, 170]`

The tempo escalation serves two purposes:
1. **Urgency atmosphere**: The music accelerates as doubt rises, creating tension
2. **Compressed voting window**: Faster tempo + fewer audition bars = shorter time to listen and vote

**Tempo resets to base** (first attempt's `tempos[0]`) on: collapse, song rejection, attempt completion, and `finale_elegy` phase. The next song's layer 0 sets its own starting tempo.

## Collapse Behavior

When the doubt threshold is not met after a vote:
1. The current layer enters `collapsed` phase — the vote's winner is still determined but the layer does NOT lock in
2. **Audio**: Collapse effect triggers via OSC (return track effects — distortion, filter sweep, reverb tail). Tempo ramps down to floor then resets to base.
3. **Visual**: Collapse state shown on projector; phone UI shows collapse state
4. **System**: All remaining layers for this attempt are marked `unreached`
5. **Data**: Locked-in layers from earlier in this attempt are preserved as available finale fragments. The collapsed layer and all unreached layers are lost (both options visible but locked in finale elegy).
6. After collapse animation duration, system transitions to next phase (auto-advance to `attempt_story` for Songs 1–2; manual advance to `finale_elegy` for Song 3)

## Song Completion & Rejection

If a song survives all 6 layers (all thresholds met):
1. The complete song plays for 15–20 seconds — the audience hears their creation
2. The performer **narratively rejects** the song (self-sabotage)
3. A **rejection effect** is triggered via OSC (TBD: filter sweep, distortion, abrupt cut — configurable, distinct from collapse effect)
4. The system transitions to `attempt_resolve` phase
5. The performer advances to the next `attempt_story` when ready

**Two distinct endings:** Collapse is the cumulative weight of division killing the song — the audience's failure. Rejection is the performer killing a healthy song — the performer's failure. Both should have distinct audio and visual treatments so the audience can feel the difference.

## Song Stack & Fragment Generation

After each attempt, the system records:

```typescript
interface AttemptResult {
  attemptIndex: number;                // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layers: LayerResult[];               // Length 6 (includes unreached layers)
  completed: boolean;                  // True if all layers reached and passed
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
}
// Note: bothOptionsSurvive config controls whether losing options also become fragments

interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'collapsed' | 'unreached';
  chosenOption: 'A' | 'B' | null;     // null if unreached
  winningProportion: number | null;    // null if unreached
  thresholdRequired: number | null;    // null if unreached
  passed: boolean | null;             // null if unreached
}
```

Note: The `Fragment` type includes a `wonVote: boolean` field to distinguish winning and losing options.

**Fragment availability for finale:**
- `locked_in` layers: the **winning** option becomes an available fragment in the finale
- `locked_in` layers: the **losing** option is visible in the elegy display but NOT available during gameplay
- `unreached` layers (due to collapse): **both** options are visible in the elegy display but NOT available during gameplay — these represent "what could have been"
- The performer's mixing surface has access to **all fragments** regardless of availability (both winners and losers from reached layers, plus both options from unreached layers)

**Fragment count depends on show performance:**
- Best case (all 3 songs complete, `bothOptionsSurvive: true`): 36 available fragments (6 × 3 × 2 options)
- Best case (all 3 songs complete, `bothOptionsSurvive: false`): 18 available fragments (6 × 3)
- Typical case (songs collapse at layers 3–5): 9–15 available fragments
- Worst case (very early collapses): as few as 4–6 available fragments
- The staggered layer ordering guarantees that every layer type has at least one available fragment if each song reaches at least 2 layers

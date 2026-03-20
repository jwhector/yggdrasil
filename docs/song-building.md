# Song-Building Phase — Detailed Mechanics

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (type definitions), [audio-engine.md](audio-engine.md) (playback modes)

---

## Layer Structure

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

## Staggered Layer Ordering

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

## Layer Phase Transitions (within `attempt_build`)

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

## Blind Vote Mechanic

The vote window is a configurable duration (default: 10–15 seconds). During this window:
- Audience sees Option A and Option B as large tappable cards
- Each user taps once to vote; vote is final (no changing during blind vote)
- **No live feedback** on vote distribution. The audience cannot see which option is leading.
- This preserves authentic expression: you vote your preference, not the crowd's momentum

When the vote window closes, the **Reveal Sequence** plays (~5s total, matching `revealSequenceDurationMs`). The conductor pauses at `revealing` phase until `ADVANCE_FROM_REVEAL` fires from the timing engine after this duration.

1. **Tension beat** (~0.9s): both options displayed equal size, muted, no result
2. **Split reveal** (~2s): winning option grows (flex proportional to consensus), losing option shrinks + dims
3. **Health bar drain** (~1.5s): drain shadow appears briefly then animates actual depletion; projector shows exact vote counts, audience sees only the visual split
4. **Lock-in** (~0.5s): winning option gets glow accent
5. **Advance**: `ADVANCE_FROM_REVEAL` fires → `lockInLayer()` or `collapseAttempt()`; next layer begins auditioning

## Health Bar

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

## Collapse Behavior

When the health bar reaches zero after a vote's drain is applied:
1. The current layer enters `collapsed` phase — the vote's winner is still determined but the layer does NOT lock in
2. **Audio**: Collapse effect triggers via OSC (return track effects — distortion, filter sweep, reverb tail)
3. **Visual**: Health bar shatters/empties on projector; phone UI shows collapse state
4. **System**: All remaining layers for this attempt are marked `unreached`
5. **Data**: Locked-in layers from earlier in this attempt are preserved as available finale fragments. The collapsed layer and all unreached layers are lost (both options visible but locked in finale elegy).
6. After collapse animation duration, system transitions to next phase (auto-advance to `attempt_story` for Songs 1–2; manual advance to `finale_elegy` for Song 3)

## Song Completion & Rejection

If a song survives all 7 layers (health bar > 0 after final vote):
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
- `locked_in` layers: the **winning** option becomes an available fragment in the finale
- `locked_in` layers: the **losing** option is visible in the elegy display but NOT available during gameplay
- `unreached` layers (due to collapse): **both** options are visible in the elegy display but NOT available during gameplay — these represent "what could have been"
- The performer's mixing surface has access to **all fragments** regardless of availability (both winners and losers from reached layers, plus both options from unreached layers)

**Fragment count depends on show performance:**
- Best case (all 3 songs complete): 21 available fragments (7 × 3)
- Typical case (songs collapse at layers 4–6): 12–18 available fragments
- Worst case (very early collapses): as few as 6–9 available fragments
- The staggered layer ordering guarantees that every layer type has at least one available fragment if each song reaches at least 2–3 layers

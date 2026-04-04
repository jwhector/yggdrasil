# Projector Visual System — Implementation Spec

> Migration guide for the `/projector` page. This document specifies the new Canvas 2D-based projector visualization system designed in collaboration between the creator and an AI design partner. It replaces the existing projector song-building and finale views with a unified "skeleton" visual language.
>
> **Read first:** `ARCHITECTURE.md` (core concepts), `docs/song-building.md` (layer phases, reveal sequence), `docs/finale.md` (finale sub-phases), `docs/data-models.md` (conductor events, state types)

---

## Overview

The projector displays a **pentagon skeleton** — 5 audience-controlled granular type nodes arranged in a circle around a central melody/seed node. This skeleton is the consistent visual element across the entire show:

- **Song-building:** The skeleton fills up with the current chapter's color as layers are voted on and locked in. The A/B audition and a two-beat reveal sequence are rendered around the skeleton.
- **Finale live mix:** The same skeleton, but each node independently shows a different chapter color based on which song's fragment the audience group has selected.

The entire projector view is rendered on a single `<canvas>` element using Canvas 2D. Dark background (#090909). No DOM-based UI components — everything is drawn.

---

## 1. The skeleton

### Node layout

5 nodes arranged in a regular pentagon, centered on screen. The center contains the melody/seed node.

```typescript
// Pentagon node positions (angles from top, clockwise)
const NODES = [
  { id: 'bass',    symbol: '■', label: 'BASS',    angle: -Math.PI / 2 },                    // top
  { id: 'drums',   symbol: '▲', label: 'DRUMS',   angle: -Math.PI / 2 + (2 * Math.PI / 5) }, // upper right
  { id: 'pad',     symbol: '◆', label: 'PAD',     angle: -Math.PI / 2 + (4 * Math.PI / 5) }, // lower right
  { id: 'harmony', symbol: '●', label: 'HARMONY', angle: -Math.PI / 2 + (6 * Math.PI / 5) }, // lower left
  { id: 'fx',      symbol: '~', label: 'FX',      angle: -Math.PI / 2 + (8 * Math.PI / 5) }, // upper left
];

// Layer group adjacencies in the pentagon:
// bones  = bass (top) + drums (upper right)     — adjacent
// flesh  = harmony (lower left) + pad (lower right) — adjacent  
// spark  = fx (upper left)                      — solo

// Center: melody/seed node (always present, not audience-controlled during song-building)
```

Node positions are computed from a center point and orbit radius:
```typescript
const centerX = canvasWidth / 2;
const centerY = canvasHeight * 0.44;  // slightly above vertical center to leave room for reveal bars
const orbitRadius = Math.min(canvasWidth, canvasHeight) * 0.22;

// Each node position:
const nodeX = centerX + Math.cos(node.angle) * orbitRadius;
const nodeY = centerY + Math.sin(node.angle) * orbitRadius;
```

### Node rendering

Each node has three visual layers:
1. **Membrane** — organic, noise-displaced circle drawn with Canvas 2D. Uses 2D simplex-style noise for displacement. Intensity and alpha vary by state.
2. **Circle** — clean arc stroke, the node's boundary.
3. **Symbol + label** — the granular type symbol centered in the node, label below.

### Node states

| State | Membrane | Circle | Color | Alpha |
|---|---|---|---|---|
| **Empty** (upcoming, not yet reached) | None | Thin stroke, dim | `#3c3c37` | 0.3 |
| **Active** (currently being auditioned) | Pulsing, high intensity displacement | Thicker stroke | Chapter color | 0.7–1.0, oscillating |
| **Filled** (locked in from previous vote) | Subtle, low intensity | Normal stroke | Chapter color | 0.8 |
| **Collapsed** | None | Dashed stroke | Dark red `#501e1e` | 0.4 |
| **Finale** | High intensity, independent breathing | Normal stroke | Per-node chapter color | 1.0 |

### Center seed node

Always rendered. Larger than pentagon nodes. Shows the `✦` symbol. Label says "MELODY" during song-building, "THE LEAD" during finale. Color matches current chapter during song-building, white during finale.

### Connectors

- **Radial lines:** Faint lines from center to each node. Brighter for active/filled nodes.
- **Bundle arcs:** Curved arcs connecting nodes in the same layer group (bass↔drums for bones, harmony↔pad for flesh). During audition, the active group's arc pulses and has a traveling dot animation. Filled groups show a static subtle arc. No arc for spark (solo node).

---

## 2. Song-building phase: Audition

**When:** `showPhase === 'attempt_build'` and `currentLayerPhase === 'auditioning'`

### Visual layout

- **Skeleton:** centered, fully visible
- **A label:** large, positioned left of skeleton (`centerX - canvasWidth * 0.36`)
- **B label:** large, positioned right of skeleton (`centerX + canvasWidth * 0.36`)
- **Active nodes:** pulsing with chapter color, bundle arc animated
- **Filled nodes:** steady glow with chapter color
- **Empty nodes:** dim outlines

### A/B audition cycling

The conductor emits `AUDITION_OPTION_CHANGED` events as options alternate. The projector tracks which option is currently playing:
- **Active option:** label at full brightness (0.85), pulsing glow
- **Inactive option:** label nearly invisible (0.12)
- A "NOW PLAYING" micro-label appears above the active option
- Sound descriptors (e.g., "PRIMAL" / "SYNTHETIC") appear below each label

### Header

```
SEQUENCE STATE          (small, dim)
BONES                   (large, chapter color — from layer group name)
LAYER 1 OF 3            (small, dim)
```

---

## 3. Song-building phase: Two-beat reveal

The reveal is split into two manually-triggered beats. This replaces the existing 5-step timed reveal sequence from the spec.

### Architecture change: new conductor command

Add a new command and event to support the two-beat reveal:

```typescript
// New command (controller → conductor)
| { type: 'REVEAL_STAKES' }    // Beat 1: show threshold, hide skeleton

// New event (conductor → clients) 
| { type: 'REVEAL_STAKES_SHOWN'; attemptIndex: number; layerIndex: number; threshold: number }
```

**Updated reveal flow:**

| Step | Trigger | Conductor phase | Projector state |
|---|---|---|---|
| Audition ongoing | — | `auditioning` | Skeleton + A/B cycling |
| Vote window closes | `CLOSE_VOTING` | `auditioning` → `revealing` | No visual change yet (brief pause) |
| Beat 1: Stakes | `REVEAL_STAKES` (manual from controller) | `revealing` | Skeleton fades, A/B slide to center, threshold line animates in |
| Beat 2: Verdict | `ADVANCE_FROM_REVEAL` (manual from controller) | `revealing` → `locked_in` or `collapsed` | Bars grow, pass/fail verdict |
| Advance | Auto after verdict animation | — | Next layer begins or collapse |

**Controller UI:** Two new buttons in VotingControls:
- "Show Stakes" (fires `REVEAL_STAKES`) — enabled when phase is `revealing`
- "Reveal Votes" (fires `ADVANCE_FROM_REVEAL`) — enabled after stakes are shown

### Beat 1: Stakes

**Trigger:** `REVEAL_STAKES` command from controller

**Animation timeline (from trigger, ~1.8s total):**

| Time | Animation |
|---|---|
| 0–600ms | Skeleton fades out (alpha 1 → 0, ease in-out) |
| 400–1200ms | A and B labels slide from sides to bottom center, side by side (ease in-out). Gap between them: `canvasWidth * 0.13`. Final Y position: `canvasHeight * 0.84` |
| 400–1200ms | Empty bar tracks fade in behind A and B (subtle, `rgba(255,255,255,0.08)`) |
| 1000–1800ms | Threshold line animates upward from the bar bottom to its target height (ease in-out). Line spans `canvasWidth * 0.24` centered. Percentage label fades in at end. |

**Bar geometry:**
```typescript
const barBottom = abFinalY - canvasWidth * 0.032;   // just above the A/B labels
const barTop = canvasHeight * 0.16;                  // near top of canvas
const barMaxHeight = barBottom - barTop;
const barWidth = canvasWidth * 0.038;

// Threshold line Y position:
const thresholdY = barBottom - (threshold * barMaxHeight);

// A bar center X: aFinalX (left of center pair)
// B bar center X: bFinalX (right of center pair)
```

**End state of Beat 1:** Skeleton gone. A and B labels at bottom center. Empty bar tracks visible. Threshold line at its height with percentage label. Bars still empty. The audience sees how high the bar needs to reach but doesn't know the result.

### Beat 2: Verdict

**Trigger:** `ADVANCE_FROM_REVEAL` command from controller (repurposed — now triggers bar growth)

**Data source:** `VOTE_RESULT` event (already emitted by conductor when vote closes). The projector stores this data and uses it when Beat 2 fires. Fields needed: `votesA`, `votesB`, `totalVotes`, `winner`, `consensus` (winning proportion).

Also uses `THRESHOLD_CHECK` event: `winningProportion`, `threshold`, `passed`.

**Animation timeline (from trigger, ~3.5s total):**

| Time | Animation |
|---|---|
| 0–1600ms | Both bars grow upward simultaneously (ease out). A bar height = `propA * barMaxHeight`. B bar height = `propB * barMaxHeight`. Winner's bar is brighter (alpha 0.4), loser's bar is dim (alpha 0.12). |
| 500ms | Percentage labels begin fading in above each bar |
| 800ms | Winner label brightens, loser label dims (A/B text below bars) |
| 1600ms | Bars reach final height. If failed: threshold line turns red. |
| 1600–2100ms | Verdict text fades in above bars: "THRESHOLD MET" (amber, pulsing) or "DOUBT OVERWHELMS" (red, trembling) |
| After verdict | System auto-advances: `lockInLayer()` or `collapseAttempt()` fires. Projector transitions back to skeleton view for next layer (or collapse state). |

**After pass (lock-in):** The projector transitions back to the skeleton view. The newly locked-in nodes are now in "filled" state. The next layer's nodes become "active." A/B labels return to their side positions for the next audition.

**After fail (collapse):** The skeleton reappears but with the collapsed layer's nodes showing cracked/broken state. Unreached nodes remain empty. The collapse audio effect plays. System transitions to next attempt or finale.

---

## 4. Finale: Live mix

**When:** `showPhase === 'finale_live_mix'`

### Visual changes from song-building

- **Each node independently colored** by which chapter's fragment is the active majority: amber (Ambition), coral (Love), teal (Avoidance)
- **No A/B labels, no threshold bar**
- **Membranes more active** — higher displacement intensity, independent breathing rates per node
- **Bundle arcs removed** — nodes are independent in the finale (no longer grouped)
- **Center seed** becomes "THE LEAD" in white, representing the performer's live melody
- **Loop position ring** — a subtle circular progress indicator around the outside of the pentagon, completing one revolution per 8-bar loop (~16s at 120 BPM)

### Color transitions

When `ACTIVE_FRAGMENT_CHANGED` fires for a granular type, the corresponding node's color crossfades to the new chapter's color over ~1.5 seconds. Use linear interpolation between RGB values.

```typescript
// Chapter colors
const CHAPTER_COLORS = {
  ambition:  { r: 232, g: 167, b: 53 },   // amber/gold
  love:      { r: 224, g: 96,  b: 112 },   // coral/rose
  avoidance: { r: 69,  g: 176, b: 144 },   // teal/green
};
```

### Data source

The `mix_state` socket event (~4 Hz) provides:
- `activeFragments`: Map of granularType → fragmentId
- Each fragment has a `chapter` field indicating which song it came from

The projector maps fragmentId → chapter → color for each node.

---

## 5. State management

### Projector visual state (client-side only)

```typescript
interface ProjectorVisualState {
  // Current rendering mode
  mode: 'dark' | 'skeleton' | 'stakes' | 'verdict' | 'finale';
  
  // Skeleton state
  nodes: {
    [granularType: string]: {
      state: 'empty' | 'active' | 'filled' | 'collapsed' | 'finale';
      color: { r: number; g: number; b: number };
      targetColor: { r: number; g: number; b: number };  // for crossfade
      colorProgress: number;  // 0-1 for crossfade
      lockedOption: 'A' | 'B' | null;  // which option won (for amplitude lookup)
    };
  };
  
  // Audition state
  currentAuditionOption: 'A' | 'B' | null;
  activeGroup: string | null;  // 'bones' | 'flesh' | 'spark'
  currentAttemptIndex: number;
  
  // Reveal state
  revealBeat: 'none' | 'stakes' | 'verdict';
  revealStartTime: number;
  voteResult: VoteResult | null;  // stored when VOTE_RESULT fires, used in verdict
  thresholdCheck: { threshold: number; passed: boolean } | null;
  
  // Labels
  labelA: string;  // sound descriptor for option A
  labelB: string;  // sound descriptor for option B
  
  // Timing (from audition_progress or mix_state socket events)
  loopPosition: number;  // 0.0–1.0, updated at ~4 Hz from server
  
  // Finale state
  activeFragments: { [granularType: string]: { songIndex: number; option: string; chapter: Chapter } } | null;
}
```

### Event → visual state mapping

| Conductor Event | Visual State Change |
|---|---|
| `SHOW_PHASE_CHANGED` → `attempt_build` | mode = 'skeleton', reset nodes for new attempt |
| `LAYER_PHASE_CHANGED` → `auditioning` | Set active nodes based on layer group, A/B labels appear |
| `AUDITION_OPTION_CHANGED` | Update `currentAuditionOption` (also affects amplitude lookup) |
| `LAYER_PHASE_CHANGED` → `revealing` | No immediate visual change (wait for REVEAL_STAKES) |
| `VOTE_RESULT` | Store result data (don't render yet) |
| `THRESHOLD_CHECK` | Store threshold data (don't render yet) |
| `REVEAL_STAKES_SHOWN` | mode = 'stakes', start Beat 1 animation |
| `LAYER_LOCKED_IN` | After verdict animation: mode = 'skeleton', update node to 'filled', set `lockedOption` |
| `ATTEMPT_COLLAPSED` | After verdict animation: update collapsed/unreached nodes |
| `SHOW_PHASE_CHANGED` → `finale_live_mix` | mode = 'finale', set all nodes to 'finale' state |
| `ACTIVE_FRAGMENT_CHANGED` | Start color crossfade on the affected node, update amplitude lookup key |
| `audition_progress` (socket event, ~4 Hz) | Update `loopPosition` (drives amplitude lookup during song-building) |
| `mix_state` (socket event, ~4 Hz) | Update `loopPosition`, active fragments per node (drives amplitude lookup during finale) |

---

## 6. Rendering architecture

### Component structure

```
app/projector/page.tsx
  └── ProjectorCanvas.tsx        // New: single Canvas 2D component
        ├── useProjectorState.ts  // New: visual state management hook  
        ├── useShowState.ts       // Existing: conductor state subscription
        ├── useAmplitudeData.ts   // New: loads amplitude-data.json, provides lookup function
        └── renderers/            // New: pure drawing functions
              ├── skeleton.ts     // drawSkeleton(), drawNode(), drawSeed()
              ├── audition.ts     // drawABLabels(), drawAuditionState()
              ├── reveal.ts       // drawStakes(), drawVerdict()
              ├── finale.ts       // drawFinaleNodes(), drawLoopRing()
              └── shared.ts       // smoothNoise(), rgb(), ease(), drawMembrane(), getAmplitude()
```

### Render loop

```typescript
// In ProjectorCanvas.tsx
useEffect(() => {
  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');
  
  function render(time: number) {
    const t = time * 0.001;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#090909';
    ctx.fillRect(0, 0, W, H);
    
    drawHeader(ctx, visualState, t);
    
    switch (visualState.mode) {
      case 'dark':
        break;  // just the dark background
      case 'skeleton':
        drawSkeleton(ctx, visualState, t, 1);  // full alpha
        drawABLabels(ctx, visualState, t);
        break;
      case 'stakes':
        const stakesProg = (time - visualState.revealStartTime);
        const skelAlpha = 1 - ease(stakesProg / 600);
        drawSkeleton(ctx, visualState, t, skelAlpha);
        drawStakes(ctx, visualState, t, stakesProg);
        break;
      case 'verdict':
        const verdictProg = (time - visualState.revealStartTime);
        drawVerdict(ctx, visualState, t, verdictProg);
        break;
      case 'finale':
        drawFinaleNodes(ctx, visualState, t);
        drawLoopRing(ctx, visualState, t);
        break;
    }
    
    requestAnimationFrame(render);
  }
  
  requestAnimationFrame(render);
}, [visualState]);
```

### Membrane drawing function

The membrane has two layers of displacement: a **noise layer** (organic ambient motion) and an **amplitude layer** (reactive to the audio playing through that node's tracks). The amplitude layer makes each node's membrane feel like it's *containing* its sound — bass nodes pulse with slow heavy displacement, drums stutter with sharp rhythmic hits, FX shimmer erratically.

```typescript
function drawMembrane(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  baseRadius: number,
  color: { r: number; g: number; b: number },
  alpha: number,
  noiseIntensity: number,  // 0.03 (subtle) to 0.15 (active)
  amplitude: number,       // 0.0–1.0 from RMS data, modulates displacement
  time: number,
  seed: number  // unique per node for phase offset
) {
  // Amplitude modulates both the noise intensity and the base radius
  const ampScale = 1 + amplitude * 0.15;           // radius grows up to 15% with amplitude
  const ampNoise = noiseIntensity + amplitude * 0.1; // displacement increases with amplitude
  const effectiveRadius = baseRadius * ampScale;
  
  const segments = 48;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const noise = smoothNoise(
      Math.cos(angle) * 3,
      Math.sin(angle) * 3,
      time * 1.2 + seed
    );
    const dist = effectiveRadius * (1 + noise * ampNoise);
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  
  // Alpha also responds to amplitude — louder = more visible membrane
  const ampAlpha = alpha * (1 + amplitude * 0.3);
  ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${ampAlpha * 0.15})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${ampAlpha * 0.5})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function smoothNoise(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.7 + t * 0.8) * 0.3 +
    Math.sin(y * 2.3 + t * 0.6) * 0.3 +
    Math.sin((x + y) * 1.1 + t * 1.2) * 0.2 +
    Math.sin(x * 3.1 - t * 0.4) * 0.2
  );
}
```

### Audio-reactive amplitude data

Each node's membrane responds to the RMS amplitude of its active audio tracks. Two approaches are supported — pre-extracted data is the primary path; real-time OSC is an optional enhancement.

#### Approach A: Pre-extracted RMS data (recommended)

Export per-bar RMS amplitude envelopes from Ableton for each track/clip. Store as JSON arrays in config files alongside the show config. The projector looks up the current value based on loop position.

**Export process:**
1. In Ableton, solo each track and render the 8-bar clip
2. Use a script (Python with `librosa` or similar) to extract RMS amplitude at regular intervals — recommend **64 samples per 8-bar loop** (8 per bar), giving ~250ms resolution at 120 BPM
3. Normalize each track's RMS array to 0.0–1.0 range
4. Store in config

**Data format:**

```typescript
// In config/amplitude-data.json
interface AmplitudeData {
  // Keyed by track identifier: "{songIndex}-{granularType}-{option}"
  [trackKey: string]: number[];  // Array of 64 normalized RMS values (0.0–1.0)
}

// Example entries:
{
  "0-bass-A":    [0.0, 0.1, 0.8, 0.9, 0.7, 0.3, 0.1, 0.0, ...],  // 64 values — bass hits hard on beats
  "0-bass-B":    [0.2, 0.4, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, ...],
  "0-drums-A":   [0.9, 0.1, 0.5, 0.1, 0.9, 0.1, 0.5, 0.1, ...],  // drums have sharp transients
  "0-pad-A":     [0.4, 0.4, 0.5, 0.5, 0.5, 0.5, 0.4, 0.4, ...],  // pad is sustained, gentle variation
  "0-fx-A":      [0.0, 0.0, 0.2, 0.8, 0.3, 0.0, 0.1, 0.9, ...],  // fx is unpredictable
  "0-melody-seed": [0.3, 0.5, 0.7, 0.4, 0.6, 0.8, 0.3, 0.2, ...], // seed melody
  // ... entries for all songs, types, and options
}
```

**Lookup at render time:**

```typescript
// The server already tracks loop position via beat callbacks from Ableton.
// Loop position is available on the projector via:
// - audition_progress socket event (~4 Hz during song-building)
// - mix_state socket event (~4 Hz during finale)
// Both include loopPosition (0.0–1.0)

function getAmplitude(
  amplitudeData: AmplitudeData,
  trackKey: string,       // e.g., "0-bass-A"
  loopPosition: number    // 0.0–1.0 from server
): number {
  const samples = amplitudeData[trackKey];
  if (!samples || samples.length === 0) return 0;
  
  // Interpolate between nearest samples for smooth animation
  const floatIndex = loopPosition * (samples.length - 1);
  const low = Math.floor(floatIndex);
  const high = Math.min(low + 1, samples.length - 1);
  const frac = floatIndex - low;
  return samples[low] * (1 - frac) + samples[high] * frac;
}
```

**Which tracks are active per node at any moment:**

During song-building:
- Empty nodes: amplitude = 0 (no audio playing)
- Active nodes (auditioning): use the currently auditioned option's track key (e.g., `"0-bass-A"` when option A is playing)
- Filled nodes (locked in): use the winning option's track key
- Seed node: always uses the seed track key (e.g., `"0-melody-seed"`)

During finale:
- Each node uses the active fragment's track key (determined by `mix_state.activeFragments`)
- Seed/center node: could respond to a live audio input level if available, otherwise use the seed track with highest amplitude across songs as a default

**Serving:** Load `amplitude-data.json` once at projector startup. It's static data — no runtime extraction needed. File size is small (64 floats × ~30 tracks × 4 bytes ≈ ~8KB).

#### Approach B: Real-time RMS via OSC (optional enhancement)

AbletonOSC supports querying track output meters in real time. This would give true live amplitude rather than pre-baked data, and would capture the performer's live playing in the seed node.

**OSC messages (if supported by AbletonOSC version):**

```
Server → Ableton: /live/track/get/output_meter/left  trackIndex
Ableton → Server: /live/track/get/output_meter/left  trackIndex  level (0.0–1.0)
```

**Data flow:**
```
Ableton → OSC (UDP) → Server (osc.ts) → amplitude_update socket event → Projector
```

**New socket event:**
```typescript
| 'amplitude_update' | { levels: { [granularType: string]: number } } | Projector only (~15-30 Hz) |
```

**Trade-offs:**
- Pro: True to the actual audio, captures live performance, no pre-extraction step
- Pro: The seed/center node can react to the performer's live melody
- Con: Higher bandwidth — needs 15-30 Hz updates for smooth membrane animation
- Con: Depends on AbletonOSC meter support (verify with your plugin version)
- Con: Adds latency: Ableton → OSC → server → WebSocket → projector (~20-50ms)
- Con: Only available when OSC_ENABLED=true (not in fallback mode)

**Recommendation:** Start with Approach A (pre-extracted). It works in fallback mode, requires no real-time data pipeline, and the visual result is nearly indistinguishable — the audience doesn't know whether the membrane is reacting to live audio or pre-baked amplitude. Add Approach B later if you want the seed node to react to the performer's live playing, which is the one case where pre-extracted data can't work.

**Hybrid approach:** Use pre-extracted data for all audience-controlled nodes (the audio is loops, so pre-extracted is perfectly accurate). Use real-time OSC meters only for the center seed node during the finale when the performer is playing live. This gives you the best of both with minimal real-time data flow (one channel at ~15 Hz instead of six).

#### Amplitude extraction script

Place in `server/tools/extract-amplitude.py`:

```python
"""
Extract per-bar RMS amplitude from Ableton clip renders.
Usage: python extract-amplitude.py path/to/renders/ --output config/amplitude-data.json

Expects files named: {songIndex}-{granularType}-{option}.wav
Example: 0-bass-A.wav, 1-drums-B.wav, 0-melody-seed.wav
"""

import librosa
import numpy as np
import json
import sys
from pathlib import Path

SAMPLES_PER_LOOP = 64  # 8 per bar × 8 bars

def extract_rms(audio_path: str, n_samples: int = SAMPLES_PER_LOOP) -> list[float]:
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    hop = len(y) // n_samples
    rms = librosa.feature.rms(y=y, frame_length=hop, hop_length=hop)[0][:n_samples]
    # Normalize to 0-1
    max_val = rms.max()
    if max_val > 0:
        rms = rms / max_val
    return [round(float(v), 3) for v in rms]

def main():
    render_dir = Path(sys.argv[1])
    output_path = sys.argv[3] if len(sys.argv) > 3 else 'config/amplitude-data.json'
    
    data = {}
    for f in sorted(render_dir.glob('*.wav')):
        key = f.stem  # e.g., "0-bass-A"
        print(f'Extracting: {key}')
        data[key] = extract_rms(str(f))
    
    with open(output_path, 'w') as out:
        json.dump(data, out, indent=2)
    print(f'Wrote {len(data)} tracks to {output_path}')

if __name__ == '__main__':
    main()
```

#### Integration with the render loop

In the render loop, each node lookup becomes:

```typescript
// In skeleton.ts / finale.ts when drawing a node
const trackKey = getActiveTrackKey(node.id, visualState);  // e.g., "0-bass-A"
const amplitude = trackKey 
  ? getAmplitude(amplitudeData, trackKey, visualState.loopPosition)
  : 0;

drawMembrane(ctx, nx, ny, nodeRadius * 1.5, color, alpha, noiseIntensity, amplitude, t, seed);
```

The `getActiveTrackKey` function maps the current visual state to the correct amplitude data key:

```typescript
function getActiveTrackKey(
  granularType: string,
  state: ProjectorVisualState
): string | null {
  if (state.mode === 'finale') {
    // Look up active fragment for this type from mix_state
    const fragment = state.activeFragments?.[granularType];
    if (!fragment) return null;
    return `${fragment.songIndex}-${granularType}-${fragment.option}`;
  }
  
  if (state.mode === 'skeleton') {
    const nodeState = state.nodes[granularType];
    if (nodeState.state === 'filled') {
      // Use the locked-in winner
      return `${state.currentAttemptIndex}-${granularType}-${nodeState.lockedOption}`;
    }
    if (nodeState.state === 'active' && state.currentAuditionOption) {
      // Use whichever option is currently being auditioned
      return `${state.currentAttemptIndex}-${granularType}-${state.currentAuditionOption}`;
    }
  }
  
  return null;  // empty or collapsed — no amplitude
}
```
---

## 7. Controller changes

### New controller buttons (VotingControls.tsx)

Add to the song-building section of the controller:

```
[Close Voting]     — existing, fires CLOSE_VOTING
[Show Stakes]      — NEW, fires REVEAL_STAKES, enabled when phase === 'revealing'
[Reveal Votes]     — modified, fires ADVANCE_FROM_REVEAL, enabled after stakes shown
```

### New conductor command

In `conductor/conductor.ts`, handle `REVEAL_STAKES`:
- Validates that current phase is `revealing`
- Emits `REVEAL_STAKES_SHOWN` event with attemptIndex, layerIndex, threshold value
- Does NOT change the conductor phase (stays in `revealing`)

The existing `ADVANCE_FROM_REVEAL` command now serves as the Beat 2 trigger. Its behavior is unchanged — it calls `lockInLayer()` or `collapseAttempt()` based on the threshold check result. The projector plays the verdict animation and the conductor advances.

### Updated socket events

Add to server → client events:

```typescript
| 'reveal_stakes' | { attemptIndex, layerIndex, threshold } | Projector + Audience |
```

---

## 8. Implementation phases

### Phase 1: Canvas skeleton + audition
1. Create `ProjectorCanvas.tsx` — single canvas element, fullscreen, dark background
2. Implement `renderers/shared.ts` — noise function, membrane drawing (with amplitude parameter, default 0), color utilities
3. Implement `renderers/skeleton.ts` — pentagon layout, node rendering (all states), seed, connectors, bundle arcs
4. Implement `renderers/audition.ts` — A/B label positioning, cycling glow, "NOW PLAYING" indicator
5. Wire to `useShowState` — map conductor state to visual node states
6. Test: verify skeleton renders correctly for all 3 layer groups across all 3 songs (stagger table)

### Phase 2: Two-beat reveal
1. Add `REVEAL_STAKES` command to conductor
2. Add `reveal_stakes` socket event
3. Add controller buttons (Show Stakes, Reveal Votes)
4. Implement `renderers/reveal.ts` — stakes animation (skeleton fade, AB slide, threshold line), verdict animation (bar growth, pass/fail)
5. Implement `useProjectorState` — track reveal beat, store vote result for deferred rendering
6. Test: verify all threshold values (0.50 pass, 0.66 fail, 0.99 fail) render correctly

### Phase 3: Collapse + lock-in transitions
1. Implement transition from verdict back to skeleton (lock-in: new node fills in)
2. Implement collapse state rendering (cracked nodes, broken state)
3. Implement transition from collapse to next attempt's skeleton
4. Test: verify fragment generation from collapsed vs completed attempts

### Phase 4: Audio-reactive membranes
1. Create `server/tools/extract-amplitude.py` — RMS extraction script
2. Render each Ableton clip to WAV, run extraction, generate `config/amplitude-data.json`
3. Create `useAmplitudeData.ts` — loads JSON at startup, exposes `getAmplitude(trackKey, loopPosition)` 
4. Create `getActiveTrackKey()` in `renderers/shared.ts` — maps current visual state to the correct amplitude data key
5. Wire `loopPosition` from `audition_progress` and `mix_state` socket events into visual state
6. Pass amplitude values to `drawMembrane()` calls in skeleton and finale renderers
7. Test: verify each granular type's membrane responds differently (bass = slow/heavy, drums = sharp/rhythmic, pad = smooth/sustained, fx = erratic)
8. Optional: add real-time OSC meter for the center seed node during finale (hybrid approach)

### Phase 5: Finale live mix
1. Implement `renderers/finale.ts` — independent node colors, color crossfades, loop ring
2. Wire to `mix_state` socket event — map active fragments to chapter colors per node
3. Remove bundle arcs in finale mode
4. Implement center seed → "THE LEAD" transition
5. Test: verify color crossfades when majority shifts

### Phase 6: Polish
1. Tune animation timing curves
2. Tune membrane noise intensity and amplitude scaling per granular type
3. Add collapse audio effect synchronization
4. Responsive canvas sizing
5. Performance optimization (offscreen canvas for membranes if needed)

---

## 9. Design decisions from this session (for context)

These decisions were made during the design brainstorm and should be treated as authoritative for the projector implementation:

1. **Melody is the live seed**, always present, not part of the flesh layer group. Flesh = harmony + pad. The audience controls 5 granular types, not 6 (bass, drums, pad, harmony, fx). Whether melody becomes a 6th audience-controlled type in the finale is an open question — design should accommodate either.

2. **The projector shows only majority winners in the finale** — no vote distribution or consensus strength visualization per node. Just whichever fragment won.

3. **The reveal is two manually-triggered beats** — the performer controls the pacing between showing the threshold (stakes) and showing the vote result (verdict). This is a deliberate theatrical choice.

4. **The triangle controller concept was rejected** for the audience phone UI — too abstract for lay users. Tappable cards with visible group vote distribution is the direction for phones.

5. **Chapter colors are not labeled during the show.** The audience doesn't see "Ambition," "Love," "Avoidance" — they just see colors. The chapter names become meaningful only in retrospect (if at all).

6. **The skeleton shape (pentagon) is the foundational visual element** that the audience learns through repetition across three songs and then sees transformed in the finale.

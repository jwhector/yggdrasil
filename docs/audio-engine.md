# Audio Engine, Musical Design & Ableton Integration

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (collapse/rejection audio), [finale.md](finale.md) (ceremony audio activation, performer mix)

---

## Musical Design Specification

### Shared Compatibility Universe

All fragments across all three songs share:
- **Key:** B minor (B natural minor scale: B, C#, D, E, F#, G, A)
- **BPM:** Configurable per layer per song in `default-show.json` (default: 120 BPM for all 3 layers). All fragments must sound good across their song's full tempo range.
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
- **Harmonically neutral** (Drums, FX): no pitched content or heavily filtered. Compatible with everything.

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
- **FX:** Extremes and gaps. Very high shimmer, very low rumble, or sweeping through spectrum.

### Production Guidelines

- **Bar 1 is sacred:** clean downbeat, no fills bleeding across the loop point. All fragments must re-sync cleanly at bar 1.
- **Bars 7–8 are free:** variations, fills, builds, resolving phrases. This gives each loop a sense of "going somewhere."
- **Use silence:** fragments with rhythmic holes allow other fragments to shine through when combined.
- **Velocity dynamics:** vary note velocities within each 8-bar loop. Louder on downbeats, softer on offbeats. Slight crescendo toward bar 5.
- **Micro-timing/swing:** use Ableton's groove pool. Different swing amounts per song for differentiation.
- **Timbre evolution:** automate one parameter per fragment across 8 bars (filter opening, reverb swell, chorus depth).
- **Reverb discipline:** reverb on melody, harmony, FX. Keep bass and drums dry or nearly dry.

### Audio Preview Production

Each fragment clip must be exported as a standalone audio file for in-browser preview:
- **Format:** mp3, 128kbps (adequate quality for phone speakers; small file size for fast loading)
- **Duration:** 4–8 bars recommended. Full 8-bar loop acceptable. Shorter excerpts encourage turn-taking during group deliberation.
- **Naming:** `preview-{songIndex}-{layerIndex}-{option}.mp3` (e.g., `preview-0-2-A.mp3`)
- **Content:** Should start cleanly on bar 1 and ideally loop well, though looping is not required for preview purposes
- **Total file count:** Up to 18 files (3 songs × 3 layer groups × 2 options), though only available fragments will be loaded by clients

---

## Audio Engine & Ableton Integration

### Track Layout (V3.2 — Config-Driven)

**No formula.** Track indices are defined explicitly per option per granular type in `config/default-show.json`. Each layer group option is a `TrackBundle` containing one or more `GranularTrackRef` entries with explicit `trackIndex` values.

**Song-building tracks:** Each song has:
- **Live seed tracks**: 3 tracks per song (e.g., Song 0 = tracks 0–2)
- **Layer group tracks**: Multiple tracks per option per group (e.g., bones option A = bass track + drums track)
- Total track count depends on the Ableton session layout

**Example from default config** (Song 1):
- Live seed: tracks 0, 1, 2
- bones/optionA: bass=track 3, drums=track 4
- bones/optionB: bass=track 5, drums=track 6
- flesh/optionA: melody=track 7, pad=track 8, harmony=track 9
- flesh/optionB: melody=track 10, pad=track 11, harmony=track 12
- spark/optionA: fx=track 13
- spark/optionB: fx=track 14

**Live performance tracks** (beyond song-building indices): vocal mic, live synth, etc. Not part of the fragment system. Controlled only by the performer.

**Collapse/rejection effects:** Return tracks with configurable effects triggered via OSC. Index configured in `config/ableton-layout.json`.

### Playback Modes

**Song-building (V3.2 — TrackBundle):**
- Live seed: unmute seed tracks at `attempt_build` start; mute on collapse/rejection
- Audition: iterate all tracks in the TrackBundle — unmute/swell current option, fade/mute other option
- Lock-in: swell all tracks in winner TrackBundle, fade all tracks in loser TrackBundle
- Stack accumulates: previously locked layer group tracks stay unmuted

**Collapse:**
- Triggered when doubt threshold is not met
- Collapse effect activates on return track (distortion, filter sweep, reverb tail)
- Rapid fade or filter sweep on all active tracks for this attempt
- After gesture completes, mute all tracks for the collapsed attempt

**Song rejection:**
- Triggered via controller for completed songs only
- Rejection effect on return track activates (TBD: distinct from collapse effect — configurable)
- After effect completes, all tracks for this attempt are muted

**Finale — Ceremony lock-in:**
- Each altar lock-in: unmute the chosen fragment's track, quantized to next bar boundary
- Fade in per `GainConfig.ceremonySwellBeats` (e.g., ~2 bars)
- Layers accumulate: previously locked ceremony layers stay unmuted

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
| `/live/song/start_listen/tempo` | - | Subscribe to tempo changes |
| `/live/song/stop_listen/tempo` | - | Unsubscribe from tempo changes |
| `/live/song/set/tempo` | `bpm` | Set global tempo (per-layer, at audition start) |
| `/live/song/get/tempo` | - | Query current tempo |
| `/live/song/get/is_playing` | - | Query transport state |
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
| `/live/song/get/tempo` | `bpm` | Current tempo (on query or change) |
| `/live/song/get/is_playing` | `isPlaying` | Transport state (1 = playing, 0 = stopped) |

### Fallback Mode (No Ableton)

Unchanged from V1. Timing engine uses JS timers; audio cues are logged but not sent.

### Static Audio Preview Files

Pre-rendered audio files (mp3/ogg) for each fragment clip, exported from Ableton and served statically by the Next.js server. Used during the finale for in-browser playback on audience phones.

**File naming convention:** `preview-{songIndex}-{layerIndex}-{option}.mp3` (e.g., `preview-0-2-A.mp3`)

**Serving:** Static files from `public/audio/previews/` directory, served via Next.js static file handling.

**Production step:** Render each Ableton clip as a short audio file (4–8 bars recommended; full 8-bar loop acceptable). Export at 128kbps mp3 for minimal file size while maintaining adequate quality for phone speakers in a noisy room.

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

COLLAPSE_ANIMATION_MS=5000

# Finale — Assembly
ASSEMBLY_TIMER_MS=60000
ASSEMBLY_GRACE_PERIOD_MS=15000

# Finale — Deliberation
DELIBERATION_TIMER_MS=120000
AMBASSADOR_VOLUNTEER_TIMER_MS=15000

# Finale — Ceremony
CEREMONY_LAYER_ORDER=bass,drums,pad,melody,harmony,fx

# Audio Previews
AUDIO_PREVIEW_PATH=/audio/previews
```

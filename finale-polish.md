# Quilt Arc System — Sorting & Playback Spec

## Context

This document describes the automated sorting and playback arc for the V3.3 "Quilt" finale. Read `docs/finale.md` (or `FINALE-V3.3-SPEC.md`) first for the full quilt model. This doc covers what happens AFTER the audience has created their grid and locked in their song choices.

## The Grid

- 6 rows = granular types (drums, bass, melody, harmony, pad, fx)
- N columns = time slices
- Column count scales with audience size: `ceil(audienceCount / 6)`, capped by config
- Each cell holds a song choice (0, 1, or 2) corresponding to a chapter (Ambition, Love, Avoidance), or is **empty** (no owner)
- Track resolution: `trackMap[granularType][songIndex] → Ableton trackIndex`

### Cell Size Threshold

Cell size (bars per cell) changes based on column count to keep grid loop duration in a musical sweet spot:

- **Below 4 columns:** Full Ableton loop per cell (8 bars). Keeps the grid loop substantive — with only 2-3 columns, half-loop cells would make the grid loop too short to register.
- **4+ columns:** Half Ableton loop per cell (4 bars). Prevents the grid loop from dragging — with many columns, full-loop cells would make the raw playback too long.

The threshold (default: 4) and cell sizes are configurable.

| Audience | Columns | Cell size | Grid loop duration |
|----------|---------|-----------|-------------------|
| 6 | 1 | 8 bars | 8 bars |
| 12 | 2 | 8 bars | 16 bars |
| 18 | 3 | 8 bars | 24 bars |
| 24 | 4 | 4 bars | 16 bars |
| 30 | 5 | 4 bars | 20 bars |
| 36 | 6 | 4 bars | 24 bars |
| 48 | 8 | 4 bars | 32 bars |

### Empty Cells

When audience count isn't a clean multiple of 6, the grid has empty cells (no owner, no song choice). For example, 19 people = 4 columns × 6 rows = 24 cells, 5 empty.

**Empty cells are silence.** They are valid grid members, not errors. During playback, an empty cell means that granular type is silent during that time slice.

**Empty cells in the sorting algorithm:** Treated as **zero energy** — below even the lowest energy song. During sorting, empty cells naturally migrate to the cool-down zone (zone 3 in single-pass, final pass in multi-pass). This thins the texture exactly where you want it thin, creating natural breathing room in the wind-down. The algorithm should not fill empty cells with random content — silence is a compositional choice.

## Song Energy Profiles

The three songs have inherent energy levels based on their musical content:

- **Song 0 — Ambition:** Highest energy. Driving drums, intense bass, bright melody.
- **Song 1 — Love:** Medium energy. Spacious, breathing, warm.
- **Song 2 — Avoidance:** Lowest energy. Sparse, evasive, dark/low with airy highs.

These energy values should be configurable but the defaults reflect the existing musical material.

## Playback Arc Timeline

The entire finale playback is automated — no performer input required during the arc. The performer plays live instruments over the top. The timeline has four phases:

### 1. Entry (staggered unmute)

Rows unmute in pairs over 2-3 Ableton loops (16-24 bars). Entry order follows energy contribution — foundation first, texture last:

- Ableton loop 1: drums + bass
- Ableton loop 2: melody + harmony  
- Ableton loop 3: pad + fx

Each pair unmutes at the start of an 8-bar Ableton loop boundary. The grid playhead is running during entry — the audience hears the song assembling as rows appear. Rows waiting to enter should be visually indicated on the projector (pulsing, dimmed, "coming in..." state) so audience members assigned to those rows know they haven't been forgotten.

The entry schedule is configurable (which rows group together, how many Ableton loops).

### 2. Raw Playback (1 grid loop)

The full unmodified audience composition plays through once. All 6 rows active. The playhead sweeps through every column. This is the moment where the audience hears exactly what they collectively created — no algorithmic intervention.

Always exactly 1 grid loop. Duration = `columns × barsPerCell` (where barsPerCell is 8 or 4 depending on cell size threshold).

### 3. Sort + Sorted Playback

After the raw grid loop completes, the system automatically sorts the grid and plays the sorted version. The sort happens instantly between grid loops — the projector animates cells sliding to new positions during the transition.

**Two modes, auto-selected based on grid loop duration:**

The sort mode threshold should be based on grid loop duration (columns × barsPerCell), not just column count, since cell size affects how much horizontal space is available. Default threshold: **16+ bars uses single-pass, below 16 bars uses multi-pass.**

#### Single-pass mode (grid loop ≥ 16 bars)

Enough horizontal space to contain a full energy arc in one grid loop. The algorithm divides the columns into three zones:

- **Zone 1 (opening ~third):** Medium energy. Moderate variety, some coherence. Favors Song 1 (Love) in rhythm section rows.
- **Zone 2 (middle ~third):** High energy. Dense, driving. Consolidates drums and bass into runs of Song 0 (Ambition). Tries for vertical column unity where possible.
- **Zone 3 (final ~third):** Cool down. Warm, gentle. Favors Song 2 (Avoidance). Can introduce muted cells for breathing room.

Within each zone, the algorithm consolidates rows in priority order (drums first, then bass, then melody, etc.). Higher priority rows get better grouping; lower priority rows absorb the fragmentation.

The sorted grid plays through once (1 grid loop).

#### Multi-pass mode (grid loop < 16 bars)

Not enough horizontal space for an arc in one pass. Instead, the algorithm re-sorts the grid between each grid loop, targeting a different energy level each pass:

- Pass 1: Medium energy sort (Song 1 favored)
- Pass 2: High energy sort (Song 0 favored, maximum consolidation)
- Pass 3: Cool down sort (Song 2 favored)

Each pass = 1 grid loop. Re-sort happens instantly between loops with animated cell transitions on the projector. The arc plays out across multiple short loops instead of one long one.

The number of passes and their energy targets are configurable.

#### Sorting algorithm design notes

- **The algorithm reorders cells, it never changes song choices.** Every audience choice survives. Sorting is sequencing, not overriding.
- **Row priority determines consolidation order.** The highest priority row gets the best grouping. Lower priority rows fill remaining gaps.
- **"Consolidation" means grouping same-song cells into runs.** A row with [1, 0, 1, 0] sorted becomes [1, 1, 0, 0]. Longer runs = more musical coherence for that instrument.
- **Vertical unity is a secondary goal.** When breaking ties or placing orphans, favor positions where the cell matches other cells in the same column. A full column of the same song = all instruments playing the same chapter simultaneously, which is a powerful moment.
- **Cross-row movement is allowed during sorting.** A cell can move to a different row, which changes its instrument. The song choice travels with it. This is consistent with the quilt's core model.
- **Muting is allowed during sorting.** The algorithm can mute cells to create intentional silence in the cool-down zone. Muted cells should be visually distinct (dimmed, not removed) so the audience knows their choice still exists.
- **Empty cells are zero energy.** Empty cells (no owner, no song choice) sort as the lowest possible energy — below any song. They naturally migrate to cool-down zones and grid edges during sorting, creating breathing room where the arc wants it. The algorithm should never fill empty cells with random content.

### 4. Exit (staggered mute)

Rows mute in pairs over 2-3 Ableton loops. Reverse of entry — texture first, foundation last:

- Ableton loop 1: fx + pad
- Ableton loop 2: harmony + melody
- Ableton loop 3: drums + bass → silence

The exit schedule is configurable. Exit begins automatically after sorted playback completes.

## Total Duration

The arc auto-adjusts to audience size while landing in a consistent time window. Cell size switches from 8 bars to 4 bars at the column threshold (default: 4 columns).

| Audience | Columns | Cell size | Grid loop | Entry | Raw | Sorted | Exit | Total (approx at 120 BPM) |
|----------|---------|-----------|-----------|-------|-----|--------|------|--------------------------|
| 12 | 2 | 8 bars | 16 bars | 24 bars | 16 bars | 48 bars (3 passes) | 24 bars | ~3:44 |
| 18 | 3 | 8 bars | 24 bars | 24 bars | 24 bars | 72 bars (3 passes) | 24 bars | ~4:48 |
| 24 | 4 | 4 bars | 16 bars | 24 bars | 16 bars | 16 bars (1 pass) | 24 bars | ~2:40 |
| 30 | 5 | 4 bars | 20 bars | 24 bars | 20 bars | 20 bars (1 pass) | 24 bars | ~2:56 |
| 36 | 6 | 4 bars | 24 bars | 24 bars | 24 bars | 24 bars (1 pass) | 24 bars | ~3:12 |
| 48 | 8 | 4 bars | 32 bars | 24 bars | 32 bars | 32 bars (1 pass) | 24 bars | ~3:44 |

Target: ~2:30 to 4:00 total. Fits within the finale window. The 18-person case runs slightly long — this can be tuned by reducing multi-pass count from 3 to 2.

## Configuration

All arc behavior is pre-configured before the show. No live performer interaction with the arc system — the performer just plays over it.

Key config values needed:
- Cell size threshold (columns >= this use half-loop/4-bar cells, below use full-loop/8-bar cells; default: 4)
- Entry schedule (row pairs + timing)
- Exit schedule (row pairs + timing)
- Column threshold for single-pass vs multi-pass sort (default: 4 — note: should be based on grid loop duration ≥ 16 bars, not just column count, since cell size affects this)
- Multi-pass energy targets (array of energy values per pass)
- Song energy profiles (energy score per song)
- Row consolidation priority order
- Whether cross-row movement is allowed during sort
- Whether muting is allowed during sort (for cool-down zone)

## Projector Behavior

- During entry: rows light up as they unmute. Waiting rows pulse dimly.
- During raw playback: playhead sweeps left to right. All cells show chapter color.
- During sort transition: cells animate sliding to new positions. Brief transition between grid loops.
- During sorted playback: same as raw but with new arrangement.
- During exit: rows dim and go silent as they mute.

## Relationship to Performer Remix

The arc system is the DEFAULT automated behavior. The performer remix controls (manual column reorder, cell swap, lock, mute) described in `docs/finale.md` are SEPARATE and can coexist — the performer could manually adjust things after the automated arc, or the manual controls could be disabled entirely if the automated arc is sufficient. The arc is designed to work without any performer intervention so the performer can focus entirely on playing live.
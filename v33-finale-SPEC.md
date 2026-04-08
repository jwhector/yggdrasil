# Finale System — Detailed Mechanics (V3.3 — "The Quilt")

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (fragment generation rules), [data-models.md](data-models.md) (conductor commands/events)

---

## Overview

The finale has four sub-phases:
1. **Elegy** — audience observes the wreckage of all three songs
2. **Assignment** — each audience member claims a single cell in the quilt (row + column position)
3. **Preview** — room is silent; audience privately explores song options (Song 1/2/3) for their cell
4. **Playback & Remix** — the quilt plays through; audience and performer collaboratively rearrange cells in real time

## Core Concept: The Quilt

The finale song is represented as a **grid** (the "quilt"):
- **Rows** = granular types (bass, drums, pad, melody, harmony, fx) — 6 rows
- **Columns** = time slices along the 8-bar loop
- **Cells** = one person's assignment (one granular type × one time slice)

Each cell holds a **song choice** — Song 1 (Ambition), Song 2 (Love), or Song 3 (Avoidance). The cell's grid position determines everything else: the row tells the system which granular type, and the song choice tells it which song's version to play. So `row=bass, songChoice=2` resolves to "Song 2's bass track" in Ableton. The cell is visually just a **chapter color** — amber, coral, or teal.

The completed quilt is a patchwork of chapter colors. The loop plays left to right, and at each column boundary the active tracks can change per type based on each cell's song choice. The audience sees the arrangement as a color pattern and hears it as a shifting collage of three songs' material.

### Scaling

Column count is derived from audience size:

| Audience | Columns | Bars per cell | Cells total |
|----------|---------|---------------|-------------|
| 6        | 1       | 8             | 6           |
| 12       | 2       | 4             | 12          |
| 24       | 4       | 2             | 24          |
| 36       | 6       | ~1.3 (→ use irregular splits or cap at 4 cols + overflow) | 36 |
| 48       | 8       | 1             | 48          |

**Minimum cell size: 1 bar.** Below 1 bar, fragment switches become inaudible.

**Overflow handling:** When audience size exceeds `6 × maxColumns`, extra users are assigned as **spectators** — they watch the quilt form and hear the result but don't own a cell. Alternatively, column count can be increased beyond 8 by extending the loop (e.g., 16-bar loop = up to 96 cells). This is configurable.

**Configuration:** See `QuiltConfig` in the Finale State section below.

## Narrative Setup

Unchanged from V3.2. After Song 3's resolution, the performer "abandons" the stage. NPC message: *"He's gone. We need to do this ourselves."* The finale is framed as the audience reassembling what the performer destroyed.

## Phase 1: Finale Elegy

Unchanged from V3.2. 10-15 second observational moment. Full fragment grid displayed. NPC narrates what survived and what was lost. No interaction.

## Phase 2: Assignment (Cell Claim)

Each audience member claims a single cell in the quilt. The quilt grid is displayed on both phones and projector.

### Self-Select Flow

1. The empty quilt grid appears — 6 rows × N columns. Each cell shows its granular type symbol and time slice label (e.g., "Bass — Bars 1-2").
2. Users tap a cell to claim it. Claimed cells show the claimer's presence (color fill or avatar dot). One cell per person.
3. Cells fill up in real time. Full cells are greyed out / unavailable.
4. **Soft constraint:** When a granular type row is full (all columns claimed), it visually closes. Users who haven't claimed yet are funneled toward open cells.
5. **Timer:** Configurable (default: 30 seconds). When it expires, unclaimed users are randomly assigned to remaining empty cells. Any cells still empty after all users are assigned remain empty (that time slice for that type will be silent — which is musically valid).
6. Users can switch cells freely before the timer expires (releasing their current cell).

### Auto Mode

System distributes users across cells round-robin. Instant, no interaction.

### Song Availability

Which songs are available as choices depends on what survived song-building. A song must have reached at least one layer (producing at least one locked-in result) to be available. In practice, all three songs will almost always be available since even a song that collapses at layer 1 still has its layer 0 result. The cell just stores a song index (0, 1, 2) — the system resolves the correct Ableton track via `granularType + songIndex → trackIndex` lookup from config.

**Track resolution:** Each cell's audio is determined by its current grid position plus its song choice:
```
trackIndex = config.trackMap[cell.row (granularType)][cell.songChoice (songIndex)]
```
This means a cell can move anywhere in the grid and always resolve correctly — the song choice travels with it, and the row it lands in determines which instrument plays.

## Phase 3: Preview (Sandbox)

**Room is silent.** No Ableton playback. Everyone privately explores their song options on their phone.

Each cell owner's phone shows:
- Their cell position in the quilt (type + time slice), highlighted in the mini grid
- 3 tappable cards — one per song/chapter (Ambition, Love, Avoidance), each showing the chapter color and label
- Tapping a card plays a **private audio preview** on the phone speaker — the mp3 preview file for that song's version of their cell's current granular type (resolved from row position)
- A "LOCK IN" button to commit their choice

**Preview duration:** Configurable timer (default: 20-30 seconds). Enough time to tap through 3 options and pick a favorite.

**Important boundary:** Once the preview phase ends and playback begins, **no more private previews.** This separation keeps the discovery phase clean and the performance phase consequential.

**Transition:** Preview ends when timer expires OR when all users have locked in (whichever comes first). Any user who hasn't locked in gets their most recently previewed song (or a random one if they previewed nothing).

## Phase 4: Playback & Performer Remix

### First Reveal

The quilt plays through for the first time. By default, **song choices are locked** after preview (configurable via `audienceRemix.allowSongChange`). The loop starts from column 1 and plays left to right. At each column boundary, the active tracks per type switch according to each cell's song choice. Everyone hears the collective composition for the first time simultaneously.

The projector shows the quilt with a **playhead** sweeping left to right, highlighting the current column. Each cell glows with its chapter color (amber/coral/teal). The audience sees and hears their creation unfold.

### Audience Remix

**Configurable via `audienceRemix` in QuiltConfig.** Can be fully disabled (`enabled: false`) for a performer-only remix experience, or tuned to taste.

When enabled, audience members can drag cells during playback:

- **Scope `own_cell`:** You can only move your own cell. Other cells are visible but not draggable.
- **Scope `any_cell`:** You can drag any cell to any position. More chaotic, more collaborative.
- **Same-row moves** change WHEN a song choice plays in the timeline
- **Cross-row moves** (when `allowCrossRowSwaps: true`) change WHICH INSTRUMENT plays that song choice (e.g., moving from bass to drums means your Song 2 choice now plays Song 2's drums instead of Song 2's bass)
- **Swapping:** If the destination cell is occupied, the two cells swap positions. Both owners see the swap reflected on their phones.
- **Cooldown:** Each user can only move a cell once per `cooldownLoops` loops (default: 1). Set to 0 for no cooldown.
- **Song change** (when `allowSongChange: true`): Audience can also change which song their cell plays during playback, not just its position. Default is false — song choice is locked after preview.
- **Changes take effect at the next loop boundary** (quantized).
- **Performer-locked cells** cannot be moved by the audience regardless of config.

### Performer Remix

The performer comes back to the stage. Their interface (on the controller) shows the full quilt grid. The performer can:

- **Reorder columns:** Drag a column to a new position. The loop now plays in the new order. Takes effect at the next loop boundary.
- **Swap any cells:** Drag any cell to any position (not limited to their own). Two cells trade positions.
- **Lock a cell:** Freeze a cell so it can't be moved by the audience or affected by column reorders.
- **Mute a cell:** Temporarily silence a cell (the type goes silent during that time slice).
- **Override a cell's song choice:** Force a specific song for a cell (emergency/creative tool).
- **Play live:** Live performance tracks (vocal, synth, etc.) layered over the quilt.

The audience watches on the projector as their quilt gets rearranged in real time — both by each other and by the performer. The performer is curating alongside the audience. The metaphor completes: the subconscious and the ego are collaborating, both reshaping the same material.

### Audio Behavior

- **Live seed / melody is a quilt row.** It is one of the 6 granular type rows (melody/seed), audience-controllable like all other types. Audience members can claim melody cells, choose a song, and move them around the grid like any other cell.
- **Track resolution:** At each column boundary, the system resolves each cell's audio via `config.trackMap[granularType][songIndex]`. This lookup is position-dependent — if a cell has been swapped to a new row, the new row's granular type is used with the cell's song choice.
- **Quantized changes:** All cell swaps and column reorders take effect at the next loop boundary.
- **Crossfade on column transitions:** When the playhead crosses a column boundary and the track for a type changes, a brief crossfade (configurable, default ~100ms) smooths the transition.
- **Silent cells:** If a cell is empty or muted, that granular type is silent during that time slice. This is musically valid — silence is part of the composition.
- **Ableton implementation:** At each column boundary, the system mutes/unmutes the appropriate tracks per type. Only one track per type is ever unmuted at a time within a column.

### Climax & Ending

The performer settles the quilt into its final arrangement. Optionally:
- The performer locks all cells (the arrangement is "finished")
- The quilt loops in its final form while the performer plays a closing live piece over it
- NPC final message (e.g., "This is what we sound like together.")
- Fade to end

## NPC System

Unchanged from V3.2. Event-driven messages at key moments + manual overrides from controller.

**Updated event keys:**
- `performer_abandonment`: "He's gone. We need to do this ourselves."
- `assignment_start`: "Pick up a piece."
- `preview_start`: "Learn your voice."
- `first_playback`: "Listen to what we built."
- `performer_returns`: "He's back. But now it's ours too."

## Finale State

```typescript
interface V33FinaleState {
  phase: 'elegy' | 'assignment' | 'preview' | 'playback';

  // Quilt structure
  quilt: {
    rows: number;                                 // Always 6 (granular types)
    columns: number;                              // Derived from audience size
    barsPerCell: number;                          // Derived: loopBars / columns
    cells: Map<string, QuiltCell>;                // cellId -> cell state (cellId = `${rowIndex}:${columnIndex}`)
    columnOrder: number[];                        // Current column playback order (performer can reorder)
    playheadColumn: number;                       // Current column index being played
    loopCount: number;
  };

  // Song availability
  availableSongs: number[];                       // Song indices available as choices (e.g., [0, 1, 2])

  // Track resolution map
  trackMap: Map<string, Map<number, number>>;     // granularType -> songIndex -> Ableton trackIndex

  // Assignment state
  assignment: {
    mode: 'auto' | 'self_select';
    timerRemaining: number | null;
  };

  // Preview state
  preview: {
    lockedInUsers: Set<UserId>;                   // Users who have committed their choice
    timerRemaining: number | null;
  };

  // Remix state (both audience and performer)
  remix: {
    lockedCells: Set<string>;                     // cellIds the performer has locked (audience can't move)
    mutedCells: Set<string>;                      // cellIds the performer has muted
    lastMoveByUser: Map<UserId, number>;          // userId -> loopCount of last move (for cooldown)
    liveTracksActive: string[];                   // Live performance track IDs
  };

  npc: { currentMessage: string | null };
}

interface QuiltCell {
  id: string;                                     // `${rowIndex}:${columnIndex}`
  rowIndex: number;                               // Current row position (may change via swaps)
  columnIndex: number;                            // Current column position (may change via swaps)
  granularType: string;                           // Derived from current rowIndex
  songIndex: number | null;                       // 0, 1, or 2 — the song choice. null if no choice yet.
  chapter: Chapter | null;                        // Derived from songIndex
  ownerId: UserId | null;                         // null if unclaimed
}
```

## Quilt Config

```typescript
interface QuiltConfig {
  maxColumns: number;                              // Max time slices (default: 4, max: 8)
  barsPerCell: number;                             // Derived: 8 / columns, or configurable
  loopBars: number;                                // Total loop length (default: 8)
  overflowMode: 'spectator' | 'extend_loop';      // What happens when cells are full
  previewTimerMs: number;                          // Preview phase duration (default: 20000)
  assignmentTimerMs: number;                       // Assignment phase duration (default: 30000)

  // Audience interaction during playback
  audienceRemix: {
    enabled: boolean;                              // Master toggle — false = audience watches only, performer remixes alone
    scope: 'own_cell' | 'any_cell';                // Can audience move only their own cell, or drag any cell?
    allowCrossRowSwaps: boolean;                   // Whether audience can swap across rows (default: true). Only applies when enabled=true.
    cooldownLoops: number;                         // Loops between allowed audience cell moves (default: 1). 0 = no cooldown.
    allowSongChange: boolean;                      // Can audience change their cell's song choice during playback? (default: false — song is locked after preview)
  };
}
```

## Conductor Commands (Finale — V3.3)

```typescript
type FinaleCommand =
  // Setup & NPC (unchanged)
  | { type: 'SETUP_FINALE' }
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Assignment
  | { type: 'START_ASSIGNMENT' }
  | { type: 'CLAIM_CELL'; userId: UserId; cellId: string }
  | { type: 'RELEASE_CELL'; userId: UserId }
  | { type: 'ASSIGNMENT_COMPLETE' }

  // Preview
  | { type: 'START_PREVIEW' }
  | { type: 'SET_CELL_SONG'; userId: UserId; songIndex: number }
  | { type: 'LOCK_IN_CHOICE'; userId: UserId }
  | { type: 'PREVIEW_COMPLETE' }

  // Playback & Remix (audience + performer)
  | { type: 'START_PLAYBACK' }
  | { type: 'MOVE_CELL'; userId: UserId; targetCellId: string }     // Audience: move cell (swap if occupied). Validated against audienceRemix config (enabled, scope, cooldown, cross-row).
  | { type: 'CHANGE_CELL_SONG'; userId: UserId; songIndex: number } // Audience: change own cell's song during playback. Only valid when audienceRemix.allowSongChange=true.
  | { type: 'REORDER_COLUMN'; fromIndex: number; toIndex: number }  // Performer only
  | { type: 'SWAP_CELLS'; cellIdA: string; cellIdB: string }        // Performer: swap any two cells
  | { type: 'LOCK_CELL'; cellId: string }                           // Performer: prevent audience moves
  | { type: 'UNLOCK_CELL'; cellId: string }
  | { type: 'MUTE_CELL'; cellId: string }
  | { type: 'UNMUTE_CELL'; cellId: string }
  | { type: 'OVERRIDE_CELL_SONG'; cellId: string; songIndex: number }  // Performer: force a song choice
```

## Conductor Events (Finale — V3.3)

```typescript
type FinaleEvent =
  // Setup & NPC
  | { type: 'FINALE_SETUP_COMPLETE'; availableSongs: number[]; trackMap: Map<string, Map<number, number>>; quiltDimensions: { rows: number; columns: number; barsPerCell: number } }
  | { type: 'NPC_MESSAGE'; message: string }

  // Assignment
  | { type: 'CELL_CLAIMED'; cellId: string; userId: UserId }
  | { type: 'CELL_RELEASED'; cellId: string }
  | { type: 'ASSIGNMENT_STARTED'; mode: 'auto' | 'self_select'; quiltDimensions: { rows: number; columns: number } }
  | { type: 'ALL_CELLS_ASSIGNED' }

  // Preview
  | { type: 'PREVIEW_STARTED' }
  | { type: 'CELL_SONG_SET'; cellId: string; songIndex: number }
  | { type: 'USER_LOCKED_IN'; userId: UserId }

  // Playback & Remix
  | { type: 'PLAYBACK_STARTED'; quilt: Map<string, QuiltCell>; columnOrder: number[] }
  | { type: 'PLAYHEAD_ADVANCED'; columnIndex: number }
  | { type: 'CELL_MOVED'; cellId: string; fromPosition: { row: number; col: number }; toPosition: { row: number; col: number }; swappedWithCellId: string | null }
  | { type: 'COLUMN_REORDERED'; columnOrder: number[] }
  | { type: 'CELLS_SWAPPED'; cellIdA: string; cellIdB: string }
  | { type: 'CELL_LOCKED'; cellId: string }
  | { type: 'CELL_MUTED'; cellId: string }
  | { type: 'CELL_UNMUTED'; cellId: string }

  // Audio
  | { type: 'AUDIO_CUE'; cue: QuiltAudioCue }
```

## Audio Cues (V3.3)

```typescript
type QuiltAudioCue =
  | { type: 'quilt_playback_start'; initialColumn: number; trackIndices: number[] }
  | { type: 'quilt_column_change'; columnIndex: number; trackChanges: { granularType: string; muteTrack: number | null; unmuteTrack: number | null }[] }
  | { type: 'quilt_reorder'; newColumnOrder: number[] }
  | { type: 'quilt_mute_cell'; granularType: string; columnIndex: number; trackIndex: number }
  | { type: 'quilt_unmute_cell'; granularType: string; columnIndex: number; trackIndex: number }
```

## WebSocket Events (V3.3 changes)

### Client → Server

| Event | Payload | Sender |
|-------|---------|--------|
| `claim_cell` | `{ cellId }` | Audience (assignment) |
| `release_cell` | — | Audience (assignment) |
| `set_song` | `{ songIndex }` | Audience (preview) |
| `lock_in` | — | Audience (preview) |
| `move_cell` | `{ targetCellId }` | Audience (playback — validated against audienceRemix config) |
| `change_song` | `{ songIndex }` | Audience (playback — only when audienceRemix.allowSongChange=true) |

### Server → Client

| Event | Payload | Recipients |
|-------|---------|------------|
| `quilt_state` | `{ cells, columnOrder, playheadColumn }` | All (~2 Hz during assignment, ~4 Hz during playback) |
| `cell_claimed` | `{ cellId, userId }` | All (during assignment) |
| `cell_moved` | `{ cellId, fromPosition, toPosition, swappedWithCellId }` | All (during playback) |
| `playhead_update` | `{ columnIndex }` | All (during playback, on column boundary) |
| `column_reordered` | `{ columnOrder }` | All (during remix) |

### Removed from V3.2

| Removed Event | Replacement |
|---------------|-------------|
| `set_preference` | `set_song` (during preview only) |
| `select_type` | `claim_cell` (cell includes type via row) |
| `mix_state` | `quilt_state` |
| `type_locked` / `type_unlocked` | `cell_locked` / `cell_muted` (per-cell, not per-type) |

## Persistence (V3.3)

### New Table

```sql
CREATE TABLE finale_quilt_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,              -- e.g., '0:0', '2:3' (rowIndex:columnIndex)
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  owner_id TEXT,                      -- NULL if unclaimed
  song_index INTEGER,                 -- 0, 1, or 2. NULL if no choice yet.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

CREATE TABLE finale_remix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT,                       -- NULL for performer actions, userId for audience moves
  event_type TEXT NOT NULL CHECK(event_type IN ('move', 'reorder', 'swap', 'lock', 'unlock', 'mute', 'unmute', 'override')),
  payload JSON NOT NULL,              -- Event-specific data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

### Removed Tables
- `finale_mix_events` (V3.2 live mix voting) — replaced by `finale_quilt_cells` and `finale_remix_events`
- `finale_assignments` — cell claim is the assignment (captured in `finale_quilt_cells.owner_id`)

## Show Phase State Machine (V3.3 update)

```
... → finale_elegy → finale_assignment → finale_preview → finale_playback → ended
```

```typescript
type ShowPhase =
  | 'lobby'
  | 'opener'
  | 'attempt_story'
  | 'attempt_build'
  | 'attempt_resolve'
  | 'finale_elegy'
  | 'finale_assignment'       // Cell claim phase
  | 'finale_preview'          // Private fragment exploration (NEW)
  | 'finale_playback'         // Quilt plays + performer remix (REPLACES finale_live_mix)
  | 'ended';
```

## Projector Display

### During Assignment
The quilt grid, cells filling up in real time as audience claims them. Each claimed cell pulses with the granular type's color. Unclaimed cells are dim outlines. Timer visible.

### During Preview
The quilt grid, cells lighting up with chapter colors as users make their song choices. Room is silent — visual anticipation only.

### During Playback
The quilt grid as a patchwork of chapter colors (amber/coral/teal). A **playhead bar** sweeps left to right across columns. Cells animate when swapped — both audience and performer moves are visible in real time. Muted cells dim. Locked cells show a lock icon. The audience watches the pattern shift as people drag cells around and the performer rearranges.

## Resolved Decisions

- **Cell model is song-choice based.** Cells hold a song index (0, 1, 2), not a fragment ID. The grid position (row) determines which granular type plays. Track resolution: `trackMap[granularType][songIndex] → Ableton trackIndex`.
- **Audience remix is fully configurable.** Master toggle to enable/disable, scope (own cell vs any cell), cross-row swaps, cooldown, and whether song choice can change during playback. All via `audienceRemix` in `QuiltConfig`. This allows rapid playtesting of different interaction levels without code changes.
- **Cross-row swaps are allowed** (configurable via `allowCrossRowSwaps`). Moving a cell to a different row changes which instrument plays the song choice. Musically safe because track resolution always finds the correct audio.
- **Performer fragment override:** Yes — the performer CAN override a cell's song choice. Available as an emergency/creative tool, but default workflow is reorder/mute/swap.
- **Audience song choice is final after preview by default.** Configurable via `audienceRemix.allowSongChange`. When false (default), the song a cell plays doesn't change unless the performer overrides it. When true, audience can change their cell's song during playback. Cell POSITION can always change (if audience remix is enabled).
- **Loop length is 8 bars.** All music is composed for 8-bar loops.
- **Live seed / melody is a quilt row.** It is one of the 6 granular type rows, audience-controllable like everything else. The performer's live instruments (vocal, synth, etc.) are separate tracks layered on top of the quilt, not part of the grid.
- **Visual design should be intentionally modular** — build for easy iteration, no locked visual commitments yet.

## Open Questions

- [ ] Exact crossfade duration at column boundaries (needs playtesting — 0ms for hard cuts vs 100ms for smooth)
- [ ] Projector and phone visual design for the quilt (modular, easy to iterate)

# V3.3 Finale Migration — Claude Code Prompt

Paste this into Claude Code:

---

Read CLAUDE.md first, then read docs/finale.md — this file has been completely rewritten with the V3.3 "Quilt" finale design, replacing the V3.2 live mix. This is now the authoritative spec for the finale. Your job is to update all project documentation and code to align with it.

## What changed (summary)

The V3.2 finale (majority-vote live mix where groups control granular types) has been replaced by the V3.3 "Quilt" model:

- The finale song is a grid: 6 rows (granular types) × N columns (time slices). Each cell is owned by one audience member.
- Cells hold a **song index** (0, 1, or 2), NOT a fragment ID. The row determines the instrument, the song choice determines which song's version plays. Track resolution: `trackMap[granularType][songIndex] → Ableton trackIndex`.
- Audience picks a cell, previews song options privately (room silent), locks in their choice, then the quilt plays through as a loop.
- During playback, audience interaction is **fully configurable** via `audienceRemix` in QuiltConfig: master enable/disable toggle, scope (own cell vs any cell), cross-row swaps, cooldown, and whether song choice can change. This allows rapid playtesting without code changes.
- The performer returns and also rearranges cells, reorders columns, locks/mutes cells, and plays live over the quilt.
- Live seed/melody is one of the 6 quilt rows, audience-controllable like all other types — NOT a separate always-on layer.
- Show phases changed: `finale_live_mix` is replaced by `finale_preview` + `finale_playback`. `finale_assignment` is now cell claiming, not type assignment.

## Documents to update

### 1. ARCHITECTURE.md

Update these sections (do NOT rewrite sections unrelated to the finale):

- **Project Overview > "What This Is"** paragraph: Replace "Incredibox-style collaborative mix" language with quilt description. Keep it concise — one sentence about the quilt mechanic.
- **Terminology table**: 
  - ADD: `Quilt` (the 6×N grid of cells representing the finale composition), `Cell` (one position in the quilt grid — holds a song choice, owned by one audience member), `Song Choice` (the song index 0/1/2 that a cell holds — determines which song's audio plays for that cell's current row/column position)
  - UPDATE: `Fragment` definition — note that GranularFragment is used during elegy display but cells use songIndex directly during the quilt phases
  - REMOVE or UPDATE: any terminology referencing live mix majority voting, per-type group voting, recency tiebreak
- **Show Phase State Machine**: Replace `finale_live_mix` with `finale_preview` and `finale_playback`. Update the ShowPhase type, phase details, and transitions table.
- **Folder structure**: Update `conductor/`, `components/finale/`, `hooks/`, and `components/controller/` listings:
  - REMOVE references to: `live-mix.ts`, `LiveMixController.tsx`, `LiveMixSpectator.tsx`, `LiveMixProjector.tsx`, `LiveMixControls.tsx`, `useLiveMix.ts`
  - ADD references to: `quilt.ts` (conductor), `QuiltGrid.tsx` (audience + projector), `QuiltPreview.tsx` (audience preview), `QuiltRemix.tsx` (controller performer remix), `useQuilt.ts` (hook)
- **Add Appendix E: What Changed V3.2 → V3.3** following the pattern of existing appendices. List removed systems, new systems, and changed systems.

### 2. docs/data-models.md

- **ShowState**: Change `finaleState: V32FinaleState` to `finaleState: V33FinaleState`
- **ShowPhase type**: Replace `finale_live_mix` with `finale_preview | finale_playback`
- **ShowConfig**: Replace `V32FinaleConfig` with `V33FinaleConfig` referencing `QuiltConfig`. Remove `bothOptionsSurvive` and `crossSongConstraint` (cells use song indices, not fragments). Keep `npcMessages` and `audioPreviewPath`.
- **Conductor Commands**: Remove all V3.2 finale commands (`START_LIVE_MIX`, `SET_LIVE_MIX_PREFERENCE`, `LOCK_GRANULAR_TYPE`, `UNLOCK_GRANULAR_TYPE`, `OVERRIDE_FRAGMENT`, `CLEAR_OVERRIDE`). Replace with V3.3 commands from docs/finale.md (`CLAIM_CELL`, `RELEASE_CELL`, `SET_CELL_SONG`, `LOCK_IN_CHOICE`, `MOVE_CELL`, `REORDER_COLUMN`, `SWAP_CELLS`, `LOCK_CELL`, `UNLOCK_CELL`, `MUTE_CELL`, `UNMUTE_CELL`, `OVERRIDE_CELL_SONG`, `START_PREVIEW`, `PREVIEW_COMPLETE`, `START_PLAYBACK`).
- **Conductor Events**: Remove V3.2 finale events (`LIVE_MIX_STARTED`, `ACTIVE_FRAGMENT_CHANGED`, `GRANULAR_TYPE_LOCKED`, `GRANULAR_TYPE_UNLOCKED`). Replace with V3.3 events from docs/finale.md.
- **AudioCue type**: Remove `live_mix_crossfade` and `live_mix_start`. Add quilt audio cues from docs/finale.md (`quilt_playback_start`, `quilt_column_change`, `quilt_reorder`, `quilt_mute_cell`, `quilt_unmute_cell`).
- **Remove `LiveMixVote` interface** entirely.
- **Note**: `GranularFragment` can stay as a type (used in elegy display) but add a note that the quilt phases use `QuiltCell` with `songIndex` instead of fragment references.

### 3. docs/server-protocol.md

- **Client → Server events**: Remove `select_type`, `set_preference`. Add `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell` per docs/finale.md.
- **Server → Client events**: Remove `mix_state`, `type_locked`, `type_unlocked`, `assigned`, `group_update`. Add `quilt_state`, `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered` per docs/finale.md.
- **SQLite schema**: Remove `finale_mix_events` table. Remove `finale_assignments` table. Add `finale_quilt_cells` and `finale_remix_events` tables per docs/finale.md.
- **Persistence notes**: Update finale-specific recovery notes for quilt model.

### 4. docs/client-routes.md

- **`/audience` section**: 
  - Replace "Finale — Assignment" with cell claim description (tap a cell in the grid, not a granular type card)
  - Replace "Finale — Live Mix" with Preview (private song exploration, 3 tappable chapter-colored cards, lock in) and Playback (see your cell in the quilt, drag to move it, cooldown indicator)
- **`/projector` section**:
  - Replace "Finale — Live Mix" with quilt grid display description (playhead sweeping, chapter color cells, swap animations)
- **`/controller` section**:
  - Replace "Finale — Live Mix" controls with quilt remix controls (drag columns, swap cells, lock/mute cells, override song choice)
  - Update Metrics/Telemetry to reference quilt state instead of per-type vote distributions

### 5. docs/audio-engine.md

- **Playback Modes > Finale section**: Replace live mix description with quilt playback description:
  - Live seed / melody is one of the 6 quilt rows, audience-controllable like all other types
  - At each column boundary: resolve `trackMap[granularType][songIndex]` for each cell in the current column, mute/unmute accordingly
  - Crossfade at column boundaries (configurable duration)
  - Column reorders take effect at next loop boundary
- **Remove** references to `live_mix_crossfade` and `live_mix_start` audio cues
- **Add** quilt audio cues section

### 6. CLAUDE.md

Add a section at the top or in a prominent location:

```
## V3.3 Migration (Current)

The finale has been redesigned from V3.2 live mix to V3.3 "Quilt" model. 
See docs/finale.md for the authoritative spec.

### Deprecated (delete, do not adapt):
- conductor/live-mix.ts
- conductor/assignment.ts (replaced by cell claiming in quilt.ts)
- conductor/fragments.ts (cells use songIndex, not GranularFragment)
- components/finale/LiveMixController.tsx
- components/finale/LiveMixSpectator.tsx  
- components/finale/LiveMixProjector.tsx
- components/finale/AssignmentCards.tsx
- components/finale/AssignmentIdentity.tsx
- components/controller/LiveMixControls.tsx
- hooks/useLiveMix.ts

### Key concept change:
Cells hold a song index (0, 1, 2), not a fragment ID.
Track resolution: trackMap[granularType][songIndex] → Ableton trackIndex.
The cell's grid position determines the instrument (row) and timing (column).
Song choice travels with the cell when it moves.
```

### 7. DECISIONS.md

Add resolved decisions from docs/finale.md "Resolved Decisions" section. Add open questions from docs/finale.md "Open Questions" section.

## Execution instructions

- Work through documents 1-7 in order.
- For each document, read the current version first, then make targeted edits. Do NOT rewrite entire files — only change finale-related sections.
- Preserve all song-building, lobby, opener, and attempt-related content exactly as-is.
- After all doc updates, run a consistency check: grep for `live_mix`, `LiveMix`, `LIVE_MIX`, `majority`, `recency tiebreak`, `GRANULAR_TYPE_LOCKED`, `ACTIVE_FRAGMENT_CHANGED` across all docs/ files and ARCHITECTURE.md. Any remaining references to V3.2 live mix concepts should be updated or removed.
- Add a CHANGELOG.md entry summarizing the V3.3 finale redesign.
- Do NOT write any implementation code yet. This task is documentation only.

# V3.3 "Quilt" Migration Plan — Spec-Driven Development

**Created:** 2026-04-07
**Spec:** `docs/finale.md` (authoritative — installed in Phase 0)
**Migration prompt (reference):** `v33-migration-prompt.md`
**Status:** Not started

---

## Philosophy

This migration follows a **spec-first, context-second, types-third, code-fourth** workflow. Each phase produces a verifiable artifact before the next phase begins. Claude Code executes one phase per session, using the spec as the single source of truth.

### Docs strategy: hybrid

We do NOT bulk-update all documentation before writing code. Instead:

1. **Phase 0 (context):** Update only the files that Claude Code reads *first* every session — `CLAUDE.md`, `ARCHITECTURE.md` (phase state machine + terminology), and `DECISIONS.md`. Install the spec as `docs/finale.md`. This ensures every future session starts with V3.3 context.
2. **Phases 1-5 (implement + document):** Each phase updates the relevant doc section *after* implementation, so docs reflect what was actually built. If implementation reveals the spec needs adjustment, the doc captures the real behavior.
3. **Phase 6 (cleanup):** Final consistency grep catches any stale V3.2 references. Remaining doc gaps filled.

This avoids the two failure modes: (a) stale docs misleading Claude Code (fixed by Phase 0), and (b) docs describing code that doesn't exist yet (fixed by documenting alongside implementation).

### Why this implementation order

1. **Types first** — the type system is the contract between conductor, server, and client. Getting it right before implementation prevents cascading refactors.
2. **Conductor second** — pure logic with no I/O dependencies. Testable in isolation. Validates the design before wiring begins.
3. **Server third** — wires conductor events to sockets and persistence. Depends on stable types + conductor.
4. **Client last** — UI depends on stable server events and state shape. Building UI on shifting types wastes effort.

### Session protocol

Each phase is designed to be completable in a single Claude Code session. At the start of each session, paste the phase prompt. The prompt tells Claude Code exactly what to read, what to do, and how to verify.

**Gate rule:** Never start Phase N+1 until Phase N's verification passes. A type error in Phase 1 compounds through every subsequent phase.

**Branch strategy:** You're on the `quilt` branch. Commit at the end of each phase for clean revert points.

**Deferred work markers:** When a phase touches code that belongs to a later phase (e.g., Phase 1 type changes break server code), use `// TODO: V3.3 Phase N` comments rather than implementing.

---

## Phase 0: Context Setup

**Goal:** Set up V3.3 context so every future Claude Code session reads the right design. Install the spec. Update only the files Claude Code reads first.
**Depends on:** Nothing
**Produces:** `docs/finale.md`, updated `CLAUDE.md`, `ARCHITECTURE.md`, `DECISIONS.md`
**Verification:** Read order produces correct V3.3 context

### Prompt

```
Read CLAUDE.md, then read v33-finale-SPEC.md — this is the authoritative spec for the V3.3 "Quilt" finale, replacing the V3.2 live mix.

Your job: set up V3.3 context for all future sessions. This is a SLIM doc update — only the files that Claude Code reads first. Detailed docs (data-models, server-protocol, client-routes, audio-engine) will be updated alongside implementation in later phases.

### Step 1: Install the spec
Copy v33-finale-SPEC.md → docs/finale.md (overwriting the V3.2 version). This is now the authoritative finale spec.

### Step 2: Update CLAUDE.md
Add a V3.3 migration section at the top (after Read Order), containing:
- Statement that the finale has been redesigned from V3.2 live mix to V3.3 "Quilt" model
- Pointer to docs/finale.md as authoritative spec
- List of deprecated files (to be deleted during implementation):
  - conductor/live-mix.ts
  - conductor/assignment.ts (replaced by cell claiming in quilt.ts)
  - components/finale/LiveMixController.tsx
  - components/finale/LiveMixSpectator.tsx
  - components/finale/LiveMixProjector.tsx
  - components/finale/AssignmentCards.tsx
  - components/finale/AssignmentIdentity.tsx
  - components/controller/LiveMixControls.tsx
  - hooks/useLiveMix.ts
- Key concept change summary:
  - Cells hold a song index (0, 1, 2), not a fragment ID
  - Track resolution: trackMap[granularType][songIndex] → Ableton trackIndex
  - Show phases: finale_live_mix replaced by finale_preview + finale_playback

Do NOT update the rest of CLAUDE.md yet (folder structure, state machine, common patterns). Those will be updated in Phase 6 after implementation is complete.

### Step 3: Update ARCHITECTURE.md (targeted)
Only update these sections:
- **Terminology table**: ADD Quilt, Cell, Song Choice. UPDATE Fragment (note quilt uses songIndex). Do NOT remove V3.2 terms yet — they're still referenced by live code.
- **Show Phase State Machine**: Replace `finale_live_mix` with `finale_preview` and `finale_playback` in the diagram, ShowPhase type, phase details, and transitions table.
- **Add Appendix E: What Changed V3.2 → V3.3** — list removed systems (live mix, majority voting, recency tiebreak, per-type groups), new systems (quilt grid, cell claiming, preview/playback phases, audience remix config), and changed systems (assignment, NPC events, audio cues).

Preserve all other sections exactly as-is.

### Step 4: Update DECISIONS.md
Add resolved decisions from docs/finale.md "Resolved Decisions" section (cell model, audience remix config, cross-row swaps, performer override, song choice locking, loop length, live seed as quilt row, modular visual design).
Add open questions from docs/finale.md "Open Questions" section (crossfade duration, visual design).

### Step 5: Add CHANGELOG.md entry
Add a brief entry: "V3.3 'Quilt' finale redesign — context setup. Spec installed as docs/finale.md. See V33-MIGRATION-PLAN.md for implementation phases."

Commit with message: "V3.3 Phase 0: install quilt spec + update context docs"
```

### Checklist
- [x] `docs/finale.md` installed (copy of v33-finale-SPEC.md)
- [x] `CLAUDE.md` has V3.3 migration section with deprecated files + key concepts
- [x] `ARCHITECTURE.md` terminology updated (Quilt, Cell, Song Choice)
- [x] `ARCHITECTURE.md` show phase state machine updated
- [x] `ARCHITECTURE.md` Appendix E added
- [x] `DECISIONS.md` updated with resolved + open from spec
- [x] `CHANGELOG.md` entry added
- [x] Committed

---

## Phase 1: Type Definitions

**Goal:** Define all V3.3 types in `conductor/types.ts`. Remove or replace V3.2 finale types.
**Depends on:** Phase 0 (context docs set)
**Produces:** Updated `conductor/types.ts`, type-checks pass
**Verification:** `npx tsc --noEmit`

### Prompt

```
Read CLAUDE.md (note the V3.3 migration section), then read docs/finale.md for the authoritative type definitions.

Your job: update `conductor/types.ts` to define all V3.3 finale types. Follow the project's "types first" rule.

1. Read `conductor/types.ts` fully.
2. Read the "Finale State", "Quilt Config", "Conductor Commands", "Conductor Events", and "Audio Cues" sections of docs/finale.md.

### Changes to make

Add new types:
- `V33FinaleState` interface (with QuiltCell, quilt structure, assignment/preview/remix state)
- `QuiltConfig` interface (with audienceRemix sub-config)
- `QuiltCell` interface
- `QuiltAudioCue` type
- All V3.3 `FinaleCommand` variants added to `ConductorCommand`
- All V3.3 `FinaleEvent` variants added to `ConductorEvent`

Update existing types:
- Replace `finale_live_mix` with `finale_preview | finale_playback` in `ShowPhase`
- Update `V32FinaleState` → `V33FinaleState` in `ShowState`
- Update `V32FinaleConfig` → `V33FinaleConfig` (referencing QuiltConfig) in `ShowConfig`
- Keep `GranularFragment` (used in elegy display) but add a comment noting quilt phases use `QuiltCell` with `songIndex`

Remove V3.2 finale types:
- Commands: START_LIVE_MIX, SET_LIVE_MIX_PREFERENCE, LOCK_GRANULAR_TYPE, UNLOCK_GRANULAR_TYPE, OVERRIDE_FRAGMENT, CLEAR_OVERRIDE
- Events: LIVE_MIX_STARTED, ACTIVE_FRAGMENT_CHANGED, GRANULAR_TYPE_LOCKED, GRANULAR_TYPE_UNLOCKED
- `LiveMixVote` interface
- Audio cues: live_mix_crossfade, live_mix_start

Do NOT remove types used by song-building or elegy. Only remove finale live-mix types.

### Stabilize the build

After type changes, run `npx tsc --noEmit`. Fix type errors in conductor/, server/, and client code with minimal patches — comment out broken references with `// TODO: V3.3 Phase N` rather than implementing new logic.

Run `npm test` — note which tests break (don't fix test logic yet, just record what broke).

### Update docs

Update `docs/data-models.md`:
- `ShowState.finaleState` type reference
- `ShowPhase` type (finale_preview, finale_playback)
- `ShowConfig` with V33FinaleConfig
- Remove V3.2 finale commands/events sections, add V3.3 versions
- Remove `LiveMixVote` interface
- Add note that `GranularFragment` is used in elegy, quilt uses `QuiltCell`

Commit with message: "V3.3 Phase 1: quilt type definitions"
```

### Checklist
- [x] V33FinaleState, QuiltCell, QuiltConfig, QuiltAudioCue defined
- [x] ShowPhase updated (finale_preview, finale_playback replace finale_live_mix)
- [x] V3.3 commands/events added to ConductorCommand/ConductorEvent
- [x] V3.2 finale commands/events/types removed
- [x] ShowState.finaleState type updated
- [x] ShowConfig updated with V33FinaleConfig
- [x] `npx tsc --noEmit` passes (with TODO stubs where needed)
- [x] Broken tests noted (15 failures in deprecated live-mix.test.ts + assignment.test.ts — both @ts-nocheck, to be deleted in Phase 2)
- [x] `docs/data-models.md` updated to match
- [x] Committed

---

## Phase 2: Conductor — Quilt Logic

**Goal:** Implement the pure quilt state machine in `conductor/`. Delete `conductor/live-mix.ts`. Create `conductor/quilt.ts`.
**Depends on:** Phase 1 (types are stable)
**Produces:** `conductor/quilt.ts`, updated `conductor/conductor.ts`, passing tests
**Verification:** `npm test -- conductor/`

### Prompt

```
Read CLAUDE.md (note V3.3 migration section and deprecated files), then read docs/finale.md.

Your job: implement the V3.3 quilt conductor logic. The conductor is PURE — no I/O, no Socket.IO, no database calls.

1. Read `conductor/conductor.ts`, `conductor/live-mix.ts`, `conductor/assignment.ts`, `conductor/types.ts`.
2. Read the full docs/finale.md for behavioral requirements.

### A. Create `conductor/quilt.ts`
Pure functions for quilt operations:
- `createQuiltGrid(audienceSize, config)` → initializes empty quilt (rows × columns, cellIds)
- `claimCell(quilt, userId, cellId)` → returns updated quilt or error
- `releaseCell(quilt, userId)` → returns updated quilt
- `setCellSong(quilt, userId, songIndex)` → sets song choice for user's cell
- `lockInChoice(quilt, userId)` → marks user as locked in
- `moveCell(quilt, userId, targetCellId, config)` → validates against audienceRemix config (enabled, scope, cooldown, cross-row), swaps if occupied
- `changeCellSong(quilt, userId, songIndex, config)` → validates audienceRemix.allowSongChange
- `reorderColumn(quilt, fromIndex, toIndex)` → performer only
- `swapCells(quilt, cellIdA, cellIdB)` → performer only
- `lockCell(quilt, cellId)` / `unlockCell` / `muteCell` / `unmuteCell`
- `overrideCellSong(quilt, cellId, songIndex)`
- `resolveTrack(trackMap, granularType, songIndex)` → returns Ableton trackIndex
- `advancePlayhead(quilt)` → advances to next column in columnOrder
- `assignRemainingUsers(quilt, unclaimedUserIds)` → random assignment for timer expiry

Export from `conductor/index.ts`.

### B. Update `conductor/conductor.ts`
- Remove all V3.2 finale command handlers (handleSetLiveMixPreference, handleLockGranularType, handleUnlockGranularType, handleOverrideFragment, handleClearOverride, handleStartLiveMix)
- Add V3.3 command handlers using quilt.ts functions:
  - CLAIM_CELL, RELEASE_CELL, SET_CELL_SONG, LOCK_IN_CHOICE
  - START_PREVIEW, PREVIEW_COMPLETE
  - START_PLAYBACK, MOVE_CELL, CHANGE_CELL_SONG
  - REORDER_COLUMN, SWAP_CELLS, LOCK_CELL, UNLOCK_CELL, MUTE_CELL, UNMUTE_CELL, OVERRIDE_CELL_SONG
- Update phase transitions: finale_assignment → finale_preview → finale_playback
- Update SETUP_FINALE to initialize quilt grid
- Emit appropriate V3.3 events from each handler

### C. Update `conductor/assignment.ts`
- Assignment is now cell claiming, not type assignment
- Auto mode: distribute users across cells round-robin
- Self-select mode: users claim cells individually
- Reuse what makes sense, rewrite what doesn't

### D. Delete `conductor/live-mix.ts`

### E. Write tests in `conductor/__tests__/quilt.test.ts`
Test the pure quilt functions:
- Grid creation and scaling (audience size → column count)
- Cell claim/release
- Song choice setting and lock-in
- Cell movement with audienceRemix validation (scope, cooldown, cross-row)
- Column reordering
- Track resolution: trackMap[granularType][songIndex] → trackIndex
- Playhead advancement through columnOrder
- Timer expiry auto-assignment
- Performer operations (swap, lock, mute, override)

### F. Update existing finale tests
- Remove/update tests referencing live-mix behavior
- Ensure all conductor tests pass: `npm test -- conductor/`

Run `npm test -- conductor/` and fix until all pass. Then run `npx tsc --noEmit`.

### G. Update docs
No detailed doc updates this phase — the conductor is internal. But if any spec assumptions changed during implementation (e.g., function signatures differ from what the spec implied), note them in docs/finale.md.

Commit with message: "V3.3 Phase 2: quilt conductor logic"
```

### Checklist
- [x] `conductor/quilt.ts` created with all pure functions (22 exported functions)
- [x] `conductor/conductor.ts` updated with V3.3 handlers (16 command handlers wired)
- [x] `conductor/assignment.ts` rewritten for cell claiming (`autoAssignCells`, `getUnclaimedUsers`)
- [x] `conductor/live-mix.ts` deleted
- [x] `conductor/__tests__/quilt.test.ts` written (56 tests)
- [x] Old live-mix tests deleted, assignment tests rewritten (9 tests)
- [x] `npm test -- conductor/` passes (190 tests, 7 suites)
- [x] `npm test` passes (331 tests, 12 suites)
- [x] `npx tsc --noEmit` passes
- [x] `CELL_UNLOCKED` event added to `ConductorEvent` union (spec gap)
- [x] Committed (`4d0f76e`)

---

## Phase 3: Server — Socket Events + Persistence

**Goal:** Wire V3.3 conductor to Socket.IO events and SQLite persistence. Delete V3.2 finale socket/persistence code.
**Depends on:** Phase 2 (conductor logic is stable and tested)
**Produces:** Updated `server/socket.ts`, `server/persistence.ts`, `db/schema.sql`
**Verification:** `npm test`, `npx tsc --noEmit`

### Prompt

```
Read CLAUDE.md, then read docs/finale.md sections: "WebSocket Events", "Persistence", "Audio Cues".

Your job: wire the V3.3 quilt conductor to the server layer. The conductor is already implemented (Phase 2). Now connect it to sockets, persistence, and audio.

1. Read `server/socket.ts`, `server/persistence.ts`, `server/audio-router.ts`, `server/timing.ts`, `db/schema.sql`.

### A. Update `server/socket.ts`

Client → Server events (remove old, add new):
- Remove: `select_type`, `set_preference`
- Add: `claim_cell` → CLAIM_CELL command
- Add: `release_cell` → RELEASE_CELL command
- Add: `set_song` → SET_CELL_SONG command
- Add: `lock_in` → LOCK_IN_CHOICE command
- Add: `move_cell` → MOVE_CELL command (playback phase)
- Add: `change_song` → CHANGE_CELL_SONG command (playback, when allowed)

Server → Client broadcasts (remove old, add new):
- Remove: `mix_state` broadcast interval, `type_locked`, `type_unlocked`, `assigned`, `group_update`
- Add: `quilt_state` broadcast (~2 Hz during assignment, ~4 Hz during playback)
- Add: `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered` event broadcasts

State filtering:
- Controller: full quilt state
- Projector: full quilt state (public — no per-user filtering needed for grid)
- Audience: full quilt state + highlight own cell

### B. Update `server/persistence.ts`
- Remove `finale_mix_events` table operations (saveMixEvent, getMixEvents)
- Remove `finale_assignments` table operations
- Add `finale_quilt_cells` table operations (save/load cell state)
- Add `finale_remix_events` table operations (save remix events for audit)
- Add migration (next version number) for new tables

### C. Update `db/schema.sql`
- Remove `finale_mix_events` and `finale_assignments` table definitions
- Add `finale_quilt_cells` and `finale_remix_events` per spec

### D. Update `server/audio-router.ts`
- Remove `live_mix_crossfade` and `live_mix_start` audio cue handling
- Add quilt audio cue routing:
  - `quilt_playback_start` → unmute initial column tracks
  - `quilt_column_change` → mute/unmute per-type tracks at column boundary
  - `quilt_reorder` → (no immediate audio change — takes effect at next boundary)
  - `quilt_mute_cell` / `quilt_unmute_cell` → mute/unmute specific track

### E. Update `server/timing.ts`
- Remove any finale_live_mix-specific timing logic
- Add playhead advancement during finale_playback (advance at column boundaries based on barsPerCell)

Run `npm test` and `npx tsc --noEmit`. Fix all failures.

### F. Update docs
Update these doc sections to match what was actually implemented:
- `docs/server-protocol.md`: Client → Server events, Server → Client events, SQLite schema, persistence/recovery notes
- `docs/audio-engine.md`: Finale playback section, audio cues section

Commit with message: "V3.3 Phase 3: server wiring + persistence"
```

### Checklist
- [x] Socket events updated — removed: `select_type`, `set_preference`, `group_update`, `mix_state`, `assigned`, `type_locked/unlocked`; added: `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell`, `change_song`, `quilt_state`, `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered`
- [x] `quilt_state` broadcast implemented (~4 Hz unified interval during assignment/preview/playback)
- [x] Persistence updated — `saveQuiltCell`/`getQuiltCells` + `saveRemixEvent`/`getRemixEvents` (migration v6)
- [x] `db/schema.sql` updated — `finale_quilt_cells` (UNIQUE show_id+cell_id), `finale_remix_events`
- [x] Audio router updated — `quilt_playback_start`, `quilt_column_change`, `quilt_reorder`, `quilt_mute_cell`, `quilt_unmute_cell`
- [x] Timing engine updated — `finale_live_mix` → `finale_playback`, preview timer added (with early completion + recovery)
- [x] `npm test` passes (333 tests, 12 suites)
- [x] `npx tsc --noEmit` passes
- [x] `docs/server-protocol.md` updated to match implementation
- [x] `docs/audio-engine.md` updated to match implementation
- [x] Committed (`980b153`)

---

## Phase 4: Client — Audience + Projector UI

**Goal:** Build the audience phone UI and projector display for the quilt.
**Depends on:** Phase 3 (server events are stable)
**Produces:** New components, updated pages, `useQuilt` hook
**Verification:** `npx tsc --noEmit`, manual visual check

> **Note:** If this phase feels too large for one session, split it:
> - **Phase 4a:** `useQuilt` hook + `QuiltGrid` component + audience assignment/preview
> - **Phase 4b:** `QuiltRemix` + projector display + delete deprecated components

### Prompt

```
Read CLAUDE.md, then read docs/finale.md sections: "Phase 2: Assignment", "Phase 3: Preview", "Phase 4: Playback", "Projector Display".

Your job: build the audience and projector UI for the V3.3 quilt. Server events are already wired (Phase 3).

1. Read `app/audience/page.tsx`, `app/projector/page.tsx`, `hooks/useLiveMix.ts`, and the existing finale components.

### A. Create `hooks/useQuilt.ts`
- Subscribes to `quilt_state`, `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered`
- Exposes: quilt grid state, own cell, playhead position, column order
- Emits: `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell`, `change_song`
- Delete `hooks/useLiveMix.ts`

### B. Create `components/finale/QuiltGrid.tsx`
- Renders the 6×N quilt grid
- Cells show chapter color (amber/coral/teal) when song chosen, dim when empty
- Highlights own cell for audience
- Playhead indicator sweeps across columns during playback
- Supports both audience phone (compact) and projector (large) layouts via props

### C. Create `components/finale/QuiltPreview.tsx`
- Audience phone view during preview phase
- Shows: cell position in mini grid, 3 tappable song cards (chapter colors), "LOCK IN" button
- Tapping a card triggers private audio preview (reuse useAudioPreview hook)
- Lock in commits choice

### D. Create `components/finale/QuiltRemix.tsx`
- Audience phone view during playback phase (when audienceRemix.enabled)
- Shows quilt grid with own cell highlighted
- Drag-to-move interaction for cell repositioning
- Cooldown indicator
- Song change UI (when allowSongChange is true)

### E. Update `components/finale/ElegyGrid.tsx`
- Keep as-is (elegy display still uses GranularFragment). No changes needed unless it references LiveMix types.

### F. Update `app/audience/page.tsx`
- Replace LiveMixController/LiveMixSpectator with:
  - finale_assignment → QuiltGrid (cell claim mode)
  - finale_preview → QuiltPreview
  - finale_playback → QuiltGrid + QuiltRemix

### G. Update `app/projector/page.tsx`
- Replace LiveMixProjector with QuiltGrid in projector mode
- Playhead bar sweeping left to right
- Cell swap animations
- Muted cells dim, locked cells show lock icon

### H. Delete deprecated components
- `components/finale/LiveMixController.tsx`
- `components/finale/LiveMixSpectator.tsx`
- `components/finale/LiveMixProjector.tsx`
- `components/finale/AssignmentCards.tsx` (cell claim replaces type assignment)
- `components/finale/AssignmentIdentity.tsx`

Run `npx tsc --noEmit`. Fix all type errors.

### I. Update docs
Update `docs/client-routes.md`:
- `/audience` section: replace assignment + live mix descriptions with cell claim, preview, and playback
- `/projector` section: replace live mix with quilt grid display

Commit with message: "V3.3 Phase 4: audience + projector UI"
```

### Checklist
- [x] `hooks/useQuilt.ts` created (subscribes to quilt_state, cell_claimed, cell_moved, playhead_update, column_reordered; works with both audience + projector views)
- [x] `hooks/useLiveMix.ts` deleted (+ `hooks/useMixState.ts`)
- [x] `QuiltGrid.tsx` created (shared audience/projector, row headers, chapter colors, playhead, lock/mute indicators)
- [x] `QuiltPreview.tsx` created (audience preview phase — song cards, audio preview, lock in)
- [x] `QuiltRemix.tsx` created (audience playback interaction — tap-to-swap, cooldown, song change)
- [x] `app/audience/page.tsx` updated (assignment cell claim, preview, playback/remix/spectator views)
- [x] `app/projector/page.tsx` updated (quilt grid for all 3 phases)
- [x] Deprecated components deleted (LiveMixController, LiveMixSpectator, LiveMixProjector, AssignmentCards, AssignmentIdentity, LiveMixControls)
- [x] `npx tsc --noEmit` passes
- [x] `docs/client-routes.md` updated to match implementation
- [x] `AudienceFinaleView` type extended with `audioPreviewPath` + `audienceRemix` fields; server sends them
- [x] 333 tests passing (12 suites)
- [x] Committed (`1d73618`)

---

## Phase 5: Client — Controller UI

**Goal:** Build the performer controller interface for quilt remix.
**Depends on:** Phase 4 (shared QuiltGrid component exists)
**Produces:** Updated controller components
**Verification:** `npx tsc --noEmit`, manual check

### Prompt

```
Read CLAUDE.md, then read docs/finale.md section "Performer Remix".

Your job: build the performer controller UI for V3.3 quilt remix.

1. Read `app/controller/page.tsx`, `components/controller/LiveMixControls.tsx`, `components/controller/ShowControls.tsx`.

### A. Create `components/controller/QuiltRemixControls.tsx`
- Full quilt grid (reuse QuiltGrid.tsx in controller mode)
- Drag to reorder columns
- Drag to swap any two cells
- Per-cell controls: lock/unlock, mute/unmute, override song choice
- Visual indicators: locked cells, muted cells, audience-moved cells

### B. Update `components/controller/ShowControls.tsx`
- Phase buttons: replace finale_live_mix with finale_preview and finale_playback
- Add START_PREVIEW and START_PLAYBACK triggers
- Keep SETUP_FINALE, START_ASSIGNMENT

### C. Update `components/controller/MetricsPanel.tsx`
- Remove per-type vote distribution display
- Add quilt state summary (cells claimed, songs chosen, remix activity)

### D. Delete `components/controller/LiveMixControls.tsx`

### E. Update `app/controller/page.tsx`
- Wire QuiltRemixControls into the finale phases
- Remove LiveMixControls references

Run `npx tsc --noEmit`. Fix all type errors.

### F. Update docs
Update `docs/client-routes.md`:
- `/controller` section: replace live mix controls with quilt remix controls, update metrics/telemetry

Commit with message: "V3.3 Phase 5: controller UI"
```

### Checklist
- [x] `QuiltRemixControls.tsx` created (full grid with per-cell action menus, column reorder, cell swap, phase actions)
- [x] `ShowControls.tsx` already updated for new phases (done in Phase 1)
- [x] `MetricsPanel.tsx` updated (grid dims, claimed/total, songs set, locked-in, locked/muted, playhead, loop)
- [x] `LiveMixControls.tsx` deleted (done in Phase 4)
- [x] `app/controller/page.tsx` updated (QuiltRemixControls wired, FINALE_PHASES fixed)
- [x] `npx tsc --noEmit` passes
- [x] `docs/client-routes.md` controller section updated
- [x] 333 tests passing (12 suites)
- [x] Committed (`162bf85`)

---

## Phase 5.5: Smoke Test (Optional)

**Goal:** Catch integration issues that unit tests miss before final cleanup.
**Depends on:** Phase 5
**Produces:** Bug fixes, confidence

### Prompt

```
Read CLAUDE.md.

Your job: run an integration smoke test of the V3.3 quilt system.

1. Read `server/tools/simulate-audience.ts`. Update it to simulate V3.3 quilt behavior:
   - Cell claiming (instead of type selection)
   - Song choice selection
   - Lock-in
   - Cell movement during playback (if audienceRemix enabled)

2. Start the dev server: `OSC_ENABLED=false npm run dev`

3. Run the audience simulator. Watch for:
   - quilt_state broadcasts arriving at expected frequency
   - Playhead advancement working
   - Cell claim/release working
   - Phase transitions (assignment → preview → playback)
   - No unhandled errors in server logs

4. Fix any issues found.

5. Run `npm test` to confirm nothing broke.

Commit with message: "V3.3 Phase 5.5: smoke test + simulator update"
```

---

## Phase 6: Integration + Cleanup

**Goal:** Stale reference cleanup, config updates, final doc pass, final test pass.
**Depends on:** Phases 0-5
**Produces:** Clean build, all tests pass, no stale references, docs fully aligned
**Verification:** Full test suite, type check, grep audit

### Prompt

```
Read CLAUDE.md. This is the final V3.3 migration phase — cleanup and verification.

### A. Config updates
1. Read `config/default-show.json`. Add V3.3 finale config:
   - `quiltConfig` with defaults from spec (maxColumns: 4, loopBars: 8, audienceRemix defaults)
   - `trackMap` placeholder structure (granularType → songIndex → trackIndex)
   - Remove or update V3.2 finale config keys
2. Read `config/ableton-layout.json`. Update if needed for quilt track resolution.

### B. Stale reference audit
Run grep across the entire codebase (excluding node_modules, .git, MIGRATION-V3.2.md, MIGRATION-V3.2-TODO.md, V33-MIGRATION-PLAN.md):
- `live_mix`, `LiveMix`, `LIVE_MIX`
- `liveMix`, `live-mix`
- `mix_state`
- `ACTIVE_FRAGMENT_CHANGED`
- `GRANULAR_TYPE_LOCKED`, `GRANULAR_TYPE_UNLOCKED`
- `LiveMixVote`
- `finale_mix_events`, `finale_assignments` (DB tables)
- `select_type`, `set_preference`, `type_locked`, `type_unlocked`

Fix or remove any remaining references. References in historical files (MIGRATION-V3.2.md, MIGRATION-V3.2-TODO.md) are fine.

### C. Full test suite
Run `npm test`. Fix any failures. Record final test count.

### D. Type check
Run `npx tsc --noEmit`. Must pass clean.

### E. Final doc pass
Review each doc for consistency with what was actually built:
- `ARCHITECTURE.md` — folder structure, terminology (remove any V3.2-only terms that no longer apply)
- `docs/data-models.md` — should already be updated from Phase 1
- `docs/server-protocol.md` — should already be updated from Phase 3
- `docs/client-routes.md` — should already be updated from Phases 4-5
- `docs/audio-engine.md` — should already be updated from Phase 3
Fill any gaps.

### F. Update CLAUDE.md (finalize)
- Remove the "V3.3 Migration (Current)" section (migration is done)
- Update "What This System Is" > Finale paragraph to describe the quilt
- Update the show phase state machine diagram
- Update the folder structure listing
- Update common patterns if needed (high-frequency data, state filtering)

### G. Update CHANGELOG.md
Add a comprehensive V3.3 migration entry covering all phases.

### H. Clean up migration artifacts
- v33-migration-prompt.md → can be deleted or moved (its job is done)
- V33-MIGRATION-PLAN.md → keep for historical reference (like MIGRATION-V3.2.md)

Commit with message: "V3.3 Phase 6: cleanup + finalize migration"
```

### Checklist
- [ ] Config files updated
- [ ] Stale reference grep passes clean
- [ ] `npm test` passes (record count: ___)
- [ ] `npx tsc --noEmit` passes
- [ ] All docs reviewed for consistency
- [ ] CLAUDE.md finalized (migration section removed, content updated)
- [ ] CHANGELOG.md updated
- [ ] Migration artifacts cleaned up
- [ ] Committed

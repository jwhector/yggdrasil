# CHANGELOG

## 2026-04-09 — V3.4 Migration Phase 7: Audio Router & OSC

Map V3.4 remix audio cues to OSC commands in `server/audio-router.ts`.

### New cue handlers
- **`remix_start`** — stops transport then restarts from beat 0 (reset for finale remix loop).
- **`node_unmute`** — unmutes a single remix node track and swells gain over `entrySwellBeats`.
- **`node_crossfade`** — simultaneous fade-out (`muteTrack`) + fade-in (`unmuteTrack`) over `crossfadeBeats` at loop boundary.
- **`node_instant_crossfade`** — same crossfade but fires immediately (audience interaction mode); `muteTrack` may be `null` (first token on a node).
- **`node_fade_out`** — fades a node track to silence over `crossfadeBeats`.

### Modified files
- **`server/audio-router.ts`** — 5 new handler functions + switch cases wired into `handleStateChange`.
- **`server/__tests__/audio-router.test.ts`** — 9 new tests covering all 5 V3.4 cue types.

### Test count: **50** audio-router tests (9 added); full suite run separately.

---

## 2026-04-09 — V3.4 Migration Phase 6: Client Components & Hooks

Build the V3.4 UI: audience emotion vote, projector token pool canvas, pentagon remix display, controller fallback grid.

### New hooks
- **`hooks/useTokenPool.ts`** — subscribes to `pool_state` socket event (~2 Hz), provides `availableByChapter` and `totalRemaining`.
- **`hooks/useRemixQueue.ts`** — controller queue management: sends `QUEUE_TOKEN` / `CANCEL_QUEUE` commands with optimistic local queue depth state.
- **`hooks/useDragToken.ts`** — iPad touch drag state: `touchstart`/`touchmove`/`touchend` position tracking, drop zone hit testing with magnetic snap.

### New components
- **`components/finale/EmotionVote.tsx`** — audience: question text + 3 tappable chapter cards. Listens for `question` and `emotion_confirmed` socket events. Shows "phones down" when pool cap reached.
- **`components/finale/TokenPool.tsx`** — projector: canvas 2D floating colored dots with `requestAnimationFrame`. Drift physics, bloom-in animation, generous touch targets (~44pt). Reconciles dot count with pool state.
- **`components/finale/PentagonRemix.tsx`** — projector: 6 pentagon nodes (5 outer + center seed) mirroring song-building layout. Active chapter glow, loop progress ring, queue depth badges, hover highlight for drag targets.
- **`components/finale/ProjectorFinale.tsx`** — projector: composes `TokenPool` + `PentagonRemix`. Touch interaction layer (enabled only during `finale_remix` on touch devices). Screen wake lock (`navigator.wakeLock` + hidden video fallback). Drag-to-node sends `QUEUE_TOKEN` with optimistic UI.
- **`components/finale/RemixController.tsx`** — controller: 6x3 button grid (granular types x chapters). Pool counters per chapter, queue depth badges, active node indicators with loop progress bars, audience interaction mode toggle.

### Modified files
- **`app/audience/page.tsx`** — `finale_vote` renders `EmotionVote`; `finale_remix` renders "LISTEN" phones-down display.
- **`app/projector/page.tsx`** — `finale_vote` and `finale_remix` render `ProjectorFinale`.
- **`app/controller/page.tsx`** — `finale_vote` and `finale_remix` render `RemixController`. Added `V34_FINALE_PHASES` set.
- **`components/controller/ShowControls.tsx`** — added "Start Remix" button (during `finale_vote`) and "End Show" button (during `finale_remix`).
- **`lib/serialization.ts`** — added `SerializedV34FinaleState` interface and `deserializeV34FinaleState()` function. Fixed `deserializeState()` to reconstruct V3.4 finale Maps (was returning null for V3.4 state).

### Test count: **437** (unchanged — no new tests; this phase is UI-only)

---

## 2026-04-09 — V3.4 Migration Phase 5: Persistence & Schema

Add V3.4 database tables and persistence functions. Deprecate V3.3 quilt tables.

### `db/schema.sql`
- **`finale_votes`** table — records one row per audience emotional vote (show_id, user_id, chapter_id, question_index). Foreign key to shows.
- **`finale_token_events`** table — token lifecycle log for recovery + analytics (token_id, granular_type, chapter_id, event_type CHECK IN ('queued','activated','spent','cancelled'), loop_number nullable). Foreign key to shows.
- **Indexes** — `idx_finale_votes_show`, `idx_finale_token_events_show` for common show-scoped queries.
- **`[DEPRECATED V3.3]`** comments on `finale_quilt_cells` and `finale_remix_events` — tables kept for backward compat with existing show data, not dropped.

### `server/persistence.ts`
- **`PersistenceLayer` interface** — added `saveFinaleVote()` and `saveTokenEvent()` method signatures.
- **Migration 7 (`v34_token_pool_tables`)** — idempotent `CREATE TABLE IF NOT EXISTS` + indexes for both new tables. Runs on existing DBs that were created from older schema versions.
- **`saveFinaleVote(showId, userId, chapterId, questionIndex)`** — inserts one row per question answered.
- **`saveTokenEvent(showId, tokenId, granularType, chapterId, eventType, loopNumber)`** — inserts a token lifecycle event. `loopNumber` accepts null (available for `TOKEN_SPENT` via `V34FinaleState.loopCount`).

### `server/socket.ts`
- **`submit_emotion` handler** — calls `persistence.saveFinaleVote()` immediately after processing the command (data is on the socket payload).
- **Generic `command` handler** — inspects events after `setState`; calls `saveTokenEvent('activated')` for `TOKEN_ACTIVATED` events and `saveTokenEvent('spent')` for `TOKEN_SPENT` events. For `TOKEN_SPENT`, looks up `chapterId` from `pool.tokens` (tokens remain in array with `status: 'spent'`).

### `server/index.ts`
- **`processCommandAndBroadcast`** — same token event inspection as socket.ts command handler, for commands fired by the timing engine (e.g. `LOOP_BOUNDARY` which produces `TOKEN_ACTIVATED` and `TOKEN_SPENT`).

### `server/__tests__/persistence.test.ts`
- **`Finale vote persistence (V3.4)`** — 3 tests: saves a vote, multiple votes per user, multiple users.
- **`Token event persistence (V3.4)`** — 5 tests: activated event, spent with loop number, queued/cancelled, CHECK constraint rejects invalid type, null loop number accepted.

### Test count: **437** (up from 431 after Phase 4)

## 2026-04-09 — V3.4 Migration Phase 4: Server & Socket Layer

Wire V3.4 conductor commands to WebSocket events. State filtering updated for new client views. Loop boundary timing added for `finale_remix`.

### `server/socket.ts`
- **`submit_emotion` handler** — maps audience `submit_emotion` event to `SUBMIT_EMOTION` command (userId from socket session for security). Guards against wrong phase.
- **`pool_state` broadcast interval** (~2 Hz) — fires during `finale_vote` and `finale_remix`. Broadcasts serialized pool counts (`availableByChapter`, `totalByChapter`, `totalRemaining`) to projector and controller. Bypasses `state_sync` per high-frequency data pattern.
- **V3.4 conductor event handling in `broadcastEvents`**:
  - `NEXT_QUESTION` → `question` event to specific audience member (with question text + chapters)
  - `EMOTION_RECEIVED` → `emotion_confirmed` to specific audience member
  - `POOL_CAP_REACHED` → `phones_down` to all audience
  - `REMIX_STARTED` → `phones_down` to all audience
  - `TOKEN_ACTIVATED` → `node_update` to projector + controller
  - `NODE_SILENT` → `node_update` to projector + controller
  - `VOTE_STARTED` → sends initial `question` to all connected audience members
- **`filterStateForClient` — projector**: detects V3.4 phases via `state.phase`; returns `ProjectorFinaleV34View` (pool counts, active nodes, queue depths, loop state) instead of V3.3 quilt view.
- **`filterStateForClient` — audience**: detects V3.4 phases; returns `AudienceVoteView` (current question, answered count, pool cap, chapters) for `finale_vote` and `AudienceRemixView` (phones down) for `finale_remix`. V3.3 quilt path unchanged.

### `server/timing.ts`
- **`RemixLoopTrackingState` interface** — simple loop state (no crossfade pre-cue, no column logic).
- **`startRemixLoopTracking()` / `stopRemixLoopTracking()`** — starts beat-driven `LOOP_BOUNDARY` firing during `finale_remix`. OSC mode: tracks beats, fires on each `loopBoundaryBeats` boundary. Fallback mode: JS interval.
- **`handleBeatEvent`** — checks for `remixLoopState` before V3.3 loop tracking; fires `LOOP_BOUNDARY` at each boundary and returns early.
- **`onStateChanged`** — starts remix loop tracking on `SHOW_PHASE_CHANGED` → `finale_remix`.
- **`start()` / `onBridgeReconnect()`** — recover/restart remix loop tracking if phase is `finale_remix` on engine init or bridge reconnect.
- **`clearAllFinaleTimers()`** — calls `stopRemixLoopTracking()`.

### `lib/serialization.ts`
- **`serializeV34FinaleState()`** — converts all V34 Maps (vote tracking, pool counts, queue, active nodes, trackMap) to arrays for JSON transport.
- **`serializeState()`** — detects V34 finale state (`'queue' in state.finaleState`) and uses new serializer for controller full-state sync.
- **`SerializedShowState.finaleState`** — widened to `SerializedFinaleState | object | null` to accommodate V34 serialized shape.
- **`deserializeState()`** — guards V33 deserialization with `'quilt' in data.finaleState` check (V34 full deserialization deferred to Phase 5).

### Tests
- 429 tests passing (16 suites). No test changes needed — server wiring tested via conductor tests (Phase 3) and manual smoke test.

## 2026-04-09 — V3.4 Migration Phase 3: Conductor Modules (Pure Logic)

Three new conductor modules implementing the V3.4 token pool finale system. All pure functions — no I/O.

### New Files
- `conductor/token-pool.ts` — Pool management: `createTokenPool`, `consumeToken`, `returnToken`, `isPoolEmpty`, `getTotalRemaining`
- `conductor/question-engine.ts` — Vote phase logic: `getNextQuestion`, `calculateMaxQuestionsPerPerson`, `shouldCapPool`, `processEmotion`
- `conductor/remix-engine.ts` — Queue & spend logic: `queueToken`, `cancelQueue`, `processLoopBoundary`, `toggleAudienceInteraction`, `resolveTrack`

### Conductor Wiring (`conductor/conductor.ts`)
- Added command handlers for all V3.4 finale commands: `START_VOTE`, `SUBMIT_EMOTION`, `REQUEST_NEXT_QUESTION`, `POOL_CAP_REACHED`, `START_REMIX`, `QUEUE_TOKEN`, `CANCEL_QUEUE`, `TOGGLE_AUDIENCE_INTERACTION`, `LOOP_BOUNDARY`, `END_SHOW`
- Added `finale_vote` and `finale_remix` to phase sequence and `findPhaseSequenceIndex`
- `SETUP_FINALE` initializes `V34FinaleState` when `finaleV34` config is present
- `LOOP_BOUNDARY` wired to `processLoopBoundary()` — auto-transitions to `ended` on `POOL_EMPTY`
- `START_REMIX` transitions from `finale_vote` to `finale_remix`
- Added `v33Finale()` type guard helper for V3.3 handler narrowing

### Type Changes
- `ShowState.finaleState`: widened from `V33FinaleState | null` to `V33FinaleState | V34FinaleState | null`
- `ShowConfig.finaleV34`: optional `V34FinaleConfig` field added

### Exports (`conductor/index.ts`)
- All three new modules exported

### Tests
- `conductor/__tests__/token-pool.test.ts` — 8 tests
- `conductor/__tests__/question-engine.test.ts` — 12 tests
- `conductor/__tests__/remix-engine.test.ts` — 18 tests
- `conductor/__tests__/conductor.test.ts` — 6 new V3.4 integration tests
- Updated existing phase sequence tests for expanded `PHASE_SEQUENCE`
- Total: 429 tests passing across 16 suites

---

## 2026-04-09 — V3.4 Migration Phase 2: Token Pool Types & Interfaces

Type-only additions to `conductor/types.ts` for the V3.4 "Token Pool" finale system. No behavioral changes.

### ShowPhase
- Added `'finale_vote'` and `'finale_remix'` to `ShowPhase` union
- Marked V3.3 phases (`finale_elegy`, `finale_assignment`, `finale_preview`, `finale_playback`) with `// V3.3 — remove in Phase 8`

### New Types: Token Pool Core
- `TokenPool` — wire-safe pool counts (`available` + `total` maps by chapterId)
- `Token` — single emotional vote token with `status: 'available' | 'queued' | 'playing' | 'spent'`
- `QueuedToken` — token queued for next loop boundary on a granular type node
- `ActiveNode` — currently-playing token on a node, with `persistent` flag for audience interaction mode

### New Types: V34FinaleState
- `V34FinaleState` — full V3.4 finale runtime state: vote tracking, token pool, performer queue, active nodes, trackMap, loop progress
- Sits alongside `V33FinaleState` (not yet wired into `ShowState` — happens in Phase 3)

### New Types: V34FinaleConfig
- `V34FinaleConfig`, `VotePhaseConfig`, `QuestionConfig`, `RemixConfig`

### New AudioCue Variants
- `remix_start`, `node_unmute`, `node_crossfade`, `node_instant_crossfade`, `node_fade_out` added to `AudioCue` union
- `RemixAudioCue` type alias for remix-phase audio cue handlers

### New ConductorCommand Variants
- Vote: `START_VOTE`, `SUBMIT_EMOTION`, `REQUEST_NEXT_QUESTION`, `POOL_CAP_REACHED`
- Remix: `START_REMIX`, `QUEUE_TOKEN`, `CANCEL_QUEUE`, `TOGGLE_AUDIENCE_INTERACTION`, `LOOP_BOUNDARY`
- Manual end: `END_SHOW`

### New ConductorEvent Variants
- Vote: `VOTE_STARTED`, `EMOTION_RECEIVED`, `NEXT_QUESTION`, `POOL_CAP_REACHED`, `POOL_READY`
- Remix: `REMIX_STARTED`, `TOKEN_QUEUED`, `TOKEN_CANCELLED`, `TOKEN_ACTIVATED`, `TOKEN_SPENT`, `NODE_SILENT`, `POOL_EMPTY`

### New Client View Types
- `AudienceVoteView` — personalized vote phase view (current question, answer count, pool cap state)
- `AudienceRemixView` — phones-down remix phase view
- `ProjectorFinaleV34View` — projector view for both V3.4 finale phases (pool state, active nodes, queue depth)

### Misc
- Added `songIndex?: number` to `ChapterConfig` (V3.4 track resolution)
- Updated `MetricsPanel` and `ShowControls` to include `finale_vote` / `finale_remix` in phase label/color maps

**Tests:** 378 passing (up from 377 — one new test added by prior work).

---

## 2026-04-08 — V3.3 Quilt Arc: Sorting, Timing, Animation

Automated playback arc system for the quilt finale — staggered entry/exit, energy-based sorting, and sort animation.

### New: `conductor/quilt-arc.ts`
- Pure functions for arc scheduling, cell energy scoring, and sorting algorithm
- Shared pool sorting: all cells treated as one pool, rows filled in priority order (drums first → best consolidation)
- Single-pass (3 zones: medium/high/cooldown) and multi-pass modes
- Weighted energy: `songEnergy[songIndex] * rowWeight[granularType]` — rhythm section dominates perceived energy
- Cell size threshold: ≥4 columns → 4 bars/cell, <4 → 8 bars/cell

### New: Arc types and config
- Added `ArcPhase`, `ArcConfig`, `ArcSchedule`, `ArcState` types to `conductor/types.ts`
- Added arc config block to `config/default-show.json` (song energy, row weights, entry/exit schedules)
- Added `arc` field to `V33FinaleState`, serialization, and client view types

### New: Conductor arc integration (`conductor/conductor.ts`)
- `handleStartPlayback` initializes arc, staggered entry (first row group only)
- `handleAdvanceQuiltColumn` is arc-aware: filters by entered rows, triggers raw→sort and sort→exit transitions on grid loop wraps
- Arc handlers: `handleArcEntryRowGroup`, `handleArcRawComplete`, `handleArcSortComplete`, `handleArcExitRowGroup`, `handleArcComplete`
- `handleTriggerSort`: performer can manually sort the grid during playback

### New: Beat-driven arc timing (`server/timing.ts`)
- Replaced setTimeout-based arc scheduler with `startArcTracking` / `handleArcBeat`
- Entry/exit row groups fire on actual Ableton loop boundaries (beat-counted, not wall-clock)
- Raw→sort and sort→exit transitions driven by conductor grid loop wraps (no timer needed)
- Fixed fractional `loopBeats` issue: `Math.round()` prevents float comparison drift

### New: Audio routing (`server/audio-router.ts`)
- `handleQuiltRowUnmute`: fade-in with `entrySwellBeats` for staggered entry
- `handleQuiltRowMute`: fade-out with `exitFadeBeats` for staggered exit

### New: Sort animation (`components/finale/QuiltGrid.tsx`)
- Rewrote to absolute positioning with owner-keyed cells
- CSS `transition: left 0.5s ease, top 0.5s ease` animates cell position changes during sort
- Row headers absolutely positioned alongside cells

### UI updates
- `useQuilt` hook exposes `arcPhase`
- `QuiltGrid` dims un-entered rows during arc entry phase
- `QuiltRemixControls` shows arc phase/pass indicator + "Sort Grid" button
- `filterStateForClient` sends `arcPhase`/`arcPassIndex` to projector and audience

### Documentation
- Updated `docs/finale.md`: added Automated Playback Arc section, arc commands/events/audio cues
- Updated `DECISIONS.md`: R32-R37 (song energy, row weight, cell size, sort mode, timing, vertical unity)

### Tests
- 44 new tests in `conductor/__tests__/quilt-arc.test.ts`
- 377 tests passing across 13 suites, `tsc --noEmit` clean

## 2026-04-08 — V3.3 Phase 6: Cleanup + finalize migration

Final cleanup phase for the V3.3 "Quilt" migration. All phases complete.

### Config updates
- Updated `default-show.json` description to reference quilt-based finale (was "Incredibox-style")

### Stale reference audit
- Fixed `conductor/conductor.ts` comment: `finale_live_mix` → `finale_preview` + `finale_playback`
- Fixed `server/index.ts` backup phase list: added `finale_preview` + `finale_playback`, removed `finale_live_mix`
- Fixed `server/__tests__/timing.test.ts`: replaced all `finale_live_mix` references with `finale_playback`, updated stale stub tests to expect `ADVANCE_QUILT_COLUMN` command
- Updated `db/schema.sql` header to V3.3

### Doc pass
- Updated `ARCHITECTURE.md`: V3.2 → V3.3 header, quilt-based finale description, updated folder structure (removed LiveMix/assignment files, added Quilt files), updated test name examples, marked V3.3 appendix as complete
- Updated `CLAUDE.md`: removed V3.3 migration section (migration done), rewrote finale paragraph for quilt model, updated folder structure, updated show phase state machine, updated common patterns (quilt state replaces mix state)

### Tests
- 333 tests passing across 12 suites, `tsc --noEmit` clean

## 2026-04-07 — V3.3 Phase 3: Server wiring + persistence

Wired the V3.3 quilt conductor to the server layer: sockets, persistence, audio routing, and timing.

### Updated: `server/socket.ts`
- Removed V3.2 events: `select_type`, `set_preference`, `group_update`, `mix_state`, `assigned`, `type_locked`/`type_unlocked`
- Added V3.3 client→server: `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell`, `change_song`
- Added V3.3 server→client: `quilt_state` (~4 Hz), `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered`
- Replaced `mix_state` broadcast with `quilt_state` broadcast (unified interval)
- Updated state filtering for projector and audience to use quilt grid instead of live mix data
- Removed `getLoopPosition` parameter (no longer needed)

### Updated: `server/persistence.ts`
- Replaced `saveFinaleAssignment`/`getFinaleAssignments`/`saveMixEvent`/`getMixEvents` with `saveQuiltCell`/`getQuiltCells`/`saveRemixEvent`/`getRemixEvents`
- Added migration v6: `finale_quilt_cells` (with UNIQUE on show_id+cell_id for upsert) and `finale_remix_events`

### Updated: `db/schema.sql`
- Added `finale_quilt_cells` and `finale_remix_events` table definitions
- Marked `finale_assignments` and `finale_mix_events` as deprecated

### Updated: `server/audio-router.ts`
- Removed `live_mix_crossfade` and `live_mix_start` handlers
- Added `quilt_playback_start`, `quilt_column_change`, `quilt_reorder`, `quilt_mute_cell`, `quilt_unmute_cell` handlers

### Updated: `server/timing.ts`
- Replaced all `finale_live_mix` references with `finale_playback`
- Added preview timer: starts on `PREVIEW_STARTED`, fires `PREVIEW_COMPLETE` + `ADVANCE_PHASE` on expiry
- Added early preview completion when all users lock in
- Added preview timer recovery on server restart

### Tests
- Updated persistence tests: replaced V3.2 assignment tests with V3.3 quilt cell + remix event tests
- Updated audio-router tests: replaced `live_mix_crossfade`/`live_mix_start` with `quilt_playback_start`/`quilt_column_change`/`quilt_mute_cell`/`quilt_unmute_cell`
- 333 tests passing across 12 suites, `tsc --noEmit` clean

### Docs
- Updated `docs/server-protocol.md`: new event tables, schema, recovery notes
- Updated `docs/audio-engine.md`: quilt playback section replaces live mix section

## 2026-04-07 — V3.3 Phase 2: Quilt conductor logic

Pure conductor implementation for the V3.3 Quilt finale. All functions are pure (no I/O) and fully tested.

### New: `conductor/quilt.ts`
- `createQuiltGrid()` — initializes grid (6 rows × N columns) scaled to audience size
- Cell claiming: `claimCell`, `releaseCell`, `assignRemainingUsers`
- Preview: `setCellSong`, `lockInChoice`, `assignDefaultSongs`
- Audience remix: `moveCell` (validates scope, cooldown, cross-row, locked cells), `changeCellSong`
- Performer operations: `reorderColumn`, `swapCells`, `lockCell/unlockCell`, `muteCell/unmuteCell`, `overrideCellSong`
- Track resolution: `resolveTrack(trackMap, granularType, songIndex) → trackIndex`
- Playhead: `advancePlayhead` (follows columnOrder, wraps with loopCount)
- Helpers: `buildTrackMap`, `deriveAvailableSongs`, `deriveColumnCount`

### Updated: `conductor/conductor.ts`
- All V3.3 command handlers wired up (CLAIM_CELL, RELEASE_CELL, SET_CELL_SONG, LOCK_IN_CHOICE, START_PREVIEW, PREVIEW_COMPLETE, START_PLAYBACK, MOVE_CELL, CHANGE_CELL_SONG, REORDER_COLUMN, SWAP_CELLS, LOCK_CELL, UNLOCK_CELL, MUTE_CELL, UNMUTE_CELL, OVERRIDE_CELL_SONG)
- Phase transitions: finale_assignment → finale_preview → finale_playback auto-triggered on ADVANCE_PHASE
- SETUP_FINALE now initializes quilt grid from audience size, derives availableSongs and trackMap from fragments
- ASSIGNMENT_COMPLETE assigns remaining unclaimed users to empty cells

### Rewritten: `conductor/assignment.ts`
- V3.3 cell-claiming model: `autoAssignCells` (round-robin into quilt grid), `getUnclaimedUsers`
- Old V3.2 type-group assignment functions removed

### Deleted: `conductor/live-mix.ts`
- V3.2 majority voting / recency tiebreak logic removed (replaced by quilt cell logic)

### Tests
- New: `conductor/__tests__/quilt.test.ts` — 56 tests covering all quilt pure functions
- Rewritten: `conductor/__tests__/assignment.test.ts` — 9 tests for V3.3 cell assignment
- Deleted: `conductor/__tests__/live-mix.test.ts`
- All 331 tests passing across 12 suites, `tsc --noEmit` clean

### Types
- Added `CELL_UNLOCKED` event to `ConductorEvent` union

## 2026-04-07 — V3.3 "Quilt" finale redesign — context setup

Spec installed as `docs/finale.md`. The V3.2 live mix finale is replaced by the Quilt model: a grid where rows = granular types, columns = time slices, and each cell holds a song choice (0, 1, 2). New phases: `finale_preview` (private exploration) + `finale_playback` (quilt plays + remix). See `V33-MIGRATION-PLAN.md` for implementation phases.

- Updated CLAUDE.md with V3.3 migration section and deprecated file list
- Updated ARCHITECTURE.md: terminology (Quilt, Cell, Song Choice), state machine (`finale_preview` + `finale_playback`), Appendix E
- Updated DECISIONS.md: resolved decisions R24-R31, open questions O9-O10

## 2026-04-05 — Per-option chapter colors, audience build UI redesign, server-driven intrusive thoughts with projector physics

**Context:** Three connected changes: (1) visual differentiation of A/B option choices throughout the show, (2) audience phone UI redesign for song-building matching a canvas-based mockup, (3) server-distributed intrusive thoughts that appear on both audience phones and the projector as physics-based membrane bubbles.

### Per-option chapter colors
- Each chapter now has 3 colors: `color` (primary/seed), `colorA`, `colorB` — defined in `ChapterConfig` and `config/default-show.json`
- `ChapterIdentity` in `lib/identity.ts` extended with `colorA`/`colorB` + `getChapterOptionColor()` helper
- Updated across all consumers: projector canvas renderers (audition, reveal, skeleton), song-building components (OptionCards, LayerProgress, RevealSequence), finale components (ElegyGrid, LiveMixController, LiveMixProjector, LiveMixSpectator), controller (LiveMixControls)
- Projector `FINALE_CHAPTER_COLORS` now has `primary`/`A`/`B` per chapter; `MixStateInput` includes `nodeOptions`

### Audience build UI redesign
- New `MiniSkeleton.tsx` — canvas-drawn mini pentagon for audience phones (reuses shared.ts geometry + membranes)
- Rewritten `OptionCards.tsx` — cleaner card design with "NOW PLAYING" label, vote dots, per-option colors, and inline reveal mode (fill bars + percentages + "CHOSEN" badge)
- New `AuditionBars.tsx` — depleting progress bars replacing the old filling `AuditionProgress`
- New `LayerDots.tsx` — 3 simple dots replacing the old `LayerProgress` strip
- `BuildView` component in `audience/page.tsx` composes: MiniSkeleton → OptionCards → AuditionBars → LayerDots → hints
- Added `layerPlan` to `AudienceAttemptView` for the mini skeleton to derive node states

### Server-driven intrusive thoughts
- **Server is single source of truth**: `conductor/intrusive-thoughts.ts` has pure `assignThoughts()` function drawing from shared pool without replacement per user
- **Config**: `IntrusiveThoughtsConfig` now has `thoughtsPerPerson: [1, 3, 5]` (escalating per layer) and `pool: string[][]` (~15 strings per layer per chapter)
- **Socket events**: `thoughts_assigned` (server→audience), `dismiss_thought` (audience→server), `thought_dismissed` (server→projector), `thoughts_state` (server→projector bulk), `thoughts_clear` (layer change)
- **Audience**: `useIntrusiveThoughts` hook subscribes to server events; `IntrusiveThoughts.tsx` renders individually-draggable thought bubbles with rounded styling + sub-bubble tails; supports both touch and mouse; thoughts block reveal result until all dismissed
- **Projector**: Physics-based membrane bubbles in `thoughts-physics.ts` — circle/oval collision, gravity scaled by size, allowed overlap for organic piling, `smoothNoise` membrane rendering matching pentagon aesthetic, sub-bubble tails. Renders on top of stakes/verdict. Dismissed thoughts fling off-screen.
- **Recovery**: Audience reconnect gets remaining thoughts; projector reconnect gets full snapshot
- **Testing**: `server/tools/simulate-audience.ts` — 40+ simulated clients for load testing
- 303 tests passing

## 2026-04-02 — Projector Visual Spec Phase 1+2: Canvas skeleton, audition, two-beat reveal

**Context:** Replaces the DOM-based projector song-building view with a Canvas 2D pentagon skeleton visualization, per `PROJECTOR-VISUAL-SPEC.md`. Adds a two-beat manual reveal: the performer controls when stakes (threshold) and verdict (vote result) are shown via controller buttons.

**Key changes:**
- Created `components/projector/ProjectorCanvas.tsx` — fullscreen canvas with DPR-aware sizing and `requestAnimationFrame` render loop
- Created `components/projector/useProjectorState.ts` — derives visual state from conductor state
- Created `components/projector/renderers/` — pure drawing functions for skeleton, audition labels, and reveal animations
- Modified `app/projector/page.tsx` — `attempt_build` case now renders `<ProjectorCanvas>`
- Added `REVEAL_STAKES` command + `REVEAL_STAKES_SHOWN` event to conductor types
- Added `ADVANCE_FROM_VERDICT` command — timing engine fires this after verdict animation, separating verdict display from state advance
- Split `ADVANCE_FROM_REVEAL` so it sets locked_in/collapsed without auto-advancing; `ADVANCE_FROM_VERDICT` handles the advance
- Removed auto-advance timer from revealing phase in timing engine; reveal is now fully manual
- Added `revealStakesShown` boolean to `AttemptState` for refresh-safe state tracking
- Added "Show Stakes" and "Reveal Votes" controller buttons in `VotingControls.tsx`
- 302 tests passing (5 new REVEAL_STAKES tests), 1 pre-existing audio-router flake

## 2026-03-27 — Replace melody with seed + muted live mix start + voteable silence

**Context:** The "melody" granular type was always empty (melody is performed live). Live seed tracks from song-building were discarded after each attempt. This change makes live seed tracks reusable as finale fragments, adds a muted live mix start, and introduces silence as a voteable option.

**Key changes:**
- Replaced `melody` granular type with `seed` across types, config, identity, and UI
- Seed fragments are generated from each attempt's `liveSeed` config (one per attempted song, no A/B)
- Removed melody tracks from Song 3's flesh layer; flesh now contains only harmony + pad
- Live mix starts fully muted — no transport, no audio, no pre-set votes
- First group to reach majority on a real fragment triggers Ableton transport playback
- Voteable silence: `MUTE_FRAGMENT_ID` (`__mute__`) is a valid vote target alongside real fragments. When a type's majority votes for silence, audio fades out. When they vote back to a fragment, audio fades in. Displayed as a "Silence" card in the audience UI.
- Controller shows "Muted" badge when a type's active fragment is the mute sentinel
- Added `transportStarted` field to `V32FinaleState.liveMix` to track first-activation
- Updated serialization layer to include `transportStarted`
- Updated all tests (297 passing, 1 pre-existing audio-router timing flake)
- Updated docs: ARCHITECTURE.md, CLAUDE.md, finale.md, audio-engine.md, data-models.md, song-building.md, client-routes.md

## 2026-03-26 — V3.2 Migration Phase 4: UI Components + Dead Code Cleanup

**Context:** Completes the client layer of the V3.2 migration. Replaces V3.1 components with config-driven V3.2 equivalents, adds missing projector and controller UIs for the live mix phase, and removes all dead V3.1 code.

**Key changes:**
- Created `components/finale/AssignmentCards.tsx` — config-driven replacement for V3.1 AssemblyCards, uses `GranularType` props instead of hardcoded `LayerType` + `LAYER_ORDER`
- Created `components/finale/AssignmentIdentity.tsx` — replaces GroupIdentity with `GranularType`
- Created `components/finale/LiveMixProjector.tsx` — projector visualization with per-type rows, consensus bars, chapter colors, lock indicators; subscribes to `mix_state` at ~4 Hz
- Created `components/controller/LiveMixControls.tsx` — performer controls with per-type override dropdowns, lock toggles, vote distribution bars; subscribes to `mix_state` at ~4 Hz
- `app/audience/page.tsx`: Replaced AssemblyCards/GroupIdentity with AssignmentCards/AssignmentIdentity, threads `granularTypes` from config
- `app/projector/page.tsx`: Added assignment visualization (type cards with live counts) + LiveMixProjector for `finale_live_mix`
- `app/controller/page.tsx`: Added LiveMixControls during `finale_live_mix`
- `conductor/types.ts`: Added `granularTypes` to `AudienceClientState.config`
- `server/socket.ts`: Added `granularTypes` to audience config in `filterStateForClient`
- Deleted 12 V3.1 files: AssemblyCards, GroupIdentity, DeliberationBoard, AudioPreview, CeremonyView, AltarReady, MixingMirror, MixingSurface, AssemblyControls, DeliberationControls, CeremonyControls, useAltarDetection

**Tests:** 296 passing (unchanged). 2 pre-existing audio-router flakes.
**Type check:** Clean (zero errors).

**Remaining:** Manual walkthrough testing, ARCHITECTURE.md/docs update to remove V3.1 references.

## 2026-03-26 — V3.2 Migration Phase 3: Live Mix Conductor Logic + Server Wiring

**Context:** Implements the core Incredibox-style live mix mechanics — the finale's central interaction where audience members collaboratively control granular audio fragments in real time via majority voting with recency tiebreak.

**Key changes:**
- Created `conductor/live-mix.ts`: `getActiveFragment()` (majority + recency tiebreak), `recalculateActiveFragments()` (respects locks/overrides), `computeInitialFragments()` (picks highest winning proportion per type)
- `conductor/conductor.ts`: Replaced 5 stub handlers with full implementations — `handleSetLiveMixPreference` (validates assignment/lock, updates votes, emits crossfade), `handleLockGranularType`, `handleUnlockGranularType` (recalculates on unlock), `handleOverrideFragment`, `handleClearOverride` (reverts to vote-based). Updated `handleStartLiveMix` to compute initial fragments, initialize all user votes, and emit `live_mix_start` audio cue.
- `conductor/index.ts`: Exports live-mix functions
- `server/socket.ts`: Added `set_preference` handler (derives granularType from assignment), `mix_state` broadcast at ~4 Hz during live mix (audience gets own-type detail, projector/controller get full distributions), `type_locked`/`type_unlocked` broadcast on lock/unlock events, persistence for lock/unlock/override commands
- `db/schema.sql`: Added `finale_mix_events` table + index
- `server/persistence.ts`: Migration v5, `saveMixEvent()`/`getMixEvents()` methods, updated `PersistenceLayer` interface

**Tests:** 296 passing across 12 suites. 19 new live-mix tests (unit + integration). 2 pre-existing audio-router flakes unchanged.

**Type check:** Clean (`npx tsc --noEmit` — zero errors)

**Remaining (P2-P4):** See `MIGRATION-V3.2-TODO.md` — UI components (LiveMixProjector, LiveMixControls, AssignmentCards replacement), dead code cleanup.

## 2026-03-26 — V3.2 Migration Phase 2: Assignment Phase & Finale Pipeline Rewrite

**Context:** Replaces the V3.1 four-phase finale pipeline (assembly/deliberation/ceremony/performer_mix) with the V3.2 two-phase design (assignment/live_mix). Removes ambassador, altar, and ceremony mechanics. Introduces granular type assignment (auto or self-select) with live mix stubs for the next task.

**Key changes:**
- `conductor/types.ts`: Replaced `ShowPhase` (4 old finale phases -> 2 new), removed `FinaleState`/`FinaleConfig`/`PendingChange` (replaced by `V32FinaleState`/`V32FinaleConfig`), replaced ~24 old finale commands with 8 new (assignment + live mix), replaced ~18 old events with 6 new, updated `AudioCue` (`ceremony_activate`/`mix_update` -> `live_mix_crossfade`/`live_mix_start`), updated `AudienceFinaleView`/`ProjectorFinaleView` for V3.2
- Created `conductor/assignment.ts`: `autoAssign()` (Fisher-Yates + round-robin), `initializeSelfSelect()`, `selectGranularType()`, `assignUndecided()`
- `conductor/conductor.ts`: Updated phase sequence (15 phases, was 17), replaced `handleSetupFinale` to use `generateGranularFragments()` + `V32FinaleState`, added assignment handlers, live mix handlers are stubs
- Deleted: `conductor/assembly.ts`, `deliberation.ts`, `ceremony.ts`, `performer-mix.ts` + 5 test files
- `lib/serialization.ts`: Rewritten for `V32FinaleState` Maps (assignment.groups, liveMix.votes/activeFragments/performerOverrides)
- `server/socket.ts`: Replaced `join_group`/`group_vote`/`volunteer_ambassador`/`altar_lock_in` with `select_type`, updated `filterStateForClient` for V3.2, updated `broadcastEvents` (removed ceremony events, added `GROUPS_ASSIGNED` handler)
- `server/persistence.ts`: Added v4 migration (`finale_assignments` table), replaced old persistence methods with `saveFinaleAssignment`/`getFinaleAssignments`
- `server/timing.ts`: Replaced assembly/deliberation/ambassador timers with assignment timer, updated loop boundary tracking for `finale_live_mix` (stub)
- `server/audio-router.ts`: Replaced `ceremony_activate`/`mix_update` handlers with `live_mix_crossfade`/`live_mix_start`
- `config/default-show.json`: Replaced `finale` contents with V3.2 shape (`assignmentMode`, `assignmentTimerMs`, etc.), removed `v32Finale` key
- `db/schema.sql`: Added `finale_assignments` table, marked old tables as deprecated

**Tests:** 270 passing across 10 suites. 19 new assignment tests. 2 pre-existing audio-router timing flakes unchanged.

**Docs updated:** ARCHITECTURE.md (phase diagram, folder structure, open questions), docs/finale.md (full rewrite), docs/data-models.md (FinaleConfig, commands, events, AudioCue), docs/server-protocol.md (WebSocket events, schema, recovery)

**Not included (separate tasks):** Client UI components (app pages, finale components, controller components still reference old types — tsc errors expected in client files). Live mix conductor logic (handlers are stubs).

## 2026-03-26 — V3.2 Migration Phase 1: Type System Foundation

**Context:** First phase of the V3.2 migration (bundled layer groups + Incredibox-style finale). Adds all new V3.2 type definitions alongside existing V3.1 types. No conductor logic, server, or UI changes — purely additive type groundwork.

**Key changes:**
- `conductor/types.ts`: Added new `// V3.2 Types` section with:
  - `V32_LAYERS_PER_ATTEMPT = 3` constant (existing `LAYERS_PER_ATTEMPT = 6` untouched)
  - Core abstractions: `GranularType`, `GranularTrackRef`, `TrackBundle`, `LayerGroupId`, `LayerGroupConfig`, `LayerGroup`, `LiveSeedConfig`
  - Attempt config: `V32LayerConfig`, `V32AttemptConfig` (3 layer groups + live seed per attempt)
  - Finale types: `GranularFragment`, `LiveMixVote`, `V32FinaleConfig`, `V32FinaleState`
  - Client types: `AuditionProgress` (bar-level progress for audition UI)
  - Show config: `V32ShowConfig` (with `granularTypes[]` and `layerGroups[]` registries)
- `config/default-show.json`: Added V3.2 config alongside existing V3.1 config:
  - `granularTypes`: 6 granular type definitions (bass, drums, pad, melody, harmony, fx)
  - `layerGroups`: 3 group definitions (bones/flesh/spark) referencing granular types
  - `v32Attempts`: 3 attempts with `liveSeed` + `TrackBundle` structure, staggered per V3.2 spec
  - `v32Finale`: Slim config (assignmentMode, bothOptionsSurvive, crossSongConstraint)

**Design rationale:** All new types are additive (V32-prefixed where they shadow existing types). Existing V3.1 types, constants, and consumers are untouched. This allows incremental migration — the conductor logic phase will swap references from V3.1 to V3.2 types, then the V3.1 types and V32 prefixes are removed in cleanup.

**No tests changed.** Compilation clean. 336/338 tests passing (same 2 pre-existing failures).

## 2026-03-20 — V3.1 Migration Phase 9: Config & Environment

**Context:** Phase 9 finalizes configuration changes. Most config (`default-show.json`, `ableton-layout.json`, `conductor/types.ts`) was already V3.1-compliant from earlier phases. This phase adds runtime config validation and removes dead code.

**Key changes:**
- `server/index.ts`: Added `validateShowConfig()` — validates per-attempt array lengths (thresholds, tempos, auditionBars, layers all === 6), threshold ranges [0,1], positive tempos, positive integer auditionBars, `bothOptionsSurvive` is boolean, `ceremonyLayerOrder` has 6 unique valid LayerType entries. Server refuses to start with bad config.
- `server/index.ts`: Removed dead `_DEFAULT_DRAIN_FACTOR` and `_DEFAULT_LAYER_MULTIPLIERS` declarations (health bar remnants, unused since Phase 1-2).
- `.env.example`: Fixed `CEREMONY_LAYER_ORDER` example from `fx1,fx2` to `fx`.

## 2026-03-20 — V3.1 Migration Phase 8: Reveal Sequence & UI

**Context:** Phase 8 replaces the health bar drain with per-layer doubt threshold visualization, adds escalating urgency effects on audience phones, and implements collapse-as-release. The conductor threshold infrastructure was already complete from Phases 1-2; this phase is entirely client-side.

**Key changes:**
- `server/socket.ts`: Populated `lastThresholdCheck` in `filterStateForClient` audience branch — previously hardcoded to `null`. Now reads from `attempt.layerResults` when in `revealing` phase.
- `components/song-building/RevealSequence.tsx`: Rewritten. Replaced `drain` beat and `HealthBar` dependency with `threshold` beat showing an animated consensus bar vs. threshold line. Pass: bar clears line with green glow. Fail: bar stops short with red pulse. Lock-in beat skipped on fail. Projector still shows vote counts.
- `components/song-building/ThresholdDisplay.tsx`: New component (projector). Shows all 6 threshold marks as a stepped escalation bar; current layer's threshold emphasized. Visible during auditioning before the vote opens.
- `components/song-building/UrgencyEffects.tsx`: New component (audience). Wrapper that applies `.urgency-N` CSS classes (N = layerIndex). When `collapsed=true`, strips all classes instantly.
- `app/globals.css`: Added urgency keyframe animations (`urgency-drift-subtle/medium/heavy`, `urgency-timer-pulse`, `urgency-jitter/jitter-heavy`) and `.urgency-0` through `.urgency-5` class rules targeting `.urgency-cards` and `.urgency-timer` child selectors.
- `app/audience/page.tsx`: Integrated `RevealSequence` (rendered during `revealing` phase) and `UrgencyEffects` (wraps OptionCards during auditioning). Collapse strips urgency instantly.
- `app/projector/page.tsx`: Added `ThresholdDisplay` (shown during auditioning), `RevealSequence` (shown during revealing). Updated `CollapseOverlay` from red alarm to 0.6s fade-to-black (collapse is release).
- `components/song-building/HealthBar.tsx`: Deleted. No remaining consumers.

**Deviations from spec:**
- `HealthBarControls.tsx` listed for deletion in 8.5 — file did not exist (already absent from prior phases). No action needed.
- Audio urgency (return track degradation per layer, deferred from Phase 7) is **not** in this phase — requires Ableton session configuration that isn't ready. CSS urgency effects (8.3) are implemented.

## 2026-03-19 — V3.1 Migration Phase 7: Track Layout & OSC

**Context:** Phase 7 described updating Ableton track mapping for 36 tracks. Track indices are config-driven (not computed at runtime), and `default-show.json` was already updated to 36 tracks in earlier phases.

**Key changes:**
- Updated `config/ableton-layout.json`: `maxLayersPerAttempt` 7→6, comments updated (42→36 tracks, live performance tracks at 36+ instead of 42+).
- Audio urgency (return track degradation per layer, section 7.3) deferred to Phase 8 with other urgency effects.

## 2026-03-19 — V3.1 Migration Phase 6: Finale Updates (6 Layer Types)

**Context:** Phase 6 verifies all finale phases use 6 layer types (not 7). Prior phases already migrated all runtime code and UI components. This phase fixes remaining stale references.

**Key changes:**
- Fixed 3 stale comments referencing "7 groups" in `conductor/types.ts` and `conductor/assembly.ts`.
- Fixed test parameterization in `conductor/__tests__/finale-integration.test.ts` — 3 setup functions were creating configs with 7 layers but only assigning 6 layer types.
- Fixed fragment count assertion in `SETUP_FINALE` test to match `bothOptionsSurvive: true` behavior (12 available, 0 locked).
- Verified: all conductor modules (assembly, deliberation, ceremony, performer-mix, fragments), UI components, config, and identity mappings already correctly use the 6-layer model. 338 tests passing (same 2 pre-existing audio-router failures).

## 2026-03-19 — V3.1 Migration Phase 4: Tempo & Timing

**Context:** Per-layer tempos were defined in config but never sent to Ableton during song-building. Phase 4 wires up OSC tempo changes at each layer start, plus resets between songs and at finale.

**Key changes:**
- **`set_tempo` AudioCue**: New cue type emitted by conductor at layer start (in `handleStartAudition()` and `handleRerunVote()`), before `audition_start`. Carries per-layer BPM from `AttemptConfig.tempos[]`.
- **Audio-router `handleSetTempo()`**: Sends `/live/song/set/tempo` via OSC.
- **`routerState.baseTempo`**: Derived from config (`attempts[0].tempos[0]`) at runtime, replacing hardcoded `NOMINAL_TEMPO_BPM` (120) in all tempo reset paths.
- **Tempo resets**: On collapse (via `clearCollapseTimers`), on rejection (after effect fades), on `ATTEMPT_COMPLETED`, and at `finale_elegy` phase change.
- **Tests**: 3 new conductor tests (set_tempo emission, ordering, per-layer BPM). 5 new audio-router tests (OSC send, baseTempo config derivation, rejection reset, finale_elegy reset). 333 passing, same 2 pre-existing audio-router failures.

## 2026-03-19 — V3.1 Migration Phases 2 & 3: Threshold Mechanic + Per-Layer Audition Timing

**Phase 2 — Threshold Mechanic:**
- Created `conductor/threshold.ts` with `checkThreshold()` pure function (~20 lines). Independently testable with exact vote counts.
- Updated `conductor/conductor.ts` to import and call `checkThreshold()` instead of inline threshold logic in `resolveCurrentLayer()`.
- Exported `checkThreshold` from `conductor/index.ts`.
- Added 7 unit tests in `conductor/__tests__/threshold.test.ts` covering all edge cases from MIGRATION-v3.1.md.
- Cleaned up 3 stale health-bar references in `conductor/__tests__/conductor.test.ts` comments.

**Phase 3 — Per-Layer Audition Timing:**
- `TimingConfig` simplified: removed `auditionDurationMs`, `votingWindowMs`, `auditionsPerLayer`. Renamed `beatsPerLoop` → `loopBoundaryBeats` (used only for performer mix loop boundaries).
- Audition timing now reads per-layer `auditionBars[layerIndex]` and `tempos[layerIndex]` from `AttemptConfig` instead of global config.
- Loop structure simplified: A-B-A-B (4 loops via `auditionsPerLayer=2`) → A-then-B (2 loops). Each option plays once.
- Added exported `barsToMs()` utility in `server/timing.ts`.
- Rewrote `startAuditionTracking()` for per-layer config. Removed legacy flat-timer mode (3 modes → 2: OSC beat-synced + fallback JS interval).
- No `votingWindowMs` state field — Ableton/timing engine is source of truth for audition end; votes accepted when phase is `'auditioning'`, rejected otherwise.
- Updated `server/socket.ts`: `auditionTotalLoops` is now constant `2`.
- Updated `config/default-show.json`, `docs/data-models.md`, and all 6 test fixture files.
- 325 tests passing (same 2 pre-existing audio-router failures). `tsc --noEmit` clean.

## 2026-03-19 — V3.1 Migration Phase 1: Types & Constants

**Context:** Phase 1 of the V3.1 migration. Updates all shared type definitions and constants so that subsequent phases (threshold mechanic, merged auditioning+voting, tempo, etc.) have a stable foundation. See `MIGRATION-v3.1.md` for the full migration plan.

**Key changes:**
- **7 layer types → 6**: Removed `fx1` and `fx2`, added `fx`. Updated across all conductor modules, components, tests, config, and identity mappings.
- **Health bar removed**: Deleted `HealthBarState`, `HealthBarDrain` interfaces, `health-bar.ts` module, and all health bar test file. Removed `drainFactor` and `layerMultipliers` from `AttemptConfig`; replaced with `thresholds`, `tempos`, `auditionBars` arrays (all length 6).
- **`LAYERS_PER_ATTEMPT = 6`**: Updated constant and all references.
- **`LayerPhase` simplified**: Removed `'voting'` (voting now concurrent with `'auditioning'`). Removed all standalone `'voting'` phase checks across conductor, server, components, and hooks.
- **`LayerResult` new shape**: `consensus`/`drainAmount` → `winningProportion`/`thresholdRequired`/`passed`.
- **`Fragment` gains `wonVote: boolean`**: Marks whether a fragment won its blind vote.
- **`FinaleConfig` gains `bothOptionsSurvive: boolean`**: Configures whether losing options are available in finale.
- **Commands removed**: `OPEN_VOTING`, `SET_DRAIN_FACTOR`, `SET_HEALTH`.
- **Events updated**: Removed `HEALTH_BAR_DRAINED`, added `THRESHOLD_CHECK`.
- **Config**: `default-show.json` updated with 6-layer stagger tables, per-layer thresholds/tempos/auditionBars, `bothOptionsSurvive`, and 6-entry `ceremonyLayerOrder`.
- **Identity**: `lib/identity.ts` updated — `fx1`/`fx2` entries replaced with single `fx` ("The Shimmer", `~`).
- **Components**: Removed HealthBar/RevealSequence usage from audience and projector pages (compile fixes only — component files remain for Phase 8 deletion). Removed `'voting'` phase checks from `VotingControls`, `LayerProgress`, `useShowState`.
- **Tests**: 315 passing (2 pre-existing audio-router failures unrelated to migration). Deleted `health-bar.test.ts`. Updated all test files for fx→fx, 7→6, threshold shape, removed drain assertions.

**Deviations from MIGRATION-v3.1.md:** Kept `'auditioning'` as the LayerPhase name (not `'auditioning_and_voting'`) and kept `START_AUDITION` as the command name (not `START_LAYER`). These are semantic — the behavior change (concurrent voting during auditioning) is already implemented.

## 2026-03-18 — Merge Auditioning and Voting Phases

**Context:** The song-building flow previously had a silent `voting` phase after auditioning stopped — audio faded out while audience voted in silence. This change makes auditioning (A/B option cycling) continue throughout the voting window, eliminating the dead-air gap. Votes were already accepted during auditioning, so the `voting` phase was functionally redundant.

**Changes:**
- `conductor/conductor.ts`: `OPEN_VOTING` is now a no-op (returns `[]`). `resolveCurrentLayer()` emits `audition_stop` audio cue before transitioning to `revealing`, since `OPEN_VOTING` no longer handles this.
- `server/timing.ts`: All three audition completion paths (OSC, fallback, legacy) now send `CLOSE_VOTING` directly instead of `OPEN_VOTING`. Removed `handleVotingPhase()` (dead code). Added `stopAuditionTracking()` to the `revealing` case.
- `config/default-show.json`: `auditionsPerLayer` increased from 1 to 3 (6 A/B loops ≈ 48s at 120 BPM, covering old audition + voting duration).
- `app/audience/page.tsx`: `LayerPhaseHint` shows "Tap to vote" / "Vote recorded" during `auditioning` phase (previously only during `voting`).
- `components/controller/VotingControls.tsx`: Removed "Open Vote" button and "+5s"/"+10s" timer extend buttons (no voting timer to extend).
- Tests updated across `conductor.test.ts` and `timing.test.ts`.

**Note:** `LayerPhase` type still includes `'voting'` but it is never entered. `votingWindowMs` config is vestigial. Both can be removed in a future cleanup.

## 2026-03-17 — V3 Migration Phase 1: Types & Data Models (Consensus Game → Assembly/Deliberation/Ceremony)

**Context:** Phase 1 of the V3 finale redesign. The consensus game (convergence meter, timed voting rounds, threshold softening) is replaced by a physically embodied four-phase sequence: group assembly → deliberation → ambassador ceremony → performer mix. This commit updates all TypeScript types, stubs out V2 conductor handlers, and fixes compilation across the entire codebase. No new logic is implemented — that's Phase 2.

**`conductor/types.ts` — core type changes:**
- `ShowPhase`: removed `'finale_consensus'`; added `'finale_assembly' | 'finale_deliberation' | 'finale_ceremony'`
- `FinaleState`: removed `consensusGame` sub-object; added `assembly` (groups Map, undecidedUsers, timers), `deliberation` (nested groupVotes Map, chosenFragments, ambassadors, timers), `ceremony` (layerOrder, currentAmbassador, altarReady, lockedLayers, ceremonyComplete); simplified `npc` (removed `autoTriggersEnabled`)
- `FinaleConfig`: removed all consensus fields; added `assemblyTimerMs`, `assemblyGracePeriodMs`, `deliberationTimerMs`, `ambassadorVolunteerTimerMs`, `ceremonyLayerOrder`, `audioPreviewPath`, `layerLabels`, `npcMessages`
- `Fragment`: added `previewAudioPath: string`
- `NpcTriggerConfig` removed; replaced with `NpcMessageConfig { event: string; layerType?: LayerType; text: string }`
- `GainConfig.consensusSwellBeats` → `ceremonySwellBeats` (all references updated)
- `AudioCue`: `consensus_activate` → `ceremony_activate` (all references updated)
- `ConductorCommand`: removed `START_CONSENSUS_ROUND`, `SUBMIT_CONSENSUS_VOTE`, `END_CONSENSUS_ROUND`, `SET_CONSENSUS_THRESHOLD`; added assembly/deliberation/ceremony command variants
- `ConductorEvent`: removed `CONSENSUS_ROUND_*` events; added assembly/deliberation/ceremony event variants
- `AudienceFinaleView`, `ProjectorFinaleView`: removed consensus fields; added V3 assembly/deliberation/ceremony view fields

**`conductor/conductor.ts`:**
- Updated `PHASE_SEQUENCE` to include the three new phases
- Replaced `handleSetupFinale` FinaleState initialization with V3 sub-objects
- Removed V2 consensus handler functions; added stub `return []` cases for all new V3 commands (TODO: Phase 2)
- Updated `handleStartPerformerMix` to use empty Map instead of `consensusGame.lockedRoles`

**`conductor/npc.ts`:** Rewrote `getNpcMessage()` API — takes `NpcMessageConfig[]`, event string, optional layerType, supports `{layerLabel}` template substitution

**`conductor/fragments.ts`:** `generateFragments` accepts `audioPreviewPath`; sets `previewAudioPath` on each fragment

**`lib/serialization.ts`:** Fully migrated `SerializedFinaleState` — removed `SerializedConsensusGame`; added `SerializedAssembly`, `SerializedDeliberation`, `SerializedCeremony` with proper Map↔array conversion including nested `groupVotes` Map

**Server/UI compile fixes:**
- `server/audio-router.ts`: renamed `consensusSwellBeats` → `ceremonySwellBeats`, `consensus_activate` → `ceremony_activate`
- `app/projector/page.tsx`: replaced `finale_consensus` case with stub cases for `finale_assembly/deliberation/ceremony`
- `app/audience/page.tsx`: updated finale phase routing for V3; removed unused imports
- `app/controller/page.tsx`: updated `FINALE_PHASES` set
- `components/controller/ConsensusControls.tsx`: stubbed out (returns null), pending Phase 4
- `components/controller/MetricsPanel.tsx`: updated phase labels/colors and finale stats display
- `components/controller/NpcControls.tsx`: removed `autoTriggersEnabled` toggle
- `components/controller/ShowControls.tsx`: updated phase list

**Tests:**
- `conductor/__tests__/conductor.test.ts`: updated phase sequence fixture (16 phases now)
- `conductor/__tests__/npc.test.ts`: rewritten for V3 `getNpcMessage` API
- `server/__tests__/persistence.test.ts`, `backup.test.ts`: updated `FinaleConfig` and `FinaleState` fixtures to V3
- `conductor/__tests__/finale-integration.test.ts`, `consensus-game.test.ts`: added `// @ts-nocheck` + `describe.skip` (V2 tests, will be replaced in Phase 2)

## 2026-03-09 — Audio Router Polish: Gain Control, Sub-Beat Interpolation, OSC Source of Truth

**Context:** Refines the audio router's gain-based control model for production use with Ableton. Fixes gain mapping formula, adds sub-beat interpolation for smoother fades, and makes Ableton the single source of truth for transport state and BPM.

**Gain mapping fix:**
- Fixed formula mapping internal gain (0–1) to Ableton Utility parameter range (-1 = muted, 0 = 0 dB). Old formula sent 0 dB when gain was 0 (silence). New formula: `oscValue = -1 + gain * (unityGainValue + 1)`.
- Updated `DEFAULT_GAIN_CONFIG.unityGainValue` from 0.5 to 0 (targets 0 dB).

**Sub-beat interpolation:**
- `fadeGain` now schedules intermediate gain updates between beats via `setTimeout` for smoother fades.
- Added `stepsPerBeat` to `GainConfig` (default: 2). Set to 1 in tests to disable sub-beat timers.
- Added `getBeatDurationMs()` to `TimingEngine` interface — returns beat duration for scheduling sub-beat midpoints.
- Sub-beat timers are cancelled on fade cancellation, silence-all, reset-utilities, and dispose.

**Ableton as source of truth — transport:**
- `ensureTransportStarted()` now queries Ableton's transport state via `/live/song/get/is_playing` before sending `start_playing`. No fast-path guard — always queries Ableton (handles external pause/stop).
- Removed 2 "does not restart transport" tests (only meaningful with real Ableton responses; NullOSCBridge always times out).

**Ableton as source of truth — BPM:**
- Timing engine subscribes to `/live/song/start_listen/tempo` and queries `/live/song/get/tempo` on start.
- `getBeatDurationMs()` now returns `60000 / currentBpm` using Ableton's reported BPM.
- Removed timestamp-based beat duration measurement (`lastBeatTimestamp`, `measuredBeatDurationMs`).

**Controller UI:**
- Added "RESET UTILITIES" button to `EmergencyControls.tsx` Audio group. Sets all Utility gains to 0 dB for free Ableton use without the app interfering.

**Files modified:**
- `server/audio-router.ts` — gain formula, sub-beat interpolation, ensureTransportStarted async
- `server/timing.ts` — BPM from Ableton, getBeatDurationMs
- `server/__tests__/audio-router.test.ts` — async transport tests, sub-beat config
- `conductor/types.ts` — `stepsPerBeat` in GainConfig
- `config/default-show.json` — unityGainValue, stepsPerBeat
- `components/controller/EmergencyControls.tsx` — Reset Utilities button
- `ARCHITECTURE.md` — GainConfig type, RESET_UTILITIES command, tempo/transport OSC addresses

**Tests:** 316 passing across 13 suites.

---

## 2026-03-07 — V2 Migration Phase 7: Configuration & Cleanup

**Context:** MIGRATION.md Phase 7. Aligns all configuration files with V2 types, deletes dead V1 code, and finalises documentation. This completes the V2 migration codebase cleanup.

**Config changes:**
- `config/default-show.json`: Complete rewrite to match V2 `ShowConfig` type. Layer types updated from V1 (`foundation`, `pulse`, `color`, `space`, `voice`, `texture`) to V2 (`melody`, `drums`, `pad`, `bass`, `harmony`, `fx1`, `fx2`). Now 7 layers per attempt with staggered ordering across songs. Added `drainFactor` and `layerMultipliers` per attempt. Removed all `doubtThreshold` fields. Replaced V1 finale section (rotation/triangle/slots) with V2 `FinaleConfig` (consensus game params + inlined NPC auto-triggers). Timing fields updated to match `TimingConfig` (`revealSequenceDurationMs`, `rejectionEffectDurationMs`). Top-level key renamed `maxLayersPerAttempt` → `layersPerAttempt`.
- `config/ableton-layout.json`: Removed `finaleSlotCount`. Added `rejectionReturnTrackIndex`. Added `_comments` documenting track formula and return track purposes.

**Deleted files:**
- `components/controller/DoubtControls.tsx` — V1 component using removed commands (`SET_THRESHOLD`, `FORCE_CONTINUE`, `TOGGLE_DOUBT`). `FORCE_COLLAPSE` button relocated to `ShowControls.tsx`.
- `conductor/consensus.ts` — V1 `resolveVote()` with `doubtThreshold` parameter, superseded by `conductor/voting.ts`.
- `conductor/__tests__/consensus.test.ts` — Tests for deleted `consensus.ts`.

**Modified files:**
- `app/controller/page.tsx`: Removed `DoubtControls` import and usage.
- `components/controller/ShowControls.tsx`: Added `Force Collapse` danger button (visible during `attempt_build` while `in_progress`).
- `components/controller/VotingControls.tsx`: Fixed V1 phase name `'resolving'` → V2 `'revealing'` in three places.
- `components/controller/EmergencyControls.tsx`: Removed buttons sending invalid V2 commands (`TRIGGER_COLLAPSE_GESTURE`, `RESET_LAYER`).
- `conductor/types.ts`: Updated doc comment reference from `ARCHITECTURE-V2.md` → `ARCHITECTURE.md`.

**Renamed:**
- `ARCHITECTURE-V2.md` → `ARCHITECTURE.md` (now the canonical spec)

---

## 2026-03-07 — V2 Migration Phase 6: Finale UI

**Context:** MIGRATION.md Phase 6. Builds all V2 finale UI components and wires them into the three page routes. Replaces the V1 rotation/queue/triangle/stewardship UI (FragmentSelector, TriangleSteering, StewardSlider, SlotCard, SlotGrid) with the V2 elegy → consensus game → performer mix flow. Also fixes `server/socket.ts` `filterStateForClient` to produce shapes that match the V2 `AudienceFinaleView` and `ProjectorFinaleView` types, and updates MetricsPanel/ShowControls to use V2 phase names.

**New files:**
- `hooks/useConvergence.ts` — Subscribes to `convergence_update` socket events and applies spring interpolation (RAF loop, exponential ease-out, tau ~100ms) for analog-feel meter animation. Returns `animatedValue`, `isAboveThreshold`, `timeRemaining`.
- `components/finale/ElegyGrid.tsx` — Non-interactive display of all fragments (available + locked) organized by layer type (7 rows). Winners glow with chapter color + boxShadow; losers dim to 0.25 opacity + saturate(0). Supports `variant="audience"` (compact) and `variant="projector"` (large, dramatic). Uses `getChapterIdentity` / `getLayerIdentity`.
- `components/finale/ConvergenceMeter.tsx` — Full-width bar meter, no numbers. Fill color shifts to green when above threshold; glow boxShadow activates. Threshold zone marked. Subtle round timer below bar (shrinks from right, turns red at <20%). Accepts spring-interpolated values from `useConvergence`.
- `components/finale/ConsensusBoard.tsx` — Interactive voting board. Groups available fragments into role rows (locked roles compress to glowing badges at top; unlocked rows fill remaining space). Tap to vote/change vote; voted tile gets white border highlight. Round failure: shake animation via translateX cycling. Round success: burst glow on winning tile.
- `components/finale/NpcDisplay.tsx` — Subscribes directly to `npc_message` socket events (bypasses state_sync). Typewriter animation at ~30ms/char using setInterval. `"Courier New"` monospace, green (#4ade80). Auto-fades (opacity 0) after configurable display duration (default 5s). Block cursor appended.
- `components/finale/LoopIndicator.tsx` — Horizontal progress bar showing 8-bar loop position (0.0–1.0). Shows loop count. When pending changes exist and position > 85%: fills amber with glow.
- `components/finale/MixingMirror.tsx` — Read-only projector view of performer mix. 7 rows: layer icon + active fragment label with chapter color. Pending changes rows pulse with dashed border. LoopIndicator at bottom.
- `components/finale/ProjectorConvergenceView.tsx` — Large-format projector convergence visualization. Semi-circular SVG arc meter (180°→0°): fill arc = convergence, threshold marker line, glow when above threshold. Locked roles shown as chapter-colored badges around the arc. Subscribes to `convergence_update` for spring animation (separate from audience path). NpcDisplay integrated.
- `components/finale/MixingSurface.tsx` — 7×6 controller grid (7 layer types × 3 songs × 2 options). Tiles: chapter color background, song/option label, emotional label. Active tile: bright border + glow. Pending tile: dashed border + pulse animation via setInterval cycling opacity. Tap routing: available→queue, active→queue mute, pending→cancel. "Fire N changes" button → `FIRE_PENDING_CHANGES`.
- `components/controller/ConsensusControls.tsx` — Start/End round buttons, convergence value (numeric, controller-only), vote distribution bar chart (controller-only, never shown to audience), leading fragment with chapter color, round number, consecutive failures, threshold range slider → `SET_CONSENSUS_THRESHOLD`, force-lock per unlocked role. Uses `calculateConvergence()` from `conductor/consensus-game.ts`.
- `components/controller/NpcControls.tsx` — Pre-written line bank in 4 categories (Encouragement, Exasperation, Urgency, Celebration). Tap any line → `SEND_NPC_MESSAGE`. Free-text input + Enter/Send → same. Auto-trigger toggle checkbox. Current active message displayed.

**Deleted files:**
- `components/finale/FragmentSelector.tsx` — V1 fragment queue selector
- `components/finale/TriangleSteering.tsx` — V1 barycentric triangle steering
- `components/finale/StewardSlider.tsx` — V1 steward safe-parameter slider
- `components/finale/SlotCard.tsx` — V1 rotation slot card
- `components/finale/SlotGrid.tsx` — V1 7-slot grid
- `hooks/useTriangle.ts` — V1 triangle input + centroid interpolation hooks
- `components/controller/FinaleControls.tsx` — V1 rotation/queue/stewardship controller panel

**Modified files:**
- `server/socket.ts` — Fixed `filterStateForClient` audience case: `myFinale` now matches `AudienceFinaleView` type (`myVote` not `myConsensusVote`; `roundTimeRemaining`; `availableFragments` as `Array<{fragment, locked}>`; `lockedRoles`/`mixActiveLayers` as flat arrays). Fixed projector case: `finaleState` now matches `ProjectorFinaleView` (flat shape, not nested `consensusGame`/`performerMix` sub-objects).
- `app/audience/page.tsx` — Replaced V1 finale view (fragment selection → triangle → steward slider) with V2: `finale_elegy` → ElegyGrid; `finale_consensus` → ConvergenceMeter + NpcDisplay + ConsensusBoard; `finale_performer_mix` → dark placeholder (TBD per ARCHITECTURE-V2 open question). Phase check updated from V1 names to V2.
- `app/projector/page.tsx` — Replaced V1 finale block (SlotGrid + TriangleSteering) with V2 sub-phase routing: `finale_elegy` → ElegyGrid (projector variant); `finale_consensus` → ProjectorConvergenceView; `finale_performer_mix` → MixingMirror. Removed `useTriangleCentroid` hook usage and meterLevels state.
- `app/controller/page.tsx` — Replaced `FinaleControls` with sub-phase-conditional V2 panels: `finale_consensus` → ConsensusControls + NpcControls; `finale_performer_mix` → MixingSurface + NpcControls. Updated `FINALE_PHASES` set to V2 phase names.
- `components/controller/MetricsPanel.tsx` — Updated `PHASE_LABELS`/`PHASE_COLORS` to V2 phase names (added `attempt_resolve`, `finale_elegy`, `finale_consensus`, `finale_performer_mix`; removed V1 finale phases). Replaced V1 finale metrics (rotation, slots, queue, stewards, chapter counts) with V2 (finale sub-phase, convergence value, round, threshold, votes cast, locked count). Removed references to V1 `FinaleState` properties.
- `components/controller/ShowControls.tsx` — Updated `ALL_PHASES` array and `PHASE_LABELS` to V2 phase names.

**Tests:** No conductor tests changed. All pre-existing type errors are from earlier migration phases (DoubtControls, EmergencyControls, VotingControls, conductor test fixtures) — not introduced here.

---

## 2026-03-06 — Song-Building UI: Health Bar System + Reveal Phase Split

**Context:** Replaces the old doubt-based song-building UI (ConsensusBar, DoubtMeter, LayerGrid, OptionCard) with the V2 health bar design. Implements the revealing phase as a true resting state so the 4-beat RevealSequence can play on both audience and projector. All 185 conductor tests passing.

**Critical architectural fix — Revealing phase split:**

Previously `resolveCurrentLayer()` in `conductor.ts` processed `revealing` → `locked_in` atomically — the client never observed `revealing` as a resting state. This made the RevealSequence UI impossible to implement. The fix splits the transition into two steps:
- `CLOSE_VOTING` → resolves vote, calculates drain, stores `currentVoteResult` + `currentDrain` on `AttemptState`, pauses at `revealing`
- `ADVANCE_FROM_REVEAL` → reads stored result, calls `lockInLayer()` or `collapseAttempt()`, clears `currentVoteResult` + `currentDrain`
- Timing engine schedules `ADVANCE_FROM_REVEAL` after `revealSequenceDurationMs` when `LAYER_PHASE_CHANGED` → `revealing` fires

**New files:**
- `components/song-building/HealthBar.tsx` — Horizontal health gauge (0–100). Color interpolates green→yellow→red. `drainShadow` prop shows translucent red preview of pending drain. `audience` variant: 10px height; `projector` variant: 20px height with subtle glow.
- `components/song-building/LayerProgress.tsx` — Horizontal 7-slot strip showing layer history for current attempt. Completed = chapter color background + layer symbol. Current = highlighted border, pulse animation during voting. Future = dimmed layer symbol.
- `components/song-building/OptionCards.tsx` — Two large side-by-side `<button>` elements for A/B voting. Option A = solid fill; Option B = outlined. Blind vote (no live split). After voting: selected card gets white ring glow, other dims to 0.4 opacity. Vote is final. Mobile-optimized.
- `components/song-building/RevealSequence.tsx` — 4-beat reveal animation orchestrated via `useState` + `useEffect` timeouts: Tension (900ms) → Split (2000ms) → Drain (1500ms) → Lock-in (500ms). Winner card grows via flex proportional to consensus. HealthBar animates drain during Drain beat. Projector variant shows exact vote counts; audience variant does not.

**Deleted files:**
- `components/song-building/ConsensusBar.tsx`
- `components/song-building/DoubtMeter.tsx`
- `components/song-building/LayerGrid.tsx`
- `components/song-building/OptionCard.tsx`

**Modified files:**
- `conductor/types.ts` — Added `currentVoteResult: VoteResult | null` and `currentDrain: HealthBarDrain | null` to `AttemptState`; added `{ type: 'ADVANCE_FROM_REVEAL' }` to `ConductorCommand`; added `currentVoteResult`/`currentDrain` to `AudienceAttemptView`; expanded `AudienceAttemptView.healthBar` to include `history: HealthBarDrain[]`
- `conductor/conductor.ts` — Split `resolveCurrentLayer()` to pause at `revealing`; added `handleAdvanceFromReveal()`; updated `lockInLayer()` to handle pre-pushed results (for `FORCE_OPTION` bypass path); added `currentVoteResult: null, currentDrain: null` to all attempt initializations
- `server/timing.ts` — Added `case 'revealing'` to `LAYER_PHASE_CHANGED` switch: schedules `ADVANCE_FROM_REVEAL` after `config.timing.revealSequenceDurationMs`
- `server/socket.ts` — Expanded audience health bar filter to include `history`; added `currentVoteResult` (winner + consensus only, no vote counts) and `currentDrain` to audience attempt view
- `lib/identity.ts` — Fixed `LAYER_IDENTITY` keys from old names (`foundation`, `pulse`, `color`, `space`, `voice`) to match actual `LayerType` values (`melody`, `drums`, `pad`, `bass`, `harmony`, `fx1`, `fx2`)
- `app/audience/page.tsx` — Replaced `LayerGrid` with: `HealthBar` (top, always visible), `LayerProgress` (below health bar), then `RevealSequence` (during `revealing` phase) or `OptionCards` (otherwise). `disabled` when phase ≠ `voting` or user already voted.
- `app/projector/page.tsx` — Replaced `ConsensusBar`/`DoubtMeter` with: `HealthBar` (variant="projector"), then `RevealSequence` or `ProjectorLayerCard` based on `currentLayerPhase`. Vote result computed from full votes array (projector has all votes); drain from `healthBar.history`.
- `conductor/__tests__/conductor.test.ts` — Updated `completeSingleLayer` helper to include `ADVANCE_FROM_REVEAL` after `CLOSE_VOTING`; updated all inline collapse tests similarly
- `conductor/__tests__/finale-integration.test.ts` — Updated `completeSingleLayer` helper to include `ADVANCE_FROM_REVEAL`
- `conductor/__tests__/fragments.test.ts` — Added `currentVoteResult: null, currentDrain: null` to inline `AttemptState` fixtures; fixed `type: 'foundation'` → `type: 'melody'`; removed stale `doubtThreshold` field

**Tests:** 185 passing across 9 conductor suites (unchanged count; all tests updated to two-phase vote resolution).

---

## 2026-03-06 — V2 Migration Phase 4: Server Layer Update

**Context:** MIGRATION.md Phase 4. Updates the entire server layer to compile and work with the V2 conductor. Removes all V1 rotation/stewardship/triangle wiring and replaces with consensus game + performer mix.

**Deleted files:**
- `server/metering.ts` — V1 audio metering service for slot energy levels (no slots in V2)

**Modified files:**
- `conductor/types.ts` — Added `TOGGLE_AUDITION` to `ConductorCommand` (was missing from V2 types, needed by timing engine for beat-synced A/B cycling)
- `conductor/conductor.ts` — Added `handleToggleAudition`: flips `currentAuditionOption` A↔B, increments `auditionLoopIndex`, emits `audition_stop` + `audition_start` AUDIO_CUE + `AUDITION_OPTION_CHANGED`
- `lib/serialization.ts` — Complete rewrite for V2 `FinaleState`: serializes `consensusGame.votes`, `consensusGame.lockedRoles`, `performerMix.activeLayers` Maps to arrays; removed all V1 fields (chapterAssignments, trianglePositions, centroid, rotationActive, etc.)
- `db/schema.sql` — V2 schema: removed `fragment_selections` table, removed `finale_chapter` from `users`, added `consensus_rounds` table
- `server/persistence.ts` — V2 migration (version 2): drops `fragment_selections`, adds `consensus_rounds`; removed `saveFragmentSelection()`; added `saveConsensusRound()`; `saveUser()` no longer writes `finale_chapter`; `getUsersByShow()` returns `Pick<User, 'id' | 'seatId'>[]`
- `server/socket.ts` — Removed V1 handlers (`select_fragment`, `triangle_update`, `steward_param`, centroid broadcast interval); added `consensus_vote` handler routing to `SUBMIT_CONSENSUS_VOTE`; added convergence broadcast interval at ~5 Hz during active rounds; added `NPC_MESSAGE` event broadcast; updated `filterStateForClient` for V2 shapes (audience gets `myFinale` with consensus/mix data; projector gets V2 finaleState)
- `server/timing.ts` — Removed rotation tracking (RotationTrackingState, fallbackRotationInterval); added consensus round timer (fires `END_CONSENSUS_ROUND`); added loop boundary tracking for performer mix (fires `FIRE_PENDING_CHANGES` every 8 bars, OSC beat-synced or JS fallback); fixed OSC audition beat tracking to use delta-from-baseline logic
- `server/audio-router.ts` — Removed `slot_activate`, `slot_deactivate`, `steward_param` handlers; added `rejection_gesture` (enables return track, schedules delayed mute after `rejectionEffectDurationMs`); added `consensus_activate` (unmutes fragment track, tracks in `activeLayerTracks`); added `mix_update` (batch mute old/unmute new tracks per `PendingChange`); replaced `finaleSlotCount` config with `rejectionReturnTrackIndex`
- `server/index.ts` — Removed metering service; added env vars for V2 consensus game and health bar config; updated backup phase lists (`finale_rotating` → `finale_elegy`/`finale_consensus`/`finale_performer_mix`)

**Test updates:**
- `server/__tests__/audio-router.test.ts` — Updated config helpers for V2 types; removed V1 tests (`slot_activate`, `slot_deactivate`, `steward_param`); added V2 tests (`rejection_gesture`, `consensus_activate`, `mix_update`)
- `server/__tests__/timing.test.ts` — Updated config helpers for V2 types; removed rotation tests; added consensus round timer tests and loop boundary tests (fallback + OSC)
- `server/__tests__/persistence.test.ts` — Updated config helpers for V2 types; removed `finaleChapter` from User objects; replaced V1 finaleState test with V2; replaced `fragment_selections` test with `consensus_rounds` test
- `server/__tests__/backup.test.ts` — Updated config helpers for V2 types; updated finaleState test for V2 shape

**Tests:** 300 tests passing across 14 suites (up from 185 conductor tests; added 115 server tests passing).

## 2026-03-06 — V2 Migration Phase 3: Finale — Consensus Game + Performer Mix

**Context:** MIGRATION.md Phase 3. Replaces the V1 rotation/stewardship/triangle finale system with the V2 design: a consensus game where the audience collectively activates fragments by achieving convergence above a threshold, followed by a performer mixing surface where changes queue and fire at loop boundaries.

**Deleted files:**
- `conductor/finale.ts` — V1 rotation/queue/stewardship/triangle logic (all V1 types removed)
- `conductor/__tests__/finale.test.ts` — V1 finale tests

**New files:**
- `conductor/consensus-game.ts` — Pure consensus game functions: `calculateConvergence` (max vote share / total), `resolveRound` (checks convergence ≥ threshold and winning role is unlocked), `adjustThreshold` (decays per consecutive failure, floors at minimum)
- `conductor/performer-mix.ts` — Pure performer mix queue functions: `queueChange` (add/replace pending), `cancelPending` (remove pending for layer), `firePendingChanges` (apply all pending → new Map + firedChanges list)
- `conductor/npc.ts` — NPC auto-trigger evaluation: `evaluateAutoTriggers` checks conditions in order (consecutive_failures, same_song_streak, near_miss, first_success, final_fragment, single_option_role); returns first matching message or null
- `conductor/__tests__/consensus-game.test.ts` — Unit tests: convergence calculation, round success/failure, threshold decay/floor/reset
- `conductor/__tests__/performer-mix.test.ts` — Unit tests: queue, cancel, fire, mute, replace
- `conductor/__tests__/npc.test.ts` — Unit tests: all 6 trigger conditions
- `conductor/__tests__/finale-integration.test.ts` — Integration tests through `processCommand`: SETUP_FINALE → consensus rounds → performer mix

**Modified files:**
- `conductor/fragments.ts` — Fixed V2 type alignment: `displayName` → `displayLabel`, removed `safeParameter` field and `placeholderSafeParameter()` helper, removed `SafeParameter`/`AbletonParamRef` imports
- `conductor/conductor.ts` — Removed V1 interim imports (`assignChapters`, `v1InitFinale`); implemented all 11 finale command handlers (`SETUP_FINALE`, `START_CONSENSUS_ROUND`, `SUBMIT_CONSENSUS_VOTE`, `END_CONSENSUS_ROUND`, `SET_CONSENSUS_THRESHOLD`, `SEND_NPC_MESSAGE`, `START_PERFORMER_MIX`, `QUEUE_FRAGMENT`, `CANCEL_PENDING`, `FIRE_PENDING_CHANGES`, `LOAD_SNAPSHOT`, `TOGGLE_LIVE_TRACK`); removed stale `finale_elegy` console.log
- `conductor/index.ts` — Added exports for `consensus-game`, `performer-mix`, `npc` modules

**Key implementation decisions:**
- `resolveRound` checks that winning fragment's `layerType` is not already in `lockedRoles`
- `adjustThreshold` is stateless — caller passes `consecutiveFailures=0` on success to get initial threshold back
- `START_PERFORMER_MIX` seeds `activeLayers` from `consensusGame.lockedRoles` (consensus results become starting mix)
- NPC auto-triggers evaluate after every `END_CONSENSUS_ROUND` (if `autoTriggersEnabled`)
- `near_miss` condition uses `threshold - 0.05 - 1e-10` floor to handle floating-point imprecision

**Tests:** 185 passing across 9 conductor suites (+38 new tests).

---

## 2026-03-06 — V2 Migration Phase 2: Health Bar System

**Context:** MIGRATION.md Phase 2. Replaces per-layer Doubt thresholds with a cumulative Health Bar that drains after each vote based on the losing minority proportion. Songs either collapse (health → 0) or complete all layers and enter `attempt_resolve` where the performer narratively rejects them.

**New files:**
- `conductor/health-bar.ts` — Pure health bar functions: `createHealthBar`, `calculateDrain` (drain = min(A,B)/total × 100 × drainFactor × layerMultiplier), `applyDrain` (mutates, floors at 0, appends to history), `isCollapsed`
- `conductor/voting.ts` — Replaces `consensus.ts` for song-building: `calculateConsensus` (unchanged), `calculateVoteResult` (new — combines consensus + drain calculation), removed `resolveVote`
- `conductor/__tests__/health-bar.test.ts` — Health bar unit tests
- `conductor/__tests__/voting.test.ts` — Voting unit tests

**Modified files:**
- `conductor/conductor.ts` — Major rewrite: removed `SET_THRESHOLD`/`TOGGLE_DOUBT`/`FORCE_CONTINUE` handlers; added `TRIGGER_REJECTION`/`SET_DRAIN_FACTOR`/`SET_HEALTH`; `CLOSE_VOTING` now drains health bar and checks collapse; `lockInLayer` auto-transitions to `attempt_resolve` on song completion; phase sequence updated to 15 phases (×3 attempt_resolve); `SETUP_FINALE` uses V1 interim until Phase 3
- `conductor/__tests__/conductor.test.ts` — Rewritten: V1 doubt tests removed, V2 health bar/collapse/attempt_resolve tests added
- `conductor/index.ts` — Exports `voting` and `health-bar` modules; removed old `consensus`/finale exports
- `conductor/__tests__/finale.test.ts` — Added `drainFactor`/`layerMultipliers` to test config; removed V1 conductor command suites (pending Phase 3 rewrite)
- `conductor/__tests__/fragments.test.ts` — Added `drainFactor`/`layerMultipliers`/`healthBar`/`drainAmount` to test fixtures

**Default layer multipliers:** `[0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]` — later layers cost progressively more.

**Tests:** 147 passing across 6 conductor suites.

---

## 2026-03-01 — RESET_LAYER Command

**Context:** Operators needed a way to abort a layer mid-flow and start it over from scratch — for example, if audition or voting started at the wrong moment. This adds a `RESET_LAYER` emergency control that returns the current layer to its initial `locked` state from any in-progress phase.

**Changes:**
- `conductor/types.ts` — Added `{ type: 'RESET_LAYER' }` to `ConductorCommand` union
- `conductor/conductor.ts` — Added `handleResetLayer()`: validates phase/status, stops audio via `audition_stop` cue (matching `handleOpenVoting` pattern), clears votes for the current layer, resets `currentLayerPhase → 'locked'`, `currentAuditionOption → null`, `auditionLoopIndex → 0`; emits `LAYER_PHASE_CHANGED`; no-op if layer is already `locked`; defensive path removes `layerResults` entry if layer was in `locked_in` state
- `server/timing.ts` — Added `case 'locked':` to the `LAYER_PHASE_CHANGED` switch in `onStateChanged`; calls `stopAuditionTracking()` to clean up any active beat-tracking interval or fallback timer (`cancelCurrentTimer()` already runs unconditionally for all phase changes)
- `components/controller/EmergencyControls.tsx` — Added "Reset Layer" button (warning style) in the Audio group between Collapse Gesture and Audio Panic; no confirmation step since the action is reversible

**No changes needed:** `server/socket.ts` (generic command pass-through), `server/audio-router.ts` (`audition_stop` with `option: null` already calls `stopPlayback()`)

**Tests:** 6 new conductor tests — reset from auditioning, reset from voting (clears votes), reset from `locked_in` (defensive, removes layer result), no-op when already locked, error outside `attempt_build`, `currentLayerIndex` unchanged after reset.

**Modified files:** `conductor/types.ts`, `conductor/conductor.ts`, `server/timing.ts`, `components/controller/EmergencyControls.tsx`, `conductor/__tests__/conductor.test.ts`

---

## 2026-02-28 — AudioReference Effects Support + AudioCue Simplification

**Context:** Some song-building options are implemented as Ableton device effects (e.g., reverb/delay on a shared foundation track) rather than mute/unmute of a dedicated track. The previous system always computed track indices via formula in the audio router and had no way to express effect-based options. This change adds `effectIndices` to `AudioReference` and embeds resolved audio references directly in `AudioCue` events, so the audio router no longer needs to compute track indices at runtime.

**Changes:**
- `AudioReference` gains optional `effectIndices: number[]` — device indices to enable/disable for this option (additive with track mute/unmute)
- `AudioCue` variants `audition_start`, `audition_stop`, and `lock_in` now carry resolved `AudioReference` objects (`audioRef`/`otherAudioRef` or `winnerAudioRef`/`loserAudioRef`)
- `conductor/conductor.ts` — helper `getLayerAudioRef()` added; all song-building AUDIO_CUE emissions populate the new fields from `LayerConfig`
- `server/audio-router.ts` — `handleAuditionStart`, `handleAuditionStop`, `handleLockIn` rewritten to read `audioRef` directly from cue; added `enableEffects`/`disableEffects` helpers; shared-track optimization skips track mute/unmute when both options reference the same `trackIndex`; fixed `RESUMED` to send `continue_playing` (resume from position) instead of `start_playing` (restart from beginning)
- `config/default-show.json` — no changes needed (`effectIndices` is optional; existing track-only configs work unchanged)

**Implications:** All `audition_start`/`audition_stop`/`lock_in` AudioCue objects now require `AudioReference` fields. Tests and any external callers that manually construct these cues must be updated. `computeTrackIndex` remains exported as a utility but is no longer called in the audio router's runtime path.

**Modified files:** `conductor/types.ts`, `conductor/conductor.ts`, `server/audio-router.ts`, `server/__tests__/audio-router.test.ts`, `ARCHITECTURE.md`

---

## 2026-02-28 — Beat-Synced Audition Cycling

**Context:** Audiences previously heard only option A for a flat `auditionDurationMs` timer before voting opened. This adds beat-synced A/B alternation: each option plays for `beatsPerLoop` beats (32 = 8 bars), cycling `auditionsPerLayer` times per option (e.g., 2 → A-B-A-B = 4 total loops), then auto-advancing to voting.

**New commands/events:**
- `TOGGLE_AUDITION` — flips current option A↔B, increments `auditionLoopIndex`, emits `audition_stop` + `audition_start` AUDIO_CUE events
- `AUDITION_OPTION_CHANGED` event — carries `option`, `loopIndex`, `totalLoops` for UI progress display

**Modified files:**
- `conductor/types.ts` — Added `beatsPerLoop` and `auditionsPerLayer` to `TimingConfig`; added `currentAuditionOption: 'A' | 'B' | null` and `auditionLoopIndex: number` to `AttemptState`; added `TOGGLE_AUDITION` to `ConductorCommand`; added `AUDITION_OPTION_CHANGED` to `ConductorEvent`; added `currentAuditionOption`, `auditionLoopIndex`, `auditionTotalLoops` to `AudienceAttemptView`
- `conductor/conductor.ts` — `handleStartAudition` initializes `currentAuditionOption = 'A'` and emits `AUDITION_OPTION_CHANGED`; new `handleToggleAudition` flips option and emits stop/start cues; `handleOpenVoting` clears `currentAuditionOption`; `handleRerunVote` resets audition state and re-emits `AUDITION_OPTION_CHANGED`
- `config/default-show.json` — Added `beatsPerLoop: 32` and `auditionsPerLayer: 2` to timing section
- `server/timing.ts` — Replaced flat `auditionDurationMs` timer with `startAuditionTracking`: OSC mode counts beats (triggers TOGGLE_AUDITION every `beatsPerLoop` beats, OPEN_VOTING after `totalLoops`); fallback mode uses JS `setInterval` derived from `beatsPerLoop × (60000 / fallbackBpm)`; legacy path (beatsPerLoop = 0) preserves old flat timer; added `stopAuditionTracking()` to `stop()` lifecycle
- `server/socket.ts` — Added `currentAuditionOption`, `auditionLoopIndex`, `auditionTotalLoops` to audience `filterStateForClient` current attempt object

**Tests:** Added 11 conductor tests (TOGGLE_AUDITION behavior, error cases, RERUN_VOTE reset, OPEN_VOTING clearing option) and 7 timing tests (fallback interval cycling, OSC beat counting, phase-change cleanup for both modes). Fixed pre-existing version-check test to match intentionally-disabled guard. Updated test config literals with new required fields throughout.

**Beat tracking detail:** Baseline is set on the first non-zero beat received (beat 0 is a no-op since 0 is the sentinel). With Ableton counting from beat 1, the first TOGGLE fires at beat 33 (1 + 32), subsequent at +32 each. Rotation tracking is unaffected (uses 0 as baseline directly).

**Verification:** 216 tests passing across 9 suites (up from 198). `tsc --noEmit` clean.

---

## 2026-02-28 — Phase 8: Cleanup & Polish (Migration Complete)

**Context:** Final migration phase — remove all old code, verify everything works, update documentation for steady-state development.

**Deleted old component files (no new equivalent):**
- `components/SongTree.tsx`, `components/AuditionVoteInterface.tsx`, `components/VoteInterface.tsx`
- `components/CoupMeter.tsx`, `components/FactionReveal.tsx`, `components/PhaseIndicator.tsx`
- `components/SeatMap.tsx`, `components/AuditionDisplay.tsx`, `components/FigTreeInput.tsx`
- `components/WaitingState.tsx`

**Deleted old documentation:**
- `ARCHITECTURE_OLD.md`, `CHANGELOG_OLD.md`, `DECISIONS_OLD.md`, `CLAUDE_OLD.md`, `AI_CONTEXT_OLD.md`
- `NEW_SHOW.md`, `ROADMAP.md`, `ROADMAP_OLD.md`, `TESTING.md`, `SongTreePrototype.jsx`
- `new-show-migration/` directory (analysis.md, prompts.md)

**Updated:**
- `README.md` — Updated description (removed faction reference), removed TESTING.md link
- `CLAUDE.md` — Complete rewrite for steady-state development. Removed migration-in-progress section, old/new keyword guides, and MIGRATION.md references. Now describes the system as-is: architecture overview, project structure, commands, common patterns, state filtering, audio/OSC layout.

**Verification:**
- Zero references to old keywords (faction, coherence, coup, figTree, songTree, etc.) in any source files
- 198 tests passing across 9 suites
- `tsc --noEmit` clean
- Old conductor files (coherence.ts, coup.ts, ties.ts, assignment.ts) already deleted in Phase 1

**Migration summary (Phases 0-8):**
The codebase has been fully migrated from the old show design (factions, coherence scoring, coups, 4-option voting, song tree, dual paths) to the new design (binary A/B voting, consensus/doubt thresholds, 3-attempt structure with collapse, collaborative finale with fragment selection, 7-slot rotation, triangle steering, and stewardship). All infrastructure was preserved (Next.js + custom server, Socket.IO, SQLite persistence, OSC/Ableton bridge, client reconnection/recovery). The migration produced 198 tests across 9 suites covering conductor logic, persistence, backup, audio routing, OSC, and timing.

---

## 2026-02-27 — Phase 7: Controller UI

**Context:** Migration Phase 7 — build the operator console at `/controller`. All conductor commands and server socket infrastructure were already in place. This phase adds a full performer-facing control surface: phase management, live vote metrics, doubt threshold adjustment, finale management, audio controls, and emergency recovery tools.

**New files:**
- `components/controller/MetricsPanel.tsx` — Persistent sticky status bar. Always visible. Shows: current phase (colored badge), user count, state version, WebSocket status, and phase-specific metrics (vote A/B counts + consensus % during attempt_build; queue, slots, stewardship progress during finale phases).
- `components/controller/ShowControls.tsx` — Core phase management. Advance Phase, Pause/Resume toggle, Start Audition (when layer is locked), and Jump to Phase dropdown with attempt index selector for attempt_story/attempt_build phases.
- `components/controller/VotingControls.tsx` — Song-building vote management. Only shown during attempt_build. Live vote bar (A vs B with percentages), Open/Close Vote, Force A/B (warning-styled), Extend Timer (+5s/+10s), Rerun Vote. Buttons auto-disable based on current layer phase.
- `components/controller/DoubtControls.tsx` — Threshold management. Only shown during attempt_build. Threshold display (shows OFF when null), slider (50–100%, step 5), preset buttons (65%/75%/85%/90%), Doubt ON/OFF toggle (null = off, value = on). Force Continue (warning) and Force Collapse (danger). Local slider state syncs when layer changes.
- `components/controller/FinaleControls.tsx` — Finale management. Only shown during finale phases. Rotation controls (Start/Stop/Freeze), rate selector (1×/2×), Triangle toggle, Clear Queue. Status panel: queue counts by chapter, stewardship progress bar, active slots list with chapter color, fragment name, and energy bar.
- `components/controller/EmergencyControls.tsx` — Audio and recovery. Always visible, collapsible. Audio: Transport Play/Stop, Collapse Gesture, Audio Panic (hard mute, danger-styled). Recovery: Export State (downloads serialized JSON), Import State (file upload), Force Reconnect All, Reset to Lobby (keep/clear users) — all destructive actions require a confirmation step.
- `app/controller/page.tsx` — Full rewrite. Passcode gate (checks `NEXT_PUBLIC_CONTROLLER_PASSCODE` env var; no gate if unset). Orchestrates all five components. Phase-conditional section rendering: VotingControls + DoubtControls only during attempt_build; FinaleControls only during finale phases.

**Design decisions:**
- Inline styles throughout (matches existing page convention). Dark theme (#0a0a0a bg) matching the show aesthetic.
- Button sizing: min 48px height, large font for live performance use.
- Color coding: primary (white), warning (amber, #fbbf24), danger (red, #f87171). Override buttons always amber/red.
- Phase-specific sections collapse entirely when not in the relevant phase — no dead controls on screen.
- FORCE_ASSIGN_STEWARD / FORCE_INSERT_FRAGMENT omitted: server currently overrides `userId` on any command with that field. TODO for server-side controller auth fix.
- 198 tests passing, zero new type errors (`tsc --noEmit` clean for all new files).

## 2026-02-27 — Phase 6: Client — Finale UI

**Context:** Migration Phase 6 — build the audience phone UI and projector display for the finale. Conductor finale logic (fragment selection, triangle steering, stewardship, rotation) and server socket handlers (`select_fragment`, `triangle_update`, `steward_param`, `centroid`, `meter`) were already complete. This phase adds client-side types, components, and page wiring.

**New files:**
- `components/finale/FragmentSelector.tsx` — Audience fragment grid. Shows all fragments for the user's assigned chapter. Winners = selectable (full opacity, chapter color, tappable `<button>`). Losers + unreached = visible but grayed (25% opacity, `disabled`). Option A = solid fill, B = outlined — matching OptionCard pattern. Selected fragment gets white ring glow.
- `components/finale/TriangleSteering.tsx` — SVG equilateral triangle. Corners labeled AMBITION (red), LOVE (amber), AVOIDANCE (blue) with accent dots. Audience mode: draggable white dot, uses `useTriangleInput` hook. Projector mode: centroid dot displayed from server broadcasts. Corner radial gradient fills. `touch-action: none` for mobile drag. TODO comments for auto-recenter drift and underrepresented chapter glow.
- `components/finale/StewardSlider.tsx` — Custom vertical touch slider for steward mode. Pointer-driven (no `<input type="range">`). Chapter-colored fill + thumb, white ring glow. Label from `safeParameter.displayLabel`. Throttled `onChange` at ~50ms. Syncs initial position from server `stewardParameterValue` on reconnect. Shows fragment name + "YOU ARE STEERING".
- `components/finale/SlotCard.tsx` — Single projector slot card. Empty = dark placeholder. Active = chapter color background, layer symbol, chapter icon, fragment name, steward badge. Energy glow: `boxShadow` spread/opacity driven by metering level (0–1).
- `components/finale/SlotGrid.tsx` — Arranges 7 SlotCards in a flex row. Accepts `activeSlots` from state and `meterLevels: Map<slotIndex, energy>` from high-frequency `meter` socket events.
- `hooks/useTriangle.ts` — Two hooks. `useTriangleInput`: pointer events on SVG ref → barycentric weights via area-ratio formula, clamped to triangle, throttled emit at ~250ms. `useTriangleCentroid`: listens to `centroid` socket events, interpolates via `requestAnimationFrame` for 60fps display. Pure math helpers `pointToBarycentric` / `barycentricToPoint` exported.

**Updated:**
- `conductor/types.ts` — Added `availableFragments` and `stewardParameterValue` to `AudienceFinaleView`. `availableFragments` is the per-chapter fragment list with `selectable` flags sent to audience clients. `stewardParameterValue` is the current slider position for reconnection recovery.
- `server/socket.ts` — Imports `getAvailableFragments` from `conductor/finale`. Populates `availableFragments` (filtered to user's chapter) and `stewardParameterValue` (from active slot) in `filterStateForClient()` audience case.
- `app/audience/page.tsx` — Finale phase routing: steward → `StewardSlider`; not-yet-selected + fragments available → `FragmentSelector`; queued + triangle active → `TriangleSteering`; otherwise minimal "LISTEN" / "FINALE IN PROGRESS" text. Fragment selection allowed during both `finale_setup` and `finale_rotating`.
- `app/projector/page.tsx` — Finale phase: `SlotGrid` (activeSlots + meterLevels), `TriangleSteering` in display-only mode with interpolated centroid, `FinalePhaseIndicator`, `QueueStatus`. `meter` socket events wired via `useState` + `useEffect` (separate from state_sync). `useTriangleCentroid` hook for smooth centroid animation.

**Key behaviors:**
- Fragment selector shows all fragments for user's chapter (winners selectable, losers/unreached visible but locked). Single selection emits `select_fragment`.
- Triangle steering throttled at ~250ms on audience; projector interpolates received centroid at 60fps.
- Steward slider local state for responsiveness; server-authoritative value synced on reconnect via `stewardParameterValue`.
- Projector metering: `meter` events (10 Hz) update slot energy levels independently of state_sync — no render overhead on state_sync for high-frequency data.
- 198 tests passing, `tsc --noEmit` clean for all Phase 6 files.

## 2026-02-27 — Phase 5: Client — Song-Building UI

**Context:** Migration Phase 5 — build the audience phone UI and projector display for song-building. Server-side state filtering was already complete (filterStateForClient in socket.ts). This phase adds client state types, a visual identity module, song-building components, and rewrites both client pages.

**New files:**
- `lib/identity.ts` — Chapter + layer color/symbol/label mappings. Placeholder values; all marked `// TODO: See DECISIONS.md O3`. Exports `getLayerIdentity()` and `getChapterIdentity()` helpers with fallback for unknown types.
- `components/song-building/OptionCard.tsx` — A/B option card. Option A = solid fill with layer color; Option B = outlined. States: default, selected (checkmark), winner (scale + badge), loser (dimmed), collapsed. Large tap target.
- `components/song-building/LayerGrid.tsx` — Grid of all layers for the current attempt. Infers each layer's visual state from position vs `currentLayerIndex`. Resolved layers show winner/loser from `layerResults`. Active layer shows OptionCards. Future layers show locked placeholders.
- `components/song-building/ConsensusBar.tsx` — Horizontal split bar showing live vote distribution (A left / B right). Updates reactively from `attempt.votes`. Winner side highlights after resolution.
- `components/song-building/DoubtMeter.tsx` — Horizontal gauge with threshold line marker. Orange danger state when consensus < threshold. Hidden when `doubtThreshold === null`. Collapse state shows red.
- `app/globals.css` — Tailwind CSS v4 directives + `@theme` block with chapter/layer color tokens (placeholders, marked TODO O3).
- `postcss.config.js` — PostCSS config using `@tailwindcss/postcss`.

**Rewritten:**
- `hooks/useShowState.ts` — Full rewrite. Function overloads by mode: audience → `AudienceStateReturn`, projector → `ProjectorStateReturn`, controller → `ControllerStateReturn`. No client-side transforms — audience/projector receive pre-filtered JSON from server. Only controller deserializes Maps. Derives `isDark` (lobby/opener/attempt_story/ended) and `isVotingActive` (currentLayerPhase === 'voting').
- `app/audience/page.tsx` — Full rewrite. Phase routing: lobby (waiting message), opener/attempt_story (dark listen screen), attempt_build (LayerGrid + vote emission via `emit('vote', { choice })`), finale phases (placeholder for Phase 6), ended. Wrapped in Suspense for `useSearchParams`. Connection indicator, pause overlay.
- `app/projector/page.tsx` — Full rewrite. Phase routing: lobby (LobbyDisplay with user count), dark during story phases, attempt_build (chapter header with accent color, current layer card with A vs B options, stack history icons, ConsensusBar, DoubtMeter, collapse overlay placeholder), finale phases (placeholder for Phase 6). Live vote tallies computed from `attempt.votes` in useMemo.

**Updated:**
- `conductor/types.ts` — Added `AudienceClientState`, `AudienceAttemptView`, `AudienceFinaleView`, `ProjectorClientState`, `ProjectorFinaleView`. Match the exact shapes returned by `filterStateForClient()` in server/socket.ts.
- `app/layout.tsx` — Added `import './globals.css'`.
- `package.json` — Added `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/postcss` as devDependencies.

**Key behaviors:**
- Audience grid: layers unlock sequentially. Active layer shows A/B OptionCards. Future layers = generic locked squares. Resolved layers show winner (full opacity) vs loser (25% opacity) using layer color from identity.ts.
- Projector vote tallies: derived in useMemo from `currentAttempt.votes` filtered by current layer index — gives live updating during voting phase.
- Tailwind v4 + inline styles coexist: dynamic layer colors use inline `style` (runtime lookups); layout/spacing could use Tailwind classes but this phase primarily uses inline styles matching existing component patterns.
- Pause overlay: shown on top of current phase UI, non-interactive.
- Finale: placeholder in both pages; will be built in Phase 6.

**Test results:** 198 tests pass across 9 suites. No new tests (UI components — testable via browser).

---

## 2026-02-27 — Phase 4: OSC Bridge & Audio Router

**Context:** Migration Phase 4 — rewrite the Ableton integration for the new track layout (3 attempts × 7 layers × 2 options = 42 tracks), new AudioCue types, and new timing phases.

**Rewritten:**
- `server/audio-router.ts` — Full rewrite. Maps all 9 AudioCue variants to AbletonOSC messages. Track index formula: `attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset`. Arrangement mode only (mute/unmute, no clip firing). Collapse gesture uses return track enable + delayed mute. Finale slot activate/deactivate uses internal slot→track mapping. Steward param sends `/live/device/set/parameter/value`. Handles SHOW_RESET, PAUSED, RESUMED.
- `server/timing.ts` — Full rewrite. Schedules `auditionDurationMs` → OPEN_VOTING and `votingWindowMs` → CLOSE_VOTING on layer phase changes. Finale rotation via OSC beat tracking (fires PERFORM_ROTATION_TICK every rotationBars × 4 beats) or JS interval fallback. Version-check safety preserved.
- `server/__tests__/audio-router.test.ts` — 28 tests covering all AudioCue types, track index formula, stacking behavior, collapse timing, slot mapping, idempotency, and lifecycle events.
- `server/__tests__/timing.test.ts` — 14 tests covering audition/voting timers, version-check safety, pause behavior, rotation (both OSC and fallback modes), and lifecycle.

**Updated:**
- `conductor/types.ts` — Added `PERFORM_ROTATION_TICK` command variant (timing engine → conductor rotation pipeline)
- `conductor/conductor.ts` — Added PERFORM_ROTATION_TICK handler (routes to `performRotationTick()`)
- `server/index.ts` — Loads `config/ableton-layout.json`, passes layout config to audio router, wires `/meter/slot/<N>` OSC handlers to metering service
- `server/tools/osc-mock-ableton.ts` — Added `/live/return/set/mute` and `/live/device/set/parameter/value` handlers. Added mock meter data generation (~20 Hz when transport playing). Updated num_tracks to 42.

**New files:**
- `config/ableton-layout.json` — Track mapping defaults (maxLayersPerAttempt: 7, attemptCount: 3, collapseReturnTrackIndex: 0, finaleSlotCount: 7)

**No changes needed:**
- `server/osc.ts` — Clean I/O layer, fully reusable as-is
- `server/metering.ts` — Phase 3 stub was complete; only OSC wiring added in server/index.ts

**Key behaviors:**
- Audition: starts transport on first audition, mutes other option for same layer, unmutes active option
- Lock-in: unmutes winner, mutes loser; previously locked layers stay unmuted (stacking)
- Collapse: enables return track effects immediately, schedules cleanup (mute all attempt tracks + re-mute return) after collapseAnimationMs
- Finale slots: tracks internal slotIndex→trackIndex mapping for deactivation (avoids race condition with conductor state)
- Steward param: looks up AbletonParamRef from state, sends raw value (smoothing handled by Ableton device)
- Panic: mutes all 42 tracks
- Rotation timing: OSC mode counts beats from AbletonOSC; fallback mode uses JS interval based on BPM

**Test results:** 198 tests pass across 9 suites. `tsc --noEmit` clean for server/ and conductor/.

---

## 2026-02-27 — Phase 3: Server Layer — Socket.IO & Persistence

**Context:** Migration Phase 3 — rewire the server to use the new Conductor. Update persistence, socket events, state sync, and backup. Add metering stub.

**New files:**
- `server/metering.ts` — `createMeteringService(io)`: aggregates slot energy levels and broadcasts `meter` event to projector at ~10 Hz. OSC wiring happens in Phase 4.

**Rewritten:**
- `lib/serialization.ts` — Complete rewrite for new ShowState. Serializes `users`, `chapterAssignments`, `trianglePositions` Maps as `[key, value][]`. Old faction/personalTree/rows shapes gone.
- `server/persistence.ts` — New schema types throughout. `saveLayerVote(LayerVote)` replaces `saveVote(Vote)`. `saveFragmentSelection` replaces `saveFigTreeResponse`. `saveUser` persists `finaleChapter` not `faction`. All serialization via `lib/serialization.ts`.
- `server/socket.ts` — Removed: `coup_vote`, `fig_tree_response`, faction rooms, old dual-vote `vote` payload. Added: binary `vote`, `select_fragment`, high-frequency `triangle_update` (throttled centroid → projector at ~4 Hz, no state_sync), `steward_param`. `reconnect_user` → `reconnect`. `filterStateForClient` rewritten for all three client modes. `FACTION_ASSIGNED` event handling removed; `FORCE_RECONNECT` forwarding added.
- `server/backup.ts` — Uses `serializeState`/`deserializeState` from `lib/serialization.ts`. Old faction/Set serialization removed.
- `server/index.ts` — Creates and disposes metering service. Phase backup triggers updated (`opener`/`finale_rotating`). Periodic backup phase check updated to active show phases. Log says `Attempt:` not `Row:`. `playbackMode` arg removed from `createAudioRouter`.
- `server/__tests__/persistence.test.ts` — Full rewrite for new types. Tests save/load, Map round-trips (users, finaleState), layer votes, fragment selections, upsert, transaction atomicity.
- `server/__tests__/backup.test.ts` — Full rewrite for new types. Tests Map round-trips (users, finaleState), list, prune, createAndPruneBackup. Uses relative imports.

**Key behaviors:**
- Triangle updates skip state_sync and persistence — centroid broadcast throttled at ~4 Hz to projector only
- Steward param updates use full pipeline (state_sync + persistence + audio hooks → OSC)
- Server recovers from restart via `getLatestShow()` from SQLite

---

## 2026-02-26 — Phase 2: Conductor — Finale Logic
**Context:** Migration Phase 2 — implement the finale state machine: chapter assignment, fragment selection, queue scheduling, rotation, stewardship, triangle aggregation.

**New files:**
- `conductor/finale.ts` — All finale pure logic: `assignChapters()`, `selectFragment()`, `computeCentroid()`, `scheduleRotation()`, `performRotationTick()`, `startStewardship()`, `endStewardship()`, `updateStewardParam()`, `initializeFinaleState()`, `getAvailableFragments()`
- `conductor/__tests__/finale.test.ts` — 44 tests covering chapter assignment, centroid math, fragment selection validation, queue scheduling, rotation ticks, stewardship lifecycle, parameter clamping, all conductor command wiring, and full show flow

**Modified:**
- `conductor/types.ts` — Added `triangleActive: boolean` to `FinaleState`
- `conductor/conductor.ts` — Replaced Phase 2 stubs with full handlers for all 12 finale commands: SETUP_FINALE, SELECT_FRAGMENT, UPDATE_TRIANGLE, UPDATE_STEWARD_PARAM, START_ROTATION, STOP_ROTATION, FREEZE_ROTATION, SET_ROTATION_RATE, FORCE_ASSIGN_STEWARD, FORCE_INSERT_FRAGMENT, CLEAR_QUEUE, TOGGLE_TRIANGLE
- `conductor/index.ts` — Added finale function exports

**Key behaviors implemented:**
- Chapter assignment: random even split (±1) via Fisher-Yates shuffle + round-robin
- Fragment selection: validates user's chapter assignment, fragment selectability, no duplicate picks
- Queue scheduling: fairness-first (haven't stewarded +1000), then centroid chapter weighting (0–1), then diversity nudge (+0.5 for underrepresented chapters)
- Rotation: fills empty slots first, then rotates out oldest; emits SLOT_ACTIVATED/DEACTIVATED + AUDIO_CUE events
- Stewardship lifecycle: start on slot activation, end on rotation out, logged in stewardshipLog
- Parameter clamping: values clamped to fragment's safeParameter.min/max
- Triangle: position storage, centroid computation (average), toggle on/off
- FREEZE_ROTATION transitions to finale_frozen phase
- Full show flow test: lobby → 3 attempts (with collapse) → finale_setup → rotation → freeze → ended
- 109 total tests pass across 4 suites, `tsc --noEmit` clean

---

## 2026-02-26 — Phase 1: Conductor core — show phases & song-building
**Context:** Migration Phase 1 — rewrite the Conductor state machine for new show flow, song-building, and consensus/collapse mechanics.

**New files:**
- `conductor/consensus.ts` — `calculateConsensus()` and `resolveVote()` for binary A/B voting with doubt threshold checking
- `conductor/fragments.ts` — `generateFragments()` produces fragment availability from attempt results (winners selectable, losers + unreached locked)
- `conductor/__tests__/consensus.test.ts` — 11 tests for vote tallying and threshold logic
- `conductor/__tests__/fragments.test.ts` — 8 tests for fragment generation from completed/collapsed/pending attempts
- `conductor/__tests__/conductor.test.ts` — 46 tests for phase transitions, layer flow, collapse, force commands, user connection, recovery, audio

**Rewritten:**
- `conductor/conductor.ts` — Complete rewrite. New show phase state machine (lobby → opener → attempt_story/build ×3 → finale_setup → finale_rotating → finale_frozen → ended). Song-building layer flow (locked → auditioning → voting → resolving → locked_in | collapsed). All commands from ARCHITECTURE.md implemented for song-building; finale commands stubbed with error message for Phase 2.
- `conductor/index.ts` — Updated exports for new modules

**Deleted (old system):**
- `conductor/coherence.ts`, `conductor/coup.ts`, `conductor/ties.ts`, `conductor/assignment.ts`
- `conductor/__tests__/coherence.test.ts`, `conductor/__tests__/coup.test.ts`, `conductor/__tests__/ties.test.ts`, `conductor/__tests__/assignment.test.ts`

**Key behaviors implemented:**
- ADVANCE_PHASE walks the full sequence, tracking currentAttemptIndex (0, 1, 2)
- Collapse auto-advances to next attempt_story for attempts 0 & 1; Song 3 collapse stays put (manual transition per R15)
- Unreached layers are marked in results after collapse
- FORCE_OPTION, FORCE_COLLAPSE, RERUN_VOTE, SET_THRESHOLD all work
- 65 tests pass, `tsc --noEmit` clean for conductor/

---

## 2026-02-26 — Phase 0: New type system and database schema
**Context:** Migration Phase 0 — replace old type definitions and DB schema with new system from ARCHITECTURE.md.

**Changes:**
- Rewrote `conductor/types.ts` with all new types: User (no factions), Chapter, LayerType, LayerPhase, LayerConfig, LayerResult, LayerVote, AttemptState, AttemptConfig, AttemptResult, Fragment, SafeParameter, FragmentSelection, AudioReference, AbletonParamRef, FinaleState, ActiveSlot, QueueEntry, TrianglePosition, StewardshipEntry, ShowState, ShowPhase, ShowConfig, TimingConfig, FinaleConfig, AudioCue, ConductorCommand (full union), ConductorEvent (full union), VoteResult, StoredClientIdentity
- Updated `db/schema.sql`: removed `faction` column from users, replaced `row_index`/`faction_vote`/`personal_vote` in votes with `attempt_index`/`layer_index`/`choice`, replaced `fig_tree_responses` table with `fragment_selections` table, updated indexes

**Removed types (old system):**
- FactionId, Faction, FactionConfig, AdjacencyGraph, TopologyType, SeatTopologyConfig
- OptionId, Option, OptionConfig, Row, RowPhase, RowType, RowConfig
- Vote (factionVote/personalVote), PersonalTree, DualPaths
- CoupConfig, LobbyConfig (audiencePrompt), PlaybackMode
- FactionResult, TieInfo, PopularVoteResult, RevealPayload, FinaleTimeline
- AudioAdapter, AudienceClientState, ProjectorClientState, ControllerClientState
- Old ConductorCommand/ConductorEvent variants (ASSIGN_FACTIONS, COUP_*, TIE_*, etc.)

**Note:** Rest of codebase has type errors — expected. Old conductor files (coherence.ts, coup.ts, ties.ts, assignment.ts) still exist and will be removed in Phase 1.

---

## 2025-02-26 — Initial architecture for new show design
**Context:** Complete redesign of the Solo Show system. The original show (faction-based, 4-option voting, coherence/coup mechanics) has been replaced with a new design: binary choices, consensus/doubt threshold, 3 story attempts, and a collaborative remix finale.

**Changes:**
- Created ARCHITECTURE.md with full system specification
- Created CLAUDE.md with AI agent context and instructions
- Created DECISIONS.md with 15 resolved decisions and 8 open questions
- Defined new state machine (lobby → opener → 3× story/build cycles → finale → end)
- Defined song-building mechanics (binary A/B voting, layer grid UI, doubt threshold, collapse behavior)
- Defined finale mechanics (chapter assignment, fragment selection, 7-slot rotation, stewardship, triangle steering)
- Defined audio engine integration (track layout formula, collapse via return track effects, M4L metering)
- Defined deployment model (cloud-hosted server + local Ableton OSC bridge)

**Implications:**
- Old conductor logic (coherence, coups, faction assignment) is fully replaced
- Infrastructure layer (Socket.IO, SQLite, OSC bridge, reconnection, recovery) carries forward
- New components needed: consensus.ts, finale.ts, fragments.ts, metering.ts, triangle UI, steward slider, fragment selector
- Musical content (Ableton session) needs to be designed to match the track layout formula

**Migration notes from old codebase:**
- Reusable: server scaffolding, Socket.IO setup, persistence pattern, OSC bridge, recovery protocol, client identity/reconnection, AI dev practices
- Rewrite: all conductor logic, all component UIs, DB schema, audio router mappings
- Remove: faction assignment, coherence, coups, seat topology providers, song tree, dual paths, fig tree prompt, personal tree/timeline

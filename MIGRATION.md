# MIGRATION.md — Phased Migration Plan

## How to Use This File
This file tracks the migration from the old show design to the new one. Each phase is a self-contained unit of work. **Complete phases in order.** After finishing a phase, mark it `[x]` and note any issues.

The operator (you, in Claude Code) should tackle **one phase per session**. At the start of each session, read CLAUDE.md, then check this file to see which phase is next.

---

## Phase 0: Foundation — Types & Schema
**Goal:** Replace the old type system and database schema with new ones. This is the foundation everything else builds on.

**Prerequisites:** ARCHITECTURE.md, DECISIONS.md, and CLAUDE.md are in the repo.

- [x] **0a.** Read the current `conductor/types.ts` (or equivalent). Identify every type that references old concepts (factions, coherence, coups, personal trees, fig tree, 4-option voting). Note them but don't delete yet.
- [x] **0b.** Create new `conductor/types.ts` with all types from ARCHITECTURE.md § Data Models:
  - `User`, `UserId`, `SeatId`
  - `Chapter`, `LayerType`, `LayerPhase`, `LayerConfig`, `LayerResult`, `LayerVote`
  - `AttemptState`, `AttemptConfig`, `AttemptResult`
  - `Fragment`, `SafeParameter`, `FragmentSelection`
  - `FinaleState`, `ActiveSlot`, `QueueEntry`, `TrianglePosition`, `StewardshipEntry`
  - `ShowState`, `ShowPhase`, `ShowConfig`, `TimingConfig`, `FinaleConfig`
  - `ConductorCommand` (full union from ARCHITECTURE.md)
  - `ConductorEvent` (full union from ARCHITECTURE.md)
  - `VoteResult`, `AudioCue`, `AudioReference`, `AbletonParamRef`
- [x] **0c.** Update `db/schema.sql` with new schema from ARCHITECTURE.md § Persistence Layer.
- [x] **0d.** Delete old type definitions that have no equivalent in the new system.
  - *Note: Old types were replaced in-place (full rewrite of types.ts). Old conductor files (coherence.ts, coup.ts, ties.ts, assignment.ts) still exist — will be removed in Phase 1.*
- [x] **0e.** Verify: `npx tsc --noEmit` on just the types file should pass (no imports from other files yet — types should be self-contained).
- [x] **0f.** Update CHANGELOG.md.

**Completion check:** New types file compiles. Old faction/coup/coherence types are gone. Schema matches ARCHITECTURE.md.

---

## Phase 1: Conductor Core — Show Phases & Song-Building
**Goal:** Rewrite the Conductor state machine for the new show flow and song-building mechanics. No finale yet.

- [x] **1a.** Gut the old `conductor/conductor.ts`. Keep the structural pattern (class or module that receives commands, validates, mutates state, returns events) but remove ALL old game logic.
  - *Full rewrite from scratch. Also deleted coherence.ts, coup.ts, ties.ts, assignment.ts and their tests.*
- [x] **1b.** Implement show phase transitions per ARCHITECTURE.md § Show Phase State Machine:
  - `lobby → opener → attempt_story → attempt_build → ... → finale_setup → finale_rotating → finale_frozen → ended`
  - `ADVANCE_PHASE` command walks through the sequence
  - `JUMP_TO_PHASE` for controller override
  - `PAUSE` / `RESUME`
  - Track `currentAttemptIndex` (0, 1, 2)
- [x] **1c.** Create `conductor/consensus.ts`:
  - `calculateConsensus(votes)` → `{ consensus, winner, votesA, votesB, totalVotes }`
  - `resolveVote(votes, threshold)` → full VoteResult with threshold check
- [x] **1d.** Implement song-building layer flow in conductor:
  - Layer phase transitions: `locked → auditioning → voting → resolving → locked_in` (or `→ collapsed`)
  - `SUBMIT_VOTE` command (binary A/B)
  - `OPEN_VOTING` / `CLOSE_VOTING`
  - Vote result calculation with doubt check
  - Collapse handling: mark attempt as collapsed, record `collapsedAtLayer`
  - Auto-advance to next `attempt_story` on collapse (except attempt 2 → manual per R15)
  - `FORCE_OPTION`, `FORCE_CONTINUE`, `FORCE_COLLAPSE`, `RERUN_VOTE`, `EXTEND_VOTE_TIMER`
- [x] **1e.** Create `conductor/fragments.ts`:
  - `generateFragments(attempts, configs)` → produces fragment list with correct availability
  - `extractAttemptResult(attempt)` → extracts AttemptResult from AttemptState
- [x] **1f.** Write tests in `conductor/__tests__/`:
  - 65 tests total across 3 test files (conductor, consensus, fragments)
  - Show phase transitions (happy path + error cases)
  - Song-building: vote → lock-in → next layer
  - Doubt threshold: consensus above threshold → continue
  - Doubt threshold: consensus below threshold → collapse
  - Collapse sets correct `collapsedAtLayer` and `status`
  - Fragment generation: correct selectable vs locked fragments
  - Force commands work (force option, force collapse, rerun vote, set threshold)
  - Auto-advance after collapse (attempts 0, 1) vs manual (attempt 2)
  - User connection/disconnection/reconnection
  - Recovery (reset to lobby, force reconnect)
  - Audio commands (transport, panic)
- [x] **1g.** Update CHANGELOG.md.

**Completion check:** All conductor tests pass. `npx tsc --noEmit` passes. No references to factions/coups/coherence in conductor/.

---

## Phase 2: Conductor — Finale Logic
**Goal:** Implement finale state machine: chapter assignment, fragment selection, queue, rotation, stewardship, triangle aggregation.

- [x] **2a.** Create `conductor/finale.ts`:
  - `assignChapters(users)` → random even split across 3 chapters
  - `selectFragment(userId, fragmentId)` → validate fragment is from user's chapter and is selectable, add to queue
  - Queue scheduling: fairness-first, then chapter weighting by centroid, then diversity nudge
  - Rotation tick: pick N entries from queue, activate in slots, assign stewards
  - `computeCentroid(positions)` → weighted average
  - Stewardship: start when fragment enters slot, end when rotated out
  - `updateStewardParam(userId, value)` → validate user is active steward, clamp to safe range
  - *Also added: `initializeFinaleState()`, `getAvailableFragments()`, `performRotationTick()`, `pickSlotTargets()` (internal)*
  - *Added `triangleActive: boolean` to FinaleState in types.ts for TOGGLE_TRIANGLE tracking*
- [x] **2b.** Wire finale commands in conductor.ts:
  - All 12 finale commands replaced from stubs to full handlers
  - `SETUP_FINALE`, `SELECT_FRAGMENT`, `UPDATE_TRIANGLE`, `UPDATE_STEWARD_PARAM`
  - `START_ROTATION`, `STOP_ROTATION`, `FREEZE_ROTATION`, `SET_ROTATION_RATE`
  - `FORCE_ASSIGN_STEWARD`, `FORCE_INSERT_FRAGMENT`, `CLEAR_QUEUE`, `TOGGLE_TRIANGLE`
- [x] **2c.** Write tests:
  - 44 tests in `conductor/__tests__/finale.test.ts`
  - Chapter assignment: even split (±1), disconnected users skipped, edge cases (0, 1 user)
  - Fragment selection: validates chapter match, selectability, duplicate rejection
  - Queue scheduling: fairness-first, centroid weighting, diversity nudge, empty queue, already-active filter
  - Rotation: fills empty slots, stewardship marking, ROTATION_TICK events, no-rotate when inactive/frozen
  - Stewardship: start/end lifecycle, log entries
  - Centroid: empty, single, multiple positions, uneven weighting
  - Parameter clamping: above max, below min, within range, non-steward rejection
  - Full show flow: lobby → 3 attempts (with collapse) → finale_setup → rotation → freeze → ended
- [x] **2d.** Update CHANGELOG.md.
  - *109 total tests pass across 4 suites in ~0.3s. `tsc --noEmit` clean.*

**Completion check:** Finale conductor tests pass. Full show flow works: lobby → 3 attempts → finale setup → rotation → freeze → end.

---

## Phase 3: Server Layer — Socket.IO & Persistence
**Goal:** Rewire the server to use the new Conductor. Update persistence, socket events, and state sync.

- [x] **3a.** Update `server/persistence.ts`:
  - New schema (from Phase 0) — `saveLayerVote`, `saveFragmentSelection`, `saveUser` with `finaleChapter`
  - `lib/serialization.ts` fully rewritten: `serializeState`/`deserializeState` handle Maps in ShowState and FinaleState
  - Same persist-on-every-change pattern
- [x] **3b.** Update `server/socket.ts`:
  - Removed: `coup_vote`, `fig_tree_response`, faction rooms, dual-vote `vote` payload
  - Added: binary `vote`, `select_fragment`, `triangle_update`, `steward_param`, `reconnect`
  - State filtering: controller (full serialized), projector (public), audience (personalized)
  - Identity flow: `join` → `USER_CONNECT` → `identity` event → `state_sync`
- [x] **3c.** Add triangle + metering high-frequency channels:
  - Triangle: `triangle_update` goes through conductor but skips state_sync/persistence. Centroid throttled at ~4 Hz via `setInterval` → projector `centroid` event.
  - Metering: `server/metering.ts` created — `createMeteringService(io)` stub ready. OSC wiring in Phase 4.
- [x] **3d.** Recovery: `server/backup.ts` updated for new state shape. No separate `recovery.ts` — backup/restore lives in `backup.ts` (same as before). `server/index.ts` loads latest show from SQLite on startup.
  - *Note: `server/recovery.ts` was never created — recovery logic is in `backup.ts` + server startup. No changes needed.*
- [x] **3e.** `tsc --noEmit` (server tsconfig) clean. Persistence and backup tests rewritten and passing.
- [x] **3f.** Updated CHANGELOG.md.

**Completion check:** Server starts clean. Can connect via Socket.IO. Commands process through conductor. State persists and recovers.

---

## Phase 4: OSC Bridge & Audio Router
**Goal:** Update Ableton integration for new track layout and commands.

- [x] **4a.** Rewrite `server/audio-router.ts`:
  - Full rewrite. New track index formula: `attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset`
  - Maps all 9 `AudioCue` types to OSC: audition_start/stop, lock_in, collapse_gesture (return track enable + delayed mute), slot_activate/deactivate (internal slot→track mapping), steward_param (`/live/device/set/parameter/value`), transport, panic
  - Arrangement mode only (no session/clip-firing mode). Idempotent mute/unmute helpers.
  - Handles SHOW_RESET, PAUSED, RESUMED events
  - Exported `computeTrackIndex()` and `AbletonLayoutConfig` type
- [x] **4b.** Wire `server/metering.ts` to OSC:
  - Stub was already complete from Phase 3
  - Wired in `server/index.ts`: registers `/meter/slot/<N>` OSC handlers for 7 slots → `meteringService.updateSlotLevel()`
- [x] **4c.** `server/osc.ts` — no changes needed. Clean I/O layer, fully reusable.
- [x] **4d.** Rewrite `server/timing.ts`:
  - Full rewrite. Handles `LAYER_PHASE_CHANGED` events: `auditioning` → timer → `OPEN_VOTING`, `voting` → timer → `CLOSE_VOTING`
  - Finale rotation: OSC beat tracking fires `PERFORM_ROTATION_TICK` every `rotationBars * 4` beats. Fallback: JS interval.
  - Added `PERFORM_ROTATION_TICK` command to `conductor/types.ts` and handler in `conductor/conductor.ts`
  - Kept: version-check safety, hybrid OSC/JS-timer approach, factory pattern, lifecycle
  - Removed: Row, RowPhase, old phases (revealing, coup_window), old TimingConfig fields
- [x] **4e.** Created `config/ableton-layout.json` with track mapping defaults (maxLayersPerAttempt: 7, attemptCount: 3, collapseReturnTrackIndex: 0, finaleSlotCount: 7).
- [x] **4f.** Updated `server/tools/osc-mock-ableton.ts`:
  - Added handlers for `/live/return/set/mute` and `/live/device/set/parameter/value`
  - Added mock meter data generation (~20 Hz per slot when transport playing)
  - Updated `num_tracks` response to 42 (3 × 7 × 2)
- [x] **4g.** Updated CHANGELOG.md.
  - *198 total tests pass across 9 suites. `tsc --noEmit` clean for server/ and conductor/ files. Old client code (app/, components/) has pre-existing type errors — Phase 5+ targets.*

**Completion check:** Audio router maps all new cues correctly. Metering pipeline wired. Timing engine handles new phases and rotation. Mock Ableton responds to new messages.

---

## Phase 5: Client — Song-Building UI
**Goal:** Build the audience and projector UIs for song-building phases.

- [x] **5a.** Create `lib/identity.ts` with chapter + layer color/symbol mappings (use placeholders, mark with TODO).
- [x] **5b.** Create `components/song-building/LayerGrid.tsx`:
  - Grid of all layers for current attempt as squares
  - States: locked (future), active (current — both A/B selectable), locked_in (chosen option prominent, losing option dimmed/grayed), collapsed
- [x] **5c.** Create `components/song-building/OptionCard.tsx`:
  - A/B option display with layer color + symbol
  - Solid (A) vs outlined (B) style
  - Selectable state, selected state, disabled state
- [x] **5d.** Create `components/song-building/ConsensusBar.tsx` and `DoubtMeter.tsx`:
  - Consensus bar: leading side + margin
  - Doubt meter: rising gauge with threshold line
- [x] **5e.** Update `app/audience/page.tsx`:
  - Show phase routing: dark screen during story, layer grid during build, finale placeholder
  - Wire to `useShowState` hook
- [x] **5f.** Update `app/projector/page.tsx` for song-building:
  - Chapter title + accent, current layer card, stack history, meters, collapse animation placeholder
- [x] **5g.** Rewrite `hooks/useShowState.ts`:
  - Receives state_sync, provides typed state (overloaded by mode)
  - No client-side transforms — server pre-filters per mode
  - Derives: currentAttempt, isVotingActive, isDark
- [x] **5h.** Update CHANGELOG.md.
  - *Also: Tailwind CSS v4 setup (postcss.config.js, app/globals.css, layout.tsx). Client state types (AudienceClientState, ProjectorClientState) added to conductor/types.ts. 198 tests still passing.*

**Completion check:** Audience can see layer grid, tap A/B, see result. Projector shows layer progress and meters. Dark screen during story phases.

---

## Phase 6: Client — Finale UI
**Goal:** Build the finale UIs: fragment selection, triangle steering, stewardship slider, projector slot display.

- [x] **6a.** Create `components/finale/FragmentSelector.tsx`:
  - Grid of layers for user's assigned chapter
  - Winning options = selectable, losing + unreached = locked/grayed (25% opacity)
  - Single selection with white ring glow on selected card
- [x] **6b.** Create `components/finale/TriangleSteering.tsx`:
  - Three-corner triangle (Ambition/Love/Avoidance) with chapter color corner labels
  - Draggable dot (audience), centroid dot (projector)
  - Throttled sends (~250ms) via useTriangleInput hook
  - *TODO: Auto-recenter drift when idle (triangleDriftTimeoutMs)*
  - *TODO: Underrepresented chapter glow on corners*
- [x] **6c.** Create `hooks/useTriangle.ts`:
  - `useTriangleInput`: pointer events → barycentric coordinates, throttled emit
  - `useTriangleCentroid`: socket centroid events → requestAnimationFrame interpolation
  - Pure math helpers: `pointToBarycentric`, `barycentricToPoint`
- [x] **6d.** Create `components/finale/StewardSlider.tsx`:
  - Custom vertical touch slider, chapter color fill
  - Label from `safeParameter.displayLabel`, throttled at ~50ms
  - Syncs from server on reconnect via `stewardParameterValue`
- [x] **6e.** Create `components/finale/SlotGrid.tsx` and `SlotCard.tsx` (projector):
  - 7 slot cards with chapter color, layer symbol, fragment name, steward badge
  - Energy glow (boxShadow) driven by `meter` socket events — not state_sync
- [x] **6f.** Wire finale into `app/audience/page.tsx` and `app/projector/page.tsx`.
  - Also: added `availableFragments` + `stewardParameterValue` to `AudienceFinaleView` (types.ts + socket.ts)
- [x] **6g.** Update CHANGELOG.md.

**Completion check:** Full finale flow works: chapter assignment → fragment selection → queue → rotation → stewardship → triangle steering. Projector shows slots with metering glow.

---

## Phase 7: Controller UI
**Goal:** Build the operator console with all controls from ARCHITECTURE.md.

- [x] **7a.** Create controller components:
  - `ShowControls.tsx` — phase buttons, jump dropdown
  - `VotingControls.tsx` — open/close/force/extend/rerun
  - `DoubtControls.tsx` — threshold slider, toggle, force continue/collapse
  - `FinaleControls.tsx` — rotation, freeze, queue, steward, triangle toggle
  - `MetricsPanel.tsx` — connection count, vote counts, consensus, queue status, system health
- [x] **7b.** Wire to `app/controller/page.tsx` with auth (passcode gate via `NEXT_PUBLIC_CONTROLLER_PASSCODE`).
- [x] **7c.** Type-check clean; 198 tests pass (no regressions).
- [x] **7d.** Update CHANGELOG.md.

**Completion check:** Controller can drive entire show flow. All override buttons work. Metrics display real-time data.

**Note:** FORCE_ASSIGN_STEWARD / FORCE_INSERT_FRAGMENT not wired in UI — server currently replaces `userId` on any command that has it, which breaks force-assign to another user. Needs server-side fix before adding those controls (Phase 8 or separate task).

---

## Phase 8: Cleanup & Polish
**Goal:** Remove all old code, verify everything works end-to-end, prepare for rehearsal.

- [ ] **8a.** Search entire codebase for old keywords (faction, coherence, coup, figTree, songTree, personalTree, dualPath, popularPath). Remove any remaining references.
- [ ] **8b.** Delete old component files that have no equivalent (FactionReveal, TiebreakerAnimation, CoupMeter, SongTree, FigTreeInput, FinaleTimeline, VoteInterface).
- [ ] **8c.** Delete old conductor files (coherence.ts, coup.ts, assignment.ts) if they still exist.
- [ ] **8d.** Run full test suite. Fix any failures.
- [ ] **8e.** Run `npx tsc --noEmit`. Fix any type errors.
- [ ] **8f.** End-to-end smoke test: start server, connect audience + projector + controller, run full show flow.
- [ ] **8g.** Delete this file (MIGRATION.md) — migration is complete.
- [ ] **8h.** Remove the "⚠️ MIGRATION IN PROGRESS" section from CLAUDE.md. Update it to be the steady-state agent context.
- [ ] **8i.** Final CHANGELOG.md entry.

**Completion check:** No old code remains. All tests pass. Full show flow works end-to-end. CLAUDE.md is clean.
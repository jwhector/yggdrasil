# MIGRATION.md — Phased Migration Plan

## How to Use This File
This file tracks the migration from the old show design to the new one. Each phase is a self-contained unit of work. **Complete phases in order.** After finishing a phase, mark it `[x]` and note any issues.

The operator (you, in Claude Code) should tackle **one phase per session**. At the start of each session, read CLAUDE.md, then check this file to see which phase is next.

---

## Phase 0: Foundation — Types & Schema
**Goal:** Replace the old type system and database schema with new ones. This is the foundation everything else builds on.

**Prerequisites:** ARCHITECTURE.md, DECISIONS.md, and CLAUDE.md are in the repo.

- [ ] **0a.** Read the current `conductor/types.ts` (or equivalent). Identify every type that references old concepts (factions, coherence, coups, personal trees, fig tree, 4-option voting). Note them but don't delete yet.
- [ ] **0b.** Create new `conductor/types.ts` with all types from ARCHITECTURE.md § Data Models:
  - `User`, `UserId`, `SeatId`
  - `Chapter`, `LayerType`, `LayerPhase`, `LayerConfig`, `LayerResult`, `LayerVote`
  - `AttemptState`, `AttemptConfig`, `AttemptResult`
  - `Fragment`, `SafeParameter`, `FragmentSelection`
  - `FinaleState`, `ActiveSlot`, `QueueEntry`, `TrianglePosition`, `StewardshipEntry`
  - `ShowState`, `ShowPhase`, `ShowConfig`, `TimingConfig`, `FinaleConfig`
  - `ConductorCommand` (full union from ARCHITECTURE.md)
  - `ConductorEvent` (full union from ARCHITECTURE.md)
  - `VoteResult`, `AudioCue`, `AudioReference`, `AbletonParamRef`
- [ ] **0c.** Update `db/schema.sql` with new schema from ARCHITECTURE.md § Persistence Layer.
- [ ] **0d.** Delete old type definitions that have no equivalent in the new system.
- [ ] **0e.** Verify: `npx tsc --noEmit` on just the types file should pass (no imports from other files yet — types should be self-contained).
- [ ] **0f.** Update CHANGELOG.md.

**Completion check:** New types file compiles. Old faction/coup/coherence types are gone. Schema matches ARCHITECTURE.md.

---

## Phase 1: Conductor Core — Show Phases & Song-Building
**Goal:** Rewrite the Conductor state machine for the new show flow and song-building mechanics. No finale yet.

- [ ] **1a.** Gut the old `conductor/conductor.ts`. Keep the structural pattern (class or module that receives commands, validates, mutates state, returns events) but remove ALL old game logic.
- [ ] **1b.** Implement show phase transitions per ARCHITECTURE.md § Show Phase State Machine:
  - `lobby → opener → attempt_story → attempt_build → ... → finale_setup → finale_rotating → finale_frozen → ended`
  - `ADVANCE_PHASE` command walks through the sequence
  - `JUMP_TO_PHASE` for controller override
  - `PAUSE` / `RESUME`
  - Track `currentAttemptIndex` (0, 1, 2)
- [ ] **1c.** Create `conductor/consensus.ts`:
  - `calculateConsensus(votes)` → `{ consensus, winner, votesA, votesB, totalVotes }`
  - Doubt threshold check: `consensus >= threshold` → pass, else collapse
- [ ] **1d.** Implement song-building layer flow in conductor:
  - Layer phase transitions: `locked → auditioning → voting → resolving → locked_in` (or `→ collapsed`)
  - `SUBMIT_VOTE` command (binary A/B)
  - `OPEN_VOTING` / `CLOSE_VOTING`
  - Vote result calculation with doubt check
  - Collapse handling: mark attempt as collapsed, record `collapsedAtLayer`
  - Auto-advance to next `attempt_story` on collapse (except attempt 2 → manual)
  - `FORCE_OPTION`, `FORCE_CONTINUE`, `FORCE_COLLAPSE`, `RERUN_VOTE`, `EXTEND_VOTE_TIMER`
- [ ] **1e.** Create `conductor/fragments.ts`:
  - `generateFragments(attemptResults)` → produces fragment list with correct availability (locked-in winners = selectable, losing options + unreached = locked/grayed)
- [ ] **1f.** Write tests in `conductor/__tests__/`:
  - Show phase transitions (happy path)
  - Song-building: vote → lock-in → next layer
  - Doubt threshold: consensus above threshold → continue
  - Doubt threshold: consensus below threshold → collapse
  - Collapse sets correct `collapsedAtLayer` and `status`
  - Fragment generation: correct selectable vs locked fragments
  - Force commands work (force option, force collapse, force continue)
  - Auto-advance after collapse (attempts 0, 1) vs manual (attempt 2)
- [ ] **1g.** Update CHANGELOG.md.

**Completion check:** All conductor tests pass. `npx tsc --noEmit` passes. No references to factions/coups/coherence in conductor/.

---

## Phase 2: Conductor — Finale Logic
**Goal:** Implement finale state machine: chapter assignment, fragment selection, queue, rotation, stewardship, triangle aggregation.

- [ ] **2a.** Create `conductor/finale.ts`:
  - `assignChapters(users)` → random even split across 3 chapters
  - `selectFragment(userId, fragmentId)` → validate fragment is from user's chapter and is selectable, add to queue
  - Queue scheduling: fairness-first, then chapter weighting by centroid, then diversity nudge
  - Rotation tick: pick N entries from queue, activate in slots, assign stewards
  - `updateTrianglePosition(userId, position)` → store position
  - `computeCentroid(positions)` → weighted average
  - Stewardship: start when fragment enters slot, end when rotated out
  - `updateStewardParam(userId, value)` → validate user is active steward, clamp to safe range
- [ ] **2b.** Wire finale commands in conductor.ts:
  - `SETUP_FINALE`, `SELECT_FRAGMENT`, `UPDATE_TRIANGLE`, `UPDATE_STEWARD_PARAM`
  - `START_ROTATION`, `STOP_ROTATION`, `FREEZE_ROTATION`, `SET_ROTATION_RATE`
  - `FORCE_ASSIGN_STEWARD`, `FORCE_INSERT_FRAGMENT`, `CLEAR_QUEUE`, `TOGGLE_TRIANGLE`
- [ ] **2c.** Write tests:
  - Chapter assignment is even (±1)
  - Fragment selection validates chapter match and availability
  - Queue scheduling: users who haven't stewarded go first
  - Rotation activates correct number of slots
  - Stewardship starts/ends correctly
  - Triangle centroid computation
  - Parameter clamping to safe range
- [ ] **2d.** Update CHANGELOG.md.

**Completion check:** Finale conductor tests pass. Full show flow works: lobby → 3 attempts → finale setup → rotation → freeze → end.

---

## Phase 3: Server Layer — Socket.IO & Persistence
**Goal:** Rewire the server to use the new Conductor. Update persistence, socket events, and state sync.

- [ ] **3a.** Update `server/persistence.ts`:
  - New schema (from Phase 0)
  - Serialization for new ShowState (Maps/Sets → arrays)
  - Same persist-on-every-change pattern
- [ ] **3b.** Update `server/socket.ts`:
  - Remove old events (`fig_tree_response`, faction-specific rooms, coup_vote)
  - Implement new client→server events: `vote`, `select_fragment`, `triangle_update`, `steward_param`, `command`
  - Map each to ConductorCommand → process → broadcast state_sync
  - State filtering: controller (full), projector (public), audience (personalized)
  - Identity flow: `join` → assign userId → `identity` event back
- [ ] **3c.** Add triangle + metering high-frequency channels:
  - Triangle: dedicated event, NOT through state_sync. Throttle, compute centroid, broadcast to projector.
  - Metering: `server/metering.ts` — receive from OSC, aggregate, broadcast `meter` event to projector at ~10 Hz.
- [ ] **3d.** Update `server/recovery.ts`:
  - Same patterns (backup snapshots, import/export, version checking)
  - Updated for new state shape
- [ ] **3e.** Verify: server starts, accepts connections, processes commands, persists state, recovers from restart.
- [ ] **3f.** Update CHANGELOG.md.

**Completion check:** Server starts clean. Can connect via Socket.IO. Commands process through conductor. State persists and recovers.

---

## Phase 4: OSC Bridge & Audio Router
**Goal:** Update Ableton integration for new track layout and commands.

- [ ] **4a.** Update `server/audio-router.ts`:
  - New track index formula: `attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset`
  - Map AUDIO_CUE events to OSC messages:
    - Audition: unmute option track, mute other
    - Lock-in: keep chosen unmuted, mute unchosen
    - Collapse: enable return track effects, then mute all attempt tracks
    - Finale slot activate/deactivate: mute/unmute fragment tracks
    - Stewardship parameter: `/live/device/set/parameter/value`
- [ ] **4b.** Create `server/metering.ts`:
  - Listen for `/meter/slot/<N>` OSC messages
  - Aggregate per-slot energy levels
  - Broadcast to projector via dedicated socket event at ~10 Hz
- [ ] **4c.** Update `server/osc.ts` if needed (should mostly be reusable).
- [ ] **4d.** Update `server/timing.ts`:
  - Quantized timing for audition, voting window, resolve animation, collapse animation
  - Beat subscription for musical timing
  - Version-check safety (same pattern as before)
- [ ] **4e.** Create/update `config/ableton-layout.json` with track mapping config.
- [ ] **4f.** Test with `osc-mock-ableton.ts` (update mock for new messages).
- [ ] **4g.** Update CHANGELOG.md.

**Completion check:** Audio router maps all new cues correctly. Metering pipeline works. Mock Ableton responds to new messages.

---

## Phase 5: Client — Song-Building UI
**Goal:** Build the audience and projector UIs for song-building phases.

- [ ] **5a.** Create `lib/identity.ts` with chapter + layer color/symbol mappings (use placeholders, mark with TODO).
- [ ] **5b.** Create `components/song-building/LayerGrid.tsx`:
  - Grid of all layers for current attempt as squares
  - States: locked (future), active (current — both A/B selectable), locked_in (chosen option prominent, losing option dimmed/grayed), collapsed
- [ ] **5c.** Create `components/song-building/OptionCard.tsx`:
  - A/B option display with layer color + symbol
  - Solid (A) vs outlined (B) style
  - Selectable state, selected state, disabled state
- [ ] **5d.** Create `components/song-building/ConsensusBar.tsx` and `DoubtMeter.tsx`:
  - Consensus bar: leading side + margin
  - Doubt meter: rising gauge with threshold line
- [ ] **5e.** Update `app/audience/page.tsx`:
  - Show phase routing: dark screen during story, layer grid during build, finale UI during finale
  - Wire to `useShowState` hook
- [ ] **5f.** Update `app/projector/page.tsx` for song-building:
  - Chapter title + accent, current layer card, stack history, meters, collapse animation
- [ ] **5g.** Create `hooks/useShowState.ts` (or update existing):
  - Receives state_sync, provides typed state to components
  - Derives: current attempt, current layer, user's vote status, etc.
- [ ] **5h.** Update CHANGELOG.md.

**Completion check:** Audience can see layer grid, tap A/B, see result. Projector shows layer progress and meters. Dark screen during story phases.

---

## Phase 6: Client — Finale UI
**Goal:** Build the finale UIs: fragment selection, triangle steering, stewardship slider, projector slot display.

- [ ] **6a.** Create `components/finale/FragmentSelector.tsx`:
  - Grid of layers for user's assigned chapter
  - Winning options = selectable, losing + unreached = locked/grayed
  - Single selection
- [ ] **6b.** Create `components/finale/TriangleSteering.tsx`:
  - Three-corner triangle (Ambition/Love/Avoidance)
  - Draggable dot, outputs barycentric weights
  - Throttled sends (~250ms)
  - Auto-recenter drift when idle
  - Underrepresented chapter glow
- [ ] **6c.** Create `hooks/useTriangle.ts`:
  - Touch/drag input → barycentric coordinate calculation
  - Throttled emit to server
  - Smooth interpolation for received centroid (projector)
- [ ] **6d.** Create `components/finale/StewardSlider.tsx`:
  - Continuous slider, abstracted label from config
  - Sends parameter value to server
- [ ] **6e.** Create `components/finale/SlotGrid.tsx` and `SlotCard.tsx` (projector):
  - 7 slot cards with chapter color, fragment name, steward indicator
  - Energy meter/glow driven by metering data
- [ ] **6f.** Wire finale into `app/audience/page.tsx` and `app/projector/page.tsx`.
- [ ] **6g.** Update CHANGELOG.md.

**Completion check:** Full finale flow works: chapter assignment → fragment selection → queue → rotation → stewardship → triangle steering. Projector shows slots with metering glow.

---

## Phase 7: Controller UI
**Goal:** Build the operator console with all controls from ARCHITECTURE.md.

- [ ] **7a.** Create controller components:
  - `ShowControls.tsx` — phase buttons, jump dropdown
  - `VotingControls.tsx` — open/close/force/extend/rerun
  - `DoubtControls.tsx` — threshold slider, toggle, force continue/collapse
  - `FinaleControls.tsx` — rotation, freeze, queue, steward, triangle toggle
  - `MetricsPanel.tsx` — connection count, vote counts, consensus, queue status, system health
- [ ] **7b.** Wire to `app/controller/page.tsx` with auth (route + passcode).
- [ ] **7c.** Test all override commands work end-to-end.
- [ ] **7d.** Update CHANGELOG.md.

**Completion check:** Controller can drive entire show flow. All override buttons work. Metrics display real-time data.

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
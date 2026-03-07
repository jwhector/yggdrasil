# Solo Show — Migration Guide: V1 → V2

## Overview

This document provides a step-by-step migration plan for refactoring the Solo Show codebase from the V1 architecture to V2. The changes are significant but modular — each phase can be completed and tested independently.

**Read ARCHITECTURE-V2.md (the new architecture) in full before beginning any migration work.**

### Summary of Changes
- Song-building: Doubt thresholds → Health Bar with blind vote, layer multipliers, and collapse when health reaches zero
- Song-building: Songs can either collapse (health bar → 0) or complete (performer rejects narratively)
- Finale: Rotation/stewardship/triangle → Consensus game + performer mixing surface
- Layer types: 5 types → 7 types (Melody, Drums, Pad, Bass, Harmony, FX1, FX2)
- Data models: simplified (no chapter assignment, no stewardship, no triangle positions)

### Migration Order
The phases are ordered by dependency — earlier phases create the foundation that later phases build on.

---

## Phase 1: Update Types & Data Models

**Goal:** Establish the new type system as the shared language for all subsequent work.

**Why first:** Every other module depends on types. Changing them first means the compiler will flag every downstream location that needs updating.

### Steps

1.1. **Update `LayerType` enum** in `conductor/types.ts`:
- Remove: `foundation`, `pulse`, `color`, `space`, `voice`
- Add: `melody`, `drums`, `pad`, `bass`, `harmony`, `fx1`, `fx2`

1.2. **Update `LayerConfig` interface:**
- Remove: `doubtThreshold` field
- All other fields remain (index, type, optionA, optionB, labelA, labelB)

1.3. **Update `LayerPhase` type:**
- Rename 'resolving' to 'revealing'
- Keep 'collapsed'
- Final set: `locked`, `auditioning`, `voting`, `revealing`, `locked_in`, `collapsed`

1.4. **Add `HealthBarState` and `HealthBarDrain` interfaces:**
```typescript
interface HealthBarState {
  current: number;
  drainFactor: number;
  layerMultipliers: number[];
  history: HealthBarDrain[];
}
interface HealthBarDrain {
  layerIndex: number;
  losingProportion: number;
  layerMultiplier: number;
  drainAmount: number;
  healthAfter: number;
}
```

1.5. **Update `AttemptState` interface:**
- Keep `collapsedAtLayer`
- Keep 'collapsed' in status union type (keep: `pending`, `in_progress`, `completed`, `collapsed`)
- Add: `healthBar: HealthBarState`

1.6. **Update `LayerResult` interface:**
- Keep `unreached` status and `status` field
- `chosenOption` and `consensus` are null when unreached
- Add: `drainAmount: number | null`

1.7. **Update `ShowPhase` type:**
- Remove: `finale_setup`, `finale_rotating`, `finale_frozen`
- Add: `attempt_resolve`, `finale_elegy`, `finale_consensus`, `finale_performer_mix`

1.8. **Replace `FinaleState` interface entirely** with the new version from ARCHITECTURE-V2.md (consensus game state, NPC state, performer mix state).

1.9. **Update `Fragment` interface:**
- Remove: `safeParameter` field
- Add: `displayLabel: string`

1.10. **Remove interfaces that no longer exist:**
- `SafeParameter`
- `QueueEntry` / `FinaleQueue`
- `ActiveSlot`
- `TrianglePosition`
- `StewardshipEntry`
- `FragmentSelection`

1.11. **Update `User` interface:**
- Remove: `finaleChapter` field

1.12. **Add new interfaces:**
- `PendingChange` (for performer mix)
- `NpcTriggerConfig` (for NPC auto-triggers)

1.13. **Update `ShowConfig` and sub-configs:**
- Rename `maxLayersPerAttempt` → `layersPerAttempt` (always 7)
- Add `drainFactor` to `AttemptConfig`
- Replace `FinaleConfig` entirely (remove rotation/triangle/stewardship config; add consensus and performer mix config)
- Update `TimingConfig` (remove collapse duration; add reveal sequence and rejection durations)

### Verification
- Run TypeScript compiler. It will produce many errors — that's expected and useful. The errors are your map for the remaining migration phases.
- Do NOT fix the downstream errors yet. Just confirm the types compile cleanly in isolation.

---

## Phase 2: Refactor Conductor — Song-Building ✅ COMPLETE (2026-03-06)

**Goal:** Replace Doubt/collapse mechanics with Health Bar and blind vote.

### Steps

2.1. **Create `conductor/health-bar.ts`:**
- Implement `createHealthBar(drainFactor: number, layerMultipliers: number[]): HealthBarState`
- Implement `calculateDrain(votesA: number, votesB: number, drainFactor: number, layerMultiplier: number): HealthBarDrain` — drain = (min(votesA,votesB) / total) * 100 * drainFactor * layerMultiplier
- Implement `applyDrain(healthBar: HealthBarState, drain: HealthBarDrain): HealthBarState` — subtracts drain, floors at 0, appends to history
- Implement `isCollapsed(healthBar: HealthBarState): boolean` — returns true if current <= 0
- Write unit tests:
  - `test('drain amount equals losing proportion times drain factor times layer multiplier')`
  - `test('health bar never goes below zero')`
  - `test('70/30 split with factor 0.5 and multiplier 1.0 drains 15 points')`
  - `test('same split with multiplier 2.0 drains 30 points')`
  - `test('layer multiplier 0.5 makes early layers cheap')`
  - `test('isCollapsed returns true at zero, false above zero')`

2.2. **Rename/refactor `conductor/consensus.ts` → `conductor/voting.ts`:**
- Keep the `calculateConsensus` function (still needed for determining winner)
- Remove all per-layer doubt threshold logic
- Add `calculateVoteResult` that returns the winner plus the health bar drain
- Write unit tests:
  - `test('majority wins regardless of margin')`
  - `test('vote result includes drain calculation with layer multiplier')`
  - `test('tie defaults to Option A')`

2.3. **Update `conductor/conductor.ts` — song-building flow:**
- Remove `SET_THRESHOLD`, `TOGGLE_DOUBT`, and `FORCE_CONTINUE` command handling
- Keep `FORCE_COLLAPSE` command (forces immediate collapse regardless of health bar)
- Add `TRIGGER_REJECTION` command handling (emits `SONG_REJECTED` event + `AUDIO_CUE`)
- Update `CLOSE_VOTING` handler:
  - Calculate vote result
  - Calculate drain using current layer's multiplier from config
  - Apply drain to health bar
  - Emit `VOTE_RESULT` (includes drain info) and `HEALTH_BAR_DRAINED`
  - **If health bar reaches 0**: enter `collapsed` phase, mark all remaining layers as `unreached`, emit `ATTEMPT_COLLAPSED`, auto-advance after collapse animation
  - **If health bar > 0**: transition layer to `revealing`, then `locked_in`
  - If all layers are `locked_in`, transition attempt status to `completed`, emit `ATTEMPT_COMPLETED`
- Add `attempt_resolve` phase handling (waiting for performer to trigger rejection and advance)
- Write unit tests:
  - `test('health bar drains after each vote with correct layer multiplier')`
  - `test('attempt collapses when health bar reaches zero')`
  - `test('unreached layers are marked correctly after collapse')`
  - `test('all 7 layers complete when health bar survives')`
  - `test('completed attempt transitions to attempt_resolve')`
  - `test('song rejection triggers audio cue')`
  - `test('FORCE_COLLAPSE works regardless of health bar state')`

2.4. **Remove old doubt-related files/functions:**
- Delete any standalone doubt threshold module
- Remove per-layer doubt threshold configuration from show config defaults

### Verification
- All song-building conductor tests pass
- No references to `doubtThreshold`, `FORCE_CONTINUE`, `SET_THRESHOLD`, `TOGGLE_DOUBT` remain in conductor code
- Health bar correctly tracks cumulative drain with layer multipliers
- Collapse triggers correctly when health reaches zero
- Songs can both collapse and complete depending on audience alignment

---

## Phase 3: Refactor Conductor — Finale ✅ COMPLETE (2026-03-06)

**Goal:** Replace rotation/stewardship/triangle with consensus game + performer mix.

### Steps

3.1. **Delete old finale modules:**
- Delete `conductor/finale.ts` (rotation, scheduling, stewardship, triangle logic)
- Delete associated tests

3.2. **Create `conductor/consensus-game.ts`:**
- Implement `startRound(threshold: number): ConsensusRoundState`
- Implement `submitVote(votes: Map, userId: string, fragmentId: string): Map` (returns updated votes map)
- Implement `calculateConvergence(votes: Map): ConvergenceResult` (returns convergence value + leading fragment)
- Implement `resolveRound(votes: Map, threshold: number, availableFragments: Fragment[]): RoundResult` (success/failure + winning fragment if success)
- Implement `adjustThreshold(currentThreshold: number, consecutiveFailures: number, config: FinaleConfig): number`
- Write unit tests:
  - `test('convergence is highest vote proportion regardless of which fragment')`
  - `test('round succeeds when convergence >= threshold')`
  - `test('round fails when convergence < threshold')`
  - `test('threshold decreases after consecutive failures')`
  - `test('threshold resets after success')`
  - `test('threshold never drops below minimum')`
  - `test('vote change updates convergence correctly')`
  - `test('game completes when all roles have active fragment')`

3.3. **Create `conductor/performer-mix.ts`:**
- Implement `queueChange(pending: PendingChange[], layerType: LayerType, fragmentId: string | null): PendingChange[]`
- Implement `cancelPending(pending: PendingChange[], layerType: LayerType): PendingChange[]`
- Implement `firePendingChanges(activeLayers: Map, pending: PendingChange[]): { activeLayers: Map, firedChanges: PendingChange[] }`
- Implement `loadSnapshot(snapshot: Map): PendingChange[]` (converts snapshot to pending changes)
- Write unit tests:
  - `test('queuing a fragment adds to pending changes')`
  - `test('queuing null mutes the layer')`
  - `test('cancel removes pending change for layer')`
  - `test('fire applies all pending changes and clears queue')`
  - `test('only one fragment per layer after firing')`
  - `test('snapshot loads all layers as pending changes')`

3.4. **Create `conductor/npc.ts`:**
- Implement `evaluateAutoTriggers(gameState: ConsensusGameState, config: NpcTriggerConfig[]): string | null`
- Define trigger conditions: consecutive failures, same-song streak, near-miss, first success, last fragment, etc.
- Write unit tests:
  - `test('triggers exasperation on same-song convergence streak')`
  - `test('triggers encouragement on near-miss')`
  - `test('does not trigger on every round')`

3.5. **Update `conductor/conductor.ts` — finale flow:**
- Add `SETUP_FINALE` handler: compute available/locked fragments from attempt results
- Add consensus game command handlers: `START_CONSENSUS_ROUND`, `SUBMIT_CONSENSUS_VOTE`, `END_CONSENSUS_ROUND`, `SET_CONSENSUS_THRESHOLD`, `SEND_NPC_MESSAGE`
- Add performer mix command handlers: `START_PERFORMER_MIX`, `QUEUE_FRAGMENT`, `CANCEL_PENDING`, `FIRE_PENDING_CHANGES`, `LOAD_SNAPSHOT`, `TOGGLE_LIVE_TRACK`
- Remove old finale command handlers: `SELECT_FRAGMENT`, `UPDATE_TRIANGLE`, `UPDATE_STEWARD_PARAM`, `START_ROTATION`, `STOP_ROTATION`, `FREEZE_ROTATION`, `SET_ROTATION_RATE`, `FORCE_ASSIGN_STEWARD`, `FORCE_INSERT_FRAGMENT`, `CLEAR_QUEUE`, `TOGGLE_TRIANGLE`

3.6. **Update `conductor/fragments.ts`:**
- Simplify: all layers are always completed, so fragment generation is straightforward
- Winning option → available fragment
- Losing option → locked fragment
- No need to handle `unreached` status

### Verification
- All finale conductor tests pass ✅
- No references to rotation, stewardship, triangle, centroid, queue scheduling remain ✅
- Consensus game round lifecycle works correctly ✅
- Performer mix pending changes queue works correctly ✅

**Actual implementation notes (vs original spec):**
- `calculateConvergence` signature: takes `Map<UserId, FragmentId>`, returns `{ convergence, leadingFragment, distribution }`
- `resolveRound` takes `lockedRoles` param to verify winning fragment's layerType isn't already locked
- `adjustThreshold` is stateless — caller manages `consecutiveFailures` counter, passes 0 on success
- `fragments.ts` updated: `displayName` → `displayLabel`, `safeParameter` removed (V2 Fragment type alignment)
- 185 tests passing across 9 conductor suites

---

## Phase 4: Update Server Layer ✅ COMPLETE

**Goal:** Update Socket.IO handlers, timing engine, and OSC routing for new mechanics.

### Steps

4.1. **Update `server/socket.ts`:**
- Remove event handlers: `select_fragment`, `triangle_update`, `steward_param`
- Add event handler: `consensus_vote` (routes to conductor's `SUBMIT_CONSENSUS_VOTE`)
- Update `vote` handler to match blind vote mechanics (no change in vote during window)
- Add high-frequency `convergence_update` broadcast during consensus rounds (~4-5 Hz)
- Add `npc_message` broadcast event
- Remove `meter` broadcast event (audio metering removed)

4.2. **Update `server/timing.ts`:**
- Update loop boundary detection to support pending changes firing
- Add hook: on loop boundary, call conductor's `FIRE_PENDING_CHANGES` during performer mix phase
- Add consensus round timer management (start timer on round start, fire `END_CONSENSUS_ROUND` on expiry)
- Remove rotation tick logic

4.3. **Update `server/audio-router.ts`:**
- Add collapse cue routing (trigger return track effects via OSC when health bar reaches 0)
- Add song rejection cue routing (trigger distinct return track effects via OSC for completed songs)
- Add consensus game activation routing (unmute track on successful consensus)
- Add performer mix routing (batch mute/unmute commands at loop boundary)
- Remove stewardship parameter routing
- Remove rotation slot activation/deactivation routing

4.4. **Remove `server/metering.ts`** (audio metering for slot energy — removed in V2)

4.5. **Update `server/persistence.ts`:**
- Update schema: remove `fragment_selections` table, remove `finale_chapter` from users
- Add `consensus_rounds` table
- Update JSON serialization for new state shape

### Verification
- Server starts without errors
- WebSocket events match the new protocol
- Timing engine correctly fires pending changes at loop boundaries
- OSC commands correctly route for all new mechanics

---

## Phase 5: Update Client — Song-Building UI

**Goal:** Replace doubt meter with health bar, implement blind vote + reveal sequence.

### Steps

5.1. **Create `components/song-building/HealthBar.tsx`:**
- Visual health bar component (configurable orientation, animated drain)
- Receives current health value and animates transitions
- Shows drain shadow during reveal sequence
- Visible on both audience phones and projector

5.2. **Create `components/song-building/RevealSequence.tsx`:**
- Orchestrates the 4-beat reveal: tension → split reveal → health drain → lock-in
- Receives vote result data and health bar drain
- Animates option cards (winner grows, loser shrinks)
- Triggers health bar drain animation

5.3. **Update `components/song-building/OptionCards.tsx`** (renamed from OptionCard):
- Two large tappable cards, side by side
- No live vote count or consensus bar during voting window (blind vote)
- Cards become non-interactive after vote is submitted (no vote changing)
- Transition to reveal state when voting closes

5.4. **Delete old components:**
- Delete `ConsensusBar.tsx`
- Delete `DoubtMeter.tsx`
- Delete `LayerGrid.tsx` and `LayerSquare.tsx` (replaced by simpler layer progress indicator)

5.5. **Create `components/song-building/LayerProgress.tsx`:**
- Shows completed layers (with chapter color of winning option) and upcoming layers
- Simpler than old grid — just a progress strip showing layer icons

5.6. **Update audience page (`app/audience/page.tsx`):**
- Song-building view: OptionCards + HealthBar + LayerProgress
- Reveal sequence plays after each vote
- No doubt-related UI elements

5.7. **Update projector page (`app/projector/page.tsx`):**
- Song-building view: large health bar, current layer card, reveal animation, stack history

### Verification
- Audience can vote A/B with no live split feedback
- Reveal sequence plays correctly after each vote
- Health bar animates drain correctly
- Layer progress tracks completed layers

---

## Phase 6: Update Client — Finale UI

**Goal:** Build consensus game board, convergence meter, NPC display, and performer mixing surface.

### Steps

6.1. **Create `components/finale/ElegyGrid.tsx`:**
- Full fragment display organized by role
- Winners glow, losers dimmed/cracked
- Non-interactive, observational only

6.2. **Create `components/finale/ConsensusBoard.tsx`:**
- Clean game board showing only available fragments
- Role rows with tappable fragment tiles
- Chapter color backgrounds on tiles, emotional labels
- Personal history dots (subtle indicator if user voted for this during song-building)
- Locked role compression animation
- Vote highlighting (your current selection is prominent)

6.3. **Create `components/finale/ConvergenceMeter.tsx`:**
- Real-time animated meter pinned to top of screen
- Threshold zone visible (glow shift when convergence enters zone)
- Spring/easing animation between received values (~4-5 Hz updates)
- Round timer integrated or adjacent
- No numeric values, no fragment-level breakdown

6.4. **Create `hooks/useConvergence.ts`:**
- Listens to `convergence_update` socket events
- Smooths between values with spring animation
- Provides current animated value to ConvergenceMeter component

6.5. **Create `components/finale/NpcDisplay.tsx`:**
- Terminal-style typeface
- Appears below convergence meter when message active
- Typing animation for text entry
- Fades out after display duration

6.6. **Create `components/finale/MixingSurface.tsx`:**
- 7×6 grid for controller
- Tap to queue, tap again to cancel
- Active fragment highlighting, pending change pulsing
- Loop position indicator
- Mute toggle per row
- Snapshot preset buttons

6.7. **Create `components/finale/MixingMirror.tsx`:**
- Simplified projector view of mixing state
- 7 rows showing active layer type + chapter color of active fragment
- Pending changes pulsing
- Loop position indicator

6.8. **Create `components/finale/LoopIndicator.tsx`:**
- Progress bar or radial timer showing position in 8-bar loop
- Used by both MixingSurface and MixingMirror

6.9. **Delete old finale components:**
- Delete `FragmentSelector.tsx`
- Delete `TriangleSteering.tsx`
- Delete `StewardSlider.tsx`
- Delete `SlotCard.tsx`
- Delete `SlotGrid.tsx`

6.10. **Delete `hooks/useTriangle.ts`**

6.11. **Update audience page — finale views:**
- Elegy phase: ElegyGrid
- Consensus phase: ConsensusBoard + ConvergenceMeter + NpcDisplay
- Performer mix phase: TBD (see Open Questions)

6.12. **Update projector page — finale views:**
- Elegy phase: richer version of ElegyGrid
- Consensus phase: convergence visualization, celebration animations, NPC text
- Performer mix phase: MixingMirror

6.13. **Update controller page — finale views:**
- Consensus phase: ConsensusControls + NpcControls + convergence data (including which fragment is leading)
- Performer mix phase: MixingSurface + SnapshotPresets

### Verification
- Consensus game full round lifecycle works end-to-end (vote → meter → timer → resolve)
- Convergence meter updates smoothly in real time
- Role locking and grid compression work correctly
- NPC messages display and clear correctly
- Performer mixing surface queues and fires changes at loop boundaries
- Projector mirrors mix state correctly

---

## Phase 7: Update Controller UI

**Goal:** Replace old controller panels with new mechanics controls.

### Steps

7.1. **Delete `components/controller/DoubtControls.tsx`**

7.2. **Rename/refactor `components/controller/FinaleControls.tsx`:**
- Remove rotation, queue, stewardship, triangle controls
- Replace with consensus game controls and performer mix controls

7.3. **Create `components/controller/HealthBarControls.tsx`:**
- Drain factor adjustment (slider or presets)
- Current health display
- Manual health override

7.4. **Create `components/controller/ConsensusControls.tsx`:**
- Start/stop consensus rounds
- Current convergence value + which fragment is leading (controller-only data)
- Round number, consecutive failures count
- Threshold adjustment
- Force-lock a fragment (emergency override)

7.5. **Create `components/controller/NpcControls.tsx`:**
- Bank of pre-written NPC lines (categorized by situation)
- Free-text input for improvised lines
- Fire button to send NPC message
- Toggle for auto-triggers on/off

7.6. **Create `components/controller/SnapshotPresets.tsx`:**
- Configurable snapshot buttons
- Each button labels what mix state it loads
- Visual indicator of which preset is closest to current state

7.7. **Update `MetricsPanel.tsx`:**
- Remove: triangle weights, steward tracking, queue lengths
- Add: health bar status per attempt, consensus game metrics, performer mix state

### Verification
- Controller has all necessary controls for every show phase
- No references to old mechanics (doubt, rotation, stewardship, triangle) in controller UI

---

## Phase 8: Update Configuration Files

**Goal:** Update show config defaults and Ableton layout for new layer types and structure.

### Steps

8.1. **Update `config/default-show.json`:**
- Update layer types in all attempt configs
- Add staggered layer ordering per song
- Add `drainFactor` per attempt
- Remove doubt thresholds
- Add finale config (consensus game parameters, NPC triggers)
- Remove rotation/stewardship/triangle config

8.2. **Update `config/ableton-layout.json`:**
- Update track index mappings for 7 layer types × 3 songs × 2 options = 42 tracks
- Add rejection effect return track mapping
- Remove stewardship parameter mappings
- Add live performance track mappings

8.3. **Create `config/npc-triggers.json`:**
- Define auto-trigger conditions and corresponding NPC lines
- Categories: failure reactions, success reactions, pattern detection, pacing messages

8.4. **Update `db/schema.sql`:**
- Remove `finale_chapter` from users table
- Remove `fragment_selections` table
- Add `consensus_rounds` table

### Verification
- Default config loads without errors
- Track index calculations match expected Ableton layout
- Schema migrations apply cleanly

---

## Phase 9: Integration Testing

**Goal:** End-to-end verification of the complete show flow.

### Steps

9.1. **Test complete show flow without Ableton (fallback mode):**
- Lobby → Opener → 3 song-building cycles → Finale
- Verify all phase transitions
- Verify health bar tracks with layer multipliers across all layers in all attempts
- Test both outcomes: collapse (health bar reaches 0) and completion (performer rejects)
- Verify unreached layers are correctly marked after collapse
- Verify consensus game round lifecycle
- Verify performer mix pending changes

9.2. **Test with mock Ableton (osc-mock-ableton):**
- Verify OSC commands fire correctly for each mechanic:
  - Layer lock-in: correct track unmuted
  - Collapse: return track effects triggered, active tracks muted
  - Song rejection: distinct return track effect triggered (different from collapse)
  - Consensus game: correct track unmuted on success
  - Performer mix: batch mute/unmute at loop boundary
- Verify timing engine loop boundary detection

9.3. **Test multi-client scenarios:**
- Connect 5+ audience clients
- Verify blind vote mechanics (no premature split exposure)
- Verify consensus game convergence calculation with real vote distribution
- Verify convergence meter updates at ~4-5 Hz to all audience clients
- Verify NPC messages display on all clients simultaneously

9.4. **Test edge cases:**
- Unanimous vote (100/0 split) → zero drain
- Perfect tie (50/50) → maximum drain (may collapse depending on health and multiplier)
- Health bar reaches exactly 0 → collapse triggers
- High layer multiplier on layer 6–7 causes collapse even with moderate alignment
- Song completes with health barely above 0 → transitions to attempt_resolve, not collapse
- FORCE_COLLAPSE with full health bar → immediate collapse
- Consensus game with sparse fragments (due to early collapses) → still playable
- Consensus game with only one available fragment per role → trivial convergence
- Performer queues changes then cancels before boundary
- Client disconnect and reconnect during consensus round

### Verification
- Complete show can run from lobby to ended without errors
- All mechanics work as specified in ARCHITECTURE-V2.md
- State persists and recovers correctly across server restarts

---

## Phase 10: Cleanup

**Goal:** Remove all dead code and update documentation.

### Steps

10.1. Remove any remaining references to removed systems (per-layer doubt thresholds, stewardship, triangle, centroid, chapter assignment, rotation queue)
- Search for: `stewardship`, `steward`, `triangle`, `centroid`, `rotation`, `doubtThreshold`, `finaleChapter`, `SafeParameter`, `QueueEntry`, `ActiveSlot`, `TrianglePosition`, `StewardshipEntry`, `FragmentSelection`, `select_fragment`, `triangle_update`, `steward_param`, `FORCE_CONTINUE`, `SET_THRESHOLD`, `TOGGLE_DOUBT`
- NOTE: `collapsed`, `FORCE_COLLAPSE`, `ATTEMPT_COLLAPSED`, `unreached`, `collapsedAtLayer` are VALID terms in V2 — do NOT remove these

10.2. Replace ARCHITECTURE.md with ARCHITECTURE-V2.md (rename V2 to become the canonical document)

10.3. Update README.md with any new setup steps

10.4. Update CLAUDE.md with new context for AI agents

10.5. Add CHANGELOG.md entry:
```markdown
## V2 — Architecture Redesign
**Context:** Complete redesign of song-building and finale mechanics based on
narrative and gameplay exploration.
**Changes:**
- Song-building: Doubt/collapse → Health Bar + blind vote + performer rejection
- Finale: Rotation/stewardship/triangle → Consensus game + performer mix
- Layer types updated to 7 (Melody, Drums, Pad, Bass, Harmony, FX1, FX2)
- Data models simplified significantly
**Implications:** All client UIs rebuilt. Conductor logic substantially rewritten.
OSC routing updated. Ableton session needs redesign for new layer types.
```

10.6. Update DECISIONS.md with resolved decisions and remaining open questions from ARCHITECTURE-V2.md

### Verification
- No dead imports or unused files remain
- `grep` for removed terms (stewardship, triangle, centroid, rotation, doubtThreshold, collapsed) returns zero results in source code
- All documentation is consistent with V2 architecture

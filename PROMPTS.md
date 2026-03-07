# Solo Show — Migration Prompts for AI Agent

## How to Use This File

Each section below is a self-contained prompt you can copy-paste to an AI coding agent (e.g., Claude) to execute one phase of the V1 → V2 migration. Execute them in order — each phase depends on the previous one.

**Before starting:** Ensure the agent has access to:
- `ARCHITECTURE-V2.md` (the new architecture spec — source of truth)
- `MIGRATION.md` (the step-by-step migration plan)
- The current codebase

**For each prompt:** Copy the prompt text, paste it to the agent, and let it execute. Review the output before moving to the next phase.

---

## Prompt 1: Update Types & Data Models

```
Read ARCHITECTURE-V2.md thoroughly before making any changes. This is the source of truth for the new system design.

Your task is to update all TypeScript type definitions in the codebase to match the V2 architecture. This is Phase 1 of the migration described in MIGRATION.md.

Specific changes needed in conductor/types.ts (or wherever types are defined):

1. Update LayerType to: 'melody' | 'drums' | 'pad' | 'bass' | 'harmony' | 'fx1' | 'fx2'

2. Remove doubtThreshold from LayerConfig.

3. Update LayerPhase — rename 'resolving' to 'revealing', keep 'collapsed'. Final set: 'locked' | 'auditioning' | 'voting' | 'revealing' | 'locked_in' | 'collapsed'

4. Add HealthBarState and HealthBarDrain interfaces (see ARCHITECTURE-V2.md Data Models section). Note: HealthBarState includes layerMultipliers: number[] and HealthBarDrain includes layerMultiplier: number.

5. Update AttemptState — keep collapsedAtLayer, keep 'collapsed' in status union, add healthBar: HealthBarState.

6. Update LayerResult — keep 'unreached' status and status field. chosenOption and consensus are null when unreached. Add drainAmount: number | null.

7. Update ShowPhase — remove finale_setup/finale_rotating/finale_frozen, add attempt_resolve/finale_elegy/finale_consensus/finale_performer_mix.

8. Replace FinaleState entirely with the new interface from ARCHITECTURE-V2.md (has consensusGame, npc, and performerMix sub-objects).

9. Update Fragment — remove safeParameter, add displayLabel: string.

10. Delete these interfaces entirely: SafeParameter, QueueEntry, FinaleQueue, ActiveSlot, TrianglePosition, StewardshipEntry, FragmentSelection.

11. Update User — remove finaleChapter field.

12. Add PendingChange interface: { layerType: LayerType; fragmentId: string | null; queuedAt: number }

13. Update ShowConfig: rename maxLayersPerAttempt to layersPerAttempt (always 7), add drainFactor and layerMultipliers to AttemptConfig, replace FinaleConfig entirely, update TimingConfig.

Do NOT fix downstream compilation errors yet — just update the type definitions. Run the TypeScript compiler to confirm the types themselves compile cleanly, then list all the downstream errors so we can address them in subsequent phases.
```

---

## Prompt 2: Refactor Song-Building Conductor Logic

```
Read ARCHITECTURE-V2.md, specifically the "Song-Building Phase — Detailed Mechanics" section. Also read MIGRATION.md Phase 2.

Your task is to refactor the conductor's song-building logic to replace per-layer Doubt thresholds with the Health Bar system (cumulative drain with layer multipliers and collapse).

Step 1: Create conductor/health-bar.ts with these functions:
- createHealthBar(drainFactor: number, layerMultipliers: number[]): HealthBarState — initializes at 100
- calculateDrain(votesA: number, votesB: number, drainFactor: number, layerMultiplier: number): HealthBarDrain — drain = (min(votesA,votesB) / total) * 100 * drainFactor * layerMultiplier
- applyDrain(healthBar: HealthBarState, drain: HealthBarDrain): HealthBarState — subtracts drain, floors at 0, appends to history
- isCollapsed(healthBar: HealthBarState): boolean — returns true if current <= 0

Write unit tests for health-bar.ts:
- 70/30 split with factor 0.5 and multiplier 1.0 drains 15 points
- Same split with multiplier 2.0 drains 30 points
- 50/50 split with factor 0.5 and multiplier 1.0 drains 25 points
- Layer multiplier 0.5 makes early layers cheap (70/30 split drains only 7.5)
- Health bar never goes below zero
- isCollapsed returns true at 0, false above 0
- Drain history accumulates correctly

Step 2: Refactor conductor/consensus.ts → conductor/voting.ts:
- Keep calculateConsensus (determines winner)
- Remove ALL per-layer doubt threshold logic
- Add calculateVoteResult that returns winner + drain info (using layer multiplier)

Step 3: Update conductor/conductor.ts for song-building:
- Remove these command handlers: SET_THRESHOLD, TOGGLE_DOUBT, FORCE_CONTINUE
- Keep FORCE_COLLAPSE command (forces immediate collapse regardless of health bar state)
- The layer flow is: locked → auditioning → voting → revealing → locked_in OR collapsed
- When CLOSE_VOTING fires:
  - Calculate winner
  - Calculate drain using current layer's multiplier from attempt config
  - Apply drain to health bar
  - Emit VOTE_RESULT (includes drain info) and HEALTH_BAR_DRAINED
  - IF health bar reaches 0: enter 'collapsed' phase, mark all remaining layers as 'unreached', emit ATTEMPT_COLLAPSED, auto-advance after collapse animation duration
  - IF health bar > 0: transition to 'revealing', then 'locked_in', advance to next layer
- When all 7 layers are locked_in (health survived): set attempt status to 'completed', emit ATTEMPT_COMPLETED, transition to attempt_resolve
- Add TRIGGER_REJECTION command: emits SONG_REJECTED event and AUDIO_CUE (only valid during attempt_resolve)
- Add attempt_resolve phase handling

Write unit tests:
- Health bar drains correctly with layer multiplier for each layer
- Attempt collapses when health bar reaches zero mid-song
- Unreached layers are correctly marked after collapse
- All 7 layers complete when health bar survives the full song
- Completed attempt transitions to attempt_resolve (not collapse)
- Song rejection triggers correct events during attempt_resolve
- FORCE_COLLAPSE works regardless of health bar state
- Later layers cost more than early layers with default multipliers [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]

Important: Songs can EITHER collapse (health bar reaches 0) OR complete (health bar survives all 7 layers). Both paths must work. Collapse auto-advances to next story phase. Completion transitions to attempt_resolve where the performer triggers a narrative rejection.
```

---

## Prompt 3: Build Consensus Game Logic

```
Read ARCHITECTURE-V2.md, specifically the "Phase 2: Consensus Game" section within the Finale System. Also read MIGRATION.md Phase 3.

Your task is to build the consensus game logic for the finale. This replaces the old rotation/stewardship/triangle system entirely.

Step 1: Delete conductor/finale.ts and its tests (the old rotation/queue/stewardship/triangle logic). We are replacing it completely.

Step 2: Create conductor/consensus-game.ts with these functions:

- calculateConvergence(votes: Map<UserId, FragmentId>): { convergence: number, leadingFragment: FragmentId, distribution: Map<FragmentId, number> }
  Convergence = (max vote count for any single fragment) / (total votes). The distribution map is only for the controller — the audience never sees which fragment is leading.

- resolveRound(votes: Map, threshold: number, availableFragments: Fragment[]): { success: boolean, winningFragment?: Fragment, convergence: number }
  Success if leading fragment's convergence >= threshold AND the fragment is in an unlocked role.

- adjustThreshold(current: number, consecutiveFailures: number, decayPerFailure: number, minimum: number): number
  Decreases threshold after failures, resets on success.

Write unit tests:
- 40 users, 16 vote for fragment X → convergence = 0.4
- Round succeeds when convergence >= threshold at resolution
- Round fails when convergence < threshold
- Threshold decreases by decay amount per consecutive failure
- Threshold never drops below minimum
- Threshold resets to initial value after a success
- When all 7 roles are locked, game is complete
- Vote changes update convergence correctly (user switches from fragment A to fragment B)

Step 3: Create conductor/performer-mix.ts with these functions:

- queueChange(pending: PendingChange[], layerType: LayerType, fragmentId: string | null): PendingChange[]
  Adds a pending change. If a pending change already exists for this layerType, replace it.

- cancelPending(pending: PendingChange[], layerType: LayerType): PendingChange[]
  Removes the pending change for this layerType.

- firePendingChanges(activeLayers: Map<LayerType, string | null>, pending: PendingChange[]): { activeLayers: Map, firedChanges: PendingChange[] }
  Applies all pending changes to active layers, returns updated state and list of what fired, clears pending.

Write unit tests:
- Queuing a fragment adds to pending
- Queuing null queues a mute
- Cancel removes pending for that layer
- Fire applies all pending and clears the queue
- Only one fragment active per layer after firing
- Queuing for a layer that already has a pending change replaces it

Step 4: Create conductor/npc.ts:
- evaluateAutoTriggers(gameState, triggerConfigs): string | null
- Trigger conditions to implement: consecutive_failures (threshold count), same_song_streak (count), near_miss (convergence was close), first_success, final_fragment, single_option_role

Step 5: Update conductor/conductor.ts for finale:
- Remove old finale commands: SELECT_FRAGMENT, UPDATE_TRIANGLE, UPDATE_STEWARD_PARAM, START_ROTATION, STOP_ROTATION, FREEZE_ROTATION, SET_ROTATION_RATE, FORCE_ASSIGN_STEWARD, FORCE_INSERT_FRAGMENT, CLEAR_QUEUE, TOGGLE_TRIANGLE
- Add SETUP_FINALE: compute available fragments (winners from all attempts) and locked fragments (losers)
- Add START_CONSENSUS_ROUND, SUBMIT_CONSENSUS_VOTE, END_CONSENSUS_ROUND
- Add START_PERFORMER_MIX, QUEUE_FRAGMENT, CANCEL_PENDING, FIRE_PENDING_CHANGES, LOAD_SNAPSHOT, TOGGLE_LIVE_TRACK
- Add SEND_NPC_MESSAGE, SET_CONSENSUS_THRESHOLD
```

---

## Prompt 4: Update Server Layer

```
Read ARCHITECTURE-V2.md, specifically the WebSocket Protocol, Audio Engine, and Environment Variables sections. Also read MIGRATION.md Phase 4.

Your task is to update the server layer (Socket.IO handlers, timing engine, OSC routing) for the new mechanics.

Step 1: Update server/socket.ts:
- Remove these client→server event handlers: select_fragment, triangle_update, steward_param
- Add handler for 'consensus_vote' event: { fragmentId: string } from audience during finale_consensus phase. Routes to conductor SUBMIT_CONSENSUS_VOTE command.
- The 'vote' handler stays but ensure it matches blind vote mechanics (vote is final, no changing during window).
- Add high-frequency broadcast: during active consensus rounds, broadcast 'convergence_update' event at ~4-5 Hz to audience and projector clients. Payload: { value: number }. This is separate from state_sync.
- Add 'npc_message' broadcast: { message: string } to audience and projector.
- Remove 'meter' broadcast (audio metering removed in V2).

Step 2: Update server/timing.ts:
- Add loop boundary hook: during finale_performer_mix phase, on each loop boundary (every 8 bars), call conductor's FIRE_PENDING_CHANGES command. This causes all queued fragment changes to fire simultaneously.
- Add consensus round timer: when a consensus round starts, set a timer for the configured duration. When it expires, call conductor's END_CONSENSUS_ROUND command.
- Remove rotation tick logic (old finale rotation system).

Step 3: Update server/audio-router.ts:
- Map ATTEMPT_COLLAPSED event to OSC: trigger collapse effects on return track (distortion, filter sweep, rapid fade on all active tracks, then mute all)
- Map SONG_REJECTED event to OSC: trigger rejection effect on return track (distinct from collapse effect)
- Map CONSENSUS_ROUND_SUCCESS event to OSC: unmute the winning fragment's track (use track index calculation from ARCHITECTURE-V2.md)
- Map PENDING_CHANGES_FIRED event to OSC: batch of mute/unmute commands for all fired changes
- Remove stewardship parameter OSC routing
- Remove rotation slot activation/deactivation routing

Step 4: Delete server/metering.ts (audio metering for slot energy is removed in V2).

Step 5: Update server/persistence.ts:
- Update schema: remove fragment_selections table, remove finale_chapter from users table
- Add consensus_rounds table (see ARCHITECTURE-V2.md Persistence section)
- Update state serialization for new FinaleState shape

Step 6: Add new environment variables from ARCHITECTURE-V2.md (CONSENSUS_* variables, DEFAULT_DRAIN_FACTOR).

Run all server tests. Fix any failures related to the type and conductor changes from previous phases.
```

---

## Prompt 5: Build Song-Building UI

```
Read ARCHITECTURE-V2.md, specifically the /audience and /projector sections for song-building phases. Also read MIGRATION.md Phase 5.

Your task is to build the new song-building UI components replacing the old doubt-based interface.

Step 1: Create components/song-building/HealthBar.tsx
- A visual gauge showing song vitality from 100 to 0
- Animated transitions when health drains
- During reveal sequence: shows a "drain shadow" (preview of how much will be lost) before animating the actual drain
- Should work on both audience phones (smaller, horizontal) and projector (larger, more dramatic)
- No numeric labels — purely visual. Color shifts from healthy (green/bright) to critical (red/dark) as health decreases.

Step 2: Create components/song-building/RevealSequence.tsx
- Orchestrates the post-vote reveal in 4 beats:
  1. Tension (both options shown, no result, ~1 second)
  2. Split reveal (winner grows, loser shrinks proportionally, ~2 seconds)
  3. Health drain (HealthBar animates the drain, ~2 seconds)
  4. Lock-in (winning audio enters mix, advance to next layer)
- Receives VoteResult data (winner, votesA, votesB, drain info)
- The split should be shown visually through the SIZES of the option cards, not through numbers or percentages

Step 3: Create components/song-building/OptionCards.tsx
- Two large tappable cards side by side: Option A (left) and Option B (right)
- Styled with the current layer's color and symbol
- Emotional tagline label on each card
- During voting: tappable, no feedback on what others voted (BLIND VOTE)
- After user votes: their choice is subtly highlighted but they cannot see the overall split
- After voting closes: cards transition into the RevealSequence
- Users CANNOT change their vote once submitted (unlike the finale consensus game)

Step 4: Create components/song-building/LayerProgress.tsx
- Horizontal strip showing all 7 layers for the current attempt
- Completed layers show their layer type icon with the winning option's chapter color
- Current layer is highlighted/active
- Future layers show locked layer type icon
- Personal history dot on completed layers (which side user voted for)

Step 5: Delete old components:
- ConsensusBar.tsx
- DoubtMeter.tsx
- LayerGrid.tsx
- LayerSquare.tsx

Step 6: Update app/audience/page.tsx for song-building view:
- Layout: HealthBar (top), LayerProgress (below health bar), OptionCards (center, main interaction), RevealSequence (replaces OptionCards during reveal)

Step 7: Update app/projector/page.tsx for song-building view:
- Layout: Large HealthBar, current layer card with A vs B, reveal animation, stack of completed layers

Use the layer type colors/symbols from the Visual Identity System in ARCHITECTURE-V2.md. These are placeholders (TBD) so use reasonable defaults that can be easily swapped later via the identity.ts config.
```

---

## Prompt 6: Build Finale UI — Consensus Game

```
Read ARCHITECTURE-V2.md, specifically the entire Finale System section and the /audience, /projector, /controller route descriptions for finale phases. Also read MIGRATION.md Phase 6.

Your task is to build the finale UI components. This is the largest UI phase.

PART A — Audience Phone Components:

1. Create components/finale/ElegyGrid.tsx
- Shows ALL fragments from all 3 songs, organized by role (7 rows)
- Winning fragments glow with their chapter color
- Losing fragments are dimmed/desaturated with a visual "cracked" or "frosted" treatment
- Fragment tiles show: chapter color, layer type icon, emotional label
- Non-interactive (observational only, 10-15 second display)

2. Create components/finale/ConvergenceMeter.tsx
- The most important UI element during the consensus game
- Pinned to top of screen, full width
- Animated gauge showing convergence (0 to 1) — NO numbers
- Visible threshold zone (a marked region). Below the line = not enough consensus. Above = success zone.
- When convergence enters the success zone: visual shift (glow, color change, intensification)
- Updates from 'convergence_update' socket events at ~4-5 Hz
- Apply spring/easing animation between received values for smooth, analog feel (like a VU meter bouncing)
- Round timer integrated (subtle countdown, not the primary focus)

3. Create hooks/useConvergence.ts
- Subscribes to 'convergence_update' socket events
- Applies spring interpolation between received values
- Returns { animatedValue: number, isAboveThreshold: boolean, timeRemaining: number }

4. Create components/finale/ConsensusBoard.tsx
- Shows ONLY available (winning) fragments, organized by role row
- Each role row: layer icon + color on left, then 1-3 tappable fragment tiles
- Fragment tiles: chapter color background, emotional label text, personal history dot if user voted for this during song-building
- Tap to vote, tap different tile to change vote. User must always have a vote placed.
- Currently-voted tile has bright highlight border
- When a role locks: row compresses to a small glowing badge at top of screen, showing the role icon and winning fragment's chapter color
- Remaining unlocked rows spread to fill freed space
- Round failure: grid briefly shakes, vote highlights clear
- Round success: winning tile bursts with color, role row animates compression

5. Create components/finale/NpcDisplay.tsx
- Terminal/monospace typeface
- Appears below convergence meter when message active
- Typewriter animation for text entry
- Auto-fades after configurable display duration (e.g., 5 seconds)
- Subscribes to 'npc_message' socket events

PART B — Projector Components:

6. Update projector finale views:
- Elegy: richer version of ElegyGrid (larger, more dramatic, suitable for projection)
- Consensus: abstract convergence visualization (particles clustering, color coalescing) + NPC text. Celebration animation when fragment locks in.
- Performer mix: MixingMirror component (see below)

PART C — Controller Components:

7. Create components/controller/ConsensusControls.tsx
- Start/stop consensus rounds button
- Current convergence value displayed (numeric, controller-only)
- Which fragment is currently leading + by how much (controller-only data, never shown to audience)
- Round number, consecutive failures count
- Threshold adjustment slider
- Force-lock fragment button (emergency override)

8. Create components/controller/NpcControls.tsx
- Pre-written NPC line bank organized by category (encouragement, exasperation, urgency, celebration)
- Tap any line to send it immediately
- Free-text input for improvised lines
- Toggle for auto-triggers on/off

9. Create components/finale/MixingSurface.tsx (controller only)
- 7 rows × 6 columns grid (7 layer types × 3 songs × 2 options)
- Each cell is a fragment tile with chapter color + option indicator (A/B)
- Tap to queue activation at next loop boundary
- Active fragment in each row has bright highlight
- Pending (queued) fragment has pulsing border
- Tap active fragment to queue mute
- Tap pending fragment to cancel
- Row labels with layer type icon + color

10. Create components/finale/LoopIndicator.tsx
- Progress bar showing position in current 8-bar loop
- Shows time until next loop boundary
- Used by MixingSurface and MixingMirror

11. Create components/finale/MixingMirror.tsx (projector)
- Simplified, beautified version of MixingSurface
- 7 rows showing active fragment (chapter color) per layer
- Pending changes pulse
- Loop position indicator
- No tap interaction

PART D — Delete old finale components:
- FragmentSelector.tsx
- TriangleSteering.tsx
- StewardSlider.tsx
- SlotCard.tsx
- SlotGrid.tsx
- hooks/useTriangle.ts

PART E — Wire up page routes:
- app/audience/page.tsx: add finale views (elegy → consensus board → TBD for performer mix)
- app/projector/page.tsx: add finale views for all three sub-phases
- app/controller/page.tsx: add consensus controls, NPC controls, mixing surface
```

---

## Prompt 7: Update Configuration & Cleanup

```
Read ARCHITECTURE-V2.md, specifically the Show Config, Environment Variables, and Folder Structure sections. Also read MIGRATION.md Phases 8 and 10.

Your task is to update all configuration files and perform final cleanup.

Step 1: Update config/default-show.json:
- Update all attempt configs to use new layer types: melody, drums, pad, bass, harmony, fx1, fx2
- Add staggered layer ordering per song (see ARCHITECTURE-V2.md "Staggered Layer Ordering" table):
  Song 1: bass, drums, pad, melody, harmony, fx1, fx2
  Song 2: melody, harmony, bass, drums, pad, fx1, fx2
  Song 3: pad, fx1, drums, bass, melody, harmony, fx2
- Add drainFactor per attempt (default 0.5 for all; can tune later)
- Add layerMultipliers per attempt (default [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0])
- Remove all doubtThreshold values
- Replace FinaleConfig with new consensus game + performer mix parameters:
  consensusRoundDurationMs: 15000
  firstRoundDurationMs: 20000
  initialThreshold: 0.4
  thresholdDecayPerFailure: 0.05
  minThreshold: 0.25
  interRoundDelayMs: 3000
  successCelebrationMs: 6000
- Remove all rotation, stewardship, triangle, and chapter assignment config

Step 2: Update config/ableton-layout.json:
- Track index formula: songIndex * 14 + layerIndex * 2 + optionOffset
- 42 tracks total (0-41) for fragments
- Document which track indices map to which song/layer/option
- Add rejection effect return track index
- Add live performance track indices (42+)

Step 3: Create config/npc-triggers.json with auto-trigger definitions:
- { condition: "consecutive_failures", threshold: 2, message: "scattered... try again" }
- { condition: "consecutive_failures", threshold: 4, message: "we're falling apart... just like before" }
- { condition: "same_song_streak", threshold: 3, message: "again? we KNOW that one works. what about the rest?" }
- { condition: "near_miss", convergenceGap: 0.05, message: "so close... you're almost there" }
- { condition: "first_success", message: "yes! keep going!" }
- { condition: "final_fragment", message: "one more. make it count." }
- { condition: "single_option_role", message: "only one path forward here" }

Step 4: Update db/schema.sql:
- Remove finale_chapter column from users table
- Remove fragment_selections table
- Add consensus_rounds table per ARCHITECTURE-V2.md

Step 5: Update lib/identity.ts:
- Update layer type mappings for new types (melody, drums, pad, bass, harmony, fx1, fx2)
- Update colors and symbols per Visual Identity System (use reasonable placeholders)

Step 6: Final cleanup — search the entire codebase for references to removed concepts:
- grep for: stewardship, steward, triangle, centroid, rotation, doubtThreshold, finaleChapter, SafeParameter, QueueEntry, ActiveSlot, TrianglePosition, StewardshipEntry, FragmentSelection, select_fragment, triangle_update, steward_param, FORCE_CONTINUE, SET_THRESHOLD, TOGGLE_DOUBT
- Remove or refactor any remaining references
- NOTE: 'collapsed', 'FORCE_COLLAPSE', 'ATTEMPT_COLLAPSED', 'unreached' are VALID terms in V2 — do NOT remove these

Step 7: Rename ARCHITECTURE-V2.md to ARCHITECTURE.md (it is now the canonical spec)

Step 8: Add CHANGELOG.md entry documenting the V2 migration (see MIGRATION.md Phase 10 for template)

Step 9: Update CLAUDE.md with new context about the V2 architecture for future AI agents working on the codebase
```

---

## Prompt 8: Integration Testing

```
Read ARCHITECTURE-V2.md for the complete system specification. Read MIGRATION.md Phase 9 for testing requirements.

Your task is to write and run integration tests for the complete show flow.

Test Suite 1: Complete Show Flow (No Ableton)
Write a test that simulates the entire show from lobby to ended:
1. Create a show, connect 10 simulated users
2. Advance through lobby → opener → attempt_story
3. For each of 3 attempts:
   a. Transition to attempt_build
   b. For each layer: open voting, submit votes from all users (varying splits), close voting
   c. Verify health bar drains correctly with layer multiplier after each vote
   d. If health bar reaches 0: verify collapse triggers, unreached layers marked, auto-advance
   e. If all layers complete: verify transition to attempt_resolve, trigger rejection, advance
4. Transition through finale_elegy → finale_consensus
5. Simulate 5-7 consensus rounds:
   - Submit votes from all users
   - Verify convergence calculation
   - Verify round resolution (success/failure)
   - Verify role locking on success
   - Verify threshold adjustment on failure
6. Transition to finale_performer_mix
7. Queue several fragment changes, verify they don't apply until FIRE_PENDING_CHANGES
8. Fire pending changes, verify activeLayers updates
9. End show

Test Suite 2: Blind Vote Mechanics
- Verify that during voting phase, state_sync to audience clients does NOT include vote distribution
- Verify that after CLOSE_VOTING, the VoteResult event includes full distribution
- Verify that vote is final (submitting a second vote for same layer is rejected or ignored)

Test Suite 3: Consensus Game Edge Cases
- All users vote for same fragment → convergence = 1.0 → instant success
- Votes perfectly split across 3 fragments → convergence ~= 0.33 → failure
- Users changing votes during round updates convergence correctly
- Threshold softening: 3 failures → threshold drops from 0.4 to 0.25
- Last remaining role with single fragment → trivially converges
- Client disconnect during round → removed from vote count, convergence recalculated

Test Suite 4: Performer Mix Edge Cases
- Queue change then cancel → nothing fires at boundary
- Queue changes for 5 layers, fire → all 5 apply simultaneously
- Queue a mute (null fragmentId) → layer deactivates at boundary
- Queue a fragment for a layer that already has an active fragment → swap (old muted, new unmuted)
- Load snapshot → replaces all pending with snapshot values

Test Suite 5: Fragment Generation
- After 3 completed attempts: verify exactly 21 available fragments and 21 locked fragments
- After attempts with collapses (e.g., at layers 4, 5, 6): verify correct available/locked counts
- Verify each available fragment is the winning option from a reached layer
- Verify unreached layers produce locked fragments (both A and B options locked)
- Verify fragment IDs are unique and track references are correct
- Verify staggered ordering means all 7 layer types have at least one available fragment if each song reaches 3+ layers

Test Suite 6: Health Bar with Layer Multipliers
- Simulate a full 7-layer attempt with default multipliers [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0]
- Verify early layers drain less than late layers for the same vote split
- Verify a room averaging 70/30 splits collapses around layer 5-6
- Verify a room averaging 80/20 splits can survive all 7 layers
- Verify a room averaging 55/45 splits collapses around layer 3-4
- Verify custom multipliers are respected when configured per-attempt
- Verify FORCE_COLLAPSE works at any health bar level
```

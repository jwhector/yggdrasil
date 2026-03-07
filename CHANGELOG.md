# CHANGELOG

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

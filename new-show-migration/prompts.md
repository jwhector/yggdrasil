# PROMPTS.md — Claude Code Prompt Templates

## How to Use
Copy-paste the relevant prompt into Claude Code for each migration phase. Each prompt is designed to:
1. Orient the agent to the current task
2. Point it to the right reference files
3. Set clear boundaries (what to touch, what to leave alone)
4. Define a completion check

Run **one phase per session**. If a phase is too large for one session, the sub-steps (0a, 0b, etc.) can be run individually.

---

## Session Start Prompt (use at the beginning of EVERY session)

```
Read CLAUDE.md, then check MIGRATION.md to see which phase is current. Tell me which phase you think we're on and what's left to do in it before you start any work.
```

---

## Phase 0: Types & Schema

```
We're starting Phase 0 of the migration: replacing the old type system and database schema.

Read ARCHITECTURE.md sections "Data Models", "Conductor Commands", "Conductor Events", and "Persistence Layer" carefully. Then:

1. Read the current conductor/types.ts. List every type that references old concepts (factions, coherence, coups, personal trees, fig tree, 4-option voting).
2. Create a new conductor/types.ts with ALL types from ARCHITECTURE.md. Make it self-contained (no imports from other project files). Include: User, Chapter, LayerType, LayerPhase, LayerConfig, LayerResult, LayerVote, AttemptState, AttemptConfig, Fragment, SafeParameter, FinaleState, ActiveSlot, QueueEntry, TrianglePosition, StewardshipEntry, ShowState, ShowPhase, ShowConfig, TimingConfig, FinaleConfig, ConductorCommand (full union), ConductorEvent (full union), VoteResult. For AudioReference and AbletonParamRef, define placeholder types we can flesh out later.
3. Update db/schema.sql to match ARCHITECTURE.md.
4. Verify the types file compiles: npx tsc --noEmit conductor/types.ts
5. Update CHANGELOG.md and mark Phase 0 tasks complete in MIGRATION.md.

Do NOT touch any other files yet. The rest of the codebase will have type errors — that's expected.
```

---

## Phase 1: Conductor Core

```
We're on Phase 1: rewriting the Conductor state machine for show phases and song-building.

Read ARCHITECTURE.md sections "Show Phase State Machine", "Song-Building Phase", and "Conductor". The new conductor/types.ts from Phase 0 defines all the types you'll use.

Your job:
1. Gut conductor/conductor.ts — keep the structural pattern (processCommand → validate → mutate → emit events) but remove ALL old game logic (factions, coherence, coups, 4-option voting). If it helps, you can start from scratch and reference the old file only for the pattern.
2. Implement show phase transitions: lobby → opener → attempt_story → attempt_build (×3) → finale_setup → finale_rotating → finale_frozen → ended. ADVANCE_PHASE walks the sequence. Track currentAttemptIndex.
3. Create conductor/consensus.ts with calculateConsensus(votes) and threshold checking.
4. Implement the song-building layer flow: locked → auditioning → voting → resolving → locked_in (or collapsed). Wire up SUBMIT_VOTE, OPEN_VOTING, CLOSE_VOTING, FORCE_OPTION, FORCE_CONTINUE, FORCE_COLLAPSE, RERUN_VOTE.
5. Implement collapse: when consensus < doubtThreshold, mark attempt collapsed, record collapsedAtLayer. Auto-advance to next attempt_story EXCEPT for attempt index 2 (Song 3 → finale is manual).
6. Create conductor/fragments.ts: generateFragments() that produces the correct fragment availability from attempt results (winners = selectable, losers + unreached = locked/grayed).
7. Write comprehensive tests in conductor/__tests__/. Test names should be specifications (complete sentences describing behavior).
8. Verify: npx tsc --noEmit passes for conductor/. All tests pass.
9. Update CHANGELOG.md and MIGRATION.md.

Do NOT touch server/, app/, or components/ yet. Conductor is pure logic with no I/O.
```

---

## Phase 2: Finale Logic

```
We're on Phase 2: implementing the finale logic in the Conductor.

Read ARCHITECTURE.md section "Finale System" carefully. The conductor already handles show phases and song-building from Phase 1.

Your job:
1. Create conductor/finale.ts with:
   - assignChapters(users): random even split (±1) across 3 chapters
   - selectFragment(userId, fragmentId, state): validate it's from user's assigned chapter and is a selectable (winning) option, add to queue
   - scheduleRotation(queue, centroid, stewardshipLog, slotsToRotate): fairness-first scheduling (users who haven't stewarded go first), then chapter weighting by centroid, then diversity nudge
   - computeCentroid(positions): average of all triangle positions
   - Stewardship start/end lifecycle
   - updateStewardParam: validate user is active steward, clamp value to fragment's safe parameter range

2. Wire all finale commands in conductor.ts: SETUP_FINALE, SELECT_FRAGMENT, UPDATE_TRIANGLE, UPDATE_STEWARD_PARAM, START_ROTATION, STOP_ROTATION, FREEZE_ROTATION, SET_ROTATION_RATE, FORCE_ASSIGN_STEWARD, FORCE_INSERT_FRAGMENT, CLEAR_QUEUE, TOGGLE_TRIANGLE.

3. Write tests covering: even chapter assignment, fragment selection validation, fairness scheduling, rotation slot count, stewardship lifecycle, centroid math, parameter clamping.

4. Verify the full conductor can now handle a complete show: lobby → 3 attempts (with collapses) → finale setup → rotation → freeze → end.

5. Update CHANGELOG.md and MIGRATION.md.

Still no server/client work — conductor only.
```

---

## Phase 3: Server Layer

```
We're on Phase 3: rewiring the server to use the new Conductor.

Read ARCHITECTURE.md sections "WebSocket Protocol", "Persistence Layer", and "Recovery & Robustness". The conductor is complete from Phases 1-2.

Your job:
1. Update server/persistence.ts: new schema from Phase 0, serialization for new ShowState (Maps/Sets → arrays), same persist-on-every-change pattern.

2. Update server/socket.ts:
   - REMOVE old events: fig_tree_response, faction-specific rooms (faction:0, etc.), coup_vote
   - KEEP the join/reconnect/identity flow and the state_sync broadcast pattern
   - ADD new events: vote, select_fragment, triangle_update, steward_param, command
   - Each event maps to a ConductorCommand → conductor.processCommand() → broadcast filtered state_sync
   - State filtering: controller gets full state, projector gets public state (no user details), audience gets personalized state (their chapter, votes, stewardship status)

3. Add HIGH-FREQUENCY channels (these do NOT go through state_sync):
   - Triangle: receive triangle_update from audience, compute centroid, broadcast centroid to projector at ~3-4 Hz via dedicated 'centroid' event
   - Metering: create server/metering.ts — will receive OSC data later, for now stub it and broadcast mock data

4. Update server/recovery.ts for new state shape (same patterns).

5. Verify: server starts, accepts Socket.IO connections, processes commands through conductor, persists to SQLite, recovers from restart.

6. Update CHANGELOG.md and MIGRATION.md.

Preserve the existing infrastructure patterns (heartbeat, exponential backoff, version checking). Adapt to new data shapes.
```

---

## Phase 4: OSC & Audio

```
We're on Phase 4: updating the Ableton integration.

Read ARCHITECTURE.md sections "Audio Engine & Ableton Integration" and "OSC Protocol".

Your job:
1. Update server/audio-router.ts with the new track index formula:
   trackIndex = attemptIndex * (maxLayersPerAttempt * 2) + layerIndex * 2 + optionOffset
   Map AUDIO_CUE events: audition (unmute/mute options), lock-in (keep winner unmuted), collapse (enable return track effects → mute all), finale slot activate/deactivate, stewardship parameter updates.

2. Create server/metering.ts: listen for /meter/slot/<N> OSC messages, aggregate energy levels, broadcast to projector at ~10 Hz via dedicated socket event.

3. Update server/osc.ts if needed (add new OSC addresses for device parameter control and return track muting). The base bidirectional bridge should be reusable.

4. Update server/timing.ts: quantized timing for audition, voting window, resolve animation, collapse animation. Keep the version-check safety pattern.

5. Create config/ableton-layout.json with the track mapping configuration (attemptIndex, maxLayersPerAttempt, return track index for collapse).

6. Update the mock Ableton tool (server/tools/osc-mock-ableton.ts) to respond to new messages.

7. Update CHANGELOG.md and MIGRATION.md.
```

---

## Phase 5: Song-Building UI

```
We're on Phase 5: building the audience and projector UIs for song-building.

Read ARCHITECTURE.md sections for /audience and /projector client routes, plus the "Visual Identity System" section. Check DECISIONS.md for open questions about colors/symbols — use placeholders marked with TODO.

Your job:
1. Create lib/identity.ts with chapter and layer color/symbol mappings. Use placeholder values from ARCHITECTURE.md, mark with // TODO: See DECISIONS.md O3.

2. Build components/song-building/:
   - LayerGrid.tsx: grid of all layers for current attempt as squares. States: locked (future/unexplored), active (A and B both selectable), locked_in (winner prominent, loser dimmed/grayed), collapsed.
   - OptionCard.tsx: A/B option with layer color+symbol. Solid (A) vs outlined (B). Tappable.
   - ConsensusBar.tsx: shows leading option and margin.
   - DoubtMeter.tsx: rising gauge with threshold line.

3. Update app/audience/page.tsx:
   - Route by show phase: dark/minimal during story phases, LayerGrid during build phases, (finale UI comes in Phase 6)
   - Wire to useShowState hook for reactive state

4. Update app/projector/page.tsx for song-building:
   - Chapter title + accent color, current layer card with A vs B, stack history icons, consensus bar, doubt meter, collapse animation placeholder

5. Create/update hooks/useShowState.ts:
   - Receives state_sync, provides typed state
   - Derives: current attempt, current layer, user's votes, phase routing

6. Update CHANGELOG.md and MIGRATION.md.

Focus on functionality first, visual polish later. Use Tailwind for styling.
```

---

## Phase 6: Finale UI

```
We're on Phase 6: building the finale UIs.

Read ARCHITECTURE.md "Finale System" section and the /audience and /projector route descriptions for finale phase behavior.

Your job:
1. FragmentSelector.tsx: grid of layers for user's assigned chapter. Winners = selectable (tappable), losers + unreached = visible but locked/grayed. User picks exactly one. Show chapter color throughout.

2. TriangleSteering.tsx: equilateral triangle with Ambition/Love/Avoidance at corners. Draggable dot inside triangle, computes barycentric weights (wA + wL + wV = 1). Touch-friendly for phones.

3. hooks/useTriangle.ts: touch/pointer event → barycentric coordinates. Throttle sends to ~250ms. For projector: interpolate received centroid positions for smooth animation.

4. StewardSlider.tsx: single continuous vertical or horizontal slider. Label from fragment's safeParameter.displayLabel. Sends value to server on change. Only visible during active stewardship.

5. SlotGrid.tsx + SlotCard.tsx (projector): 7 slot cards. Each shows chapter color, fragment name, steward indicator. Energy glow driven by metering data (receive via dedicated 'meter' socket event, not state_sync).

6. Wire audience page: after fragment selection, show triangle steering. When stewarding, show slider instead of triangle. Wire projector page: show slot grid + collective centroid dot.

7. The auto-recenter drift nudge (triangle drifts to center when idle) and underrepresented chapter glow are nice-to-haves — implement if time allows, otherwise add TODO.

8. Update CHANGELOG.md and MIGRATION.md.
```

---

## Phase 7: Controller UI

```
We're on Phase 7: building the operator console.

Read ARCHITECTURE.md "/controller" section for the full control list and metrics requirements.

Your job:
1. Build controller components:
   - ShowControls.tsx: Start/Stop Show, Advance Phase, Jump to Phase dropdown. Show current phase prominently.
   - VotingControls.tsx: Open Vote, Close Vote, Force A, Force B, Extend Timer (+5s/+10s), Rerun Vote. Only active during attempt_build.
   - DoubtControls.tsx: Threshold slider/presets, Toggle Doubt on/off, Force Continue, Force Collapse. Only active during attempt_build.
   - FinaleControls.tsx: Start/Stop Rotation, Freeze, Rate (1/2), Clear Queue, Force Steward, Force Fragment, Toggle Triangle. Only active during finale phases.
   - MetricsPanel.tsx: Connected count, vote counts + consensus %, queue status, stewardship progress ("X of Y have stewarded"), WebSocket status, OSC status.

2. Wire to app/controller/page.tsx. Add basic auth (route check + passcode — can be simple for now).

3. Design for speed during live performance: big buttons, no deep menus, clear state indicators. All override buttons should be obviously dangerous (red/warning styled).

4. Test: every button sends the correct command and the conductor processes it. Metrics update in real time.

5. Update CHANGELOG.md and MIGRATION.md.
```

---

## Phase 8: Cleanup

```
We're on Phase 8: final cleanup.

1. Search the ENTIRE codebase (grep -r) for these old keywords and remove any remaining references:
   faction, FactionId, coherence, coup, coupMeter, coupMultiplier, figTree, songTree, personalTree, personalVote, factionVote, dualPath, popularPath, factionPath, SeatTopologyProvider, AdjacencyGraph, FactionAssigner, RevealPayload, TiebreakerAnimation, FactionReveal

2. Delete any old component files that have no new equivalent.

3. Delete old conductor files (coherence.ts, coup.ts, assignment.ts) if they still exist.

4. Run the full test suite. Fix any failures.

5. Run npx tsc --noEmit. Fix any type errors.

6. Do a manual smoke test: describe the steps you'd take to verify the full show flow works (lobby → opener → 3 song attempts with voting → finale with fragment selection → rotation → stewardship → freeze → end).

7. Remove the "⚠️ MIGRATION IN PROGRESS" section from CLAUDE.md. Remove references to MIGRATION.md. Update CLAUDE.md to be the steady-state agent context for ongoing development.

8. Delete MIGRATION.md.

9. Write a final CHANGELOG.md entry summarizing the completed migration.
```

---

## Utility Prompts (use anytime)

### When you're confused about old vs new code
```
I think you might be looking at old code. Check ARCHITECTURE.md for the current spec of [specific feature]. The old system used [factions/coherence/coups/etc] which have been removed. If the code you're looking at references any of those concepts, it needs to be replaced, not adapted.
```

### When the agent tries to preserve something it shouldn't
```
Stop. That code is from the old show design. Check CLAUDE.md "How to tell old from new" section. If it references [specific old keyword], it should be deleted or replaced, not preserved. Write the new version from scratch using ARCHITECTURE.md as the spec.
```

### When the agent needs to check fragment availability rules
```
Read ARCHITECTURE.md "Song Stack & Fragment Generation" and DECISIONS.md R5. The rules are:
- Locked-in winners = selectable in finale
- Locked-in losers = visible but locked/grayed in finale
- Both options from unreached layers = visible but locked/grayed in finale
Make sure your implementation matches all three cases.
```

### When something touches an open decision
```
That touches an open design decision (DECISIONS.md O[N]). Don't hardcode a choice — implement it as a configurable value with a reasonable default and add a // TODO: See DECISIONS.md O[N] comment.
```

### Quick context recovery (if agent seems lost)
```
Let's reset context. Read these files in order: CLAUDE.md, then MIGRATION.md (check current phase), then the relevant section of ARCHITECTURE.md for what we're working on. Tell me what you think the current task is before proceeding.
```
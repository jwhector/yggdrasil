# V3.4 Migration — Reusable Phase Prompt

Copy the **Base Context** block, then append the **Phase Block** for the phase you're implementing. Paste the combined text as your prompt.

---

## Base Context (always include)

```
You are implementing a phased migration for Yggdrasil, an interactive live performance system. Start by reading these files in order:

1. CLAUDE.md (project rules, structure, conventions)
2. ARCHITECTURE.md (system overview, phase state machine)
3. v34-MIGRATION-SPEC.md (the full V3.4 "Token Pool" spec)
4. V34-MIGRATION-PLAN.md (the phased plan — read the phase you're implementing)
5. conductor/types.ts (current type definitions)
6. docs/data-models.md (existing type patterns and conductor API)

Key rules:
- Follow the conventions in CLAUDE.md. Priority chain: ARCHITECTURE.md + docs/ > code.
- Conductor is pure — no I/O, no Socket.IO, no database calls in conductor/.
- Types first — define types before implementing logic.
- Write behavior-named tests for new conductor modules (e.g., "queuing a token consumes from pool and adds to queue").
- Do NOT modify song-building code. This migration only affects the finale system and chapter identity.
- Do NOT invent answers to open questions listed in V34-MIGRATION-PLAN.md or v34-MIGRATION-SPEC.md.
- Run `npx tsc --noEmit` and `npm test` after implementation to confirm everything passes.
- Update CHANGELOG.md at the end with a summary of what changed.

Prior phase status:
- Phase 1 (Chapter Identity): COMPLETE. Chapter type is now `string`. Config IDs remain 'ambition'/'love'/'avoidance'. All hardcoded chapter arrays in conductor code replaced with config lookups.
```

---

## Phase Blocks

### Phase 2: V3.4 Types & Interfaces

**Model: Sonnet** — Mechanical type additions, no logic. Follow the shapes in V34-MIGRATION-PLAN.md Phase 2 exactly.

```
Implement Phase 2 of V34-MIGRATION-PLAN.md: "V3.4 Finale Types & Interfaces."

This is types-only — no behavioral changes, no new modules, no wiring.

Scope:
- conductor/types.ts: Add V34FinaleState, Token, QueuedToken, ActiveNode, V34FinaleConfig, VotePhaseConfig, QuestionConfig, RemixConfig.
- conductor/types.ts: Add new ShowPhase values ('finale_vote', 'finale_remix') to the union. Keep V3.3 phases temporarily — mark with // V3.3 — remove in Phase 8.
- conductor/types.ts: Add new ConductorCommand variants (START_VOTE, SUBMIT_EMOTION, REQUEST_NEXT_QUESTION, POOL_CAP_REACHED, START_REMIX, QUEUE_TOKEN, CANCEL_QUEUE, TOGGLE_AUDIENCE_INTERACTION, LOOP_BOUNDARY, END_SHOW).
- conductor/types.ts: Add new ConductorEvent variants (VOTE_STARTED, EMOTION_RECEIVED, NEXT_QUESTION, POOL_CAP_REACHED, POOL_READY, REMIX_STARTED, TOKEN_QUEUED, TOKEN_CANCELLED, TOKEN_ACTIVATED, TOKEN_SPENT, NODE_SILENT, POOL_EMPTY).
- conductor/types.ts: Add new AudioCue variants for remix (remix_start, node_unmute, node_crossfade, node_instant_crossfade, node_fade_out).
- conductor/types.ts: Add client view types (AudienceVoteView, AudienceRemixView, ProjectorFinaleV34View) for state filtering in later phases.

Reference V34-MIGRATION-PLAN.md Phase 2 for exact type shapes. Reference docs/data-models.md for the pattern of how existing types are structured.

Validation: `npx tsc --noEmit` passes. `npm test` passes (no runtime changes).
```

---

### Phase 3: Conductor Modules (Pure Logic)

**Model: Opus** — Core game logic with nuanced state transitions (queue/spend cycle, audience interaction mode, loop boundary processing). Needs careful design and thorough test coverage.

```
Implement Phase 3 of V34-MIGRATION-PLAN.md: "Conductor Modules (Pure Logic)."

Create three new pure conductor modules + wire them into conductor.ts. All modules are pure functions — no I/O.

Files to create:
1. conductor/token-pool.ts — Pool management (createTokenPool, consumeToken, returnToken, isPoolEmpty)
2. conductor/question-engine.ts — Vote phase logic (getNextQuestion, calculateMaxQuestionsPerPerson, shouldCapPool, processEmotion)
3. conductor/remix-engine.ts — Queue & spend logic (queueToken, cancelQueue, processLoopBoundary, toggleAudienceInteraction, resolveTrack)
4. conductor/__tests__/token-pool.test.ts
5. conductor/__tests__/question-engine.test.ts
6. conductor/__tests__/remix-engine.test.ts

Files to modify:
- conductor/conductor.ts: Add command handlers for all V3.4 finale commands. Add finale_vote and finale_remix to phase transitions. SETUP_FINALE initializes V34FinaleState. Wire LOOP_BOUNDARY to processLoopBoundary().
- conductor/index.ts: Export new modules.
- conductor/__tests__/conductor.test.ts: Add integration tests for V3.4 phase transitions and command handling.

Key behaviors to implement correctly:
- Token lifecycle: available -> queued -> playing -> spent
- Loop boundary: activates queued tokens, spends playing tokens, crossfades when replacement queued
- Audience interaction mode: instant crossfade (no loop boundary wait), persistent looping (tokens don't spend after one loop), one pool token per activation regardless of loop count
- Disabling audience interaction: persistent tokens finish current loop, then standard behavior resumes
- Pool cap: hard ceiling on total tokens, grace period for in-flight answers
- Question pacing: async per-user, configurable delay, maxQuestionsPerPerson derived from pool cap / audience size

Reference V34-MIGRATION-PLAN.md Phase 3 for exact function signatures and test names. Reference conductor/quilt.ts and conductor/quilt-arc.ts for examples of how existing conductor modules are structured (pure functions, returning events).

Validation: `npx tsc --noEmit` passes. `npm test` passes with all new tests green.
```

---

### Phase 4: Server & Socket Layer

**Model: Sonnet** — Pattern-following: wire socket events to conductor commands, update state filtering. Follow existing patterns in server/socket.ts.

```
Implement Phase 4 of V34-MIGRATION-PLAN.md: "Server & Socket Layer."

Wire V3.4 conductor commands to WebSocket events. Update state filtering for new client views.

Files to modify:
- server/socket.ts: Add handlers for submit_emotion (audience -> SUBMIT_EMOTION), and new controller commands (START_VOTE, START_REMIX, QUEUE_TOKEN, CANCEL_QUEUE, TOGGLE_AUDIENCE_INTERACTION, END_SHOW). Add server->client events: question, emotion_confirmed, phones_down, pool_state, node_update.
- server/socket.ts (filterStateForClient): Add finale_vote and finale_remix branches for audience, projector, and controller views. Use the V3.4 client view types from Phase 2.
- server/timing.ts: Fire LOOP_BOUNDARY command on Ableton loop boundaries during finale_remix (same mechanism as existing quilt column advance).

Key patterns to follow (from existing code in server/socket.ts):
- Audience events are mapped to ConductorCommands with userId injected from socket identity
- High-frequency data (pool_state at ~2 Hz, node_update on change) bypasses state_sync — uses dedicated socket events
- State filtering personalizes audience view (own question, own answer count) vs projector (pool visualization) vs controller (full state)

Reference docs/server-protocol.md for existing WebSocket event patterns. Reference V34-MIGRATION-PLAN.md Phase 4 for event specifications.

Validation: `npx tsc --noEmit` passes. `npm test` passes. Manual smoke test with `npm run dev` confirms state_sync works for new phases.
```

---

### Phase 5: Persistence & Schema

**Model: Sonnet** — Small, mechanical. Two new tables, two new functions, deprecation comments.

```
Implement Phase 5 of V34-MIGRATION-PLAN.md: "Persistence & Schema."

Add V3.4 database tables and persistence functions. Deprecate V3.3 quilt tables.

Files to modify:
- db/schema.sql: Add finale_votes and finale_token_events tables with indexes. Mark finale_quilt_cells and finale_remix_events as [DEPRECATED V3.3].
- server/persistence.ts: Add saveFinaleVote() and saveTokenEvent() functions. Call these from the event handlers added in Phase 4.
- server/__tests__/persistence.test.ts: Add tests for new persistence functions.

Reference V34-MIGRATION-PLAN.md Phase 5 for exact SQL schemas. Follow the pattern of existing persistence functions in server/persistence.ts.

Validation: `npx tsc --noEmit` passes. `npm test` passes with new persistence tests green.
```

---

### Phase 6: Client Components & Hooks

**Model: Opus** — Most complex UI phase. Canvas rendering, touch interaction, drag-and-drop, screen wake lock, multiple coordinated components. Needs careful architecture.

```
Implement Phase 6 of V34-MIGRATION-PLAN.md: "Client Components & Hooks."

Build the V3.4 UI: audience vote cards, projector token pool canvas, pentagon remix display, controller fallback grid.

Files to create:
- hooks/useTokenPool.ts — subscribe to pool_state socket event
- hooks/useRemixQueue.ts — controller queue management (QUEUE_TOKEN, CANCEL_QUEUE commands + optimistic local state)
- hooks/useDragToken.ts — iPad touch drag: touchstart/touchmove/touchend, position tracking, drop target detection, CSS touch-action: none
- components/finale/EmotionVote.tsx — audience: question text + 3 chapter cards + "phones down" state
- components/finale/TokenPool.tsx — projector canvas: floating colored dots with requestAnimationFrame, bloom on creation, absorb into pentagon on spend
- components/finale/PentagonRemix.tsx — projector: 6 pentagon nodes, drop targets, active chapter color, loop progress ring, queue depth
- components/finale/ProjectorFinale.tsx — projector: composes TokenPool + PentagonRemix, touch interaction layer (finale_remix + touch device only), screen wake lock (navigator.wakeLock)
- components/finale/RemixController.tsx — controller: 6x3 button grid (granular types x chapters), pool counters, queue badges, audience interaction toggle

Files to modify:
- app/audience/page.tsx: Add finale_vote -> EmotionVote, finale_remix -> phones down display
- app/projector/page.tsx: Add finale_vote + finale_remix -> ProjectorFinale
- app/controller/page.tsx: Add finale_vote + finale_remix -> RemixController + phase controls
- components/controller/ShowControls.tsx: Add "Start Vote", "Start Remix", "End Show" phase buttons for V3.4 phases

Key implementation details:
- Token dots: canvas 2D with requestAnimationFrame. Gentle drift physics. Each dot = one token, colored by chapter. Generous touch targets (~44pt). Magnetic snap on pentagon node drop zones.
- Touch: use touchstart/touchmove/touchend (NOT HTML5 drag API — doesn't work on mobile Safari). Drag is entirely client-side animation. On drop, send QUEUE_TOKEN to server, optimistic UI with rollback on rejection.
- Screen wake lock: navigator.wakeLock.request('screen') with hidden video element fallback for older Safari.
- Pentagon layout: mirror the existing song-building projector pentagon (see components/projector/renderers/skeleton.ts for layout).

Reference v34-MIGRATION-SPEC.md sections "Hardware & Display Architecture", "Touch Interaction Model", "Projector Display: Pentagon + Pool" for detailed requirements. Reference docs/client-routes.md for existing component patterns.

Validation: `npx tsc --noEmit` passes. Manual testing with `npm run dev` — verify vote flow on phone, projector display, controller buttons.
```

---

### Phase 7: Audio Router & OSC

**Model: Sonnet** — Pattern-following from existing audio cue handlers. Map new cue types to OSC messages using the same gain-based control system.

```
Implement Phase 7 of V34-MIGRATION-PLAN.md: "Audio Router & OSC."

Map V3.4 remix audio cues to OSC commands.

Files to modify:
- server/audio-router.ts: Add handlers for remix_start, node_unmute, node_crossfade, node_instant_crossfade, node_fade_out. Follow the existing pattern of quilt audio cue handlers.
- server/__tests__/audio-router.test.ts: Add tests for new cue types.

Key behaviors:
- remix_start: transport stop + play (reset to beat 0), per spec "reset transport to beat 0 on finale"
- node_unmute: gain swell using fadeGain() with entrySwellBeats
- node_crossfade: simultaneous fade-out (muteTrack) + fade-in (unmuteTrack) over crossfadeBeats
- node_instant_crossfade: same as crossfade but fires immediately (audience interaction mode), no loop boundary quantization
- node_fade_out: fade track to silence over crossfadeBeats

Reference docs/audio-engine.md for existing OSC protocol and gain control. Reference server/audio-router.ts existing quilt_column_change handler for crossfade pattern.

Validation: `npx tsc --noEmit` passes. `npm test` passes with new audio router tests green.
```

---

### Phase 8: Cleanup & Documentation

**Model: Sonnet** — Mechanical deletion + doc updates. Wide blast radius but straightforward: delete files, remove imports, update docs.

```
Implement Phase 8 of V34-MIGRATION-PLAN.md: "Cleanup & Documentation."

Remove all V3.3 quilt/assignment/preview code. Update documentation to V3.4.

This phase has two parts: code cleanup (8a-8e) and documentation (8f-8h). Do code cleanup first, verify tests pass, then update docs.

Part 1 — Code Cleanup:

Delete files:
- conductor/quilt.ts, conductor/quilt-arc.ts, conductor/assignment.ts
- conductor/__tests__/quilt.test.ts, conductor/__tests__/quilt-arc.test.ts, conductor/__tests__/assignment.test.ts
- components/finale/QuiltGrid.tsx, QuiltPreview.tsx, QuiltRemix.tsx, ElegyGrid.tsx
- components/controller/QuiltRemixControls.tsx
- hooks/useQuilt.ts

Modify files:
- conductor/types.ts: Remove V3.3 phases from ShowPhase ('finale_elegy', 'finale_assignment', 'finale_preview', 'finale_playback'). Remove V33FinaleState, V33FinaleConfig, QuiltConfig, QuiltCell, ArcConfig, ArcState, ArcSchedule, ArcPhase, SortMode, SongEnergyProfile, RowGroupSchedule, AudienceRemixConfig. Remove V3.3-only AudioCue/Command/Event variants. Rename V34FinaleState -> FinaleState, V34FinaleConfig -> FinaleConfig.
- conductor/conductor.ts: Remove quilt/assignment/arc imports and command handlers.
- conductor/index.ts: Remove quilt/assignment/arc exports.
- server/socket.ts: Remove V3.3 socket event handlers (claim_cell, release_cell, set_song, lock_in, move_cell, change_song) and broadcasts (quilt_state, cell_claimed, cell_moved, playhead_update, column_reordered). Remove V3.3 branches from filterStateForClient.
- server/audio-router.ts: Remove V3.3 quilt audio cue handlers.

Keep:
- conductor/fragments.ts (spec: "still needed if elegy is ever re-added")
- components/finale/NpcDisplay.tsx (NPC system unchanged)
- components/finale/LoopIndicator.tsx (reusable for remix)

Run `npx tsc --noEmit` and `npm test` after cleanup. Fix any broken imports or references.

Part 2 — Documentation:

Update these files to reflect V3.4:
- ARCHITECTURE.md: Show phase state machine, phase details, terminology, folder structure. Add Appendix F for V3.3 -> V3.4 changes.
- docs/finale.md: Complete rewrite to V3.4 (token pool, vote phase, remix phase, audience interaction mode).
- docs/data-models.md: Update all type definitions, conductor commands, conductor events.
- docs/server-protocol.md: Update WebSocket events and persistence schema.
- docs/client-routes.md: Update finale UI specs.
- docs/audio-engine.md: Update audio cues.
- DECISIONS.md: Add resolved decisions for V3.4.
- CLAUDE.md: Update project structure, common patterns, phase state machine.
- CHANGELOG.md: Add V3.4 migration summary.
- config/default-show.json: Replace finale.quilt config with finale.vote + finale.remix. Add questions array. Remove arc config.

Validation: `npx tsc --noEmit` passes. `npm test` passes (test count will drop from quilt/arc test removal, offset by Phase 3 additions).
```

---

## Model Recommendations Summary

| Phase | Model | Rationale |
|-------|-------|-----------|
| ~~1. Chapter Identity~~ | ~~Opus~~ | ~~Complete~~ |
| 2. V3.4 Types | **Sonnet** | Mechanical type transcription from spec. No logic, no judgment calls. |
| 3. Conductor Modules | **Opus** | Core game logic: token lifecycle, loop boundary state machine, audience interaction mode. Needs to reason about edge cases (race conditions, mode transitions, pool depletion). Thorough test design. |
| 4. Server/Socket | **Sonnet** | Pattern-following from existing socket.ts. Map events to commands, update filter branches. |
| 5. Persistence | **Sonnet** | Two tables, two functions. Smallest phase. |
| 6. Client Components | **Opus** | Canvas rendering, touch interaction, drag-and-drop physics, screen wake lock, multi-component composition. Most complex UI work. |
| 7. Audio Router | **Sonnet** | Pattern-following from existing cue handlers. Crossfade logic already established. |
| 8. Cleanup & Docs | **Sonnet** | Mechanical deletion + doc rewrite. Wide but shallow — find references, delete, fix imports. |

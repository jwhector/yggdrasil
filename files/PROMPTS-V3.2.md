# V3.2 Migration — IDE Agent Prompt Template

## How to use this file

Copy the prompt below into your IDE agent. Replace the `[TASK]` section with the specific work for each phase. The context sections stay the same across all phases.

---

## THE PROMPT

```
## Project Context

This is a Next.js + Node.js + Socket.IO interactive live performance system ("Solo Show") where ~40 audience members build songs in real time via their phones. The backend integrates with Ableton Live via OSC for audio playback.

The codebase has been through V3 → V3.1 migrations. We are now executing the V3.2 migration.

## Architecture References

Before making any changes, read these files for context (load only what's relevant to your task):

| If your task involves... | Read first... |
|---|---|
| Types, conductor, state machine | ARCHITECTURE.md + docs/data-models.md + MIGRATION-V3.2.md |
| Song-building logic | docs/song-building.md + MIGRATION-V3.2.md (Changes 1-2) |
| Finale logic | docs/finale.md + MIGRATION-V3.2.md (Changes 3-5) |
| Audio, OSC, Ableton tracks | docs/audio-engine.md + MIGRATION-V3.2.md (Change 6) |
| UI components | docs/client-routes.md + MIGRATION-V3.2.md |
| WebSocket, persistence | docs/server-protocol.md + MIGRATION-V3.2.md (Changes 5, 7) |
| Config shape | MIGRATION-V3.2.md (Change 8) |

**Priority rule:** When MIGRATION-V3.2.md conflicts with any other doc, the migration doc is correct.

## Key V3.2 Concepts

These are the architectural ideas you need to understand. Do NOT proceed until these are clear:

1. **LayerGroup abstraction**: The audience sees 3 bundled layer groups during song-building (bones, flesh, spark). Each bundle contains multiple Ableton tracks grouped by granular type (bass, drums, melody, etc.). Muting/unmuting a bundle means muting/unmuting all tracks in it simultaneously. The granular types are exposed individually in the finale.

2. **Song-building is 3 layers per song, not 6**: Each "layer" is a bundled group. The audience makes 3 A/B choices per song (9 total across the show). Thresholds: [0.50, 0.66, 0.99].

3. **Live seed**: Each song starts with a prerecorded "performed" loop that plays throughout the song-building phase. It's not audience-controlled. It's a set of Ableton tracks unmuted at attempt_build start, muted on collapse/rejection.

4. **Finale is Incredibox-style**: No assembly, deliberation, ceremony, or altar. Instead: auto-assignment to granular types (groups of ~6-7 people), then continuous live mixing where each person taps between available fragments and the group's majority determines what plays. Crossfades happen at bar boundaries. Recency tiebreak for 50/50 splits.

5. **Fragment decomposition**: Song-building produces layer group results (e.g., "Bones Option A won in Song 1"). The finale decomposes these into granular fragments (e.g., "bass from Bones A Song 1" and "drums from Bones A Song 1" become separate playable fragments for the bass group and drums group respectively).

6. **Track indices are config-driven, not formula-driven**: Each option's tracks are explicitly listed in default-show.json with their Ableton track indices. There is no trackIndex = songIndex * N + layerIndex * 2 + offset formula anymore.

## Current Task

[TASK]

Replace this section with one of the specific task descriptions below, or write your own following the same structure.

## Rules

- Read the relevant architecture docs BEFORE writing any code.
- Run existing tests before and after your changes. Do not break passing tests.
- Write tests for new logic. Name tests descriptively: `test('majority flip triggers crossfade at next bar boundary', ...)`.
- When removing old code, search the entire codebase for references before deleting. Compile and test after each removal.
- When adding new types, add them to conductor/types.ts first, then implement logic that uses them.
- Config changes go in default-show.json. Do not hardcode values that should be configurable.
- Preserve the conductor's purity — it has no I/O. It receives commands, updates state, emits events. Side effects (OSC, WebSocket, persistence) happen in the server layer in response to conductor events.
```

---

## TASK DESCRIPTIONS (copy one into [TASK] above)

### Task: Types & LayerGroup Abstraction

```
Add the LayerGroup abstraction to the type system. This is the foundation for all other V3.2 changes.

Specific changes:
1. In conductor/types.ts, add: LayerGroup, GranularType, GranularTrackRef, TrackBundle, LayerGroupConfig interfaces (see MIGRATION-V3.2.md Change 1)
2. Add GranularFragment and LiveMixVote types (see MIGRATION-V3.2.md Change 4)
3. Update AttemptConfig: layers array now contains LayerGroupConfig entries instead of LayerConfig entries. Add liveSeed config. Change layersPerAttempt semantics to 3 (audience-facing groups).
4. Update LayerConfig to reference layer groups and track bundles instead of single track indices.
5. Keep the existing LayerType type as GranularType IDs — these are still used in the finale.
6. Add LayerGroupId type for song-building: configurable, default 'bones' | 'flesh' | 'spark'.
7. Ensure all existing code that references LayerType still compiles. LayerType remains valid for granular-level references.

Do NOT change conductor logic or UI yet — just the type definitions and config interfaces.
After changes, the project must compile with no type errors.
```

### Task: Song-Building with 3 Bundled Layers

```
Update the song-building conductor logic to work with 3 bundled layer groups instead of 6 individual layers.

Prerequisites: Types & LayerGroup task must be complete.

Specific changes:
1. Update conductor.ts: LAYERS_PER_ATTEMPT is now 3 (audience-facing). The layer phase machine is unchanged (locked → auditioning → revealing → locked_in/collapsed) but iterates over 3 layers.
2. Update voting.ts: threshold check works the same way but reads from a 3-element thresholds array.
3. Update audio-router.ts: When a layer group option is muted/unmuted, iterate over ALL tracks in the TrackBundle and send individual OSC mute/unmute commands for each.
4. Add live seed support: new AudioCue types 'live_seed_start' and 'live_seed_stop'. The audio-router unmutes live seed tracks at attempt_build start and mutes them on collapse/rejection.
5. Update timing.ts: tempos and auditionBars arrays are now length 3.
6. Update default-show.json with the new config structure (see MIGRATION-V3.2.md Change 8). Use placeholder track indices.
7. Update LayerProgress component for 3 layers.
8. Verify: the stagger table in the config has each layer group at position 0 of one song.

Test cases:
- 3 layers per attempt, thresholds [0.50, 0.66, 0.99]
- Layer 0 always passes (any majority)
- Layer 1 passes when winning proportion >= 0.66
- Layer 2 almost always collapses (needs >= 0.99)
- Muting a layer group option mutes all tracks in the bundle
- Live seed tracks unmute at attempt_build, mute on collapse/rejection
- Tempo changes apply per layer from config
```

### Task: Fragment Decomposition

```
Update fragment generation to decompose layer group results into granular fragments for the finale.

Prerequisites: Types & LayerGroup task must be complete.

Specific changes:
1. Update conductor/fragments.ts: After song-building, each voted layer group produces granular fragments. If "Bones Option A" won in Song 1, and Bones contains bass (track 3) and drums (track 4), generate two GranularFragment entries: one for bass with trackIndex 3, one for drums with trackIndex 4.
2. Respect bothOptionsSurvive config: when true, also generate fragments for the losing option's tracks. When false, only winner's tracks.
3. Collapsed layers (voted but threshold failed): still generate fragments from the winning option.
4. Unreached layers: no fragments generated.
5. Each GranularFragment must have: id, songIndex, layerGroupId, granularType, option, chapter, trackIndex, wonVote, previewAudioPath.
6. The previewAudioPath uses the naming convention: preview-{songIndex}-{granularType}-{option}.mp3

Test cases:
- Voted layer with bothOptionsSurvive=true produces 2 GranularFragments per granular type in the bundle
- Voted layer with bothOptionsSurvive=false produces 1 GranularFragment per granular type
- Collapsed layer still produces winner's fragments
- Unreached layer produces no fragments
- Fragment count: 3 songs × 2 layers minimum × bones(2 types) + flesh(3 types) + spark(1 type) granular types = correct totals
```

### Task: Finale — Assignment Phase

```
Replace the V3.1 assembly/deliberation/ceremony pipeline with the V3.2 assignment + live mix phases.

Prerequisites: Types task must be complete.

Specific changes — this task covers ONLY the assignment phase:
1. Remove conductor/assembly.ts, conductor/deliberation.ts, conductor/ceremony.ts
2. Create conductor/assignment.ts: handles auto-assignment (shuffle users, distribute evenly across configured granular types) and self-select mode (users choose, timer, random assignment for undecided).
3. Update conductor.ts phase machine: remove finale_assembly, finale_deliberation, finale_ceremony, finale_performer_mix. Add finale_assignment, finale_live_mix.
4. Add conductor commands: START_ASSIGNMENT, SELECT_GRANULAR_TYPE, ASSIGNMENT_COMPLETE
5. Add conductor events: ASSIGNMENT_STARTED, GROUPS_ASSIGNED
6. Update server/socket.ts: remove old finale WebSocket events, add select_type and assigned events.
7. Remove UI components: AssemblyCards, DeliberationBoard, AudioPreview, AmbassadorPrompt, CeremonyView, AltarReady
8. Remove hooks: useAltarDetection
9. Update DB schema: replace finale_groups, finale_group_votes, ceremony_events with finale_assignments table.

Test cases:
- Auto-assignment distributes N users evenly across M granular types
- Self-select mode allows users to choose, with timer and random fallback
- Phase transitions: finale_elegy → finale_assignment → finale_live_mix
- Assignment config toggle: auto vs self_select
```

### Task: Finale — Live Mix Phase

```
Implement the Incredibox-style continuous live mixing phase.

Prerequisites: Assignment phase and Fragment Decomposition tasks must be complete.

Specific changes:
1. Create conductor/live-mix.ts: Core logic for continuous majority tracking per granular type, recency tiebreak for ties, debounced crossfade triggering.
2. Implement getActiveFragment(): counts votes per fragment per granular type, returns the majority winner with recency tiebreak for ties.
3. Implement vote handling: SET_LIVE_MIX_PREFERENCE command updates a user's current preference (stores fragmentId + timestamp). Recalculate active fragment. If changed, emit ACTIVE_FRAGMENT_CHANGED event.
4. Implement performer controls: LOCK_GRANULAR_TYPE (freezes a type, ignores audience input), UNLOCK_GRANULAR_TYPE, OVERRIDE_FRAGMENT (performer forces a specific fragment), CLEAR_OVERRIDE.
5. Implement initial state: when finale_live_mix starts, auto-select initial fragments using highest winning proportion from song-building per granular type.
6. Update audio-router.ts: ACTIVE_FRAGMENT_CHANGED → queue crossfade at next bar boundary. Debounce: if majority flips back before the boundary, cancel the queued crossfade.
7. Update server/socket.ts: handle set_preference event, emit mix_state at ~4 Hz with per-type active fragments and vote distributions.
8. Add FinaleState.liveMix to state (see MIGRATION-V3.2.md Change 4).
9. Add finale_mix_events DB table.

Test cases:
- Majority of group determines active fragment
- Tie broken by most recent vote timestamp
- Single vote switch in group of 6 can flip 3-3 tie
- Crossfade queued at bar boundary, not immediately
- Rapid flip-flop cancelled (debounce)
- Performer lock prevents audience changes
- Performer override forces specific fragment
- Initial state uses highest winning proportion from song-building
```

### Task: Finale UI — Audience Phone

```
Build the audience phone UI for the live mix phase.

Prerequisites: Live Mix conductor logic must be complete.

Specific changes:
1. Create components/finale/LiveMixController.tsx: The user's assigned granular type shown prominently (icon, color, label). Available fragments displayed as large tappable cards. Each card shows chapter color + name. Visual indicator of group consensus (NOT exact numbers — use glow intensity, dot clusters, or fill bars). The currently-playing fragment is marked. Tapping switches your preference immediately.
2. Create components/finale/LiveMixSpectator.tsx: Below the user's active controls, show smaller read-only rows for other granular types — just which fragment is currently playing per type.
3. Create hooks/useLiveMix.ts: Subscribes to mix_state WebSocket events (~4 Hz). Manages local state for the user's current preference. Sends set_preference events on tap.
4. The UI must be extremely simple. A grandma should be able to use it. Large tap targets. Minimal text. Color and visual weight communicate consensus, not numbers.
5. Handle the locked state: when the performer locks a granular type, the user's controls for that type dim and show "locked" — tapping does nothing.

Design guidelines:
- Dark background, chapter colors as accents
- Cards should be large enough to tap without precision
- The currently-playing indicator should be immediately obvious (glow, border, animation)
- Consensus visualization should feel organic, not mathematical
- The transition between fragments should feel smooth (no jarring state changes in the UI)
```

### Task: Audition Progress Visualization

```
Add bar-level audition progress to the song-building UI so the audience can see what's playing and when.

Specific changes:
1. Define AuditionProgress interface (see MIGRATION-V3.2.md Change 2): layerIndex, currentOption, barProgress, totalBars, tempo, votingWindowMs, elapsedMs.
2. Update server/timing.ts: derive audition progress from Ableton beat callbacks. Emit an audition_progress event at ~4 Hz during the auditioning phase.
3. Update server/socket.ts: send audition_progress to audience + projector clients.
4. Create components/song-building/AuditionProgress.tsx: Visual progress bar showing which option is currently playing (A or B), how far through the preview (bar-level granularity), and time remaining in the voting window.
5. Integrate into the audience voting UI: the progress indicator should sit near the A/B option cards so the audience can see "Option A is playing now" and "Option B starts in 2 seconds" and "6 seconds left to vote."
6. The progress visualization should compress gracefully as tempo increases and audition bars decrease — at layer 2 with fast tempo, the bar moves quickly and the UI should still feel readable.

Test cases:
- Progress events emitted during auditioning phase only
- barProgress ranges from 0.0 to 1.0 within each option's audition
- currentOption switches from A to B at the correct beat
- votingWindowMs matches auditionBars * 2 * barsToMs(1, tempo)
```

---

## TIPS FOR ADAPTING THESE PROMPTS

- You can combine multiple tasks into one prompt if they're small and related.
- For large tasks, break them into sub-prompts (e.g., "Live Mix — just the conductor logic, no UI").
- Always include "Read MIGRATION-V3.2.md first" in the context section.
- If the agent seems confused about the two-tier model (LayerGroup vs GranularType), paste the relevant section from MIGRATION-V3.2.md Change 1 directly into the prompt.
- After each task, verify: `npm run build` passes, `npm test` passes, no orphaned imports from deleted files.

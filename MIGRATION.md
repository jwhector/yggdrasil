# Migration Guide: V2 → V3 (Finale Redesign)

## Overview

This migration replaces the **Consensus Game** finale system with a **physically embodied four-phase finale**: Group Assembly → Deliberation → Ambassador Ceremony → Performer Mix.

**What stays the same:** Everything related to song-building (health bar, blind vote, reveal, collapse, rejection), the performer mix system, the core server architecture (Next.js + Socket.IO + Ableton OSC), and the persistence strategy.

**What changes:** The entire finale pipeline between the elegy and performer mix phases — types, conductor logic, socket events, UI components, DB schema, and configuration.

---

## Migration Phases

The migration is divided into 6 phases. Each phase is self-contained and testable. Phases should be executed in order because later phases depend on earlier ones.

### Phase 1: Types & Data Models
### Phase 2: Conductor Logic (Pure State Machine)
### Phase 3: Server Layer (Socket.IO + Persistence)
### Phase 4: Client — Assembly & Deliberation UI
### Phase 5: Client — Ceremony & Altar Detection
### Phase 6: Configuration & Audio Previews

---

## Phase 1: Types & Data Models

**Goal:** Update all TypeScript types and interfaces to reflect V3 architecture. This is the foundation — nothing compiles until these are right.

### 1.1 Update `ShowPhase` type

**File:** `conductor/types.ts`

Replace `'finale_consensus'` with three new phases:
```typescript
// REMOVE:
| 'finale_consensus'

// ADD:
| 'finale_assembly'
| 'finale_deliberation'
| 'finale_ceremony'
```

### 1.2 Replace `FinaleState` interface

**File:** `conductor/types.ts`

Remove the entire `FinaleState` interface and replace it with the V3 version from ARCHITECTURE.md. Key structural changes:
- Remove `consensusGame` object (convergence, rounds, threshold, etc.)
- Add `assembly` object (groups map, undecided users, timer)
- Add `deliberation` object (group votes, chosen fragments, ambassador volunteers/selection, timers)
- Add `ceremony` object (layer order, current index, ambassador tracking, locked/forfeited layers)
- `npc` simplified — remove `autoTriggersEnabled`
- `performerMix` unchanged

### 1.3 Replace `FinaleConfig` interface

**File:** `conductor/types.ts`

Remove consensus config fields, add:
```typescript
interface FinaleConfig {
  assemblyTimerMs: number;
  assemblyGracePeriodMs: number;
  deliberationTimerMs: number;
  ambassadorVolunteerTimerMs: number;
  ceremonyLayerOrder: LayerType[];
  audioPreviewPath: string;
  layerLabels: Map<LayerType, string>;
  npcMessages: NpcMessageConfig[];
}
```

### 1.4 Update `Fragment` interface

**File:** `conductor/types.ts`

Add `previewAudioPath: string` field to `Fragment`.

### 1.5 Rename `GainConfig.consensusSwellBeats` → `ceremonySwellBeats`

**File:** `conductor/types.ts`

Rename the field. Update all references throughout the codebase.

### 1.6 Update `ConductorCommand` type

**File:** `conductor/types.ts`

Remove all consensus-related commands:
- `START_CONSENSUS_ROUND`
- `SUBMIT_CONSENSUS_VOTE`
- `END_CONSENSUS_ROUND`
- `SET_CONSENSUS_THRESHOLD`

Add assembly, deliberation, and ceremony commands (see ARCHITECTURE.md Conductor Commands section for the full list).

### 1.7 Update `ConductorEvent` type

**File:** `conductor/types.ts`

Remove all consensus-related events:
- `CONSENSUS_ROUND_STARTED`
- `CONSENSUS_VOTE_UPDATED`
- `CONSENSUS_ROUND_SUCCESS`
- `CONSENSUS_ROUND_FAILURE`
- `CONSENSUS_GAME_COMPLETE`

Add assembly, deliberation, and ceremony events (see ARCHITECTURE.md Conductor Events section for the full list).

### 1.8 Verify compilation

After all type changes, run `tsc --noEmit` to identify every file that needs updating due to type breakage. Fix imports and usages. Do NOT fix logic yet — just make it compile.

### Verification
- [ ] `tsc --noEmit` passes
- [ ] All new types match ARCHITECTURE.md exactly
- [ ] No references to consensus game types remain

---

## Phase 2: Conductor Logic (Pure State Machine)

**Goal:** Replace the consensus game conductor module with assembly, deliberation, and ceremony modules. The conductor is pure logic with no I/O — all testable with unit tests.

### 2.1 Delete `consensus-game.ts`

**File:** `conductor/consensus-game.ts`

Remove the entire file. Remove its export from `conductor/index.ts`.

### 2.2 Create `assembly.ts`

**File:** `conductor/assembly.ts`

Implement group assembly logic:

**Functions needed:**
- `initializeAssembly(users: Map<UserId, User>, config: FinaleConfig): AssemblyState` — creates empty groups for all 7 layer types, puts all connected users in undecided
- `joinGroup(state: AssemblyState, userId: UserId, layerType: LayerType): AssemblyState` — moves user from undecided (or current group) to target group
- `assignUndecided(state: AssemblyState): AssemblyState` — randomly distributes all undecided users across the 7 groups
- `getGroupSizes(state: AssemblyState): Map<LayerType, number>` — returns size of each group
- `getEmptyGroups(state: AssemblyState): LayerType[]` — returns layer types with 0 members

**Key behaviors:**
- Users can freely switch groups before timer expires (remove from old, add to new)
- Random assignment uses uniform distribution across all 7 groups (not weighted by current size)
- Empty groups are a valid outcome — they will be handled in ceremony as forfeits
- Disconnected users in a group should be tracked but not counted as active

### 2.3 Create `deliberation.ts`

**File:** `conductor/deliberation.ts`

Implement group deliberation logic:

**Functions needed:**
- `initializeDeliberation(groups: Map<LayerType, UserId[]>, availableFragments: Fragment[]): DeliberationState` — sets up per-group voting with available fragments filtered by layer type
- `submitGroupVote(state: DeliberationState, userId: UserId, layerType: LayerType, fragmentId: string): DeliberationState` — records or changes a user's vote within their group
- `resolveDeliberation(state: DeliberationState): DeliberationState` — for each group, selects fragment by simple majority; ties broken randomly. Sets `chosenFragments`.
- `getGroupVoteCounts(state: DeliberationState, layerType: LayerType): Map<string, number>` — returns vote distribution for a group (for transparency within group + controller)
- `volunteerAsAmbassador(state: DeliberationState, userId: UserId, layerType: LayerType): DeliberationState` — adds user to volunteer list for their group
- `resolveAmbassadors(state: DeliberationState): DeliberationState` — for each group: if 1 volunteer → they're ambassador; if multiple → random pick; if 0 → layer forfeited
- `getAvailableFragmentsForLayer(availableFragments: Fragment[], layerType: LayerType): Fragment[]` — filters fragments by layer type

**Key behaviors:**
- Only members of a group can vote on that group's fragments
- Votes are transparent within the group (counts visible)
- Majority = most votes, not >50%. With 3 fragments and 5 voters, 2 votes can win.
- Tie-breaking is uniformly random among tied fragments
- Single-member groups: the member's vote is automatically the majority; they are automatically the ambassador (skip volunteer step)
- Empty groups: no deliberation, no ambassador, automatically forfeited
- Single-fragment groups: the one fragment wins automatically; still need ambassador selection

### 2.4 Create `ceremony.ts`

**File:** `conductor/ceremony.ts`

Implement ceremony sequencing logic:

**Functions needed:**
- `initializeCeremony(layerOrder: LayerType[], chosenFragments: Map<LayerType, string | null>, ambassadors: Map<LayerType, UserId | null>, forfeitedLayers: LayerType[]): CeremonyState` — sets up the ceremony with the configured order, skipping empty/forfeited layers
- `callNextAmbassador(state: CeremonyState): CeremonyState` — advances to the next non-forfeited layer in the order, sets current ambassador
- `processAltarLockIn(state: CeremonyState, userId: UserId, layerType: LayerType): CeremonyState` — validates this is the correct ambassador for the current layer, marks layer as locked
- `isCeremonyComplete(state: CeremonyState): boolean` — true when all non-forfeited layers have been locked
- `forceLockIn(state: CeremonyState, layerType: LayerType): CeremonyState` — controller override to lock a layer without altar detection
- `forfeitLayer(state: CeremonyState, layerType: LayerType): CeremonyState` — marks a layer as forfeited mid-ceremony

**Key behaviors:**
- Ceremony advances through `layerOrder` sequentially, skipping forfeited layers
- Only the currently called ambassador can trigger a lock-in
- Lock-in produces an audio cue event (fragment unmute, quantized to next bar)
- The ceremony cannot go backwards — once a layer is locked or forfeited, it's done

### 2.5 Update `npc.ts`

**File:** `conductor/npc.ts`

Simplify from hybrid auto-trigger to event-driven:

**Remove:** All auto-trigger pattern matching logic (failure streaks, near-misses, consecutive same-song, etc.)

**Replace with:** A lookup function that maps event keys to NPC messages:
- `getNpcMessage(config: NpcMessageConfig[], event: string, layerType?: LayerType): string | null`
- Events: `performer_abandonment`, `assembly_start`, `assembly_timer_warning`, `deliberation_start`, `empty_group`, `ambassador_selected`, `layer_forfeited`, `ceremony_start`, `layer_locked`, `final_layer_locked`, `ceremony_complete`

### 2.6 Update `conductor.ts` state machine

**File:** `conductor/conductor.ts`

Update phase transitions:
- `finale_elegy` → `finale_assembly` (was → `finale_consensus`)
- `finale_assembly` → `finale_deliberation` (new)
- `finale_deliberation` → `finale_ceremony` (new)
- `finale_ceremony` → `finale_performer_mix` (was `finale_consensus` → `finale_performer_mix`)

Update command handling to route new commands to new modules.

Update `SETUP_FINALE` to include `previewAudioPath` computation for each fragment.

Update `START_PERFORMER_MIX` to initialize active layers from ceremony lock-in results (not consensus game results).

### 2.7 Update `fragments.ts`

**File:** `conductor/fragments.ts`

Update fragment generation to populate the new `previewAudioPath` field:
```typescript
previewAudioPath: `${config.finale.audioPreviewPath}/preview-${songIndex}-${layerIndex}-${option}.mp3`
```

### 2.8 Write unit tests

**File:** `conductor/__tests__/`

Write tests for all new modules. Key test cases from ARCHITECTURE.md:
- Undecided users are randomly assigned when assembly timer expires
- Empty groups are marked and skipped in ceremony
- Deliberation selects fragment by simple majority at timer expiry
- Ties in deliberation are broken randomly
- Ambassador is selected randomly when multiple volunteers
- Layer is forfeited when no ambassador volunteers
- Ceremony lock-in only accepted from the currently called ambassador
- Performer mix initial state reflects ceremony lock-in results

### Verification
- [ ] All conductor unit tests pass
- [ ] State machine transitions match ARCHITECTURE.md
- [ ] No references to consensus game logic remain in conductor/

---

## Phase 3: Server Layer (Socket.IO + Persistence)

**Goal:** Update the server to handle new WebSocket events and persist new finale data.

### 3.1 Update DB schema

**File:** `db/schema.sql`

Remove `consensus_rounds` table. Add three new tables:
- `finale_groups` (user-to-group assignments, with `auto_assigned` flag)
- `finale_group_votes` (per-user fragment votes during deliberation)
- `ceremony_events` (lock-in and forfeit events per layer)

See ARCHITECTURE.md Schema section for exact SQL.

### 3.2 Update `persistence.ts`

**File:** `server/persistence.ts`

Remove consensus round persistence. Add:
- `saveGroupAssignment(showId, userId, layerType, autoAssigned)`
- `saveGroupVote(showId, userId, layerType, fragmentId)`
- `saveCeremonyEvent(showId, layerType, ambassadorUserId, fragmentId, eventType)`
- Corresponding query functions for recovery

### 3.3 Update `socket.ts`

**File:** `server/socket.ts`

**Remove client events:**
- `consensus_vote`

**Add client events:**
- `join_group` → dispatches `JOIN_GROUP` command
- `group_vote` → dispatches `SUBMIT_GROUP_VOTE` command
- `volunteer_ambassador` → dispatches `VOLUNTEER_AS_AMBASSADOR` command
- `altar_lock_in` → dispatches `ALTAR_LOCK_IN` command

**Remove server events:**
- `convergence_update`

**Add server events:**
- `group_update` — sent during assembly at ~2 Hz with group sizes
- `ambassador_called` — sent when ceremony calls next ambassador
- `altar_ready` — sent to the specific ambassador whose turn it is
- `altar_confirmed` — sent to all clients after successful lock-in

**Update state filtering:**
- Audience state sync now includes: group assignment, group vote counts (if in deliberation), ambassador status, altar-ready flag
- Projector state sync now includes: group sizes, deliberation vote distributions, ceremony progress
- Controller state sync: full state including all group details

### 3.4 Set up timer management

**File:** `server/timing.ts` (or new file `server/finale-timers.ts`)

The assembly and deliberation phases use server-managed timers (not Ableton beat-locked). Implement:
- Assembly timer: starts when `finale_assembly` begins, fires `ASSEMBLY_TIMER_EXPIRED` when done
- Deliberation timer: starts when `finale_deliberation` begins, fires `DELIBERATION_TIMER_EXPIRED` when done
- Ambassador volunteer timers: per-group, start after fragment selection, fire `AMBASSADOR_VOLUNTEER_TIMER_EXPIRED` per group
- Timers should persist across server restarts (store start time + duration, recalculate remaining on recovery)

### 3.5 Update `audio-router.ts`

**File:** `server/audio-router.ts`

Update audio cue routing:
- Remove consensus-related audio cues
- Add ceremony lock-in audio cue: when `CEREMONY_LAYER_LOCKED` event fires, route to OSC unmute for the fragment's track (quantized to next bar boundary, using `ceremonySwellBeats` gain config)
- Ensure performer mix initialization loads ceremony results as the starting active layer state

### 3.6 Update `recovery.ts`

**File:** `server/recovery.ts`

Update recovery logic for new finale phases:
- If server restarts during assembly: recalculate timer remaining from stored start time; if timer has expired, run `assignUndecided` and advance to deliberation
- If server restarts during deliberation: recalculate timer remaining; if expired, run `resolveDeliberation` and `resolveAmbassadors`
- If server restarts during ceremony: resume from the last locked layer (query `ceremony_events` table)

### Verification
- [ ] Schema migration runs cleanly on fresh DB
- [ ] Socket events match ARCHITECTURE.md WebSocket Protocol section
- [ ] Timer management handles server restart recovery
- [ ] Audio cues route correctly for ceremony lock-ins
- [ ] No references to consensus round persistence or events remain

---

## Phase 4: Client — Assembly & Deliberation UI

**Goal:** Build the audience-facing UI for group assembly and deliberation phases.

### 4.1 Remove consensus UI components

Delete:
- `components/finale/ConsensusBoard.tsx`
- `components/finale/ConvergenceMeter.tsx`
- `hooks/useConvergence.ts`
- `components/controller/ConsensusControls.tsx`

### 4.2 Create `AssemblyCards.tsx`

**File:** `components/finale/AssemblyCards.tsx`

Seven tappable cards, one per layer type:
- Each card shows: layer symbol, layer color, configurable label (from config)
- Live member count on each card (updates via `group_update` socket event)
- Tap to join group, tap different card to switch
- Timer display at top
- Selected card has visual emphasis (border, glow)
- After timer expires and groups are assigned: transition to `GroupIdentity.tsx`

### 4.3 Create `GroupIdentity.tsx`

**File:** `components/finale/GroupIdentity.tsx`

Post-assignment confirmation screen:
- "You are [Layer Label]" with large layer symbol and color
- Group member count
- Instruction to physically find others
- Displayed during the grace period before deliberation begins

### 4.4 Create `DeliberationBoard.tsx`

**File:** `components/finale/DeliberationBoard.tsx`

Fragment preview and voting UI:
- Header: group identity (symbol + color + label + count)
- 1–3 fragment cards for this layer type's available fragments
- Each card: chapter color, emotional tagline, play/pause button, vote button
- Vote counts visible per fragment (transparent within group)
- Current user's vote highlighted
- Timer at top

### 4.5 Create `AudioPreview.tsx`

**File:** `components/finale/AudioPreview.tsx`

In-browser audio playback component:
- HTML5 Audio element
- Play/pause toggle per fragment
- Only one fragment plays at a time (pause others when starting new one)
- Loads from static path: `{config.audioPreviewPath}/preview-{songIndex}-{layerIndex}-{option}.mp3`

### 4.6 Create `useAudioPreview.ts` hook

**File:** `hooks/useAudioPreview.ts`

Manages audio preview state:
- Track which fragment is currently playing
- Handle play/pause
- Ensure mutual exclusivity (only one audio playing)
- Clean up Audio objects on unmount

### 4.7 Create `AmbassadorPrompt.tsx`

**File:** `components/finale/AmbassadorPrompt.tsx`

Shown after fragment selection within the group:
- "Will you carry this forward?" prompt
- Accept / Decline buttons
- Timer for volunteer window
- After selection: shows who the ambassador is (or that the layer is forfeited)

### 4.8 Create controller panels

**Files:**
- `components/controller/AssemblyControls.tsx` — group sizes, timer, extend/force-end buttons
- `components/controller/DeliberationControls.tsx` — per-group vote distributions, timer, force-select, force-end buttons

### 4.9 Update projector views

Update projector page to show:
- Assembly: animated group formation visualization
- Deliberation: per-group status overview (vote distributions, ambassador status)

### Verification
- [ ] Assembly cards show live group sizes that update in real time
- [ ] Switching groups works correctly
- [ ] Deliberation shows only fragments available for the user's layer type
- [ ] Audio preview plays/pauses correctly, only one at a time
- [ ] Vote counts update in real time within the group
- [ ] Ambassador prompt appears after fragment selection
- [ ] Controller panels show full state for all groups

---

## Phase 5: Client — Ceremony & Altar Detection

**Goal:** Build the ceremony UI and implement the accelerometer-based altar lock-in detection.

### 5.1 Create `CeremonyView.tsx`

**File:** `components/finale/CeremonyView.tsx`

Passive audience view during ceremony:
- Shows ceremony progress: which layers locked, which is current, which are upcoming/forfeited
- Layer order displayed as a sequence with locked layers glowing, current pulsing, upcoming dimmed
- When an ambassador is called: display layer identity prominently
- When lock-in happens: celebration animation, audio fades into room

### 5.2 Create `AltarReady.tsx`

**File:** `components/finale/AltarReady.tsx`

Ambassador's phone during their turn:
- Full-screen instruction: "Approach the altar. Place your phone face-down."
- Visual indicator that the phone is listening (subtle animation)
- When face-down detected: progress indicator showing the ~2 second hold
- On successful lock-in: vibration pulse + confirmation glow in layer color + "Locked." text
- Uses `useAltarDetection` hook

### 5.3 Create `useAltarDetection.ts` hook

**File:** `hooks/useAltarDetection.ts`

Implements Device Orientation API detection:

```typescript
interface AltarDetectionConfig {
  faceDownThreshold: number;    // degrees from face-down (default: 30)
  stillnessThreshold: number;   // max accel delta m/s² (default: 0.5)
  holdDurationMs: number;       // sustained hold required (default: 2000)
}

interface AltarDetectionState {
  isFaceDown: boolean;
  isStill: boolean;
  holdProgress: number;          // 0.0 to 1.0
  isLocked: boolean;
}
```

**Implementation notes:**
- Request permission for DeviceOrientationEvent on iOS 13+ (requires user gesture)
- Fall back gracefully if DeviceOrientation API not available (show a manual "Lock In" button)
- Face-down detection: check `DeviceOrientationEvent.beta` and `DeviceOrientationEvent.gamma`, or use `DeviceMotionEvent.accelerationIncludingGravity.z` > threshold
- Stillness detection: track accelerometer deltas between readings; if all axes delta < threshold, phone is still
- Hold timer: start counting when both face-down AND still; reset if either condition breaks; fire lock-in event when hold reaches `holdDurationMs`
- After lock-in fires: stop listening, send `altar_lock_in` socket event
- Clean up event listeners on unmount

**Fallback for unsupported devices:**
- If `DeviceOrientationEvent` is not available (or permission denied), render a large "Lock In" button instead
- This maintains functionality on desktop browsers during development/testing

### 5.4 Create `CeremonyControls.tsx`

**File:** `components/controller/CeremonyControls.tsx`

Controller panel for ceremony:
- Current layer being called, ambassador name/ID
- "Call Next Ambassador" button (auto-advances in configured order, skipping forfeits)
- "Force Lock-In" button per layer (override for technical issues)
- "Forfeit Layer" button per layer
- "Skip to Layer" dropdown for reordering on the fly
- Ceremony progress visualization (locked / current / upcoming / forfeited)

### 5.5 Update projector for ceremony

Add ceremony visualization to projector:
- Central layer identity display when ambassador is called
- Lock-in celebration animation
- Layer-by-layer stack building visualization (each locked fragment adds to the visual)
- Forfeited layers shown as dark gaps

### Verification
- [ ] Altar detection works on iOS Safari and Android Chrome
- [ ] Face-down + still for 2 seconds triggers lock-in
- [ ] Fallback button appears when DeviceOrientation API unavailable
- [ ] Lock-in sends socket event and activates audio
- [ ] Ceremony advances through configured layer order
- [ ] Forfeited layers are skipped
- [ ] Controller can force lock-in and forfeit
- [ ] Projector shows ceremony progress with celebration animations

---

## Phase 6: Configuration & Audio Previews

**Goal:** Update all configuration files and set up the audio preview pipeline.

### 6.1 Update `default-show.json`

**File:** `config/default-show.json`

Add/update finale configuration:
```json
{
  "finale": {
    "assemblyTimerMs": 60000,
    "assemblyGracePeriodMs": 15000,
    "deliberationTimerMs": 120000,
    "ambassadorVolunteerTimerMs": 15000,
    "ceremonyLayerOrder": ["bass", "drums", "pad", "melody", "harmony", "fx1", "fx2"],
    "audioPreviewPath": "/audio/previews",
    "layerLabels": {
      "melody": "The Voice",
      "drums": "The Heartbeat",
      "pad": "The Warmth",
      "bass": "The Ground",
      "harmony": "The Color",
      "fx1": "The Shimmer",
      "fx2": "The Shadow"
    }
  }
}
```

Remove any consensus-related configuration.

### 6.2 Replace `npc-triggers.json` with `npc-messages.json`

**File:** `config/npc-messages.json`

Replace the auto-trigger condition/text pairs with event-driven messages:
```json
[
  { "event": "performer_abandonment", "text": "He's gone. We need to do this ourselves." },
  { "event": "assembly_start", "text": "Choose your role. Find each other." },
  { "event": "assembly_timer_warning", "text": "Decide now." },
  { "event": "deliberation_start", "text": "Listen. Decide together." },
  { "event": "empty_group", "layerType": null, "text": "No one chose {layerLabel}. We'll go without it." },
  { "event": "ambassador_selected", "text": "{layerLabel} has its voice." },
  { "event": "layer_forfeited", "text": "{layerLabel} goes silent. Not every part survives." },
  { "event": "ceremony_start", "text": "One by one. Bring it forward." },
  { "event": "layer_locked", "text": "" },
  { "event": "final_layer_locked", "text": "That's all of us." },
  { "event": "ceremony_complete", "text": "He's back. Show him what we built." }
]
```

*Note: `{layerLabel}` is a template variable replaced at runtime.*

### 6.3 Update environment variables

**File:** `.env` (or equivalent)

Remove:
```
CONSENSUS_ROUND_DURATION_MS
CONSENSUS_FIRST_ROUND_DURATION_MS
CONSENSUS_INITIAL_THRESHOLD
CONSENSUS_FAILURE_THRESHOLD_DECAY
CONSENSUS_MIN_THRESHOLD
CONSENSUS_INTER_ROUND_DELAY_MS
CONSENSUS_SUCCESS_CELEBRATION_MS
```

Add:
```
ASSEMBLY_TIMER_MS=60000
ASSEMBLY_GRACE_PERIOD_MS=15000
DELIBERATION_TIMER_MS=120000
AMBASSADOR_VOLUNTEER_TIMER_MS=15000
CEREMONY_LAYER_ORDER=bass,drums,pad,melody,harmony,fx1,fx2
AUDIO_PREVIEW_PATH=/audio/previews
```

### 6.4 Create audio preview directory

**Directory:** `public/audio/previews/`

Create the directory. Add a README or `.gitkeep` explaining:
- Files should be named `preview-{songIndex}-{layerIndex}-{option}.mp3`
- Export from Ableton: render each clip as mp3, 128kbps, 4–8 bars
- Up to 42 files (3 songs × 7 layers × 2 options)
- For development/testing: generate placeholder audio files (silence or tone) matching the naming convention

### 6.5 Create placeholder preview files (development)

For development before real Ableton exports are available, generate 42 placeholder mp3 files (short silence or generated tones) so the preview system can be tested end-to-end.

### Verification
- [ ] `default-show.json` loads correctly with new finale config
- [ ] NPC messages render with template variables replaced
- [ ] Environment variables are read and applied
- [ ] Audio preview files are served correctly from `/audio/previews/`
- [ ] Audio preview plays in browser from the served path

---

## Post-Migration Cleanup

After all 6 phases are complete:

1. **Search for residual consensus references:** grep the entire codebase for `consensus`, `convergence`, `threshold`, `round` (in finale context). Remove any dead code.
2. **Update CLAUDE.md:** Ensure the AI agent context file reflects V3 architecture.
3. **Update CHANGELOG.md:** Document the V2 → V3 migration with intent.
4. **Run full test suite:** All existing song-building tests should still pass. All new finale tests should pass.
5. **Manual integration test:** Walk through the full show flow from lobby to ended, verifying each phase transition.
6. **Device testing for altar detection:** Test on at least 2 iOS devices and 2 Android devices to verify DeviceOrientation API behavior and calibrate thresholds.

---

## Risk Notes

**Altar detection is the highest-risk component.** The Device Orientation API behaves differently across browsers and devices. iOS requires an explicit permission request (triggered by user gesture). Some Android devices have unreliable accelerometer data. The fallback button is essential for robustness.

**Audio preview in a group setting is a playtesting variable.** Multiple phones playing simultaneously might be cacophonous, or it might create an interesting "possibility space" texture since all fragments share the same key/BPM/progression. Consider adding volume control or a "hold to ear" proximity-based volume boost if testing reveals issues.

**Timer durations are estimates.** Assembly (60s), deliberation (120s), and volunteer (15s) timers will need tuning based on real audience behavior. The controller's ability to extend/shorten timers is the safety valve.

**Empty groups and forfeited layers reduce the finale's impact.** If multiple layers are forfeited, the assembled song will have gaps. The performer mix phase can fill these gaps since the performer has access to all 42 fragments, but the ceremony loses dramatic weight. Consider whether NPC messaging should actively nudge balanced group distribution.

# Implementation Prompts — V2 → V3 Migration

## How to Use This File

This file contains copy-paste prompts for an AI coding agent (e.g., Claude Code), one per migration phase. It is a companion to two other documents that the agent should also have access to:

- **ARCHITECTURE.md (V3)** — The authoritative source of truth for all types, interfaces, state machines, and behaviors. When a prompt says "see ARCHITECTURE.md," the agent should read the relevant section for exact type definitions and specifications.
- **MIGRATION.md** — The migration plan that defines the 6 phases, their dependencies, verification checklists, risk notes, and recovery considerations. Each prompt below corresponds to one phase in MIGRATION.md. The agent should read the corresponding MIGRATION.md phase section before starting work — it contains context about *why* each change is being made, edge cases to watch for, and the verification criteria that determine when the phase is complete.

**Before starting any phase:** Give the agent access to all three documents. The prompt provides implementation instructions; MIGRATION.md provides the verification checklist and broader context; ARCHITECTURE.md provides the exact specifications.

Phases must be executed in order — later phases depend on earlier ones. See MIGRATION.md for the dependency rationale.

---

## Phase 1 Prompt: Types & Data Models

```
## Task: Update TypeScript types for V3 finale redesign

Read MIGRATION.md Phase 1 for context on what's changing and why, and the verification checklist to confirm when this phase is complete. Read ARCHITECTURE.md (the V3 spec) for exact type definitions.

The high-level change: the consensus game (convergence meter, timed rounds, threshold softening) is replaced by a physically embodied four-phase sequence: group assembly → deliberation → ambassador ceremony → performer mix.

### What to change

**File: `conductor/types.ts`**

1. Update `ShowPhase` type — replace `'finale_consensus'` with three new phases:
   - `'finale_assembly'` — audience self-selects into 7 layer-type groups
   - `'finale_deliberation'` — groups preview audio, vote on fragments, select ambassadors
   - `'finale_ceremony'` — ambassadors lock fragments at the altar via accelerometer

2. Replace the `FinaleState` interface entirely. Remove the consensus game state. The new structure has these top-level objects:
   - `phase: 'elegy' | 'assembly' | 'deliberation' | 'ceremony' | 'performer_mix'`
   - `availableFragments`, `allFragments`, `lockedFragments` (unchanged purpose)
   - `assembly: { groups: Map<LayerType, UserId[]>, undecidedUsers: UserId[], timerRemaining: number, timerDuration: number }`
   - `deliberation: { groupVotes: Map<LayerType, Map<UserId, string>>, chosenFragments: Map<LayerType, string | null>, ambassadorVolunteers: Map<LayerType, UserId[]>, ambassadors: Map<LayerType, UserId | null>, timerRemaining: number, volunteerTimerRemaining: number | null }`
   - `ceremony: { layerOrder: LayerType[], currentIndex: number, currentAmbassador: UserId | null, altarReady: boolean, lockedLayers: Map<LayerType, string>, forfeitedLayers: LayerType[], ceremonyComplete: boolean }`
   - `npc: { currentMessage: string | null }` (simplified — remove `autoTriggersEnabled`)
   - `performerMix` stays unchanged

3. Replace `FinaleConfig` interface:
   Remove: `consensusRoundDurationMs`, `firstRoundDurationMs`, `initialThreshold`, `thresholdDecayPerFailure`, `minThreshold`, `interRoundDelayMs`, `successCelebrationMs`, `npcAutoTriggers`
   Add: `assemblyTimerMs`, `assemblyGracePeriodMs`, `deliberationTimerMs`, `ambassadorVolunteerTimerMs`, `ceremonyLayerOrder: LayerType[]`, `audioPreviewPath: string`, `layerLabels: Map<LayerType, string>`, `npcMessages: NpcMessageConfig[]`

   Add a new interface:
   ```typescript
   interface NpcMessageConfig {
     event: string;
     layerType?: LayerType;
     text: string;
   }
   ```

4. Add `previewAudioPath: string` to the `Fragment` interface.

5. Rename `GainConfig.consensusSwellBeats` to `ceremonySwellBeats`. Search and update all references.

6. Update `ConductorCommand` type:
   Remove: `START_CONSENSUS_ROUND`, `SUBMIT_CONSENSUS_VOTE`, `END_CONSENSUS_ROUND`, `SET_CONSENSUS_THRESHOLD`
   Add (see ARCHITECTURE.md Conductor Commands section for exact shapes):
   - Assembly: `START_ASSEMBLY`, `JOIN_GROUP`, `ASSEMBLY_TIMER_EXPIRED`, `FORCE_ASSIGN_USER`, `EXTEND_ASSEMBLY_TIMER`, `FORCE_END_ASSEMBLY`
   - Deliberation: `START_DELIBERATION`, `SUBMIT_GROUP_VOTE`, `DELIBERATION_TIMER_EXPIRED`, `VOLUNTEER_AS_AMBASSADOR`, `AMBASSADOR_VOLUNTEER_TIMER_EXPIRED`, `FORCE_FRAGMENT_SELECTION`, `EXTEND_DELIBERATION_TIMER`, `FORCE_END_DELIBERATION`
   - Ceremony: `START_CEREMONY`, `CALL_NEXT_AMBASSADOR`, `ALTAR_LOCK_IN`, `FORCE_LOCK_IN`, `FORFEIT_LAYER`, `SKIP_TO_LAYER`

7. Update `ConductorEvent` type:
   Remove: `CONSENSUS_ROUND_STARTED`, `CONSENSUS_VOTE_UPDATED`, `CONSENSUS_ROUND_SUCCESS`, `CONSENSUS_ROUND_FAILURE`, `CONSENSUS_GAME_COMPLETE`
   Add (see ARCHITECTURE.md Conductor Events section for exact shapes):
   - Assembly: `ASSEMBLY_STARTED`, `GROUP_MEMBERSHIP_CHANGED`, `ASSEMBLY_COMPLETE`
   - Deliberation: `DELIBERATION_STARTED`, `GROUP_VOTE_UPDATED`, `FRAGMENT_CHOSEN`, `AMBASSADOR_VOLUNTEERED`, `AMBASSADOR_SELECTED`, `LAYER_FORFEITED`, `DELIBERATION_COMPLETE`
   - Ceremony: `CEREMONY_STARTED`, `AMBASSADOR_CALLED`, `ALTAR_LOCK_IN_DETECTED`, `CEREMONY_LAYER_LOCKED`, `CEREMONY_LAYER_SKIPPED`, `CEREMONY_COMPLETE`

After all changes, run `tsc --noEmit` and fix any import/reference errors. Don't fix logic — just make it compile. Mark any function bodies that need logic updates with `// TODO: V3 migration` comments.
```

---

## Phase 2 Prompt: Conductor Logic

```
## Task: Implement V3 finale conductor modules

Read MIGRATION.md Phase 2 for the full list of modules to create, key behaviors, and verification checklist. Read ARCHITECTURE.md (V3 spec) for exact type definitions and state machine transitions.

The conductor is a pure state machine with no I/O. All functions take state in, return state out. No side effects.

### Step 1: Delete consensus-game.ts

Delete `conductor/consensus-game.ts`. Remove its export from `conductor/index.ts`.

### Step 2: Create conductor/assembly.ts

Implement group assembly logic. Export these functions:

```typescript
// Initialize assembly state from connected users and config
function initializeAssembly(users: Map<UserId, User>, config: FinaleConfig): FinaleState['assembly']

// Move a user into a group (remove from undecided or current group)
function joinGroup(state: FinaleState['assembly'], userId: UserId, layerType: LayerType): FinaleState['assembly']

// Randomly distribute all undecided users across 7 groups (uniform random)
function assignUndecided(state: FinaleState['assembly']): FinaleState['assembly']

// Get sizes of each group
function getGroupSizes(state: FinaleState['assembly']): Map<LayerType, number>

// Get layer types with 0 members
function getEmptyGroups(state: FinaleState['assembly']): LayerType[]
```

Key rules:
- Users can switch groups freely (joinGroup removes from old, adds to new)
- assignUndecided distributes uniformly — NOT weighted by current size
- Empty groups (0 members) are valid; they become forfeited layers
- Only connected users should be assigned; disconnected users tracked separately

### Step 3: Create conductor/deliberation.ts

Implement deliberation logic. Export these functions:

```typescript
// Set up per-group voting from assembly results + available fragments
function initializeDeliberation(
  groups: Map<LayerType, UserId[]>,
  availableFragments: Fragment[]
): FinaleState['deliberation']

// Record or change a user's vote (must be in the correct group)
function submitGroupVote(
  state: FinaleState['deliberation'],
  userId: UserId,
  layerType: LayerType,
  fragmentId: string
): FinaleState['deliberation']

// Resolve all groups: majority wins, ties broken randomly
function resolveDeliberation(state: FinaleState['deliberation']): FinaleState['deliberation']

// Get vote counts for a specific group (for UI transparency)
function getGroupVoteCounts(
  state: FinaleState['deliberation'],
  layerType: LayerType
): Map<string, number>

// Add a user to the ambassador volunteer list
function volunteerAsAmbassador(
  state: FinaleState['deliberation'],
  userId: UserId,
  layerType: LayerType
): FinaleState['deliberation']

// Resolve ambassadors: 1 volunteer = selected; multiple = random pick; 0 = forfeited
function resolveAmbassadors(state: FinaleState['deliberation']): FinaleState['deliberation']

// Helper: filter available fragments by layer type
function getAvailableFragmentsForLayer(
  availableFragments: Fragment[],
  layerType: LayerType
): Fragment[]
```

Key rules:
- Only members of a group can vote on that group's fragments
- Majority = most votes (not >50%). With 3 fragments and 5 voters, 2 votes can win.
- Ties broken by Math.random() among tied options
- Single-member groups: member is auto-ambassador (skip volunteer step)
- Empty groups: no deliberation, automatically forfeited
- Single-fragment layers: fragment wins automatically, still need ambassador

### Step 4: Create conductor/ceremony.ts

Implement ceremony logic. Export these functions:

```typescript
// Set up ceremony from layer order, chosen fragments, ambassadors, and forfeited layers
function initializeCeremony(
  layerOrder: LayerType[],
  chosenFragments: Map<LayerType, string | null>,
  ambassadors: Map<LayerType, UserId | null>,
  forfeitedLayers: LayerType[]
): FinaleState['ceremony']

// Advance to the next non-forfeited layer, set current ambassador
function callNextAmbassador(state: FinaleState['ceremony']): FinaleState['ceremony']

// Validate and process altar lock-in from the correct ambassador
function processAltarLockIn(
  state: FinaleState['ceremony'],
  userId: UserId,
  layerType: LayerType
): FinaleState['ceremony']

// Check if all non-forfeited layers are locked
function isCeremonyComplete(state: FinaleState['ceremony']): boolean

// Controller override: force lock-in without altar
function forceLockIn(state: FinaleState['ceremony'], layerType: LayerType): FinaleState['ceremony']

// Mark a layer as forfeited mid-ceremony
function forfeitLayer(state: FinaleState['ceremony'], layerType: LayerType): FinaleState['ceremony']
```

Key rules:
- Ceremony advances through layerOrder sequentially, skipping forfeited layers
- Only the currently called ambassador can trigger lock-in (processAltarLockIn validates userId + layerType)
- Lock-in should produce an AUDIO_CUE event (handled by the conductor, not this module)
- Cannot go backwards — once locked or forfeited, done

### Step 5: Update conductor/npc.ts

Simplify to event-driven messages. Remove all auto-trigger pattern matching. Replace with:

```typescript
// Look up NPC message for a given event (and optional layer type)
function getNpcMessage(
  messages: NpcMessageConfig[],
  event: string,
  layerType?: LayerType,
  context?: { layerLabel?: string }
): string | null
```

Support template variables in messages: `{layerLabel}` replaced by the layer's display label from config.

### Step 6: Update conductor/conductor.ts

Update the main state machine:
- Phase transitions: finale_elegy → finale_assembly → finale_deliberation → finale_ceremony → finale_performer_mix
- Route new commands to new modules
- SETUP_FINALE: compute previewAudioPath for each fragment
- START_PERFORMER_MIX: initialize activeLayers from ceremony.lockedLayers (not from consensus results)
- Handle all new timer-expired commands

### Step 7: Update conductor/fragments.ts

When generating fragments, populate the new `previewAudioPath` field:
```typescript
previewAudioPath: `${config.finale.audioPreviewPath}/preview-${fragment.songIndex}-${fragment.layerIndex}-${fragment.option}.mp3`
```

### Step 8: Write tests

Create test files in `conductor/__tests__/` for each new module. Key test cases:

assembly.test.ts:
- initializeAssembly puts all users in undecided
- joinGroup moves user from undecided to target group
- joinGroup moves user from one group to another
- assignUndecided distributes all undecided users
- getEmptyGroups returns groups with 0 members
- disconnected users are not randomly assigned

deliberation.test.ts:
- submitGroupVote records vote for correct group
- submitGroupVote rejects vote from user not in group
- resolveDeliberation picks majority winner
- resolveDeliberation breaks ties randomly (run 100x, verify not always same)
- single-member groups auto-resolve
- empty groups produce null chosen fragment
- volunteerAsAmbassador adds to list
- resolveAmbassadors picks single volunteer
- resolveAmbassadors picks randomly from multiple (run 100x, verify distribution)
- resolveAmbassadors forfeits when 0 volunteers

ceremony.test.ts:
- initializeCeremony skips forfeited layers in order
- callNextAmbassador advances to next non-forfeited layer
- processAltarLockIn accepts correct ambassador
- processAltarLockIn rejects wrong ambassador
- processAltarLockIn rejects wrong layer
- isCeremonyComplete true when all non-forfeited locked
- forceLockIn works for any layer
- forfeitLayer mid-ceremony
```

---

## Phase 3 Prompt: Server Layer

```
## Task: Update server for V3 finale (Socket.IO + persistence + timers)

Read MIGRATION.md Phase 3 for the full scope of server changes, recovery considerations, and verification checklist. Read ARCHITECTURE.md (V3) for the DB schema, WebSocket protocol, and environment variables. Reference the conductor modules from Phase 2 for the command/event types.

### Step 1: Update DB schema

File: `db/schema.sql`

Remove the `consensus_rounds` table.

Add three new tables:

```sql
CREATE TABLE finale_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE finale_group_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE ceremony_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  ambassador_user_id TEXT,
  fragment_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('locked', 'forfeited')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

### Step 2: Update persistence.ts

Remove consensus round save/query functions. Add:
- `saveGroupAssignment(showId: string, userId: string, layerType: string, autoAssigned: boolean): void`
- `saveGroupVote(showId: string, userId: string, layerType: string, fragmentId: string): void`
- `saveCeremonyEvent(showId: string, layerType: string, ambassadorUserId: string | null, fragmentId: string | null, eventType: 'locked' | 'forfeited'): void`
- `getGroupAssignments(showId: string): Array<{userId, layerType, autoAssigned}>`
- `getGroupVotes(showId: string): Array<{userId, layerType, fragmentId}>`
- `getCeremonyEvents(showId: string): Array<{layerType, ambassadorUserId, fragmentId, eventType}>`

### Step 3: Update socket.ts

Remove client event handler for `consensus_vote`.
Remove server event emission for `convergence_update`.

Add client event handlers:
- `join_group` → validate user is in assembly phase → dispatch `JOIN_GROUP` → persist group assignment → emit `group_update` to all
- `group_vote` → validate user is in deliberation phase and in correct group → dispatch `SUBMIT_GROUP_VOTE` → persist vote → emit state sync to group
- `volunteer_ambassador` → validate user is in deliberation phase, fragment chosen, in correct group → dispatch `VOLUNTEER_AS_AMBASSADOR`
- `altar_lock_in` → validate user is the currently called ambassador in ceremony phase → dispatch `ALTAR_LOCK_IN`

Add server event emissions:
- `group_update`: during assembly, broadcast group sizes at ~2 Hz using a setInterval. Payload: `{ groups: Record<string, number>, undecided: number }`
- `ambassador_called`: when ceremony calls next ambassador, emit to all with `{ layerType, userId }`
- `altar_ready`: emit ONLY to the called ambassador's socket
- `altar_confirmed`: after successful lock-in, emit to all with `{ layerType, fragmentId }`

Update state sync filtering:
- Audience members during assembly: their current group selection, all group sizes
- Audience members during deliberation: their group's fragment list, vote counts, their vote, ambassador status
- Audience members during ceremony: ceremony progress, whether they are the current ambassador
- Projector: group sizes (assembly), all group vote distributions (deliberation), ceremony progress
- Controller: full state always

### Step 4: Implement finale timers

Create a timer system for assembly and deliberation phases. These are server-side JS timers (NOT Ableton-locked — these phases don't need musical timing).

```typescript
class FinaleTimer {
  start(durationMs: number, onExpire: () => void): void
  extend(additionalMs: number): void
  getRemaining(): number
  cancel(): void
}
```

Timer lifecycle:
- Assembly timer: starts on `ASSEMBLY_STARTED` event. On expire: dispatch `ASSEMBLY_TIMER_EXPIRED`.
- Deliberation timer: starts on `DELIBERATION_STARTED` event. On expire: dispatch `DELIBERATION_TIMER_EXPIRED`.
- Per-group ambassador volunteer timers: start when fragment is chosen for each group. On expire: dispatch `AMBASSADOR_VOLUNTEER_TIMER_EXPIRED` for that group.

For recovery: persist timer start time in show state. On server restart, recalculate remaining time and set new setTimeout for the remainder. If already expired, immediately dispatch the expired command.

### Step 5: Update audio-router.ts

Remove any consensus-related audio cue handling.

Add ceremony lock-in audio routing: when the conductor emits `AUDIO_CUE` with type `ceremony_lock_in`:
- Unmute the fragment's Ableton track via OSC
- Use the existing gain swell logic with `ceremonySwellBeats` config
- Quantize to next bar boundary (same mechanism as existing audio activation)

Update performer mix initialization: when `START_PERFORMER_MIX` fires, set active layers from the ceremony's `lockedLayers` map.

### Step 6: Update recovery.ts

Handle recovery for new finale phases:
- If show state is `finale_assembly`: check if timer has expired (compare stored start time + duration against current time). If expired, run assignUndecided + advance. If not, restart timer for remaining time.
- If show state is `finale_deliberation`: same pattern — if timer expired, run resolveDeliberation + resolveAmbassadors + advance. If not, restart timer.
- If show state is `finale_ceremony`: query `ceremony_events` table, reconstruct which layers are locked/forfeited, resume from the next unlocked layer.

### Verification
Run the full server startup sequence. Verify:
- DB migration creates new tables without errors
- Socket events are registered (check logs or test with a client)
- Timer starts and fires correctly
- State sync includes correct data for each client type
```

---

## Phase 4 Prompt: Assembly & Deliberation UI

```
## Task: Build audience UI for group assembly and deliberation

Read MIGRATION.md Phase 4 for the full list of components to create/delete and verification checklist. Read ARCHITECTURE.md (V3) Client Routes section for the exact UI specifications per phase.

### Step 1: Remove old components

Delete these files:
- `components/finale/ConsensusBoard.tsx`
- `components/finale/ConvergenceMeter.tsx`
- `components/controller/ConsensusControls.tsx`
- `hooks/useConvergence.ts`

Remove any imports of these files.

### Step 2: Create AssemblyCards.tsx

File: `components/finale/AssemblyCards.tsx`

Props: `{ groups: Map<LayerType, number>, undecidedCount: number, selectedGroup: LayerType | null, timerRemaining: number, timerDuration: number, onJoinGroup: (layerType: LayerType) => void, layerLabels: Map<LayerType, string> }`

Render:
- Timer bar at top (timerRemaining / timerDuration as progress)
- 7 cards in a grid (2 columns on phone), each showing:
  - Layer symbol (from identity.ts) + layer color
  - Configurable label (from layerLabels, e.g., "The Heartbeat")
  - Member count badge
  - Selected state: border glow in layer color
- Tapping a card calls onJoinGroup(layerType)
- Tapping a different card switches (calls onJoinGroup with new type)

### Step 3: Create GroupIdentity.tsx

File: `components/finale/GroupIdentity.tsx`

Props: `{ layerType: LayerType, layerLabel: string, memberCount: number }`

Render:
- Full-screen confirmation: "You are [Label]"
- Large layer symbol + color fill
- Member count: "Find your group — [N] others share your role"
- Shown during the grace period between assembly and deliberation

### Step 4: Create AudioPreview.tsx + useAudioPreview hook

File: `components/finale/AudioPreview.tsx`
File: `hooks/useAudioPreview.ts`

Hook manages:
- Currently playing fragment ID (or null)
- HTML5 Audio element ref
- `play(fragmentId: string, previewPath: string)` — start playback; auto-pause any other playing fragment
- `pause()` — pause current
- `isPlaying(fragmentId: string): boolean`
- Cleanup on unmount

Component renders:
- Play/pause icon button
- Optional: simple progress indicator (current time / duration)
- No scrubbing needed — just play/pause

### Step 5: Create DeliberationBoard.tsx

File: `components/finale/DeliberationBoard.tsx`

Props: `{ layerType: LayerType, layerLabel: string, memberCount: number, fragments: Fragment[], voteCounts: Map<string, number>, currentVote: string | null, timerRemaining: number, timerDuration: number, onVote: (fragmentId: string) => void, audioPreviewPath: string }`

Render:
- Header: layer identity (symbol + color + label + count)
- Timer bar
- Fragment cards (1-3), each showing:
  - Chapter color background
  - Emotional tagline (fragment.displayLabel)
  - AudioPreview play/pause button
  - Vote count badge
  - "Vote" button (or "Voted" if current selection)
  - Highlighted if this is the user's current vote
- Tap vote to select; tap a different fragment to change vote

### Step 6: Create AmbassadorPrompt.tsx

File: `components/finale/AmbassadorPrompt.tsx`

Props: `{ layerType: LayerType, chosenFragment: Fragment, timerRemaining: number, isVolunteered: boolean, ambassadorSelected: UserId | null, isForfeited: boolean, onVolunteer: () => void }`

States:
1. Volunteering open: "Will you carry this forward?" + Accept/Decline buttons + timer
2. User volunteered: "Waiting for selection..." (if multiple volunteers)
3. Ambassador selected (is you): "You are the ambassador for [Label]."
4. Ambassador selected (not you): "[Someone] will carry [Label] forward."
5. Forfeited: "[Label] goes silent."

### Step 7: Create controller panels

File: `components/controller/AssemblyControls.tsx`
- Group sizes table (all 7 layer types + counts)
- Undecided count
- Timer display + extend/shorten buttons
- "Force End Assembly" button
- "Force Assign User" dropdown (select user → select group)

File: `components/controller/DeliberationControls.tsx`
- Per-group accordion/tabs showing: fragment vote distributions, current winner, ambassador volunteers
- Timer display + extend/shorten buttons
- "Force Fragment Selection" per group (dropdown of fragments)
- "Force End Deliberation" button

### Step 8: Update audience page

File: `app/audience/page.tsx`

Add phase-based rendering:
- `finale_assembly` → AssemblyCards → GroupIdentity (after timer)
- `finale_deliberation` → DeliberationBoard → AmbassadorPrompt (after fragment chosen)

Wire up socket events:
- `join_group` emitted on card tap
- `group_vote` emitted on fragment vote
- `volunteer_ambassador` emitted on accept button
- Listen for `group_update` to refresh group sizes during assembly
- State sync provides group vote counts during deliberation

### Verification
- Assembly cards show all 7 layer types with live counts
- Tapping a card sends join_group and updates UI
- Switching groups works
- Timer counts down and triggers phase transition
- Deliberation shows correct fragments per group
- Audio preview plays/pauses, only one at a time
- Vote counts update in real time
- Ambassador prompt appears after timer
- Controller panels show full state
```

---

## Phase 5 Prompt: Ceremony & Altar Detection

```
## Task: Build ceremony UI and accelerometer-based altar lock-in

Read MIGRATION.md Phase 5 for context and the verification checklist — note that MIGRATION.md flags altar detection as the highest-risk component of the migration. Read ARCHITECTURE.md (V3) for the Ceremony and Altar Lock-in sections, including the detection config interface and Device Orientation API details.

### Step 1: Create useAltarDetection hook

File: `hooks/useAltarDetection.ts`

This hook uses the Device Orientation API to detect when a phone is placed face-down and held still.

```typescript
interface AltarDetectionConfig {
  faceDownThreshold: number;    // degrees from perfectly face-down (default: 30)
  stillnessThreshold: number;   // max acceleration delta m/s² (default: 0.5)
  holdDurationMs: number;       // required hold time (default: 2000)
}

interface UseAltarDetectionReturn {
  isSupported: boolean;          // whether Device Orientation API is available
  isFaceDown: boolean;           // currently face-down
  isStill: boolean;              // currently still
  holdProgress: number;          // 0.0 to 1.0 (how far through the hold)
  isLocked: boolean;             // lock-in achieved
  requestPermission: () => void; // trigger iOS permission dialog
  startListening: () => void;    // begin monitoring
  stopListening: () => void;     // stop monitoring
}
```

Implementation:
1. Check for `DeviceOrientationEvent` and `DeviceMotionEvent` support
2. On iOS 13+, `DeviceOrientationEvent.requestPermission()` must be called from a user gesture (button tap). Expose `requestPermission()` for this.
3. Face-down detection: use `DeviceMotionEvent.accelerationIncludingGravity`. When face-down, `z` axis reads approximately `+9.8` (gravity through back of phone). Check: `z > 9.8 * cos(faceDownThreshold * PI/180)`. Alternatively use DeviceOrientationEvent beta/gamma angles.
4. Stillness detection: track accelerometer readings across frames. Compute delta from last reading for each axis. If all deltas < stillnessThreshold, phone is still.
5. Hold tracking: when both faceDown AND still, start incrementing a counter. If either breaks, reset to 0. When counter exceeds holdDurationMs, set `isLocked = true`.
6. Clean up all event listeners on unmount.

IMPORTANT: Include a fallback. If the API is not supported (isSupported = false), the component using this hook should render a manual "Lock In" button instead.

### Step 2: Create AltarReady.tsx

File: `components/finale/AltarReady.tsx`

This is what the ambassador sees when it's their turn.

Props: `{ layerType: LayerType, layerLabel: string, onLockIn: () => void }`

States:
1. **Permission needed** (iOS only): "Tap to enable altar detection" button → calls requestPermission()
2. **Listening**: "Approach the altar. Place your phone face-down." with subtle pulsing animation. Show isFaceDown and isStill indicators subtly.
3. **Holding**: Phone is face-down and still — show progress ring/bar filling up over ~2 seconds. Maybe "Hold steady..." text.
4. **Locked**: Confirmation! Full-screen glow in layer color. Vibrate once (if navigator.vibrate available: `navigator.vibrate(200)`). Text: "Locked." Call onLockIn().
5. **Fallback** (API not supported): Large "Lock In" button. On tap, call onLockIn().

The component should be full-screen, high contrast, minimal text. The ambassador is walking toward a stage — they need to glance at their phone, not read paragraphs.

### Step 3: Create CeremonyView.tsx

File: `components/finale/CeremonyView.tsx`

This is what non-ambassador audience members see.

Props: `{ layerOrder: LayerType[], lockedLayers: Map<LayerType, string>, forfeitedLayers: LayerType[], currentLayerType: LayerType | null, currentAmbassador: UserId | null, ceremonyComplete: boolean }`

Render:
- Vertical sequence of layer badges in the configured order
- Each badge shows: layer symbol + color + label
- States per badge: locked (glowing, checkmark), current (pulsing, highlighted), upcoming (dimmed), forfeited (dark, crossed out)
- When a lock-in happens: the current badge transitions to locked with a celebration animation
- When ceremony is complete: all locked badges glow together, text: "The song is whole."

### Step 4: Create CeremonyControls.tsx

File: `components/controller/CeremonyControls.tsx`

Controller interface for the ceremony:
- Ceremony progress: ordered list showing locked/current/upcoming/forfeited per layer
- Current ambassador info (userId, layer type)
- "Call Next Ambassador" button (advances to next non-forfeited layer)
- Per-layer actions: "Force Lock-In", "Forfeit Layer"
- "Skip to Layer" dropdown for reordering
- When ceremony is complete: "Start Performer Mix" button

### Step 5: Update audience page for ceremony

File: `app/audience/page.tsx`

During `finale_ceremony`:
- If user is the currently called ambassador: render AltarReady
- Otherwise: render CeremonyView
- Wire up `altar_lock_in` socket emission from AltarReady.onLockIn
- Listen for `ambassador_called` to know when to switch to AltarReady
- Listen for `altar_confirmed` to animate lock-in on CeremonyView

### Step 6: Update projector for ceremony

File: `app/projector/page.tsx` (or projector components)

During `finale_ceremony`:
- Central display: current layer identity (large symbol + color + label)
- When ambassador is called: display "Ambassador for [Label]" text
- When lock-in happens: celebration animation (burst, particles, color bloom)
- Layer stack visualization: each locked layer shown as a glowing bar/badge, building from bottom to top
- Forfeited layers as dark gaps
- Loop: the visual stack grows with each lock-in, showing the song assembling

### Verification
- On a mobile device (iOS Safari / Android Chrome):
  - Hook detects face-down orientation correctly
  - Stillness detection works (holding phone still vs moving it)
  - 2-second hold triggers lock-in
  - Vibration fires on lock-in
- On desktop browser:
  - Fallback button renders instead of accelerometer UI
  - Button click triggers lock-in
- Ceremony flow:
  - Controller "Call Next Ambassador" advances correctly
  - Only called ambassador sees AltarReady
  - Lock-in sends event and activates audio
  - CeremonyView updates for all non-ambassadors
  - Forfeited layers are skipped
  - Ceremony completes when all non-forfeited layers locked
```

---

## Phase 6 Prompt: Configuration & Audio Previews

```
## Task: Update configuration files and set up audio preview pipeline

Read MIGRATION.md Phase 6 for the full scope and verification checklist. Also read the MIGRATION.md "Post-Migration Cleanup" section — the codebase cleanup steps in this prompt correspond to that cleanup list.

### Step 1: Update config/default-show.json

Add the finale V3 configuration block. Remove any consensus-related config.

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

Ensure all layer labels and ceremony order are configurable — they should be read from this file, not hardcoded in components.

### Step 2: Create config/npc-messages.json

Replace `config/npc-triggers.json` with event-driven messages:

```json
[
  { "event": "performer_abandonment", "text": "He's gone. We need to do this ourselves." },
  { "event": "assembly_start", "text": "Choose your role. Find each other." },
  { "event": "assembly_timer_warning", "text": "Decide now." },
  { "event": "deliberation_start", "text": "Listen. Decide together." },
  { "event": "empty_group", "text": "No one chose {layerLabel}. We'll go without it." },
  { "event": "ambassador_selected", "text": "{layerLabel} has its voice." },
  { "event": "layer_forfeited", "text": "{layerLabel} goes silent. Not every part survives." },
  { "event": "ceremony_start", "text": "One by one. Bring it forward." },
  { "event": "layer_locked", "text": "" },
  { "event": "final_layer_locked", "text": "That's all of us." },
  { "event": "ceremony_complete", "text": "He's back. Show him what we built." }
]
```

Delete `config/npc-triggers.json`.

### Step 3: Update environment variables

Remove all `CONSENSUS_*` variables. Add:
```
ASSEMBLY_TIMER_MS=60000
ASSEMBLY_GRACE_PERIOD_MS=15000
DELIBERATION_TIMER_MS=120000
AMBASSADOR_VOLUNTEER_TIMER_MS=15000
CEREMONY_LAYER_ORDER=bass,drums,pad,melody,harmony,fx1,fx2
AUDIO_PREVIEW_PATH=/audio/previews
```

Update the config loading code to read these variables and populate the FinaleConfig object.

### Step 4: Create audio preview directory + placeholders

Create `public/audio/previews/` directory.

For development testing, generate 42 placeholder MP3 files. Each should be a short (2-4 second) audio file — can be silence, a sine tone, or a simple generated sound. Name them:
```
preview-0-0-A.mp3, preview-0-0-B.mp3
preview-0-1-A.mp3, preview-0-1-B.mp3
... (through all 7 layers for song 0)
preview-1-0-A.mp3, preview-1-0-B.mp3
... (through all 7 layers for song 1)
preview-2-0-A.mp3, preview-2-0-B.mp3
... (through all 7 layers for song 2)
```

Add a README.md in the previews directory explaining:
- These are placeholder files for development
- Production files should be exported from Ableton at 128kbps mp3
- Each file corresponds to one clip: song {songIndex}, layer {layerIndex}, option {A|B}
- Duration: 4-8 bars recommended

### Step 5: Verify static file serving

Ensure Next.js serves files from `public/audio/previews/` correctly:
- Navigate to `http://localhost:3000/audio/previews/preview-0-0-A.mp3` and confirm the file loads
- Verify the Audio API can play these files in a browser

### Step 6: Full codebase cleanup

Search the entire codebase for any remaining references to:
- `consensus` (in variable names, comments, file names — not in CHANGELOG/MIGRATION docs)
- `convergence`
- `threshold` (in finale context only — health bar drain factor threshold references are fine)
- `ConsensusBoard`, `ConvergenceMeter`, `useConvergence`, `ConsensusControls`
- `npc-triggers.json`
- `consensus_rounds` (DB table)
- `CONSENSUS_` (environment variables)

Remove all dead references. Update imports.

### Verification
- `default-show.json` loads without errors
- NPC messages load and template variables ({layerLabel}) are replaced correctly
- Environment variables are read
- Audio preview files serve from the expected URLs
- Full `tsc --noEmit` passes
- Full test suite passes
- No remaining consensus references in active code
```

---

## Post-Migration Verification Prompt

```
## Task: Full integration verification of V3 migration

Read MIGRATION.md "Post-Migration Cleanup" and "Risk Notes" sections for the full cleanup checklist and known risk areas. This prompt walks through the complete show flow to verify everything works end-to-end.

### Show flow to verify:

1. **Lobby → Opener → Attempt 1 (song-building)**: unchanged, should work as before
2. **Song 1 collapse or rejection**: unchanged, verify fragments are generated correctly with previewAudioPath populated
3. **Repeat for Songs 2 and 3**
4. **Finale Elegy**: verify fragment grid shows winners/losers/unreached correctly
5. **Finale Assembly**:
   - 7 cards appear with correct labels
   - Tapping a card shows updated group count
   - Switching groups works
   - Timer counts down
   - At timer expiry: undecided assigned randomly, groups finalized
   - Empty groups identified
6. **Finale Deliberation**:
   - Each group member sees correct fragments for their layer type
   - Audio preview plays/pauses correctly
   - Vote counts update in real time within group
   - Timer expires: majority fragment selected
   - Ambassador prompt appears
   - Volunteering works; selection works; forfeit works
7. **Finale Ceremony**:
   - Controller calls first ambassador
   - Ambassador sees AltarReady
   - On mobile: face-down detection works
   - On desktop: fallback button works
   - Lock-in triggers audio activation (quantized to bar boundary)
   - CeremonyView shows progress for non-ambassadors
   - All layers lock or forfeit; ceremony completes
8. **Finale Performer Mix**: unchanged from V2, verify initial state reflects ceremony results
9. **Controller**: all new panels show correct data at each phase
10. **Projector**: all new visualizations render at each phase
11. **Recovery**: restart server mid-assembly, mid-deliberation, mid-ceremony — verify correct resumption

### Specific edge cases to test:
- All users undecided at assembly timer → all randomly assigned
- A group with 1 member → auto-deliberation, auto-ambassador
- An empty group → forfeited, skipped in ceremony
- Multiple ambassador volunteers → random selection
- No ambassador volunteer → layer forfeited
- Ambassador disconnects during ceremony → controller force-lock-in
- All layers forfeited → ceremony completes immediately → performer mix with all layers muted
```
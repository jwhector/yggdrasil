# Changelog

All notable changes to the Yggdrasil system. Each entry explains **why** a change was made, not just what changed.

---

## [2026-02-09] — AbletonOSC Integration

**Context:** The system was designed around a custom Max for Live device sending bespoke `/ableton/*` messages for audition timing. This required maintaining custom M4L code and limited testing without a full Ableton setup. By switching to the AbletonOSC plugin (ideoforms), we gain direct control over Ableton's Live Object Model via standard OSC, eliminating custom M4L development.

**Why This Change:**
1. **No custom M4L code**: AbletonOSC exposes the full Live API via OSC, removing need for custom device
2. **Better testability**: Mock AbletonOSC server simulates beat events, clip control, and transport
3. **More control**: Direct clip fire/stop, track mute/unmute, and beat subscription via standard API
4. **Session layout flexibility**: 32-track layout (4 per row) enables layering via track isolation
5. **Beat-based timing**: Master loop in beats (e.g., 32 = 8 bars) with shorter clips looping naturally

**Changes:**
- **conductor/types.ts**: Added `masterLoopBeats` field to `TimingConfig` for beat-based loop detection
- **config/default-show.json**: Added `"masterLoopBeats": 32` (8 bars in 4/4 time)
- **.env.example, server/osc.ts, server/index.ts**: Updated default OSC ports from 9001/9000 → 11000/11001 (AbletonOSC standard)
- **server/audio-router.ts**: Complete rewrite for AbletonOSC protocol
  - Track indexing: `rowIndex * 4 + optionIndex` (32 tracks total)
  - Audition via mute/unmute (clips fire once, cycle muting for smooth transitions)
  - `play_option`: Fire all 4 row clips muted on first audition, then unmute/mute cycle
  - `commit_layer`: Ensure winner unmuted, others muted (layering works via track isolation)
  - `uncommit_layer`: Mute + stop all 4 tracks for row, clear fired state
  - `play_timeline`: Mute all, fire+unmute path tracks (finale)
  - Pause/resume: Global transport (`/live/song/stop_playing`, `/live/song/continue_playing`)
- **server/timing.ts**: Rewrite for beat-based audition timing
  - Subscribe to `/live/song/start_listen/beat` on start, unsubscribe on stop
  - Track beats elapsed via `/live/song/get/beat` responses
  - Advance when `beatsElapsed >= masterLoopBeats`
  - Fallback mode unchanged (JS timers when OSC unavailable)
- **server/__tests__/audio-router.test.ts**: Complete test rewrite for AbletonOSC assertions
  - Verify track index calculation (row 2, option 3 → track 11)
  - Verify clip fire + mute/unmute patterns
  - Verify layering (committed rows don't affect other rows)
  - Verify coup uncommit clears fired state (clips re-fire on next audition)
- **server/tools/osc-mock-ableton.ts**: Rewrite as AbletonOSC simulator
  - Beat event generation at configurable BPM (`MOCK_BPM` env var)
  - Transport control (start/stop/continue)
  - Clip fire/stop and track mute state tracking
  - Test message responses (`/live/test` → 'ok')

**Implications:**
- Ableton session layout: 32 tracks (4 per row), clips at scene 0. Each row's tracks are independent, enabling layering.
- Audio router is single source of truth for all audio OSC messages (timing engine only schedules, doesn't send audio messages).
- Conductor remains pure — no changes to event emission logic, only new `masterLoopBeats` config field.

**Session Setup for Ableton:**
1. Create 32 audio tracks (or MIDI if using instruments)
2. Group tracks by row: Row 0 = tracks 0-3, Row 1 = tracks 4-7, ..., Row 7 = tracks 28-31
3. Place clips in scene 0 (first scene) for each track
4. Clips should be multiples of master loop length (shorter clips loop naturally within master loop)
5. Install and configure AbletonOSC to listen on port 11000, reply on 11001

---

## [2026-02-09] — Extract Audio Router & OSC Mock Tool

**Context:** Audio cue routing (AUDIO_CUE → OSC messages) was inline in `server/index.ts` (~50 lines). This made it hard to test, and both the timing engine and the inline hook were sending `/ygg/audition/start` — causing duplicate OSC messages. Individual timeline playback (`/ygg/finale/timeline`) was also missing.

**Changes:**
- Extracted `server/audio-router.ts`: single owner of all outbound audio OSC messages
- Removed duplicate `/ygg/audition/start` send from `server/timing.ts` (timing engine now only tracks state, doesn't send audio)
- Added `userId?` to `AudioCue` type for individual vs popular timeline distinction
- Added `/ygg/finale/timeline` routing alongside existing `/ygg/finale/popular`
- Created `server/tools/osc-mock-ableton.ts`: standalone script simulating Ableton's OSC responses for testing without Ableton
- Exported `encodeOSCMessage`/`decodeOSCMessage` from `server/osc.ts` for reuse

**Implications:** The `server/adapters/` directory from ARCHITECTURE.md was never created; `audio-router.ts` fulfills that role with a simpler pattern. The timing engine still needs `oscBridge.isRunning()` to choose Ableton-wait vs JS-timer fallback.

---

## [2026-02-06] — Merge Auditioning and Voting Phases + Auto-Submit Votes

**Context:** The original design had separate `auditioning` and `voting` phases, requiring audiences to wait passively during audition, then switch to voting mode. This created unnecessary friction and delayed engagement. Additionally, the two-click vote selection mechanism (click once for faction, again for personal) was confusing for first-time users on mobile. This change merges audition and voting into a single phase where users can vote while listening, and replaces the sequential click pattern with an explicit popover interface with auto-submit.

**Why This Change:**
1. **Better engagement**: Users can make decisions as they hear options, not after
2. **Reduced latency**: No "dead time" between hearing all options and being able to vote
3. **Clearer UX**: Popover with labeled buttons ("Faction Vote" / "Personal Vote") removes ambiguity
4. **Mobile-friendly**: Single tap + choice is more intuitive than remembering click sequence
5. **Instant feedback**: Auto-submit removes extra button press, votes save immediately

**Changes:**
- **conductor/types.ts**:
  - Removed `'auditioning'` from `RowPhase` enum
  - Added `auditionComplete: boolean` to `Row` interface to track audition progress within voting phase
  - Added `AUDITION_COMPLETE` event type
  - Updated `AudienceClientState` and `ProjectorClientState` to include `auditionComplete`

- **conductor/conductor.ts**:
  - Renamed `advanceFromAuditioning` → `advanceAuditionDuringVoting`
  - Updated `handleStartShow` to start rows in `'voting'` phase with `auditionComplete: false`
  - Modified `handleAdvancePhase` to handle audition within voting phase:
    - If `!auditionComplete`: advance audition, emit `AUDITION_OPTION_CHANGED`
    - If `auditionComplete`: advance to revealing phase
  - Updated `advanceToNextRow` and `handleRestartRow` to initialize voting phase with audition

- **conductor/coup.ts**:
  - Updated coup trigger to reset to `'voting'` phase with `auditionComplete: false`

- **server/timing.ts**:
  - Modified `onStateChanged` to handle combined phase:
    - During voting, check `auditionComplete` to decide between audition timing (Ableton) or voting timer (JS)
  - Updated `handleAbletonAuditionDone` to check for voting phase with incomplete audition

- **server/socket.ts**:
  - Added `auditionComplete` to client state filtering for both audience and projector

- **components/AuditionVoteInterface.tsx** (new):
  - Combined `AuditionDisplay` and `VoteInterface` into single component
  - Shows "Now Playing: Option X" during audition
  - Animated popover appears on option tap with two buttons: "Faction Vote" / "Personal Vote"
  - Auto-submits votes via `useEffect` when both faction and personal votes selected
  - Shows "✓ Votes saved" indicator when complete
  - Removed manual submit button

- **components/PhaseIndicator.tsx**:
  - Updated to show audition progress during voting phase based on `auditionComplete` flag
  - Displays "Auditioning Option X/4" when `!auditionComplete`, "Voting Now" when complete

- **app/audience/page.tsx**:
  - Replaced separate `AuditionDisplay` and `VoteInterface` conditionals with single `AuditionVoteInterface`
  - Renders during `'voting'` phase regardless of audition state

- **Tests**:
  - Updated all conductor tests expecting `'auditioning'` phase to use `'voting'` with `auditionComplete`
  - Updated timing tests to reflect combined phase behavior
  - Updated coup tests for phase reset behavior
  - All 173 tests passing

**Backward Compatibility:**
- Breaking change: Persisted states with `'auditioning'` phase would be invalid
- Migration not implemented (development-only change, no active performances)
- Type system will catch all usage via compile errors

**User Experience:**
```
Before: Listen passively → Wait → Click option → Click again → Click submit
After: Listen + Vote in parallel → Tap option → Choose vote type → Auto-saved
```

---

## [2026-02-05] — Add `auditionLoopsPerRow` Configuration

**Context:** The audition phase currently cycles through all 4 options once before transitioning to voting. For certain musical designs, it may be desirable to cycle through all options multiple times to give the audience more time to absorb the choices. This change adds a configurable `auditionLoopsPerRow` field that controls how many complete cycles through all 4 options occur before advancing to voting.

**Changes:**
- **conductor/types.ts**:
  - Added `auditionLoopsPerRow: number` to `TimingConfig` interface
  - Default value: 1 (preserves current behavior)

- **conductor/conductor.ts**:
  - Modified `advanceFromAuditioning()` to support multi-loop auditions
  - `currentAuditionIndex` now grows to `auditionLoopsPerRow * 4` instead of stopping at 4
  - Uses modulo arithmetic (`currentAuditionIndex % 4`) to derive actual option index (0-3)
  - Events always emit option indices 0-3 regardless of loop count

- **server/timing.ts**:
  - Updated `handleAuditionPhase()` to use modulo for option index calculation
  - Added loop progress logging (e.g., "option 2 (loop 1/2)")
  - Updated `handleAbletonAuditionDone()` to compare against modulo option index

- **config/default-show.json**:
  - Added `auditionLoopsPerRow: 1` to timing configuration

- **Tests**:
  - Added 4 new tests to `conductor/__tests__/conductor.test.ts`
  - Added 2 new tests to `server/__tests__/timing.test.ts`
  - Updated test helper configs in all test files

**Backward Compatibility:**
- All code paths use `?? 1` fallback for missing field
- Existing configs without the field continue to work with default behavior
- Persisted states from older versions work correctly

**Example:**
```json
"timing": {
  "auditionLoopsPerRow": 2,  // Cycle: 0→1→2→3→0→1→2→3 then vote
  "auditionLoopsPerOption": 2,
  "auditionPerOptionMs": 10000
}
```

---

## [2026-02-05] — Hybrid Timing Engine with Ableton OSC Integration

**Context:** The show requires automated phase advancement with precise musical timing. Rather than fighting against DAW timing with JavaScript timers, we implement a hybrid approach: Ableton Live controls musical timing (audition loops, tempo), while the server handles game logic timing (voting windows, coup windows). This separation of concerns plays to each system's strengths—Ableton provides sample-accurate timing, while Node.js manages state and game logic.

**Changes:**
- **server/osc.ts** (new):
  - Implemented bidirectional OSC bridge for communication with Ableton Live
  - Pure Node.js UDP implementation (no external dependencies)
  - OSC encoding/decoding per the OSC 1.0 specification
  - EventEmitter-based message routing by address pattern
  - Null bridge for testing without Ableton
  - Configurable ports (default: send 9001, receive 9000)

- **server/timing.ts** (new):
  - Hybrid timing engine that coordinates Ableton and server-side timers
  - Audition phase: Sends OSC to Ableton, waits for `/ableton/audition/done` response
  - Voting/revealing/coup_window phases: Uses JS `setTimeout` (non-musical timing)
  - Committed phase: No timer (manual row transitions)
  - Fallback mode: JS timers for all phases when Ableton not connected
  - Version checking prevents stale timer fires after manual advances
  - Pause cancels all timers; resume schedules fresh

- **server/index.ts**:
  - Added state change hooks pattern for extensibility
  - Integrated OSC bridge and timing engine into server lifecycle
  - Audio cue events (`AUDIO_CUE`) automatically sent via OSC
  - Environment variable configuration for OSC ports and feature flags
  - Proper cleanup on shutdown

- **server/socket.ts**:
  - Exported `broadcastEvents` and `filterStateForClient` for use by timing engine

- **Tests** (24 new tests):
  - `server/__tests__/timing.test.ts`: Timer scheduling, cancellation, OSC handling, lifecycle
  - `server/__tests__/osc.test.ts`: Null bridge, protocol validation

**OSC Protocol (Server ↔ Ableton):**

Server → Ableton (port 9001):
| Address | Description |
|---------|-------------|
| `/ygg/audition/start` | Start playing option for audition |
| `/ygg/audition/stop` | Stop current audition playback |
| `/ygg/layer/commit` | Commit option as permanent layer |
| `/ygg/layer/uncommit` | Remove committed layer (coup) |
| `/ygg/show/pause` | Pause all audio |
| `/ygg/show/resume` | Resume audio |

Ableton → Server (port 9000):
| Address | Description |
|---------|-------------|
| `/ableton/audition/done` | All loops for option finished |
| `/ableton/loop/complete` | Single loop completed (for UI feedback) |
| `/ableton/cue/hit` | Named cue point reached |
| `/ableton/ready` | Ableton connected and ready |

**Configuration:**
```bash
TIMING_ENGINE_ENABLED=true|false  # Default: true
OSC_ENABLED=true|false            # Default: true
OSC_SEND_PORT=9001                # Port to send to Ableton
OSC_RECEIVE_PORT=9000             # Port to receive from Ableton
ABLETON_HOST=127.0.0.1            # Ableton host IP
```

**Implications:**
- Max for Live patch needed in Ableton to implement the OSC protocol
- Without Ableton, system falls back to JS timers (slightly less precise but functional)
- Manual advances always take precedence over automatic timing
- Row transitions remain manual—performer controls pacing between rows
- Future: voting during audition phase requires conductor changes (flagged as TODO)
- Future: reveal timing could be Ableton-driven if reveal has musical component

---

## [2026-02-04] — Replace Granular Events with Full State Syncs

**Context:** The WebSocket layer was using granular event-based updates (ROW_PHASE_CHANGED, SHOW_PHASE_CHANGED, etc.) that required client-side handlers to manually patch state. This created opportunities for state drift—the bug in `handleRowPhaseChanged` that updated row phase but not `currentRowIndex` is a perfect example. As the system grows, maintaining synchronized client-side state transformations becomes increasingly fragile and error-prone. For a live performance system where reliability is critical, eliminating state drift is more important than minimizing bandwidth.

**Changes:**
- **server/socket.ts**:
  - Rewrote `broadcastEvents()` to send full filtered state to each client type on every state change
  - Made function async to support iterating audience sockets for personalized state
  - Removed large switch statement that routed 40+ granular event types
  - Kept only special handling for FACTION_ASSIGNED (to join faction rooms) and ERROR events
  - Store `userId` on socket objects for audience members to enable personalized filtering
  - Updated all `broadcastEvents()` call sites to use `await`
- **hooks/useShowState.ts**:
  - Removed 7 incremental event handlers (~80 lines): `handleRowPhaseChanged`, `handleShowPhaseChanged`, `handleRowCommitted`, `handlePathsUpdated`, `handleUserJoined`, `handleUserLeft`, `handleFactionsAssigned`
  - Simplified to single `handleStateSync` handler
  - Removed all socket event registrations except `state_sync`

**Implications:**
- **State drift is eliminated**: Client state is always an exact copy of server state filtered for that client type
- **Simpler client code**: No need to anticipate which state fields change with each event type
- **Less maintenance burden**: New state fields automatically sync without updating event handlers
- **Higher bandwidth per update**: ~10-50KB per state change for 30 users = 1.5MB total broadcast (acceptable for local network and infrequent updates)
- **Version tracking**: `state.version` still increments on every change, enabling future optimizations like delta compression if needed
- **Breaking change**: Old clients expecting granular events (row_phase_changed, etc.) will not work—but system isn't deployed yet
- **Future development**: When adding new state fields, no client-side handler updates required

**Trade-off rationale:** For ~30 concurrent users with infrequent state changes (~every 10-30 seconds), full state syncs (~50KB) are negligible bandwidth. The reliability benefit of guaranteed state consistency far outweighs the small bandwidth cost. This aligns with the system's priority of robustness for live performance over premature optimization.

---

## [2026-02-04] — Fix Phase Event Naming Collision

**Context:** The conductor emits both row phase changes (auditioning, voting, revealing, etc.) and show phase changes (lobby, running, finale, etc.). The event `PHASE_CHANGED` was ambiguous, and the client was incorrectly interpreting row phase changes as show phase changes. This caused the controller UI buttons to be disabled incorrectly—for example, when a row entered "auditioning" phase, the controller thought the entire show was in an invalid state.

**Changes:**
- Renamed `PHASE_CHANGED` event → `ROW_PHASE_CHANGED` throughout the codebase
  - `conductor/types.ts` — Updated ConductorEvent type definition
  - `conductor/conductor.ts` — All event emissions
  - `conductor/coup.ts` — Coup-triggered phase changes
  - `server/socket.ts` — Event broadcast handling
- Updated `hooks/useShowState.ts`:
  - Renamed `handlePhaseChanged` → `handleRowPhaseChanged` for clarity
  - Fixed handler to update `rows[data.row].phase` instead of show phase
  - Updated socket listener from `phase_changed` → `row_phase_changed`
- Fixed double connection and missing heartbeat issues in `hooks/useSocket.ts`:
  - Added `socketRef` for proper cleanup in React Strict Mode
  - Added `ping`/`pong` handler to respond to server heartbeats
  - Prevented duplicate connections when component remounts

**Implications:**
- Event naming now clearly distinguishes row-level vs show-level phase transitions
- Controller UI buttons now correctly enable/disable based on actual show phase
- Future events should follow this naming pattern: `ROW_*` for row-level, `SHOW_*` for show-level
- Client properly responds to heartbeats, preventing false disconnections

---

## [2026-02-04] — Complete Controller UI (Phase 4)

**Context:** The controller is the performer's interface for managing a live show. It must display real-time state, provide phase controls, and include emergency recovery options. Building the controller first enables testing all other components.

**Changes:**
- Created `lib/storage.ts` — localStorage helpers for client identity persistence
- Created `hooks/useSocket.ts` — Socket.IO connection with exponential backoff reconnection
- Created `hooks/useShowState.ts` — Client-side state management from server events
- Built `app/controller/page.tsx` with complete UI:
  - Connection status indicator (green/yellow/red)
  - Show state overview (phase, current row, user count, version)
  - Faction distribution display
  - Phase controls (Assign Factions, Start Show, Advance, Pause, Skip, Restart, Force Finale)
  - Emergency controls (Reset to Lobby with confirmation, Export/Import State, Force Reconnect All)
- Created `components/SeatMap.tsx` — Lobby seat visualization with faction colors

**Divergence from Plan — State Serialization:**
The original roadmap did not address how `Map` and `Set` objects in `ShowState` would survive JSON serialization over Socket.IO. These types become plain objects when JSON-serialized, breaking type safety.

**Solution implemented:**
- Created `lib/serialization.ts` with `serializeState()` and `deserializeState()` functions
- Server serializes `Map` → `[key, value][]` arrays and `Set` → arrays before emitting
- Client deserializes arrays back to proper `Map` and `Set` instances after receiving
- Added `isSerializedState()` type guard for detection
- Updated `server/socket.ts` to call `serializeState()` for controller mode
- Updated `hooks/useShowState.ts` to call `deserializeState()` when receiving state

This ensures all state objects conform to their TypeScript type definitions after transmission.

**Implications:**
- Future client types (projector, audience) already receive filtered state without Maps/Sets
- Any new fields using Map/Set in ShowState must be added to serialization functions
- The serialization pattern could be applied to other event types if needed

---

## [2026-02-04] — Complete WebSocket Server (Phase 3)

**Context:** The system requires real-time bidirectional communication for 30+ concurrent users during live performances. WebSocket connections must be resilient to network issues, with automatic reconnection and heartbeat monitoring. All state changes must be immediately persisted and broadcast to appropriate clients.

**Changes:**
- Created server/socket.ts with complete Socket.IO event handling infrastructure
- Implemented room-based broadcasting (audience, projector, controller, faction:0-3)
- Added client→server events: join, vote, coup_vote, fig_tree_response, command
- Added server→client event broadcasting with intelligent routing
- Implemented heartbeat system (15s ping, 5s timeout, 2 missed = disconnect)
- Implemented reconnection protocol with version tracking and state sync
- Added state filtering by client type (audience sees subset, controller sees all)
- Wired server/index.ts to initialize persistence, load/create show state, and coordinate state updates
- Implemented automatic backup on phase transitions (lobby→running, running→finale)
- Added optional periodic backup system (configurable via environment variables)
- Added graceful shutdown with final backup and cleanup

**Implications:**
- All state mutations immediately persist to SQLite before broadcasting events
- Faction-specific events (coup meters) only visible to that faction's room
- Clients automatically reconnect with exponential backoff on disconnect
- State version tracking enables efficient delta sync (vs full state transfer)
- Backups created at critical phase transitions ensure recovery points
- Server can survive crashes and restore exact state from last persist
- Controller commands pass through same event system as user actions
- PERIODIC_BACKUP env var enables additional safety during long performances

---

## [2026-02-04] — Complete Persistence Layer (Phase 2)

**Context:** The system must persist show state to survive server crashes during live performances. State recovery needs to be immediate and transparent to users. Database operations must be atomic to prevent corruption.

**Changes:**
- Created server/persistence.ts with SQLite + WAL mode initialization
- Implemented saveState/loadState with custom Map/Set serialization
- Implemented saveVote, saveUser, saveFigTreeResponse functions
- Created server/backup.ts for manual backup/restore functionality
- Added listBackups, pruneBackups, createAndPruneBackup utilities
- Added comprehensive test coverage (40 tests covering all persistence operations)
- Updated better-sqlite3 to support Node 24

**Implications:**
- Every state change is immediately written to SQLite (not periodic)
- WAL mode enables concurrent reads during writes for better performance
- Backup files are human-readable JSON for emergency recovery
- Tests verify Map/Set serialization works correctly (crucial for state integrity)
- Foreign key constraints ensure referential integrity (shows must exist before users/votes)

---

## [2024-XX-XX] — Next.js with Custom Server Architecture

**Context:** WebSocket support is required for real-time updates. Next.js API routes don't support persistent WebSocket connections, so we need a custom server. For a ~30 person live performance, a single process is simpler to deploy, monitor, and recover.

**Changes:**
- Restructured from monorepo (packages/) to single Next.js app with custom server
- Moved conductor to `/conductor` (top-level, still pure logic)
- Server code in `/server` (custom Node.js server wrapping Next.js + Socket.IO)
- Pages in `/app` (Next.js App Router)
- Components, hooks, lib at top level
- Single package.json with all dependencies
- Added tsconfig.server.json for server-side TypeScript
- Added db/schema.sql for SQLite schema
- Renamed project to "Yggdrasil"

**Implications:**
- `npm run dev` starts custom server (not `next dev`)
- Single process serves HTTP, WebSocket, and static assets
- Development workflow: edit code → server auto-restarts via ts-node

---

## [2024-XX-XX] — Recovery & Robustness Hardening

**Context:** This system runs during live performances. Failures must be recoverable without losing show state or requiring audience to rejoin.

**Changes:**
- Added `version` and `lastUpdated` fields to `ShowState` for sync verification
- Added `StoredClientIdentity` interface for client-side reconnection data
- Added recovery commands: `USER_RECONNECT`, `RESET_TO_LOBBY`, `IMPORT_STATE`, `FORCE_RECONNECT_ALL`
- Added recovery events: `STATE_SYNC`, `USER_RECONNECTED`, `FORCE_RECONNECT`, `SHOW_RESET`
- Documented persistence strategy: persist on every state change, atomic writes, WAL mode
- Documented heartbeat system for disconnect detection
- Documented backup snapshot system with rolling window
- Documented controller emergency actions: pause, resume, reset, export/import state
- Documented recovery scenarios and testing checklist

**Implications:**
- Server must enable SQLite WAL mode
- Clients must store identity in localStorage and handle reconnection flow
- Controller UI needs emergency controls section
- Should test recovery scenarios before each performance

---

## [2024-XX-XX] — Configurable Audition Loops

**Context:** Each option should loop multiple times during audition so the audience can absorb it. Default is 2 loops, but should be configurable.

**Changes:**
- Added `auditionLoopsPerOption` to `TimingConfig` (default: 2)
- Updated default-show.json with new timing field

**Implications:**
- Audition phase duration = `auditionLoopsPerOption × auditionPerOptionMs × 4 options`
- Can be adjusted based on musical content and pacing needs

---

## [2024-XX-XX] — Dual Path Tracking (Faction vs Popular)

**Context:** The personal vote needed immediate feedback to feel meaningful, but without revealing the individual-level finale twist. Solution: track and display a "popular path" alongside the faction path.

**Changes:**
- Added `DualPaths` interface tracking `factionPath` and `popularPath`
- Added `paths` field to `ShowState`
- Updated `RevealPayload` with `popularVote` info (optionId, voteCount, divergedFromFaction)
- Added `PATHS_UPDATED` event
- Updated `ROW_COMMITTED` event to include `popularOptionId`
- Added `FINALE_POPULAR_SONG` event
- Updated `AudioAdapter` with `playPopularPath()` method
- Projector now shows dual paths: solid (faction) and ghost (popular)
- Finale structure: popular path song → individual timelines

**Implications:**
- Projector visualization needs to render two paths with different styles
- Reveal display should show divergence: "Faction chose A. The room wanted C."
- Finale has a new phase for playing the popular path before individual timelines

---

## [2024-XX-XX] — Coherence Tie Handling

**Context:** When factions have identical weighted coherence, the system needs a fair and theatrical way to resolve ties.

**Changes:**
- Added `TieInfo` interface with `occurred` and `tiedFactionIds`
- Added `tie` field to `RevealPayload`
- Added `TIE_DETECTED` and `TIE_RESOLVED` events
- Added `tiebreaker` state to `ProjectorClientState`
- Tie resolution uses fully random selection (not seeded)

**Implications:**
- Projector needs tiebreaker animation (e.g., spinning wheel)
- Reveal flow: show coherence → if tie, animate tiebreaker → reveal winner
- Controller can see tie occurring but cannot influence outcome

---

## [2024-XX-XX] — Lobby Experience with Fig Tree Prompt

**Context:** The show draws on the "Fig Tree" metaphor from Sylvia Plath's The Bell Jar—the paralysis of unlimited potential, the inability to commit to a path. Rather than explaining this during the performance, the lobby phase can prime the audience with this context.

**Changes:**
- Projector displays configurable text content during lobby (operator provides excerpt)
- Audience UI shows prompt during lobby: "What lives on your fig tree?" (configurable)
- Renamed `parallelLifeText` → `figTreeResponse` throughout
- Removed `finale_setup` phase; text is now collected during lobby
- Added `LobbyConfig` to ShowConfig with `projectorContent` and `audiencePrompt`
- Updated persistence table: `parallel_texts` → `fig_tree_responses`

**Implications:**
- Operator must source and provide the excerpt text (copyright)
- Audience has more time to reflect and write thoughtful responses
- Lobby becomes a meaningful part of the experience, not just waiting

---

## [2024-XX-XX] — Seat-Aware Faction Assignment

**Context:** Factions should be distributed to minimize same-faction adjacency, encouraging cross-faction communication. This requires knowing the seating layout before assignment happens.

**Changes:**
- Added `SeatId` type and `seatId` field to User
- User.faction is now nullable (null until assignment phase)
- Added `assigning` to ShowPhase (for reveal animation)
- Added `SeatTopologyConfig` and `AdjacencyGraph` types
- Added `topology` field to ShowConfig
- Added `ASSIGN_FACTIONS` command and `FACTIONS_ASSIGNED` / `FACTION_ASSIGNED` events
- Updated join flow: users join with seatId from QR code, wait for assignment
- Documented assignment algorithm (balance as hard constraint, adjacency as soft optimization)
- Documented late-join logic (smallest faction, adjacency as tiebreaker)

**Implications:**
- Seat-specific QR codes needed for venue setup
- Controller needs seat map visualization
- Client needs "waiting" state and faction reveal animation
- Topology providers are pluggable for different venue types

---

## [2024-XX-XX] — Options Decoupled from Factions

**Context:** Musical options should be ambiguous—not tied to specific factions. The 4-4 parallelism is thematic, not mechanical.

**Changes:**
- Removed `factionId` from Option and OptionConfig interfaces
- Added `index` (0–3) to Option for position within row
- Updated coherence documentation to clarify factions win by aligning on ANY option
- Added concrete example of coherence calculation

**Implications:**
- Options can be designed musically without faction constraints
- Coherence is purely about internal faction agreement, not loyalty to designated options

---

## [2024-XX-XX] — Initial Architecture

**Context:** Establishing the foundational architecture for the interactive performance system based on design discussions.

**Changes:**
- Created ARCHITECTURE.md with complete system specification
- Defined data models: User, Faction, Row, Vote, PersonalTree, ShowState
- Specified Conductor state machine with commands and events
- Documented WebSocket protocol for client-server communication
- Outlined persistence layer using SQLite
- Defined AudioAdapter interface with NullAdapter for MVP
- Established folder structure for monorepo

**Implications:**
- All implementation should follow the types and interfaces defined
- Future audio backends will implement the AudioAdapter interface
- State machine logic lives in the conductor package (pure, testable)

---

<!-- Template for new entries:

## [YYYY-MM-DD] — Brief descriptive title

**Context:** Why is this change happening? What problem does it solve or what need does it address?

**Changes:** 
- Bullet points of what was modified
- Reference specific files when helpful

**Implications:** 
- What else might need to change as a result?
- What should future developers be aware of?

-->

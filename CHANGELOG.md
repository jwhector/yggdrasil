# Changelog

All notable changes to the Yggdrasil system. Each entry explains **why** a change was made, not just what changed.

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

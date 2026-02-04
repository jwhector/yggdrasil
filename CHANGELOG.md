# Changelog

All notable changes to the Yggdrasil system. Each entry explains **why** a change was made, not just what changed.

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

# CHANGELOG

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

# V3.4 "Token Pool" Migration Plan

> Implements `v34-MIGRATION-SPEC.md`. Two workstreams: chapter identity refactor (codebase-wide) and finale system replacement. Song-building is unchanged.

---

## Pre-Migration Snapshot

- **377 tests** passing across 13 suites
- Current finale phases: `finale_elegy` -> `finale_assignment` -> `finale_preview` -> `finale_playback`
- `Chapter` type: `'ambition' | 'love' | 'avoidance'` (union)
- `ChapterConfig.id`: typed as `Chapter` (the union)
- 44 files reference `Chapter`, `'ambition'`, `'love'`, or `'avoidance'`

---

## Phase 1: Chapter Identity Refactor (Types + Conductor)

**Goal:** Make `Chapter` a `string` type. Replace all hardcoded chapter name references with config-driven lookups. No behavioral changes.

**Scope:** `conductor/types.ts`, `conductor/`, `lib/identity.ts`, `config/default-show.json`

### 1a. Widen the Chapter type

- `conductor/types.ts`:
  - Change `type Chapter = 'ambition' | 'love' | 'avoidance'` to `type Chapter = string`
  - Change `ChapterConfig.id` from `Chapter` to `string` (or keep as `Chapter` since it's now `string`)
  - Add `ChapterConfig` to the V3.4 spec shape: `{ id: string; label: string; color: string; songIndex: number }` — **keep existing fields** (`colorA`, `colorB`, `icon`) for backward compat; add `songIndex` field per spec
  - `GranularFragment.chapter`: already `Chapter`, now `string` — no change needed
  - `QuiltCell.chapter`: already `Chapter | null`, now `string | null` — no change needed
  - `AttemptState.chapter`, `AttemptConfig.chapter`, `V32AttemptConfig.chapter`, `AttemptResult.chapter`, `Fragment.chapter`, `IntrusiveThoughtsConfig.chapter`: all become `string`

### 1b. Update conductor modules

- `conductor/conductor.ts`: Verify no string-literal chapter comparisons. The conductor references `chapter` from config, which already flows through as values. Search for any `=== 'ambition'` etc.
- `conductor/fragments.ts`: Uses `chapter` from `AttemptResult` — should already be config-driven. Verify no hardcoded chapter names.
- `conductor/intrusive-thoughts.ts`: `IntrusiveThoughtsConfig.chapter` — verify lookup is by value, not hardcoded.
- `conductor/quilt.ts`, `conductor/quilt-arc.ts`, `conductor/assignment.ts`: These will be removed in Phase 4, but chapter references should still compile after type change. Quick scan only.

### 1c. Update config

- `config/default-show.json`:
  - Add `chapters` array with `songIndex` field per spec: `[{ "id": "chapter_0", "label": "Courage", ... "songIndex": 0 }, ...]`
  - **Keep** existing `"chapter": "ambition"` in attempt configs for now — these are string values, not types. Update to `"chapter": "chapter_0"` in Phase 1d.
  - Or: keep `"ambition"` as the chapter ID — the spec says IDs are `chapter_0`, `chapter_1`, `chapter_2`, but the important thing is they're config-driven strings. **Decision: use the spec's `chapter_0/1/2` IDs** to make a clean break.

### 1d. Update attempt config chapter references

- `config/default-show.json`: Change `"chapter": "ambition"` to `"chapter": "chapter_0"`, `"love"` to `"chapter_1"`, `"avoidance"` to `"chapter_2"` in all attempt configs.
- Update `IntrusiveThoughtsConfig` entries similarly.
- Update chapter identity in `chapters` config array — labels become `"Courage"`, `"Love"`, `"Acceptance"` per spec (or keep current labels and let the performer change them later — the point is they're config-driven).

### 1e. Update identity system

- `lib/identity.ts`:
  - Hardcoded fallback `chapterLookup` keys: `'ambition'`, `'love'`, `'avoidance'` — update to `'chapter_0'`, `'chapter_1'`, `'chapter_2'` (or remove hardcoded fallbacks entirely since `hydrateIdentity()` populates from config).
  - Function signatures already accept `Chapter | string` — after the type change, these just accept `string`.

### 1f. Update components (chapter references in UI)

These files reference `Chapter` type or hardcoded chapter names:

- `components/song-building/OptionCards.tsx`
- `components/song-building/MiniSkeleton.tsx`
- `components/song-building/LayerProgress.tsx`
- `components/song-building/LayerDots.tsx`
- `components/song-building/IntrusiveThoughts.tsx`
- `components/song-building/AuditionBars.tsx`
- `components/song-building/RevealSequence.tsx`
- `components/projector/useProjectorState.ts`
- `components/projector/renderers/shared.ts`
- `components/finale/ElegyGrid.tsx`
- `components/finale/QuiltGrid.tsx`, `QuiltPreview.tsx`, `QuiltRemix.tsx`
- `components/controller/ShowControls.tsx`
- `components/controller/QuiltRemixControls.tsx`
- `app/globals.css`

**Approach:** `grep` for `'ambition'`, `'love'`, `'avoidance'` as string literals. Replace with config lookups via `getChapterIdentity(chapterId)`. Most components already use the identity system — verify they don't have hardcoded fallbacks.

### 1g. Update tests

- All test files that construct state with `chapter: 'ambition'` etc. — update to `chapter: 'chapter_0'` etc.
- Files: `conductor/__tests__/conductor.test.ts`, `conductor/__tests__/fragments.test.ts`, `conductor/__tests__/quilt.test.ts`, `conductor/__tests__/quilt-arc.test.ts`, `server/__tests__/timing.test.ts`, `server/__tests__/persistence.test.ts`, `server/__tests__/backup.test.ts`, `server/__tests__/audio-router.test.ts`

### 1h. Update server layer

- `server/socket.ts`: Chapter references in state filtering (`filterStateForClient`). These reference `chapter` fields on state objects — should be transparent after type change. Verify no hardcoded names.
- `server/persistence.ts`: Stores state as JSON — transparent.
- `server/audio-router.ts`: Maps audio cues to OSC. Verify no chapter-name logic.

### Tests

Run full suite. All 377 tests should pass (with updated chapter ID strings). No behavioral changes.

### PR: "Refactor chapter identity from hardcoded union to config-driven string"

---

## Phase 2: V3.4 Finale Types & Interfaces

**Goal:** Define all V3.4 types in `conductor/types.ts`. No behavioral changes — types only.

### 2a. New show phase values

- Add `'finale_vote'` and `'finale_remix'` to `ShowPhase` union.
- **Keep** `'finale_elegy'`, `'finale_assignment'`, `'finale_preview'`, `'finale_playback'` temporarily (existing code still references them). Mark with `// V3.3 — remove in Phase 6`.

### 2b. V34FinaleState

Add new type alongside `V33FinaleState` (additive, per R21 pattern):

```typescript
interface V34FinaleState {
  phase: 'vote' | 'remix';
  vote: {
    questionsAnsweredByUser: Map<UserId, number>;
    maxQuestionsPerPerson: number;
    poolCapReached: boolean;
  };
  pool: {
    tokens: Token[];
    availableByChapter: Map<string, number>;
    totalByChapter: Map<string, number>;
    totalRemaining: number;
    targetPoolSize: number;
  };
  queue: Map<string, QueuedToken[]>;
  active: Map<string, ActiveNode>;
  audienceInteraction: boolean;
  trackMap: Map<string, Map<number, number[]>>;
  loopCount: number;
  loopProgress: number;
  npc: { currentMessage: string | null };
}

interface Token {
  id: string;
  ownerId: UserId;
  chapterId: string;
  questionIndex: number;
  status: 'available' | 'queued' | 'playing' | 'spent';
}

interface QueuedToken {
  tokenId: string;
  chapterId: string;
  queuedAt: number;
}

interface ActiveNode {
  tokenId: string;
  chapterId: string;
  startedAtLoop: number;
  trackIndex: number;
  persistent: boolean;
}
```

### 2c. V34FinaleConfig

```typescript
interface V34FinaleConfig {
  bothOptionsSurvive: boolean;
  audioPreviewPath: string;
  npcMessages: NpcMessageConfig[];
  vote: VotePhaseConfig;
  remix: RemixConfig;
}

interface VotePhaseConfig {
  questions: QuestionConfig[];
  shuffleQuestions: boolean;
  targetPoolSize: number;
  questionDelayMs: number;
  revealPoolOnProjector: boolean;
}

interface QuestionConfig {
  text: string;
}

interface RemixConfig {
  audienceInteraction: boolean;
}
```

### 2d. V3.4 Conductor Commands

Add new commands alongside existing ones:

```typescript
// Vote phase
| { type: 'START_VOTE' }
| { type: 'SUBMIT_EMOTION'; userId: UserId; chapterId: string; questionIndex: number }
| { type: 'REQUEST_NEXT_QUESTION'; userId: UserId }
| { type: 'POOL_CAP_REACHED' }

// Remix phase
| { type: 'START_REMIX' }
| { type: 'QUEUE_TOKEN'; granularType: string; chapterId: string; instant?: boolean }
| { type: 'CANCEL_QUEUE'; granularType: string }
| { type: 'TOGGLE_AUDIENCE_INTERACTION' }
| { type: 'LOOP_BOUNDARY' }

// Manual end
| { type: 'END_SHOW' }
```

### 2e. V3.4 Conductor Events

Add new events alongside existing ones:

```typescript
// Vote
| { type: 'VOTE_STARTED' }
| { type: 'EMOTION_RECEIVED'; userId: UserId; chapterId: string; questionIndex: number; poolSize: number }
| { type: 'NEXT_QUESTION'; userId: UserId; questionIndex: number; questionText: string }
| { type: 'POOL_CAP_REACHED'; finalPoolSize: number }
| { type: 'POOL_READY'; pool: TokenPool }

// Remix
| { type: 'REMIX_STARTED'; pool: TokenPool }
| { type: 'TOKEN_QUEUED'; granularType: string; chapterId: string; queueDepth: number }
| { type: 'TOKEN_CANCELLED'; granularType: string; chapterId: string; returnedToPool: boolean }
| { type: 'TOKEN_ACTIVATED'; granularType: string; chapterId: string; tokenId: string; trackIndex: number }
| { type: 'TOKEN_SPENT'; granularType: string; tokenId: string; poolRemaining: number }
| { type: 'NODE_SILENT'; granularType: string }
| { type: 'POOL_EMPTY' }

// Audio
| { type: 'AUDIO_CUE'; cue: RemixAudioCue }

// NPC
| { type: 'NPC_MESSAGE'; message: string }
```

### 2f. V3.4 Audio Cues

```typescript
type RemixAudioCue =
  | { type: 'remix_start' }
  | { type: 'node_unmute'; granularType: string; trackIndex: number }
  | { type: 'node_crossfade'; granularType: string; muteTrack: number; unmuteTrack: number }
  | { type: 'node_instant_crossfade'; granularType: string; muteTrack: number | null; unmuteTrack: number }
  | { type: 'node_fade_out'; granularType: string; trackIndex: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }
```

### 2g. Client state types

Add `AudienceVoteView`, `AudienceRemixView`, `ProjectorFinaleV34View` — the filtered state shapes for V3.4 phases. These sit alongside the existing V3.3 client types.

### Tests

Type-only changes — `npx tsc --noEmit` should pass. No runtime tests needed.

### PR: "Add V3.4 token pool types and interfaces"

---

## Phase 3: Conductor Modules (Pure Logic)

**Goal:** Implement the three new conductor modules. Behavior-named tests for each. No server/client wiring yet.

### 3a. `conductor/token-pool.ts` — Pool Management

Functions (all pure, no I/O):
- `createTokenPool(votes: { chapterId: string }[]): TokenPool` — builds pool from vote results
- `consumeToken(pool: TokenPool, chapterId: string): { pool: TokenPool; token: Token | null }` — removes one available token
- `returnToken(pool: TokenPool, chapterId: string): TokenPool` — returns a cancelled token
- `isPoolEmpty(pool: TokenPool): boolean`

Tests (`conductor/__tests__/token-pool.test.ts`):
- `creates pool with correct per-chapter counts from votes`
- `consuming a token decrements available count for that chapter`
- `consuming from empty chapter returns null`
- `returning a token increments available count`
- `pool is empty when all chapters have zero available`
- `total counts remain unchanged after consume and return`

### 3b. `conductor/question-engine.ts` — Vote Phase Logic

Functions:
- `getNextQuestion(config: VotePhaseConfig, answeredCount: number, maxPerPerson: number): QuestionConfig | null` — returns next question or null if done
- `calculateMaxQuestionsPerPerson(targetPoolSize: number, audienceCount: number): number`
- `shouldCapPool(totalTokens: number, targetPoolSize: number): boolean`
- `processEmotion(state: V34FinaleState, userId: UserId, chapterId: string, questionIndex: number): { state: V34FinaleState; events: ConductorEvent[] }`

Tests (`conductor/__tests__/question-engine.test.ts`):
- `returns first question when user has answered none`
- `returns null when user has answered maxQuestionsPerPerson`
- `calculates max questions as ceil(targetPoolSize / audienceCount)`
- `caps pool when total tokens reach target size`
- `accepts answers that arrive after cap (grace period)`
- `shuffles question order per user when shuffleQuestions is true`
- `tracks questions answered per user independently`

### 3c. `conductor/remix-engine.ts` — Queue & Spend Logic

Functions:
- `queueToken(state: V34FinaleState, granularType: string, chapterId: string): { state: V34FinaleState; events: ConductorEvent[] }` — queues a token from pool for next loop boundary
- `cancelQueue(state: V34FinaleState, granularType: string): { state: V34FinaleState; events: ConductorEvent[] }` — cancels last queued token, returns to pool
- `processLoopBoundary(state: V34FinaleState): { state: V34FinaleState; events: ConductorEvent[] }` — fires queued tokens, spends active tokens, detects pool empty
- `toggleAudienceInteraction(state: V34FinaleState): { state: V34FinaleState; events: ConductorEvent[] }` — toggles mode, handles persistent token cleanup
- `resolveTrack(trackMap: Map<string, Map<number, number[]>>, granularType: string, songIndex: number): number[]` — track resolution

Tests (`conductor/__tests__/remix-engine.test.ts`):
- `queuing a token consumes from pool and adds to queue`
- `queuing when chapter pool is empty returns error`
- `cancelling queue returns token to pool`
- `cancelling empty queue is a no-op`
- `loop boundary activates queued tokens and emits TOKEN_ACTIVATED`
- `loop boundary spends active tokens and emits TOKEN_SPENT`
- `active token with queued replacement triggers crossfade`
- `active token with no replacement triggers fade-out and NODE_SILENT`
- `pool empty after last token spent emits POOL_EMPTY`
- `stacking multiple tokens on same node creates queue depth`
- `audience interaction mode: token activates immediately (no loop boundary wait)`
- `audience interaction mode: active token loops indefinitely until overridden`
- `audience interaction mode: new token on occupied node spends old token`
- `disabling audience interaction mode: persistent tokens finish current loop`
- `track resolution uses trackMap[granularType][songIndex]`

### 3d. Wire new modules into conductor.ts

- Add `case 'START_VOTE'`, `case 'SUBMIT_EMOTION'`, `case 'REQUEST_NEXT_QUESTION'`, etc. to `processCommand()`.
- Add `finale_vote` and `finale_remix` to the phase transition logic.
- `ADVANCE_PHASE` from `attempt_build` (attempt 2) or `attempt_resolve` (attempt 2) -> `finale_vote` (instead of `finale_elegy`).
- `ADVANCE_PHASE` from `finale_vote` -> `finale_remix`.
- `ADVANCE_PHASE` from `finale_remix` -> `ended`.
- `END_SHOW` -> `ended` from any finale phase.
- `LOOP_BOUNDARY` -> `processLoopBoundary()`.
- `SETUP_FINALE` -> initializes `V34FinaleState` (instead of `V33FinaleState`).

Tests (`conductor/__tests__/conductor.test.ts` — additions):
- `finale_vote phase accepts SUBMIT_EMOTION commands`
- `finale_vote transitions to finale_remix on START_REMIX`
- `finale_remix transitions to ended when pool is empty`
- `finale_remix transitions to ended on END_SHOW`
- `QUEUE_TOKEN during finale_remix queues token and emits events`
- `LOOP_BOUNDARY processes queue and spend cycle`

### Tests

Run full suite. Existing 377 tests still pass. New tests for the three modules + conductor additions.

### PR: "Implement V3.4 token pool conductor modules"

---

## Phase 4: Server & Socket Layer

**Goal:** Wire V3.4 conductor commands to WebSocket events. Update state filtering for new client views.

### 4a. New WebSocket events (client -> server)

- `submit_emotion` -> `SUBMIT_EMOTION` command (audience, during `finale_vote`)
- `command: QUEUE_TOKEN` -> from projector iPad (drag-and-drop) and controller (button fallback)
- `command: CANCEL_QUEUE` -> from controller
- `command: START_VOTE` -> from controller
- `command: START_REMIX` -> from controller
- `command: TOGGLE_AUDIENCE_INTERACTION` -> from controller
- `command: END_SHOW` -> from controller

### 4b. New WebSocket events (server -> client)

- `question` -> sent to individual audience member (on vote start + after each answer)
- `emotion_confirmed` -> sent to individual audience member after their vote is recorded
- `phones_down` -> sent to audience when pool cap reached or remix starts
- `pool_state` -> broadcast to projector + controller (~2 Hz during vote + remix)
- `node_update` -> broadcast to projector on activation/deactivation

### 4c. Update `filterStateForClient()`

- Add `finale_vote` and `finale_remix` branches.
- Audience in `finale_vote`: current question, chapters, answer count.
- Audience in `finale_remix`: phones down (no active UI needed).
- Projector in `finale_vote`: pool visualization data (token counts by chapter).
- Projector in `finale_remix`: pentagon nodes, pool state, active/queued nodes.
- Controller: full V34FinaleState.

### 4d. Update timing engine

- `server/timing.ts`: `LOOP_BOUNDARY` command needs to fire on Ableton loop boundaries during `finale_remix` (same mechanism as existing quilt column advance, but simpler — just the boundary event).

### 4e. High-frequency broadcasts

- Pool state (~2 Hz during vote and remix): `{ availableByChapter, totalRemaining }`
- Node updates (on change): `{ granularType, chapterId, status }`
- These bypass `state_sync` (per CLAUDE.md pattern for high-frequency data).

### Tests

Existing server tests should pass. New integration patterns tested via conductor tests in Phase 3. Server-layer wiring is tested via manual smoke test and the audience simulator.

### PR: "Wire V3.4 finale WebSocket events and state filtering"

---

## Phase 5: Persistence & Schema

**Goal:** Add V3.4 database tables. Deprecate V3.3 quilt tables.

### 5a. New tables

```sql
-- V3.4: Audience emotional votes
CREATE TABLE IF NOT EXISTS finale_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- V3.4: Token spend log (for recovery + analytics)
CREATE TABLE IF NOT EXISTS finale_token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('queued', 'activated', 'spent', 'cancelled')),
  loop_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

### 5b. Add indexes

```sql
CREATE INDEX IF NOT EXISTS idx_finale_votes_show ON finale_votes(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_token_events_show ON finale_token_events(show_id);
```

### 5c. Deprecate V3.3 tables

Mark `finale_quilt_cells` and `finale_remix_events` as `[DEPRECATED V3.3]` in schema comments. Keep tables in schema for backward compat (existing show data). Do not drop.

### 5d. Update persistence.ts

- Add `saveFinaleVote(showId, userId, chapterId, questionIndex)` function.
- Add `saveTokenEvent(showId, tokenId, granularType, chapterId, eventType, loopNumber)` function.
- These are called from `server/socket.ts` when the conductor emits the corresponding events.

### Tests

`server/__tests__/persistence.test.ts`: Add tests for new persistence functions.

### PR: "Add V3.4 persistence tables and save functions"

---

## Phase 6: Client Components & Hooks

**Goal:** Build the V3.4 UI. New components for vote and remix phases. Update projector and controller.

### 6a. New hooks

- `hooks/useTokenPool.ts` — subscribes to `pool_state` socket event, provides `{ availableByChapter, totalRemaining }`.
- `hooks/useRemixQueue.ts` — controller queue management: sends `QUEUE_TOKEN`, `CANCEL_QUEUE` commands, tracks local queue state for optimistic UI.
- `hooks/useDragToken.ts` — iPad touch drag state: active dot tracking, drag position, drop target detection via `touchstart`/`touchmove`/`touchend`. CSS `touch-action: none`.

### 6b. New components

- `components/finale/EmotionVote.tsx` — audience vote cards. Shows current question text + 3 tappable chapter cards. Sends `submit_emotion` on tap. Shows "phones down" when pool cap reached.
- `components/finale/TokenPool.tsx` — projector: floating dots canvas (`requestAnimationFrame` render loop). Colored dots per chapter. Dots bloom on creation, shrink/absorb into pentagon on spend. This is the drag source during remix.
- `components/finale/PentagonRemix.tsx` — projector: pentagon nodes (6 positions). Drop targets during remix. Shows active chapter color, loop progress ring, queue depth indicator.
- `components/finale/ProjectorFinale.tsx` — projector: composes `TokenPool` + `PentagonRemix`. Manages touch interaction layer (enabled only during `finale_remix` on touch devices). Screen wake lock.
- `components/finale/RemixController.tsx` — controller fallback: 6x3 button grid (granular types x chapters). Pool counters. Queue depth badges. Active node indicators. Audience interaction toggle.

### 6c. Update existing pages

- `app/audience/page.tsx`: Add `finale_vote` phase rendering -> `EmotionVote` component. `finale_remix` -> "phones down" display.
- `app/projector/page.tsx`: Add `finale_vote` and `finale_remix` phase rendering -> `ProjectorFinale` component.
- `app/controller/page.tsx`: Add `finale_vote` and `finale_remix` phase rendering -> `RemixController` component. Add phase advance buttons for vote->remix->ended transitions.

### 6d. Update controller show controls

- `components/controller/ShowControls.tsx`: Update phase transition buttons — `finale_vote` and `finale_remix` replace the V3.3 quilt phases. "Start Vote", "Start Remix", "End Show" buttons.

### Tests

Component tests are not required (per project convention — conductor tests cover logic). Manual testing via audience simulator + dev server.

### PR: "Add V3.4 vote and remix client components"

---

## Phase 7: Audio Router & OSC

**Goal:** Map V3.4 audio cues to OSC commands.

### 7a. New audio cue handlers in `server/audio-router.ts`

- `remix_start` -> transport play + reset beat counter
- `node_unmute` -> unmute track at trackIndex (gain swell)
- `node_crossfade` -> fade out muteTrack + fade in unmuteTrack (quantized to `crossfadeBeats`)
- `node_instant_crossfade` -> immediate crossfade (no loop boundary wait) for audience interaction mode
- `node_fade_out` -> fade track to silence over `crossfadeBeats`
- `transport` -> play/stop
- `panic` -> hard mute all

### 7b. Transport reset

Per spec: "reset transport to beat 0 on finale" — send transport stop + play at remix start to reset Ableton's position.

### Tests

`server/__tests__/audio-router.test.ts`: Add tests for new cue types -> OSC message mapping.

### PR: "Add V3.4 remix audio cue routing"

---

## Phase 8: Cleanup & Documentation

**Goal:** Remove V3.3 quilt code. Update docs to V3.4.

### 8a. Remove conductor modules

- `conductor/quilt.ts` -> DELETE
- `conductor/quilt-arc.ts` -> DELETE
- `conductor/assignment.ts` -> DELETE
- `conductor/__tests__/quilt.test.ts` -> DELETE
- `conductor/__tests__/quilt-arc.test.ts` -> DELETE
- Remove quilt/assignment imports and cases from `conductor/conductor.ts`
- Remove quilt/arc exports from `conductor/index.ts`

### 8b. Remove V3.3 finale phases from ShowPhase

- Remove `'finale_elegy'`, `'finale_assignment'`, `'finale_preview'`, `'finale_playback'` from `ShowPhase`.
- Update all references (conductor transitions, socket filtering, component routing).

### 8c. Remove V3.3 finale types

- Remove `V33FinaleState`, `V33FinaleConfig`, `QuiltConfig`, `QuiltCell`, `ArcConfig`, `ArcState`, `ArcSchedule`, `ArcPhase`, `SortMode`, `SongEnergyProfile`, `RowGroupSchedule`, `AudienceRemixConfig`.
- Remove V3.3-only `AudioCue` variants: `quilt_playback_start`, `quilt_column_change`, `quilt_reorder`, `quilt_mute_cell`, `quilt_unmute_cell`, `quilt_row_unmute`, `quilt_row_mute`.
- Remove V3.3-only `ConductorCommand` variants: all quilt/assignment/preview/playback/arc commands.
- Remove V3.3-only `ConductorEvent` variants: all quilt/assignment/preview/playback/arc events.
- Rename `V34FinaleState` -> `FinaleState`, `V34FinaleConfig` -> `FinaleConfig` (drop version prefix).

### 8d. Remove client components

- `components/finale/QuiltGrid.tsx` -> DELETE
- `components/finale/QuiltPreview.tsx` -> DELETE
- `components/finale/QuiltRemix.tsx` -> DELETE
- `components/finale/ElegyGrid.tsx` -> DELETE (elegy phase removed)
- `components/controller/QuiltRemixControls.tsx` -> DELETE
- `hooks/useQuilt.ts` -> DELETE

### 8e. Remove V3.3 socket events

- Remove `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell`, `change_song` handlers from `server/socket.ts`.
- Remove `quilt_state`, `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered` broadcasts.

### 8f. Keep for now

- `conductor/fragments.ts` -> KEEP (spec says "still needed if elegy is ever re-added")
- `components/finale/NpcDisplay.tsx` -> KEEP (NPC system unchanged)
- `components/finale/LoopIndicator.tsx` -> KEEP (reusable for remix loop progress)

### 8g. Update documentation

- `ARCHITECTURE.md`: Update show phase state machine, phase details, terminology, folder structure. Add Appendix F for V3.3 -> V3.4 changes.
- `docs/finale.md`: Complete rewrite to V3.4 spec (token pool model, vote phase, remix phase).
- `docs/data-models.md`: Update types, commands, events to V3.4.
- `docs/server-protocol.md`: Update WebSocket events and persistence schema.
- `docs/client-routes.md`: Update finale UI specs.
- `docs/audio-engine.md`: Update audio cues for remix.
- `DECISIONS.md`: Add resolved decisions for V3.4 (token pool model, chapter identity refactor, etc.).
- `CLAUDE.md`: Update project structure, common patterns, phase state machine.
- `CHANGELOG.md`: Add V3.4 migration entries.

### 8h. Config cleanup

- `config/default-show.json`:
  - Replace `finale.quilt` config with `finale.vote` + `finale.remix` config.
  - Add `questions` array to vote config.
  - Remove arc config.

### Tests

Run full suite. Removed tests are expected. New test count should be stable (Phase 3 tests replace removed quilt/arc tests).

### PR: "Remove V3.3 quilt code, update docs to V3.4"

---

## Phase Summary

| Phase | Scope | Key Risk | Tests |
|-------|-------|----------|-------|
| 1. Chapter Identity | Types + all references | Wide blast radius (44 files) but mechanical | All 377 pass |
| 2. V3.4 Types | `conductor/types.ts` only | None (additive) | Type-check only |
| 3. Conductor Modules | 3 new files + conductor.ts | Core logic correctness | ~30 new tests |
| 4. Server/Socket | `server/socket.ts`, `server/timing.ts` | Event wiring | Manual smoke test |
| 5. Persistence | `db/schema.sql`, `server/persistence.ts` | Schema migration | ~5 new tests |
| 6. Client Components | 5 new components, 3 hooks | Touch interaction, canvas perf | Manual testing |
| 7. Audio Router | `server/audio-router.ts` | OSC correctness | ~10 new tests |
| 8. Cleanup | Remove V3.3, update docs | Nothing breaks after removal | Full suite stable |

---

## Open Questions (from spec — do NOT invent answers)

- [ ] Autopilot mode design (TBD)
- [ ] AirPlay latency testing with actual hardware
- [ ] Live audience interaction during remix (optional, additive)
- [ ] Floating token dot visual design (physics, drift, clustering)
- [ ] NPC message library for V3.4 phases
- [ ] Question bank (performer needs to author 10-15 minimum)
- [ ] Whether performer sees token ownership (probably not)
- [ ] Audio reactivity for pentagon nodes during remix
- [ ] Minimum token count for small audiences
- [ ] Pause/resume during remix
- [ ] iPad model requirements for canvas performance

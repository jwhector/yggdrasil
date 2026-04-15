# Finale System — Detailed Mechanics (V3.4 — "Swarm Orbs")

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (chapter/song structure), [data-models.md](data-models.md) (conductor commands/events)

---

## Overview

The finale has two sub-phases:
1. **Vote** — audience answers emotional questions on their phones; each answer generates a personal **orb** that flies up and floats on screen
2. **Remix** — the audience drags their orbs onto pentagon nodes to collectively shape the music; the performer has override controls

## Core Concept: Personal Orbs

Each audience member generates up to 6 personal orbs during the vote phase (one per answered question). Each orb is tied to a chapter (Ambition, Love, or Acceptance). During the remix phase, the audience places their orbs on **pentagon nodes** (bass, drums, pad, harmony, fx, seed). The dominant chapter per node determines which song's material plays — the audience collectively sculpts the remix through their orb placements.

The performer has override controls: lock nodes to specific chapters, scatter orbs back to hands, adjust decay rates, and trigger a fallback to performer-only mode if needed.

## Narrative Setup

After Song 3's resolution, the performer "abandons" the stage. NPC message: *"He's gone. We need to do this ourselves."* The audience generates the raw material (orbs) through emotional reflection, then collectively shapes it into a final song.

## Phase 1: Vote (`finale_vote`)

Audience members answer emotional questions on their phones. Each answer generates a personal orb that visually flies upward from the answer card and floats near the top of the screen.

### Question Flow

1. Each audience member sees one question at a time (e.g., "What does he need to hear?")
2. Questions served from `VotePhaseConfig.questions` question bank
3. Each answer maps to a chapter and generates a token in the pool + a personal orb on the user's phone
4. After answering, the next question is delivered via the `question` event
5. Each person can answer up to `min(maxQuestionsPerPerson, orbsPerPerson)` questions (capped at 6 by default)
6. When the pool reaches `targetPoolSize`, `poolCapReached` becomes true and phones go dark

### Orb Fly Animation

When the user taps an answer card:
1. The OrbCard's two orbiting orbs spiral inward and fly upward (1100ms animation)
2. At animation end, a persistent **FloatingOrb** spawns at a random position near the top of the screen
3. The FloatingOrb uses projector-style 3-layer radial gradient glow (outer haze, mid glow, bright core)
4. The orb springs to a "home" position in a scattered row and gently wobbles there
5. Orbs accumulate visually as more questions are answered (up to 6 floating orbs)

### Persistent Orbs Across Phases

The floating orb layer is managed by `useFloatingOrbs` at the page level (`app/audience/page.tsx`). Orbs persist across the vote → remix transition with no visual discontinuity — the pentagon fades in beneath existing orbs.

## Phase 2: Remix (`finale_remix`)

The audience drags their personal orbs onto pentagon nodes to shape the music. The dominant chapter per node determines which song's material plays.

### Pentagon Structure

5 granular type nodes + 1 seed node arranged as a pentagon:
- **Bass**, **Drums**, **Pad**, **Harmony**, **FX**, **Seed** (center)

### Audience Orb Placement

Each audience member has up to 6 personal orbs. During remix:
1. Orbs float in a scattered row near the top of the phone screen (projector-style glow rendering)
2. User touches an orb to begin dragging → orb follows finger, pentagon nodes highlight on hover
3. Drop on a node → orb shrinks and settles at the node position; `place_orb` emitted to server
4. Drop in empty space → orb springs back to its home position; if it was placed, `recall_orb` emitted
5. Free stacking: all 6 orbs can go on the same node if desired

### Node Tally & Dominant Chapter

Each node tallies all audience orbs by chapter:
- The chapter with the most orbs on a node is the **dominant chapter**
- Tie → incumbent stays (stability)
- The dominant chapter's material plays for that granular type
- **Tally visualization:** 3 fixed-angle polar wedges (120 degrees each) extend radially proportional to vote count

### Crossfade Modes

Two modes, togglable live from the controller:

**Loop-quantized (default, `instantCrossfade: false`):**
At each loop boundary, for each node: if the dominant chapter changed → crossfade to new chapter's material (beat-locked via `node_crossfade` audio cue).

**Instant (`instantCrossfade: true`):**
On every `place_orb` / `recall_orb`: if the dominant chapter changed → immediate crossfade (via `node_instant_crossfade` audio cue).

### Orb Decay

Placed orbs decay after `orbDecayLoops` loops (configurable, default 3 = ~48s):
- Orbs return to the user's floating row when they expire
- Server emits `orb_decayed` → phone vibrates → orb springs back to home position
- Decay rate adjustable live from controller (0 = no decay)

### Performer Scatter

The performer can force all orbs off a node (or all nodes) via the controller:
- `SCATTER_NODE { granularType }` — return all orbs on that node
- `SCATTER_ALL` — return all placed orbs on all nodes
- Affected users receive `scatter` event → orbs return to floating positions with haptic feedback

### Node Locking

The performer can lock a node to a specific chapter (ignores vote tally):
- `LOCK_NODE { granularType, chapterId }` — lock icon appears on audience phones
- `UNLOCK_NODE { granularType }` — tally-based dominant chapter resumes
- Locked nodes still accept orb placement (orbs are just ignored for audio)

### Fallback Mode

If the audience interaction goes wrong, the performer can trigger `FALLBACK_PERFORMER_REMIX`:
- All audience phones show "LISTEN" (phones down)
- Performer uses the projector's drag-token interface directly
- Tokens generated from persisted audience vote answers

### Audio Behavior

- **Track resolution:** Dominant chapter → songIndex (via `chapterSongIndex` map) → `trackMap[granularType][songIndex]` → Ableton track indices
- **Audio cues emitted by `emitTallyCrossfades()`** in conductor.ts:
  - `node_unmute` — first activation (no previous chapter playing)
  - `node_crossfade` / `node_instant_crossfade` — chapter change
  - `node_fade_out` — all orbs removed, node goes silent
- **Loop-quantized timing:** Ableton as source of truth via OSC beat events

### Performer Controls (Controller UI)

The `RemixController` component includes a `SwarmControls` section:
- **Decay rate slider** (0–8 loops) — `SET_DECAY_RATE` command
- **Crossfade mode toggle** (instant / loop-quantized) — `SET_CROSSFADE_MODE` command
- **Scatter buttons** (per-node + all) — `SCATTER_NODE` / `SCATTER_ALL` commands
- **Lock/unlock per node** with chapter selector — `LOCK_NODE` / `UNLOCK_NODE` commands
- **Performer fallback button** with confirmation — `FALLBACK_PERFORMER_REMIX` command
- Plus the existing token grid, audience interaction toggle, inject tokens (testing)

## State

### FinaleState (audience remix fields)

```typescript
// Added to FinaleState alongside existing pool/queue/active fields:
audienceOrbs: Map<UserId, UserRemixState>;  // Per-user orb state
nodeTallies: Map<string, NodeVoteTally>;    // Per-node aggregate tally
orbDecayLoops: number;                       // Current decay rate (live-adjustable)
instantCrossfade: boolean;                   // Current crossfade mode
fallbackMode: boolean;                       // True when performer has taken over
```

### UserRemixState

```typescript
interface UserRemixState {
  userId: UserId;
  orbs: AudienceOrb[];   // One per answered question (up to orbsPerPerson)
}

interface AudienceOrb {
  index: number;              // 0-5
  chapterId: string;          // From their vote answer
  placedOnNode: string | null; // granularType if placed, null if in hand
  placedAtLoop: number;       // Loop count when placed (for decay)
}
```

### NodeVoteTally

```typescript
interface NodeVoteTally {
  granularType: string;
  votes: Map<string, number>;      // chapterId → count
  dominantChapter: string | null;   // Highest count wins (tie = incumbent)
  locked: boolean;
  lockedChapter: string | null;
}
```

## Config

```typescript
interface RemixConfig {
  audienceInteraction: boolean;  // Default mode
  orbsPerPerson: number;         // Max orbs per person (default: 6)
  orbDecayLoops: number;         // Default decay rate (default: 3, 0 = no decay)
  tallyBroadcastMs: number;      // Tally broadcast interval (default: 500)
  instantCrossfade: boolean;     // Default crossfade mode
}
```

## Conductor Commands (Audience Remix)

```typescript
// Audience → server (via socket events, userId from session)
| { type: 'PLACE_ORB'; userId: UserId; orbIndex: number; granularType: string }
| { type: 'RECALL_ORB'; userId: UserId; orbIndex: number }

// Controller → server (via command channel)
| { type: 'SET_DECAY_RATE'; loops: number }
| { type: 'SET_CROSSFADE_MODE'; instant: boolean }
| { type: 'SCATTER_NODE'; granularType: string }
| { type: 'SCATTER_ALL' }
| { type: 'LOCK_NODE'; granularType: string; chapterId: string }
| { type: 'UNLOCK_NODE'; granularType: string }
| { type: 'FALLBACK_PERFORMER_REMIX'; instant?: boolean }
```

## Conductor Events (Audience Remix)

```typescript
| { type: 'ORB_PLACED'; userId; orbIndex; granularType; chapterId }
| { type: 'ORB_RECALLED'; userId; orbIndex; granularType; chapterId }
| { type: 'ORB_DECAYED'; userId; orbIndex; granularType }
| { type: 'NODE_TALLY_CHANGED'; granularType; dominantChapter; votes }
| { type: 'NODE_LOCKED'; granularType; chapterId }
| { type: 'NODE_UNLOCKED'; granularType }
| { type: 'NODES_SCATTERED'; granularType; affectedUsers }
| { type: 'DECAY_RATE_CHANGED'; loops }
| { type: 'CROSSFADE_MODE_CHANGED'; instant }
| { type: 'FALLBACK_ACTIVATED'; instant }
```

## WebSocket Events

### Client → Server

| Event | Payload | Sender |
|-------|---------|--------|
| `submit_emotion` | `{ chapterId, questionIndex }` | Audience (vote phase) |
| `place_orb` | `{ orbIndex, granularType }` | Audience (remix phase) |
| `recall_orb` | `{ orbIndex }` | Audience (remix phase) |

### Server → Client

| Event | Payload | Recipients |
|-------|---------|------------|
| `question` | `{ questionIndex, text, answers, chapters }` | Individual audience member |
| `emotion_confirmed` | `{ chapterId, questionIndex }` | Individual audience member |
| `phones_down` | -- | Audience (pool cap reached or fallback) |
| `node_tally` | `{ tallies }` | Projector + controller + audience (~2 Hz) |
| `orb_decayed` | `{ orbIndex, granularType }` | Individual audience member |
| `scatter` | `{ granularType }` | Affected audience members |
| `pool_state` | `{ availableByChapter, totalRemaining, loopProgress }` | Projector + controller (~2 Hz) |

## Conductor Modules

| Module | Responsibility |
|--------|---------------|
| `conductor/question-engine.ts` | Question delivery, per-user count tracking, pool cap detection |
| `conductor/token-pool.ts` | Token generation from votes, pool count tracking |
| `conductor/remix-engine.ts` | Performer token queuing/activation, loop-boundary processing |
| `conductor/audience-remix.ts` | Audience orb placement/recall, tally computation, decay, scatter, lock/unlock |

## Client Components

| Component | Phase | Description |
|-----------|-------|-------------|
| `components/finale/EmotionVote.tsx` | Vote | Question cards with OrbCard fly animation; calls `onOrbLanded` to spawn persistent orbs |
| `components/finale/FloatingOrb.tsx` | Both | Single orb DOM element with 3-layer CSS radial gradient glow (matches projector TokenPool style) |
| `components/finale/AudienceRemix.tsx` | Remix | SVG pentagon with nodes, connectors, tally wedges; exposes `findNode()` and `getNodeViewportPosition()` via ref |
| `components/finale/RemixController.tsx` | Remix | Controller UI: token grid + SwarmControls (decay, scatter, lock, crossfade mode, fallback) |
| `components/finale/ProjectorFinale.tsx` | Both | Projector pentagon + token pool canvas visualization |

## Client Hooks

| Hook | Description |
|------|-------------|
| `hooks/useFloatingOrbs.ts` | Orb accumulation + spring physics across both phases (home positions in scattered row, wobble, drag skip) |
| `hooks/useAudienceRemix.ts` | Tally subscription (`node_tally`), decay/scatter event handling, `place_orb`/`recall_orb` socket emission |

## Resolved Decisions

- **Personal orbs, not shared tokens.** Each audience member has their own 6 orbs (from their vote answers). The projector's shared token pool still exists for the performer's drag interface.
- **Free stacking.** All 6 orbs on one node is allowed. More expressive — pile-ons are part of the fun.
- **Performer lock as safety valve.** Performer can lock any node to a specific chapter, ignoring audience votes.
- **Orbs persist across phase transition.** The FloatingOrbLayer in `app/audience/page.tsx` is always mounted once orbs exist. No visual discontinuity between vote and remix.
- **Projector-style rendering on phones.** FloatingOrb uses the same 3-layer radial gradient glow as the projector's TokenPool canvas dots, translated to CSS.
- **Spring physics, not free drift.** Orbs spring back to home positions in a scattered row rather than drifting freely. Prevents orbs from wandering off-screen or clustering.
- **6 orbs = 6 questions.** Vote phase question count is capped at `orbsPerPerson` (default 6) from remix config.
- **Decay: configurable + forceable.** Default 3 loops (~48s). Adjustable live. Performer can scatter at any time.
- **Two crossfade modes.** Loop-quantized (default) for musical coherence, instant for responsiveness. Togglable live.

## Open Questions

- [ ] Onboarding NPC messages during remix — should these be config-driven?
- [ ] Radial tally detail — should wedges show individual orb dots within them?

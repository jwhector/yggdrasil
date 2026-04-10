# Finale Redesign — V3.4 "Token Pool"

> Supersedes the V3.3 Quilt finale (assignment → preview → playback/remix).
> Song-building phases are unchanged from V3.3.

---

## Overview

The finale has two phases:

1. **Emotional Vote** — audience members answer a series of personal questions, each response generating a token. Async, self-paced, drop-in. Continues until the configurable pool cap is reached, then phones go down.
2. **Performer Remix** — phones are down; the performer builds the finale song live by spending audience tokens from the pool. When the pool is depleted, the show ends.

The audience determines the **palette**. The performer determines the **arrangement**. Every show's finale sounds different because every audience's emotional distribution is different.

---

## Chapter Identity (Single Source of Truth)

Chapter names, colors, and all display strings are defined **once** in `config/default-show.json` and referenced everywhere by ID. No hardcoded chapter names in code.

```typescript
// Config-driven — these are the ONLY place chapter labels live
interface ChapterConfig {
  id: string;            // 'chapter_0' | 'chapter_1' | 'chapter_2' (stable keys)
  label: string;         // 'Courage' | 'Love' | 'Acceptance' (display only, easily changed)
  color: string;         // hex color
  songIndex: number;     // 0, 1, 2
}
```

All code references chapters by `id` or `songIndex`, never by display label. UI components resolve labels from config at render time.

**Migration note:** All existing references to `'ambition'`, `'love'`, `'avoidance'` as string literals in code must be replaced with config lookups. The `Chapter` type becomes `string` (the chapter `id`), not a union of hardcoded names.

---

## Hardware & Display Architecture

### iPad as Projector Source

The `/projector` route runs on an **iPad**, which is the primary display source for the audience via AirPlay to an Apple TV connected to the projector.

```
┌──────────┐   AirPlay   ┌──────────┐   HDMI   ┌───────────┐
│   iPad   │ ──────────→ │ Apple TV │ ───────→ │ Projector │
│/projector│             └──────────┘           └───────────┘
└────┬─────┘
     │ WebSocket (Socket.IO)
     ▼
┌──────────────────────┐
│   Laptop (Server)    │
│  Node.js + Ableton   │
│  + /controller route │
└──────────────────────┘
```

- **During song-building:** iPad sits on a stand, passive display. The projector view renders the pentagon skeleton, A/B labels, reveal sequences — all non-interactive.
- **During `finale_vote`:** Still passive. Dots bloom on screen as audience submits emotions.
- **During `finale_remix`:** The projector view becomes **touch-interactive**. The performer picks up the iPad and directly drags tokens into pentagon nodes. Touch events on the iPad trigger `QUEUE_TOKEN` commands to the server. The projector view animates the drag-and-drop interaction at native frame rate (no network lag on the visual) since the iPad IS the display.

### Touch Interaction Model

The `/projector` route detects touch capability and show phase:
- `phase !== 'finale_remix'` → all touch events ignored, passive display
- `phase === 'finale_remix' && isTouchDevice` → drag interaction enabled

Touch implementation uses `touchstart`/`touchmove`/`touchend` (not HTML5 drag API, which doesn't work on mobile Safari). CSS `touch-action: none` on the canvas to prevent scrolling. Generous hit targets on dots (minimum 44pt touch area) and magnetic snap on pentagon node drop zones.

The drag-and-drop is **entirely client-side animation**. When a dot is dropped on a node, the iPad:
1. Immediately animates the dot snapping into the node (optimistic UI)
2. Sends `QUEUE_TOKEN { granularType, chapterId }` to the server
3. Server confirms and updates state
4. If rejected (pool empty, race condition), iPad rolls back the animation

Since the iPad is both the touch surface and the display source, the audience sees the interaction at native frame rate — no network-induced visual lag.

### Screen Wake Lock

The iPad must not sleep during the performance. Use the Screen Wake Lock API (`navigator.wakeLock.request('screen')`, supported Safari 16.4+) with a hidden video element fallback for older versions.

### Controller as Fallback

The `/controller` route on the laptop retains a **button-based fallback** for the finale remix — the same 6×3 grid with tap-to-queue. This serves as:
- Emergency backup if the iPad has issues
- Phase management (start/stop/advance) which doesn't need to be on the iPad
- Emergency controls (panic, state export, reset)
- Metrics/telemetry dashboard

The performer can use either the iPad (primary, drag-and-drop) or the controller (fallback, tap buttons) to queue tokens. Both send the same `QUEUE_TOKEN` commands.

---

## Core Concept: The Token Pool

Each answer to a question creates one **token** — a colored dot representing the chosen emotion. The audience answers multiple questions during `finale_vote`, each generating a token. With ~40 people answering ~3 questions each, the pool reaches ~120 tokens. The exact count depends on audience size, engagement, and the configurable pool cap.

Tokens float visually on the projector as colored dots. The pool fills up during the vote phase as answers come in.

The performer spends tokens to fuel the finale song:
- **1 token = 1 loop (8 bars) of audio** for one granular type
- Assigning a token to a granular type plays that emotion's version of that instrument for one loop
- When the loop ends, the token is spent (consumed) and that node goes silent — unless another token is queued
- When all tokens are spent, the finale is over

### Token Properties

```typescript
interface Token {
  id: string;                    // Unique token ID
  ownerId: UserId;               // The audience member who created it
  chapterId: string;             // Which emotion (chapter_0, chapter_1, chapter_2)
  questionIndex: number;         // Which question produced this token
  status: 'available' | 'queued' | 'playing' | 'spent';
}
```

### Pool Distribution

The pool is simply a count per chapter:

```typescript
interface TokenPool {
  available: Map<string, number>;   // chapterId → remaining count
  total: Map<string, number>;       // chapterId → original count (for display)
}
```

---

## Show Phase State Machine (V3.4 Finale)

```
... → finale_vote → finale_remix → ended
```

### Removed Phases
- `finale_elegy` — cut (fragment wreckage display removed)
- `finale_assignment` — cut (no cell claiming)
- `finale_preview` — cut (no audio preview / song exploration)

### Updated Phase Enum

```typescript
type ShowPhase =
  | 'lobby'
  | 'opener'
  | 'attempt_story'
  | 'attempt_build'
  | 'attempt_resolve'
  | 'finale_vote'          // Audience emotional vote (NEW — replaces elegy + assignment + preview)
  | 'finale_remix'         // Performer builds song from token pool (NEW — replaces finale_playback)
  | 'ended';
```

### Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `attempt_build` (attempt 2) | `finale_vote` | Auto on collapse, or Manual after rejection | Song 3 → finale |
| `attempt_resolve` (attempt 2) | `finale_vote` | Manual | After Song 3 rejection |
| `finale_vote` | `finale_remix` | Manual | Performer triggers when ready to begin |
| `finale_remix` | `ended` | Auto when pool empty, or Manual | Last token spent → fade → end |

---

## Phase 1: Emotional Vote (`finale_vote`)

### Audience Experience

1. Performer walks off stage. NPC message on projector.
2. Phone lights up with a personal question (e.g., *"What does he need to hear?"*). Three tappable cards — one per chapter color/label (Courage / Love / Acceptance).
3. Audience member taps one. A token is created. A new dot blooms on the projector.
4. A few seconds later, a new question appears (e.g., *"What are you afraid of?"*). Same three options. Another tap, another token.
5. Questions keep coming at the individual's own pace until:
   - The global pool cap is reached → phone shows **"Put your phone down."**
   - Or the person stops answering — that's fine, they've contributed what they contributed.

### Key Design Points

- **Fully async and self-paced.** No synchronized rounds. Each person gets questions independently.
- **Drop-in friendly.** Someone who joins late or pulls their phone out mid-phase starts from question 1 and catches up.
- **Optional.** Answering one question is enough. Answering ten is great. Both are valid.
- **No musical context.** The audience never hears audio previews. These are personal/emotional decisions, not musical ones.
- **Questions are the content.** The question bank is a creative asset — each question reframes the same three emotions in a different way, creating a mini introspective journey for engaged audience members.

### Question Bank

A configurable list of questions in `default-show.json`. Each question maps to the same three chapter options. The system draws questions in order (or shuffled, configurable). Each person sees questions they haven't answered yet.

```typescript
interface QuestionConfig {
  text: string;                       // e.g., "What does he need to hear?"
  // All questions share the same three chapter options — no per-question customization needed
}
```

**Example bank (performer-authored):**
1. "What does he need to hear?"
2. "What are you afraid of?"
3. "What would you forgive?"
4. "What do you keep going back to?"
5. "What would you give up?"
6. "What deserves your attention?"
7. "What are you holding onto?"
8. "What would you build if you could?"
9. "What do you owe yourself?"
10. "What would you say if no one was listening?"

### Scaling

The system calculates how many rounds to offer based on audience size and pool cap:

```
maxQuestionsPerPerson = ceil(targetPoolSize / connectedAudienceCount)
```

With 40 people and a target of 120 tokens → each person gets up to 3 questions.
With 15 people and a target of 120 tokens → each person gets up to 8 questions.

The pool cap is a hard ceiling. Once `totalTokens >= targetPoolSize`, no new questions are sent. Any question currently displayed can still be answered (answers that arrive after the cap just get accepted — a few extra tokens won't break anything).

### Projector Display

As answers come in, colored dots bloom on the projector — floating, drifting. The pool fills up visibly in real time. The audience watches the room's collective emotional signature take shape. No question text is shown on the projector — that's private to each phone.

Optional: a pool counter or fill bar showing progress toward the cap, giving the room a sense of "we're almost ready."

### Configuration

```typescript
interface VotePhaseConfig {
  questions: QuestionConfig[];         // Ordered question bank
  shuffleQuestions: boolean;           // Randomize order per person (default: false)
  targetPoolSize: number;             // Pool cap — total tokens before phones go dark (default: 120)
  questionDelayMs: number;            // Delay between a person's answer and their next question (default: 3000)
  revealPoolOnProjector: boolean;     // Show dots appearing in real time (default: true)
}
```

### Non-participation

If someone never answers a single question, they contribute zero tokens. That's fine. The pool might be smaller, which means the finale is shorter or sparser. The system adapts.

---

## Phase 2: Performer Remix (`finale_remix`)

### Performer Controller Interface (Fallback)

The `/controller` route provides a button-based fallback for token queuing, plus phase management and emergency controls. The primary interaction is the iPad's drag-and-drop projector view (see Hardware & Display Architecture above).

Fallback layout — six rows, three buttons each, plus pool counters:

```
                    [Courage]    [Love]    [Acceptance]
Bass        ■       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —
Drums       ▲       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —
Pad         ◆       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —
Melody      ◎       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —
Harmony     ●       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —
FX          ~       [  🟠  ]    [ 🩷  ]    [  🟢  ]      queued: —

Pool:  🟠 18    🩷 12    🟢 10         Total remaining: 40
```

### Interaction

- **Tap** a chapter button on a row → queues one token of that chapter for that granular type, starting at the next loop boundary
- **Tap multiple times** → stacks queued loops (badge shows queue depth: ×2, ×3, etc.)
- **Long-press / double-tap** a queued item → cancels one queued loop (token returns to pool)
- **Buttons grey out** when that chapter's pool is empty (0 remaining)
- **Active node indicator** — the currently-playing row shows which chapter is playing and a loop progress bar

### Audience Interaction Mode

A toggleable mode (`audienceInteraction`) that changes token behavior for moments when the performer is away from the controller — e.g., walking through the room letting audience members drag tokens on the iPad.

When **enabled**, two behaviors change:

1. **Instant crossfade.** Dropping a token onto a node immediately triggers a crossfade into the new track — no waiting for the next loop boundary. The cause and effect is visceral.
2. **Persistent playback.** Tokens loop indefinitely on their node until either:
   - A new token is dropped on the same node (instant crossfade to the new one; old token is spent)
   - Audience interaction mode is toggled off

This means the performer can drop tokens on nodes and walk away — the mix sustains itself. Each audience interaction adds to or changes the mix without anything going silent.

When **disabled**, all currently persistent tokens finish their current loop, then:
- If a token is queued for that node → crossfade into the queued token (return to standard one-loop behavior)
- If nothing is queued → fade to silence

**Token cost:** A persistent token costs **one token** from the pool when activated. Looping does not consume additional tokens. The cost is the activation, not the duration. When the token is eventually replaced or the mode turns off, it's marked `spent` — one token total regardless of how many loops it played.

**Default:** `audienceInteraction: false` (standard loop-quantized, one-token-one-loop behavior). Toggle via controller UI or a gesture on the projector (e.g., double-tap the pentagon center).

```typescript
interface RemixConfig {
  audienceInteraction: boolean;      // When true: instant crossfade + persistent looping (default: false)
}
```

### Audio Behavior

- **Standard mode (`audienceInteraction: false`):** All changes are **quantized to loop boundaries** (every 8 bars / `loopBoundaryBeats`). One token = one loop. Node goes silent after loop unless another token is queued.
- **Audience interaction mode (`audienceInteraction: true`):** Token drops trigger an **immediate crossfade**. Tokens **loop indefinitely** on their node until overridden or the mode is turned off. One token from the pool per activation regardless of loop count.
- When a queued token fires: the corresponding Ableton track unmutes, the token status changes to `playing`
- When the loop completes: track **fades out** over `GainConfig.crossfadeBeats` (default: 1 beat), token status → `spent`
- If another token is queued for the same node: **crossfade** — outgoing track fades out while incoming track fades in simultaneously. No silence gap.
- If a different chapter is queued on the same node: crossfade between the two chapter tracks
- If nothing is queued when the current loop ends: fade to silence on that node
- Track resolution: `config.trackMap[granularType][songIndex] → Ableton trackIndex` (unchanged from V3.3)

### Projector Display: Pentagon + Pool (Interactive on iPad)

The projector view (`/projector`) runs on the iPad. During `finale_remix`, the same view that the audience sees on the projector is the performer's touch-interactive interface.

The display shows:
- **Token pool** — colored dots floating with gentle drift physics (canvas-rendered, `requestAnimationFrame`). As tokens are spent, dots animate from the pool into the pentagon and are absorbed. The pool visibly shrinks.
- **Pentagon skeleton** — six nodes (five outer + center melody/seed). Nodes are dark/empty by default. Layout mirrors the song-building projector view.
- **Active nodes** — when a granular type is playing, its node glows with the current chapter's color. The glow pulses with audio reactivity (pre-extracted RMS data, same system as song-building).
- **Node transitions** — when a node's chapter changes, the color shifts. When a node goes silent, it fades back to dim.
- **Depletion** — as the pool empties, the floating dots thin out. The visual scarcity mirrors the sonic scarcity.
- **Drag interaction (touch only, `finale_remix` only)** — performer catches a floating dot with their finger, drags it to a pentagon node. The dot follows the finger at native frame rate. On drop, it snaps into the node and a `QUEUE_TOKEN` command fires. Dots have generous touch targets (~44pt) and nodes have magnetic snap zones. Multi-queue by dragging multiple dots to the same node sequentially.
- **Queue indicators** — nodes with queued tokens show a subtle stack count (×2, ×3). Active nodes show a loop progress ring that depletes over 8 bars.

### Ending

When the last token is spent and the last loop fades out, the pentagon goes dark. The show is over. The finale's length is entirely determined by the audience size and the performer's pacing:

- **Fast burn**: ~5-7 minutes (all six nodes active, rapid token consumption)
- **Slow build**: ~12-15 minutes (sparse, deliberate, lots of silence between)
- **Typical**: ~8-10 minutes

The performer can also manually end via the controller (`ADVANCE_PHASE` → `ended`) at any point — e.g., after the last meaningful musical moment, even if a few tokens remain.

---

## Optional: Live Audience Interaction During Remix

> **Status: Open for development.** The base spec works with phones down during remix. Any live interaction is additive and must be fully optional.

Possible directions:
- **Ambient presence** — phones glow in chapter color; tapping pulses the glow. No mechanical effect, just visual solidarity
- **Directed offering** — audience can tap to "send" their color toward a specific pentagon node, influencing (but not controlling) the performer's choices

Design constraint: any live interaction must be fully optional — the show works perfectly with phones down after the vote phase.

---

## Finale State

```typescript
interface V34FinaleState {
  phase: 'vote' | 'remix';

  // Vote phase tracking
  vote: {
    questionsAnsweredByUser: Map<UserId, number>;   // How many questions each person has answered
    maxQuestionsPerPerson: number;                   // Derived from targetPoolSize / audienceCount
    poolCapReached: boolean;
  };

  // Token pool
  pool: {
    tokens: Token[];                              // All tokens (available + queued + playing + spent)
    availableByChapter: Map<string, number>;      // chapterId → remaining available count
    totalByChapter: Map<string, number>;          // chapterId → original count
    totalRemaining: number;                       // Sum of all available
    targetPoolSize: number;                       // Config-driven cap
  };

  // Performer queue (what's coming on the next loop boundary)
  queue: Map<string, QueuedToken[]>;              // granularType → ordered list of queued tokens

  // Currently playing (what's active right now)
  active: Map<string, ActiveNode>;                // granularType → currently playing info

  // Mode
  audienceInteraction: boolean;                   // When true: instant crossfade + persistent looping

  // Track resolution
  trackMap: Map<string, Map<number, number>>;     // granularType → songIndex → Ableton trackIndex

  // Loop tracking
  loopCount: number;
  loopProgress: number;                           // 0-1, for display

  npc: { currentMessage: string | null };
}

interface QueuedToken {
  tokenId: string;
  chapterId: string;
  queuedAt: number;                               // Timestamp
}

interface ActiveNode {
  tokenId: string;
  chapterId: string;
  startedAtLoop: number;
  trackIndex: number;                             // Resolved Ableton track
  persistent: boolean;                            // True when activated in audience interaction mode — loops until overridden
}
```

---

## Conductor Commands (Finale — V3.4)

```typescript
type FinaleCommand =
  // Vote phase
  | { type: 'START_VOTE' }
  | { type: 'SUBMIT_EMOTION'; userId: UserId; chapterId: string; questionIndex: number }
  | { type: 'REQUEST_NEXT_QUESTION'; userId: UserId }        // Client asks for next question after answering
  | { type: 'POOL_CAP_REACHED' }                             // System: cap hit, signal phones down

  // Remix phase
  | { type: 'START_REMIX' }
  | { type: 'QUEUE_TOKEN'; granularType: string; chapterId: string; instant?: boolean }
  | { type: 'CANCEL_QUEUE'; granularType: string }          // Cancels last queued token for this type
  | { type: 'TOGGLE_AUDIENCE_INTERACTION' }                  // Toggles audience interaction mode (instant + persistent)
  | { type: 'LOOP_BOUNDARY' }                                // Timing engine fires this — processes queue, advances active tokens

  // NPC
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Manual end
  | { type: 'END_SHOW' }
```

## Conductor Events (Finale — V3.4)

```typescript
type FinaleEvent =
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
  | { type: 'NODE_SILENT'; granularType: string }            // Nothing queued, fade complete
  | { type: 'POOL_EMPTY' }                                   // All tokens spent

  // Audio
  | { type: 'AUDIO_CUE'; cue: RemixAudioCue }

  // NPC
  | { type: 'NPC_MESSAGE'; message: string }
```

## Audio Cues (V3.4)

```typescript
type RemixAudioCue =
  | { type: 'remix_start' }
  | { type: 'node_unmute'; granularType: string; trackIndex: number }
  | { type: 'node_crossfade'; granularType: string; muteTrack: number; unmuteTrack: number }
  | { type: 'node_instant_crossfade'; granularType: string; muteTrack: number | null; unmuteTrack: number }  // Fires immediately, no loop boundary wait
  | { type: 'node_fade_out'; granularType: string; trackIndex: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }
```

---

## WebSocket Events (V3.4 Finale)

### Client → Server

| Event | Payload | Sender |
|-------|---------|--------|
| `submit_emotion` | `{ chapterId, questionIndex }` | Audience (finale_vote) |
| `command` | `QUEUE_TOKEN / CANCEL_QUEUE` | Projector (iPad drag-and-drop during finale_remix) |
| `command` | `ConductorCommand` | Controller (fallback + phase management) |

### Server → Client

| Event | Payload | Recipients |
|-------|---------|------------|
| `question` | `{ questionIndex, text, chapters: ChapterConfig[] }` | Individual audience member (on vote start + after each answer) |
| `emotion_confirmed` | `{ chapterId, questionIndex }` | Individual audience member |
| `phones_down` | — | Audience (when pool cap reached or remix starts) |
| `pool_state` | `{ availableByChapter, totalRemaining }` | Projector + Controller (~2 Hz during vote + remix) |
| `node_update` | `{ granularType, chapterId, status }` | Projector (on activation/deactivation) |

### Removed from V3.3

All quilt-related events: `claim_cell`, `release_cell`, `set_song`, `lock_in`, `move_cell`, `change_song`, `quilt_state`, `cell_claimed`, `cell_moved`, `playhead_update`, `column_reordered`.

---

## Persistence (V3.4 Finale)

### New Tables

```sql
-- Audience emotional votes (one row per question answered)
CREATE TABLE finale_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- Token spend log (for recovery + analytics)
CREATE TABLE finale_token_events (
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

### Deprecated Tables (V3.3)
- `finale_quilt_cells` — replaced by `finale_votes` + `finale_token_events`
- `finale_remix_events` — replaced by `finale_token_events`

---

## Folder Structure Changes

```
conductor/
  ├── quilt.ts              → REMOVE (V3.3 quilt grid)
  ├── assignment.ts         → REMOVE (V3.3 cell claiming)
  ├── token-pool.ts         → NEW (pool management, token lifecycle)
  ├── question-engine.ts    → NEW (per-user question pacing, cap detection)
  ├── remix-engine.ts       → NEW (queue processing, loop boundary logic)
  └── fragments.ts          → KEEP (still needed if elegy is ever re-added)

components/
  └── finale/
      ├── QuiltGrid.tsx         → REMOVE
      ├── QuiltPreview.tsx      → REMOVE
      ├── QuiltRemix.tsx        → REMOVE
      ├── EmotionVote.tsx       → NEW (audience vote cards)
      ├── TokenPool.tsx         → NEW (projector: floating dots canvas — pool visualization + drag source)
      ├── PentagonRemix.tsx     → NEW (projector: pentagon nodes — drop targets + active state + loop progress)
      ├── ProjectorFinale.tsx   → NEW (projector: composes TokenPool + PentagonRemix, manages touch interaction layer)
      └── RemixController.tsx   → NEW (controller fallback: 6×3 button grid + pool counters)

hooks/
  ├── useQuilt.ts               → REMOVE
  ├── useTokenPool.ts           → NEW (pool state subscription)
  ├── useRemixQueue.ts          → NEW (controller queue management)
  └── useDragToken.ts           → NEW (iPad touch drag state: active dot, drag position, drop target detection)
```

---

## Open Questions

- [ ] **Autopilot mode** — algorithmic queue management. Design TBD. Could be a toggle, a narrative beat, or a co-performer. Needs further exploration before speccing.
- [ ] **AirPlay latency** — typically 50-100ms. Acceptable for this use case but needs testing with actual hardware. Fallback: HDMI adapter with iPad on a stand for zero-latency display (loses walkabout capability).
- [ ] Live audience interaction during remix (see "Optional" section above)
- [ ] Exact visual design for floating token dots (physics? drift pattern? clustering by color?)
- [ ] NPC message library for V3.4 phases
- [ ] Question bank — performer needs to author these. System needs 10-15 questions minimum.
- [ ] Should the performer see which audience member created each token? (Probably not — keeps it collective)
- [ ] Audio reactivity for pentagon nodes during remix (reuse song-building RMS system?)
- [ ] Minimum token count — what if only 5 people show up? Is ~15 tokens enough for a meaningful finale?
- [ ] Can the performer pause/resume the remix? (e.g., for a spoken moment mid-finale)
- [ ] iPad model requirements — canvas rendering with 100+ animated dots needs decent GPU. Test on target device early.
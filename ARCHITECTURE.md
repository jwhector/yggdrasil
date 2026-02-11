# Solo Show — Technical Architecture Specification

## Document Purpose
This document is the **authoritative source of truth** for the Solo Show system architecture. It is designed to:
- Provide complete context for AI agents working on the codebase
- Define terminology, data structures, and system boundaries
- Specify the state machine and event protocols
- Guide implementation decisions

**When this document conflicts with code, this document is correct and the code should be updated.**

---

## Project Overview

### What This Is
An interactive live performance system where ~30 audience members collectively build a song in real time. The audience is divided into **4 factions**, each representing a part of the performer's subconscious. The system manages:
- Real-time audience voting from phones
- A visible **Song Tree** showing the path of decisions
- A **coup mechanic** allowing factions to sabotage and redo decisions
- Personal decision tracking for a finale experience
- Performer control over show flow

### Core Metaphor
The audience is not a crowd—it is a fractured mind. Disagreement is psychological conflict. Sabotage is self-sabotage. The show dramatizes the difficulty of coherence and commitment.

---

## Terminology

| Term | Definition |
|------|------------|
| **Row** | A single decision point in the song. The show consists of 7–8 rows. |
| **Option** | One of 4 choices available in a row. Options are musically ambiguous and not tied to specific factions. |
| **Faction** | One of 4 groups the audience is divided into. Factions compete by internal alignment, not by "owning" specific options. |
| **Audition** | The playback of musical options during the voting phase. Users can vote while listening. |
| **Faction Vote** | A user's vote for which option should win (contributes to faction coherence). |
| **Personal Vote** | A user's private vote for their preferred option (used in finale). |
| **Coherence** | A faction's internal alignment: `(largest agreement bloc) / (faction voters)`. |
| **Weighted Coherence** | Coherence × multiplier (multiplier > 1 after successful coup on current row). |
| **Faction Path** | The sequence of committed options, determined by faction coherence. "The song we built." |
| **Popular Path** | The sequence of options that won the plurality of personal votes. "The song we wanted." |
| **Coherence Tie** | When 2+ factions share the highest weighted coherence; resolved by random selection. |
| **Coup** | A faction's one-time ability to reset the current row after commit. |
| **Coup Meter** | Visual indicator (faction-only) of coup vote progress toward threshold. |
| **Song Tree** | The visual representation of all rows and the path of committed decisions. |
| **Personal Tree** | An individual user's sequence of personal votes (private until finale). |
| **Parallel Timeline** | A user's personal tree + submitted text, visualized during finale. |

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  /audience      │  /projector     │  /controller                │
│  (30 users)     │  (1 display)    │  (performer)                │
└────────┬────────┴────────┬────────┴──────────────┬──────────────┘
         │                 │                       │
         └─────────────────┼───────────────────────┘
                           │ WebSocket (Socket.IO)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CUSTOM SERVER (Node.js)                       │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │    Next.js     │  │    Socket.IO     │  │   Persistence    │  │
│  │  (page routes) │  │    (real-time)   │  │    (SQLite)      │  │
│  └────────────────┘  └────────┬─────────┘  └──────────────────┘  │
│                               │                                   │
│                      ┌────────▼─────────┐                        │
│                      │    Conductor     │  ← Pure state machine  │
│                      │   (game logic)   │                        │
│                      └──────────────────┘                        │
│  ┌──────────────────┐  ┌──────────────────┐                      │
│  │  Timing Engine   │  │   OSC Bridge     │  ← Ableton Live      │
│  │ (auto-advance)   │◄─┤  (bidirectional) │    integration       │
│  └──────────────────┘  └────────┬─────────┘                      │
└──────────────────────────────────┼──────────────────────────────┘
                                   │ OSC over UDP
                                   ▼
                    ┌──────────────────────────────┐
                    │   Ableton Live + AbletonOSC    │
                    │   (musical timing, audio)     │
                    └──────────────────────────────┘
```

### Architecture: Next.js with Custom Server

This project uses Next.js with a custom Node.js server to enable persistent WebSocket connections via Socket.IO. A single process serves both the Next.js pages and the real-time game logic.

**Why custom server?**
- Socket.IO requires persistent connections (not supported by Next.js API routes)
- Single process simplifies deployment and recovery for live performance
- All state lives in one place (SQLite + memory)

### Client Routes (Next.js App Router)

**`/audience`** — Audience member UI
- Joins via seat-specific QR code (encodes seatId)
- Lobby phase: prompt input ("What lives on your fig tree?") for thematic priming
- Pre-assignment: "waiting for show to start" state
- Faction reveal animation (when assigned)
- Displays faction identity and color
- Two-vote interface (faction + personal) via drag interaction
- Coup voting (faction-only visibility of meter)
- Reconnection-resilient (restores session via stored identifier)

**`/projector`** — Public display
- Lobby phase: displays configurable text content (e.g., thematic excerpt or poem)
- Faction assignment: room-wide reveal animation
- Song Tree visualization with dual paths:
  - **Faction path** (solid): the committed options, determined by coherence
  - **Popular path** (ghost/shadow): the options winning the personal vote plurality
- Current phase indicator (audition, voting, reveal, coup window)
- Reveal animation:
  - Coherence scores for each faction
  - If tie: tiebreaker visualization (e.g., spinning wheel) before winner revealed
  - Divergence indicator when faction choice ≠ popular choice
- Coup trigger animation (ambush reveal, tree "retracts")
- Finale: popular path song → individual personal tree playback with fig tree text

**`/controller`** — Performer interface
- Seat map visualization (occupied seats during lobby)
- "Assign Factions" button (triggers assignment algorithm)
- Phase advancement (manual)
- Show state overview with version number
- Standard controls:
  - Pause/resume
  - Skip row
  - Restart current row
  - Manually trigger coup (rehearsal/override)
  - Adjust timing windows live
  - Force-advance to finale
- Emergency recovery controls:
  - Reset to lobby (with option to preserve users)
  - Export current state as JSON backup
  - Import state from JSON backup
  - Force reconnect all clients

---

## Seat Topology & Faction Assignment

Faction assignment balances two goals:
1. **Equal faction sizes** (hard constraint: no faction more than 1 member larger than another)
2. **Minimize same-faction adjacency** (soft optimization: discourage neighbors from being in the same faction)

This encourages cross-faction communication and strategic coordination, since people sitting near each other are likely in different factions.

### Architecture

```
┌─────────────────────────────────────────┐
│         SeatTopologyProvider            │  ← Venue-specific configuration
│  (defines which seats are adjacent)     │
└─────────────────┬───────────────────────┘
                  │ AdjacencyGraph
                  ▼
┌─────────────────────────────────────────┐
│        FactionAssigner                  │  ← Reusable algorithm
│  (balances sizes, minimizes adjacency)  │
└─────────────────────────────────────────┘
```

### Seat Identification via QR Codes

Each seat has its own QR code encoding the seat ID. When a user scans:
- They are directed to `/audience?seat=<seatId>`
- The system records the user-to-seat mapping
- Faction is NOT yet assigned; user sees a "waiting for show to start" state

This requires printing/placing seat-specific QR codes, but provides precise topology data.

### Join & Assignment Flow

```
1. LOBBY
   - Audience scans seat-specific QR codes
   - Each user joins with their seatId
   - Faction = null; user sees "waiting" state
   - Controller shows: "24 joined" + seat map visualization

2. ASSIGNMENT (performer triggers)
   - Performer presses "Assign Factions" in controller
   - Algorithm runs (see below)
   - All users receive faction simultaneously
   - Users see faction reveal animation on their phones
   - Projector can show room-wide faction distribution

3. SHOW BEGINS
   - Performer advances to first row
   - Normal flow continues
```

### Assignment Algorithm

```typescript
function assignFactions(
  users: UserWithSeat[],
  graph: AdjacencyGraph
): Map<UserId, FactionId> {
  const assignments = new Map<UserId, FactionId>();
  const factionCounts = [0, 0, 0, 0];
  
  // Sort by most-constrained-first (most neighbors already assigned)
  const sorted = sortByConstraints(users, graph, assignments);
  
  for (const user of sorted) {
    // Get factions of adjacent seats
    const neighborFactions = graph.getNeighbors(user.seatId)
      .map(seatId => assignments.get(userAtSeat(seatId)))
      .filter(f => f !== undefined);
    
    // Score each faction: lower is better
    const scores = [0, 1, 2, 3].map(factionId => {
      const sizeScore = factionCounts[factionId] * 100;  // Heavy weight on balance
      const adjacencyScore = neighborFactions.filter(f => f === factionId).length;
      return { factionId, score: sizeScore + adjacencyScore };
    });
    
    // Pick faction with lowest score
    scores.sort((a, b) => a.score - b.score);
    const chosen = scores[0].factionId;
    
    assignments.set(user.id visibleTo, chosen);
    factionCounts[chosen]++;
  }
  
  return assignments;
}
```

The heavy weight on `sizeScore` ensures balance is maintained; adjacency is optimized within that constraint.

### Late Joins (After Assignment)

When a user joins after factions have been assigned:
1. Identify the smallest faction(s)
2. Among those, prefer one with fewer adjacent members (if seat is known)
3. If adjacency can't be satisfied, still assign to smallest faction

```typescript
function assignLatecomer(
  user: UserWithSeat,
  state: ShowState,
  graph: AdjacencyGraph
): FactionId {
  const factionCounts = countFactionMembers(state);
  const minCount = Math.min(...factionCounts);
  
  // Factions tied for smallest
  const smallestFactions = [0, 1, 2, 3].filter(f => factionCounts[f] === minCount);
  
  if (smallestFactions.length === 1 || !user.seatId) {
    return smallestFactions[0];
  }
  
  // Among smallest, pick one with fewest adjacent members
  const neighborFactions = graph.getNeighbors(user.seatId)
    .map(seatId => getUserAtSeat(seatId)?.faction)
    .filter(f => f !== undefined);
  
  let best = smallestFactions[0];
  let bestAdjacency = Infinity;
  
  for (const factionId of smallestFactions) {
    const adjacentCount = neighborFactions.filter(f => f === factionId).length;
    if (adjacentCount < bestAdjacency) {
      best = factionId;
      bestAdjacency = adjacentCount;
    }
  }
  
  return best;
}
```

### Topology Providers

Different venues need different adjacency definitions. The system supports pluggable topology providers:

```typescript
interface SeatTopologyProvider {
  type: string;
  buildGraph(seats: SeatId[]): AdjacencyGraph;
}

interface AdjacencyGraph {
  getNeighbors(seatId: SeatId): SeatId[];
}
```

**Built-in providers:**

| Type | Adjacency Definition | Use Case |
|------|---------------------|----------|
| `theater_rows` | Left, right, and seats directly in front/behind | Traditional theater seating |
| `tables` | Everyone at same table is adjacent | Cabaret, banquet seating |
| `grid` | 4-directional or 8-directional neighbors | General grid layouts |
| `none` | No adjacency data; balance-only | Unknown venue or fallback |

Topology is configured per-show in the show config file.

---

## Data Models

### User
```typescript
interface User {
  id: string;              // Persistent across reconnection (stored client-side)
  seatId: SeatId | null;   // From QR code, null if unknown
  faction: FactionId | null;  // null until assignment phase completes
  connected: boolean;
  joinedAt: timestamp;
}
```

### Faction
```typescript
type FactionId = 0 | 1 | 2 | 3;

interface Faction {
  id: FactionId;
  coupUsed: boolean;                    // Each faction may coup once per show
  coupMultiplier: number;               // 1.0 default, 1.5 after successful coup on current row
  currentRowCoupVotes: Set<UserId>;     // Users who voted to coup this row
}
```

### Row & Options

**Important:** The 4 factions and 4 options per row are a thematic parallelism, not a mechanical coupling. Options are musically ambiguous—they are not "owned by" or "representing" specific factions. A faction wins by having its members align on *any* option, not by championing a designated option.

```typescript
interface Row {
  index: number;                        // 0-indexed row number
  options: [Option, Option, Option, Option];  // Four ambiguous choices
  phase: RowPhase;
  committedOption: OptionId | null;     // Set after reveal
  attempts: number;                     // Increments after each coup on this row
  currentAuditionIndex: number | null;  // Used during 'voting' phase for audition playback (0-3)
  auditionComplete: boolean;             // True when all options have been heard
}

type RowPhase =
  | 'pending'
  | 'voting'        // Includes audition playback - users vote while listening
  | 'revealing'
  | 'coup_window'
  | 'committed';

interface Option {
  id: OptionId;
  index: number;                        // 0–3, position in row
  musicalData: AudioReference;          // Adapter-specific, opaque to Conductor
}
```

### Vote
```typescript
interface Vote {
  odId: UserId;
  rowIndex: number;
  factionVote: OptionId;
  personalVote: OptionId;
  timestamp: timestamp;
  attempt: number;                      // Which attempt of this row (for coup tracking)
}
```

### Personal Tree (for Finale)

The personal tree tracks each user's private votes (separate from faction votes) and their response to the lobby prompt. This data is used during the finale to play back each person's "song that could've been" alongside their imagined alternate life.

```typescript
interface PersonalTree {
  userId: UserId;
  path: OptionId[];                     // One entry per row (personal votes)
  figTreeResponse: string | null;       // Response to lobby prompt, displayed during finale
}
```

### Show State
```typescript
interface ShowState {
  id: string;                           // Unique show instance
  phase: ShowPhase;
  currentRowIndex: number;
  rows: Row[];
  factions: [Faction, Faction, Faction, Faction];
  users: Map<UserId, User>;
  votes: Vote[];
  personalTrees: Map<UserId, PersonalTree>;
  config: ShowConfig;
}

type ShowPhase =
  | 'lobby'           // Audience joining, factions not yet assigned, fig tree prompt
  | 'assigning'       // Brief phase during faction assignment (reveal animation)
  | 'running'         // Main show loop
  | 'finale'          // Playing back personal timelines
  | 'ended';

interface ShowConfig {
  rowCount: number;                     // 7–8
  coupThreshold: number;                // Fraction of faction required (e.g., 0.5)
  coupMultiplierBonus: number;          // e.g., 0.5 (for 1.5x total)
  timingDefaults: {
    auditionLoopsPerOption: number;     // How many times each option loops during audition (default: 2)
    auditionPerOptionMs: number;        // ms per loop
    votingWindow: number;               // ms
    revealDuration: number;             // ms
    coupWindow: number;                 // ms
  };
  lobby: {
    projectorContent: string;           // Text displayed on projector during lobby (e.g., thematic excerpt)
    audiencePrompt: string;             // Prompt shown to audience (e.g., "What lives on your fig tree?")
  };
  rowConfigurations: RowConfig[];       // Pre-configured musical options per row
}
```

---

## State Machine: Conductor

The **Conductor** is a pure logic module with no I/O. It receives commands, validates them, updates state, and emits events. The server wraps the Conductor with WebSocket I/O and persistence.

### Row Phase Transitions

```
pending → voting (with audition) → revealing → coup_window → committed
                                                   │
                                                   ▼ (if coup triggered)
                                              voting (attempt + 1, reset audition)
```

**Note:** The `voting` phase includes both audition playback and vote collection. The conductor tracks `auditionComplete: boolean` to manage the transition from audition to voting window within the same phase.

### Commands (Input)

```typescript
type ConductorCommand =
  | { type: 'ADVANCE_PHASE' }
  | { type: 'SUBMIT_VOTE'; userId: UserId; factionVote: OptionId; personalVote: OptionId }
  | { type: 'SUBMIT_COUP_VOTE'; userId: UserId }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SKIP_ROW' }
  | { type: 'RESTART_ROW' }
  | { type: 'TRIGGER_COUP'; factionId: FactionId }   // Manual override
  | { type: 'SET_TIMING'; timings: Partial<TimingConfig> }
  | { type: 'FORCE_FINALE' }
  | { type: 'SUBMIT_PARALLEL_TEXT'; userId: UserId; text: string }
  | { type: 'USER_CONNECT'; userId: UserId }
  | { type: 'USER_DISCONNECT'; userId: UserId };
```

### Events (Output)

```typescript
type ConductorEvent =
  | { type: 'PHASE_CHANGED'; row: number; phase: RowPhase }
  | { type: 'VOTE_RECEIVED'; userId: UserId; row: number }
  | { type: 'REVEAL'; row: number; results: RevealPayload }
  | { type: 'COUP_METER_UPDATE'; factionId: FactionId; progress: number }  // 0–1
  | { type: 'COUP_TRIGGERED'; factionId: FactionId; row: number }
  | { type: 'ROW_COMMITTED'; row: number; optionId: OptionId }
  | { type: 'SHOW_PHASE_CHANGED'; phase: ShowPhase }
  | { type: 'FINALE_TIMELINE'; userId: UserId; path: OptionId[]; text: string }
  | { type: 'AUDIO_CUE'; cue: AudioCue };   // Passed to AudioAdapter

interface RevealPayload {
  rowIndex: number;
  factionResults: {
    factionId: FactionId;
    rawCoherence: number;
    weightedCoherence: number;
    voteCount: number;
    votedForOption: OptionId;           // Which option this faction's bloc voted for
  }[];
  tie: {
    occurred: boolean;
    tiedFactionIds: FactionId[];        // Empty if no tie
  };
  winningOptionId: OptionId;            // Resolved winner (random if tie)
  winningFactionId: FactionId;          // Resolved winner (random if tie)
  popularVote: {
    optionId: OptionId;                 // Option with most personal votes
    voteCount: number;
    divergedFromFaction: boolean;       // True if popular ≠ faction choice
  };
}
```

### Tie Handling

When two or more factions have identical weighted coherence:

1. **Detection**: After calculating weighted coherence, identify all factions sharing the maximum value
2. **Visualization**: Projector highlights tied factions, plays tiebreaker animation (e.g., spinning wheel)
3. **Resolution**: Random selection among tied factions (fully random, not seeded)
4. **Reveal continues**: Winning faction/option announced, path drawn

```typescript
function resolveTie(tiedFactionIds: FactionId[]): FactionId {
  const randomIndex = Math.floor(Math.random() * tiedFactionIds.length);
  return tiedFactionIds[randomIndex];
}
```

### Coherence Calculation

Coherence measures how aligned a faction is internally—regardless of *which* option they align on. A faction doesn't "own" an option; it wins by having its members vote together.

```typescript
function calculateCoherence(factionId: FactionId, votes: Vote[], rowIndex: number, attempt: number): number {
  const factionVotes = votes.filter(v => 
    getUserFaction(v.userId) === factionId && 
    v.rowIndex === rowIndex && 
    v.attempt === attempt
  );
  
  if (factionVotes.length === 0) return 0;
  
  // Count how many faction members voted for each option
  const voteCounts = countBy(factionVotes, v => v.factionVote);
  // The largest bloc determines coherence
  const largestBloc = Math.max(...Object.values(voteCounts));
  
  return largestBloc / factionVotes.length;
}

function calculateWeightedCoherence(factionId: FactionId, state: ShowState): number {
  const raw = calculateCoherence(factionId, state.votes, state.currentRowIndex, currentAttempt);
  const multiplier = state.factions[factionId].coupMultiplier;
  return raw * multiplier;  // Can exceed 1.0 (up to 1.5)
}
```

**Example:** If Faction A has 8 members and 6 vote for Option 2 while 2 vote for Option 0, Faction A's coherence is 6/8 = 75%. If Faction B has 7 members and all 7 vote for Option 1, Faction B's coherence is 100%. Faction B wins despite having fewer members.

### Dual Path Tracking

The system tracks two parallel paths through the Song Tree:

| Path | Calculation | Visual | Meaning |
|------|-------------|--------|---------|
| **Faction Path** | Winner of coherence competition | Solid line | "The song we built through conviction" |
| **Popular Path** | Plurality of personal votes | Ghost/shadow line | "The song we secretly wanted" |

```typescript
interface DualPaths {
  factionPath: OptionId[];    // Committed options (coherence winners)
  popularPath: OptionId[];    // Personal vote plurality winners
}

function calculatePopularWinner(votes: Vote[], rowIndex: number): OptionId {
  const personalVotes = votes
    .filter(v => v.rowIndex === rowIndex)
    .map(v => v.personalVote);
  
  const counts = countBy(personalVotes, v => v);
  return maxBy(Object.entries(counts), ([_, count]) => count)[0];
}
```

**Real-time feedback:** After each reveal, the projector shows both paths. When they diverge, it's visually apparent—the room chose one thing, but wanted another. This gives immediate meaning to the personal vote without revealing the individual-level finale.

**Reveal display:** "Faction 2 chose Option A. The room wanted Option C."

### Coup Logic

```typescript
function processCoupVote(state: ShowState, userId: UserId): ConductorEvent[] {
  const faction = state.factions[getUserFaction(userId)];
  
  // Validation
  if (faction.coupUsed) return [];
  if (state.rows[state.currentRowIndex].phase !== 'coup_window') return [];
  
  faction.currentRowCoupVotes.add(userId);
  
  const factionMembers = countFactionMembers(state, faction.id);
  const progress = faction.currentRowCoupVotes.size / factionMembers;
  
  const events: ConductorEvent[] = [
    { type: 'COUP_METER_UPDATE', factionId: faction.id, progress }
  ];
  
  if (progress >= state.config.coupThreshold) {
    faction.coupUsed = true;
    faction.coupMultiplier = 1 + state.config.coupMultiplierBonus;
    state.rows[state.currentRowIndex].attempts += 1;
    state.rows[state.currentRowIndex].phase = 'auditioning';
    
    events.push({ type: 'COUP_TRIGGERED', factionId: faction.id, row: state.currentRowIndex });
  }
  
  return events;
}
```

---

## WebSocket Protocol

### Namespaces / Rooms
- Each client joins a room based on mode: `audience`, `projector`, `controller`
- Audience members also join faction-specific rooms: `faction:0`, `faction:1`, etc.
- Coup meter updates are broadcast only to faction rooms (hidden until triggered)

### State Serialization
`ShowState` contains `Map` and `Set` objects which don't survive JSON serialization. The server serializes state before sending (converting Maps to `[key, value][]` arrays and Sets to arrays), and clients deserialize after receiving. See `lib/serialization.ts` for implementation.

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, mode }` | All |
| `vote` | `{ factionVote, personalVote }` | Audience |
| `coup_vote` | `{}` | Audience |
| `fig_tree_response` | `{ text }` | Audience |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

**Primary Event:**
| Event | Payload | Recipients | When |
|-------|---------|------------|------|
| `state_sync` | `ShowState` (filtered by recipient) | All | **On every state change** + initial connect |

**State Sync Strategy:**
The system uses **full state syncs** rather than granular event broadcasting. After any state mutation, the server broadcasts the complete filtered state to each client type:
- **Controller**: Full serialized state (Maps/Sets converted to arrays)
- **Projector**: Public filtered state (rows, paths, factions, no user details)
- **Audience**: Personalized filtered state (their faction, votes, current row)

This eliminates the possibility of state drift between client and server. The client simply replaces its entire state on each update rather than manually patching specific fields. The trade-off is higher bandwidth (~10-50KB per update), which is acceptable for ~30 users with infrequent state changes.

**Special Purpose Events:**
Some events are still emitted for specific non-state purposes:
- `error`: Sent to controller for visibility into invalid commands
- `identity`: Sent to new audience members with their assigned userId

---

## Persistence Layer

### Why SQLite
- Single-file database, trivial deployment
- Survives server restart
- Can be backed up by copying one file
- Sufficient for 30 concurrent users

### Tables

```sql
CREATE TABLE shows (
  id TEXT PRIMARY KEY,
  state JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  faction INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  faction_vote INTEGER NOT NULL,
  personal_vote INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE fig_tree_responses (
  user_id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Recovery Protocol
On server start:
1. Load most recent show from `shows` table
2. Rehydrate `ShowState` from JSON
3. Accept reconnections; match by `userId` from client localStorage

---

## Recovery & Robustness

This system runs during live performances. Failures must be recoverable without losing show state or audience engagement.

### Design Principles

1. **Persist on every state change** — not periodic batches
2. **Atomic writes** — use SQLite transactions, never partial state
3. **Stateless clients** — all truth lives on server; clients are views
4. **Automatic reconnection** — clients retry without user intervention
5. **Graceful degradation** — show continues even if some clients disconnect

### State Versioning

Every state mutation increments a monotonic version number:

```typescript
interface ShowState {
  // ... existing fields ...
  version: number;              // Increments on every state change
  lastUpdated: Timestamp;       // Wall clock time of last change
}
```

Clients track the last version they received. On reconnect, if versions match, minimal sync needed. If versions differ, full state sync.

### Persistence Strategy

```typescript
// Persist after EVERY state change, wrapped in transaction
async function persistState(state: ShowState): Promise<void> {
  await db.run('BEGIN IMMEDIATE');
  try {
    await db.run(
      'UPDATE shows SET state = ?, version = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(state), state.version, Date.now(), state.id]
    );
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
}
```

SQLite with WAL (Write-Ahead Logging) mode enabled for crash resilience:
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

### Backup Snapshots

Periodic backup files for catastrophic recovery:

```typescript
interface BackupConfig {
  enabled: boolean;
  intervalMs: number;           // e.g., 60000 (every minute)
  directory: string;            // e.g., './backups'
  maxBackups: number;           // Rolling window, e.g., 10
}
```

Backup filename format: `show-{showId}-{version}-{timestamp}.json`

### Client Reconnection Protocol

**Client-side (localStorage):**
```typescript
interface StoredClientIdentity {
  odId: UserId;
  odShowId: ShowId;
  seatId: SeatId | null;
}
```

**Reconnection flow:**
```
1. Client detects disconnect (WebSocket close/error)
2. Client enters "reconnecting" UI state
3. Client attempts reconnect with exponential backoff (1s, 2s, 4s, max 10s)
4. On connect, client sends: { type: 'RECONNECT', userId, showId, lastVersion }
5. Server validates userId exists and belongs to showId
6. Server sends full state sync (or delta if versions close)
7. Client resumes normal operation
```

**Heartbeat system:**
```typescript
// Server pings every 15 seconds
// Client must respond within 5 seconds
// 2 missed pongs = client marked disconnected
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 5000;
const MAX_MISSED_HEARTBEATS = 2;
```

### Controller Emergency Actions

The controller interface includes emergency controls for live recovery:

| Action | Effect | When to Use |
|--------|--------|-------------|
| **Pause** | Freezes show, all clients see "paused" | Technical difficulties, need to regroup |
| **Resume** | Continues from paused state | Ready to continue |
| **Restart Row** | Resets current row to `pending` | Row got corrupted or confused |
| **Skip Row** | Commits current row with current leader, advances | Row is stuck, need to move on |
| **Reset to Lobby** | Clears all progress, returns to lobby | Full restart needed |
| **Export State** | Downloads current state as JSON | Manual backup before risky action |
| **Import State** | Loads state from JSON file | Restore from backup |
| **Force Reconnect All** | Server sends reconnect signal to all clients | Sync issues across clients |

```typescript
type EmergencyCommand =
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESTART_ROW' }
  | { type: 'SKIP_ROW' }
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean }
  | { type: 'EXPORT_STATE' }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' };
```

### Recovery Scenarios

**Server crash mid-show:**
1. Server restarts automatically (process manager like PM2)
2. Server loads state from SQLite on boot
3. Clients detect disconnect, enter reconnecting state
4. Clients reconnect, receive state sync
5. Show resumes from last persisted state (worst case: lose in-flight votes from current phase)

**Projector computer crashes:**
1. Restart projector, navigate to `/projector`
2. Projector connects, receives full state sync
3. Song Tree redraws with current state
4. No data loss (projector is stateless view)

**All clients disconnect (network outage):**
1. Server continues running, state unchanged
2. When network recovers, clients reconnect automatically
3. State sync restores everyone to current position
4. Votes already cast are preserved; in-flight actions may be lost

**Database corruption:**
1. Stop server
2. Restore from most recent backup file
3. Restart server with restored state
4. Clients reconnect automatically

**Need to restart from scratch:**
1. Controller triggers "Reset to Lobby"
2. Choose whether to preserve user assignments or full reset
3. All clients receive lobby state
4. Show begins fresh

### Failure Modes and Mitigations

| Failure | Detection | Mitigation |
|---------|-----------|------------|
| Single client disconnect | Missed heartbeats | Mark disconnected, allow reconnect |
| Server crash | Process exit | Auto-restart via PM2, state in SQLite |
| SQLite corruption | Read failure | Restore from backup |
| Network partition | Multiple missed heartbeats | Pause show, wait for recovery |
| State desync | Version mismatch on reconnect | Full state sync |
| Vote lost in transit | N/A (no confirmation) | Accept as edge case; votes are cheap |

### Testing Recovery

Before each performance, run through:
1. Kill server process, verify it restarts and state survives
2. Disconnect a client, verify reconnection works
3. Trigger "Reset to Lobby" and verify clean slate
4. Export state, modify something, import state, verify restore

---

## Timing Engine & OSC Protocol

### Hybrid Timing Architecture

The system uses a **hybrid timing approach** where:
- **Ableton Live** controls musical timing (audition loops, tempo-synced events)
- **Server** controls game logic timing (voting windows, coup windows, reveals)

This ensures sample-accurate musical transitions while keeping game logic simple.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Server                                          │
│  ┌─────────────────────┐     ┌─────────────────────┐                     │
│  │    Timing Engine    │◄────│     OSC Bridge      │                     │
│  │  (schedules timers, │     │  (UDP bidirectional)│                     │
│  │   sends commands)   │     │                     │                     │
│  └──────────┬──────────┘     └──────────┬──────────┘                     │
│             │                           │                                 │
│             │ ADVANCE_PHASE             │ OSC over UDP                    │
│             ▼                           │                                 │
│  ┌─────────────────────┐                │                                 │
│  │     Conductor       │                │                                 │
│  │  (pure game logic)  │                │                                 │
│  └─────────────────────┘                │                                 │
│  ┌─────────────────────┐                │                                 │
│  │   Audio Router      │◄───────────────┘                                 │
│  │ (AUDIO_CUE → OSC)   │                                                  │
│  └─────────────────────┘                                                  │
└─────────────────────────────────────────┼─────────────────────────────────┘
                                          │
                    ┌─────────────────────▼─────────────────────┐
                    │   Ableton Live + AbletonOSC Plugin         │
                    │  (ideoforms)                               │
                    │  - Exposes Live Object Model via /live/*   │
                    │  - Listens on port 11000                   │
                    │  - Responds on port 11001                  │
                    └────────────────────────────────────────────┘
```

### Timing Responsibilities by Phase

| Row Phase | Timing Owner | Mechanism | Notes |
|-----------|--------------|-----------|-------|
| `voting` (audition) | **Ableton** | Beat subscription via `/live/song/get/beat` | Server counts beats to detect master loop completion (e.g., 32 beats = 8 bars). Clips loop naturally within the master loop duration |
| `voting` (after audition) | **Server** | JS timer (`votingWindowMs`) | Non-musical, slight drift OK. Timer starts after audition complete |
| `revealing` | **Server** | JS timer (`revealDurationMs`) | Can be extended for Ableton cues |
| `coup_window` | **Server** | JS timer (`coupWindowMs`) | Non-musical timing |
| `committed` | **Manual** | N/A | Performer controls row transitions |

### OSC Protocol

This system uses the **AbletonOSC** plugin (by ideoforms) which exposes Ableton Live's Live Object Model via standard OSC addresses. All addresses follow the `/live/*` namespace.

**Session Layout Convention:**
- **32 tracks total** (4 tracks per row × 8 rows)
- Track index calculated as: `rowIndex * 4 + optionIndex`
  - Row 0: tracks 0-3
  - Row 1: tracks 4-7
  - Row 2: tracks 8-11
  - ...
  - Row 7: tracks 28-31
- All clips fire at slot 0 (scene 0)
- Audition uses mute/unmute for smooth transitions (no stop/start glitches)
- Layering works because each row has its own set of tracks

**Server → AbletonOSC (Port 11000 by default)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/live/test` | - | Connectivity test (AbletonOSC responds with 'ok') |
| `/live/song/start_listen/beat` | - | Subscribe to beat events |
| `/live/song/stop_listen/beat` | - | Unsubscribe from beat events |
| `/live/song/start_playing` | - | Start global transport |
| `/live/song/stop_playing` | - | Stop global transport (pause) |
| `/live/song/continue_playing` | - | Resume transport from current position |
| `/live/clip/fire` | `trackIndex: int`, `clipIndex: int` | Fire clip at track/slot (always slot 0) |
| `/live/clip/stop` | `trackIndex: int`, `clipIndex: int` | Stop clip at track/slot |
| `/live/track/set/mute` | `trackIndex: int`, `mute: int` | Set track mute (1 = muted, 0 = unmuted) |

**AbletonOSC → Server (Port 11001 by default)**

| Address | Arguments | Description |
|---------|-----------|-------------|
| `/live/test` | `response: string` | Connectivity test response (sends 'ok') |
| `/live/song/get/beat` | `beatNumber: int` | Beat event (sent when subscribed) |
| `/live/song/get/tempo` | `bpm: float` | Tempo response |

### Fallback Mode

When AbletonOSC is not connected (no OSC bridge available), the timing engine uses JS timers for all phases:
- Audition timing: `auditionPerOptionMs * auditionLoopsPerOption`
- All other phases: Configured durations in `TimingConfig`

This enables testing and rehearsal without Ableton running. The audio router still sends OSC messages in this mode, but they are not received by any listener.

### Environment Variables

```bash
TIMING_ENGINE_ENABLED=true|false  # Default: true
OSC_ENABLED=true|false            # Default: true
OSC_SEND_PORT=11000               # Port AbletonOSC listens on (default: 11000)
OSC_RECEIVE_PORT=11001            # Port AbletonOSC sends from (default: 11001)
OSC_HOST=127.0.0.1                # AbletonOSC host (for remote setups)
MOCK_BPM=120                      # BPM for mock Ableton simulator (testing only)
```

### Version Check Safety

The timing engine uses **version checking** to prevent stale timer fires:
1. When scheduling a timer, record the current `state.version`
2. When timer fires, compare recorded version to current version
3. If versions differ, skip the automatic advance (manual action took precedence)

This ensures manual controller actions always override automatic timing.

---

## Audio Adapter Interface

The adapter is a pluggable module that translates Conductor events into audio system commands.

```typescript
interface AudioAdapter {
  // Called when show configuration is loaded
  initialize(config: ShowConfig): Promise<void>;
  
  // Called during audition phase
  playOption(rowIndex: number, optionId: OptionId): Promise<void>;
  stopOption(rowIndex: number, optionId: OptionId): Promise<void>;
  
  // Called when a row is committed
  commitLayer(rowIndex: number, optionId: OptionId): Promise<void>;
  
  // Called on coup (remove last committed layer)
  uncommitLayer(rowIndex: number): Promise<void>;
  
  // Called during finale — "The song we wanted"
  playPopularPath(path: OptionId[]): Promise<void>;
  
  // Called during finale — individual timelines
  playPersonalTimeline(path: OptionId[]): Promise<void>;
  
  // Cleanup
  dispose(): Promise<void>;
}

// MVP implementation
class NullAdapter implements AudioAdapter {
  async initialize(config: ShowConfig) { console.log('[Audio] Initialize', config); }
  async playOption(row: number, option: OptionId) { console.log('[Audio] Play', row, option); }
  async stopOption(row: number, option: OptionId) { console.log('[Audio] Stop', row, option); }
  async commitLayer(row: number, option: OptionId) { console.log('[Audio] Commit', row, option); }
  async uncommitLayer(row: number) { console.log('[Audio] Uncommit', row); }
  async playPopularPath(path: OptionId[]) { console.log('[Audio] Popular Path', path); }
  async playPersonalTimeline(path: OptionId[]) { console.log('[Audio] Timeline', path); }
  async dispose() { console.log('[Audio] Dispose'); }
}
```

---

## Folder Structure

```
yggdrasil/
├── ARCHITECTURE.md              # This document (source of truth)
├── CHANGELOG.md                 # Human-readable change history
├── CLAUDE.md                    # Claude Code agent context
├── README.md                    # Setup and run instructions
│
├── conductor/                   # Pure game logic (no I/O)
│   ├── index.ts                 # Exports
│   ├── conductor.ts             # State machine
│   ├── coherence.ts             # Scoring logic
│   ├── coup.ts                  # Coup mechanics
│   ├── assignment.ts            # Faction assignment algorithm
│   ├── types.ts                 # Shared type definitions
│   └── __tests__/               # Unit tests
│
├── server/                      # Custom server (Next.js + Socket.IO)
│   ├── index.ts                 # Entry point — creates HTTP server, attaches Next.js and Socket.IO
│   ├── socket.ts                # Socket.IO event handlers
│   ├── persistence.ts           # SQLite layer
│   ├── recovery.ts              # State recovery and backup logic
│   ├── timing.ts                # Hybrid timing engine (Ableton + JS timers)
│   ├── osc.ts                   # OSC bridge for Ableton communication
│   ├── audio-router.ts          # Maps AUDIO_CUE events to OSC messages
│   ├── __tests__/               # Server unit tests
│   └── tools/
│       └── osc-mock-ableton.ts  # Mock Ableton OSC responder for testing
│
├── app/                         # Next.js App Router (pages)
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Landing/redirect
│   ├── audience/
│   │   └── page.tsx             # Audience UI
│   ├── projector/
│   │   └── page.tsx             # Projector display
│   └── controller/
│       └── page.tsx             # Performer controls
│
├── components/                  # React components
│   ├── SongTree.tsx             # Dual-path tree visualization
│   ├── VoteInterface.tsx        # Two-vote drag interface
│   ├── CoupMeter.tsx            # Faction-only coup progress
│   ├── FigTreeInput.tsx         # Lobby prompt input
│   ├── TiebreakerAnimation.tsx  # Spinning wheel / tie resolution
│   ├── FactionReveal.tsx        # Assignment reveal animation
│   └── FinaleTimeline.tsx       # Individual timeline display
│
├── hooks/                       # React hooks
│   ├── useSocket.ts             # Socket.IO connection + reconnection
│   └── useShowState.ts          # Client-side state management
│
├── lib/                         # Shared utilities
│   ├── socket-client.ts         # Socket.IO client setup
│   └── storage.ts               # localStorage helpers for client identity
│
├── public/                      # Static assets
│
├── config/
│   └── default-show.json        # Pre-configured rows and options
│
├── db/
│   └── schema.sql               # SQLite schema
│
├── next.config.js               # Next.js configuration
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies and scripts
└── .gitignore
```

---

## AI-First Development Practices

### Context Management

This repository is designed to be worked on with AI coding assistants. To maintain coherence:

1. **ARCHITECTURE.md is the source of truth.** If you're an AI agent, read this file first before making any changes. If your changes would contradict this document, update this document first or flag the contradiction.

2. **CHANGELOG.md tracks intent, not just diffs.** Each entry should explain *why* a change was made, not just what changed. Format:
   ```markdown
   ## [Date] — Brief title
   **Context:** Why this change is happening
   **Changes:** What was modified
   **Implications:** What else might need to change as a result
   ```

3. **Types are documentation.** The `conductor/src/types.ts` file defines the shared language. Changes to types should be rare and deliberate.

4. **Test names are specifications.** Write test names as complete sentences that describe behavior:
   ```typescript
   test('a faction that has used their coup cannot vote to coup again', ...)
   test('weighted coherence is applied only on the row where the coup occurred', ...)
   ```

### Making Changes

When an AI agent (or human) needs to modify the system:

1. **Start by stating the goal** in plain language.
2. **Check ARCHITECTURE.md** for relevant sections.
3. **Identify affected components** (Conductor? Server? Client? All three?).
4. **Make changes to types first** if data structures are changing.
5. **Update tests** to reflect new expected behavior.
6. **Update ARCHITECTURE.md** if the change affects system design.
7. **Add CHANGELOG.md entry** explaining the change.

### Handling Design Uncertainty

Some aspects of this system are intentionally deferred (e.g., finale sequencing algorithm, specific musical decisions). When you encounter these:

1. **Don't invent solutions** that aren't specified.
2. **Implement the minimal interface** that allows the feature to be plugged in later.
3. **Add a `// TODO: [description]` comment** at the integration point.
4. **Document the open question** in a `DECISIONS.md` file if one doesn't exist.

### Recovery from Errors

If the codebase gets into a confusing state:

1. **ARCHITECTURE.md is the canonical reference.** Revert code to match the spec, not vice versa.
2. **Run tests.** The Conductor package should have comprehensive unit tests.
3. **Check types compile.** Type errors usually indicate structural problems.
4. **Re-read recent CHANGELOG.md entries** to understand recent evolution.

---

## Open Questions (To Be Resolved)

These items are acknowledged but intentionally deferred:

- [ ] Finale sequencing algorithm (harmonic distance sorting)
- [ ] Specific faction identities/names/colors
- [ ] Exact timing values for each phase
- [ ] Musical content and row configurations
- [ ] Projector visual design and animations
- [ ] Performer controller hardware/UX
- [ ] Deployment environment (local network? cloud?)

---

## Appendix: Example Show Flow

```
1. LOBBY
   - Projector displays thematic excerpt (e.g., "Fig Tree" passage)
   - Audience scans seat-specific QR codes, joins with seatId
   - User sees prompt: "What lives on your fig tree?"
   - User submits their response (stored for finale)
   - Faction is null; users see "waiting" state after submission
   - Performer sees controller: "24 joined" + seat map showing occupied seats
   
2. ASSIGNMENT
   - Performer presses "Assign Factions"
   - Algorithm runs (balance + minimize adjacency)
   - All users receive faction simultaneously
   - Users see faction reveal animation on their phones
   - Projector shows room-wide faction distribution animation

3. ROW 0: AUDITIONING
   - Option 0 plays
   - Option 1 plays
   - Option 2 plays
   - Option 3 plays
   - Performer advances to voting

3. ROW 0: VOTING
   - Audience drags two tokens: faction vote (colored) + personal vote (white)
   - 10 seconds pass (or performer advances)

4. ROW 0: REVEALING
   - Projector shows coherence bars filling
   - Winner announced (highest weighted coherence)
   - Tree path draws from root to winning option

5. ROW 0: COUP WINDOW
   - Faction 2 members see their coup meter
   - 3 of 7 vote to coup → meter at 43%
   - Threshold is 50% → not triggered
   - Window closes, row commits

6. ROW 0: COMMITTED
   - Audio layer locks in
   - Performer advances to Row 1

... (repeat for rows 1–7) ...

7. FINALE — THE SONG WE WANTED
   - Projector transitions from faction path to popular path
   - "The song we wanted" plays: the popular path in full
   - Visual shows the shadow path becoming solid, the faction path fading

8. FINALE — INDIVIDUAL TIMELINES
   - Each user's personal tree highlighted on projector in sequence
   - Their audio path plays (one loop)
   - Their fig tree response (from lobby) appears
   - ~30 iterations, harmonically sorted for smooth transitions

9. ENDED
   - Show concludes
   - Data persisted for analysis
```

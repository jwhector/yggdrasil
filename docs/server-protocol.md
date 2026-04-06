# WebSocket Protocol & Persistence

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (ShowState, ConductorCommand types), [audio-engine.md](audio-engine.md) (environment variables)

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation:
- **Controller**: Full serialized state (all Maps converted to arrays)
- **Projector**: Public filtered state (group sizes, active fragments, vote distributions — no individual user data)
- **Audience**: Personalized state (their granular type assignment, their group's vote distribution, their current vote)

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience (song-building) |
| `dismiss_thought` | `{ thoughtId, direction: 'left' \| 'right' }` | Audience (intrusive thoughts) |
| `select_type` | `{ granularType }` | Audience (self-select assignment) |
| `set_preference` | `{ fragmentId }` | Audience (live mix) |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered per client type) | All |
| `identity` | `{ userId }` | New audience members |
| `group_update` | `{ groupSizes: Array<{ granularType, count }> }` | Audience + Projector (during assignment, ~2 Hz) |
| `assigned` | `{ granularType, groupSize }` | Individual audience member (after assignment) |
| `npc_message` | `{ message: string }` | Audience + Projector |
| `mix_state` | `{ activeFragments, voteDistributions, lockedTypes }` | Audience + Projector + Controller (live mix, ~4 Hz) |
| `type_locked` | `{ granularType }` | Audience + Projector (performer locked a type) |
| `type_unlocked` | `{ granularType }` | Audience + Projector (performer unlocked a type) |
| `audition_progress` | `AuditionProgress` | Audience + Projector (song-building, ~4 Hz) |
| `thoughts_assigned` | `{ thoughts: { id, text }[] }` | Individual audience member (on reveal stakes) |
| `thought_dismissed` | `{ thoughtId, direction }` | Projector (per-dismiss delta) |
| `thoughts_state` | `{ thoughts: { id, text, dismissed }[] }` | Projector (bulk on reveal start + reconnect) |
| `thoughts_clear` | — | Audience + Projector (layer/attempt change) |
| `error` | `{ message }` | Controller |

**Note on group updates:** Sent as a separate event during assignment at ~2 Hz for responsive group size displays, NOT as part of state_sync. The `mix_state` event is high-frequency during live mix to keep the UI responsive.

**Note on intrusive thoughts:** Server distributes thoughts from a shared pool on `REVEAL_STAKES_SHOWN`. Each audience member gets a random subset (1→3→5 escalating per layer). Dismissals are per-thought deltas sent to projector — no bulk polling. Server tracks state in module-level `activeThoughts` array, cleared on layer resolve.

---

## Persistence Layer

### SQLite with WAL Mode

Unchanged from V1.

### Schema

```sql
CREATE TABLE shows (
  id TEXT PRIMARY KEY,
  state JSON NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  seat_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  layer_index INTEGER NOT NULL,
  choice TEXT NOT NULL CHECK(choice IN ('A', 'B')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE finale_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 1,     -- TRUE if auto-assigned or timer-expired
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

CREATE TABLE finale_mix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('preference', 'lock', 'unlock', 'override')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

**Removed in V3.2:** `finale_groups`, `finale_group_votes`, `ceremony_events` tables (deprecated, kept in schema for historical data).

### Persistence Strategy & Recovery

Unchanged from V1. Persist after EVERY state change. Atomic SQLite transactions. Stateless clients. Automatic reconnection with exponential backoff.

**Finale-specific recovery notes:**
- If the assignment timer expires during a server restart, the system fires ASSIGNMENT_COMPLETE to assign remaining users
- Live mix votes and active fragments are held in memory and broadcast at ~4 Hz; preference/lock/unlock/override events are persisted to `finale_mix_events` for audit/recovery
- Audio preview files are static assets and require no server state

# WebSocket Protocol & Persistence

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (ShowState, ConductorCommand types), [audio-engine.md](audio-engine.md) (environment variables)

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation:
- **Controller**: Full serialized state (including per-group vote distributions, ambassador status, altar state)
- **Projector**: Public filtered state (group sizes, vote distributions, ceremony progress — no individual user data)
- **Audience**: Personalized state (their group assignment, their group's votes, their ambassador status, their altar-ready state)

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience (song-building) |
| `join_group` | `{ layerType }` | Audience (assembly phase) |
| `group_vote` | `{ fragmentId }` | Audience (deliberation phase) |
| `volunteer_ambassador` | `{}` | Audience (deliberation phase, after fragment chosen) |
| `altar_lock_in` | `{}` | Audience (ceremony phase, ambassador only) |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered per client type) | All |
| `identity` | `{ userId }` | New audience members |
| `group_update` | `{ groups: Map<LayerType, number>, undecided: number }` | Audience + Projector (during assembly, ~2 Hz) |
| `npc_message` | `{ message: string }` | Audience + Projector |
| `ambassador_called` | `{ layerType, userId }` | All (during ceremony) |
| `altar_ready` | `{}` | Single audience member (the called ambassador) |
| `altar_confirmed` | `{ layerType, fragmentId }` | All (after successful altar lock-in) |
| `error` | `{ message }` | Controller |

**Note on group updates:** Sent as a separate event during assembly at ~2 Hz for responsive group size displays, NOT as part of state_sync.

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

CREATE TABLE finale_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 0,     -- TRUE if randomly assigned at timer expiry
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
  ambassador_user_id TEXT,                       -- NULL if forfeited
  fragment_id TEXT,                               -- NULL if forfeited
  event_type TEXT NOT NULL CHECK(event_type IN ('locked', 'forfeited')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

**Removed from V2:** `consensus_rounds` table.

### Persistence Strategy & Recovery

Unchanged from V1. Persist after EVERY state change. Atomic SQLite transactions. Stateless clients. Automatic reconnection with exponential backoff.

**Finale-specific recovery notes:**
- If an ambassador disconnects during the ceremony, the controller can force-lock-in or forfeit the layer
- If assembly or deliberation timers expire during a server restart, the system should recover to the post-timer state (groups assigned, fragments chosen by majority of recorded votes)
- Audio preview files are static assets and require no server state

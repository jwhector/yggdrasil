# WebSocket Protocol & Persistence

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (ShowState, ConductorCommand types), [audio-engine.md](audio-engine.md) (environment variables)

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation:
- **Controller**: Full serialized state (all Maps converted to arrays)
- **Projector**: Public filtered state (quilt grid, assignment/remix state — no individual user data)
- **Audience**: Personalized state (own cell, own lock-in status, quilt grid, current vote during song-building)

### Client → Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience (song-building) |
| `dismiss_thought` | `{ thoughtId, direction: 'left' \| 'right' }` | Audience (intrusive thoughts) |
| `claim_cell` | `{ cellId }` | Audience (assignment) |
| `release_cell` | — | Audience (assignment) |
| `set_song` | `{ songIndex }` | Audience (preview) |
| `lock_in` | — | Audience (preview) |
| `move_cell` | `{ targetCellId }` | Audience (playback — validated against audienceRemix config) |
| `change_song` | `{ songIndex }` | Audience (playback — only when audienceRemix.allowSongChange=true) |
| `command` | `ConductorCommand` | Controller |

### Server → Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered per client type) | All |
| `identity` | `{ userId }` | New audience members |
| `quilt_state` | `{ cells, columnOrder, playheadColumn, loopCount }` | All (~2 Hz assignment, ~4 Hz playback) |
| `cell_claimed` | `{ cellId, userId }` | Audience + Projector (during assignment) |
| `cell_moved` | `{ cellId, fromPosition, toPosition, swappedWithCellId }` | Audience + Projector (during playback) |
| `playhead_update` | `{ columnIndex }` | All (during playback, on column boundary) |
| `column_reordered` | `{ columnOrder }` | All (during playback) |
| `npc_message` | `{ message: string }` | Audience + Projector |
| `audition_progress` | `AuditionProgress` | Audience + Projector (song-building, ~4 Hz) |
| `thoughts_assigned` | `{ thoughts: { id, text }[] }` | Individual audience member (on reveal stakes) |
| `thought_dismissed` | `{ thoughtId, direction }` | Projector (per-dismiss delta) |
| `thoughts_state` | `{ thoughts: { id, text, dismissed }[] }` | Projector (bulk on reveal start + reconnect) |
| `thoughts_clear` | — | Audience + Projector (layer/attempt change) |
| `error` | `{ message }` | Controller |

**Note on quilt_state:** High-frequency broadcast during assignment and playback phases for responsive grid displays, NOT part of state_sync. During preview the grid is also broadcast so clients see song choices being made.

**Note on intrusive thoughts:** Server distributes thoughts from a shared pool on `REVEAL_STAKES_SHOWN`. Each audience member gets a random subset (1→3→5 escalating per layer). Dismissals are per-thought deltas sent to projector — no bulk polling. Server tracks state in module-level `activeThoughts` array, cleared on layer resolve.

### Removed from V3.2

| Removed Event | Replacement |
|---------------|-------------|
| `select_type` | `claim_cell` (cell includes type via row) |
| `set_preference` | `set_song` (during preview only) |
| `group_update` | `quilt_state` (replaces group size broadcast) |
| `mix_state` | `quilt_state` (replaces per-type vote distributions) |
| `assigned` | `cell_claimed` (per-cell, not per-type) |
| `type_locked` / `type_unlocked` | `cell_locked` / `cell_muted` via state_sync (per-cell, not per-type) |

---

## Persistence Layer

### SQLite with WAL Mode

Unchanged from V1.

### Schema

```sql
-- Core tables (unchanged)
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

-- V3.3: Quilt cell state
CREATE TABLE finale_quilt_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  owner_id TEXT,
  song_index INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  UNIQUE(show_id, cell_id)
);

-- V3.3: Remix events (audience + performer actions during playback)
CREATE TABLE finale_remix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('move', 'reorder', 'swap', 'lock', 'unlock', 'mute', 'unmute', 'override')),
  payload JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

**Deprecated tables (kept for historical data):** `finale_groups`, `finale_group_votes`, `ceremony_events` (V3.1), `finale_assignments`, `finale_mix_events` (V3.2).

### Persistence Strategy & Recovery

Unchanged from V1. Persist after EVERY state change. Atomic SQLite transactions. Stateless clients. Automatic reconnection with exponential backoff.

**Finale-specific recovery notes:**
- If the assignment timer expires during a server restart, the system fires ASSIGNMENT_COMPLETE to assign remaining users
- If the preview timer expires during a server restart, the system fires PREVIEW_COMPLETE and ADVANCE_PHASE
- Quilt cell state is persisted to `finale_quilt_cells` on each claim/song-set for recovery
- Remix events (moves, swaps, locks, mutes, overrides) are persisted to `finale_remix_events` for audit/recovery
- Audio preview files are static assets and require no server state

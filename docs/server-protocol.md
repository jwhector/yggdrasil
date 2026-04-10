# WebSocket Protocol & Persistence

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [data-models.md](data-models.md) (ShowState, ConductorCommand types), [audio-engine.md](audio-engine.md) (environment variables)

---

## WebSocket Protocol

### State Sync Strategy
Full state syncs on every mutation:
- **Controller**: Full serialized state (all Maps converted to arrays)
- **Projector**: Public filtered state (pool counts, active nodes, queue depths, loop state -- no individual user data)
- **Audience**: Personalized state (own vote question, answer count, pool cap status during finale_vote; phones-down during finale_remix)

### Client -> Server Events

| Event | Payload | Sender |
|-------|---------|--------|
| `join` | `{ userId?, seatId?, mode }` | All |
| `reconnect` | `{ userId, showId, lastVersion }` | All |
| `vote` | `{ choice: 'A' \| 'B' }` | Audience (song-building) |
| `dismiss_thought` | `{ thoughtId, direction: 'left' \| 'right' }` | Audience (intrusive thoughts) |
| `submit_emotion` | `{ chapterId, questionIndex }` | Audience (finale_vote -- chapter selection for current question) |
| `command` | `ConductorCommand` | Controller |

### Server -> Client Events

| Event | Payload | Recipients |
|-------|---------|------------|
| `state_sync` | `ShowState` (filtered per client type) | All |
| `identity` | `{ userId }` | New audience members |
| `pool_state` | `{ availableByChapter, totalByChapter, totalRemaining, targetPoolSize }` | Projector + Controller (~2 Hz during finale phases) |
| `node_update` | `{ granularType, chapterId, trackIndex, persistent, queueDepth }` | Projector + Controller (on token activation/queue change) |
| `question` | `{ questionIndex, text }` | Individual audience member (next question during finale_vote) |
| `emotion_confirmed` | `{ chapterId, questionIndex }` | Individual audience member (vote acknowledgment) |
| `phones_down` | -- | Audience (when pool cap reached or remix starts) |
| `npc_message` | `{ message: string }` | Audience + Projector |
| `audition_progress` | `AuditionProgress` | Audience + Projector (song-building, ~4 Hz) |
| `thoughts_assigned` | `{ thoughts: { id, text }[] }` | Individual audience member (on reveal stakes) |
| `thought_dismissed` | `{ thoughtId, direction }` | Projector (per-dismiss delta) |
| `thoughts_state` | `{ thoughts: { id, text, dismissed }[] }` | Projector (bulk on reveal start + reconnect) |
| `thoughts_clear` | -- | Audience + Projector (layer/attempt change) |
| `error` | `{ message }` | Controller |

**Note on pool_state:** High-frequency broadcast during finale phases for responsive pool visualizations, NOT part of state_sync. Serialized as arrays (chapterId/count pairs) for JSON transport.

**Note on node_update:** Emitted on token activation, queue changes, and node silence events. Provides granular type, current chapter, track index, persistence mode, and queue depth for projector pentagon visualization.

**Note on intrusive thoughts:** Server distributes thoughts from a shared pool on `REVEAL_STAKES_SHOWN`. Each audience member gets a random subset (1->3->5 escalating per layer). Dismissals are per-thought deltas sent to projector -- no bulk polling. Server tracks state in module-level `activeThoughts` array, cleared on layer resolve.

### Removed from V3.3

| Removed Event | Replacement |
|---------------|-------------|
| `claim_cell` | Removed -- no cell claiming in V3.4 |
| `release_cell` | Removed -- no cell claiming in V3.4 |
| `set_song` | `submit_emotion` (audience selects chapter, not song index) |
| `lock_in` | Removed -- votes are one-shot, no lock-in needed |
| `move_cell` | Removed -- no cell grid in V3.4 |
| `change_song` | Removed -- no audience remix in V3.4 |
| `quilt_state` | `pool_state` (token pool counts replace quilt grid) |
| `cell_claimed` | Removed -- no cell assignment in V3.4 |
| `cell_moved` | Removed -- no cell grid in V3.4 |
| `playhead_update` | Removed -- loop progress tracked via pool_state |
| `column_reordered` | Removed -- no column grid in V3.4 |

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

-- V3.4: Audience emotional votes (one row per question answered)
CREATE TABLE finale_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- V3.4: Token spend log (for recovery + analytics)
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

**Migration:** The `v34_token_pool_tables` migration (migration 7 in `server/persistence.ts`) creates both V3.4 tables idempotently using `CREATE TABLE IF NOT EXISTS`.

**Deprecated tables (kept for historical data):** `finale_groups`, `finale_group_votes`, `ceremony_events` (V3.1), `finale_assignments`, `finale_mix_events` (V3.2), `finale_quilt_cells`, `finale_remix_events` (V3.3).

### Persistence Strategy & Recovery

Unchanged from V1. Persist after EVERY state change. Atomic SQLite transactions. Stateless clients. Automatic reconnection with exponential backoff.

**Finale-specific recovery notes:**
- Token pool state is reconstructed from the show state JSON on restart
- Emotional votes are persisted to `finale_votes` on each `submit_emotion` for recovery and analytics
- Token events (queue, activate, spend, cancel) are persisted to `finale_token_events` for audit/recovery
- If the server restarts during `finale_vote`, the pool cap and per-user question counts are restored from ShowState
- If the server restarts during `finale_remix`, active nodes and queue state are restored from ShowState; the timing engine resumes loop boundary tracking

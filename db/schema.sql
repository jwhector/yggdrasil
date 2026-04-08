-- Yggdrasil Database Schema (V3.2)
-- SQLite with WAL mode for crash resilience

PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

-- Shows table: stores complete show state as JSON
CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  state JSON NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table: tracks audience members
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  seat_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- Votes table: records all votes for recovery and analysis
CREATE TABLE IF NOT EXISTS votes (
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

-- [DEPRECATED V3.1] Finale groups: records audience group assignments during assembly phase
CREATE TABLE IF NOT EXISTS finale_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- [DEPRECATED V3.1] Finale group votes: records fragment votes during deliberation phase
CREATE TABLE IF NOT EXISTS finale_group_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- [DEPRECATED V3.1] Ceremony events: records lock-ins and forfeits during ceremony phase
CREATE TABLE IF NOT EXISTS ceremony_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,
  ambassador_user_id TEXT,
  fragment_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('locked', 'forfeited')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- [DEPRECATED V3.2] Finale assignments — granular type group assignments
CREATE TABLE IF NOT EXISTS finale_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- [DEPRECATED V3.2] Finale live mix preference events
CREATE TABLE IF NOT EXISTS finale_mix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granular_type TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('preference', 'lock', 'unlock', 'override')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- V3.3: Quilt cell state
CREATE TABLE IF NOT EXISTS finale_quilt_cells (
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
CREATE TABLE IF NOT EXISTS finale_remix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('move', 'reorder', 'swap', 'lock', 'unlock', 'mute', 'unmute', 'override')),
  payload JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_show ON users(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_show ON votes(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_finale_groups_show ON finale_groups(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_group_votes_show ON finale_group_votes(show_id);
CREATE INDEX IF NOT EXISTS idx_ceremony_events_show ON ceremony_events(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_assignments_show ON finale_assignments(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_mix_events_show ON finale_mix_events(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_quilt_cells_show ON finale_quilt_cells(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_remix_events_show ON finale_remix_events(show_id);

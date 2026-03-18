-- Yggdrasil Database Schema (V2)
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

-- Finale groups: records audience group assignments during assembly phase
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

-- Finale group votes: records fragment votes during deliberation phase
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

-- Ceremony events: records lock-ins and forfeits during ceremony phase
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_show ON users(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_show ON votes(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_finale_groups_show ON finale_groups(show_id);
CREATE INDEX IF NOT EXISTS idx_finale_group_votes_show ON finale_group_votes(show_id);
CREATE INDEX IF NOT EXISTS idx_ceremony_events_show ON ceremony_events(show_id);

-- Yggdrasil Database Schema (NEW SYSTEM)
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
  finale_chapter TEXT,                  -- NULL until finale_setup; 'ambition' | 'love' | 'avoidance'
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

-- Fragment selections: finale queue entries
CREATE TABLE IF NOT EXISTS fragment_selections (
  user_id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_show ON users(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_show ON votes(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_fragment_selections_show ON fragment_selections(show_id);

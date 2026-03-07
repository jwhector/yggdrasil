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

-- Consensus rounds: records each finale consensus game round for analysis
CREATE TABLE IF NOT EXISTS consensus_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  winning_fragment_id TEXT,          -- NULL if round failed
  convergence REAL,
  threshold REAL NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_show ON users(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_show ON votes(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_consensus_rounds_show ON consensus_rounds(show_id);

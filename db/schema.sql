-- Yggdrasil Database Schema
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
  faction INTEGER,  -- NULL until assignment
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- Votes table: records all votes for recovery and analysis
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  faction_vote TEXT NOT NULL,
  personal_vote TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Fig tree responses: lobby prompt answers for finale
CREATE TABLE IF NOT EXISTS fig_tree_responses (
  user_id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_show ON users(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_show ON votes(show_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_fig_tree_show ON fig_tree_responses(show_id);

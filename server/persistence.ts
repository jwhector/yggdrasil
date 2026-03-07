/**
 * Persistence Layer
 *
 * Handles all database operations for Yggdrasil.
 * Uses better-sqlite3 with WAL mode for crash resilience.
 *
 * State is persisted as JSON with custom serialization for Maps.
 * Every state change is immediately written to disk (not periodic).
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ShowState, ShowId, UserId, User, LayerVote, SeatId } from '../conductor/types';
import { serializeState, deserializeState } from '../lib/serialization';

// ============================================================================
// Schema Migrations
// ============================================================================

/**
 * Versioned schema migrations. Each runs once, in order, inside a transaction.
 * The DB's PRAGMA user_version tracks which migrations have been applied.
 *
 * Rules:
 * - Never modify an existing migration — always append a new one.
 * - Migrations must be idempotent (safe to re-run on a DB that already had
 *   the change, e.g. from a fresh schema.sql run).
 * - schema.sql defines the "current" table shapes. Migrations handle upgrading
 *   DBs that were created from an older version of schema.sql.
 */
interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/** Helper: returns column names for a table. */
function getColumnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map(c => c.name);
}

/** Helper: returns table names in the DB. */
function getTableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'add_finale_chapter_to_users',
    up: (db) => {
      if (!getColumnNames(db, 'users').includes('finale_chapter')) {
        db.exec('ALTER TABLE users ADD COLUMN finale_chapter TEXT');
      }
    },
  },
  {
    version: 2,
    name: 'v2_schema_update',
    up: (db) => {
      // Drop fragment_selections table (V1 — no longer needed in V2)
      const tables = getTableNames(db);
      if (tables.includes('fragment_selections')) {
        db.exec('DROP TABLE IF EXISTS fragment_selections');
      }

      // Add consensus_rounds table (V2)
      db.exec(`
        CREATE TABLE IF NOT EXISTS consensus_rounds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          winning_fragment_id TEXT,
          convergence REAL,
          threshold REAL NOT NULL,
          success BOOLEAN NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_consensus_rounds_show ON consensus_rounds(show_id)
      `);

      // Note: finale_chapter column left in place on users table for SQLite
      // compatibility (can't drop columns). It is no longer read or written.
    },
  },
];

/**
 * Run any pending migrations in a single transaction.
 * Uses PRAGMA user_version to track the current schema version.
 */
function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  const pending = MIGRATIONS.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      console.log(`[DB] Migration ${migration.version}: ${migration.name}`);
    }
    db.pragma(`user_version = ${pending[pending.length - 1].version}`);
  });

  migrate();
  console.log(`[DB] Schema at version ${pending[pending.length - 1].version} (ran ${pending.length} migration${pending.length > 1 ? 's' : ''})`);
}

// ============================================================================
// Persistence Layer
// ============================================================================

export interface PersistenceLayer {
  saveState(state: ShowState): void;
  loadState(showId: ShowId): ShowState | null;
  getLatestShow(): ShowState | null;
  saveLayerVote(vote: LayerVote, showId: ShowId): void;
  saveUser(user: User, showId: ShowId): void;
  saveConsensusRound(
    showId: ShowId,
    roundNumber: number,
    winningFragmentId: string | null,
    convergence: number,
    threshold: number,
    success: boolean,
  ): void;
  getUsersByShow(showId: ShowId): Pick<User, 'id' | 'seatId'>[];
  close(): void;
}

/**
 * Initialize the database and return persistence layer functions.
 */
export function createPersistence(dbPath: string): PersistenceLayer {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and crash resilience
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Read and execute schema (CREATE TABLE IF NOT EXISTS — safe on existing DBs)
  const schemaPath = join(__dirname, '../db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Run any pending versioned migrations
  runMigrations(db);

  // Prepare statements for better performance
  const stmts = {
    insertShow: db.prepare(`
      INSERT INTO shows (id, state, version, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        version = excluded.version,
        updated_at = CURRENT_TIMESTAMP
    `),

    getShow: db.prepare(`
      SELECT state FROM shows WHERE id = ?
    `),

    getLatestShow: db.prepare(`
      SELECT state FROM shows ORDER BY updated_at DESC LIMIT 1
    `),

    insertUser: db.prepare(`
      INSERT INTO users (id, show_id, seat_id, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        seat_id = excluded.seat_id
    `),

    getUsersByShow: db.prepare(`
      SELECT id, seat_id FROM users WHERE show_id = ?
    `),

    insertVote: db.prepare(`
      INSERT INTO votes (show_id, user_id, attempt_index, layer_index, choice, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    insertConsensusRound: db.prepare(`
      INSERT INTO consensus_rounds (show_id, round_number, winning_fragment_id, convergence, threshold, success, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),
  };

  return {
    /**
     * Save complete show state atomically.
     */
    saveState(state: ShowState): void {
      const serialized = serializeState(state);
      const json = JSON.stringify(serialized);

      const transaction = db.transaction(() => {
        stmts.insertShow.run(state.id, json, state.version);
      });

      transaction();
    },

    /**
     * Load show state by ID.
     */
    loadState(showId: ShowId): ShowState | null {
      const row = stmts.getShow.get(showId) as { state: string } | undefined;

      if (!row) return null;

      return deserializeState(JSON.parse(row.state));
    },

    /**
     * Get the most recently updated show.
     */
    getLatestShow(): ShowState | null {
      const row = stmts.getLatestShow.get() as { state: string } | undefined;

      if (!row) return null;

      return deserializeState(JSON.parse(row.state));
    },

    /**
     * Save a layer vote for analysis / recovery.
     */
    saveLayerVote(vote: LayerVote, showId: ShowId): void {
      stmts.insertVote.run(
        showId,
        vote.userId,
        vote.attemptIndex,
        vote.layerIndex,
        vote.choice
      );
    },

    /**
     * Save or update a user record.
     */
    saveUser(user: User, showId: ShowId): void {
      stmts.insertUser.run(
        user.id,
        showId,
        user.seatId,
      );
    },

    /**
     * Save a consensus round result for analysis.
     */
    saveConsensusRound(
      showId: ShowId,
      roundNumber: number,
      winningFragmentId: string | null,
      convergence: number,
      threshold: number,
      success: boolean,
    ): void {
      stmts.insertConsensusRound.run(
        showId,
        roundNumber,
        winningFragmentId,
        convergence,
        threshold,
        success ? 1 : 0,
      );
    },

    /**
     * Get all users for a show (useful for debugging / recovery).
     * Note: Returns partial User objects — full state comes from ShowState.users.
     */
    getUsersByShow(showId: ShowId): Pick<User, 'id' | 'seatId'>[] {
      const rows = stmts.getUsersByShow.all(showId) as Array<{
        id: UserId;
        seat_id: SeatId | null;
      }>;

      return rows.map(row => ({
        id: row.id,
        seatId: row.seat_id,
      }));
    },

    /**
     * Close database connection.
     */
    close(): void {
      db.close();
    },
  };
}

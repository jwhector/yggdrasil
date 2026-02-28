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
import type { ShowState, ShowId, UserId, User, LayerVote, SeatId, Chapter } from '@/conductor/types';
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
 * - Migrations must be idempotent (safe to re-run on a DB that already has
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
  // Future migrations go here:
  // { version: 2, name: '...', up: (db) => { ... } },
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
  saveFragmentSelection(userId: UserId, fragmentId: string, showId: ShowId): void;
  getUsersByShow(showId: ShowId): User[];
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
      INSERT INTO users (id, show_id, seat_id, finale_chapter, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        seat_id = excluded.seat_id,
        finale_chapter = excluded.finale_chapter
    `),

    getUsersByShow: db.prepare(`
      SELECT id, seat_id, finale_chapter FROM users WHERE show_id = ?
    `),

    insertVote: db.prepare(`
      INSERT INTO votes (show_id, user_id, attempt_index, layer_index, choice, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    insertFragmentSelection: db.prepare(`
      INSERT INTO fragment_selections (user_id, show_id, fragment_id, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        fragment_id = excluded.fragment_id
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
        user.finaleChapter
      );
    },

    /**
     * Save a fragment selection (upsert — one per user).
     */
    saveFragmentSelection(userId: UserId, fragmentId: string, showId: ShowId): void {
      stmts.insertFragmentSelection.run(userId, showId, fragmentId);
    },

    /**
     * Get all users for a show (useful for debugging / recovery).
     * Note: Returns partial User objects — full state comes from ShowState.users.
     */
    getUsersByShow(showId: ShowId): User[] {
      const rows = stmts.getUsersByShow.all(showId) as Array<{
        id: UserId;
        seat_id: SeatId | null;
        finale_chapter: Chapter | null;
      }>;

      return rows.map(row => ({
        id: row.id,
        seatId: row.seat_id,
        finaleChapter: row.finale_chapter,
        connected: false,   // Unknown from DB alone
        joinedAt: 0,        // Unknown from DB alone
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

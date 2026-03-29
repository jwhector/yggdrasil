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
  {
    version: 3,
    name: 'v3_finale_tables',
    up: (db) => {
      const tables = getTableNames(db);

      // Drop old consensus_rounds table (V2 — replaced by group/vote/ceremony tables)
      if (tables.includes('consensus_rounds')) {
        db.exec('DROP TABLE IF EXISTS consensus_rounds');
      }

      // Add finale_groups table (V3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          layer_type TEXT NOT NULL,
          auto_assigned BOOLEAN NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Add finale_group_votes table (V3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_group_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          layer_type TEXT NOT NULL,
          fragment_id TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Add ceremony_events table (V3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS ceremony_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          layer_type TEXT NOT NULL,
          ambassador_user_id TEXT,
          fragment_id TEXT,
          event_type TEXT NOT NULL CHECK(event_type IN ('locked', 'forfeited')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_groups_show ON finale_groups(show_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_group_votes_show ON finale_group_votes(show_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ceremony_events_show ON ceremony_events(show_id)
      `);
    },
  },
  {
    version: 4,
    name: 'v32_finale_assignments',
    up: (db) => {
      // V3.2: granular type assignments (replaces layer-type groups from V3.1)
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          granular_type TEXT NOT NULL,
          auto_assigned BOOLEAN NOT NULL DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_assignments_show ON finale_assignments(show_id)
      `);
    },
  },
  {
    version: 5,
    name: 'v32_finale_mix_events',
    up: (db) => {
      // V3.2: continuous preference tracking during live mix
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_mix_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          granular_type TEXT NOT NULL,
          fragment_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('preference', 'lock', 'unlock', 'override')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_mix_events_show ON finale_mix_events(show_id)
      `);
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
  saveFinaleAssignment(showId: ShowId, userId: UserId, granularType: string, autoAssigned: boolean): void;
  getFinaleAssignments(showId: ShowId): Array<{ userId: UserId; granularType: string; autoAssigned: boolean }>;
  saveMixEvent(showId: ShowId, userId: UserId, granularType: string, fragmentId: string, eventType: string): void;
  getMixEvents(showId: ShowId): Array<{ userId: UserId; granularType: string; fragmentId: string; eventType: string; createdAt: string }>;
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

    insertFinaleAssignment: db.prepare(`
      INSERT INTO finale_assignments (show_id, user_id, granular_type, auto_assigned, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    getFinaleAssignments: db.prepare(`
      SELECT user_id, granular_type, auto_assigned FROM finale_assignments WHERE show_id = ?
    `),

    insertMixEvent: db.prepare(`
      INSERT INTO finale_mix_events (show_id, user_id, granular_type, fragment_id, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    getMixEvents: db.prepare(`
      SELECT user_id, granular_type, fragment_id, event_type, created_at FROM finale_mix_events WHERE show_id = ? ORDER BY created_at ASC
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
     * Save a user's granular type assignment during finale.
     * autoAssigned = true when auto-mode or timer expired.
     */
    saveFinaleAssignment(showId: ShowId, userId: UserId, granularType: string, autoAssigned: boolean): void {
      stmts.insertFinaleAssignment.run(showId, userId, granularType, autoAssigned ? 1 : 0);
    },

    /**
     * Get all finale assignments for a show (for recovery).
     */
    getFinaleAssignments(showId: ShowId): Array<{ userId: UserId; granularType: string; autoAssigned: boolean }> {
      const rows = stmts.getFinaleAssignments.all(showId) as Array<{
        user_id: UserId;
        granular_type: string;
        auto_assigned: number;
      }>;
      return rows.map(r => ({ userId: r.user_id, granularType: r.granular_type, autoAssigned: r.auto_assigned === 1 }));
    },

    /**
     * Save a live mix event (preference change, lock, unlock, override).
     */
    saveMixEvent(showId: ShowId, userId: UserId, granularType: string, fragmentId: string, eventType: string): void {
      stmts.insertMixEvent.run(showId, userId, granularType, fragmentId, eventType);
    },

    /**
     * Get all mix events for a show (for recovery / analysis).
     */
    getMixEvents(showId: ShowId): Array<{ userId: UserId; granularType: string; fragmentId: string; eventType: string; createdAt: string }> {
      const rows = stmts.getMixEvents.all(showId) as Array<{
        user_id: UserId;
        granular_type: string;
        fragment_id: string;
        event_type: string;
        created_at: string;
      }>;
      return rows.map(r => ({
        userId: r.user_id,
        granularType: r.granular_type,
        fragmentId: r.fragment_id,
        eventType: r.event_type,
        createdAt: r.created_at,
      }));
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

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
  {
    version: 6,
    name: 'v33_quilt_tables',
    up: (db) => {
      // V3.3: Quilt cell state (replaces finale_assignments)
      db.exec(`
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
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_quilt_cells_show ON finale_quilt_cells(show_id)
      `);

      // V3.3: Remix events (replaces finale_mix_events)
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_remix_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT,
          event_type TEXT NOT NULL CHECK(event_type IN ('move', 'reorder', 'swap', 'lock', 'unlock', 'mute', 'unmute', 'override')),
          payload JSON NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_remix_events_show ON finale_remix_events(show_id)
      `);
    },
  },
  {
    version: 7,
    name: 'v34_token_pool_tables',
    up: (db) => {
      // V3.4: Audience emotional votes
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          question_index INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_votes_show ON finale_votes(show_id)
      `);

      // V3.4: Token spend log (for recovery + analytics)
      db.exec(`
        CREATE TABLE IF NOT EXISTS finale_token_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          token_id TEXT NOT NULL,
          granular_type TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('queued', 'activated', 'spent', 'cancelled')),
          loop_number INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (show_id) REFERENCES shows(id)
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finale_token_events_show ON finale_token_events(show_id)
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
  // V3.3: Quilt cell persistence
  saveQuiltCell(showId: ShowId, cellId: string, userId: UserId, songIndex: number | null): void;
  getQuiltCells(showId: ShowId): Array<{ cellId: string; userId: UserId; songIndex: number | null }>;
  // V3.3: Remix event persistence (audience + performer actions)
  saveRemixEvent(showId: ShowId, userId: UserId | null, eventType: string, payload: string): void;
  getRemixEvents(showId: ShowId): Array<{ userId: UserId | null; eventType: string; payload: string; createdAt: string }>;
  // V3.4: Finale vote persistence (one row per question answered by an audience member)
  saveFinaleVote(showId: ShowId, userId: UserId, chapterId: string, questionIndex: number): void;
  // V3.4: Token event persistence (for recovery + analytics)
  saveTokenEvent(showId: ShowId, tokenId: string, granularType: string, chapterId: string, eventType: 'queued' | 'activated' | 'spent' | 'cancelled', loopNumber: number | null): void;
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

    // V3.3: Quilt cells — upsert on (show_id, cell_id)
    upsertQuiltCell: db.prepare(`
      INSERT INTO finale_quilt_cells (show_id, cell_id, owner_id, song_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(show_id, cell_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        song_index = excluded.song_index,
        updated_at = CURRENT_TIMESTAMP
    `),

    getQuiltCells: db.prepare(`
      SELECT cell_id, owner_id, song_index FROM finale_quilt_cells WHERE show_id = ?
    `),

    // V3.3: Remix events
    insertRemixEvent: db.prepare(`
      INSERT INTO finale_remix_events (show_id, user_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    getRemixEvents: db.prepare(`
      SELECT user_id, event_type, payload, created_at FROM finale_remix_events WHERE show_id = ? ORDER BY created_at ASC
    `),

    // V3.4: Finale votes
    insertFinaleVote: db.prepare(`
      INSERT INTO finale_votes (show_id, user_id, chapter_id, question_index, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    // V3.4: Token events
    insertTokenEvent: db.prepare(`
      INSERT INTO finale_token_events (show_id, token_id, granular_type, chapter_id, event_type, loop_number, created_at)
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
     * Save or update a quilt cell (V3.3).
     */
    saveQuiltCell(showId: ShowId, cellId: string, userId: UserId, songIndex: number | null): void {
      stmts.upsertQuiltCell.run(showId, cellId, userId, songIndex);
    },

    /**
     * Get all quilt cells for a show (for recovery).
     */
    getQuiltCells(showId: ShowId): Array<{ cellId: string; userId: UserId; songIndex: number | null }> {
      const rows = stmts.getQuiltCells.all(showId) as Array<{
        cell_id: string;
        owner_id: UserId;
        song_index: number | null;
      }>;
      return rows.map(r => ({ cellId: r.cell_id, userId: r.owner_id, songIndex: r.song_index }));
    },

    /**
     * Save a remix event (V3.3 — audience moves + performer operations).
     */
    saveRemixEvent(showId: ShowId, userId: UserId | null, eventType: string, payload: string): void {
      stmts.insertRemixEvent.run(showId, userId, eventType, payload);
    },

    /**
     * Get all remix events for a show (for recovery / analysis).
     */
    getRemixEvents(showId: ShowId): Array<{ userId: UserId | null; eventType: string; payload: string; createdAt: string }> {
      const rows = stmts.getRemixEvents.all(showId) as Array<{
        user_id: UserId | null;
        event_type: string;
        payload: string;
        created_at: string;
      }>;
      return rows.map(r => ({
        userId: r.user_id,
        eventType: r.event_type,
        payload: r.payload,
        createdAt: r.created_at,
      }));
    },

    /**
     * Save an audience emotional vote (V3.4).
     */
    saveFinaleVote(showId: ShowId, userId: UserId, chapterId: string, questionIndex: number): void {
      stmts.insertFinaleVote.run(showId, userId, chapterId, questionIndex);
    },

    /**
     * Save a token lifecycle event (V3.4 — for recovery + analytics).
     */
    saveTokenEvent(showId: ShowId, tokenId: string, granularType: string, chapterId: string, eventType: 'queued' | 'activated' | 'spent' | 'cancelled', loopNumber: number | null): void {
      stmts.insertTokenEvent.run(showId, tokenId, granularType, chapterId, eventType, loopNumber ?? null);
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

/**
 * Persistence Layer
 *
 * Handles all database operations for Yggdrasil.
 * Uses better-sqlite3 with WAL mode for crash resilience.
 *
 * State is persisted as JSON with custom serialization for Maps and Sets.
 * Every state change is immediately written to disk (not periodic).
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  ShowState,
  ShowId,
  UserId,
  User,
  Vote,
  PersonalTree,
  FactionId,
  SeatId,
} from '@/conductor/types';

/**
 * Serializable version of ShowState for JSON storage.
 * Converts Maps and Sets to arrays for JSON compatibility.
 */
interface SerializedShowState {
  id: ShowId;
  version: number;
  lastUpdated: number;
  phase: string;
  currentRowIndex: number;
  rows: any[];
  factions: any[];
  users: Array<[UserId, User]>;
  votes: Vote[];
  personalTrees: Array<[UserId, PersonalTree]>;
  paths: {
    factionPath: string[];
    popularPath: string[];
  };
  config: any;
  pausedPhase: string | null;
}

/**
 * Converts ShowState to JSON-serializable format
 */
function serializeState(state: ShowState): SerializedShowState {
  // Convert faction Sets to arrays
  const serializedFactions = state.factions.map(faction => ({
    ...faction,
    currentRowCoupVotes: Array.from(faction.currentRowCoupVotes),
  }));

  return {
    ...state,
    factions: serializedFactions,
    users: Array.from(state.users.entries()),
    personalTrees: Array.from(state.personalTrees.entries()),
  };
}

/**
 * Converts serialized format back to ShowState
 */
function deserializeState(data: SerializedShowState): ShowState {
  // Convert faction arrays back to Sets
  const factions = data.factions.map(faction => ({
    ...faction,
    currentRowCoupVotes: new Set(faction.currentRowCoupVotes),
  })) as [any, any, any, any];

  return {
    ...data,
    factions,
    users: new Map(data.users),
    personalTrees: new Map(data.personalTrees),
  } as ShowState;
}

export interface PersistenceLayer {
  saveState(state: ShowState): void;
  loadState(showId: ShowId): ShowState | null;
  getLatestShow(): ShowState | null;
  saveVote(vote: Vote, showId: ShowId): void;
  saveUser(user: User, showId: ShowId): void;
  saveFigTreeResponse(userId: UserId, text: string, showId: ShowId): void;
  getUsersByShow(showId: ShowId): User[];
  close(): void;
}

/**
 * Initialize the database and return persistence layer functions
 */
export function createPersistence(dbPath: string): PersistenceLayer {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and crash resilience
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Read and execute schema
  const schemaPath = join(__dirname, '../db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute entire schema at once (SQLite handles multiple statements)
  db.exec(schema);

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
      INSERT INTO users (id, show_id, seat_id, faction, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        seat_id = excluded.seat_id,
        faction = excluded.faction
    `),

    getUsersByShow: db.prepare(`
      SELECT id, seat_id, faction FROM users WHERE show_id = ?
    `),

    insertVote: db.prepare(`
      INSERT INTO votes (show_id, user_id, row_index, attempt, faction_vote, personal_vote, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `),

    insertFigTreeResponse: db.prepare(`
      INSERT INTO fig_tree_responses (user_id, show_id, text, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        text = excluded.text
    `),
  };

  return {
    /**
     * Save complete show state atomically
     */
    saveState(state: ShowState): void {
      const serialized = serializeState(state);
      const json = JSON.stringify(serialized);

      // Use transaction for atomicity
      const transaction = db.transaction(() => {
        stmts.insertShow.run(state.id, json, state.version);
      });

      transaction();
    },

    /**
     * Load show state by ID
     */
    loadState(showId: ShowId): ShowState | null {
      const row = stmts.getShow.get(showId) as { state: string } | undefined;

      if (!row) return null;

      const serialized = JSON.parse(row.state) as SerializedShowState;
      return deserializeState(serialized);
    },

    /**
     * Get the most recently updated show
     */
    getLatestShow(): ShowState | null {
      const row = stmts.getLatestShow.get() as { state: string } | undefined;

      if (!row) return null;

      const serialized = JSON.parse(row.state) as SerializedShowState;
      return deserializeState(serialized);
    },

    /**
     * Save a vote
     */
    saveVote(vote: Vote, showId: ShowId): void {
      stmts.insertVote.run(
        showId,
        vote.userId,
        vote.rowIndex,
        vote.attempt,
        vote.factionVote,
        vote.personalVote
      );
    },

    /**
     * Save or update a user
     */
    saveUser(user: User, showId: ShowId): void {
      stmts.insertUser.run(
        user.id,
        showId,
        user.seatId,
        user.faction
      );
    },

    /**
     * Save fig tree response
     */
    saveFigTreeResponse(userId: UserId, text: string, showId: ShowId): void {
      stmts.insertFigTreeResponse.run(userId, showId, text);
    },

    /**
     * Get all users for a show (useful for debugging/recovery)
     */
    getUsersByShow(showId: ShowId): User[] {
      const rows = stmts.getUsersByShow.all(showId) as Array<{
        id: UserId;
        seat_id: SeatId | null;
        faction: FactionId | null;
      }>;

      // Note: This returns partial User objects (missing connected, joinedAt)
      // In practice, full user state comes from ShowState.users
      return rows.map(row => ({
        id: row.id,
        seatId: row.seat_id,
        faction: row.faction,
        connected: false,  // Unknown from DB
        joinedAt: 0,       // Unknown from DB
      }));
    },

    /**
     * Close database connection
     */
    close(): void {
      db.close();
    },
  };
}

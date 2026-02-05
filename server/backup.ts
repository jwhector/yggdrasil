/**
 * Backup System
 *
 * Creates and manages JSON backups of show state.
 * Used for emergency recovery and pre-show archival.
 */

import { writeFileSync, readFileSync, readdirSync, unlinkSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type { ShowState } from '@/conductor/types';

/**
 * Backup metadata
 */
export interface BackupInfo {
  filepath: string;
  filename: string;
  timestamp: number;
  showId: string;
  version: number;
  phase: string;
}

/**
 * Create a timestamped backup file
 *
 * @param state - Show state to backup
 * @param directory - Directory to save backup in
 * @returns Path to created backup file
 */
export function createBackup(state: ShowState, directory: string): string {
  // Ensure directory exists
  try {
    mkdirSync(directory, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }

  // Generate filename with timestamp and show info
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `yggdrasil-backup-${state.id}-${timestamp}-v${state.version}.json`;
  const filepath = join(directory, filename);

  // Serialize state with proper Map/Set handling
  const serialized = {
    ...state,
    users: Array.from(state.users.entries()),
    personalTrees: Array.from(state.personalTrees.entries()),
    factions: state.factions.map(faction => ({
      ...faction,
      currentRowCoupVotes: Array.from(faction.currentRowCoupVotes),
    })),
    metadata: {
      createdAt: Date.now(),
      backupVersion: 1,
    },
  };

  // Write with pretty formatting for readability
  writeFileSync(filepath, JSON.stringify(serialized, null, 2), 'utf-8');

  return filepath;
}

/**
 * List all backups in a directory, sorted by timestamp (newest first)
 *
 * @param directory - Directory to scan for backups
 * @returns Array of backup info objects
 */
export function listBackups(directory: string): BackupInfo[] {
  try {
    const files = readdirSync(directory);

    const backups = files
      .filter(f => f.startsWith('yggdrasil-backup-') && f.endsWith('.json'))
      .map(filename => {
        const filepath = join(directory, filename);
        const stats = statSync(filepath);

        // Parse filename to extract metadata
        // Format: yggdrasil-backup-{showId}-{timestamp}-v{version}.json
        const parts = filename.replace('.json', '').split('-');
        const versionPart = parts[parts.length - 1]; // "vN"
        const version = parseInt(versionPart.substring(1), 10);

        // Load just enough to get phase (could optimize to not parse entire file)
        const content = readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content);

        return {
          filepath,
          filename,
          timestamp: stats.mtime.getTime(),
          showId: data.id,
          version,
          phase: data.phase,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first

    return backups;
  } catch (err) {
    // Directory doesn't exist or other error
    return [];
  }
}

/**
 * Load a backup file and deserialize to ShowState
 *
 * @param filepath - Path to backup file
 * @returns Restored ShowState
 * @throws Error if file doesn't exist or is invalid
 */
export function loadBackup(filepath: string): ShowState {
  const content = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(content);

  // Deserialize Maps and Sets
  const state: ShowState = {
    ...data,
    users: new Map(data.users),
    personalTrees: new Map(data.personalTrees),
    factions: data.factions.map((faction: any) => ({
      ...faction,
      currentRowCoupVotes: new Set(faction.currentRowCoupVotes),
    })) as [any, any, any, any],
  };

  return state;
}

/**
 * Remove old backups, keeping only the most recent N
 *
 * @param directory - Directory containing backups
 * @param maxCount - Maximum number of backups to keep
 * @returns Number of backups deleted
 */
export function pruneBackups(directory: string, maxCount: number): number {
  const backups = listBackups(directory);

  if (backups.length <= maxCount) {
    return 0;
  }

  const toDelete = backups.slice(maxCount);
  let deletedCount = 0;

  for (const backup of toDelete) {
    try {
      unlinkSync(backup.filepath);
      deletedCount++;
    } catch (err) {
      console.error(`Failed to delete backup ${backup.filename}:`, err);
    }
  }

  return deletedCount;
}

/**
 * Create a backup and prune old ones in one operation
 *
 * @param state - Show state to backup
 * @param directory - Directory to save backup in
 * @param maxBackups - Maximum number of backups to keep (default: 10)
 * @returns Path to created backup file
 */
export function createAndPruneBackup(
  state: ShowState,
  directory: string,
  maxBackups: number = 10
): string {
  const filepath = createBackup(state, directory);
  pruneBackups(directory, maxBackups);
  return filepath;
}

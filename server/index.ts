/**
 * Yggdrasil Custom Server
 * 
 * This file creates an HTTP server that:
 * 1. Serves Next.js pages (app/ routes)
 * 2. Handles Socket.IO connections (real-time events)
 * 3. Manages SQLite persistence
 * 4. Runs the Conductor (game logic)
 * 
 * Start with: npm run dev (development) or npm run start (production)
 */

import { createServer } from 'http';
import { parse } from 'url';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import type { ShowState, ShowConfig, ConductorEvent } from '../conductor/types';
import { createInitialState } from '../conductor';
import { createPersistence } from './persistence';
import { setupSocketHandlers } from './socket';
import { createAndPruneBackup } from './backup';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Paths
const DATA_DIR = './data';
const DB_PATH = join(DATA_DIR, 'yggdrasil.db');
const BACKUPS_DIR = join(DATA_DIR, 'backups');
const CONFIG_PATH = join(process.cwd(), 'config', 'default-show.json');

// Backup configuration
const PERIODIC_BACKUP_ENABLED = process.env.PERIODIC_BACKUP === 'true';
const PERIODIC_BACKUP_INTERVAL_MS = parseInt(process.env.PERIODIC_BACKUP_INTERVAL_MS || '300000', 10); // Default: 5 minutes
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '10', 10);

async function main() {
  // Initialize Next.js
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  
  await app.prepare();
  
  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });
  
  // Attach Socket.IO
  const io = new SocketIOServer(server, {
    cors: {
      origin: dev ? '*' : false,
    },
    // Reconnection settings
    pingTimeout: 5000,
    pingInterval: 15000,
  });
  
  // Ensure data directories exist
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (err) {
    // Directories might already exist
  }

  // Initialize persistence
  console.log('[Server] Initializing persistence layer...');
  const persistence = createPersistence(DB_PATH);

  // Load or create show state
  let currentState: ShowState;
  const existingShow = persistence.getLatestShow();

  if (existingShow) {
    console.log(`[Server] Loaded existing show: ${existingShow.id} (version ${existingShow.version})`);
    console.log(`[Server] Show phase: ${existingShow.phase}, Row: ${existingShow.currentRowIndex}`);
    currentState = existingShow;
  } else {
    console.log('[Server] No existing show found, creating new show from config...');

    // Load show configuration
    const configJson = readFileSync(CONFIG_PATH, 'utf-8');
    const config: ShowConfig = JSON.parse(configJson);

    // Create initial state
    const showId = `show-${Date.now()}`;
    currentState = createInitialState(config, showId);

    // Persist initial state
    persistence.saveState(currentState);
    console.log(`[Server] Created new show: ${showId}`);
  }

  // State management functions for socket handlers
  function getState(): ShowState {
    return currentState;
  }

  function setState(state: ShowState, events: ConductorEvent[]): void {
    currentState = state;

    // Create backup on phase transitions
    if (events.some(e => e.type === 'SHOW_PHASE_CHANGED')) {
      const phaseEvent = events.find(e => e.type === 'SHOW_PHASE_CHANGED') as any;

      // Backup when transitioning to running or finale
      if (phaseEvent.phase === 'running' || phaseEvent.phase === 'finale') {
        try {
          const backupPath = createAndPruneBackup(state, BACKUPS_DIR, 10);
          console.log(`[Backup] Created backup: ${backupPath}`);
        } catch (err) {
          console.error('[Backup] Failed to create backup:', err);
        }
      }
    }
  }

  // Setup socket handlers
  console.log('[Server] Setting up Socket.IO handlers...');
  setupSocketHandlers(io, getState, setState, persistence);

  // Optional: Periodic backup system
  let periodicBackupInterval: NodeJS.Timeout | null = null;

  if (PERIODIC_BACKUP_ENABLED) {
    console.log(`[Backup] Periodic backups enabled (interval: ${PERIODIC_BACKUP_INTERVAL_MS}ms)`);

    periodicBackupInterval = setInterval(() => {
      const state = getState();

      // Only backup during running phase to avoid cluttering with lobby backups
      if (state.phase === 'running') {
        try {
          const backupPath = createAndPruneBackup(state, BACKUPS_DIR, MAX_BACKUPS);
          console.log(`[Backup] Periodic backup created: ${backupPath}`);
        } catch (err) {
          console.error('[Backup] Failed to create periodic backup:', err);
        }
      }
    }, PERIODIC_BACKUP_INTERVAL_MS);
  }

  // Cleanup on shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down gracefully...');

    if (periodicBackupInterval) {
      clearInterval(periodicBackupInterval);
    }

    // Final backup before shutdown
    try {
      const state = getState();
      const backupPath = createAndPruneBackup(state, BACKUPS_DIR, MAX_BACKUPS);
      console.log(`[Backup] Shutdown backup created: ${backupPath}`);
    } catch (err) {
      console.error('[Backup] Failed to create shutdown backup:', err);
    }

    persistence.close();
    console.log('[Server] Database closed');

    process.exit(0);
  });

  // Start server
  server.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      YGGDRASIL                            ║
║              Interactive Performance System               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at http://${hostname}:${port}                  ║
║                                                           ║
║  Routes:                                                  ║
║    /audience    - Audience member UI                      ║
║    /projector   - Projector display                       ║
║    /controller  - Performer controls                      ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

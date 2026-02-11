/**
 * Yggdrasil Custom Server
 * 
 * This file creates an HTTP server that:
 * 1. Serves Next.js pages (app/ routes)
 * 2. Handles Socket.IO connections (real-time events)
 * 3. Manages SQLite persistence
 * 4. Runs the Conductor (game logic)
 * 5. 
 * 
 * Start with: npm run dev (development) or npm run start (production)
 */

import { config as dotenvConfig } from 'dotenv';
import path, { resolve } from 'path';

// Load environment variables from .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

import { createServer } from 'http';
import { parse } from 'url';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import type { ShowState, ShowConfig, ConductorEvent, ConductorCommand } from '../conductor/types';
import { createInitialState, processCommand } from '../conductor';
import { createPersistence } from './persistence';
import { setupSocketHandlers, broadcastEvents } from './socket';
import { createAndPruneBackup } from './backup';
import { createOSCBridge, createNullOSCBridge, type OSCBridge } from './osc';
import { createTimingEngine, type TimingEngine } from './timing';
import { createAudioRouter, type AudioRouter } from './audio-router';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || 'localhost';
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

// Timing engine and OSC configuration
const TIMING_ENGINE_ENABLED = process.env.TIMING_ENGINE_ENABLED !== 'false'; // Default: true
const OSC_ENABLED = process.env.OSC_ENABLED !== 'false'; // Default: true
const OSC_SEND_PORT = parseInt(process.env.OSC_SEND_PORT || '11000', 10);
const OSC_RECEIVE_PORT = parseInt(process.env.OSC_RECEIVE_PORT || '11001', 10);
const ABLETON_HOST = process.env.ABLETON_HOST || '127.0.0.1';

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
    const configJson = readFileSync(path.resolve(__dirname, CONFIG_PATH), 'utf-8');
    console.log(`[Server] Loaded config: ${path.resolve(__dirname, CONFIG_PATH)}`);
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

  // Hooks for state change notifications (registered by timing engine and OSC)
  const stateChangeHooks: Array<(state: ShowState, events: ConductorEvent[]) => void> = [];

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

    // Call registered hooks
    for (const hook of stateChangeHooks) {
      try {
        hook(state, events);
      } catch (err) {
        console.error('[Server] State change hook error:', err);
      }
    }
  }

  // Factory to create a fresh show from config
  function createNewShow(): ShowState {
    const configJson = readFileSync(path.resolve(__dirname, CONFIG_PATH), 'utf-8');
    const config: ShowConfig = JSON.parse(configJson);
    const showId = `show-${Date.now()}`;
    const newState = createInitialState(config, showId);
    console.log(`[Server] Created new show from config: ${showId}`);
    return newState;
  }

  // Setup socket handlers
  console.log('[Server] Setting up Socket.IO handlers...');
  setupSocketHandlers(io, getState, setState, persistence, createNewShow);

  // ============================================================================
  // OSC Bridge and Timing Engine Setup
  // ============================================================================

  // Create OSC bridge (or null bridge if OSC disabled)
  let oscBridge: OSCBridge;
  if (OSC_ENABLED) {
    console.log('[Server] Creating OSC bridge...');
    oscBridge = createOSCBridge({
      sendPort: OSC_SEND_PORT,
      receivePort: OSC_RECEIVE_PORT,
      abletonHost: ABLETON_HOST,
    });
  } else {
    console.log('[Server] OSC disabled, using null bridge');
    oscBridge = createNullOSCBridge();
  }

  // Create unified command processor for timing engine
  // This processes a command, persists state, and broadcasts to all clients
  async function processCommandAndBroadcast(command: ConductorCommand): Promise<void> {
    const state = getState();
    const events = processCommand(state, command);
    setState(state, events);
    persistence.saveState(state);
    await broadcastEvents(io, events, state);
  }

  // Create timing engine
  let timingEngine: TimingEngine | null = null;
  if (TIMING_ENGINE_ENABLED) {
    console.log('[Server] Creating timing engine...');
    timingEngine = createTimingEngine(
      (command) => {
        // Fire-and-forget async command processing
        processCommandAndBroadcast(command).catch(err => {
          console.error('[Timing] Error processing command:', err);
        });
      },
      getState,
      {
        enabled: true,
        oscBridge: OSC_ENABLED ? oscBridge : null,
      }
    );
  }

  // Register timing engine hook
  if (timingEngine) {
    stateChangeHooks.push((state, events) => {
      timingEngine!.onStateChanged(state, events);
    });
  }

  // Create and register audio router
  const audioRouter = createAudioRouter(oscBridge);
  stateChangeHooks.push((state, events) => {
    audioRouter.handleStateChange(state, events);
  });

  // Start OSC bridge and timing engine
  try {
    await oscBridge.start();
    console.log(`[Server] OSC bridge started (send: ${OSC_SEND_PORT}, receive: ${OSC_RECEIVE_PORT})`);
  } catch (err) {
    console.error('[Server] Failed to start OSC bridge:', err);
    console.log('[Server] Continuing without OSC...');
  }

  if (timingEngine) {
    timingEngine.start();
    console.log('[Server] Timing engine started');
  }

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

    // Stop timing engine
    if (timingEngine) {
      timingEngine.dispose();
      console.log('[Server] Timing engine stopped');
    }

    // Stop audio router
    audioRouter.dispose();
    console.log('[Server] Audio router stopped');

    // Stop OSC bridge
    oscBridge.stop();
    console.log('[Server] OSC bridge stopped');

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
  server.listen(port, hostname, () => {
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
║                                                           ║
║  Network Access: ${hostname === '0.0.0.0' ? 'Enabled (all interfaces)' : 'Local only'}          ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

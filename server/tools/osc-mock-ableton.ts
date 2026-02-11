#!/usr/bin/env node
/**
 * Mock AbletonOSC - OSC responder for testing without Ableton Live
 *
 * Simulates AbletonOSC plugin behavior for development and testing.
 * Listens on port 11000 for messages from Yggdrasil server.
 * Sends responses to port 11001.
 *
 * Features:
 * - Beat event generation at configurable BPM
 * - Clip fire/stop/mute simulation
 * - Transport control (play/stop/continue)
 * - Test message responses
 *
 * Usage: npm run mock:ableton
 */

import * as dgram from 'dgram';
import { encodeOSCMessage, decodeOSCMessage } from '../osc';

// ============================================================================
// Configuration
// ============================================================================

const LISTEN_PORT = parseInt(process.env.OSC_SEND_PORT || '11000', 10);
const RESPOND_PORT = parseInt(process.env.OSC_RECEIVE_PORT || '11001', 10);
const RESPOND_HOST = '127.0.0.1';
const BPM = parseFloat(process.env.MOCK_BPM || '120');
const MS_PER_BEAT = 60000 / BPM;

// ============================================================================
// Color helpers for logging
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(category: string, color: string, message: string, ...args: any[]) {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}[${category}]${colors.reset} ${message}`, ...args);
}

// ============================================================================
// Mock AbletonOSC State
// ============================================================================

interface MockState {
  beatInterval: NodeJS.Timeout | null;
  currentBeat: number;
  transportPlaying: boolean;
  beatListenersActive: boolean;
  firedClips: Set<string>;      // "trackIndex:clipIndex"
  mutedTracks: Set<number>;      // Track indices that are muted
}

const mockState: MockState = {
  beatInterval: null,
  currentBeat: 0,
  transportPlaying: false,
  beatListenersActive: false,
  firedClips: new Set(),
  mutedTracks: new Set(),
};

// ============================================================================
// Mock AbletonOSC Server
// ============================================================================

let receiveSocket: dgram.Socket | null = null;
let sendSocket: dgram.Socket | null = null;

/**
 * Send an OSC message back to the server
 */
function sendToServer(address: string, ...args: (string | number | boolean)[]) {
  if (!sendSocket) {
    log('ERROR', colors.red, 'Cannot send - socket not initialized');
    return;
  }

  try {
    const message = encodeOSCMessage(address, args);
    sendSocket.send(message, RESPOND_PORT, RESPOND_HOST, (err) => {
      if (err) {
        log('ERROR', colors.red, `Failed to send ${address}:`, err.message);
      } else {
        log('SEND', colors.green, `→ ${address}`, args.length > 0 ? args : '');
      }
    });
  } catch (err: any) {
    log('ERROR', colors.red, `Failed to encode ${address}:`, err.message);
  }
}

/**
 * Start beat listener (sends beat events at BPM rate)
 */
function startBeatListener() {
  if (mockState.beatInterval) {
    log('WARN', colors.yellow, 'Beat listener already running');
    return;
  }

  mockState.beatListenersActive = true;
  mockState.currentBeat = 0;

  mockState.beatInterval = setInterval(() => {
    if (mockState.transportPlaying) {
      mockState.currentBeat++;
      sendToServer('/live/song/get/beat', mockState.currentBeat);
    }
  }, MS_PER_BEAT);

  log('MOCK', colors.magenta, `Beat listener started (${BPM} BPM, ${MS_PER_BEAT.toFixed(1)}ms per beat)`);
}

/**
 * Stop beat listener
 */
function stopBeatListener() {
  if (mockState.beatInterval) {
    clearInterval(mockState.beatInterval);
    mockState.beatInterval = null;
  }
  mockState.beatListenersActive = false;
  log('MOCK', colors.magenta, 'Beat listener stopped');
}

/**
 * Start transport (begin sending beats)
 */
function startTransport() {
  if (!mockState.transportPlaying) {
    mockState.transportPlaying = true;
    mockState.currentBeat = 0;
    log('MOCK', colors.blue, 'Transport started');
  }
}

/**
 * Stop transport (pause beat events)
 */
function stopTransport() {
  if (mockState.transportPlaying) {
    mockState.transportPlaying = false;
    log('MOCK', colors.blue, 'Transport stopped');
  }
}

/**
 * Continue transport (resume from current position)
 */
function continueTransport() {
  if (!mockState.transportPlaying) {
    mockState.transportPlaying = true;
    log('MOCK', colors.blue, 'Transport continued');
  }
}

/**
 * Handle incoming messages from the Yggdrasil server
 */
function handleMessage(address: string, args: any[]) {
  switch (address) {
    case '/live/test': {
      log('RECV', colors.cyan, '← /live/test');
      sendToServer('/live/test', 'ok');
      break;
    }

    case '/live/song/start_listen/beat': {
      log('RECV', colors.cyan, '← /live/song/start_listen/beat');
      startBeatListener();
      break;
    }

    case '/live/song/stop_listen/beat': {
      log('RECV', colors.cyan, '← /live/song/stop_listen/beat');
      stopBeatListener();
      break;
    }

    case '/live/song/start_playing': {
      log('RECV', colors.cyan, '← /live/song/start_playing');
      startTransport();
      break;
    }

    case '/live/song/stop_playing': {
      log('RECV', colors.cyan, '← /live/song/stop_playing');
      stopTransport();
      break;
    }

    case '/live/song/continue_playing': {
      log('RECV', colors.cyan, '← /live/song/continue_playing');
      continueTransport();
      break;
    }

    case '/live/song/get/tempo': {
      log('RECV', colors.cyan, '← /live/song/get/tempo');
      sendToServer('/live/song/get/tempo', BPM);
      break;
    }

    case '/live/song/get/num_tracks': {
      log('RECV', colors.cyan, '← /live/song/get/num_tracks');
      sendToServer('/live/song/get/num_tracks', 32);
      break;
    }

    case '/live/clip/fire': {
      const [trackIndex, clipIndex] = args;
      log('RECV', colors.cyan, '← /live/clip/fire', `track=${trackIndex} clip=${clipIndex}`);
      const clipKey = `${trackIndex}:${clipIndex}`;
      mockState.firedClips.add(clipKey);
      log('MOCK', colors.yellow, `  Clip fired: track ${trackIndex}, slot ${clipIndex}`);
      break;
    }

    case '/live/clip/stop': {
      const [trackIndex, clipIndex] = args;
      log('RECV', colors.cyan, '← /live/clip/stop', `track=${trackIndex} clip=${clipIndex}`);
      const clipKey = `${trackIndex}:${clipIndex}`;
      mockState.firedClips.delete(clipKey);
      log('MOCK', colors.yellow, `  Clip stopped: track ${trackIndex}, slot ${clipIndex}`);
      break;
    }

    case '/live/track/set/mute': {
      const [trackIndex, mute] = args;
      const muteState = mute === 1 ? 'muted' : 'unmuted';
      log('RECV', colors.cyan, '← /live/track/set/mute', `track=${trackIndex} mute=${muteState}`);

      if (mute === 1) {
        mockState.mutedTracks.add(trackIndex);
      } else {
        mockState.mutedTracks.delete(trackIndex);
      }

      log('MOCK', colors.yellow, `  Track ${trackIndex} ${muteState}`);
      break;
    }

    case '/live/track/get/mute': {
      const [trackIndex] = args;
      log('RECV', colors.cyan, '← /live/track/get/mute', `track=${trackIndex}`);
      const mute = mockState.mutedTracks.has(trackIndex) ? 1 : 0;
      sendToServer('/live/track/get/mute', trackIndex, mute);
      break;
    }

    default:
      log('RECV', colors.dim, `← ${address}`, args);
      if (!address.includes('/get/')) {
        log('WARN', colors.yellow, `  Unknown address: ${address}`);
      }
  }
}

/**
 * Start the mock AbletonOSC server
 */
function start() {
  console.log(`
${colors.bright}${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║              Mock AbletonOSC Server                       ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

  log('INFO', colors.green, `Configuration:`);
  log('INFO', colors.green, `  Listen on port ${LISTEN_PORT} (receives from Yggdrasil)`);
  log('INFO', colors.green, `  Send to ${RESPOND_HOST}:${RESPOND_PORT} (responds to Yggdrasil)`);
  log('INFO', colors.green, `  BPM: ${BPM} (${MS_PER_BEAT.toFixed(1)}ms per beat)`);
  console.log();

  // Create send socket
  sendSocket = dgram.createSocket('udp4');

  // Create receive socket
  receiveSocket = dgram.createSocket('udp4');

  receiveSocket.on('error', (err) => {
    log('ERROR', colors.red, 'Socket error:', err.message);
    process.exit(1);
  });

  receiveSocket.on('message', (msg) => {
    const decoded = decodeOSCMessage(msg);
    if (decoded) {
      handleMessage(decoded.address, decoded.args);
    }
  });

  receiveSocket.on('listening', () => {
    const addr = receiveSocket!.address();
    log('INFO', colors.green, `Listening on ${addr.address}:${addr.port}`);
    console.log();
    log('INFO', colors.bright, `Waiting for messages from Yggdrasil server...`);
    console.log();
  });

  receiveSocket.bind(LISTEN_PORT);
}

/**
 * Stop the mock server
 */
function stop() {
  console.log();
  log('INFO', colors.yellow, 'Shutting down...');

  stopBeatListener();

  if (receiveSocket) {
    receiveSocket.close();
    receiveSocket = null;
  }

  if (sendSocket) {
    sendSocket.close();
    sendSocket = null;
  }

  process.exit(0);
}

// Handle shutdown
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Start the server
start();

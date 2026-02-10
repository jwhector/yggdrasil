#!/usr/bin/env node
/**
 * Mock Ableton - OSC responder for testing without Ableton Live
 *
 * Listens on port 9001 for /ygg/* messages from Yggdrasil server.
 * Simulates Ableton responses by sending /ableton/* messages to port 9000.
 *
 * Usage: npm run mock:ableton
 */

import * as dgram from 'dgram';
import { encodeOSCMessage, decodeOSCMessage } from '../osc';

// ============================================================================
// Configuration
// ============================================================================

const LISTEN_PORT = parseInt(process.env.OSC_SEND_PORT || '9001', 10);
const RESPOND_PORT = parseInt(process.env.OSC_RECEIVE_PORT || '9000', 10);
const RESPOND_HOST = '127.0.0.1';
const AUDITION_RESPONSE_DELAY_MS = parseInt(process.env.MOCK_AUDITION_DELAY_MS || '2000', 10);

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
// Mock Ableton Server
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
 * Handle incoming /ygg/* messages from the server
 */
function handleMessage(address: string, args: any[]) {
  switch (address) {
    case '/ygg/audition/start': {
      const [rowIndex, optionIndex, optionId] = args;
      log('RECV', colors.cyan, `← /ygg/audition/start`, `row=${rowIndex} option=${optionIndex} id=${optionId}`);
      log('MOCK', colors.yellow, `  Simulating audio playback for ${AUDITION_RESPONSE_DELAY_MS}ms...`);

      // Simulate audition playback, then send completion
      setTimeout(() => {
        log('MOCK', colors.yellow, `  Audition complete for row ${rowIndex}, option ${optionIndex}`);
        sendToServer('/ableton/audition/done', rowIndex, optionIndex);
      }, AUDITION_RESPONSE_DELAY_MS);
      break;
    }

    case '/ygg/audition/stop': {
      const [rowIndex, optionIndex] = args;
      log('RECV', colors.cyan, `← /ygg/audition/stop`, `row=${rowIndex} option=${optionIndex}`);
      break;
    }

    case '/ygg/layer/commit': {
      const [rowIndex, optionId] = args;
      log('RECV', colors.cyan, `← /ygg/layer/commit`, `row=${rowIndex} id=${optionId}`);
      log('MOCK', colors.magenta, `  Layer committed: ${optionId}`);
      break;
    }

    case '/ygg/layer/uncommit': {
      const [rowIndex] = args;
      log('RECV', colors.cyan, `← /ygg/layer/uncommit`, `row=${rowIndex}`);
      log('MOCK', colors.magenta, `  Layer removed from row ${rowIndex}`);
      break;
    }

    case '/ygg/show/pause': {
      log('RECV', colors.cyan, `← /ygg/show/pause`);
      log('MOCK', colors.blue, `  Show paused`);
      break;
    }

    case '/ygg/show/resume': {
      log('RECV', colors.cyan, `← /ygg/show/resume`);
      log('MOCK', colors.blue, `  Show resumed`);
      break;
    }

    case '/ygg/finale/popular': {
      const [path] = args;
      log('RECV', colors.cyan, `← /ygg/finale/popular`, `path=${path}`);
      log('MOCK', colors.magenta, `  Playing popular path song`);
      break;
    }

    case '/ygg/finale/timeline': {
      const [userId, path] = args;
      log('RECV', colors.cyan, `← /ygg/finale/timeline`, `user=${userId} path=${path}`);
      log('MOCK', colors.magenta, `  Playing individual timeline for ${userId}`);
      break;
    }

    default:
      log('RECV', colors.dim, `← ${address}`, args);
      log('WARN', colors.yellow, `  Unknown address: ${address}`);
  }
}

/**
 * Start the mock Ableton server
 */
function start() {
  console.log(`
${colors.bright}${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║                   Mock Ableton OSC Server                 ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

  log('INFO', colors.green, `Configuration:`);
  log('INFO', colors.green, `  Listen on port ${LISTEN_PORT} (receives from Yggdrasil)`);
  log('INFO', colors.green, `  Send to ${RESPOND_HOST}:${RESPOND_PORT} (responds to Yggdrasil)`);
  log('INFO', colors.green, `  Audition delay: ${AUDITION_RESPONSE_DELAY_MS}ms`);
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

    // Send ready message
    setTimeout(() => {
      sendToServer('/ableton/ready');
    }, 500);
  });

  receiveSocket.bind(LISTEN_PORT);
}

/**
 * Stop the mock server
 */
function stop() {
  console.log();
  log('INFO', colors.yellow, 'Shutting down...');

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

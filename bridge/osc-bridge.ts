#!/usr/bin/env ts-node
/**
 * OSC Bridge Client — Standalone script for the performer's laptop.
 *
 * Connects to the Yggdrasil server via Socket.IO and relays OSC messages
 * between the server and Ableton Live running locally.
 *
 * Server → (Socket.IO: osc_send) → This script → (UDP) → Ableton (port 11000)
 * Ableton → (UDP: port 11001) → This script → (Socket.IO: osc_receive) → Server
 *
 * Usage:
 *   SERVER_URL=https://your-app.up.railway.app npm run bridge
 *
 * Environment variables:
 *   SERVER_URL         — Yggdrasil server URL (required)
 *   OSC_SEND_PORT      — UDP port to send to Ableton (default: 11000)
 *   OSC_RECEIVE_PORT   — UDP port to receive from Ableton (default: 11001)
 *   ABLETON_HOST       — Ableton host address (default: 127.0.0.1)
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
dotenvConfig({ path: resolve(process.cwd(), '.env') });

import * as dgram from 'dgram';
import { io, Socket } from 'socket.io-client';
import { encodeOSCMessage, decodeOSCMessage } from '../lib/osc-codec';

// Configuration
const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) {
  console.error('[Bridge] ERROR: SERVER_URL environment variable is required');
  console.error('[Bridge] Usage: SERVER_URL=https://your-app.up.railway.app npm run bridge');
  process.exit(1);
}

const OSC_SEND_PORT = parseInt(process.env.OSC_SEND_PORT || '11000', 10);
const OSC_RECEIVE_PORT = parseInt(process.env.OSC_RECEIVE_PORT || '11001', 10);
const ABLETON_HOST = process.env.ABLETON_HOST || '127.0.0.1';

// Stats tracking
let messagesSent = 0;
let messagesReceived = 0;

// ============================================================================
// UDP sockets for local Ableton communication
// ============================================================================

const sendSocket = dgram.createSocket('udp4');
const receiveSocket = dgram.createSocket('udp4');

receiveSocket.on('error', (err) => {
  console.error('[Bridge] UDP receive error:', err);
});

receiveSocket.on('message', (msg, rinfo) => {
  const message = decodeOSCMessage(msg);
  if (!message) return;

  messagesReceived++;
  console.log(`[Bridge] Ableton → Server: ${message.address}`, message.args);

  // Forward to server via Socket.IO
  if (socket.connected) {
    socket.emit('osc_receive', { address: message.address, args: message.args });
  }
});

// ============================================================================
// Socket.IO connection to Yggdrasil server
// ============================================================================

console.log(`[Bridge] Connecting to ${SERVER_URL}...`);

const socket: Socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
});

socket.on('connect', () => {
  console.log(`[Bridge] Connected to server (socket: ${socket.id})`);

  // Join as osc-bridge client
  socket.emit('join', { mode: 'osc-bridge' });
  console.log('[Bridge] Joined as osc-bridge client');
});

socket.on('disconnect', (reason) => {
  console.warn(`[Bridge] Disconnected from server: ${reason}`);
});

socket.on('connect_error', (err) => {
  console.error(`[Bridge] Connection error: ${err.message}`);
});

// Listen for OSC messages from server → relay to Ableton via UDP
socket.on('osc_send', (data: { address: string; args: any[] }) => {
  if (!data?.address) return;

  messagesSent++;
  console.log(`[Bridge] Server → Ableton: ${data.address}`, data.args);

  try {
    const buffer = encodeOSCMessage(data.address, data.args);
    sendSocket.send(buffer, OSC_SEND_PORT, ABLETON_HOST, (err) => {
      if (err) {
        console.error(`[Bridge] UDP send error for ${data.address}:`, err);
      }
    });
  } catch (err) {
    console.error(`[Bridge] Encode error for ${data.address}:`, err);
  }
});


// ============================================================================
// Start UDP receive socket
// ============================================================================

receiveSocket.bind(OSC_RECEIVE_PORT, () => {
  const addr = receiveSocket.address();
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  YGGDRASIL OSC BRIDGE                    ║
╠═══════════════════════════════════════════════════════════╣
║  Server:     ${SERVER_URL.padEnd(42)}║
║  Ableton:    ${ABLETON_HOST}:${OSC_SEND_PORT}${' '.repeat(Math.max(0, 34 - ABLETON_HOST.length - String(OSC_SEND_PORT).length))}║
║  Listening:  ${addr.address}:${addr.port}${' '.repeat(Math.max(0, 34 - addr.address.length - String(addr.port).length))}║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// ============================================================================
// Periodic stats
// ============================================================================

setInterval(() => {
  if (messagesSent > 0 || messagesReceived > 0) {
    console.log(`[Bridge] Stats: ${messagesSent} sent to Ableton, ${messagesReceived} received from Ableton`);
    messagesSent = 0;
    messagesReceived = 0;
  }
}, 30000);

// ============================================================================
// Graceful shutdown
// ============================================================================

process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down...');
  socket.disconnect();
  receiveSocket.close();
  sendSocket.close();
  process.exit(0);
});

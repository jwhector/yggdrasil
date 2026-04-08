/**
 * OSC Bridge - Bidirectional Communication with Ableton Live
 *
 * Provides OSC (Open Sound Control) communication between Yggdrasil and Ableton Live.
 *
 * Three bridge types:
 * - Local UDP bridge: Direct UDP to Ableton on the same machine (dev/local mode)
 * - Remote bridge: Relays OSC over Socket.IO to a bridge client running alongside Ableton
 * - Null bridge: Mock for testing without Ableton
 *
 * Server → Ableton: Commands to control audio playback
 * Ableton → Server: Timing cues (beat events, tempo changes)
 */

import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import type { Socket as SocketIOSocket } from 'socket.io';
import { encodeOSCMessage, encodeOSCBundle, decodeOSCMessage } from '../lib/osc-codec';

// Re-export codec functions for backward compatibility
export { encodeOSCMessage, decodeOSCMessage } from '../lib/osc-codec';
export type { OSCArgument, OSCMessage } from '../lib/osc-codec';

/**
 * OSC Bridge interface
 */
export interface OSCBridge {
  /** Send an OSC message to Ableton */
  send(address: string, ...args: (string | number | boolean)[]): void;

  /** Send multiple OSC messages as an atomic bundle */
  sendBundle(messages: { address: string; args: (string | number | boolean)[] }[]): void;

  /** Register handler for incoming OSC messages */
  on(address: string, handler: (...args: any[]) => void): void;

  /** Register one-time handler for incoming OSC messages (auto-removes after first call) */
  once(address: string, handler: (...args: any[]) => void): void;

  /** Remove handler for incoming OSC messages */
  off(address: string, handler: (...args: any[]) => void): void;

  /** Get/set max listeners (delegates to underlying EventEmitter) */
  getMaxListeners(): number;
  setMaxListeners(n: number): void;

  /** Start listening for incoming messages */
  start(): Promise<void>;

  /** Stop the bridge and close sockets */
  stop(): void;

  /** Check if bridge is connected/running */
  isRunning(): boolean;
}

/**
 * OSC Bridge configuration
 */
export interface OSCBridgeConfig {
  sendPort: number;      // Port to send to Ableton (default: 11000)
  receivePort: number;   // Port to receive from Ableton (default: 11001)
  abletonHost: string;   // Ableton host (default: '127.0.0.1')
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: OSCBridgeConfig = {
  sendPort: 11000,
  receivePort: 11001,
  abletonHost: '127.0.0.1',
};

// ============================================================================
// Local UDP Bridge (same machine as Ableton)
// ============================================================================

/**
 * Create an OSC bridge for direct UDP communication with Ableton Live.
 * Use when the server runs on the same machine as Ableton.
 */
export function createOSCBridge(config?: Partial<OSCBridgeConfig>): OSCBridge {
  const finalConfig: OSCBridgeConfig = { ...DEFAULT_CONFIG, ...config };

  const emitter = new EventEmitter();
  let receiveSocket: dgram.Socket | null = null;
  let sendSocket: dgram.Socket | null = null;
  let running = false;

  function send(address: string, ...args: (string | number | boolean)[]): void {
    if (!sendSocket || !running) {
      console.warn(`[OSC] Cannot send - bridge not running: ${address}`);
      return;
    }

    try {
      const message = encodeOSCMessage(address, args);
      sendSocket.send(message, finalConfig.sendPort, finalConfig.abletonHost, (err) => {
        if (err) {
          console.error(`[OSC] Send error for ${address}:`, err);
        } else {
          console.log(`[OSC] Sent: ${address}`, args);
        }
      });
    } catch (err) {
      console.error(`[OSC] Encode error for ${address}:`, err);
    }
  }

  function sendBundle(messages: { address: string; args: (string | number | boolean)[] }[]): void {
    if (!sendSocket || !running) {
      console.warn('[OSC] Cannot sendBundle - bridge not running');
      return;
    }
    if (messages.length === 0) return;
    if (messages.length === 1) {
      send(messages[0].address, ...messages[0].args);
      return;
    }
    try {
      const bundle = encodeOSCBundle(messages);
      sendSocket.send(bundle, finalConfig.sendPort, finalConfig.abletonHost, (err) => {
        if (err) {
          console.error('[OSC] Bundle send error:', err);
        }
      });
    } catch (err) {
      console.error('[OSC] Bundle encode error:', err);
    }
  }

  function on(address: string, handler: (...args: any[]) => void): void {
    emitter.on(address, handler);
  }

  function once(address: string, handler: (...args: any[]) => void): void {
    emitter.once(address, handler);
  }

  function off(address: string, handler: (...args: any[]) => void): void {
    emitter.off(address, handler);
  }

  async function start(): Promise<void> {
    if (running) {
      console.warn('[OSC] Bridge already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        sendSocket = dgram.createSocket('udp4');
        receiveSocket = dgram.createSocket('udp4');

        receiveSocket.on('error', (err) => {
          console.error('[OSC] Receive socket error:', err);
          if (!running) {
            reject(err);
          }
        });

        receiveSocket.on('message', (msg, rinfo) => {
          const message = decodeOSCMessage(msg);
          if (message) {
            console.log(`[OSC] Received: ${message.address}`, message.args, `from ${rinfo.address}:${rinfo.port}`);
            emitter.emit(message.address, ...message.args);
            emitter.emit('*', message.address, ...message.args);
          }
        });

        receiveSocket.on('listening', () => {
          const addr = receiveSocket!.address();
          console.log(`[OSC] Listening on ${addr.address}:${addr.port}`);
          console.log(`[OSC] Sending to ${finalConfig.abletonHost}:${finalConfig.sendPort}`);
          running = true;

          send('/live/test');
          resolve();
        });

        receiveSocket.bind(finalConfig.receivePort);
      } catch (err) {
        reject(err);
      }
    });
  }

  function stop(): void {
    running = false;

    if (receiveSocket) {
      try { receiveSocket.close(); } catch (err) { /* ignore */ }
      receiveSocket = null;
    }

    if (sendSocket) {
      try { sendSocket.close(); } catch (err) { /* ignore */ }
      sendSocket = null;
    }

    emitter.removeAllListeners();
    console.log('[OSC] Bridge stopped');
  }

  function isRunning(): boolean {
    return running;
  }

  return {
    send,
    sendBundle,
    on,
    once,
    off,
    getMaxListeners: () => emitter.getMaxListeners(),
    setMaxListeners: (n: number) => { emitter.setMaxListeners(n); },
    start,
    stop,
    isRunning,
  };
}

// ============================================================================
// Remote Bridge (OSC relayed over Socket.IO to bridge client)
// ============================================================================

/**
 * Create an OSC bridge that relays messages over Socket.IO to a bridge client
 * running on the performer's laptop alongside Ableton.
 *
 * The bridge client converts Socket.IO events ↔ local UDP.
 * This bridge starts in a "waiting" state — it becomes active when
 * a bridge client connects via attachBridgeSocket().
 */
export function createRemoteOSCBridge(): OSCBridge & {
  /** Attach a bridge client socket. Returns a cleanup function. */
  attachBridgeSocket(socket: SocketIOSocket): () => void;
  /** Check if a bridge client is currently connected */
  hasBridgeClient(): boolean;
} {
  const emitter = new EventEmitter();
  let running = false;
  let bridgeSocket: SocketIOSocket | null = null;

  function send(address: string, ...args: (string | number | boolean)[]): void {
    if (!running) {
      console.warn(`[OSC-Remote] Cannot send - bridge not running: ${address}`);
      return;
    }

    if (!bridgeSocket) {
      console.warn(`[OSC-Remote] Cannot send - no bridge client connected: ${address}`);
      return;
    }

    console.log(`[OSC-Remote] Relaying: ${address}`, args);
    bridgeSocket.emit('osc_send', { address, args });
  }

  function sendBundle(messages: { address: string; args: (string | number | boolean)[] }[]): void {
    for (const msg of messages) {
      send(msg.address, ...msg.args);
    }
  }

  function on(address: string, handler: (...args: any[]) => void): void {
    emitter.on(address, handler);
  }

  function once(address: string, handler: (...args: any[]) => void): void {
    emitter.once(address, handler);
  }

  function off(address: string, handler: (...args: any[]) => void): void {
    emitter.off(address, handler);
  }

  async function start(): Promise<void> {
    if (running) {
      console.warn('[OSC-Remote] Bridge already running');
      return;
    }
    running = true;
    console.log('[OSC-Remote] Remote bridge started (waiting for bridge client connection)');
  }

  function stop(): void {
    running = false;
    bridgeSocket = null;
    emitter.removeAllListeners();
    console.log('[OSC-Remote] Bridge stopped');
  }

  function isRunning(): boolean {
    return running;
  }

  /**
   * Attach a bridge client socket. The bridge becomes active immediately.
   * Returns a cleanup function to call when the socket disconnects.
   */
  function attachBridgeSocket(socket: SocketIOSocket): () => void {
    if (bridgeSocket) {
      console.warn('[OSC-Remote] Replacing existing bridge client');
    }

    bridgeSocket = socket;
    console.log(`[OSC-Remote] Bridge client connected: ${socket.id}`);

    // Listen for OSC messages from the bridge client (Ableton → Server)
    const onOscReceive = (data: { address: string; args: any[] }) => {
      if (!data?.address) return;
      console.log(`[OSC-Remote] Received: ${data.address}`, data.args);
      emitter.emit(data.address, ...data.args);
      emitter.emit('*', data.address, ...data.args);
    };

    socket.on('osc_receive', onOscReceive);

    // Send test message to verify connectivity
    send('/live/test');

    // Return cleanup function
    return () => {
      socket.off('osc_receive', onOscReceive);
      if (bridgeSocket === socket) {
        bridgeSocket = null;
        console.log('[OSC-Remote] Bridge client disconnected');
      }
    };
  }

  function hasBridgeClient(): boolean {
    return bridgeSocket !== null && bridgeSocket.connected;
  }

  return {
    send,
    sendBundle,
    on,
    once,
    off,
    getMaxListeners: () => emitter.getMaxListeners(),
    setMaxListeners: (n: number) => { emitter.setMaxListeners(n); },
    start,
    stop,
    isRunning,
    attachBridgeSocket,
    hasBridgeClient,
  };
}

// ============================================================================
// Null Bridge (testing without Ableton)
// ============================================================================

/**
 * Create a null/mock OSC bridge for testing without Ableton.
 * All sends are logged but not transmitted. No messages are received.
 */
export function createNullOSCBridge(): OSCBridge {
  const emitter = new EventEmitter();
  let running = false;

  return {
    send(address: string, ...args: (string | number | boolean)[]): void {
      console.log(`[OSC-Null] Would send: ${address}`, args);
    },
    sendBundle(messages: { address: string; args: (string | number | boolean)[] }[]): void {
      for (const msg of messages) {
        console.log(`[OSC-Null] Would send (bundle): ${msg.address}`, msg.args);
      }
    },
    on(address: string, handler: (...args: any[]) => void): void {
      emitter.on(address, handler);
    },
    once(address: string, handler: (...args: any[]) => void): void {
      emitter.once(address, handler);
    },
    off(address: string, handler: (...args: any[]) => void): void {
      emitter.off(address, handler);
    },
    getMaxListeners: () => emitter.getMaxListeners(),
    setMaxListeners: (n: number) => { emitter.setMaxListeners(n); },
    async start(): Promise<void> {
      running = true;
      console.log('[OSC-Null] Null bridge started (no actual OSC communication)');
    },
    stop(): void {
      running = false;
      emitter.removeAllListeners();
      console.log('[OSC-Null] Null bridge stopped');
    },
    isRunning(): boolean {
      return running;
    },
  };
}

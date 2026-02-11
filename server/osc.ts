/**
 * OSC Bridge - Bidirectional Communication with Ableton Live
 *
 * Provides OSC (Open Sound Control) communication between Yggdrasil and Ableton Live.
 * Uses UDP for low-latency, real-time messaging.
 *
 * Server → Ableton: Commands to control audio playback
 * Ableton → Server: Timing cues (loop complete, cue hits)
 *
 * OSC Protocol:
 * - Server sends on port 9001 (configurable via OSC_SEND_PORT)
 * - Server receives on port 9000 (configurable via OSC_RECEIVE_PORT)
 */

import * as dgram from 'dgram';
import { EventEmitter } from 'events';

/**
 * OSC Bridge interface
 */
export interface OSCBridge {
  /** Send an OSC message to Ableton */
  send(address: string, ...args: (string | number | boolean)[]): void;

  /** Register handler for incoming OSC messages */
  on(address: string, handler: (...args: any[]) => void): void;

  /** Register one-time handler for incoming OSC messages (auto-removes after first call) */
  once(address: string, handler: (...args: any[]) => void): void;

  /** Remove handler for incoming OSC messages */
  off(address: string, handler: (...args: any[]) => void): void;

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
  sendPort: number;      // Port to send to Ableton (default: 9001)
  receivePort: number;   // Port to receive from Ableton (default: 9000)
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

/**
 * OSC argument types
 */
type OSCArgument = string | number | boolean | Buffer;

/**
 * OSC message structure
 */
interface OSCMessage {
  address: string;
  args: OSCArgument[];
}

// ============================================================================
// OSC Encoding/Decoding
// ============================================================================

/**
 * Encode a string as OSC string (null-terminated, padded to 4-byte boundary)
 */
function encodeOSCString(str: string): Buffer {
  const nullTerminated = str + '\0';
  const padding = 4 - (nullTerminated.length % 4);
  const paddedLength = nullTerminated.length + (padding === 4 ? 0 : padding);
  const buffer = Buffer.alloc(paddedLength);
  buffer.write(nullTerminated, 0, 'utf8');
  return buffer;
}

/**
 * Encode OSC type tag string
 */
function encodeOSCTypeTags(args: OSCArgument[]): Buffer {
  let typeTags = ',';
  for (const arg of args) {
    if (typeof arg === 'string') {
      typeTags += 's';
    } else if (typeof arg === 'number') {
      typeTags += Number.isInteger(arg) ? 'i' : 'f';
    } else if (typeof arg === 'boolean') {
      typeTags += arg ? 'T' : 'F';
    } else if (Buffer.isBuffer(arg)) {
      typeTags += 'b';
    }
  }
  return encodeOSCString(typeTags);
}

/**
 * Encode an OSC argument
 */
function encodeOSCArgument(arg: OSCArgument): Buffer {
  if (typeof arg === 'string') {
    return encodeOSCString(arg);
  } else if (typeof arg === 'number') {
    const buffer = Buffer.alloc(4);
    if (Number.isInteger(arg)) {
      buffer.writeInt32BE(arg, 0);
    } else {
      buffer.writeFloatBE(arg, 0);
    }
    return buffer;
  } else if (typeof arg === 'boolean') {
    // Booleans are encoded in the type tag, no argument data
    return Buffer.alloc(0);
  } else if (Buffer.isBuffer(arg)) {
    // Blob: 4-byte size followed by data, padded to 4-byte boundary
    const size = Buffer.alloc(4);
    size.writeInt32BE(arg.length, 0);
    const padding = 4 - (arg.length % 4);
    const paddedData = Buffer.concat([arg, Buffer.alloc(padding === 4 ? 0 : padding)]);
    return Buffer.concat([size, paddedData]);
  }
  return Buffer.alloc(0);
}

/**
 * Encode an OSC message
 */
export function encodeOSCMessage(address: string, args: OSCArgument[]): Buffer {
  const addressBuffer = encodeOSCString(address);
  const typeTagBuffer = encodeOSCTypeTags(args);
  const argBuffers = args.map(encodeOSCArgument);

  return Buffer.concat([addressBuffer, typeTagBuffer, ...argBuffers]);
}

/**
 * Decode an OSC string from buffer at offset
 * Returns [string, newOffset]
 */
function decodeOSCString(buffer: Buffer, offset: number): [string, number] {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  const str = buffer.toString('utf8', offset, end);
  // Skip null terminator and padding
  const paddedEnd = end + 1;
  const newOffset = paddedEnd + (4 - (paddedEnd % 4)) % 4;
  return [str, newOffset];
}

/**
 * Decode an OSC message from buffer
 */
export function decodeOSCMessage(buffer: Buffer): OSCMessage | null {
  try {
    let offset = 0;

    // Decode address
    const [address, afterAddress] = decodeOSCString(buffer, offset);
    offset = afterAddress;

    // Decode type tags
    const [typeTags, afterTypeTags] = decodeOSCString(buffer, offset);
    offset = afterTypeTags;

    if (!typeTags.startsWith(',')) {
      return null;
    }

    // Decode arguments based on type tags
    const args: OSCArgument[] = [];
    for (let i = 1; i < typeTags.length; i++) {
      const typeTag = typeTags[i];
      switch (typeTag) {
        case 's': {
          const [str, newOffset] = decodeOSCString(buffer, offset);
          args.push(str);
          offset = newOffset;
          break;
        }
        case 'i': {
          args.push(buffer.readInt32BE(offset));
          offset += 4;
          break;
        }
        case 'f': {
          args.push(buffer.readFloatBE(offset));
          offset += 4;
          break;
        }
        case 'T': {
          args.push(true);
          break;
        }
        case 'F': {
          args.push(false);
          break;
        }
        case 'b': {
          const blobSize = buffer.readInt32BE(offset);
          offset += 4;
          const blob = buffer.subarray(offset, offset + blobSize);
          args.push(Buffer.from(blob));
          const padding = (4 - (blobSize % 4)) % 4;
          offset += blobSize + padding;
          break;
        }
        default:
          // Unknown type, skip
          break;
      }
    }

    return { address, args };
  } catch (err) {
    console.error('[OSC] Failed to decode message:', err);
    return null;
  }
}

// ============================================================================
// OSC Bridge Implementation
// ============================================================================

/**
 * Create an OSC bridge for communication with Ableton Live
 *
 * @param config - Bridge configuration
 * @returns OSCBridge instance
 */
export function createOSCBridge(config?: Partial<OSCBridgeConfig>): OSCBridge {
  const finalConfig: OSCBridgeConfig = { ...DEFAULT_CONFIG, ...config };

  const emitter = new EventEmitter();
  let receiveSocket: dgram.Socket | null = null;
  let sendSocket: dgram.Socket | null = null;
  let running = false;

  /**
   * Send an OSC message to Ableton
   */
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

  /**
   * Register handler for incoming OSC messages
   */
  function on(address: string, handler: (...args: any[]) => void): void {
    emitter.on(address, handler);
  }

  /**
   * Register one-time handler for incoming OSC messages
   * Handler is automatically removed after first invocation
   */
  function once(address: string, handler: (...args: any[]) => void): void {
    emitter.once(address, handler);
  }

  /**
   * Remove handler for incoming OSC messages
   */
  function off(address: string, handler: (...args: any[]) => void): void {
    emitter.off(address, handler);
  }

  /**
   * Start the OSC bridge
   */
  async function start(): Promise<void> {
    if (running) {
      console.warn('[OSC] Bridge already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create send socket
        sendSocket = dgram.createSocket('udp4');

        // Create receive socket
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
            // Also emit a wildcard event for general listeners
            emitter.emit('*', message.address, ...message.args);
          }
        });

        receiveSocket.on('listening', () => {
          const addr = receiveSocket!.address();
          console.log(`[OSC] Listening on ${addr.address}:${addr.port}`);
          console.log(`[OSC] Sending to ${finalConfig.abletonHost}:${finalConfig.sendPort}`);
          running = true;

          // Send test message to verify AbletonOSC connection
          send('/live/test');

          resolve();
        });

        receiveSocket.bind(finalConfig.receivePort);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the OSC bridge
   */
  function stop(): void {
    running = false;

    if (receiveSocket) {
      try {
        receiveSocket.close();
      } catch (err) {
        // Ignore close errors
      }
      receiveSocket = null;
    }

    if (sendSocket) {
      try {
        sendSocket.close();
      } catch (err) {
        // Ignore close errors
      }
      sendSocket = null;
    }

    emitter.removeAllListeners();
    console.log('[OSC] Bridge stopped');
  }

  /**
   * Check if bridge is running
   */
  function isRunning(): boolean {
    return running;
  }

  return {
    send,
    on,
    once,
    off,
    start,
    stop,
    isRunning,
  };
}

/**
 * Create a null/mock OSC bridge for testing without Ableton
 * All sends are logged but not transmitted. No messages are received.
 */
export function createNullOSCBridge(): OSCBridge {
  const emitter = new EventEmitter();
  let running = false;

  return {
    send(address: string, ...args: (string | number | boolean)[]): void {
      console.log(`[OSC-Null] Would send: ${address}`, args);
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

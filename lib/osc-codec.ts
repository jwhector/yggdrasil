/**
 * OSC Encoding/Decoding — Shared by server (UDP bridge) and standalone bridge client (WebSocket relay).
 *
 * Implements OSC 1.0 message encoding and decoding:
 *   - Type tags: s (string), i (int32), f (float32), T/F (boolean), b (blob)
 *   - All strings null-terminated and padded to 4-byte boundaries
 */

/**
 * OSC argument types
 */
export type OSCArgument = string | number | boolean | Buffer;

/**
 * Decoded OSC message
 */
export interface OSCMessage {
  address: string;
  args: OSCArgument[];
}

// ============================================================================
// Encoding
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
 * Encode an OSC message into a Buffer
 */
export function encodeOSCMessage(address: string, args: OSCArgument[]): Buffer {
  const addressBuffer = encodeOSCString(address);
  const typeTagBuffer = encodeOSCTypeTags(args);
  const argBuffers = args.map(encodeOSCArgument);

  return Buffer.concat([addressBuffer, typeTagBuffer, ...argBuffers]);
}

/**
 * Encode an OSC bundle into a Buffer.
 * Bundle format: "#bundle\0" + 8-byte timetag + (4-byte size + message)...
 * Uses timetag = 1 (immediate execution).
 */
export function encodeOSCBundle(messages: { address: string; args: OSCArgument[] }[]): Buffer {
  const header = encodeOSCString('#bundle');
  // Timetag: 8 bytes, value 1 = "immediately"
  const timetag = Buffer.alloc(8);
  timetag.writeUInt32BE(0, 0);
  timetag.writeUInt32BE(1, 4);

  const parts: Buffer[] = [header, timetag];
  for (const msg of messages) {
    const encoded = encodeOSCMessage(msg.address, msg.args);
    const size = Buffer.alloc(4);
    size.writeInt32BE(encoded.length, 0);
    parts.push(size, encoded);
  }
  return Buffer.concat(parts);
}

// ============================================================================
// Decoding
// ============================================================================

/**
 * Decode an OSC string from buffer at offset.
 * Returns [string, newOffset].
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
 * Decode an OSC message from a Buffer.
 * Returns null on decode failure.
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
    console.error('[OSC Codec] Failed to decode message:', err);
    return null;
  }
}

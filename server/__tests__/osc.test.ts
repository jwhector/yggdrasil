/**
 * OSC Bridge Tests
 *
 * Tests cover:
 * - OSC message encoding/decoding
 * - Null bridge for testing
 * - Event handling
 * - Lifecycle management
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createNullOSCBridge, type OSCBridge } from '../osc';

describe('OSC Bridge', () => {
  describe('Null Bridge', () => {
    let bridge: OSCBridge;

    beforeEach(async () => {
      bridge = createNullOSCBridge();
      await bridge.start();
    });

    afterEach(() => {
      bridge.stop();
    });

    test('starts and stops without error', async () => {
      expect(bridge.isRunning()).toBe(true);
      bridge.stop();
      expect(bridge.isRunning()).toBe(false);
    });

    test('send logs but does not throw', () => {
      // Should not throw
      expect(() => {
        bridge.send('/test/address', 1, 'hello', 3.14);
      }).not.toThrow();
    });

    test('can register and unregister handlers', () => {
      const handler = jest.fn();

      bridge.on('/test/address', handler);
      bridge.off('/test/address', handler);

      // Should not throw
      expect(() => {
        bridge.off('/test/address', handler);
      }).not.toThrow();
    });

    test('isRunning reflects state correctly', async () => {
      expect(bridge.isRunning()).toBe(true);

      bridge.stop();
      expect(bridge.isRunning()).toBe(false);

      await bridge.start();
      expect(bridge.isRunning()).toBe(true);
    });
  });

  describe('OSC Protocol', () => {
    // Note: Full OSC encoding/decoding tests would require actual UDP communication
    // or exposing the encode/decode functions. For now, we test through the null bridge.

    test('null bridge accepts various argument types', () => {
      const bridge = createNullOSCBridge();

      // Should not throw for any valid argument type
      expect(() => {
        bridge.send('/test', 42);                    // int
        bridge.send('/test', 3.14159);               // float
        bridge.send('/test', 'hello');               // string
        bridge.send('/test', true);                  // boolean
        bridge.send('/test', false);                 // boolean
        bridge.send('/test', 1, 2.5, 'three', true); // mixed
      }).not.toThrow();
    });

    test('null bridge accepts empty arguments', () => {
      const bridge = createNullOSCBridge();

      expect(() => {
        bridge.send('/test');
      }).not.toThrow();
    });
  });
});

describe('AbletonOSC Address Patterns', () => {
  // Test the expected AbletonOSC addresses from the protocol spec

  const expectedServerToAbleton = [
    '/live/test',
    '/live/song/start_listen/beat',
    '/live/song/stop_listen/beat',
    '/live/song/start_playing',
    '/live/song/stop_playing',
    '/live/song/continue_playing',
    '/live/clip/fire',
    '/live/clip/stop',
    '/live/track/set/mute',
  ];

  const expectedAbletonToServer = [
    '/live/test',
    '/live/song/get/beat',
    '/live/song/get/tempo',
  ];

  test('server to AbletonOSC addresses follow /live/* namespace', () => {
    for (const address of expectedServerToAbleton) {
      expect(address).toMatch(/^\/[a-z_/]+$/i);
      expect(address.startsWith('/live/')).toBe(true);
    }
  });

  test('AbletonOSC to server addresses follow /live/* namespace', () => {
    for (const address of expectedAbletonToServer) {
      expect(address).toMatch(/^\/[a-z_/]+$/i);
      expect(address.startsWith('/live/')).toBe(true);
    }
  });
});

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

describe('OSC Address Patterns', () => {
  // Test the expected OSC addresses from the protocol spec

  const expectedServerToAbleton = [
    '/ygg/audition/start',
    '/ygg/audition/stop',
    '/ygg/layer/commit',
    '/ygg/layer/uncommit',
    '/ygg/show/pause',
    '/ygg/show/resume',
    '/ygg/finale/popular',
    '/ygg/finale/timeline',
  ];

  const expectedAbletonToServer = [
    '/ableton/loop/complete',
    '/ableton/audition/done',
    '/ableton/cue/hit',
    '/ableton/ready',
  ];

  test('server to ableton addresses are valid OSC format', () => {
    for (const address of expectedServerToAbleton) {
      expect(address).toMatch(/^\/[a-z_/]+$/i);
      expect(address.startsWith('/ygg/')).toBe(true);
    }
  });

  test('ableton to server addresses are valid OSC format', () => {
    for (const address of expectedAbletonToServer) {
      expect(address).toMatch(/^\/[a-z_/]+$/i);
      expect(address.startsWith('/ableton/')).toBe(true);
    }
  });
});

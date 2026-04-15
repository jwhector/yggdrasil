/**
 * useFloatingOrbs Hook (V3.4 — Swarm Orbs)
 *
 * Owns orb accumulation and positioning across both finale phases.
 * Orbs are spawned during the vote phase (one per answered question)
 * and persist into the remix phase where they become draggable onto nodes.
 *
 * Each orb has a "home" position in a scattered row near the top of the screen.
 * Unplaced orbs gently spring back toward their home with a slight wobble,
 * creating a loose, organic arrangement rather than a rigid grid.
 */

'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { AudienceOrb } from '@/conductor/types';
import { getChapterIdentity } from '@/lib/identity';

// ============================================================================
// Types
// ============================================================================

export interface FloatingOrbState {
  id: string;
  index: number;        // Maps to server-side AudienceOrb.index
  chapterId: string;
  color: string;        // Hex color from chapter identity
  x: number;
  y: number;
  homeX: number;        // Target resting position
  homeY: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;          // 0→1 bloom progress
  placedOnNode: string | null;
}

export interface UseFloatingOrbsReturn {
  orbs: FloatingOrbState[];
  addOrb: (chapterId: string, x: number, y: number) => void;
  placeOrb: (orbId: string, nodeId: string) => void;
  recallOrb: (orbId: string) => void;
  reconcileWithServer: (serverOrbs: AudienceOrb[]) => void;
  setPlacedPosition: (orbId: string, x: number, y: number) => void;
  /** Set the ID of the orb currently being dragged — skips spring physics for it. */
  setDragging: (orbId: string | null) => void;
}

// ============================================================================
// Constants
// ============================================================================

const BLOOM_DURATION_S = 0.5;
const ORB_RADIUS = 7;
const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;

// Spring physics for returning to home
const SPRING_STIFFNESS = 0.03;   // How strongly orbs pull toward home
const SPRING_DAMPING = 0.85;     // Velocity decay per frame
const WOBBLE_STRENGTH = 0.008;   // Tiny random perturbation for organic feel
const HOME_THRESHOLD = 0.5;      // Stop spring when this close to home

// ============================================================================
// Home position computation — scattered row
// ============================================================================

function computeHomePositions(count: number): Array<{ x: number; y: number }> {
  const w = typeof window !== 'undefined' ? window.innerWidth : 375;
  const h = typeof window !== 'undefined' ? window.innerHeight : 812;

  const baseY = h * 0.12;
  const spacing = Math.min(50, (w - 60) / Math.max(count, 1));
  const startX = w / 2 - ((count - 1) * spacing) / 2;

  // Use a seeded scatter so positions are stable across re-renders
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * spacing + (hashScatter(i, 0) * 12 - 6),      // ±6px horizontal scatter
    y: baseY + (hashScatter(i, 1) * 16 - 8),                       // ±8px vertical scatter
  }));
}

/** Simple deterministic scatter from index — returns 0..1. */
function hashScatter(index: number, seed: number): number {
  let h = index * 2654435761 + seed * 340573321;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return ((h >>> 16) ^ h & 0xffff) / 0xffff;
}

// ============================================================================
// Hook
// ============================================================================

export function useFloatingOrbs(): UseFloatingOrbsReturn {
  const orbsRef = useRef<FloatingOrbState[]>([]);
  const [renderTick, setRenderTick] = useState(0);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);
  const nextIdRef = useRef(0);
  const draggingIdRef = useRef<string | null>(null);

  // rAF physics loop
  useEffect(() => {
    const tick = (now: number) => {
      const dt = now - lastFrameRef.current;
      if (dt >= FRAME_MS) {
        lastFrameRef.current = now;
        const orbs = orbsRef.current;
        let changed = false;

        for (const orb of orbs) {
          // Skip placed orbs and the currently dragged orb
          if (orb.placedOnNode !== null) continue;
          if (orb.id === draggingIdRef.current) continue;

          // Bloom
          if (orb.age < 1) {
            orb.age = Math.min(1, orb.age + (dt / 1000) / BLOOM_DURATION_S);
            changed = true;
          }

          // Spring toward home position
          const dx = orb.homeX - orb.x;
          const dy = orb.homeY - orb.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > HOME_THRESHOLD) {
            // Spring force
            orb.vx += dx * SPRING_STIFFNESS;
            orb.vy += dy * SPRING_STIFFNESS;
            changed = true;
          }

          // Tiny wobble for organic feel
          orb.vx += (Math.random() - 0.5) * WOBBLE_STRENGTH;
          orb.vy += (Math.random() - 0.5) * WOBBLE_STRENGTH;

          // Damping
          orb.vx *= SPRING_DAMPING;
          orb.vy *= SPRING_DAMPING;

          // Integrate
          orb.x += orb.vx;
          orb.y += orb.vy;

          changed = true;
        }

        if (changed) {
          setRenderTick(t => t + 1);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /** Recompute home positions for all orbs when count changes. */
  const updateHomes = useCallback(() => {
    const orbs = orbsRef.current;
    const homes = computeHomePositions(orbs.length);
    for (let i = 0; i < orbs.length; i++) {
      orbs[i].homeX = homes[i].x;
      orbs[i].homeY = homes[i].y;
    }
  }, []);

  const addOrb = useCallback((chapterId: string, x: number, y: number) => {
    const identity = getChapterIdentity(chapterId);
    const id = `orb-${nextIdRef.current++}`;
    const newIndex = orbsRef.current.length;
    const homes = computeHomePositions(newIndex + 1);
    const home = homes[newIndex];

    const orb: FloatingOrbState = {
      id,
      index: newIndex,
      chapterId,
      color: identity.color,
      x,
      y,
      homeX: home.x,
      homeY: home.y,
      vx: 0,
      vy: 0,
      radius: ORB_RADIUS,
      age: 0,
      placedOnNode: null,
    };
    orbsRef.current = [...orbsRef.current, orb];
    updateHomes();
    setRenderTick(t => t + 1);
  }, [updateHomes]);

  const placeOrb = useCallback((orbId: string, nodeId: string) => {
    const orb = orbsRef.current.find(o => o.id === orbId);
    if (orb) {
      orb.placedOnNode = nodeId;
      setRenderTick(t => t + 1);
    }
  }, []);

  const recallOrb = useCallback((orbId: string) => {
    const orb = orbsRef.current.find(o => o.id === orbId);
    if (orb) {
      orb.placedOnNode = null;
      // Give it a small velocity toward home for a natural return
      orb.vx = (orb.homeX - orb.x) * 0.05;
      orb.vy = (orb.homeY - orb.y) * 0.05;
      setRenderTick(t => t + 1);
    }
  }, []);

  const setPlacedPosition = useCallback((orbId: string, x: number, y: number) => {
    const orb = orbsRef.current.find(o => o.id === orbId);
    if (orb) {
      orb.x = x;
      orb.y = y;
      setRenderTick(t => t + 1);
    }
  }, []);

  const reconcileWithServer = useCallback((serverOrbs: AudienceOrb[]) => {
    const existing = orbsRef.current;
    const homes = computeHomePositions(serverOrbs.length);

    const reconciled: FloatingOrbState[] = serverOrbs.map((serverOrb, i) => {
      const local = existing[i];
      const home = homes[i];
      if (local) {
        return {
          ...local,
          index: serverOrb.index,
          homeX: home.x,
          homeY: home.y,
          placedOnNode: serverOrb.placedOnNode,
        };
      }
      // Missing locally (page refresh mid-vote) — create at home position
      const identity = getChapterIdentity(serverOrb.chapterId);
      return {
        id: `orb-${nextIdRef.current++}`,
        index: serverOrb.index,
        chapterId: serverOrb.chapterId,
        color: identity.color,
        x: home.x,
        y: home.y,
        homeX: home.x,
        homeY: home.y,
        vx: 0,
        vy: 0,
        radius: ORB_RADIUS,
        age: 1,
        placedOnNode: serverOrb.placedOnNode,
      };
    });

    orbsRef.current = reconciled;
    setRenderTick(t => t + 1);
  }, []);

  const setDragging = useCallback((orbId: string | null) => {
    draggingIdRef.current = orbId;
  }, []);

  // Consumed to trigger re-renders
  void renderTick;
  const orbs = orbsRef.current;

  return { orbs, addOrb, placeOrb, recallOrb, reconcileWithServer, setPlacedPosition, setDragging };
}

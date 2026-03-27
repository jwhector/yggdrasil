# V3.2 Migration — Remaining TODOs

**Created:** 2026-03-26
**Last updated:** 2026-03-26
**Status:** ~95% complete (P0-P3 done, P4 partial)

This file tracks every remaining task for the V3.2 migration. Each task has an explicit description of what needs to happen and where. Update the checkboxes as tasks are completed.

---

## P0: Live Mix Conductor Logic -- COMPLETE

### P0.1 — `conductor/live-mix.ts` -- DONE

- [x] `getActiveFragment(votes)` — majority with recency tiebreak
- [x] `recalculateActiveFragments(finaleState)` — skips locked, uses overrides
- [x] `computeInitialFragments(availableFragments, attempts)` — highest winning proportion
- [x] Exported from `conductor/index.ts`

### P0.2 — 5 handlers in `conductor/conductor.ts` -- DONE

- [x] `handleSetLiveMixPreference` — validates assignment + lock, updates votes, emits ACTIVE_FRAGMENT_CHANGED + AUDIO_CUE
- [x] `handleLockGranularType` — emits GRANULAR_TYPE_LOCKED
- [x] `handleUnlockGranularType` — recalculates on unlock, emits GRANULAR_TYPE_UNLOCKED
- [x] `handleOverrideFragment` — sets override, emits ACTIVE_FRAGMENT_CHANGED + AUDIO_CUE
- [x] `handleClearOverride` — reverts to votes, emits ACTIVE_FRAGMENT_CHANGED + AUDIO_CUE

### P0.3 — `handleStartLiveMix` initial fragments -- DONE

- [x] Computes initial fragments via `computeInitialFragments()`
- [x] Initializes votes for all assigned users
- [x] Emits `LIVE_MIX_STARTED` with real initialFragments + `AUDIO_CUE` for initial unmute

### P0.4 — Tests -- DONE

- [x] `conductor/__tests__/live-mix.test.ts` — 19 tests (unit + integration)
- [x] All 157 conductor tests passing (7 suites)

---

## P1: Server — Broadcast + Persistence -- COMPLETE

### P1.1 — `set_preference` socket handler -- DONE

- [x] Listener in `server/socket.ts`: derives granularType from assignment, maps to SET_LIVE_MIX_PREFERENCE, persists via saveMixEvent()

### P1.2 — `mix_state` broadcast at ~4 Hz -- DONE

- [x] 250ms interval in `server/socket.ts` during finale_live_mix
- [x] Projector + controller get full vote distributions
- [x] Audience gets full activeFragments + detailed votes for own type only
- [x] Interval auto-skips when phase is not finale_live_mix

### P1.3 — `type_locked` / `type_unlocked` broadcast -- DONE

- [x] GRANULAR_TYPE_LOCKED → `type_locked` to audience + projector
- [x] GRANULAR_TYPE_UNLOCKED → `type_unlocked` to audience + projector

### P1.4 — `finale_mix_events` database table -- DONE

- [x] Table in `db/schema.sql` with index
- [x] Migration v5 in `server/persistence.ts`
- [x] `saveMixEvent()` + `getMixEvents()` methods
- [x] Interface updated in `PersistenceLayer`
- [x] Lock/unlock/override commands persisted from command handler

---

## P2: Missing UI Components

### P2.1 — Replace `AssemblyCards.tsx` with V3.2 assignment component

### P2.1 — Replace AssemblyCards with V3.2 components -- DONE

- [x] Created `components/finale/AssignmentCards.tsx` — config-driven GranularType props
- [x] Created `components/finale/AssignmentIdentity.tsx` — replaces GroupIdentity with GranularType
- [x] Updated `app/audience/page.tsx` — uses AssignmentCards/AssignmentIdentity, passes granularTypes from config
- [x] Added `granularTypes` to audience client config in socket.ts + AudienceClientState type
- [x] Deleted `components/finale/AssemblyCards.tsx` and `components/finale/GroupIdentity.tsx`

### P2.2 — `components/finale/LiveMixProjector.tsx` -- DONE

- [x] Created with: per-type rows, active fragment with chapter color, consensus bar, lock indicators
- [x] Subscribes to `mix_state` at ~4 Hz for real-time updates
- [x] Wired into `app/projector/page.tsx` for `finale_live_mix` phase
- [x] Added assignment visualization for `finale_assignment` phase (type cards with live counts)

### P2.3 — `components/controller/LiveMixControls.tsx` -- DONE

- [x] Per-type rows with: active fragment, vote distribution bar, override dropdown, lock toggle
- [x] Subscribes to `mix_state` at ~4 Hz
- [x] Wired into `app/controller/page.tsx` for `finale_live_mix` phase
- [x] Sends LOCK/UNLOCK/OVERRIDE/CLEAR commands via socket

---

## P3: Dead Code Cleanup -- COMPLETE

- [x] Deleted 12 V3.1 files:
  - `components/finale/`: DeliberationBoard, AudioPreview, CeremonyView, AltarReady, MixingMirror, MixingSurface, AssemblyCards, GroupIdentity
  - `components/controller/`: AssemblyControls, DeliberationControls, CeremonyControls
  - `hooks/useAltarDetection.ts`
- [x] AmbassadorPrompt.tsx was already removed (not found)
- [x] Verified no remaining imports reference deleted files

---

## P4: Verification

- [x] `npm test` — 296 passing (2 pre-existing audio-router flakes)
- [x] `npx tsc --noEmit` — zero errors
- [ ] `npm run dev` — dev server starts without errors
- [ ] Manual walkthrough: lobby → song-building (3 layers) → finale_elegy → finale_assignment → finale_live_mix → ended
- [x] Update `CHANGELOG.md` with V3.2 migration completion notes
- [ ] Update `ARCHITECTURE.md` and `docs/` to reflect V3.2 as the current state (remove V3.1 references)

---

## Recommended Implementation Order

| Step | Tasks | Why this order |
|------|-------|---------------|
| 1 | P0.1 + P0.4 (tests) | Pure logic, no dependencies. Test-first. |
| 2 | P0.2 + P0.3 | Wire logic into conductor. Run conductor tests. |
| 3 | P1.4 | Database table + persistence methods (needed by socket handlers). |
| 4 | P1.1 + P1.2 + P1.3 | Socket handlers + broadcasts (need conductor + persistence). |
| 5 | P2.1 | Replace AssemblyCards with V3.2 component. |
| 6 | P2.3 | Controller LiveMixControls (performer needs to test live mix). |
| 7 | P2.2 | Projector LiveMixProjector (visual, can be last). |
| 8 | P3 | Dead code cleanup (safe to do anytime, but last avoids disruption). |
| 9 | P4 | Full verification pass. |

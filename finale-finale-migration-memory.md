---
name: Audience Swarm Remix Implementation
description: V3.4 audience-interactive finale — swarm orbs design, implementation status, and remaining work
type: project
---

## Audience Swarm Remix (in progress, 2026-04-14)

**Concept:** During finale_remix, each audience member has 6 personal orbs (generated from their vote phase answers). They drag orbs onto pentagon nodes as reusable "votes" — the dominant chapter per node determines what plays. Configurable decay returns orbs to hand after N loops. Performer can scatter, lock nodes, and toggle instant/loop-quantized crossfade.

**Why:** Director feedback that performer-only finale leaves audience idle. This gives 40+ people meaningful interaction.

### Completed (Phases 1-4)
- **Types** (`conductor/types.ts`): AudienceOrb, UserRemixState, NodeVoteTally, 9 new commands (PLACE_ORB, RECALL_ORB, SET_DECAY_RATE, SET_CROSSFADE_MODE, SCATTER_NODE, SCATTER_ALL, LOCK_NODE, UNLOCK_NODE, FALLBACK_PERFORMER_REMIX), 10 new events, RemixConfig expanded (orbsPerPerson, orbDecayLoops, tallyBroadcastMs, instantCrossfade), FinaleState extended (audienceOrbs, nodeTallies, orbDecayLoops, instantCrossfade, fallbackMode), AudienceRemixView and ProjectorFinaleView updated with tally data
- **Config** (`config/default-show.json`): remix section updated with new fields, audienceInteraction: true
- **Engine** (`conductor/audience-remix.ts`): Pure functions — createUserOrbs, placeOrb, recallOrb, processDecay, scatterNode, lockNode, unlockNode, setDecayRate, setCrossfadeMode, getEffectiveChapter, recomputeTallies. Exported from `conductor/index.ts`
- **Tests** (`conductor/__tests__/audience-remix.test.ts`): 26 tests covering all engine functions. Total: 237 tests passing across 10 suites
- **Serialization** (`lib/serialization.ts`): SerializedFinaleState extended, serialize/deserialize updated for new Maps

### Completed (Phase 5 — Server)
- **Conductor wiring** (`conductor/conductor.ts`): All 9 new commands handled in processCommand. handleStartRemix creates audience orbs from vote tokens. handleLoopBoundary runs processDecay. handleFallbackPerformerRemix sets fallbackMode.
- **Socket handlers** (`server/socket.ts`): `place_orb` and `recall_orb` listeners (audience→server, userId from session). Tally broadcast at ~2Hz. Event handlers for ORB_DECAYED (targeted), NODES_SCATTERED (targeted), FALLBACK_ACTIVATED (phones_down). REMIX_STARTED skips phones_down when audience orbs active. filterStateForClient updated for both audience (AudienceRemixView) and projector (tally data).

### Completed (Phases 6-10 — UI, Cap, Final)
- **Audience UI** (`components/finale/AudienceRemix.tsx`): Phone pentagon with SVG nodes + tally arcs. DOM orbs with touch drag (touchstart/touchmove/touchend). Orbs shrink+blur when placed, glow when dragging. Snap-to-node hit testing. Haptic feedback on place/decay/scatter. Fallback mode shows "LISTEN".
- **Audience hook** (`hooks/useAudienceRemix.ts`): Subscribes to node_tally, orb_decayed, scatter socket events. Optimistic place/recall. Haptic vibration on decay/scatter.
- **Audience page** (`app/audience/page.tsx`): Wired AudienceRemix during finale_remix (replaces static "LISTEN").
- **Controller** (`components/finale/RemixController.tsx`): SwarmControls section — decay rate slider (0-8 loops), crossfade mode toggle (instant/loop), scatter buttons (per-node + all), lock/unlock per node with chapter selector, performer fallback button with confirmation.
- **Vote phase cap** (`conductor/conductor.ts`): maxQuestionsPerPerson capped at orbsPerPerson (default 6) from remix config.
- **Serialization fix** (`lib/serialization.ts`): Defensive defaults for audienceOrbs/nodeTallies (handles old state without new fields).
- **All 385 tests pass** across 15 suites. Typecheck clean.

### Key Design Decisions
- Free stacking (all 6 orbs on one node allowed)
- Performer can lock nodes (safety valve)
- Decay configurable (0 = disabled) + performer scatter
- Crossfade mode toggleable: loop-quantized (default) or instant
- Only your own orbs visible on phone; aggregate tally shows room state
- Emergency fallback: performer takes over with existing drag-token projector UI, tokens generated from persisted votes
- Node visualization: radial tally arcs (3 chapter-colored arcs per node)

### Plan File
Full design doc at `/Users/jared/.claude/plans/eventual-toasting-raccoon.md`

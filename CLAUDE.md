# CLAUDE.md

This file provides context for Claude Code when working on the Yggdrasil project.

## Project Summary

An interactive live performance system where ~30 audience members on phones collectively build a song. The audience is split into 4 factions representing parts of the performer's subconscious. Factions compete by internal alignment (coherence), not by size. Each person also tracks a private "personal tree" of choices, revealed in the finale alongside their "fig tree" response about paths not taken.

## Key Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Next.js + Socket.IO on :3000)
npm run build        # Build for production
npm run start        # Start production server
npm test             # Run all tests
npm run test:conductor   # Test conductor only
npm run typecheck    # Check types
npm run lint         # Lint code
```

## Architecture

Next.js with custom server for WebSocket support:

```
Custom Server (server/index.ts)
├── Next.js (app/ routes)
├── Socket.IO (real-time events)
├── SQLite (persistence)
└── Conductor (pure game logic)
```

Single process serves everything. This simplifies deployment and recovery for live performance.

## Essential Reading

| File | When to Read |
|------|--------------|
| `ARCHITECTURE.md` | Before any significant changes (source of truth) |
| `conductor/types.ts` | Before touching any data structures |
| `DECISIONS.md` | When encountering open questions or design choices |
| `CHANGELOG.md` | To understand recent changes and their intent |

## Folder Structure

```
yggdrasil/
├── conductor/        # Pure game logic (START HERE)
│   ├── types.ts      # Shared type definitions
│   ├── conductor.ts  # State machine
│   ├── coherence.ts  # Scoring logic
│   └── __tests__/    # Unit tests
├── server/           # Custom server
│   ├── index.ts      # Entry: HTTP + Next.js + Socket.IO
│   ├── socket.ts     # Socket.IO handlers
│   ├── persistence.ts
│   ├── timing.ts     # Hybrid timing engine (Ableton + JS timers)
│   ├── osc.ts        # OSC bridge for Ableton communication
│   └── __tests__/    # Server unit tests
├── app/              # Next.js pages
│   ├── audience/
│   ├── projector/
│   └── controller/
├── components/       # React components
├── hooks/            # useSocket, useShowState
└── config/           # Show configuration
```

## Core Concepts

- **Coherence**: `largest_bloc / faction_voters` — factions win by agreement, not size
- **Options are ambiguous**: 4 factions and 4 options is thematic, not mechanical coupling
- **Two votes per row**: Faction vote (determines winner) + personal vote (private, for finale)
- **Dual paths**: Faction path (solid) vs popular path (ghost) — shown on projector, creates "the room chose X but wanted Y" tension
- **Ties**: Equal coherence → random selection with tiebreaker animation
- **Coups**: Each faction can reset current row once per show (hidden meter, ambush reveal)
- **Faction assignment**: Happens after join, optimizes for balance + seat adjacency separation

## Current State

Core implementation is in progress:

**Completed:**
- `conductor/` — Pure state machine with comprehensive tests
- `server/` — WebSocket server with Socket.IO, persistence, timing engine, OSC bridge
- Basic `/controller` UI view

**In Progress:**
- `/projector` and `/audience` views
- Ableton Live Max for Live integration (M4L device)

**Key architectural components:**
- **Timing Engine** (`server/timing.ts`): Hybrid timing with Ableton (audition) + JS timers (voting, coup)
- **OSC Bridge** (`server/osc.ts`): Bidirectional UDP communication with Ableton Live

## Code Conventions

- **Types are contracts**: Changes to `types.ts` ripple everywhere; be deliberate
- **Conductor is pure**: No I/O, no side effects, just `(state, command) => (newState, events)`
- **Test names are specs**: Write as complete sentences describing behavior
- **Intent over diff**: CHANGELOG entries explain *why*, not just *what*

## Things NOT To Do

- Don't implement deferred features (finale sequencing algorithm, audio adapters beyond NullAdapter)
- Don't add features not in ARCHITECTURE.md without updating the spec first
- Don't put I/O in the conductor
- Don't invent solutions for open questions in DECISIONS.md without flagging them

## When Making Changes

1. Read relevant section of ARCHITECTURE.md
2. Check DECISIONS.md for related open questions
3. If changing data structures, update `types.ts` first
4. Write/update tests before or alongside implementation
5. Add CHANGELOG.md entry explaining intent
6. Update ARCHITECTURE.md if design changes

## Type System Notes

Key types to understand:

```typescript
ShowPhase: 'lobby' | 'assigning' | 'running' | 'finale' | 'ended' | 'paused'
RowPhase: 'pending' | 'auditioning' | 'voting' | 'revealing' | 'coup_window' | 'committed'
FactionId: 0 | 1 | 2 | 3
User.faction: FactionId | null  // null until assignment phase
```

Commands flow in, events flow out:
```typescript
ConductorCommand → Conductor → ConductorEvent[]
```

## Testing Approach

The conductor should have exhaustive unit tests covering:
- Phase transitions (valid and invalid)
- Coherence calculation (edge cases: ties, empty factions, single voter)
- Coup mechanics (threshold, multiplier, once-per-faction)
- Vote handling (latest vote wins, attempt tracking)
- Faction assignment (balance constraint, adjacency optimization)

Example test style:
```typescript
test('a faction that has used their coup cannot vote to coup again', () => { ... })
test('weighted coherence applies only to the row where coup occurred', () => { ... })
test('late joiners are assigned to smallest faction', () => { ... })
```

## Recovery & Robustness

This system runs during live performances. Key resilience patterns:

- **State versioning**: `ShowState.version` increments on every change
- **Persist on every state change**: Not periodic; immediate SQLite writes
- **Client reconnection**: Clients store identity in localStorage, auto-reconnect with backoff
- **Controller emergency actions**: Pause, reset to lobby, export/import state

Before each performance, test:
1. Kill server, verify restart recovers state
2. Disconnect client, verify reconnection works
3. Trigger "Reset to Lobby", verify clean slate

## Questions?

If something is unclear or seems contradictory:
1. Check ARCHITECTURE.md (it's authoritative)
2. Check DECISIONS.md (it may be an acknowledged open question)
3. If still unclear, flag it rather than guessing

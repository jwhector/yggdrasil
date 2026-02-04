# AI Agent Context

**Read this file first when starting work on Yggdrasil.**

## What Is This Project?

A live performance system where ~30 audience members on their phones collectively build a song. The audience is split into 4 factions (representing parts of the performer's psyche). Each row of the song, factions compete to have their option chosen. A faction wins by having the highest *coherence* (internal alignment), not by having the most members.

## Key Mechanics

1. **Voting**: Users cast TWO votes per row — a faction vote (determines winner) and a personal vote (private, used in finale)
2. **Coherence**: `largest_bloc / total_faction_voters` — rewards alignment, not size. Factions win by agreeing on ANY option, not a designated one.
3. **Options are ambiguous**: 4 factions and 4 options is thematic parallelism, NOT mechanical coupling. Options don't "belong to" factions.
4. **Dual paths**: Faction path (coherence winners) shown as solid line; popular path (personal vote plurality) shown as ghost. Divergence displayed each reveal.
5. **Ties**: When factions have equal coherence, random selection with tiebreaker animation.
6. **Coups**: Each faction can sabotage once per show, resetting the current row (hidden meter, ambush reveal)
7. **Finale**: Popular path song → individual timelines with fig tree responses

## Architecture

Next.js with custom server (single process):

```
server/index.ts → HTTP server
├── Next.js (app/ pages)
├── Socket.IO (real-time)
├── SQLite (persistence)
└── Conductor (pure logic)
```

Routes:
- **`/audience`** — Phone UI for voting and coup
- **`/projector`** — Visual display of Song Tree
- **`/controller`** — Performer's control panel

## Critical Files

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | **Source of truth** — full system spec |
| `conductor/types.ts` | Type definitions (contract for system) |
| `DECISIONS.md` | Open questions and resolved design choices |
| `CHANGELOG.md` | Why changes were made |
| `config/default-show.json` | Example show configuration |

## Before Making Changes

1. Read the relevant section of `ARCHITECTURE.md`
2. Check `DECISIONS.md` for related open questions
3. If changing types, update `types.ts` first
4. Add a `CHANGELOG.md` entry explaining intent
5. Update `ARCHITECTURE.md` if design changes

## Current State

The repository contains specification documents and type definitions. Implementation has not begun. Start with the `conductor/` directory (pure state machine logic with tests).

## Things NOT To Do

- Don't invent solutions for deferred items (finale sequencing, specific visuals, audio integration)
- Don't add features not in `ARCHITECTURE.md` without updating the spec first
- Don't use external state in the conductor — it's pure functions in/out

## Quick Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server on :3000
npm test             # Run all tests
npm run test:conductor  # Test conductor only
```

# CHANGELOG

## 2025-02-26 — Initial architecture for new show design
**Context:** Complete redesign of the Solo Show system. The original show (faction-based, 4-option voting, coherence/coup mechanics) has been replaced with a new design: binary choices, consensus/doubt threshold, 3 story attempts, and a collaborative remix finale.

**Changes:**
- Created ARCHITECTURE.md with full system specification
- Created CLAUDE.md with AI agent context and instructions
- Created DECISIONS.md with 15 resolved decisions and 8 open questions
- Defined new state machine (lobby → opener → 3× story/build cycles → finale → end)
- Defined song-building mechanics (binary A/B voting, layer grid UI, doubt threshold, collapse behavior)
- Defined finale mechanics (chapter assignment, fragment selection, 7-slot rotation, stewardship, triangle steering)
- Defined audio engine integration (track layout formula, collapse via return track effects, M4L metering)
- Defined deployment model (cloud-hosted server + local Ableton OSC bridge)

**Implications:**
- Old conductor logic (coherence, coups, faction assignment) is fully replaced
- Infrastructure layer (Socket.IO, SQLite, OSC bridge, reconnection, recovery) carries forward
- New components needed: consensus.ts, finale.ts, fragments.ts, metering.ts, triangle UI, steward slider, fragment selector
- Musical content (Ableton session) needs to be designed to match the track layout formula

**Migration notes from old codebase:**
- Reusable: server scaffolding, Socket.IO setup, persistence pattern, OSC bridge, recovery protocol, client identity/reconnection, AI dev practices
- Rewrite: all conductor logic, all component UIs, DB schema, audio router mappings
- Remove: faction assignment, coherence, coups, seat topology providers, song tree, dual paths, fig tree prompt, personal tree/timeline

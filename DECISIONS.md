# Design Decisions

This file tracks open questions, deferred decisions, and the reasoning behind resolved choices. It serves as a log of design thinking for the Solo Show system.

---

## Open Questions

These items are acknowledged but intentionally deferred. When resolving, move to the "Resolved" section with explanation.

### Faction Reveal Animation

**Question:** What should the faction reveal animation look like on audience phones and projector?

**Current thinking:**
- Audience phone: Brief suspenseful build, then their faction color/identity fills the screen
- Projector: Could show the room/seat map with colors appearing, or an abstract visualization

**Considerations:**
- Should feel ceremonial—this is the moment they become "part of the mind"
- Duration: Long enough to feel meaningful, short enough to maintain energy (3-5 seconds?)
- Should projector and phones be synchronized or can they be independent?

**Blocked by:** Visual design decisions, prototyping

---

### Finale Sequencing Algorithm

**Question:** How should personal timelines be ordered during the finale to minimize jarring harmonic transitions?

**Current thinking:** 
- One decision point will determine key (designed into the music)
- Group timelines by key, then by similarity within key
- Exact algorithm TBD after musical content is created

**Blocked by:** Musical content decisions

**Integration point:** `server/src/finale.ts` (to be created)

---

### Faction Identities

**Question:** What are the four factions called? What do they represent? What are their colors?

**Current thinking:**
- Each represents an internal psychological force
- Examples: ambition, fear, joy, control, chaos, desire, caution
- Final identities should feel distinct but not prescriptive

**Blocked by:** Artistic decision, not technical

**Integration point:** `config/default-show.json`, client theme constants

---

### Timing Values

**Question:** What are the exact durations for each phase?

**Current estimates:**
- Audition per option: ~10 seconds
- Voting window: ~10 seconds
- Reveal duration: ~5 seconds
- Coup window: ~10 seconds

**Resolution path:** Rehearsal and iteration

**Integration point:** `config/default-show.json`

---

### Deployment Environment

**Question:** Where will this run during performances?

**Options:**
- Local network (performer's laptop as server, audience on WiFi)
- Cloud deployment (more reliable, but requires internet)
- Hybrid (cloud server, local audio)

**Considerations:**
- Venue WiFi reliability
- Latency requirements
- Crash recovery needs

**Blocked by:** Venue decisions, testing

---

### Controller Hardware

**Question:** What physical interface will the performer use?

**Options:**
- Laptop keyboard shortcuts
- MIDI controller (already have piano keyboard)
- Dedicated foot pedal for hands-free
- Tablet as wireless controller

**Current thinking:** Support keyboard shortcuts as baseline, design for future hardware flexibility

---

### Projector Visual Design

**Question:** What should the Song Tree and other visualizations look like?

**Considerations:**
- Legible from back of room
- Emotionally expressive (colors, motion)
- Coup animations should feel like rupture/glitch
- Finale should feel like expansion/possibility

**Blocked by:** Artistic decision, prototyping

---

## Resolved Decisions

### Hybrid Timing with Ableton Live (Resolved)

**Decision:** Use a hybrid timing architecture where Ableton Live controls musical timing (audition loops) via OSC, while the server controls game logic timing (voting, coup windows) via JS timers.

**Reasoning:**
- Musical timing requires sample-accuracy; Ableton handles tempo, loops, and quantization natively
- Game logic timing (voting windows) doesn't need musical precision; JS timers are sufficient
- Bidirectional OSC enables the server to send commands and receive timing cues
- Fallback mode (JS timers only) enables testing without Ableton running
- Version checking prevents stale timer fires when manual advances occur

**Architecture:**
- `server/osc.ts`: Bidirectional OSC bridge (UDP, ports 9000/9001)
- `server/timing.ts`: Timing engine that observes state changes and schedules advances
- Conductor remains pure: timing logic lives entirely in server layer
- `ADVANCE_PHASE` commands are sent like any other command (manual or automatic)

**Key design choices:**
- Row transitions remain manual (performer controls pacing)
- Pause/resume uses fresh restart (timer restarts from scratch)
- Timing engine enabled by default
- Audition timing via AbletonOSC beat subscription (`/live/song/get/beat`); other phases use JS timers

**Date:** Phase 3 implementation

---

### Next.js with Custom Server (Resolved)

**Decision:** Use Next.js with a custom Node.js server (Option A: single process) rather than separate frontend and backend services.

**Reasoning:**
- Socket.IO requires persistent WebSocket connections (not supported by Next.js API routes)
- Single process simplifies deployment and recovery for live performance
- ~30 users doesn't require horizontal scaling
- All state lives in one place (SQLite + memory), easier to reason about
- Simpler to monitor and restart during a live show

**Trade-offs:**
- Custom server disables some Next.js optimizations (ISR, edge functions)
- These optimizations aren't needed for this use case (all pages are dynamic)

**Date:** Initial design

---

### Recovery & Persistence Strategy (Resolved)

**Decision:** The system persists state to SQLite on every state change (not periodic), uses state versioning for sync verification, and provides controller emergency actions for live recovery.

**Reasoning:**
- Live performance cannot tolerate data loss; every vote matters
- State versioning enables efficient reconnection (full sync only if version mismatch)
- SQLite with WAL mode provides crash resilience without complex infrastructure
- Controller emergency actions give performer control during technical difficulties
- Automatic client reconnection with exponential backoff minimizes audience disruption

**Key mechanisms:**
- `ShowState.version` increments on every change
- Persist after every state mutation, wrapped in transaction
- Clients store identity in localStorage, reconnect automatically
- Heartbeat system detects disconnections within ~30 seconds
- Controller can pause, reset, export/import state

**Date:** Initial design

---

### Audition Loop Count (Resolved)

**Decision:** Each option loops twice during audition by default, configurable via `auditionLoopsPerOption` in timing config.

**Reasoning:**
- Single loop is too short for audience to absorb the musical content
- Two loops provides: first loop to hear it, second loop to form an opinion
- Configurable because optimal loop count depends on musical content length and complexity

**Date:** Initial design

---

### Dual Path Tracking — Faction vs Popular (Resolved)

**Decision:** The system tracks two parallel paths through the Song Tree: the faction path (determined by coherence) and the popular path (determined by personal vote plurality). Both are visualized on the projector—faction as solid, popular as ghost/shadow.

**Reasoning:**
- Gives immediate feedback for personal votes without revealing the individual-level finale
- Creates visible narrative tension: "the room chose X, but wanted Y"
- Enables a three-part finale: faction song → popular song → individual timelines
- The divergence between paths is thematically rich—conviction vs. desire

**Finale structure enabled:**
1. "The song we built" (faction path) — heard throughout the show
2. "The song we wanted" (popular path) — played in full during finale
3. "The songs you imagined" (individual timelines) — personal paths with fig tree responses

**Date:** Initial design

---

### Coherence Tie Handling (Resolved)

**Decision:** When two or more factions have identical weighted coherence, the winner is selected by fully random choice. A tiebreaker visualization (e.g., spinning wheel) plays on the projector before revealing the winner.

**Reasoning:**
- Ties are possible, especially with small faction sizes
- Random selection is fair and creates dramatic tension
- Visual tiebreaker makes the randomness theatrical rather than arbitrary
- No seeding needed; full randomness is appropriate for live performance

**Flow:**
1. Reveal shows coherence bars filling
2. Tied factions highlight/pulse
3. Tiebreaker animation plays
4. Winner lands
5. Path draws to winning option

**Date:** Initial design

---

### Fig Tree Prompt in Lobby (Resolved)

**Decision:** During lobby, the projector displays a thematic excerpt (operator provides) and audience members respond to a prompt ("What lives on your fig tree?"). This response is stored and displayed during their finale moment.

**Reasoning:**
- Primes the audience with the show's central metaphor without heavy-handed explanation
- Gives people time to reflect and write something meaningful (vs. rushed finale_setup)
- Makes the lobby phase feel like part of the experience, not just waiting
- The "fig tree" framing directly connects to the show's theme of paths not taken

**Alternatives considered:**
- Collecting text during a separate `finale_setup` phase (felt rushed, broke momentum)
- Not collecting text at all (lost the personal/poetic connection in finale)

**Date:** Initial design

---

### Seat-Aware Faction Assignment (Resolved)

**Decision:** Faction assignment happens after join (not during), uses seat-specific QR codes to know seating layout, and optimizes to minimize same-faction adjacency while maintaining perfect faction balance.

**Reasoning:**
- Minimizing adjacency encourages cross-faction communication and strategy
- People sitting together will need to coordinate across faction lines, which creates interesting social dynamics
- Balance is a hard constraint (no faction more than 1 larger than another); adjacency is soft optimization
- Seat-specific QR codes provide precise topology data with minimal user friction

**Flow:**
1. Users scan seat-specific QR codes during lobby phase
2. Performer triggers "Assign Factions" when ready
3. Algorithm runs, optimizing for balance + separation
4. All users receive faction assignment simultaneously with reveal animation

**Late joins:** Prioritize smallest faction; use adjacency as tiebreaker among equally-small factions.

**Date:** Initial design

---

### Options Are Not Faction-Owned (Resolved)

**Decision:** The 4 options per row are musically ambiguous and not tied to specific factions. The parallelism of 4 factions and 4 options is thematic, not mechanical.

**Reasoning:** 
- Keeps options musically flexible—the performer can design sounds without constraining them to faction identities
- A faction wins by internal alignment on *any* option, which makes coherence feel like genuine consensus rather than loyalty
- Avoids the audience feeling like they're "supposed to" vote for their faction's option
- Supports the psychological metaphor: parts of the self don't inherently "own" specific choices; they compete by conviction

**Implications:** Options have an `index` (0–3) for position within the row, but no `factionId`. Coherence is calculated by how many faction members voted for the same option (whichever one that is).

**Date:** Initial design clarification

---

### Hidden Coup Meters (Resolved)

**Decision:** Coup meters are visible only to the faction considering the coup, not to other factions or the projector.

**Reasoning:** Creates ambush mechanic; coups feel like sudden ruptures rather than telegraphed events. Supports the narrative of self-sabotage coming from an unexpected place.

**Date:** Initial design

---

### Two-Vote System (Resolved)

**Decision:** Users cast two simultaneous votes per row: a faction vote (contributes to winning) and a personal vote (recorded for finale).

**Reasoning:** Literalizes the tension between "what I want" and "what I'm supposed to be." Mirrors the show's theme of internal conflict. Personal tree enables individualized finale without affecting main gameplay.

**Date:** Initial design

---

### Coherence Over Popularity (Resolved)

**Decision:** Winning is determined by highest faction coherence (internal alignment), not by total votes.

**Reasoning:** Rewards coordination and decisiveness, not just size. Creates interesting dynamics where a small aligned faction can beat a large divided one. Supports the metaphor of integration vs. fragmentation.

**Date:** Initial design

---

### Anonymous Finale Timelines (Resolved)

**Decision:** When a personal timeline plays during the finale, it's anonymous on the projector. The individual knows it's theirs because of their submitted parallel life text.

**Reasoning:** Preserves intimacy of personal choices. The text ("a life I could have lived") is the identifier, not public attribution.

**Date:** Initial design

---

<!-- Template for resolved decisions:

### Decision Title (Resolved)

**Decision:** What was decided

**Reasoning:** Why this choice was made

**Alternatives considered:** What else was on the table (optional)

**Date:** When resolved

-->

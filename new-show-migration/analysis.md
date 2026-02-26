# Solo Show — Migration Analysis: Old Architecture → New Show

## TL;DR
The **infrastructure layer** is highly reusable. The **game logic layer** needs to be rewritten almost entirely. The **client UI** needs new components but can reuse the connection/state plumbing.

---

## What's Reusable (Keep / Adapt)

### 1. Core Architecture Pattern — **Fully Reusable**
The Next.js + Custom Server + Socket.IO single-process architecture is exactly right for the new show. Same rationale applies: persistent WebSocket connections, single process for live performance reliability, all state in one place.

**Files:** `server/index.ts`, `next.config.js`, project scaffolding

### 2. Conductor Pattern (Pure State Machine) — **Pattern Reusable, Logic Rewritten**
The idea of a pure-logic module with no I/O that receives commands, validates, updates state, and emits events is excellent and should carry forward. The *internals* are completely different (binary votes + doubt threshold vs. 4-option coherence + coups), but the architecture is sound.

**Keep:** The command → validate → mutate → emit pattern, the separation from I/O
**Rewrite:** All commands, events, state shape, phase transitions

### 3. WebSocket Protocol & State Sync — **Fully Reusable**
The full-state-sync strategy (broadcast complete filtered state on every mutation rather than granular events) is the right call for ~40 users. The filtering pattern (controller gets full state, projector gets public state, audience gets personalized state) maps directly.

**Files:** `server/socket.ts` (structure reusable, events change), `lib/serialization.ts`, `lib/socket-client.ts`

### 4. Persistence Layer (SQLite) — **Pattern Reusable, Schema Changes**
SQLite with WAL mode, persist-on-every-change, atomic transactions, backup snapshots — all directly applicable. Schema needs updating (no factions table, no fig_tree_responses, new tables for layers/attempts/fragments/stewardship).

**Files:** `server/persistence.ts` (adapt), `db/schema.sql` (rewrite)

### 5. Recovery & Robustness — **Fully Reusable**
Heartbeat system, client reconnection with exponential backoff, version-checked state sync, controller emergency actions (pause/resume/export/import/force-reconnect) — all carry forward unchanged.

**Files:** `server/recovery.ts`, `hooks/useSocket.ts`, `lib/storage.ts`

### 6. OSC Bridge & Timing Engine — **Highly Reusable**
Bidirectional OSC with AbletonOSC plugin, beat subscription for musical timing, JS timers for non-musical timing, version-check safety for stale timer prevention — all applicable. The specific messages change (different track layout, new parameter control messages for stewardship), but the bridge infrastructure is the same.

**Files:** `server/osc.ts` (reuse), `server/timing.ts` (adapt), `server/audio-router.ts` (rewrite mappings)

### 7. Audio Adapter Interface — **Pattern Reusable, Interface Changes**
The pluggable adapter concept (+ NullAdapter for testing without Ableton) is great. The interface methods need to change to reflect the new show's actions (audition A/B, lock layer, collapse attempt, activate/deactivate finale slots, set stewardship parameter).

### 8. Client Identity & Reconnection — **Fully Reusable**
localStorage-based userId, reconnection protocol, session matching — all carry forward. Simpler now without seat-specific QR codes.

**Files:** `lib/storage.ts`, `hooks/useSocket.ts`

### 9. Controller Emergency Controls — **Mostly Reusable**
Pause/resume, export/import state, force reconnect all — directly reusable. New show adds show-specific overrides (force option A/B, force collapse, force continue past threshold, finale rotation controls) but the pattern is the same.

### 10. AI-First Development Practices — **Fully Reusable**
The ARCHITECTURE.md-as-source-of-truth, CHANGELOG with intent, types-as-documentation, test-names-as-specifications patterns should all carry forward into the new repo.

---

## What's Defunct (Remove / Replace)

| Old System | Why It's Gone | New Replacement |
|---|---|---|
| **Faction system** (4 factions, assignment algorithm, faction rooms, faction reveal) | No factions in new show. Audience is unified. | Audience is one group; consensus is collective |
| **Seat topology & adjacency graphs** | No seat-based mechanics | Single QR code join (or similar) |
| **Coherence calculation** (largest bloc / faction size) | Faction-based metric | Simple consensus: `max(votesA, votesB) / totalVotes` |
| **Coup mechanics** (one-time faction sabotage, coup meter, multiplier) | Removed entirely | **Doubt threshold** (rising consensus requirement) |
| **4-option voting per row** | Simplified to binary | **A/B binary choice** per layer |
| **Song Tree visualization** (branching path through options) | Linear stack replaces tree | **Layer stack** (vertical list of locked-in choices) |
| **Dual path tracking** (faction path vs. popular path) | No factions = no dual path | Single collective path |
| **Personal tree / parallel timeline** | No individual alternate paths | **Stewardship** (individual agency in finale) |
| **Fig tree prompt** (lobby text input for finale) | Thematic change | No lobby prompt; finale uses triangle steering |
| **Two-vote interface** (faction vote + personal vote drag) | Single collective vote now | **Two large A/B buttons** |
| **Tiebreaker animation** (spinning wheel for coherence ties) | Binary vote = no ties (or simple coin flip) | Not needed |
| **7-8 rows in a single linear sequence** | Show structure changed | **3 song attempts × 5-7 layers each** |

---

## New Systems to Build (No Old Equivalent)

| New System | Description |
|---|---|
| **Multi-attempt structure** | 3 story/build cycles with independent layer stacks, each can succeed or collapse |
| **Doubt meter / threshold system** | Rising consensus requirement per layer depth; configurable per attempt |
| **Attempt collapse mechanic** | When consensus < threshold: audio fade/collapse, visual cue, transition to next attempt |
| **Finale triangle steering** | Continuous barycentric input (3 corners: Ambition/Love/Avoidance), server aggregation to centroid |
| **Finale slot rotation** | 7 active slots, quantized rotation (swap 2 per 8 bars), operator freeze |
| **Stewardship system** | Individual parameter control during active slot, fairness scheduler, cooldown |
| **Fragment library** | Curated set of audio fragments with metadata (chapter, role, safe parameter, Ableton routing) |
| **Finale queue system** | Audience queues fragments, scheduler picks based on fairness + centroid weights + diversity |
| **Chapter identity system** | Consistent color/symbol mapping across 3 story chapters, used in all UIs |
| **Layer identity system** | Foundation/Pulse/Color/Space/Voice with colors + symbols, consistent across attempts |

---

## Architecture Questions for the New Show

Before building the context repo, I want to make sure we're aligned on some specifics. These are ordered roughly by how much they'd affect the architecture:

### Q1: Show Phase State Machine — Story Phase Behavior
During story phases (phones down), does the system need to do anything, or is it purely a holding state? Specifically:
- Do audience phones show a "phones down" / "listen" screen?
- Does the server need to track anything during story phases, or is it idle until the performer transitions to build?
- Is the transition from story → build always performer-triggered (controller button)?

### Q2: Attempt Collapse → Next Attempt Transition
When an attempt collapses (consensus < threshold):
- Does the performer manually advance to the next story attempt, or does the system auto-transition after the collapse animation?
- Is there a "collapsed" state the system holds in (giving the performer time for their narrative beat), or does it flow straight through?
- If Song 3 collapses, does the show go directly to finale, or is there a narrative transition phase?

### Q3: What Survives a Collapse?
If Song 1 collapses at layer 3 (got 3 layers locked before failing):
- Are those 3 locked layers available as finale fragments?
- Or only layers from songs that completed all the way?
- This significantly affects the fragment library design.

### Q4: Audience Join Flow
Without seat-specific QR codes:
- Single QR code for everyone? (Simplest)
- Any pre-show lobby interaction, or do phones just sit on a "waiting" screen until the first build phase?
- Do audience members need persistent identity across the whole show, or could they rejoin fresh each build phase?
- Target audience size: the old spec said ~30, new says ~40. Is 40 the working number?

### Q5: Finale Triangle — Data Rate & Aggregation
The triangle steering is continuous input from ~40 phones:
- How often should the server aggregate? (I'm thinking throttle client sends to every 200-300ms, server recomputes centroid on each receive, broadcasts aggregated centroid to projector at ~2-4 Hz)
- Does the triangle position need to be perfectly smooth on the projector, or is occasional jitter acceptable? (Affects whether we need client-side interpolation)

### Q6: Stewardship Parameter Control — UX & Mapping
- Is this a continuous slider/knob on the phone? Or discrete steps?
- Does it map 1:1 to an Ableton macro knob (0-127 or 0.0-1.0)?
- Does the audience member see what parameter they're controlling (e.g., "Filter" or "Reverb"), or is it abstracted ("Intensity")?

### Q7: Finale Fragment Selection — Audience UX
The spec mentions two options: "specific fragment" vs "chapter + role." Which direction?
- **Specific fragment**: audience picks from a list of named fragments (more agency, more complex UI)
- **Chapter + role**: audience picks "I want to add an Ambition melody" and the system chooses the specific clip (simpler UI, more system control)
- Or hybrid: pick chapter, then pick from 2-3 fragments within that chapter?

### Q8: Ableton Session Layout
The old show used a clean formula (rowIndex × 4 + optionIndex = trackIndex). The new show needs:
- **Song-building tracks**: 3 attempts × ~6 layers × 2 options = ~36 tracks
- **Finale fragment tracks**: however many unique fragments exist
- **Collapse gesture tracks**: audio cues for attempt failures
- Do you have a layout in mind, or should we design one?

### Q9: Audio Metering (Ableton → Server → Projector)
The spec mentions optional M4L envelope follower → OSC for responsive visuals:
- Is this a "nice to have" or core to the projector experience?
- If core, it affects the OSC bridge design (needs to handle high-frequency incoming data)

### Q10: Deployment Environment
Old spec left this open. For the new show:
- Local network (performer's laptop runs everything, audience connects to local WiFi)?
- Or cloud-hosted with audience on venue WiFi hitting a public URL?
- This affects latency assumptions, especially for the continuous triangle steering.

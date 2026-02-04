# Yggdrasil Implementation Roadmap

This document provides a complete implementation order from start to finish, with model recommendations and checkpoints.

---

## How to Use This Roadmap

1. Work through phases in order—each builds on the previous
2. Check off tasks as you complete them
3. Run the checkpoint tests before moving to the next phase
4. When you need to make structural changes, follow the "Handling Changes" section at the end

---

## Phase 0: Environment Setup
**Time estimate:** 30 minutes
**Model:** N/A (manual)

- [x] Initialize git repo: `git init`
- [x] Install dependencies: `npm install`
- [x] Verify TypeScript compiles: `npm run typecheck`
- [x] Verify dev server starts: `npm run dev` (will show stub pages)
- [x] Create `.env` file (if needed for local config)
- [ ] First commit: `git commit -m "Initial scaffold from spec"`

**Checkpoint:** Server runs, you can visit `/audience`, `/projector`, `/controller` (all stubs)

---

## Phase 1: Conductor Core Logic
**Time estimate:** 4-6 hours
**Model:** Sonnet (all tasks have clear types)

The conductor is pure logic with no I/O—easiest to test, safest to build first.

### 1.1 Coherence Calculation
```
Task: "Read CLAUDE.md, then implement conductor/coherence.ts with:
- calculateCoherence(factionId, votes, rowIndex, attempt)
- calculateWeightedCoherence(factionId, state)
Match the signatures in types.ts and behavior in ARCHITECTURE.md"
```

- [ ] `conductor/coherence.ts` — implement functions
- [ ] `conductor/__tests__/coherence.test.ts` — test cases:
  - 100% alignment (all vote same option)
  - Split vote (e.g., 6-2 split)
  - Three-way split
  - Empty faction (no voters)
  - Single voter
  - Weighted coherence with multiplier

### 1.2 Popular Vote Calculation
```
Task: "Add calculatePopularWinner to conductor/coherence.ts.
Given all votes for a row, return the optionId with the most personal votes.
Handle ties by picking the first alphabetically (deterministic)."
```

- [ ] `calculatePopularWinner` function
- [ ] Tests for ties, clear winner, single vote

### 1.3 Tie Detection and Resolution
```
Task: "Create conductor/ties.ts with:
- detectTie(factionResults) — returns TieInfo
- resolveTie(tiedFactionIds) — returns random winner
Match types in types.ts"
```

- [ ] `conductor/ties.ts`
- [ ] `conductor/__tests__/ties.test.ts`

### 1.4 Coup Mechanics
```
Task: "Create conductor/coup.ts with:
- processCoupVote(state, userId) — returns events
- canFactionCoup(faction) — boolean check
- getCoupProgress(faction, state) — returns 0-1 progress
Follow the coup rules in ARCHITECTURE.md"
```

- [ ] `conductor/coup.ts`
- [ ] `conductor/__tests__/coup.test.ts` — test cases:
  - Successful coup at threshold
  - Below threshold (no trigger)
  - Faction already used coup
  - Wrong phase (not coup_window)
  - Multiplier applied after coup

### 1.5 Faction Assignment
```
Task: "Create conductor/assignment.ts with:
- assignFactions(users, adjacencyGraph) — returns Map<UserId, FactionId>
- assignLatecomer(user, state, graph) — returns FactionId
Follow the algorithm in ARCHITECTURE.md (balance as hard constraint, adjacency as soft)"
```

- [ ] `conductor/assignment.ts`
- [ ] `conductor/__tests__/assignment.test.ts` — test cases:
  - Perfect balance (12 users → 3,3,3,3)
  - Imperfect balance (13 users → 4,3,3,3)
  - Adjacency optimization (mock graph)
  - Latecomer joins smallest faction
  - Latecomer adjacency tiebreaker

### 1.6 State Machine (Conductor Core)
```
Task: "Create conductor/conductor.ts with:
- createInitialState(config) — returns ShowState
- processCommand(state, command) — returns { state, events }
Start with phase transitions only (no vote processing yet)"
```

- [ ] `conductor/conductor.ts` — scaffold with phase transitions
- [ ] Handle: `ADVANCE_PHASE`, `START_SHOW`, `PAUSE`, `RESUME`
- [ ] `conductor/__tests__/conductor.test.ts` — phase transition tests

### 1.7 Vote Processing
```
Task: "Add vote handling to conductor/conductor.ts:
- SUBMIT_VOTE command
- Store in state.votes
- Latest vote wins (same user, same row, same attempt)
- Update personal tree"
```

- [ ] Vote submission logic
- [ ] Tests for vote storage, override, personal tree update

### 1.8 Reveal Logic
```
Task: "Add reveal phase logic to conductor/conductor.ts:
- Calculate coherence for all factions
- Detect ties, resolve if needed
- Determine winning option
- Calculate popular vote
- Build RevealPayload
- Update paths (faction + popular)"
```

- [ ] Reveal logic in conductor
- [ ] Tests for reveal with/without ties, path updates

### 1.9 Full Command Coverage
```
Task: "Complete conductor/conductor.ts with remaining commands:
- ASSIGN_FACTIONS, SUBMIT_COUP_VOTE, SUBMIT_FIG_TREE_RESPONSE
- SKIP_ROW, RESTART_ROW, TRIGGER_COUP
- RESET_TO_LOBBY, FORCE_FINALE
- USER_CONNECT, USER_DISCONNECT, USER_RECONNECT"
```

- [ ] All commands implemented
- [ ] Tests for each command

**Phase 1 Checkpoint:**
```bash
npm run test:conductor  # All tests pass
```

- [ ] All conductor tests pass
- [ ] `git commit -m "Complete conductor implementation"`

---

## Phase 2: Persistence Layer
**Time estimate:** 2-3 hours
**Model:** Sonnet

### 2.1 Database Setup
```
Task: "Create server/persistence.ts with:
- initializeDatabase(filepath) — creates tables from schema.sql
- Uses better-sqlite3
- Enables WAL mode"
```

- [ ] `server/persistence.ts` — initialization
- [ ] Verify tables created

### 2.2 State Persistence
```
Task: "Add to server/persistence.ts:
- saveState(state) — atomic write with transaction
- loadState(showId) — returns ShowState or null
- getLatestShow() — returns most recent show"
```

- [ ] CRUD for show state
- [ ] Transaction wrapping
- [ ] `server/__tests__/persistence.test.ts`

### 2.3 Vote and User Persistence
```
Task: "Add to server/persistence.ts:
- saveVote(vote)
- saveUser(user)
- saveFigTreeResponse(userId, text)
- getUsersByShow(showId)"
```

- [ ] User/vote persistence
- [ ] Tests

### 2.4 Backup System
```
Task: "Create server/backup.ts with:
- createBackup(state, directory)
- listBackups(directory)
- loadBackup(filepath)
- pruneBackups(directory, maxCount)"
```

- [ ] Backup functions
- [ ] Tests

**Phase 2 Checkpoint:**
```bash
npm test -- server/  # All persistence tests pass
```

- [ ] Persistence tests pass
- [ ] `git commit -m "Complete persistence layer"`

---

## Phase 3: WebSocket Server
**Time estimate:** 3-4 hours
**Model:** Sonnet for handlers, Opus if reconnection gets tricky

### 3.1 Socket Handler Setup
```
Task: "Create server/socket.ts with:
- setupSocketHandlers(io, conductor, db)
- Room management (audience, projector, controller, faction:N)
- Basic connection logging"
```

- [ ] `server/socket.ts` — scaffold
- [ ] Room joining logic

### 3.2 Client → Server Events
```
Task: "Add client event handlers to server/socket.ts:
- 'join' — register user, assign to rooms
- 'vote' — submit vote
- 'coup_vote' — submit coup vote  
- 'fig_tree_response' — submit text
- 'command' — controller commands (validate sender)"
```

- [ ] All client→server events
- [ ] Controller command validation

### 3.3 Server → Client Events
```
Task: "Add server broadcast logic:
- Emit events from conductor to appropriate rooms
- COUP_METER_UPDATE only to faction room
- STATE_SYNC on connect/reconnect
- Filter state by client type"
```

- [ ] Event broadcasting
- [ ] State filtering (audience sees less than controller)

### 3.4 Reconnection Protocol
```
Task: "Implement reconnection in server/socket.ts:
- Handle 'reconnect' event with userId + lastVersion
- Validate user exists
- Send STATE_SYNC
- Emit USER_RECONNECTED"
```

- [ ] Reconnection handling
- [ ] Version comparison logic

### 3.5 Heartbeat System
```
Task: "Add heartbeat monitoring:
- Track last ping per client
- Mark disconnected after 2 missed heartbeats
- Emit USER_LEFT when disconnected"
```

- [ ] Heartbeat tracking
- [ ] Disconnect detection

### 3.6 Wire Everything Together
```
Task: "Update server/index.ts to:
- Initialize persistence
- Create conductor with initial state (or load from db)
- Setup socket handlers
- Persist state after every command"
```

- [ ] Full server integration
- [ ] State persists on every change

**Phase 3 Checkpoint:**
```bash
npm run dev
# Open two browser tabs
# Verify: connect, disconnect, reconnect works
# Verify: controller commands reach server
```

- [ ] Manual WebSocket testing passes
- [ ] `git commit -m "Complete WebSocket server"`

---

## Phase 4: Controller UI
**Time estimate:** 3-4 hours
**Model:** Sonnet

Build controller first—you need it to test everything else.

### 4.1 Socket Hook
```
Task: "Create hooks/useSocket.ts:
- Connect to Socket.IO server
- Handle reconnection with exponential backoff
- Provide emit function and connection state
- Store client identity in localStorage"
```

- [ ] `hooks/useSocket.ts`
- [ ] `lib/storage.ts` — localStorage helpers

### 4.2 Show State Hook
```
Task: "Create hooks/useShowState.ts:
- Receive STATE_SYNC and incremental events
- Maintain client-side state (Zustand or useReducer)
- Expose typed state and actions"
```

- [ ] `hooks/useShowState.ts`
- [ ] State updates from events

### 4.3 Controller Layout
```
Task: "Build app/controller/page.tsx with sections:
- Connection status indicator
- Show phase display
- User count + faction distribution
- Current row info"
```

- [ ] Basic controller layout
- [ ] Live state display

### 4.4 Phase Controls
```
Task: "Add control buttons to controller:
- Assign Factions (lobby only)
- Advance Phase
- Pause / Resume
- Skip Row
- Restart Row"
```

- [ ] Phase control buttons
- [ ] Disable based on current phase

### 4.5 Emergency Controls
```
Task: "Add emergency section to controller:
- Reset to Lobby (with confirmation)
- Export State (download JSON)
- Import State (file upload)
- Force Reconnect All"
```

- [ ] Emergency controls
- [ ] Export/import working

### 4.6 Seat Map (Lobby)
```
Task: "Create components/SeatMap.tsx:
- Display joined users by seat
- Show faction colors after assignment
- Visual of room layout"
```

- [ ] `components/SeatMap.tsx`
- [ ] Integrate into controller

**Phase 4 Checkpoint:**
```bash
npm run dev
# Open /controller
# Verify: all buttons work
# Verify: state updates in real-time
# Verify: can export and re-import state
```

- [ ] Controller fully functional
- [ ] `git commit -m "Complete controller UI"`

---

## Phase 5: Projector UI
**Time estimate:** 4-6 hours
**Model:** Sonnet for components, Opus for complex animations

### 5.1 Song Tree Component
```
Task: "Create components/SongTree.tsx:
- Grid of rows × options
- Faction path as solid line
- Popular path as ghost/dashed line
- Highlight current row
- Animate path drawing"
```

- [ ] `components/SongTree.tsx`
- [ ] Dual path rendering

### 5.2 Lobby Display
```
Task: "Create components/LobbyDisplay.tsx:
- Display configured text (Fig Tree excerpt)
- Subtle ambient animation
- User count indicator"
```

- [ ] `components/LobbyDisplay.tsx`

### 5.3 Faction Reveal Animation
```
Task: "Create components/FactionRevealAnimation.tsx:
- Room-wide reveal when factions assigned
- Show distribution across room
- Celebratory animation"
```

- [ ] `components/FactionRevealAnimation.tsx`

### 5.4 Reveal Display
```
Task: "Create components/RevealDisplay.tsx:
- Show coherence bars filling
- Highlight winning faction
- Show divergence: 'Faction chose X. Room wanted Y.'
- Trigger tiebreaker if needed"
```

- [ ] `components/RevealDisplay.tsx`

### 5.5 Tiebreaker Animation
```
Task: "Create components/TiebreakerAnimation.tsx:
- Spinning wheel or similar
- Highlight tied factions
- Land on random winner
- Dramatic timing"
```

- [ ] `components/TiebreakerAnimation.tsx`

### 5.6 Coup Animation
```
Task: "Create components/CoupAnimation.tsx:
- Sudden/ambush reveal
- Tree 'retracts' visually
- Faction identity shown"
```

- [ ] `components/CoupAnimation.tsx`

### 5.7 Finale Display
```
Task: "Create components/FinaleDisplay.tsx:
- Popular path song phase
- Individual timeline phase
- Show fig tree response text
- Personal path highlighted on tree"
```

- [ ] `components/FinaleDisplay.tsx`
- [ ] `components/FinaleTimeline.tsx`

### 5.8 Projector Page Integration
```
Task: "Wire all components into app/projector/page.tsx:
- Render based on showPhase
- Full-screen, dark theme
- Smooth transitions between phases"
```

- [ ] Full projector integration

**Phase 5 Checkpoint:**
```bash
npm run dev
# Open /projector and /controller side by side
# Walk through full show flow using controller
# Verify all visual states render
```

- [ ] Projector shows all phases
- [ ] `git commit -m "Complete projector UI"`

---

## Phase 6: Audience UI
**Time estimate:** 4-5 hours
**Model:** Sonnet

### 6.1 Join Flow
```
Task: "Update app/audience/page.tsx:
- Read seat param from URL
- Connect to socket with seatId
- Show connection status"
```

- [ ] Seat ID from URL
- [ ] Socket connection with seat

### 6.2 Fig Tree Input
```
Task: "Create components/FigTreeInput.tsx:
- Text area for response
- Character limit (optional)
- Submit button
- Show 'submitted' state"
```

- [ ] `components/FigTreeInput.tsx`

### 6.3 Waiting State
```
Task: "Create components/WaitingState.tsx:
- 'Waiting for show to start'
- Maybe ambient animation
- Show that fig tree response is saved"
```

- [ ] `components/WaitingState.tsx`

### 6.4 Faction Reveal (Audience)
```
Task: "Create components/FactionReveal.tsx:
- Personal reveal animation
- Show faction color and name
- Celebratory moment"
```

- [ ] `components/FactionReveal.tsx` (audience version)

### 6.5 Vote Interface
```
Task: "Create components/VoteInterface.tsx:
- Show 4 options (during voting phase)
- Two-vote drag interaction:
  - Faction vote (colored)
  - Personal vote (neutral)
- Can vote same option for both
- Visual confirmation of vote"
```

- [ ] `components/VoteInterface.tsx`
- [ ] Drag interaction
- [ ] Vote submission

### 6.6 Audition Display
```
Task: "Create components/AuditionDisplay.tsx:
- Show which option is currently being auditioned
- Progress through options
- 'Listen' state (no voting yet)"
```

- [ ] `components/AuditionDisplay.tsx`

### 6.7 Coup Meter
```
Task: "Create components/CoupMeter.tsx:
- Only visible during coup_window
- Only visible to own faction
- Shows progress toward threshold
- 'Vote to Coup' button
- Disabled if faction already used coup"
```

- [ ] `components/CoupMeter.tsx`
- [ ] Coup vote submission

### 6.8 Audience Page Integration
```
Task: "Wire all components into app/audience/page.tsx:
- Render based on showPhase and rowPhase
- Handle all state transitions smoothly"
```

- [ ] Full audience integration

**Phase 6 Checkpoint:**
```bash
npm run dev
# Open /controller, /projector, and multiple /audience?seat=A1 tabs
# Walk through complete show
# Verify voting, coup meter, reveals all work
```

- [ ] Full show playable end-to-end
- [ ] `git commit -m "Complete audience UI"`

---

## Phase 7: Polish & Edge Cases
**Time estimate:** 2-3 hours
**Model:** Opus for review, Sonnet for fixes

### 7.1 Opus Review
```
Task: "Review the entire codebase for:
- Edge cases not covered
- Potential race conditions
- State inconsistencies
- Missing error handling
- UX issues"
```

- [ ] Opus review completed
- [ ] Issues documented

### 7.2 Error Handling
```
Task: "Add error boundaries and fallbacks:
- React error boundaries per route
- Socket error handling
- Graceful degradation"
```

- [ ] Error boundaries
- [ ] User-facing error messages

### 7.3 Loading States
```
Task: "Add loading states:
- Initial connection
- Reconnecting
- Processing vote"
```

- [ ] Loading indicators

### 7.4 Accessibility
```
Task: "Review and improve accessibility:
- Focus management
- Screen reader announcements for reveals
- Color contrast"
```

- [ ] Accessibility pass

### 7.5 Mobile Optimization
```
Task: "Optimize audience UI for phones:
- Touch-friendly vote interface
- Viewport handling
- Orientation (portrait)"
```

- [ ] Mobile testing
- [ ] Touch interactions smooth

**Phase 7 Checkpoint:**
- [ ] Full show rehearsal with simulated audience
- [ ] `git commit -m "Polish and edge cases"`

---

## Phase 8: Pre-Performance Testing
**Time estimate:** 1-2 hours
**Model:** N/A (manual testing)

### 8.1 Recovery Testing
- [ ] Kill server mid-show, restart, verify state survives
- [ ] Disconnect client, verify reconnection
- [ ] Reset to lobby, verify clean slate
- [ ] Export state, modify, import, verify restore

### 8.2 Load Testing
- [ ] Open 30+ audience tabs
- [ ] Verify performance holds
- [ ] Check WebSocket connection limits

### 8.3 Network Resilience
- [ ] Simulate network lag (browser devtools)
- [ ] Verify reconnection works
- [ ] Verify votes aren't lost

### 8.4 Full Rehearsal
- [ ] Run through complete show
- [ ] Time each phase
- [ ] Verify audio cues fire (NullAdapter logs)

---

## Phase 9: Audio Integration (Future)
**Time estimate:** Variable
**Model:** Depends on approach

This phase is intentionally deferred. When ready:

- [ ] Choose audio approach (Ableton, Tone.js, MIDI)
- [ ] Implement AudioAdapter
- [ ] Test audio sync with visuals
- [ ] Full rehearsal with audio

---

## Handling Mid-Development Changes

Changes will happen. Here's how to handle them cleanly:

### Small Changes (types, behavior tweaks)

1. **Update types.ts first** if data structures change
2. **Update tests** to reflect new behavior
3. **Implement the change**
4. **Add CHANGELOG entry**

```markdown
## [Date] — Brief title
**Context:** Why this change is happening
**Changes:** What was modified
**Implications:** What else might need updating
```

### Medium Changes (new feature, new component)

1. **Describe the change** in plain language
2. **Ask Opus**: "How should this integrate with the existing architecture?"
3. **Update ARCHITECTURE.md** with the new section
4. **Update DECISIONS.md** if it resolves an open question
5. **Implement** (Sonnet)
6. **Add CHANGELOG entry**

### Large Changes (restructure, new system)

1. **Pause implementation**
2. **Open Opus conversation** to discuss the change
3. **Update ARCHITECTURE.md comprehensively**
4. **Review affected components**
5. **Create migration plan** if data structures change
6. **Implement incrementally** with checkpoints
7. **Add detailed CHANGELOG entry**

### Template for Change Discussions

When you need to discuss a change with Opus:

```
Current state: [what exists now]
Desired state: [what you want]
Reason: [why the change is needed]
Concerns: [what might break or get complicated]

Please advise on:
1. How to update the architecture
2. What components are affected
3. Suggested implementation order
```

### Keeping AI Agents in Sync

After any change to architecture:

1. **Update ARCHITECTURE.md** (source of truth)
2. **Update CLAUDE.md** if core concepts changed
3. **Update AI_CONTEXT.md** if quick-reference info changed
4. Commit these doc changes **before** continuing implementation

This ensures the next AI session has accurate context.

---

## Quick Reference: File → Purpose

| File | What goes here |
|------|----------------|
| `ARCHITECTURE.md` | Complete system spec (update for any design change) |
| `CLAUDE.md` | Quick context for Claude Code (update for core concept changes) |
| `CHANGELOG.md` | Why changes were made (update for every significant change) |
| `DECISIONS.md` | Design choices and open questions (update when resolving/adding questions) |
| `conductor/types.ts` | Type definitions (update for any data structure change) |
| `config/default-show.json` | Show configuration (update for timing/config changes) |

---

## Estimated Total Time

| Phase | Hours |
|-------|-------|
| 0. Setup | 0.5 |
| 1. Conductor | 4-6 |
| 2. Persistence | 2-3 |
| 3. WebSocket | 3-4 |
| 4. Controller | 3-4 |
| 5. Projector | 4-6 |
| 6. Audience | 4-5 |
| 7. Polish | 2-3 |
| 8. Testing | 1-2 |
| **Total** | **24-34 hours** |

This is implementation time, not including design discussions or debugging complex issues.

---

Good luck with Yggdrasil! 🌳

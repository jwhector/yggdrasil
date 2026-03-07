# DECISIONS.md — Design Decisions Log

## How to Use This File
- **Open**: Decisions that need to be made before implementation can proceed
- **Resolved**: Decisions that have been made, with rationale recorded
- **Deferred**: Acknowledged but intentionally pushed to later

When resolving a decision, move it from Open to Resolved with the date and reasoning. Don't delete entries.

---

## Resolved Decisions

### R1: Audience structure — No factions
**Date:** 2025-02-26
**Decision:** The new show has no factions. Audience is unified. All voting is collective.
**Rationale:** The show metaphor shifted from "fractured mind with competing factions" to "one mind facing doubt." Binary choices + consensus threshold replaces coherence competition.
**Impact:** Removed faction assignment, coherence calculation, coup mechanics, faction rooms, dual path tracking.

### R2: Voting — Binary (A/B) instead of 4 options
**Date:** 2025-02-26
**Decision:** Each layer presents exactly 2 options.
**Rationale:** Legibility over complexity. Binary choices are instantly understandable for a lay audience. The interesting mechanic is the *consensus threshold*, not option complexity.

### R3: Collapse behavior — Auto-advance to next story
**Date:** 2025-02-26
**Decision:** When an attempt collapses (consensus < doubt), the system auto-advances to the next `attempt_story` phase after the collapse animation.
**Rationale:** Keeps the show moving. Performer doesn't need to manually handle the transition (they'll be performing a narrative beat during the collapse). Exception: Song 3 → finale transition is manual.

### R4: Fragment availability — All locked-in layers, regardless of completion
**Date:** 2025-02-26
**Decision:** Any layer that was voted on and locked in during any attempt is available as a finale fragment, even if the attempt later collapsed. Unreached layers appear visible but locked.
**Rationale:** Most/all songs are expected to be incomplete. This makes the collapse meaningful (fewer fragments available) without making the finale impossible.

### R5: Finale fragment visibility — Show locked "could have beens"
**Date:** 2025-02-26
**Decision:** In the finale, ALL options from a user's assigned chapter are displayed. Winning (locked-in) options are selectable. Losing options from voted layers AND both options from unreached layers appear visible but locked/grayed — representing "what could have been."
**Rationale:** Showing locked fragments reinforces the "what could have been" theme. The full grid gives the audience a complete picture of the song's potential, making the gaps from collapse feel tangible.

### R6: Chapter assignment — Random even split
**Date:** 2025-02-26
**Decision:** At finale setup, audience members are randomly assigned to one of three chapters with an even split (±1).
**Rationale:** Simplest fair approach. Considered: pattern-based assignment from voting behavior, or self-selection. Random avoids gaming and keeps implementation simple.

### R7: Fragment selection — One pick per user, from assigned chapter
**Date:** 2025-02-26
**Decision:** Each user selects one fragment from their assigned chapter's available (locked-in) options. No re-queuing.
**Rationale:** Finale duration is limited; queue will barely get through once. One meaningful choice per person.

### R8: Stewardship = fragment ownership
**Date:** 2025-02-26
**Decision:** When your queued fragment enters an active slot, you automatically become the steward.
**Rationale:** Creates a direct ownership arc: you chose it, you queued it, you shape it. No separate stewardship assignment needed.

### R9: Phone UI — Grid of all layers displayed at once
**Date:** 2025-02-26
**Decision:** During song-building, all layers for the current attempt are displayed simultaneously as squares (up to 12 squares for 6 layers × 2 options). Layers unlock sequentially.
**Rationale:** Gives audience a sense of progress and stakes — they can see how many layers remain and watch the stack build. Experimental; may need adjustment based on screen size testing.

### R10: Seat-specific QR codes — Kept for future-proofing
**Date:** 2025-02-26
**Decision:** Keep seat-specific QR codes even though no current mechanic uses seat topology.
**Rationale:** Provides persistent identity mapping and seat visualization on controller. May be useful for future spatial mechanics.

### R11: Deployment — Cloud-hosted default
**Date:** 2025-02-26
**Decision:** Plan for cloud hosting as default. Keep architecture compatible with local deployment.
**Rationale:** Avoids phone captive-portal / "no internet" warnings that occur on local-only WiFi networks. Ableton OSC bridge always runs locally regardless.

### R12: Audio metering — First-class feature
**Date:** 2025-02-26
**Decision:** Include M4L envelope followers → OSC → projector as a core feature, not a bolt-on.
**Rationale:** Low implementation cost (~2-3 hours), high visual payoff for finale slot cards. Dedicated high-frequency broadcast (not through state_sync).

### R13: Stewardship parameter — Configurable, continuous, abstracted
**Date:** 2025-02-26
**Decision:** Each fragment has a configurable safe parameter. UI shows a continuous slider with an abstracted label (e.g., "Intensity"). Maps to a clamped Ableton parameter with smoothing.
**Rationale:** Performer needs musical control over what gets exposed. Abstracted label avoids jargon. Continuous slider gives satisfying real-time feedback.

### R14: Collapse audio — Master return track effects
**Date:** 2025-02-26
**Decision:** Collapse gesture uses a master return track with effects (distortion, filter sweep, etc.) that are enabled briefly, rather than dedicated collapse tracks.
**Rationale:** Avoids duplicating tracks. All song-building tracks route through the return; enabling it creates the "womp-womp" effect on whatever is currently playing.

### R15: Song 3 → Finale transition — Manual
**Date:** 2025-02-26
**Decision:** When Song 3 collapses or completes, the transition to the finale is performer-triggered (manual), unlike Songs 1→2 and 2→3 which auto-advance.
**Rationale:** The performer needs a narrative beat between the last attempt and the finale. This may change later.

### R16: Revealing phase — Two-command split (CLOSE_VOTING + ADVANCE_FROM_REVEAL)
**Date:** 2026-03-06
**Decision:** `CLOSE_VOTING` resolves the vote and pauses at `revealing` phase; a separate `ADVANCE_FROM_REVEAL` command (auto-fired by the timing engine after `revealSequenceDurationMs`) advances to `locked_in` or `collapsed`. Vote result and drain are stored on `AttemptState` (`currentVoteResult`, `currentDrain`) during the revealing window.
**Rationale:** The RevealSequence UI (~5s animation) requires the conductor to hold at `revealing` as a true resting state so clients can observe it. The previous atomic `resolveCurrentLayer()` processed `revealing` → `locked_in` in one step, making the UI impossible. Splitting into two commands also makes the timing engine's role explicit and keeps conductor logic pure.
**Impact:** `ConductorCommand` gained `ADVANCE_FROM_REVEAL`. `AttemptState` gained `currentVoteResult` and `currentDrain`. All test helpers that call `CLOSE_VOTING` must also call `ADVANCE_FROM_REVEAL`.

### R17: Reveal beat durations
**Date:** 2026-03-06
**Decision:** Tension: 900ms, Split: 2000ms, Drain: 1500ms, Lock-in: 500ms (total ~4.9s). Client-side only (useState + useEffect timeouts); no server clock.
**Rationale:** Total matches `revealSequenceDurationMs` (~5s). Drain gets more time than lock-in because the health bar animation is the primary tension moment. Audience and projector run independent timers — slight drift is acceptable since they're decorative, not mechanically coupled.

---

## Open Decisions

### O1: Exact layer count per attempt
**Status:** Open
**Options:** 5, 6, or 7 layers per attempt
**Considerations:** More layers = more fragments for finale but higher collapse risk and longer build phases. 6 layers (12 squares on phone) is the current working assumption.
**Blocked by:** Musical content design

### O2: Exact doubt threshold schedule
**Status:** Open
**Current assumption:** Layers 0-1 no threshold, Layer 2 = 65%, Layer 3 = 75%, Layer 4 = 85%, Layer 5+ = 90%
**Considerations:** Should thresholds be identical across all 3 attempts, or escalate? (e.g., Song 3 has higher base thresholds)
**Blocked by:** Playtesting

### O3: Chapter + layer color/symbol assignments
**Status:** Open
**Current assumption:** Placeholder values in ARCHITECTURE.md
**Blocked by:** Visual design

### O4: Audition cadence
**Status:** Open
**Questions:** How long is each A/B preview? Cross-fade or hard cut? Loop once or twice? Same duration across all layers?
**Blocked by:** Musical content design

### O5: Fragment display names
**Status:** Open
**Questions:** Are these auto-generated from layer type + chapter (e.g., "Ambition: Foundation A")? Or hand-curated evocative names?
**Blocked by:** Content design

### O6: Projector visual design
**Status:** Open
**Notes:** Current spec defines layout requirements and data, not visual style. Theatrical, not analytical.
**Blocked by:** Visual design collaboration

### O7: Finale freeze → performer takeover UX
**Status:** Open
**Questions:** When rotation freezes, what does the projector show? Does the performer get any special controls beyond what the controller already offers?
**Blocked by:** Performance design / rehearsal

### O8: Ableton session template
**Status:** Open
**Notes:** Track layout formula is defined (attemptIndex × maxLayers × 2 + layerIndex × 2 + optionOffset). Actual clip content and return track effects TBD.
**Blocked by:** Musical composition

---

## Deferred Decisions

### D1: Multiple operator sessions
**Status:** Deferred
**Notes:** Spec allows it but not prioritized. Single operator is sufficient for now.

### D2: Seat topology mechanics
**Status:** Deferred
**Notes:** Seat IDs are collected but no spatial mechanics currently use them. May add spatial features later.

### D3: Variable attempt count
**Status:** Deferred
**Notes:** Currently hardcoded to 3 attempts. Could be made configurable but no current need.

# Client Routes & Visual Identity

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (voting mechanics), [finale.md](finale.md) (finale sub-phases)

---

## Client Routes (Next.js App Router)

### `/audience` — Audience Member UI

**Join flow:** Unchanged from V1.

**Story phases (phones down):** Screen goes dark/minimal ("listen" state).

**Song-building phases:**
- Two large tappable cards: Option A (left) and Option B (right), styled with layer color + symbol
- **Blind vote**: no live feedback on vote split during the voting window
- After vote closes → **Reveal sequence**:
  1. Both options shown side by side, no result (tension beat)
  2. Split revealed: winning option grows, losing option shrinks proportionally
  3. Threshold check (winning proportion compared against doubt threshold)
  4. Winning option's audio locks into the mix
- Layer progress indicator showing completed layers and upcoming layers
- Personal vote history dot on each completed layer (subtle indicator of which side you voted for)

**Finale — Elegy moment (optional pre-assembly beat):**
- Full grid of all fragments from all three songs, organized by role
- Winners glowing, losers/locked fragments visually cracked or dimmed
- NPC text narrates: "This is what we have left. This is what we lost."
- Duration: ~10–15 seconds, purely observational, no interaction

**Finale — Group Assembly:**
- 6 tappable cards, one per layer type, each showing: layer symbol, layer color, configurable label (e.g., "The Heartbeat", "The Ground")
- Live group size count displayed on each card (updates in real time as others join)
- Timer visible at top of screen (configurable duration, e.g., 60 seconds)
- Tap a card to join that group; tap a different card to switch (free choice, no constraints)
- NPC text may appear to frame the moment ("Choose your role. Find each other.")
- When timer expires: any undecided audience members are randomly assigned to a group by the server
- After assignment: screen transitions to show "You are [Layer Label]" with the group's symbol, color, and member count, plus instruction to physically find others with the same role
- Groups with 0 members are marked empty — that layer type will be skipped in the ceremony

**Finale — Deliberation:**
- Header: group identity (layer symbol + color + label + member count)
- Available fragments for this layer type displayed as tappable cards (1–3 cards, one per song that has an available fragment for this layer type)
- Each fragment card shows: chapter color, emotional tagline from song-building, play/pause button for audio preview
- **Audio preview**: tap play to hear the fragment on the phone speaker; tap again to pause; only one fragment plays at a time per phone (switching auto-pauses the previous)
- Vote button on each card: tap to cast vote for this fragment; can change vote freely during the timer
- Live vote tally visible to group members (within-group transparency, unlike the blind song-building vote)
- Timer visible at top (configurable duration, e.g., 120 seconds)
- When timer expires: the fragment with the most votes wins (simple majority); ties broken randomly
- After vote resolves: screen shows the chosen fragment with celebration animation
- **Ambassador volunteering**: after the fragment is chosen, a prompt appears: "Will you carry this forward?" with Accept/Decline buttons. Timer for volunteering (e.g., 15 seconds). If multiple volunteer, one is selected randomly. If none volunteer, the layer is forfeited — NPC acknowledges the loss.
- After ambassador is selected: ambassador's phone shows a distinct "Ambassador" state; other group members see who was chosen

**Finale — Ceremony:**
- **Non-ambassadors**: passive viewing state. Screen shows the ceremony progress — which layers have been locked, which ambassador is currently called, the layer order
- **Ambassador (before being called)**: waiting state with their layer identity prominent. "Wait for your name."
- **Ambassador (when called)**: phone enters altar-ready mode. Screen shows instruction: "Approach the altar. Place your phone face-down." Device Orientation API begins listening for face-down + still detection.
- **Altar lock-in detection**: phone uses `DeviceOrientationEvent` to detect when the device is face-down (gravity vector pointing upward through the screen, i.e., beta ≈ ±180° or gamma ≈ ±180° depending on orientation). Must remain in face-down position and substantially still (accelerometer delta < threshold) for ~2 seconds. On detection: sends lock-in event to server, phone vibrates once (if Vibration API available), screen illuminates with confirmation glow in the layer's color.
- **After lock-in**: ambassador picks up phone, sees confirmation. Audio for this fragment fades into the room mix (quantized to next bar boundary, using existing fade-in mechanic). Ceremony advances to next layer.
- **Forfeited layers** (no ambassador): skipped in the ceremony order with brief NPC acknowledgment

**Finale — Performer Mix phase:**
- **TBD** — Options under consideration: phones go dark, minimal ambient visualization, or endorsement tap surface. See Open Questions.

### `/projector` — Public Display

**Story phases:** Dark or minimal atmospheric display.

**Song-building phases:**
- Top: Song attempt title + chapter color/icon
- Center: Current layer card — layer symbol + label, Option A vs Option B
- Threshold display: current layer's threshold line
- Reveal animation: vote split visualization, threshold check
- Stack history: icons of chosen layers so far

**Finale — Elegy:**
- Full fragment grid with winners glowing, losers/locked dimmed
- NPC text displayed prominently

**Finale — Group Assembly:**
- Large visualization of the 6 groups forming in real time
- Each group shown with layer symbol, color, and growing member count
- Animated: members flowing into groups as people choose on their phones
- Timer displayed prominently
- NPC text when relevant

**Finale — Deliberation:**
- Overview of all 6 groups and their deliberation status
- Per-group: which fragment is currently leading (vote counts visible on projector, unlike phones which show only within-group)
- Groups that have reached majority shown with a "decided" visual state
- Ambassador volunteering status visible as it happens
- Timer displayed prominently

**Finale — Ceremony:**
- Central focus: the current ambassador being called
- Layer identity (symbol + color + label) displayed large
- The chosen fragment's chapter color and emotional tagline
- Lock-in celebration animation when altar detects the phone
- Assembled layers stack visualization — each locked layer glows, building the visual representation of the final song
- Forfeited layers shown as dark/absent gaps in the stack

**Finale — Performer Mix:**
- Mirror of the performer's mixing surface (simplified/beautified)
- 6 rows showing active fragment per layer, chapter color
- Pending changes visible (pulsing, about to land)
- Loop position indicator
- Visual energy/density increases as mix builds
- When performer adds live performance layer (vocal, synth), new visual element appears that signals transcendence

### `/controller` — Performer/Operator Interface

**Access:** Secret route + passcode.

**Core Controls:**

| Category | Controls |
|----------|----------|
| **Show Phase** | Start Show, Stop Show, Advance Phase, Jump to Phase (dropdown) |
| **Song-Building** | Open Vote, Close Vote, Force Option A/B, Extend Timer, Rerun Vote |
| **Threshold** | Read-only current threshold, Last vote's winning proportion, FORCE_COLLAPSE |
| **Song Rejection** | Trigger rejection effect (OSC command to Ableton) — only for completed songs |
| **Audio** | Transport Play/Stop, Hard Mute/Panic, Reset Utilities (all gains to 0 dB), Per-layer force on/off |
| **Finale — Assembly** | View group sizes in real time, Extend/shorten timer, Force-assign user to group, Force end assembly early |
| **Finale — Deliberation** | View per-group vote distributions, Extend/shorten timer, Force fragment selection for a group, Force end deliberation early |
| **Finale — Ceremony** | View ambassador status per group, Call next ambassador (auto-advances in fixed order, but can skip/reorder), Force lock-in for a layer, Mark layer as forfeited, Fire NPC lines manually |
| **Finale — Performer Mix** | 6×6 mixing grid (6 layers × 6 fragments: 3 songs × 2 options), Queue/dequeue fragment changes, Mute/unmute layers, Snapshot presets, Loop position display |
| **NPC** | Bank of pre-written NPC lines (organized by phase), Free-text input for improvised lines, Fire button |
| **Live Performance** | Toggle live input tracks (vocal, synth, etc.) |
| **Emergency** | Pause/Resume show, Export/Import state as JSON, Force reconnect all clients, Reset to lobby |

**Metrics/Telemetry:**
- Connected clients count
- Vote counts A vs B, time remaining
- Threshold status per attempt
- Assembly: group sizes per layer type, timer remaining, undecided count
- Deliberation: per-group fragment votes, timer remaining, ambassador volunteer status
- Ceremony: current layer, ambassador status, locked layers, forfeited layers
- Performer mix: active layers, pending changes, loop position
- System health: WebSocket status, Ableton OSC status, error log tail

---

## Visual Identity System

### Chapter Identity (consistent across all UIs)

| Chapter | Color | Icon | Usage |
|---------|-------|------|-------|
| Ambition | TBD | TBD | Song 1, fragment badges |
| Love | TBD | TBD | Song 2, fragment badges |
| Avoidance | TBD | TBD | Song 3, fragment badges |

### Layer Identity (consistent across all 3 attempts + finale groups)

| Layer Type | Color | Symbol | Label |
|------------|-------|--------|-------|
| Melody | TBD | ✦ | "The voice" |
| Drums | TBD | ▲ | "The heartbeat" |
| Pad | TBD | ◆ | "The warmth" |
| Bass | TBD | ■ | "The ground" |
| Harmony | TBD | ● | "The color" |
| FX | TBD | ~ | "The Shimmer" |

*Placeholders — lock before production. Labels are configurable in `default-show.json`.*

### Option Identity (A vs B within a layer)
- Option A: layer color, **solid** style
- Option B: layer color, **outlined** style

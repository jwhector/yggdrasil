# Client Routes & Visual Identity

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (voting mechanics), [finale.md](finale.md) (finale sub-phases)

---

## Client Routes (Next.js App Router)

### `/audience` — Audience Member UI

**Join flow:** Unchanged from V1.

**Story phases (phones down):** Screen goes dark/minimal ("listen" state).

**Song-building phases (V3.2 — 3 bundled layer groups):**
- Two large tappable cards: Option A (left) and Option B (right), styled with layer group identity (symbol derived from first granular type: bones→■, flesh→✦, spark→~)
- **Blind vote**: no live feedback on vote split during the voting window
- After vote closes → **Reveal sequence**:
  1. Both options shown side by side, no result (tension beat)
  2. Split revealed: winning option grows, losing option shrinks proportionally
  3. Threshold check (winning proportion compared against doubt threshold)
  4. Winning option's audio locks into the mix
- 3-slot layer progress indicator showing completed/upcoming layer groups
- Personal vote history dot on each completed layer (subtle indicator of which side you voted for)

**Finale — Elegy moment (optional pre-assembly beat):**
- Full grid of all fragments from all three songs, organized by role
- Winners glowing, losers/locked fragments visually cracked or dimmed
- NPC text narrates: "This is what we have left. This is what we lost."
- Duration: ~10–15 seconds, purely observational, no interaction

**Finale — Assignment (V3.2):**
- Each audience member is assigned to a granular type (bass, drums, melody, pad, harmony, fx)
- Assignment mode configurable: auto (system assigns) or self-select
- Screen shows assigned type with symbol, color, and label

**Finale — Live Mix (V3.2):**
- Phone becomes a live controller — tappable fragment cards for the assigned granular type
- Group's majority determines what the room hears in real time
- Crossfades happen at bar boundaries
- NPC text appears at key moments

> **Note:** V3.2 finale implementation is complete. V3.1 finale code (assembly, deliberation, ceremony) has been removed.

### `/projector` — Public Display

**Story phases:** Dark or minimal atmospheric display.

**Song-building phases (V3.2):**
- Top: Song attempt title + chapter color/icon
- Center: Current layer group card — group symbol + label, Option A vs Option B
- Threshold display: current layer's threshold line
- Reveal animation: vote split visualization, threshold check
- Stack history: icons of chosen layer groups so far (3 slots)

**Finale — Elegy:**
- Full fragment grid with winners glowing, losers/locked dimmed
- NPC text displayed prominently

**Finale — Live Mix (V3.2):**
- All granular types displayed with consensus visualization
- Per-type: which fragment is currently active, vote distributions
- Visual energy/density increases as mix evolves
- Performer's live layer shown when active

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
| **Finale — Live Mix** | Per-type overrides, locks, vote distributions (V3.2) |
| **NPC** | Bank of pre-written NPC lines (organized by phase), Free-text input for improvised lines, Fire button |
| **Live Performance** | Toggle live input tracks (vocal, synth, etc.) |
| **Emergency** | Pause/Resume show, Export/Import state as JSON, Force reconnect all clients, Reset to lobby |

**Metrics/Telemetry:**
- Connected clients count
- Vote counts A vs B, time remaining
- Threshold status per attempt
- Assignment: group sizes per granular type, assignment mode
- Live mix: per-type active fragments, vote distributions, locked types, loop position
- System health: WebSocket status, Ableton OSC status, error log tail

---

## Visual Identity System

### Chapter Identity (consistent across all UIs)

| Chapter | Color | Icon | Usage |
|---------|-------|------|-------|
| Ambition | TBD | TBD | Song 1, fragment badges |
| Love | TBD | TBD | Song 2, fragment badges |
| Avoidance | TBD | TBD | Song 3, fragment badges |

### Layer Group Identity (V3.2 — song-building)

Layer group identity is derived from the first granular type in each group:

| Layer Group | First Granular Type | Symbol | Label |
|-------------|-------------------|--------|-------|
| bones | bass | ■ | "The Foundation" |
| flesh | melody | ✦ | "The Character" |
| spark | fx | ~ | "The Edge" |

### Granular Type Identity (finale)

| Granular Type | Color | Symbol | Label |
|---------------|-------|--------|-------|
| Bass | TBD | ■ | "The Ground" |
| Drums | TBD | ▲ | "The Heartbeat" |
| Pad | TBD | ◆ | "The Warmth" |
| Melody | TBD | ✦ | "The Voice" |
| Harmony | TBD | ● | "The Color" |
| FX | TBD | ~ | "The Shimmer" |

*Colors are placeholders — lock before production. Labels and symbols are configurable in `default-show.json`.*

### Option Identity (A vs B within a layer group)
- Option A: layer group color, **solid** style
- Option B: layer group color, **outlined** style

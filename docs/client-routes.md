# Client Routes & Visual Identity

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (voting mechanics), [finale.md](finale.md) (finale sub-phases)

---

## Client Routes (Next.js App Router)

### `/audience` — Audience Member UI

**Join flow:** Unchanged from V1.

**Story phases (phones down):** Screen goes dark/minimal ("listen" state).

**Song-building phases (V3.2 — 3 bundled layer groups):**
- **Mini pentagon** (canvas) at top showing active/filled/empty/collapsed node states matching the projector
- Two large tappable cards: Option A (left, `chapterIdentity.colorA`) and Option B (right, `chapterIdentity.colorB`)
  - Active card shows "NOW PLAYING" micro-label; selected card shows "YOUR VOTE" + filled dot
  - Cards support inline reveal mode: fill bars showing vote percentages, winner enlarged with "CHOSEN" badge
- **Blind vote**: no live feedback on vote split during the voting window
- **Depleting progress bars**: per-option bar depletes as current option plays; overall bar depletes as voting window closes
- **3-dot layer progress**: filled with winning option's color on lock-in, pulsing outline on current
- After vote closes → **Intrusive thoughts + reveal**:
  1. Server distributes thought bubbles (1→3→5 escalating per layer) from shared pool
  2. Thoughts fall from top of screen, pile up as draggable thought bubbles with sub-bubble tails
  3. UI dims while thoughts are present; voting is blocked
  4. User swipes each thought individually to dismiss (touch + mouse supported)
  5. After all thoughts dismissed AND conductor advances to locked_in/collapsed: vote result shown inside cards
- Intrusive thoughts are mirrored on projector as physics-based membrane bubbles (see `/projector` below)

**Finale — Elegy moment (optional pre-assembly beat):**
- Full grid of all fragments from all three songs, organized by role
- Winners glowing, losers/locked fragments visually cracked or dimmed
- NPC text narrates: "This is what we have left. This is what we lost."
- Duration: ~10–15 seconds, purely observational, no interaction

**Finale — Assignment (V3.2):**
- Each audience member is assigned to a granular type (bass, drums, seed, pad, harmony, fx)
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

**Song-building phases (V3.2) — Canvas 2D:**

Rendered on a single `<canvas>` element via `ProjectorCanvas.tsx`. Dark background (#090909). No DOM components — everything is drawn.

- **Pentagon skeleton:** 5 granular-type nodes (bass, drums, pad, harmony, fx) arranged in a circle around a center melody/seed node
- **Node states:** empty (dim outline), active (pulsing membrane with chapter color), filled (steady glow), collapsed (dashed dark red)
- **Connectors:** radial lines from center to each node; curved bundle arcs for layer groups (bass-drums, harmony-pad) with traveling dot animation during audition
- **A/B labels:** large letters positioned left/right of skeleton, active option pulsing with "NOW PLAYING" micro-label, sound descriptors below
- **Header:** layer group name in chapter color, layer counter
- **Two-beat reveal:** Beat 1 (Show Stakes) fades skeleton, slides A/B to center, animates threshold line. Beat 2 (Reveal Votes) grows bars to vote proportions, shows pass/fail verdict. Both beats are manually triggered via controller.

See `PROJECTOR-VISUAL-SPEC.md` for the full design spec.

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
| flesh | harmony | ● | "The Character" |
| spark | fx | ~ | "The Edge" |

### Granular Type Identity (finale)

| Granular Type | Color | Symbol | Label |
|---------------|-------|--------|-------|
| Bass | TBD | ■ | "The Ground" |
| Drums | TBD | ▲ | "The Heartbeat" |
| Pad | TBD | ◆ | "The Warmth" |
| Seed | TBD | ◎ | "The Seed" |
| Harmony | TBD | ● | "The Color" |
| FX | TBD | ~ | "The Shimmer" |

*Colors are placeholders — lock before production. Labels and symbols are configurable in `default-show.json`.*

### Option Identity (A vs B within a layer group)
- Option A: layer group color, **solid** style
- Option B: layer group color, **outlined** style

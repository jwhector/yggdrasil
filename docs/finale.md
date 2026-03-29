# Finale System — Detailed Mechanics (V3.2)

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (fragment generation rules), [data-models.md](data-models.md) (conductor commands/events)

---

## Overview

The finale has three sub-phases:
1. **Elegy** — audience observes the wreckage of all three songs
2. **Assignment** — audience is assigned to granular type groups (auto or self-select)
3. **Live Mix** — Incredibox-style continuous collaborative mixing; each group controls one granular type

## Narrative Setup

After Song 3's resolution (collapse or rejection), the performer "abandons" the stage — stepping back, giving up, unable to finish anything. Lights shift to red. Every audience member's phone receives an NPC message in terminal-style typeface. The NPC represents the "inner council" gaining consciousness and refusing to let the creator give up: *"He's gone. We need to do this ourselves."*

This frames the finale as a mutiny — the audience acting without the performer, each part of the mind finding its role, proving integration was always possible.

## Phase 1: Finale Elegy

An optional 10-15 second observational moment. Phones show the full grid of all granular fragments from all three songs:
- Winning fragments glow with their chapter color
- Losing fragments are cracked, dimmed, desaturated
- Organized by granular type (6 rows)
- NPC narrates: acknowledges what survived and what was lost
- No interaction — pure narrative beat
- Transitions to assignment when NPC rallies the audience (manual or auto-timed)

## Phase 2: Assignment

Each audience member is assigned to one granular type group (~6-7 people per group for 40 audience members across 6 types). Two modes are supported, selected via config:

### Auto Mode (`assignmentMode: 'auto'`)

The system shuffles all connected users and distributes them evenly (round-robin) across the configured granular types. Assignment is instant — no timer, no user interaction. Users are notified of their assignment and the show proceeds to live mix.

### Self-Select Mode (`assignmentMode: 'self_select'`)

**Phone UI:** Tappable cards for each granular type, each displaying the type's symbol, color, and label (from config). Live group size counts update in real time as people choose. Users can switch freely before the timer expires.

**Timer:** Configurable duration (default: 30 seconds via `assignmentTimerMs`). When the timer expires:
1. Any user who has not selected a type is **randomly assigned** round-robin across all types
2. The system transitions to the live mix phase

**Projector:** Shows the groups forming in real time — animated member counts, granular type symbols growing/pulsing as people join. Timer prominent.

### Fragment Decomposition

Song-building produces layer group results (e.g., "Bones Option A won in Song 1"). The assignment phase decomposes these into **granular fragments** — one per granular track per option. For example, "Bones A" from Song 1 decomposes into separate bass and drums fragments. Each granular type group sees only fragments of their type.

Which fragments are available depends on `bothOptionsSurvive`:
- **true** (default): Both winner and loser options from voted layers are available
- **false**: Only winning options survive to the finale

## Phase 3: Live Mix

The core finale experience. Each audience member's phone becomes a live controller for their assigned granular type.

### Audience Phone UI

Each user sees tappable fragment cards for their granular type — one per available fragment (typically 1-6, depending on how many songs reached their type's layer group). Tapping a card sets their **preference** for which fragment should play.

The group's **majority determines what the room hears** in real time:
- The system tracks each user's current preference per granular type
- The fragment with the most votes in each type group is the **active fragment** — this is what Ableton plays
- When the majority shifts, a **crossfade** happens at the next bar boundary
- **Recency tiebreak:** On a 50/50 split, the most recently cast vote wins

### Performer Controls

The performer (via controller) can:
- **Lock** a granular type — freezes the active fragment, audience votes are ignored
- **Unlock** a granular type — returns to audience majority control
- **Override** a granular type — force a specific fragment regardless of votes
- **Clear override** — return to audience majority

### Audio Behavior

- **Muted start:** Live mix begins fully silent — no transport, no audio
- Audio activates per-type: when a group first reaches majority on a fragment, that type's audio starts
- The **first group to reach majority** triggers Ableton transport playback
- Individual granular tracks are controlled independently (not bundled)
- Crossfades happen at bar boundaries (quantized to loop position)
- The performer returns and plays live over the shifting foundation
- Live performance tracks (vocal mic, live synth, etc.) are toggled separately

### High-Frequency State

Live mix state (`mix_state`) is broadcast at ~4 Hz as a dedicated socket event, NOT through `state_sync`. Contains:
- Per-type active fragment
- Per-type vote distribution (detailed for user's own type, summary for others)

### Projector Display

Shows all granular types with:
- Active fragment per type (highlighted with chapter color)
- Vote distribution visualization (consensus strength)
- Locked types marked
- Loop position indicator

## NPC System (Finale)

The NPC is a narrative voice during the finale, delivered via terminal-style typeface on audience phones and the projector.

**Delivery:** Text appears briefly, disappears between messages. No auto-scrolling history — each message replaces the last.

**Control model:** Event-driven messages for key moments + manual overrides from controller.

**Event-driven messages (configurable text in `default-show.json`):**
- Performer abandonment: "He's gone. We need to do this ourselves."
- Assignment start: "Find your voice."
- Live mix start: "It's yours. Shape it."

**Manual overrides:** Performer has a bank of pre-written NPC lines on the controller, organized by phase, plus a free-text input for improvised lines.

**Pacing:** NPC should NOT speak at every moment. The silence between messages — filled by music shifting and evolving under audience control — is where the emotional weight lives.

## Finale State

```typescript
interface V32FinaleState {
  phase: 'elegy' | 'assignment' | 'live_mix';

  // Fragment availability (GranularFragments decomposed from layer group results)
  availableFragments: GranularFragment[];   // Available to each granular group
  allFragments: GranularFragment[];         // All fragments including locked (for performer)

  // Assignment state
  assignment: {
    mode: 'auto' | 'self_select';
    groups: Map<string, UserId[]>;          // granularTypeId -> user IDs
    timerRemaining: number | null;          // Only populated in self_select mode
  };

  // Live mix state
  liveMix: {
    votes: Map<string, Map<UserId, LiveMixVote>>;  // granularTypeId -> (userId -> vote)
    activeFragments: Map<string, string>;           // granularTypeId -> fragmentId (current majority)
    lockedTypes: string[];                          // Performer-locked granular types
    performerOverrides: Map<string, string>;        // granularTypeId -> fragmentId (performer forced)
    liveTracksActive: string[];                     // Live performance track IDs
    loopPosition: number;                           // 0.0 to 1.0 within current loop
    loopCount: number;
  };

  npc: { currentMessage: string | null };
}

interface LiveMixVote {
  fragmentId: string;
  timestamp: number;          // For recency tiebreak
}

interface GranularFragment {
  id: string;
  songIndex: number;
  layerGroupId: string;       // Which bundle this came from ('bones', 'flesh', 'spark')
  granularType: string;       // Which specific type ('bass', 'drums', etc.)
  option: 'A' | 'B';
  chapter: Chapter;
  trackIndex: number;         // Ableton track index for this specific granular track
  wonVote: boolean;
  previewAudioPath: string;
}
```

# Finale System — Detailed Mechanics

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (fragment generation rules), [data-models.md](data-models.md) (conductor commands/events)

---

## Overview

The finale has five sub-phases:
1. **Elegy** — audience observes the wreckage of all three songs (optional brief beat)
2. **Assembly** — audience self-selects into 7 layer-type groups and physically regroups
3. **Deliberation** — groups preview audio, vote on fragments, and select ambassadors
4. **Ceremony** — ambassadors lock fragments into the final mix at the altar
5. **Performer Mix** — performer returns to live-mix the escalation and climax

## Narrative Setup

After Song 3's resolution (collapse or rejection), the performer "abandons" the stage — stepping back, giving up, unable to finish anything. Lights shift to red. Every audience member's phone receives an NPC message in terminal-style typeface. The NPC represents the "inner council" gaining consciousness and refusing to let the creator give up: *"He's gone. We need to do this ourselves."*

This frames the finale as a mutiny — the audience acting without the performer, each part of the mind finding its role, proving integration was always possible.

## Phase 1: Finale Elegy

An optional 10–15 second observational moment. Phones show the full grid of all fragments from all three songs:
- Winning fragments glow with their chapter color
- Losing fragments are cracked, dimmed, desaturated
- Organized by role (7 rows)
- NPC narrates: acknowledges what survived and what was lost
- No interaction — pure narrative beat
- Transitions to assembly when NPC rallies the audience (manual or auto-timed)

## Phase 2: Group Assembly

The audience physically self-organizes into seven groups — one per layer type.

**Phone UI:** Seven tappable cards, each displaying the layer's symbol, color, and configurable label (from `default-show.json`). Live group size counts update in real time as people choose. No constraints on group size — any group can be empty or hold all 40 people.

**Timer:** Configurable duration (default: 60 seconds). Displayed prominently on phones and projector. When the timer expires:
1. Any audience member who has not selected a group is **randomly assigned** to one of the 7 groups by the server
2. Groups with 0 members are marked as **empty** — that layer type will be skipped in the ceremony and will not have a fragment in the initial mix
3. The system transitions to the deliberation phase

**Physical movement:** After groups are assigned (timer expiry), the phone screen shows "You are [Layer Label]" with the group's identity. The audience is expected to physically move to find others with the same role. The chaos of reorganization is intentional — it mirrors the script's theme of internal parts finding each other. The system does NOT wait for physical assembly to complete; the deliberation timer begins after a brief grace period (configurable, e.g., 10–15 seconds).

**Projector:** Shows the groups forming in real time — animated member counts, layer symbols growing/pulsing as people join. Timer prominent.

## Phase 3: Deliberation

Each group privately deliberates on which fragment to carry into the final song.

**Phone UI per group:** Shows only the available fragments for this group's layer type (1–3 fragments, one per song that reached this layer type). Each fragment card displays:
- Chapter color background
- Emotional tagline from song-building
- Play/pause button for audio preview
- Vote button

**Audio preview:** Each audience member controls playback independently. Tapping play on a fragment starts that clip in the browser via the HTML5 Audio API. Tapping play on a different fragment auto-pauses the first. Volume is at the browser's default level. The natural social dynamics of a huddle (people sharing phones, taking turns, or just listening to the ambient mix of everyone's phones) are part of the experience. Preview files are pre-rendered static mp3s served from `public/audio/previews/`.

**Voting within the group:** Transparent — group members can see how many votes each fragment has. Votes can be changed freely during the deliberation window. This is the opposite of the blind song-building vote; within a small group, transparency encourages real discussion and convergence.

**Timer:** Configurable duration (default: 120 seconds). When the timer expires:
1. The fragment with the most votes in each group wins (**simple majority**). Ties broken randomly.
2. The chosen fragment is locked for each group
3. **Ambassador volunteering** begins immediately after fragment selection

**Ambassador selection:** After the fragment is chosen, each group member sees a prompt: "Will you carry this forward?" with Accept/Decline buttons. Volunteering window: configurable (default: 15 seconds).
- If exactly 1 person volunteers → they are the ambassador
- If multiple volunteer → one is selected randomly
- If nobody volunteers → the layer is **forfeited**. NPC acknowledges: this part of the mind couldn't find its voice. The layer will be skipped in the ceremony.

**Edge cases:**
- **Single-fragment layer types** (only one song reached this layer): the deliberation is trivially decided — the one available fragment wins automatically. The group still goes through the ambassador selection.
- **Single-member groups:** one person makes all decisions — they choose the fragment, they are the ambassador by default (no volunteering step needed).
- **Empty groups:** skipped entirely — no deliberation, no ambassador, layer forfeited.

## Phase 4: Ceremony

The performer returns to the stage (or is about to — the ceremony is the transition point). The system calls ambassadors one by one in a **fixed configurable order** (set in `default-show.json`, e.g., `[bass, drums, pad, melody, harmony, fx1, fx2]`).

**Ceremony flow per layer:**
1. The system announces the next layer (NPC text on phones + projector display: layer symbol, color, label)
2. The ambassador for that layer is called — their phone enters **altar-ready mode**
3. The ambassador approaches the altar on stage
4. The ambassador places their phone face-down on the altar surface
5. The phone detects the face-down + still position via Device Orientation API (~2 second hold)
6. On detection: lock-in event fires to server → audio activation (quantized to next bar boundary, fade-in per existing gain config) → phone vibrates once → screen illuminates with confirmation
7. Ambassador picks up phone, returns to seat
8. System advances to next layer

**Altar lock-in detection (Device Orientation API):**
```typescript
// Detection logic (runs on ambassador's phone during altar-ready mode)
interface AltarDetectionConfig {
  faceDownThreshold: number;       // degrees from face-down (default: 30°)
  stillnessThreshold: number;      // max acceleration delta (default: 0.5 m/s²)
  holdDurationMs: number;          // how long face-down + still must be sustained (default: 2000)
}

// DeviceOrientationEvent: check if phone is face-down
// Face-down = screen pointing toward ground
// Using absolute orientation: when face-down, the z-axis accelerometer reads ~+9.8 m/s²
// (gravity pulling "up" through the back of the phone)
// OR using beta/gamma: beta ≈ ±180° indicates face-down
//
// The detection fires when:
// 1. Phone is within faceDownThreshold degrees of perfectly face-down
// 2. Accelerometer readings are stable (delta < stillnessThreshold) for holdDurationMs
// 3. Both conditions sustained simultaneously
```

**Forfeited layers:** Skipped in the ceremony order. NPC may acknowledge briefly. No audio activation for that layer.

**Ceremony completion:** After all non-forfeited layers have been locked in, the ceremony ends. The song now plays with all locked fragments active. The performer takes over for the performer mix phase.

**Audio activation during ceremony:** Each lock-in unmutes the fragment's Ableton track, quantized to the next bar boundary, with the standard fade-in (per `GainConfig.ceremonySwellBeats`). The song assembles layer by layer — each ambassador's lock-in adds a new voice to the growing mix. By the last lock-in, the audience hears the complete assembled song.

## NPC System (Finale)

The NPC is a narrative voice during the finale, delivered via terminal-style typeface on audience phones and the projector.

**Delivery:** Text appears briefly, disappears between messages. No auto-scrolling history — each message replaces the last.

**Control model:** Event-driven messages for key moments + manual overrides from controller.

**Event-driven messages (configurable text in `default-show.json`):**
- Performer abandonment: "He's gone. We need to do this ourselves."
- Assembly start: "Choose your role. Find each other."
- Assembly timer warning (e.g., 10s remaining): "Decide now."
- Deliberation start: "Listen. Decide together."
- Empty group detected: "No one chose [layer label]. We'll go without it."
- Ambassador selected: "[Layer label] has its voice."
- No ambassador (forfeit): "[Layer label] goes silent. Not every part survives."
- Ceremony start: "One by one. Bring it forward."
- Layer locked in: brief acknowledgment (varies by layer)
- Final layer locked: "That's all of us."
- Ceremony complete / performer return: "He's back. Show him what we built."

**Manual overrides:** Performer has a bank of pre-written NPC lines on the controller, organized by phase, plus a free-text input for improvised lines.

**Pacing:** NPC should NOT speak at every moment. The silence between messages — filled by music building layer by layer — is where the emotional weight lives.

## Phase 5: Performer Mix

The performer returns to take control of the mix. This is a live performance tool.

**Initial state:** The performer mix begins with the fragments locked in during the ceremony as the active layers. Forfeited layers start muted.

**Mixing Surface (controller):**
- 7 rows (one per layer type) × 6 columns (Song 1 A, Song 1 B, Song 2 A, Song 2 B, Song 3 A, Song 3 B)
- Each cell is a fragment. Tapping a cell **queues** it to activate at the next loop boundary.
- Active fragment in each row is highlighted
- Pending (queued) fragment shows distinct visual (pulsing border, countdown)
- Only one fragment per row active at a time — tapping a new one in the same row queues a swap
- Tap the active fragment to queue a **mute** for that row at next boundary
- Tap a pending fragment again to **cancel** (dequeue)
- **All changes fire simultaneously at the loop boundary** — performer builds up multiple changes, they all land on the downbeat

**Loop position indicator:** Progress bar or radial timer showing position within current 8-bar loop and time until next boundary. This is the performance clock.

**Snapshot presets:** Configurable buttons that queue an entire mix state (all 7 layers set to specific fragments) in one tap. Useful for rehearsed structural jumps.

**Live performance tracks:** Additional on/off toggles for tracks not in the fragment pool — vocal mic, live synth, etc. These are the performer's secret weapon, the element the audience never had access to.

**Projector mirror:** The projector shows a simplified, beautified version of the mixing grid. Active fragments glow with chapter colors. Pending changes pulse. Loop position indicator visible. The audience watches the performer "DJ" with a legible interface.

**Pending changes queue:**
```typescript
interface PendingChange {
  layerType: LayerType;
  fragmentId: string | null;    // null = mute this layer
  queuedAt: number;
}
```

At each loop boundary, the timing engine:
1. Collects all pending changes
2. Fires corresponding OSC commands simultaneously (mute outgoing, unmute incoming)
3. Clears the pending queue
4. Broadcasts updated state to all clients

**Crossfade:** When swapping fragments in a role, Ableton handles a ~1 bar crossfade (old fragment fades out, new one fades in, overlapping at the loop boundary).

## Finale State

```typescript
interface FinaleState {
  phase: 'elegy' | 'assembly' | 'deliberation' | 'ceremony' | 'performer_mix';

  // Fragment availability (computed from song-building results)
  availableFragments: Fragment[];     // Winners only (for group deliberation)
  allFragments: Fragment[];           // All 42 (for performer mixing surface)
  lockedFragments: Fragment[];        // Losers + unreached (for elegy display)

  // Group assembly state
  assembly: {
    groups: Map<LayerType, UserId[]>;       // layerType → array of user IDs
    undecidedUsers: UserId[];               // Users who haven't chosen yet
    timerRemaining: number;                 // ms
    timerDuration: number;                  // ms (total)
  };

  // Deliberation state
  deliberation: {
    groupVotes: Map<LayerType, Map<UserId, string>>;  // layerType → (userId → fragmentId)
    chosenFragments: Map<LayerType, string | null>;    // layerType → fragmentId or null (after timer)
    ambassadorVolunteers: Map<LayerType, UserId[]>;    // layerType → volunteer user IDs
    ambassadors: Map<LayerType, UserId | null>;        // layerType → chosen ambassador or null
    timerRemaining: number;                            // ms (deliberation timer)
    volunteerTimerRemaining: number | null;            // ms (ambassador volunteering timer, null if not active)
  };

  // Ceremony state
  ceremony: {
    layerOrder: LayerType[];                    // Fixed configurable order
    currentIndex: number;                       // Index into layerOrder
    currentAmbassador: UserId | null;           // Ambassador currently called
    altarReady: boolean;                        // Whether current ambassador's phone is in altar-ready mode
    lockedLayers: Map<LayerType, string>;        // layerType → fragmentId (locked in at altar)
    forfeitedLayers: LayerType[];               // Layers with no ambassador
    ceremonyComplete: boolean;
  };

  // NPC state
  npc: {
    currentMessage: string | null;
  };

  // Performer mix state
  performerMix: {
    activeLayers: Map<LayerType, string | null>;  // layerType → fragmentId or null (muted)
    pendingChanges: PendingChange[];
    loopPosition: number;             // 0.0 to 1.0 within current 8-bar loop
    loopCount: number;                // Total loops since finale started
    liveTracksActive: string[];       // IDs of active live performance tracks
  };
}
```

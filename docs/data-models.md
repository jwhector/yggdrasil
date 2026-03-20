# Data Models & Conductor API

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (health bar, layer types), [finale.md](finale.md) (FinaleState type definition)

**Note:** FinaleState is defined in [finale.md](finale.md) alongside its behavioral specification.

---

## User

```typescript
interface User {
  id: UserId;                   // Persistent across reconnection (stored client-side)
  seatId: SeatId | null;        // From QR code scan; null if joined without QR
  connected: boolean;
  joinedAt: number;
}
```

## Show State

```typescript
interface ShowState {
  id: string;                          // Unique show instance
  phase: ShowPhase;
  currentAttemptIndex: number;         // 0, 1, 2
  attempts: AttemptState[];            // Length 3, pre-initialized
  users: Map<UserId, User>;
  finaleState: FinaleState | null;     // Populated at finale_elegy
  config: ShowConfig;
  version: number;                     // Increments on every state change
  lastUpdated: number;
  paused: boolean;
}

interface AttemptState {
  index: number;                       // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layerPlan: LayerConfig[];            // Always length 7
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];         // Populated as layers resolve
  votes: LayerVote[];                  // All votes for this attempt
  healthBar: HealthBarState;
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
}

type Chapter = 'ambition' | 'love' | 'avoidance';
```

## Show Config

```typescript
interface ShowConfig {
  layersPerAttempt: number;            // Always 7
  attempts: AttemptConfig[];           // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;
  };
  seatIds: SeatId[];
}

interface AttemptConfig {
  chapter: Chapter;
  title: string;
  layers: LayerConfig[];              // 7 layers, staggered per song
  drainFactor: number;                // Health bar base drain multiplier for this attempt
  layerMultipliers: number[];         // Per-layer scaling factors (length 7)
}

interface FinaleConfig {
  assemblyTimerMs: number;             // Duration of group assembly phase
  assemblyGracePeriodMs: number;       // Grace period after assignment before deliberation
  deliberationTimerMs: number;         // Duration of group deliberation phase
  ambassadorVolunteerTimerMs: number;  // Duration of ambassador volunteering window
  ceremonyLayerOrder: LayerType[];     // Fixed order for ambassador call-ups
  audioPreviewPath: string;            // Base URL path for preview audio files
  layerLabels: Map<LayerType, string>; // Configurable display labels for assembly cards (e.g., "The Heartbeat")
  npcMessages: NpcMessageConfig[];     // Event-driven NPC messages (event key → text)
}

interface NpcMessageConfig {
  event: string;                       // Event key (e.g., 'performer_abandonment', 'assembly_start', 'layer_locked')
  layerType?: LayerType;               // Optional: specific to a layer type
  text: string;                        // The NPC message text
}

interface TimingConfig {
  auditionDurationMs: number;
  votingWindowMs: number;
  revealSequenceDurationMs: number;
  rejectionEffectDurationMs: number;
  beatsPerLoop: number;
  auditionsPerLayer: number;
  gain: GainConfig;
}

interface GainConfig {
  entryGain: number;
  entrySwellBeats: number;
  holdBars: number;
  exitFadeBeats: number;
  lockInFadeBeats: number;
  collapseFadeBeats: number;
  ceremonySwellBeats: number;    // Beats to swell ceremony-activated fragments
  unityGainValue: number;
  stepsPerBeat: number;
}

interface Fragment {
  id: string;
  songIndex: number;                   // 0, 1, 2
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayLabel: string;               // Emotional tagline from layer config
  audioRef: AudioReference;           // Ableton track index
  previewAudioPath: string;           // URL path to preview audio file
}
```

---

## Conductor (Pure State Machine)

The Conductor is a pure logic module with no I/O. It receives commands, validates them, updates state, and emits events.

### Commands (Input)

```typescript
type ConductorCommand =
  // Show flow
  | { type: 'ADVANCE_PHASE' }
  | { type: 'JUMP_TO_PHASE'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }

  // Song-building
  | { type: 'START_AUDITION' }
  | { type: 'OPEN_VOTING' }
  | { type: 'CLOSE_VOTING' }
  | { type: 'SUBMIT_VOTE'; userId: UserId; choice: 'A' | 'B' }
  | { type: 'FORCE_OPTION'; choice: 'A' | 'B' }
  | { type: 'EXTEND_VOTE_TIMER'; additionalMs: number }
  | { type: 'RERUN_VOTE' }

  // Health Bar
  | { type: 'SET_DRAIN_FACTOR'; factor: number }
  | { type: 'SET_HEALTH'; value: number }
  | { type: 'FORCE_COLLAPSE' }

  // Song Rejection
  | { type: 'TRIGGER_REJECTION' }

  // Finale — Setup
  | { type: 'SETUP_FINALE' }

  // Finale — Assembly
  | { type: 'START_ASSEMBLY' }
  | { type: 'JOIN_GROUP'; userId: UserId; layerType: LayerType }
  | { type: 'ASSEMBLY_TIMER_EXPIRED' }
  | { type: 'FORCE_ASSIGN_USER'; userId: UserId; layerType: LayerType }
  | { type: 'EXTEND_ASSEMBLY_TIMER'; additionalMs: number }
  | { type: 'FORCE_END_ASSEMBLY' }

  // Finale — Deliberation
  | { type: 'START_DELIBERATION' }
  | { type: 'SUBMIT_GROUP_VOTE'; userId: UserId; layerType: LayerType; fragmentId: string }
  | { type: 'DELIBERATION_TIMER_EXPIRED' }
  | { type: 'VOLUNTEER_AS_AMBASSADOR'; userId: UserId; layerType: LayerType }
  | { type: 'AMBASSADOR_VOLUNTEER_TIMER_EXPIRED'; layerType: LayerType }
  | { type: 'FORCE_FRAGMENT_SELECTION'; layerType: LayerType; fragmentId: string }
  | { type: 'EXTEND_DELIBERATION_TIMER'; additionalMs: number }
  | { type: 'FORCE_END_DELIBERATION' }

  // Finale — Ceremony
  | { type: 'START_CEREMONY' }
  | { type: 'CALL_NEXT_AMBASSADOR' }
  | { type: 'ALTAR_LOCK_IN'; userId: UserId; layerType: LayerType }
  | { type: 'FORCE_LOCK_IN'; layerType: LayerType }
  | { type: 'FORFEIT_LAYER'; layerType: LayerType }
  | { type: 'SKIP_TO_LAYER'; layerType: LayerType }

  // Finale — NPC
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Finale — Performer Mix
  | { type: 'START_PERFORMER_MIX' }
  | { type: 'QUEUE_FRAGMENT'; layerType: LayerType; fragmentId: string | null }
  | { type: 'CANCEL_PENDING'; layerType: LayerType }
  | { type: 'FIRE_PENDING_CHANGES' }
  | { type: 'LOAD_SNAPSHOT'; snapshot: Map<LayerType, string | null> }
  | { type: 'TOGGLE_LIVE_TRACK'; trackId: string }

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }
  | { type: 'RESET_UTILITIES' }

  // Connection
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId }
  | { type: 'USER_DISCONNECT'; userId: UserId }

  // Recovery
  | { type: 'EXPORT_STATE' }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' }
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean };
```

### Events (Output)

```typescript
type ConductorEvent =
  // Show flow
  | { type: 'SHOW_PHASE_CHANGED'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }

  // Song-building
  | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'HEALTH_BAR_DRAINED'; attemptIndex: number; layerIndex: number; drain: HealthBarDrain }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number; healthBar: HealthBarState }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }
  | { type: 'SONG_REJECTED'; attemptIndex: number }

  // Finale — Setup
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: Fragment[]; lockedFragments: Fragment[] }

  // Finale — Assembly
  | { type: 'ASSEMBLY_STARTED'; timerDuration: number }
  | { type: 'GROUP_MEMBERSHIP_CHANGED'; groups: Map<LayerType, UserId[]>; undecidedCount: number }
  | { type: 'ASSEMBLY_COMPLETE'; groups: Map<LayerType, UserId[]>; emptyGroups: LayerType[] }

  // Finale — Deliberation
  | { type: 'DELIBERATION_STARTED'; timerDuration: number }
  | { type: 'GROUP_VOTE_UPDATED'; layerType: LayerType; votes: Map<string, number> }
  | { type: 'FRAGMENT_CHOSEN'; layerType: LayerType; fragmentId: string }
  | { type: 'AMBASSADOR_VOLUNTEERED'; layerType: LayerType; userId: UserId }
  | { type: 'AMBASSADOR_SELECTED'; layerType: LayerType; userId: UserId }
  | { type: 'LAYER_FORFEITED'; layerType: LayerType }
  | { type: 'DELIBERATION_COMPLETE' }

  // Finale — Ceremony
  | { type: 'CEREMONY_STARTED'; layerOrder: LayerType[] }
  | { type: 'AMBASSADOR_CALLED'; layerType: LayerType; userId: UserId }
  | { type: 'ALTAR_LOCK_IN_DETECTED'; layerType: LayerType; fragmentId: string }
  | { type: 'CEREMONY_LAYER_LOCKED'; layerType: LayerType; fragmentId: string }
  | { type: 'CEREMONY_LAYER_SKIPPED'; layerType: LayerType }
  | { type: 'CEREMONY_COMPLETE'; lockedLayers: Map<LayerType, string> }

  // Finale — NPC
  | { type: 'NPC_MESSAGE'; message: string }

  // Finale — Performer Mix
  | { type: 'PERFORMER_MIX_STARTED' }
  | { type: 'PENDING_CHANGES_FIRED'; changes: PendingChange[] }
  | { type: 'MIX_STATE_UPDATED'; activeLayers: Map<LayerType, string | null> }

  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }

  // State
  | { type: 'STATE_UPDATED'; version: number };

interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;           // Winning side's proportion
  votesA: number;
  votesB: number;
  totalVotes: number;
  drain: HealthBarDrain;
}
```

# Data Models & Conductor API

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (doubt threshold, layer types), [finale.md](finale.md) (V33FinaleState type definition)

**Note:** V33FinaleState, QuiltCell, and QuiltConfig are defined in [finale.md](finale.md) alongside their behavioral specification. GranularFragment is still used for the elegy wreckage display; V3.3 quilt phases use QuiltCell with songIndex.

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
  finaleState: V33FinaleState | null;   // Populated at finale_elegy
  config: ShowConfig;
  version: number;                     // Increments on every state change
  lastUpdated: number;
  paused: boolean;
}

interface AttemptState {
  index: number;                       // 0, 1, 2
  chapter: Chapter;                    // 'ambition' | 'love' | 'avoidance'
  layerPlan: V32LayerConfig[];         // Always length 3 (V3.2 bundled layer groups)
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];         // Populated as layers resolve
  votes: LayerVote[];                  // All votes for this attempt
  currentVoteResult: VoteResult | null;
  currentAuditionOption: 'A' | 'B' | null;
  auditionLoopIndex: number;
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;     // Layer index where collapse occurred, or null
}

type Chapter = 'ambition' | 'love' | 'avoidance';
```

## Show Config

```typescript
interface ShowConfig {
  layersPerAttempt: number;            // Always 3 (V3.2)
  granularTypes?: GranularType[];      // V3.2: master registry of granular types
  layerGroups?: LayerGroupConfig[];    // V3.2: layer group definitions (bones/flesh/spark)
  attempts: V32AttemptConfig[];        // Length 3
  finale: V33FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;
  };
  seatIds: SeatId[];
}

interface V32AttemptConfig {
  chapter: Chapter;
  title: string;
  liveSeed: LiveSeedConfig;           // Prerecorded performer loop tracks
  layers: V32LayerConfig[];           // 3 bundled layer groups, staggered per song
  thresholds: number[];               // Per-layer doubt thresholds (length 3)
  tempos: number[];                   // Per-layer BPM (length 3)
  auditionBars: number[];             // Bars per option during audition (length 3)
  auditionCycles: number[];           // Number of A/B cycles per layer (length 3)
}

interface V32LayerConfig {
  index: number;
  group: LayerGroupId;                // 'bones' | 'flesh' | 'spark'
  optionA: TrackBundle;
  optionB: TrackBundle;
  labelA: string;
  labelB: string;
}

interface TrackBundle {
  tracks: GranularTrackRef[];
}

interface GranularTrackRef {
  granularType: string;               // e.g., 'bass', 'drums', 'seed'
  trackIndex: number;                 // Ableton track index (config-driven)
}

interface LiveSeedConfig {
  trackIndices: number[];
  label: string;
}

interface LayerGroupConfig {
  id: LayerGroupId;
  label: string;                      // e.g., "The Foundation"
  granularTypes: string[];            // e.g., ['bass', 'drums']
}

interface GranularType {
  id: string;
  label: string;                      // e.g., "The Ground"
  color: string;
  symbol: string;                     // e.g., "■"
}

interface V33FinaleConfig {
  assignmentMode: 'auto' | 'self_select';  // How users claim quilt cells
  bothOptionsSurvive: boolean;             // When true, both options from voted layers are available in elegy
  audioPreviewPath: string;                // Base URL path for preview audio files
  npcMessages: NpcMessageConfig[];         // Event-driven NPC messages (event key -> text)
  quilt: QuiltConfig;                      // See finale.md for QuiltConfig definition
}

interface NpcMessageConfig {
  event: string;                       // Event key (e.g., 'performer_abandonment', 'assembly_start', 'layer_locked')
  layerType?: LayerType;               // Optional: specific to a layer type
  text: string;                        // The NPC message text
}

interface TimingConfig {
  revealSequenceDurationMs: number;
  rejectionEffectDurationMs: number;
  loopBoundaryBeats: number;            // Beats per performer mix loop boundary (e.g. 32 = 8 bars)
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

// Used for elegy wreckage display. V3.3 quilt phases use QuiltCell with songIndex instead.
interface GranularFragment {
  id: string;
  songIndex: number;                   // 0, 1, 2
  layerGroupId: string;               // Which bundle ('bones', 'flesh', 'spark')
  granularType: string;               // Which specific type ('bass', 'drums', etc.)
  option: 'A' | 'B';
  chapter: Chapter;
  trackIndices: number[];             // Ableton track indices (config-driven)
  wonVote: boolean;                   // true if this option won the blind vote
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
  | { type: 'CLOSE_VOTING' }
  | { type: 'SUBMIT_VOTE'; userId: UserId; choice: 'A' | 'B' }
  | { type: 'FORCE_OPTION'; choice: 'A' | 'B' }
  | { type: 'EXTEND_VOTE_TIMER'; additionalMs: number }
  | { type: 'RERUN_VOTE' }
  | { type: 'ADVANCE_FROM_REVEAL' }
  | { type: 'TOGGLE_AUDITION' }
  | { type: 'FORCE_COLLAPSE' }

  // Song Rejection
  | { type: 'TRIGGER_REJECTION' }

  // Finale — Setup & NPC
  | { type: 'SETUP_FINALE' }
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Finale — Assignment (V3.3: cell claiming)
  | { type: 'START_ASSIGNMENT' }
  | { type: 'CLAIM_CELL'; userId: UserId; cellId: string }
  | { type: 'RELEASE_CELL'; userId: UserId }
  | { type: 'ASSIGNMENT_COMPLETE' }

  // Finale — Preview (V3.3)
  | { type: 'START_PREVIEW' }
  | { type: 'SET_CELL_SONG'; userId: UserId; songIndex: number }
  | { type: 'LOCK_IN_CHOICE'; userId: UserId }
  | { type: 'PREVIEW_COMPLETE' }

  // Finale — Playback & Remix (V3.3)
  | { type: 'START_PLAYBACK' }
  | { type: 'MOVE_CELL'; userId: UserId; targetCellId: string }
  | { type: 'CHANGE_CELL_SONG'; userId: UserId; songIndex: number }
  | { type: 'REORDER_COLUMN'; fromIndex: number; toIndex: number }
  | { type: 'SWAP_CELLS'; cellIdA: string; cellIdB: string }
  | { type: 'LOCK_CELL'; cellId: string }
  | { type: 'UNLOCK_CELL'; cellId: string }
  | { type: 'MUTE_CELL'; cellId: string }
  | { type: 'UNMUTE_CELL'; cellId: string }
  | { type: 'OVERRIDE_CELL_SONG'; cellId: string; songIndex: number }

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
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean }
  | { type: 'NEW_SHOW' };
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
  | { type: 'AUDITION_OPTION_CHANGED'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; loopIndex: number; totalLoops: number }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'THRESHOLD_CHECK'; attemptIndex: number; layerIndex: number; winningProportion: number; threshold: number; passed: boolean }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }
  | { type: 'SONG_REJECTED'; attemptIndex: number }

  // Finale — Setup & NPC
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: GranularFragment[]; allFragments: GranularFragment[] }
  | { type: 'NPC_MESSAGE'; message: string }

  // Finale — Assignment (V3.3: cell claiming)
  | { type: 'ASSIGNMENT_STARTED'; mode: 'auto' | 'self_select'; quiltDimensions: { rows: number; columns: number } }
  | { type: 'CELL_CLAIMED'; cellId: string; userId: UserId }
  | { type: 'CELL_RELEASED'; cellId: string }
  | { type: 'ALL_CELLS_ASSIGNED' }

  // Finale — Preview (V3.3)
  | { type: 'PREVIEW_STARTED' }
  | { type: 'CELL_SONG_SET'; cellId: string; songIndex: number }
  | { type: 'USER_LOCKED_IN'; userId: UserId }

  // Finale — Playback & Remix (V3.3)
  | { type: 'PLAYBACK_STARTED'; quilt: Map<string, QuiltCell>; columnOrder: number[] }
  | { type: 'PLAYHEAD_ADVANCED'; columnIndex: number }
  | { type: 'CELL_MOVED'; cellId: string; fromPosition: { row: number; col: number }; toPosition: { row: number; col: number }; swappedWithCellId: string | null }
  | { type: 'COLUMN_REORDERED'; columnOrder: number[] }
  | { type: 'CELLS_SWAPPED'; cellIdA: string; cellIdB: string }
  | { type: 'CELL_LOCKED'; cellId: string }
  | { type: 'CELL_MUTED'; cellId: string }
  | { type: 'CELL_UNMUTED'; cellId: string }

  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }

  // State
  | { type: 'STATE_UPDATED'; version: number }

  // Recovery
  | { type: 'FORCE_RECONNECT'; reason: string }
  | { type: 'SHOW_RESET'; preservedUsers: boolean }

  // Errors
  | { type: 'ERROR'; message: string; command?: ConductorCommand };

type AudioCue =
  | { type: 'set_tempo'; bpm: number; attemptIndex: number; layerIndex: number }
  | { type: 'audition_start'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; trackBundle: TrackBundle; otherTrackBundle: TrackBundle }
  | { type: 'audition_stop'; attemptIndex: number; layerIndex: number; option: 'A' | 'B' | null; trackBundle?: TrackBundle }
  | { type: 'lock_in'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B'; winnerTrackBundle: TrackBundle; loserTrackBundle: TrackBundle }
  | { type: 'live_seed_start'; attemptIndex: number; trackIndices: number[] }
  | { type: 'live_seed_stop'; attemptIndex: number; trackIndices: number[] }
  | { type: 'collapse_gesture'; attemptIndex: number }
  | { type: 'rejection_gesture'; attemptIndex: number }
  | { type: 'quilt_playback_start'; initialColumn: number; trackIndices: number[] }
  | { type: 'quilt_column_change'; columnIndex: number; trackChanges: { granularType: string; muteTrack: number | null; unmuteTrack: number | null }[] }
  | { type: 'quilt_reorder'; newColumnOrder: number[] }
  | { type: 'quilt_mute_cell'; granularType: string; columnIndex: number; trackIndex: number }
  | { type: 'quilt_unmute_cell'; granularType: string; columnIndex: number; trackIndex: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }
  | { type: 'reset_utilities' };

interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;           // Winning side's proportion (kept for backward compat, same as winningProportion)
  votesA: number;
  votesB: number;
  totalVotes: number;
}
```

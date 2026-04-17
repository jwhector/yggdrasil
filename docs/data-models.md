# Data Models & Conductor API

> Part of the Yggdrasil Architecture Spec. See [ARCHITECTURE.md](../ARCHITECTURE.md) for index and core concepts.
> **Related:** [song-building.md](song-building.md) (doubt threshold, layer types), [finale.md](finale.md) (FinaleState type definition)

**Note:** FinaleState, TokenPool, and FinaleConfig are defined in [finale.md](finale.md) alongside their behavioral specification. GranularFragment is still used for the elegy wreckage display; V3.4 finale phases use Token/TokenPool for the token pool model.

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
  finaleState: FinaleState | null;     // Populated at finale_vote
  config: ShowConfig;
  version: number;                     // Increments on every state change
  lastUpdated: number;
  paused: boolean;
  openerSlideState: OpenerSlidePosition | null;  // null = blank screen
}

type ShowPhase =
  | 'lobby'
  | 'opener'
  | 'attempt_story'
  | 'attempt_build'
  | 'attempt_resolve'
  | 'finale_vote'
  | 'finale_remix'
  | 'epilogue'
  | 'ended';

interface AttemptState {
  index: number;                       // 0, 1, 2
  chapter: Chapter;                    // Config-driven chapter ID string
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

type Chapter = string;  // Config-driven — references ChapterConfig.id
```

## Show Config

```typescript
interface ShowConfig {
  layersPerAttempt: number;            // Always 3 (V3.2)
  chapters?: ChapterConfig[];         // Visual identity per chapter (color, label, icon)
  granularTypes?: GranularType[];      // V3.2: master registry of granular types
  layerGroups?: LayerGroupConfig[];    // V3.2: layer group definitions (bones/flesh/spark)
  attempts: V32AttemptConfig[];        // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;
  };
  seatIds: SeatId[];
  intrusiveThoughts?: IntrusiveThoughtsConfig[];
  openerSlides?: OpenerSlide[];
}

interface ChapterConfig {
  id: Chapter;
  label: string;          // Display name (e.g., 'Ambition')
  color: string;          // Primary / seed CSS color
  colorA: string;         // Option A CSS color
  colorB: string;         // Option B CSS color
  icon: string;           // Unicode symbol
  songIndex?: number;     // V3.4: maps chapter to song index (0, 1, 2) for track resolution
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
  trackIndices: number[];             // Ableton track indices (multiple tracks played as one unit)
  alwaysAvailable?: boolean;          // When true, generates a fragment regardless of vote outcome
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

interface FinaleConfig {
  bothOptionsSurvive: boolean;             // When true, both options from voted layers are available
  audioPreviewPath: string;                // Base URL path for preview audio files
  npcMessages: NpcMessageConfig[];         // Event-driven NPC messages (event key -> text)
  vote: VotePhaseConfig;                   // V3.4: vote phase configuration
  remix: RemixConfig;                      // V3.4: remix phase configuration
  epilogue?: {                             // Exit music config (optional)
    trackIndices: number[];                // Ableton track indices for walk-out music
    fadeInBeats: number;                   // Beats to fade in exit tracks (default: 8)
  };
}

interface VotePhaseConfig {
  questions: QuestionConfig[];             // Ordered question bank
  shuffleQuestions: boolean;               // Randomize order per person (default: false)
  targetPoolSize: number;                  // Pool cap — total tokens before phones go dark (default: 120)
  questionDelayMs: number;                 // Delay between answer and next question (default: 3000)
  revealPoolOnProjector: boolean;          // Show dots blooming on projector in real time (default: true)
}

interface QuestionConfig {
  text: string;                            // e.g., "What does he need to hear?"
}

interface RemixConfig {
  audienceInteraction: boolean;            // Default mode: false (standard loop-quantized behavior)
}

interface NpcMessageConfig {
  event: string;                       // Event key (e.g., 'performer_abandonment', 'assembly_start')
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
  crossfadeBeats: number;        // Beats for node crossfade (default: 1)
  unityGainValue: number;
  stepsPerBeat: number;
  masterDuckGain: number;        // Ducked master gain during speech (default: 0.3)
  masterDuckBeats: number;       // Beats to ramp master to ducked level (default: 2)
  masterUnduckBeats: number;     // Beats to ramp master back to unity (default: 1)
  masterFadeOutBeats: number;    // Beats to fade master to zero at show end (default: 16)
}

// Used for elegy wreckage display.
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

### V3.4 Finale Types

```typescript
// Token Pool types — used during finale_vote and finale_remix phases

interface TokenPool {
  available: Map<string, number>;     // chapterId -> remaining available count
  total: Map<string, number>;         // chapterId -> original count (for display)
}

interface Token {
  id: string;
  ownerId: UserId;
  chapterId: string;
  questionIndex: number;
  status: 'available' | 'queued' | 'playing' | 'spent';
}

interface QueuedToken {
  tokenId: string;
  chapterId: string;
  queuedAt: number;       // Timestamp
}

interface ActiveNode {
  tokenId: string;
  chapterId: string;
  startedAtLoop: number;
  trackIndex: number;     // Resolved Ableton track index
  persistent: boolean;    // True when activated in audience interaction mode
}

interface FinaleState {
  phase: 'vote' | 'remix';

  // Vote phase tracking
  vote: {
    questionsAnsweredByUser: Map<UserId, number>;
    maxQuestionsPerPerson: number;     // Derived from targetPoolSize / audienceCount
    poolCapReached: boolean;
  };

  // Token pool
  pool: {
    tokens: Token[];
    availableByChapter: Map<string, number>;
    totalByChapter: Map<string, number>;
    totalRemaining: number;
    targetPoolSize: number;
  };

  // Performer queue (what's coming on the next loop boundary)
  queue: Map<string, QueuedToken[]>;   // granularType -> ordered list of queued tokens

  // Currently playing (what's active right now)
  active: Map<string, ActiveNode>;     // granularType -> currently playing info

  // Mode
  audienceInteraction: boolean;        // When true: instant crossfade + persistent looping

  // Track resolution (granularType -> songIndex -> Ableton trackIndices)
  trackMap: Map<string, Map<number, number[]>>;

  // Loop tracking
  loopCount: number;
  loopProgress: number;                // 0.0-1.0, for display

  npc: { currentMessage: string | null };
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
  | { type: 'ADVANCE_SLIDE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }

  // Song-building
  | { type: 'START_AUDITION' }
  | { type: 'TOGGLE_AUDITION' }
  | { type: 'CLOSE_VOTING' }
  | { type: 'REVEAL_STAKES' }
  | { type: 'ADVANCE_FROM_REVEAL' }
  | { type: 'ADVANCE_FROM_VERDICT' }
  | { type: 'SUBMIT_VOTE'; userId: UserId; choice: 'A' | 'B' }
  | { type: 'FORCE_OPTION'; choice: 'A' | 'B' }
  | { type: 'EXTEND_VOTE_TIMER'; additionalMs: number }
  | { type: 'RERUN_VOTE' }
  | { type: 'FORCE_COLLAPSE' }

  // Song Rejection
  | { type: 'TRIGGER_REJECTION' }

  // Finale — Setup & NPC
  | { type: 'SETUP_FINALE' }
  | { type: 'SEND_NPC_MESSAGE'; message: string }

  // Finale — Vote phase (V3.4)
  | { type: 'START_VOTE' }
  | { type: 'SUBMIT_EMOTION'; userId: UserId; chapterId: string; questionIndex: number }
  | { type: 'REQUEST_NEXT_QUESTION'; userId: UserId }
  | { type: 'POOL_CAP_REACHED' }

  // Finale — Remix phase (V3.4)
  | { type: 'START_REMIX' }
  | { type: 'QUEUE_TOKEN'; granularType: string; chapterId: string; instant?: boolean }
  | { type: 'CANCEL_QUEUE'; granularType: string }
  | { type: 'TOGGLE_AUDIENCE_INTERACTION' }
  | { type: 'LOOP_BOUNDARY' }

  // Manual end (V3.4)
  | { type: 'END_SHOW' }

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }
  | { type: 'MASTER_PANIC' }
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
  | { type: 'OPENER_SLIDE_CHANGED'; position: OpenerSlidePosition | null }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }

  // Song-building
  | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
  | { type: 'AUDITION_OPTION_CHANGED'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; loopIndex: number; totalLoops: number }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'THRESHOLD_CHECK'; attemptIndex: number; layerIndex: number; winningProportion: number; threshold: number; passed: boolean }
  | { type: 'REVEAL_STAKES_SHOWN'; attemptIndex: number; layerIndex: number; threshold: number }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }
  | { type: 'SONG_REJECTED'; attemptIndex: number }

  // Finale — Setup & NPC
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: GranularFragment[]; allFragments: GranularFragment[] }
  | { type: 'NPC_MESSAGE'; message: string }

  // Finale — Vote phase (V3.4)
  | { type: 'VOTE_STARTED' }
  | { type: 'EMOTION_RECEIVED'; userId: UserId; chapterId: string; questionIndex: number; poolSize: number }
  | { type: 'NEXT_QUESTION'; userId: UserId; questionIndex: number; questionText: string }
  | { type: 'POOL_CAP_REACHED'; finalPoolSize: number }
  | { type: 'POOL_READY'; pool: TokenPool }

  // Finale — Remix phase (V3.4)
  | { type: 'REMIX_STARTED'; pool: TokenPool }
  | { type: 'TOKEN_QUEUED'; granularType: string; chapterId: string; queueDepth: number }
  | { type: 'TOKEN_CANCELLED'; granularType: string; chapterId: string; returnedToPool: boolean }
  | { type: 'TOKEN_ACTIVATED'; granularType: string; chapterId: string; tokenId: string; trackIndex: number }
  | { type: 'TOKEN_SPENT'; granularType: string; tokenId: string; poolRemaining: number }
  | { type: 'NODE_SILENT'; granularType: string }
  | { type: 'POOL_EMPTY' }

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
  | { type: 'remix_start' }
  | { type: 'node_unmute'; granularType: string; trackIndex: number }
  | { type: 'node_crossfade'; granularType: string; muteTrack: number; unmuteTrack: number }
  | { type: 'node_instant_crossfade'; granularType: string; muteTrack: number | null; unmuteTrack: number }
  | { type: 'node_fade_out'; granularType: string; trackIndex: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }
  | { type: 'master_panic' }
  | { type: 'reset_utilities' }
  | { type: 'master_duck' }
  | { type: 'master_unduck' }
  | { type: 'master_fade_out' }
  | { type: 'epilogue_music_start'; trackIndices: number[]; fadeInBeats: number };

interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;           // Winning side's proportion (kept for backward compat, same as winningProportion)
  votesA: number;
  votesB: number;
  totalVotes: number;
}
```

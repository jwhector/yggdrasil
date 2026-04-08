/**
 * Solo Show — Core Type Definitions (V3.2)
 *
 * This file defines the shared language for the entire system.
 * Changes here affect conductor, server, and client packages.
 *
 * See ARCHITECTURE.md for detailed documentation of each type.
 *
 * Self-contained: no imports from other project files.
 */

/** Number of audience-facing layer groups per song attempt (V3.2). */
export const LAYERS_PER_ATTEMPT = 3;

// ============================================================================
// Primitive Types
// ============================================================================

export type UserId = string;
export type SeatId = string;
export type ShowId = string;
export type Timestamp = number;

// ============================================================================
// Chapter & Layer Identity
// ============================================================================

/** The three story chapters, each corresponding to one song-building attempt. */
export type Chapter = 'ambition' | 'love' | 'avoidance';

/** Sentinel fragment ID: when a type's active fragment is this, audio is muted. Voteable like any fragment. */
export const MUTE_FRAGMENT_ID = '__mute__';

/**
 * Layer types represent the musical role of each layer in a song.
 * 6 fixed types — one per layer slot per attempt.
 */
export type LayerType =
  | 'seed'
  | 'drums'
  | 'pad'
  | 'bass'
  | 'harmony'
  | 'fx';

// ============================================================================
// Layer Phases & Config
// ============================================================================

/**
 * Phase of a single layer within an attempt_build phase.
 *
 * locked → auditioning → revealing → locked_in
 *                            │
 *                            ▼ (if threshold fails)
 *                        collapsed (attempt ends)
 *
 * Note: voting is open concurrently during 'auditioning' (no separate voting phase).
 */
export type LayerPhase =
  | 'locked'        // Not yet reached; displayed as unexplored square
  | 'auditioning'   // Playing A and B previews; vote is open simultaneously
  | 'revealing'     // Vote closed, showing split + threshold check + winner lock-in
  | 'locked_in'     // Option chosen, layer committed to song stack
  | 'collapsed';    // Attempt failed at this layer (threshold not met)

/** Configuration for a single layer within an attempt. */
export interface LayerConfig {
  index: number;                        // 0-indexed position in the attempt
  type: LayerType;
  optionA: AudioReference;              // Ableton clip reference
  optionB: AudioReference;              // Ableton clip reference
  labelA: string;                       // Short emotional tagline for A
  labelB: string;                       // Short emotional tagline for B
}

/** Result of a resolved layer. */
export interface LayerResult {
  layerIndex: number;
  /** V3.2: layer group id (e.g. 'bones', 'flesh', 'spark'). */
  group?: string | null;
  /** V3.1 compat: granular layer type. Null in V3.2 conductor. */
  type?: LayerType;
  status: 'locked_in' | 'collapsed' | 'unreached';  // collapsed = threshold failed here
  chosenOption: 'A' | 'B' | null;      // null if unreached
  winningProportion: number | null;    // max(votesA, votesB) / total; null if unreached
  thresholdRequired: number | null;    // doubt threshold for this layer; null if unreached
  passed: boolean | null;             // null if unreached
}

/** A single audience member's vote on a layer. */
export interface LayerVote {
  userId: UserId;
  attemptIndex: number;
  layerIndex: number;
  choice: 'A' | 'B';
  timestamp: Timestamp;
}

// ============================================================================
// Vote Result
// ============================================================================

export interface VoteResult {
  winner: 'A' | 'B';
  consensus: number;                    // 0.0 to 1.0
  votesA: number;
  votesB: number;
  totalVotes: number;
}

// ============================================================================
// Attempt
// ============================================================================

/** Runtime state of a single song-building attempt. */
export interface AttemptState {
  index: number;                        // 0, 1, 2
  chapter: Chapter;
  layerPlan: V32LayerConfig[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];          // Populated as layers resolve
  votes: LayerVote[];                   // All votes for this attempt
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
  currentAuditionOption: 'A' | 'B' | null;  // Which option is currently playing
  auditionLoopIndex: number;                  // 0-based count of loops completed
  currentVoteResult: VoteResult | null;       // Set during revealing phase, cleared on lock-in
  revealStakesShown: boolean;                 // True after REVEAL_STAKES fires in current revealing phase
}

/** Static configuration for a single attempt. */
export interface AttemptConfig {
  chapter: Chapter;
  title: string;                        // Display name (e.g., "Ambition")
  layers: LayerConfig[];                // 6 layers per attempt
  thresholds: number[];                 // Per-layer doubt thresholds (length 6)
  tempos: number[];                     // Per-layer BPM (length 6)
  auditionBars: number[];               // Bars per option during audition (length 6)
  auditionCycles: number[];             // A-B cycles per layer (1 = A then B, 2 = A-B-A-B) (length 6)
}

/** Recorded result of a completed/collapsed attempt, used for fragment generation. */
export interface AttemptResult {
  attemptIndex: number;
  chapter: Chapter;
  layers: LayerResult[];
  completed: boolean;                   // True if all layers were reached and passed
  collapsedAtLayer: number | null;
}

// ============================================================================
// Fragment
// ============================================================================

/**
 * A fragment is a musical element from the song-building phase available in the finale.
 * Available fragments = winning options from voted-on layers.
 * Locked fragments = losing options + both options from unreached layers.
 */
export interface Fragment {
  id: string;                           // Unique identifier
  attemptIndex: number;
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayLabel: string;                 // Emotional tagline (e.g., "Distant Pulse")
  wonVote: boolean;                     // true if this option won the blind vote
  audioRef: AudioReference;
  previewAudioPath: string;             // URL path to preview audio file (e.g. /audio/previews/preview-0-0-A.mp3)
}

// ============================================================================
// NPC
// ============================================================================

/** Configuration for an event-driven NPC message. */
export interface NpcMessageConfig {
  event: string;                       // Event key (e.g., 'performer_abandonment', 'assembly_start', 'layer_locked')
  layerType?: LayerType;               // Optional: specific to a layer type
  text: string;                        // The NPC message text (supports {layerLabel} template variable)
}

// ============================================================================
// Audio References
// ============================================================================

/** Reference to an audio clip/track in Ableton. */
export interface AudioReference {
  trackIndex: number;                   // Computed from track layout formula
  clipSlot?: number;
  effectIndices?: number[];             // Device indices to enable/disable for this option
  label?: string;                       // Human-readable reference
}

/** Reference to an Ableton device parameter. */
export interface AbletonParamRef {
  trackIndex: number;
  deviceIndex: number;
  paramIndex: number;
}

// ============================================================================
// Finale State (V3.2)
// ============================================================================

// Old FinaleState removed in V3.2. See V32FinaleState below.

// ============================================================================
// User
// ============================================================================

export interface User {
  id: UserId;
  seatId: SeatId | null;               // From QR code scan; null if joined without QR
  connected: boolean;
  joinedAt: Timestamp;
}

// ============================================================================
// Show Phase State Machine
// ============================================================================

/**
 * Show phase progression:
 * lobby → opener → attempt_story → attempt_build → attempt_resolve → ... (×3) →
 * finale_elegy → finale_assignment → finale_preview → finale_playback → ended
 */
export type ShowPhase =
  | 'lobby'                   // Audience joining, waiting
  | 'opener'                  // Performance opening (phones dark)
  | 'attempt_story'           // Story segment before song-building (phones dark)
  | 'attempt_build'           // Active song-building with audience voting
  | 'attempt_resolve'         // Song complete; waiting for performer to trigger rejection
  | 'finale_elegy'            // Elegy display of all fragments (available and locked)
  | 'finale_assignment'       // Audience claims quilt cells (V3.3)
  | 'finale_preview'          // Private song exploration — room silent (V3.3)
  | 'finale_playback'         // Quilt plays + performer/audience remix (V3.3)
  | 'ended';                  // Show complete

// ============================================================================
// Show State
// ============================================================================

export interface ShowState {
  id: ShowId;
  phase: ShowPhase;
  currentAttemptIndex: number;          // 0, 1, 2
  attempts: AttemptState[];             // Length 3, pre-initialized
  users: Map<UserId, User>;
  finaleState: V33FinaleState | null;    // Populated at finale_elegy
  config: ShowConfig;
  version: number;                      // Increments on every state change
  lastUpdated: Timestamp;               // Wall clock time
  paused: boolean;
  openerSlideState: OpenerSlidePosition | null;  // null = blank screen (before first or after last slide)
}

/** Current position in the opener slide deck. */
export interface OpenerSlidePosition {
  pointIndex: number;                   // Which point (0-based)
  subPointIndex: number;                // -1 = point only, 0+ = sub-points revealed up to this index
}

// ============================================================================
// Show Config
// ============================================================================

export interface ShowConfig {
  layersPerAttempt: number;             // 3 in V3.2 (was 6)
  chapters?: ChapterConfig[];           // Visual identity per chapter (color, label, icon)
  granularTypes?: GranularType[];       // V3.2: master registry of granular types
  layerGroups?: LayerGroupConfig[];     // V3.2: layer group definitions (bones/flesh/spark)
  attempts: V32AttemptConfig[];         // Length 3; V3.2 structure with TrackBundles + liveSeed
  finale: V33FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;             // Text displayed while waiting
  };
  seatIds: SeatId[];                    // Known seats for QR code generation
  intrusiveThoughts?: IntrusiveThoughtsConfig[];  // Per-attempt, per-layer thought strings
  openerSlides?: OpenerSlide[];          // Slide deck for opener phase
}

/** A single opener slide: a main point with optional sub-points. */
export interface OpenerSlide {
  point: string;
  subPoints?: string[];
}

/** Intrusive thoughts config — shared pool distributed by the server. */
export interface IntrusiveThoughtsConfig {
  chapter: Chapter;
  thoughtsPerPerson: number[];          // Per-layer count [1, 3, 5]
  pool: string[][];                     // [layerIndex][poolIndex] — shared pool per layer
}

/** A single thought assigned to a specific user by the server. */
export interface AssignedThought {
  id: string;                           // Unique: "{attemptIndex}-{layerIndex}-{userId}-{i}"
  text: string;
  userId: UserId;
  dismissed: boolean;
  dismissDirection?: 'left' | 'right';
}

// Old FinaleConfig removed in V3.2. ShowConfig.finale now uses V32FinaleConfig.

/**
 * Configuration for Utility device gain transitions.
 *
 * Internal gains are 0.0–1.0 where 1.0 = unity (0 dB). The audio router
 * multiplies by `unityGainValue` before sending the normalized OSC parameter
 * value to Ableton (Utility Gain: 0.0 = -inf dB, ~0.85 = 0 dB, 1.0 = +35 dB).
 */
export interface GainConfig {
  entryGain: number;            // Snap-to gain when bringing a track in (default 0.6)
  entrySwellBeats: number;      // Beats to ramp from entryGain to 1.0 (default 4 = 1 bar)
  holdBars: number;             // Bars to hold at full gain (default 7, informational)
  exitFadeBeats: number;        // Beats to ramp to 0.0 on exit (default 4 = 1 bar)
  lockInFadeBeats: number;      // Beats to fade out the loser on lock-in (default 4)
  collapseFadeBeats: number;    // Beats to fade all attempt tracks on collapse (default 8)
  ceremonySwellBeats: number;   // Beats for ceremony fragment swell-in (default 4)
  unityGainValue: number;       // Normalized Ableton param value for 0 dB (default 0.85)
  stepsPerBeat: number;         // Sub-steps per beat for gain interpolation (default 2; 1 = no sub-beats)
}

export interface TimingConfig {
  revealSequenceDurationMs: number;     // Duration of post-vote reveal animation
  rejectionEffectDurationMs: number;    // Duration of song rejection effect
  loopBoundaryBeats: number;            // Beats per performer mix loop boundary (e.g. 32 = 8 bars)
  gain?: GainConfig;                    // Utility device gain transition configuration (uses defaults if absent)
}

// ============================================================================
// Audio Cues
// ============================================================================

export type AudioCue =
  /** V3.2: trackBundle = option being brought in; otherTrackBundle = option being faded out */
  | { type: 'audition_start'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; trackBundle: TrackBundle; otherTrackBundle: TrackBundle }
  | { type: 'audition_stop'; attemptIndex: number; layerIndex: number; option: 'A' | 'B' | null; trackBundle?: TrackBundle }
  | { type: 'lock_in'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B'; winnerTrackBundle: TrackBundle; loserTrackBundle: TrackBundle }
  | { type: 'set_tempo'; bpm: number; attemptIndex: number; layerIndex: number }
  | { type: 'collapse_gesture'; attemptIndex: number }
  | { type: 'rejection_gesture'; attemptIndex: number }
  /** V3.2: unmute live seed tracks at attempt_build start */
  | { type: 'live_seed_start'; attemptIndex: number; trackIndices: number[] }
  /** V3.2: mute live seed tracks on collapse or rejection */
  | { type: 'live_seed_stop'; attemptIndex: number; trackIndices: number[] }
  /** V3.3: initial track setup when quilt playback starts */
  | { type: 'quilt_playback_start'; initialColumn: number; trackIndices: number[] }
  /** V3.3: mute/unmute tracks at column boundary during playback */
  | { type: 'quilt_column_change'; columnIndex: number; trackChanges: { granularType: string; muteTrack: number | null; unmuteTrack: number | null }[] }
  /** V3.3: column order changed (takes effect at next boundary) */
  | { type: 'quilt_reorder'; newColumnOrder: number[] }
  /** V3.3: mute a single cell's track */
  | { type: 'quilt_mute_cell'; granularType: string; columnIndex: number; trackIndex: number }
  /** V3.3: unmute a single cell's track */
  | { type: 'quilt_unmute_cell'; granularType: string; columnIndex: number; trackIndex: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }                   // Hard mute all — gain to 0, mute tracks
  | { type: 'master_panic' }            // Authoritative: query Ableton for all tracks, mute every non-foldable, reset gains
  | { type: 'reset_utilities' };        // Emergency: set all Utility gains to 0 dB, unmute all tracks

// ============================================================================
// Conductor Commands (Input)
// ============================================================================

export type ConductorCommand =
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
  | { type: 'MASTER_PANIC' }            // Authoritative: query Ableton, mute all non-foldable tracks
  | { type: 'RESET_UTILITIES' }         // Emergency: reset all Utility gains to 0 dB

  // Connection
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId }
  | { type: 'USER_DISCONNECT'; userId: UserId }

  // Recovery
  | { type: 'EXPORT_STATE' }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' }
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean }
  | { type: 'NEW_SHOW' };

// ============================================================================
// Conductor Events (Output)
// ============================================================================

export type ConductorEvent =
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

  // Finale — Setup
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

// ============================================================================
// V3.2 Types — LayerGroup Abstraction & Incredibox Finale
// ============================================================================

/** Number of audience-facing layer groups per attempt in V3.2 (bones, flesh, spark). */
export const V32_LAYERS_PER_ATTEMPT = 3;

/**
 * Chapter visual identity — color, label, and icon for a narrative chapter.
 * Stored in show config so identity is config-driven rather than hardcoded.
 */
export interface ChapterConfig {
  id: Chapter;
  label: string;   // Display name (e.g., 'Ambition')
  color: string;   // Primary / seed CSS color
  colorA: string;  // Option A CSS color
  colorB: string;  // Option B CSS color
  icon: string;    // Unicode symbol
}

/**
 * A single granular instrument type — the atomic unit of the finale.
 * 6 types by default, configurable. These are the V3.2 equivalent of LayerType values.
 */
export interface GranularType {
  id: string;           // e.g., 'bass', 'drums', 'seed'
  label: string;        // Finale-facing name (e.g., 'The Ground')
  color: string;        // For finale UI
  symbol: string;       // For finale UI
}

/** Reference to one or more Ableton tracks within a bundle, tagged with its granular type. */
export interface GranularTrackRef {
  granularType: string;   // e.g., 'bass'
  trackIndices: number[]; // Ableton track indices (multiple tracks played as one unit)
  alwaysAvailable?: boolean;  // When true, generates a fragment regardless of vote outcome or layer reach
}

/** A collection of granular tracks for one option (A or B) of a layer group. */
export interface TrackBundle {
  tracks: GranularTrackRef[];
}

/**
 * A layer group ID used during song-building.
 * Configurable — defaults are 'bones' | 'flesh' | 'spark'.
 */
export type LayerGroupId = string;

/**
 * Config-level definition of a layer group within an attempt.
 * The audience makes one A/B vote per LayerGroupConfig entry.
 */
export interface LayerGroupConfig {
  id: LayerGroupId;
  label: string;
  granularTypes: string[];    // References to GranularType.id values in this bundle
  optionA: TrackBundle;
  optionB: TrackBundle;
}

/**
 * Runtime-resolved layer group — GranularType values expanded from IDs.
 * Used in conductor state where the full type objects are needed.
 */
export interface LayerGroup {
  id: LayerGroupId;
  label: string;
  granularTypes: GranularType[];
}

/** Config for the live seed tracks that play throughout a song-building attempt. */
export interface LiveSeedConfig {
  trackIndices: number[];
  label?: string;
}

/** V3.2 equivalent of LayerConfig — uses LayerGroupId + TrackBundle instead of LayerType + AudioReference. */
export interface V32LayerConfig {
  index: number;
  group: LayerGroupId;
  labelA: string;
  labelB: string;
  optionA: TrackBundle;
  optionB: TrackBundle;
}

/** V3.2 attempt configuration — 3 layer groups + live seed per attempt. */
export interface V32AttemptConfig {
  chapter: Chapter;
  title: string;
  liveSeed: LiveSeedConfig;
  layers: V32LayerConfig[];               // 3 entries (bones, flesh, spark)
  thresholds: number[];                   // [0.50, 0.66, 0.99]
  tempos: number[];                       // Per-layer BPM
  auditionBars: number[];                 // Bars per option during audition
  auditionCycles: number[];               // A-B cycles per layer
}

/**
 * A granular fragment is the atomic unit of the elegy display.
 * Song-building produces LayerGroup results; those are decomposed into GranularFragments
 * (one per granular track per option).
 *
 * Note: V3.3 quilt phases use QuiltCell with songIndex instead of GranularFragment.
 * GranularFragment is still used for the elegy wreckage display.
 */
export interface GranularFragment {
  id: string;
  songIndex: number;
  layerGroupId: LayerGroupId;   // Which bundle this came from ('bones', 'flesh', 'spark')
  granularType: string;         // Which specific type ('bass', 'drums', etc.)
  option: 'A' | 'B';
  chapter: Chapter;
  trackIndices: number[];       // Ableton track indices (multiple tracks played as one unit)
  wonVote: boolean;
  previewAudioPath: string;
}

/** Bar-level audition progress emitted by the server at ~4 Hz during auditioning. */
export interface AuditionProgress {
  layerIndex: number;
  currentOption: 'A' | 'B';
  barProgress: number;          // 0.0 to 1.0 within current option's audition
  totalBars: number;            // auditionBars for this layer
  tempo: number;                // Current BPM
  votingWindowMs: number;       // Derived total voting window for client timer
  elapsedMs: number;            // Time since audition started
}

/** Finale config (V3.3). */
export interface V33FinaleConfig {
  assignmentMode: 'auto' | 'self_select';
  bothOptionsSurvive: boolean;  // When true, both winner and loser tracks are available in elegy
  audioPreviewPath: string;
  npcMessages: NpcMessageConfig[];
  quilt: QuiltConfig;
}

/** Quilt grid configuration (V3.3). */
export interface QuiltConfig {
  maxColumns: number;                              // Max time slices (default: 4, max: 8)
  loopBars: number;                                // Total loop length (default: 8)
  overflowMode: 'spectator' | 'extend_loop';      // What happens when cells are full
  previewTimerMs: number;                          // Preview phase duration (default: 20000)
  assignmentTimerMs: number;                       // Assignment phase duration (default: 30000)
  audienceRemix: AudienceRemixConfig;
}

/** Audience interaction config during playback (V3.3). */
export interface AudienceRemixConfig {
  enabled: boolean;                                // Master toggle — false = audience watches only
  scope: 'own_cell' | 'any_cell';                  // Can audience move only their own cell, or any cell?
  allowCrossRowSwaps: boolean;                     // Whether audience can swap across rows (default: true)
  cooldownLoops: number;                           // Loops between allowed audience cell moves (default: 1)
  allowSongChange: boolean;                        // Can audience change cell's song during playback? (default: false)
}

/** A single cell in the quilt grid (V3.3). */
export interface QuiltCell {
  id: string;                                      // `${rowIndex}:${columnIndex}`
  rowIndex: number;                                // Current row position (may change via swaps)
  columnIndex: number;                             // Current column position (may change via swaps)
  granularType: string;                            // Derived from current rowIndex
  songIndex: number | null;                        // 0, 1, or 2 — the song choice. null if no choice yet.
  chapter: Chapter | null;                         // Derived from songIndex
  ownerId: UserId | null;                          // null if unclaimed
}

/** V3.3 show config — full V3.3 shape (for reference; ShowConfig is the active type). */
export interface V33ShowConfig {
  granularTypes: GranularType[];
  layerGroups: LayerGroupConfig[];
  layersPerAttempt: number;
  attempts: V32AttemptConfig[];
  finale: V33FinaleConfig;
  timing: TimingConfig;
  lobby: { waitingMessage: string };
  seatIds: SeatId[];
}

/**
 * Finale state (V3.3 — "Quilt").
 * Phases: elegy → assignment → preview → playback.
 */
export interface V33FinaleState {
  phase: 'elegy' | 'assignment' | 'preview' | 'playback';

  // Fragment availability (for elegy display — GranularFragments decomposed from layer group results)
  availableFragments: GranularFragment[];
  allFragments: GranularFragment[];

  // Quilt structure
  quilt: {
    rows: number;                                   // Always 6 (granular types)
    columns: number;                                // Derived from audience size
    barsPerCell: number;                            // Derived: loopBars / columns
    cells: Map<string, QuiltCell>;                  // cellId -> cell state
    columnOrder: number[];                          // Current column playback order
    playheadColumn: number;                         // Current column index being played
    loopCount: number;
  };

  // Song availability
  availableSongs: number[];                         // Song indices available as choices (e.g., [0, 1, 2])

  // Track resolution map
  trackMap: Map<string, Map<number, number>>;       // granularType -> songIndex -> Ableton trackIndex

  // Assignment state
  assignment: {
    mode: 'auto' | 'self_select';
    timerRemaining: number | null;
  };

  // Preview state
  preview: {
    lockedInUsers: Set<UserId>;
    timerRemaining: number | null;
  };

  // Remix state (both audience and performer)
  remix: {
    lockedCells: Set<string>;                       // cellIds the performer has locked
    mutedCells: Set<string>;                        // cellIds the performer has muted
    lastMoveByUser: Map<UserId, number>;            // userId -> loopCount of last move
    liveTracksActive: string[];                     // Live performance track IDs
  };

  npc: { currentMessage: string | null };
}

// ============================================================================
// Client Identity (stored in localStorage for reconnection)
// ============================================================================

export interface StoredClientIdentity {
  userId: UserId;
  showId: ShowId;
  seatId: SeatId | null;
  lastVersion: number;
}

// ============================================================================
// Client State Types (match filterStateForClient() output in server/socket.ts)
// ============================================================================

/**
 * Current attempt view sent to audience clients.
 * Personalized: includes myVote, limited to data needed for the current layer.
 */
export interface AudienceAttemptView {
  index: number;
  chapter: Chapter;
  status: AttemptState['status'];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerCount: number;
  layerPlan: V32LayerConfig[];
  currentLayerConfig: V32LayerConfig | null;
  layerResults: LayerResult[];
  myVote: 'A' | 'B' | null;
  currentAuditionOption: 'A' | 'B' | null;
  auditionLoopIndex: number;
  auditionTotalLoops: number;
  currentVoteResult: { winner: 'A' | 'B'; winningProportion: number } | null;
  lastThresholdCheck: { winningProportion: number; threshold: number; passed: boolean } | null;
}

/**
 * Finale view sent to audience clients during quilt phases (V3.3).
 * Personalized: includes own cell, own song choice, lock-in status.
 */
export interface AudienceFinaleView {
  finalePhase: V33FinaleState['phase'];
  // Quilt grid (shared)
  quilt: {
    rows: number;
    columns: number;
    cells: Array<{ id: string; rowIndex: number; columnIndex: number; granularType: string; songIndex: number | null; chapter: Chapter | null; ownerId: UserId | null }>;
    columnOrder: number[];
    playheadColumn: number;
  };
  availableSongs: number[];
  // Assignment
  myCellId: string | null;                             // which cell the user owns
  assignmentMode: 'auto' | 'self_select';
  assignmentTimerRemaining: number | null;
  // Preview
  previewTimerRemaining: number | null;
  lockedIn: boolean;                                   // whether user has locked in their song choice
  // Remix
  lockedCells: string[];                               // performer-locked cell IDs
  mutedCells: string[];                                // performer-muted cell IDs
  // NPC
  npcMessage: string | null;
}

/**
 * State received by audience clients via state_sync (personalized per user).
 * Must match the 'audience' case of filterStateForClient() in server/socket.ts.
 */
export interface AudienceClientState {
  userId: UserId;
  seatId: SeatId | null;
  phase: ShowPhase;
  paused: boolean;
  version: number;
  currentAttemptIndex: number;
  currentAttempt: AudienceAttemptView | null;
  myFinale: AudienceFinaleView | null;
  config: {
    lobby: { waitingMessage: string };
    chapters: ChapterConfig[];
    granularTypes: GranularType[];
    intrusiveThoughts: IntrusiveThoughtsConfig[];
  };
}

/**
 * Finale state sent to projector (public — no per-user data) (V3.3).
 */
export interface ProjectorFinaleView {
  finalePhase: V33FinaleState['phase'];
  availableFragments: GranularFragment[];
  allFragments: GranularFragment[];
  // Quilt grid
  quilt: {
    rows: number;
    columns: number;
    cells: Array<{ id: string; rowIndex: number; columnIndex: number; granularType: string; songIndex: number | null; chapter: Chapter | null; ownerId: UserId | null }>;
    columnOrder: number[];
    playheadColumn: number;
    loopCount: number;
  };
  availableSongs: number[];
  // Assignment
  assignmentMode: 'auto' | 'self_select';
  assignmentTimerRemaining: number | null;
  // Remix
  lockedCells: string[];
  mutedCells: string[];
  // NPC
  npcMessage: string | null;
}

/**
 * State received by projector clients via state_sync (public, no per-user data).
 * Must match the 'projector' case of filterStateForClient() in server/socket.ts.
 */
export interface ProjectorClientState {
  phase: ShowPhase;
  paused: boolean;
  version: number;
  currentAttemptIndex: number;
  userCount: number;
  attempts: AttemptState[];
  finaleState: ProjectorFinaleView | null;
  config: ShowConfig;
  openerSlideState: OpenerSlidePosition | null;
}

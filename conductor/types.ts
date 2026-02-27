/**
 * Solo Show — Core Type Definitions (NEW SYSTEM)
 *
 * This file defines the shared language for the entire system.
 * Changes here affect conductor, server, and client packages.
 *
 * See ARCHITECTURE.md for detailed documentation of each type.
 *
 * Self-contained: no imports from other project files.
 */

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

/**
 * Layer types represent the musical role of each layer in a song.
 * Core types are defined; custom strings are allowed for extensibility.
 */
export type LayerType =
  | 'foundation'   // The bed / the ground
  | 'pulse'        // Heartbeat / drive
  | 'color'        // Warmth / sharpness
  | 'space'        // Intimate / distant
  | 'voice'        // Clear / masked
  | string;        // Extensible for custom types

// ============================================================================
// Layer Phases & Config
// ============================================================================

/**
 * Phase of a single layer within an attempt_build phase.
 *
 * locked → auditioning → voting → resolving → locked_in
 *                                     │
 *                                     ▼ (if consensus < doubt threshold)
 *                                 collapsed (attempt ends)
 */
export type LayerPhase =
  | 'locked'        // Not yet reached; displayed as unexplored square
  | 'auditioning'   // Playing A and B previews
  | 'voting'        // Vote window open, audience selecting A or B
  | 'resolving'     // Vote closed, calculating result, displaying outcome
  | 'locked_in'     // Option chosen, layer committed to song stack
  | 'collapsed';    // Attempt failed at this layer (doubt exceeded consensus)

/** Configuration for a single layer within an attempt. */
export interface LayerConfig {
  index: number;                        // 0-indexed position in the attempt
  type: LayerType;
  optionA: AudioReference;              // Ableton clip reference
  optionB: AudioReference;              // Ableton clip reference
  labelA: string;                       // Short emotional tagline for A
  labelB: string;                       // Short emotional tagline for B
  doubtThreshold: number | null;        // null = no threshold (simple majority wins)
  // TODO: See DECISIONS.md O2 — exact threshold schedule TBD
}

/** Result of a resolved layer. */
export interface LayerResult {
  layerIndex: number;
  type: LayerType;
  status: 'locked_in' | 'unreached';    // unreached = never got to vote on this layer
  chosenOption: 'A' | 'B' | null;       // null if unreached
  consensus: number | null;             // null if unreached
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
  thresholdMet: boolean;                // True if consensus >= doubt threshold (or no threshold)
  doubtThreshold: number | null;
}

// ============================================================================
// Attempt
// ============================================================================

/** Runtime state of a single song-building attempt. */
export interface AttemptState {
  index: number;                        // 0, 1, 2
  chapter: Chapter;
  layerPlan: LayerConfig[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];          // Populated as layers resolve
  votes: LayerVote[];                   // All votes for this attempt
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
}

/** Static configuration for a single attempt. */
export interface AttemptConfig {
  chapter: Chapter;
  title: string;                        // Display name (e.g., "Ambition")
  layers: LayerConfig[];                // 5–7 layers per attempt
  // TODO: See DECISIONS.md O1 — exact layer count TBD
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
// Fragment & Safe Parameter
// ============================================================================

/** A fragment is a selectable musical element for the finale, derived from attempt results. */
export interface Fragment {
  id: string;                           // Unique identifier
  attemptIndex: number;
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
  layerType: LayerType;
  displayName: string;                  // Human-readable name for UI
  // TODO: See DECISIONS.md O5 — display name generation strategy TBD
  audioRef: AudioReference;
  safeParameter: SafeParameter;
}

/** The parameter that stewards control when their fragment is active. */
export interface SafeParameter {
  name: string;                         // Internal parameter name
  displayLabel: string;                 // What the user sees (e.g., "Intensity")
  abletonMapping: AbletonParamRef;      // Track index + device index + param index
  min: number;                          // Clamped minimum (0.0–1.0)
  max: number;                          // Clamped maximum (0.0–1.0)
  defaultValue: number;                 // Neutral position
  smoothingMs: number;                  // Parameter change smoothing (prevent zipper noise)
}

/** A user's fragment selection for the finale queue. */
export interface FragmentSelection {
  userId: UserId;
  attemptIndex: number;
  layerIndex: number;
  option: 'A' | 'B';
  chapter: Chapter;
}

// ============================================================================
// Audio References (placeholders — to be fleshed out with Ableton layout)
// ============================================================================

// TODO: See DECISIONS.md O8 — Ableton session template TBD
/** Reference to an audio clip/track in Ableton. Placeholder shape. */
export interface AudioReference {
  trackIndex: number;                   // Computed from track layout formula
  clipSlot?: number;
  label?: string;                       // Human-readable reference
}

/** Reference to an Ableton device parameter. Placeholder shape. */
export interface AbletonParamRef {
  trackIndex: number;
  deviceIndex: number;
  paramIndex: number;
}

// ============================================================================
// Finale State
// ============================================================================

export interface FinaleState {
  chapterAssignments: Map<UserId, Chapter>;
  queue: QueueEntry[];
  activeSlots: (ActiveSlot | null)[];   // Length 7; null = empty slot
  trianglePositions: Map<UserId, TrianglePosition>;
  centroid: TrianglePosition;           // Computed weighted average
  rotationActive: boolean;
  rotationRate: 1 | 2;                  // Slots per 8-bar cycle
  frozen: boolean;
  stewardshipLog: StewardshipEntry[];
}

export interface ActiveSlot {
  slotIndex: number;                    // 0–6
  fragment: Fragment;
  stewardUserId: UserId;
  parameterValue: number;              // Current safe parameter value
  activatedAtBeat: number;
  energyLevel: number;                 // From audio metering (0.0–1.0)
}

export interface QueueEntry {
  userId: UserId;
  fragment: Fragment;
  chapter: Chapter;
  enqueuedAt: Timestamp;
  hasBeenSteward: boolean;             // Tracks whether this user has had a turn
}

export interface TrianglePosition {
  wAmbition: number;                   // 0.0–1.0, all three sum to 1.0
  wLove: number;
  wAvoidance: number;
}

export interface StewardshipEntry {
  userId: UserId;
  slotIndex: number;
  fragment: Fragment;
  startBeat: number;
  endBeat: number | null;              // null if still active
}

// ============================================================================
// User
// ============================================================================

export interface User {
  id: UserId;
  seatId: SeatId | null;               // From QR code scan; null if joined without QR
  connected: boolean;
  joinedAt: Timestamp;
  finaleChapter: Chapter | null;        // Assigned at finale_setup; null before then
}

// ============================================================================
// Show Phase State Machine
// ============================================================================

/**
 * Show phase progression:
 * lobby → opener → attempt_story → attempt_build → ... (×3) →
 * finale_setup → finale_rotating → finale_frozen → ended
 */
export type ShowPhase =
  | 'lobby'               // Audience joining, waiting
  | 'opener'              // Performance opening (phones dark)
  | 'attempt_story'       // Story segment before song-building (phones dark)
  | 'attempt_build'       // Active song-building with audience voting
  | 'finale_setup'        // Chapter assignment + fragment selection
  | 'finale_rotating'     // Active slot rotation with stewardship
  | 'finale_frozen'       // Rotation frozen, final mix locked
  | 'ended';              // Show complete

// ============================================================================
// Show State
// ============================================================================

export interface ShowState {
  id: ShowId;
  phase: ShowPhase;
  currentAttemptIndex: number;          // 0, 1, 2
  attempts: AttemptState[];             // Length 3, pre-initialized
  users: Map<UserId, User>;
  finaleState: FinaleState | null;      // Populated at finale_setup
  config: ShowConfig;
  version: number;                      // Increments on every state change
  lastUpdated: Timestamp;               // Wall clock time
  paused: boolean;
}

// ============================================================================
// Show Config
// ============================================================================

export interface ShowConfig {
  maxLayersPerAttempt: number;          // Used for track index calculation (default: 7)
  attempts: AttemptConfig[];            // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;             // Text displayed while waiting
  };
  seatIds: SeatId[];                    // Known seats for QR code generation
}

export interface FinaleConfig {
  slotCount: number;                    // Default: 7
  rotationBars: number;                 // Default: 8
  defaultRotationRate: 1 | 2;           // Slots per cycle
  triangleDriftTimeoutMs: number;       // How long before idle dots drift to center
  triangleDriftSpeedMs: number;         // How fast drift occurs
  fragments: Fragment[];                // Pre-configured fragment library
}

export interface TimingConfig {
  auditionDurationMs: number;           // Per-option audition preview
  votingWindowMs: number;               // How long voting stays open
  resolveAnimationMs: number;           // Result display duration
  collapseAnimationMs: number;          // Collapse gesture duration before auto-advance
  autoAdvanceToStoryMs: number;         // Delay after collapse before transitioning
  // TODO: See DECISIONS.md O4 — audition cadence details TBD
}

// ============================================================================
// Audio Cues
// ============================================================================

export type AudioCue =
  | { type: 'audition_start'; attemptIndex: number; layerIndex: number; option: 'A' | 'B' }
  | { type: 'audition_stop'; attemptIndex: number; layerIndex: number; option: 'A' | 'B' }
  | { type: 'lock_in'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'collapse_gesture'; attemptIndex: number }
  | { type: 'slot_activate'; slotIndex: number; fragment: Fragment }
  | { type: 'slot_deactivate'; slotIndex: number }
  | { type: 'steward_param'; slotIndex: number; value: number }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' };                  // Hard mute all

// ============================================================================
// Conductor Commands (Input)
// ============================================================================

export type ConductorCommand =
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
  | { type: 'FORCE_CONTINUE' }
  | { type: 'FORCE_COLLAPSE' }

  // Doubt
  | { type: 'SET_THRESHOLD'; layerIndex: number; threshold: number | null }
  | { type: 'TOGGLE_DOUBT'; active: boolean }

  // Finale
  | { type: 'SETUP_FINALE' }
  | { type: 'SELECT_FRAGMENT'; userId: UserId; fragmentId: string }
  | { type: 'UPDATE_TRIANGLE'; userId: UserId; position: TrianglePosition }
  | { type: 'UPDATE_STEWARD_PARAM'; userId: UserId; value: number }
  | { type: 'START_ROTATION' }
  | { type: 'STOP_ROTATION' }
  | { type: 'FREEZE_ROTATION' }
  | { type: 'SET_ROTATION_RATE'; rate: 1 | 2 }
  | { type: 'FORCE_ASSIGN_STEWARD'; userId: UserId; slotIndex: number }
  | { type: 'FORCE_INSERT_FRAGMENT'; fragmentId: string; slotIndex: number }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'TOGGLE_TRIANGLE'; active: boolean }

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }
  | { type: 'TRIGGER_COLLAPSE_GESTURE' }

  // Connection
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId }
  | { type: 'USER_DISCONNECT'; userId: UserId }

  // Recovery
  | { type: 'EXPORT_STATE' }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' }
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean };

// ============================================================================
// Conductor Events (Output)
// ============================================================================

export type ConductorEvent =
  // Show flow
  | { type: 'SHOW_PHASE_CHANGED'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }

  // Song-building
  | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number; consensus: number; threshold: number }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }

  // Finale
  | { type: 'FINALE_SETUP_COMPLETE'; chapterAssignments: Map<UserId, Chapter>; availableFragments: Fragment[] }
  | { type: 'FRAGMENT_QUEUED'; userId: UserId; fragment: Fragment }
  | { type: 'SLOT_ACTIVATED'; slotIndex: number; fragment: Fragment; stewardUserId: UserId }
  | { type: 'SLOT_DEACTIVATED'; slotIndex: number }
  | { type: 'STEWARDSHIP_STARTED'; userId: UserId; slotIndex: number }
  | { type: 'STEWARDSHIP_ENDED'; userId: UserId; slotIndex: number }
  | { type: 'CENTROID_UPDATED'; centroid: TrianglePosition }
  | { type: 'ROTATION_TICK'; newSlots: ActiveSlot[]; removedSlots: number[] }

  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }
  | { type: 'METER_UPDATE'; slots: { slotIndex: number; energy: number }[] }

  // State
  | { type: 'STATE_UPDATED'; version: number }

  // Recovery
  | { type: 'FORCE_RECONNECT'; reason: string }
  | { type: 'SHOW_RESET'; preservedUsers: boolean }

  // Errors
  | { type: 'ERROR'; message: string; command?: ConductorCommand };

// ============================================================================
// Client Identity (stored in localStorage for reconnection)
// ============================================================================

export interface StoredClientIdentity {
  userId: UserId;
  showId: ShowId;
  seatId: SeatId | null;
  lastVersion: number;
}

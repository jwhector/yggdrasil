/**
 * Solo Show — Core Type Definitions (V2)
 *
 * This file defines the shared language for the entire system.
 * Changes here affect conductor, server, and client packages.
 *
 * See ARCHITECTURE-V2.md for detailed documentation of each type.
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
 * 7 fixed types — one per layer slot per attempt.
 */
export type LayerType =
  | 'melody'
  | 'drums'
  | 'pad'
  | 'bass'
  | 'harmony'
  | 'fx1'
  | 'fx2';

// ============================================================================
// Layer Phases & Config
// ============================================================================

/**
 * Phase of a single layer within an attempt_build phase.
 *
 * locked → auditioning → voting → revealing → locked_in
 *                                     │
 *                                     ▼ (if health bar reaches zero)
 *                                 collapsed (attempt ends)
 */
export type LayerPhase =
  | 'locked'        // Not yet reached; displayed as unexplored square
  | 'auditioning'   // Playing A and B previews
  | 'voting'        // Vote window open, audience selecting A or B (blind — no live split)
  | 'revealing'     // Vote closed, showing split + health drain + winner lock-in
  | 'locked_in'     // Option chosen, layer committed to song stack
  | 'collapsed';    // Attempt failed at this layer (health bar reached zero)

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
  type: LayerType;
  status: 'locked_in' | 'unreached';   // unreached = never got to vote on this layer
  chosenOption: 'A' | 'B' | null;      // null if unreached
  consensus: number | null;            // null if unreached
  drainAmount: number | null;          // health bar drain from this layer; null if unreached
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
// Health Bar
// ============================================================================

/** Cumulative health bar state for a song-building attempt. */
export interface HealthBarState {
  current: number;                      // 0 = collapsed, 100 = full
  drainFactor: number;                  // Base multiplier for this attempt
  layerMultipliers: number[];           // Per-layer scaling (length 7, e.g. [0.5, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0])
  history: HealthBarDrain[];            // One entry per resolved layer
}

/** A single drain event applied to the health bar after a vote resolves. */
export interface HealthBarDrain {
  layerIndex: number;
  losingProportion: number;             // min(votesA, votesB) / total (0.0–0.5)
  layerMultiplier: number;              // From layerMultipliers[layerIndex]
  drainAmount: number;                  // losingProportion * 100 * drainFactor * layerMultiplier
  healthAfter: number;                  // Health bar value after applying drain (floor 0)
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
  layerPlan: LayerConfig[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];          // Populated as layers resolve
  votes: LayerVote[];                   // All votes for this attempt
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
  currentAuditionOption: 'A' | 'B' | null;  // Which option is currently playing
  auditionLoopIndex: number;                  // 0-based count of loops completed
  healthBar: HealthBarState;
}

/** Static configuration for a single attempt. */
export interface AttemptConfig {
  chapter: Chapter;
  title: string;                        // Display name (e.g., "Ambition")
  layers: LayerConfig[];                // 7 layers per attempt
  drainFactor: number;                  // Health bar base drain multiplier for this attempt
  layerMultipliers: number[];           // Per-layer scaling factors (length 7)
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
  audioRef: AudioReference;
}

// ============================================================================
// Pending Change (Performer Mix)
// ============================================================================

/** A queued fragment activation or mute for the performer mixing surface. */
export interface PendingChange {
  layerType: LayerType;
  fragmentId: string | null;           // null = mute this layer
  queuedAt: number;
}

// ============================================================================
// NPC
// ============================================================================

/** Configuration for an NPC auto-trigger condition. */
export interface NpcTriggerConfig {
  condition: string;                   // Condition identifier (e.g., 'consecutive_failures', 'near_miss')
  threshold?: number;                  // Numeric threshold for the condition, if applicable
  message: string;                     // NPC line to display
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
// Finale State
// ============================================================================

export interface FinaleState {
  phase: 'elegy' | 'consensus_game' | 'performer_mix';

  // Fragment availability (computed from song-building results)
  availableFragments: Fragment[];       // Winners only (for consensus game)
  allFragments: Fragment[];             // All 42 (for performer mixing surface)
  lockedFragments: Fragment[];          // Losers + unreached (for elegy display)

  // Consensus game state
  consensusGame: {
    active: boolean;
    currentRound: number;
    roundTimeRemaining: number;         // ms
    votes: Map<UserId, string>;         // userId → fragmentId
    convergenceValue: number;           // 0.0 to 1.0
    threshold: number;                  // Current threshold (may decrease after failures)
    consecutiveFailures: number;
    lockedRoles: Map<LayerType, string>;  // layerType → fragmentId (activated fragments)
  };

  // NPC state
  npc: {
    currentMessage: string | null;
    autoTriggersEnabled: boolean;
  };

  // Performer mix state
  performerMix: {
    activeLayers: Map<LayerType, string | null>;  // layerType → fragmentId or null (muted)
    pendingChanges: PendingChange[];
    loopPosition: number;               // 0.0 to 1.0 within current 8-bar loop
    loopCount: number;                  // Total loops since finale started
    liveTracksActive: string[];         // IDs of active live performance tracks
  };
}

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
 * finale_elegy → finale_consensus → finale_performer_mix → ended
 */
export type ShowPhase =
  | 'lobby'                   // Audience joining, waiting
  | 'opener'                  // Performance opening (phones dark)
  | 'attempt_story'           // Story segment before song-building (phones dark)
  | 'attempt_build'           // Active song-building with audience voting
  | 'attempt_resolve'         // Song complete; waiting for performer to trigger rejection
  | 'finale_elegy'            // Elegy display of all fragments (available and locked)
  | 'finale_consensus'        // Audience consensus game to activate fragments
  | 'finale_performer_mix'    // Performer live-mixes the activated fragments
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
  finaleState: FinaleState | null;      // Populated at finale_elegy
  config: ShowConfig;
  version: number;                      // Increments on every state change
  lastUpdated: Timestamp;               // Wall clock time
  paused: boolean;
}

// ============================================================================
// Show Config
// ============================================================================

export interface ShowConfig {
  layersPerAttempt: number;             // Always 7; used for track index calculation
  attempts: AttemptConfig[];            // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;             // Text displayed while waiting
  };
  seatIds: SeatId[];                    // Known seats for QR code generation
}

export interface FinaleConfig {
  consensusRoundDurationMs: number;
  firstRoundDurationMs: number;
  initialThreshold: number;
  thresholdDecayPerFailure: number;
  minThreshold: number;
  interRoundDelayMs: number;
  successCelebrationMs: number;
  npcAutoTriggers: NpcTriggerConfig[];
}

export interface TimingConfig {
  auditionDurationMs: number;           // Fallback when OSC beat sync unavailable
  votingWindowMs: number;               // How long voting stays open
  revealSequenceDurationMs: number;     // Duration of post-vote reveal animation
  rejectionEffectDurationMs: number;    // Duration of song rejection effect
  beatsPerLoop: number;                 // Beats per audition A/B loop (OSC mode; 0 = use auditionDurationMs fallback)
  auditionsPerLayer: number;            // Number of A/B cycles per layer before voting opens
}

// ============================================================================
// Audio Cues
// ============================================================================

export type AudioCue =
  | { type: 'audition_start'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; audioRef: AudioReference; otherAudioRef: AudioReference }
  | { type: 'audition_stop'; attemptIndex: number; layerIndex: number; option: 'A' | 'B' | null; audioRef?: AudioReference }
  | { type: 'lock_in'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B'; winnerAudioRef: AudioReference; loserAudioRef: AudioReference }
  | { type: 'collapse_gesture'; attemptIndex: number }
  | { type: 'rejection_gesture'; attemptIndex: number }
  | { type: 'consensus_activate'; layerType: LayerType; fragmentId: string; audioRef: AudioReference }
  | { type: 'mix_update'; changes: PendingChange[] }
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
  | { type: 'TOGGLE_AUDITION' }
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

  // Finale — Consensus Game
  | { type: 'SETUP_FINALE' }
  | { type: 'START_CONSENSUS_ROUND' }
  | { type: 'SUBMIT_CONSENSUS_VOTE'; userId: UserId; fragmentId: string }
  | { type: 'END_CONSENSUS_ROUND' }
  | { type: 'SET_CONSENSUS_THRESHOLD'; threshold: number }
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
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }

  // Song-building
  | { type: 'LAYER_PHASE_CHANGED'; attemptIndex: number; layerIndex: number; phase: LayerPhase }
  | { type: 'AUDITION_OPTION_CHANGED'; attemptIndex: number; layerIndex: number; option: 'A' | 'B'; loopIndex: number; totalLoops: number }
  | { type: 'VOTE_RECEIVED'; userId: UserId; attemptIndex: number; layerIndex: number }
  | { type: 'VOTE_RESULT'; attemptIndex: number; layerIndex: number; result: VoteResult }
  | { type: 'LAYER_LOCKED_IN'; attemptIndex: number; layerIndex: number; winner: 'A' | 'B' }
  | { type: 'HEALTH_BAR_DRAINED'; attemptIndex: number; layerIndex: number; drain: HealthBarDrain }
  | { type: 'ATTEMPT_COLLAPSED'; attemptIndex: number; atLayer: number; healthBar: HealthBarState }
  | { type: 'ATTEMPT_COMPLETED'; attemptIndex: number }
  | { type: 'SONG_REJECTED'; attemptIndex: number }

  // Finale
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: Fragment[]; lockedFragments: Fragment[] }
  | { type: 'CONSENSUS_ROUND_STARTED'; roundNumber: number; threshold: number }
  | { type: 'CONSENSUS_VOTE_UPDATED'; convergenceValue: number }
  | { type: 'CONSENSUS_ROUND_SUCCESS'; fragmentId: string; layerType: LayerType; convergence: number }
  | { type: 'CONSENSUS_ROUND_FAILURE'; highestConvergence: number }
  | { type: 'CONSENSUS_GAME_COMPLETE' }
  | { type: 'NPC_MESSAGE'; message: string }
  | { type: 'PERFORMER_MIX_STARTED' }
  | { type: 'PENDING_CHANGES_FIRED'; changes: PendingChange[] }
  | { type: 'MIX_STATE_UPDATED'; activeLayers: Map<LayerType, string | null> }

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
  currentLayerConfig: LayerConfig | null;
  layerResults: LayerResult[];
  myVote: 'A' | 'B' | null;
  currentAuditionOption: 'A' | 'B' | null;
  auditionLoopIndex: number;
  auditionTotalLoops: number;
  healthBar: HealthBarState;
}

/**
 * Finale view sent to audience clients during the consensus game phase.
 * Personalized: includes their current vote, convergence value, and available fragments.
 */
export interface AudienceFinaleView {
  finalePhase: FinaleState['phase'];
  // Consensus game
  availableFragments: Array<{ fragment: Fragment; locked: boolean }>;
  myVote: string | null;                // fragmentId they voted for this round
  convergenceValue: number;             // 0.0 to 1.0 (updated at ~4-5 Hz)
  threshold: number;
  roundTimeRemaining: number;
  currentRound: number;
  lockedRoles: Array<{ layerType: LayerType; fragmentId: string }>;
  // NPC
  npcMessage: string | null;
  // Performer mix (audience observation only)
  mixActiveLayers: Array<{ layerType: LayerType; fragmentId: string | null }>;
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
  };
}

/**
 * Finale state sent to projector (public — no per-user data).
 */
export interface ProjectorFinaleView {
  finalePhase: FinaleState['phase'];
  availableFragments: Fragment[];
  lockedFragments: Fragment[];
  convergenceValue: number;
  threshold: number;
  roundTimeRemaining: number;
  currentRound: number;
  lockedRoles: Array<{ layerType: LayerType; fragmentId: string }>;
  npcMessage: string | null;
  mixActiveLayers: Array<{ layerType: LayerType; fragmentId: string | null }>;
  mixPendingChanges: PendingChange[];
  loopPosition: number;
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
}

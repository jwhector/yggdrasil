/**
 * Solo Show — Core Type Definitions (V3.1)
 *
 * This file defines the shared language for the entire system.
 * Changes here affect conductor, server, and client packages.
 *
 * See ARCHITECTURE.md for detailed documentation of each type.
 *
 * Self-contained: no imports from other project files.
 */

/** Number of layers per song attempt. */
export const LAYERS_PER_ATTEMPT = 6;

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
 * 6 fixed types — one per layer slot per attempt.
 */
export type LayerType =
  | 'melody'
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
  type: LayerType;
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
  layerPlan: LayerConfig[];
  currentLayerIndex: number;
  currentLayerPhase: LayerPhase;
  layerResults: LayerResult[];          // Populated as layers resolve
  votes: LayerVote[];                   // All votes for this attempt
  status: 'pending' | 'in_progress' | 'completed' | 'collapsed';
  collapsedAtLayer: number | null;
  currentAuditionOption: 'A' | 'B' | null;  // Which option is currently playing
  auditionLoopIndex: number;                  // 0-based count of loops completed
  currentVoteResult: VoteResult | null;       // Set during revealing phase, cleared on lock-in
}

/** Static configuration for a single attempt. */
export interface AttemptConfig {
  chapter: Chapter;
  title: string;                        // Display name (e.g., "Ambition")
  layers: LayerConfig[];                // 6 layers per attempt
  thresholds: number[];                 // Per-layer doubt thresholds (length 6)
  tempos: number[];                     // Per-layer BPM (length 6)
  auditionBars: number[];               // Bars per option during audition (length 6)
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
// Finale State
// ============================================================================

export interface FinaleState {
  phase: 'elegy' | 'assembly' | 'deliberation' | 'ceremony' | 'performer_mix';

  // Fragment availability (computed from song-building results)
  availableFragments: Fragment[];       // Winners only (for group deliberation)
  allFragments: Fragment[];             // All 36 (for performer mixing surface)
  lockedFragments: Fragment[];          // Losers + unreached (for elegy display)

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
    lockedLayers: Map<LayerType, string>;       // layerType → fragmentId (locked in at altar)
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
    loopPosition: number;               // 0.0 to 1.0 within current loop (length from config.timing.beatsPerLoop)
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
 * finale_elegy → finale_assembly → finale_deliberation → finale_ceremony → finale_performer_mix → ended
 */
export type ShowPhase =
  | 'lobby'                   // Audience joining, waiting
  | 'opener'                  // Performance opening (phones dark)
  | 'attempt_story'           // Story segment before song-building (phones dark)
  | 'attempt_build'           // Active song-building with audience voting
  | 'attempt_resolve'         // Song complete; waiting for performer to trigger rejection
  | 'finale_elegy'            // Elegy display of all fragments (available and locked)
  | 'finale_assembly'         // Audience self-selects into 7 layer-type groups
  | 'finale_deliberation'     // Groups preview audio, vote on fragments, select ambassadors
  | 'finale_ceremony'         // Ambassadors lock fragments at the altar via accelerometer
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
  layersPerAttempt: number;             // Always 6; used for track index calculation
  attempts: AttemptConfig[];            // Length 3
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;             // Text displayed while waiting
  };
  seatIds: SeatId[];                    // Known seats for QR code generation
}

export interface FinaleConfig {
  bothOptionsSurvive: boolean;          // When true, both winner and loser are available in deliberation
  assemblyTimerMs: number;
  assemblyGracePeriodMs: number;
  deliberationTimerMs: number;
  ambassadorVolunteerTimerMs: number;
  ceremonyLayerOrder: LayerType[];      // Length 6
  audioPreviewPath: string;
  layerLabels: Map<LayerType, string>;
  npcMessages: NpcMessageConfig[];
}

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
  auditionDurationMs: number;           // Fallback when OSC beat sync unavailable
  votingWindowMs: number;               // How long voting stays open
  revealSequenceDurationMs: number;     // Duration of post-vote reveal animation
  rejectionEffectDurationMs: number;    // Duration of song rejection effect
  beatsPerLoop: number;                 // Beats per audition A/B loop (OSC mode; 0 = use auditionDurationMs fallback)
  auditionsPerLayer: number;            // Number of A/B cycles per layer before voting opens
  gain?: GainConfig;                    // Utility device gain transition configuration (uses defaults if absent)
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
  | { type: 'ceremony_activate'; layerType: LayerType; fragmentId: string; audioRef: AudioReference }
  | { type: 'mix_update'; changes: PendingChange[] }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }                   // Hard mute all — gain to 0, mute tracks
  | { type: 'reset_utilities' };        // Emergency: set all Utility gains to 0 dB, unmute all tracks

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
  | { type: 'CLOSE_VOTING' }
  | { type: 'ADVANCE_FROM_REVEAL' }
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

  // Finale — Setup
  | { type: 'FINALE_SETUP_COMPLETE'; availableFragments: Fragment[]; lockedFragments: Fragment[] }
  | { type: 'NPC_MESSAGE'; message: string }

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
  currentVoteResult: { winner: 'A' | 'B'; winningProportion: number } | null;
  lastThresholdCheck: { winningProportion: number; threshold: number; passed: boolean } | null;
}

/**
 * Finale view sent to audience clients during assembly/deliberation/ceremony/mix phases.
 * Personalized: includes group assignment, votes, ambassador status.
 */
export interface AudienceFinaleView {
  finalePhase: FinaleState['phase'];
  // Assembly
  myGroup: LayerType | null;                          // which group the user has joined
  groupSizes: Array<{ layerType: LayerType; count: number }>;  // all group sizes
  assemblyTimerRemaining: number;
  // Deliberation
  myGroupFragments: Fragment[];                       // fragments available for user's group
  groupVoteCounts: Array<{ fragmentId: string; count: number }>;  // vote distribution for user's group
  myGroupVote: string | null;                         // fragmentId user voted for
  chosenFragment: string | null;                      // after timer: winning fragmentId for user's group
  isAmbassadorVolunteer: boolean;                     // whether user has volunteered
  myAmbassadorStatus: UserId | null;                  // selected ambassador for user's group
  deliberationTimerRemaining: number;
  volunteerTimerRemaining: number | null;
  // Ceremony
  ceremonyProgress: Array<{ layerType: LayerType; status: 'locked' | 'forfeited' | 'current' | 'upcoming' }>;
  isCurrentAmbassador: boolean;                       // whether user is the currently called ambassador
  altarReady: boolean;                                // whether altar lock-in is active for this user
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
  // Assembly
  groupSizes: Array<{ layerType: LayerType; count: number }>;
  undecidedCount: number;
  assemblyTimerRemaining: number;
  // Deliberation
  groupVoteDistributions: Array<{ layerType: LayerType; votes: Array<{ fragmentId: string; count: number }> }>;
  chosenFragments: Array<{ layerType: LayerType; fragmentId: string | null }>;
  ambassadors: Array<{ layerType: LayerType; userId: UserId | null }>;
  deliberationTimerRemaining: number;
  // Ceremony
  ceremonyLayerOrder: LayerType[];
  ceremonyLockedLayers: Array<{ layerType: LayerType; fragmentId: string }>;
  ceremonyForfeitedLayers: LayerType[];
  currentCeremonyLayer: LayerType | null;
  currentAmbassador: UserId | null;
  ceremonyComplete: boolean;
  // NPC
  npcMessage: string | null;
  // Performer mix
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

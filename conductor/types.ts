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

/**
 * A chapter ID string. References a ChapterConfig entry by its `id` field.
 * Config-driven — no hardcoded chapter names in code. Resolve display labels
 * via config lookup (e.g., getChapterIdentity(chapterId)).
 */
export type Chapter = string;

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
  songRejected: boolean;                      // True after TRIGGER_REJECTION fires in attempt_resolve
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
  trackIndices: number[];                   // Computed from track layout formula
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
 * finale_vote → finale_remix → ended
 */
export type ShowPhase =
  | 'lobby'                   // Audience joining, waiting
  | 'opener'                  // Performance opening (phones dark)
  | 'attempt_story'           // Story segment before song-building (phones dark)
  | 'attempt_build'           // Active song-building with audience voting
  | 'attempt_resolve'         // Song complete; waiting for performer to trigger rejection
  | 'finale_vote'             // Audience emotional vote — phones active, tokens generated
  | 'finale_remix'            // Performer builds song from token pool — phones down
  | 'epilogue'                // Master faded out; performer monologue → walk-out music
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
  finaleState: FinaleState | null;
  config: ShowConfig;
  version: number;                      // Increments on every state change
  lastUpdated: Timestamp;               // Wall clock time
  paused: boolean;
  openerSlideState: OpenerSlidePosition | null;  // null = blank screen (before first or after last slide)
}

/** Current position in the opener slide deck. */
export interface OpenerSlidePosition {
  pointIndex: number;                   // Which slide (0-based)
  stepIndex: number;                    // Linear step within the slide (0 = title only)
}

// ============================================================================
// Onboarding Config (lobby landing page)
// ============================================================================

export interface OnboardingCue {
  icon: string;          // 'brain' | 'eyelid' — resolved to SVGs client-side
  label: string;         // e.g. "PICK UP YOUR PHONE"
  description: string;
}

export interface OnboardingSection {
  type: 'narrative' | 'practical' | 'cues' | 'disclaimer' | 'reconnect';
  heading?: string | null;
  body?: string;
  items?: string[];
  cues?: OnboardingCue[];
}

export interface OnboardingConfig {
  buttonLabel: string;
  sections: OnboardingSection[];
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
  finale: FinaleConfig;
  timing: TimingConfig;
  lobby: {
    waitingMessage: string;             // Text displayed while waiting
    onboarding?: OnboardingConfig;      // Onboarding flow after landing animation
  };
  seatIds: SeatId[];                    // Known seats for QR code generation
  intrusiveThoughts?: IntrusiveThoughtsConfig[];  // Per-attempt, per-layer thought strings
  openerSlides?: OpenerSlide[];          // Slide deck for opener phase
}

// ── Opener slide types ──────────────────────────────────────────────────────

export type SlideMediaType = 'image' | 'video' | 'audio';

export interface SlideMedia {
  type: SlideMediaType;
  src: string;          // Path relative to /public, e.g. "/opener-media/photo.jpg"
  alt?: string;         // Accessibility text
  autoplay?: boolean;   // Video/audio — default true
  loop?: boolean;       // Video/audio — default false
  muted?: boolean;      // Video — default true (projector uses separate audio)
  trackIndices?: number[];  // Ableton track indices for audio playback (audio routed through Ableton, not browser)
  durationBeats?: number;   // How many beats the clip runs (defaults to loopBoundaryBeats if omitted)
}

export interface SlideSubPoint {
  label: string;        // e.g. "Duration:"
  value: string;        // e.g. "1 year, 7 months"
}

/** A single opener slide: a main point with optional media and structured sub-points. */
export interface OpenerSlide {
  point: string;
  media?: SlideMedia;           // Shown as its own step after the title
  subPoints?: SlideSubPoint[];  // Each label and value is a separate advance step
}

/** Compute the max stepIndex for a given slide. */
export function getSlideMaxStep(slide: OpenerSlide): number {
  let steps = 0; // step 0 = title
  if (slide.media) steps++;
  if (slide.subPoints) steps += slide.subPoints.length * 2; // label + value each
  return steps;
}

/** Intrusive thoughts config — random sample shown to each user on collapse. */
export interface IntrusiveThoughtsConfig {
  chapter: Chapter;
  thoughts: string[];                   // Pool to sample from
  count: number;                        // How many each user sees
}

/** A single thought assigned to a specific user by the server. */
export interface AssignedThought {
  id: string;                           // Unique: "{attemptIndex}-{layerIndex}-{userId}-{i}"
  text: string;
  userId: UserId;
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
  crossfadeBeats: number;       // Beats for node crossfade — both fade-out and fade-in (default 1)
  unityGainValue: number;       // Normalized Ableton param value for 0 dB (default 0.85)
  stepsPerBeat: number;         // Sub-steps per beat for gain interpolation (default 2; 1 = no sub-beats)
  masterDuckGain: number;       // Ducked master gain level during speech (default 0.3)
  masterDuckBeats: number;      // Beats to ramp master to ducked level (default 2)
  masterUnduckBeats: number;    // Beats to ramp master back to unity (default 1)
  masterFadeOutBeats: number;   // Beats to fade master to zero at show end (default 16)
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
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' }                   // Hard mute all — gain to 0, mute tracks
  | { type: 'master_panic' }            // Authoritative: query Ableton for all tracks, mute every non-foldable, reset gains
  | { type: 'reset_utilities' }         // Emergency: set all Utility gains to 0 dB, unmute all tracks
  /** V3.4: start the remix transport (reset beat counter) */
  | { type: 'remix_start' }
  /** V3.4: unmute remix node tracks with gain swell */
  | { type: 'node_unmute'; granularType: string; trackIndices: number[] }
  /** V3.4: crossfade between two sets of chapter tracks at loop boundary */
  | { type: 'node_crossfade'; granularType: string; muteTracks: number[]; unmuteTracks: number[] }
  /** V3.4: immediate crossfade (no loop boundary wait) — used in audience interaction mode */
  | { type: 'node_instant_crossfade'; granularType: string; muteTracks: number[]; unmuteTracks: number[] }
  /** V3.4: fade a node's tracks to silence (nothing queued) */
  | { type: 'node_fade_out'; granularType: string; trackIndices: number[] }
  /** Duck master gain (performer speaking between auditions) */
  | { type: 'master_duck' }
  /** Unduck master gain (audition starting or leaving attempt_build) */
  | { type: 'master_unduck' }
  /** Fade master to silence for closing monologue */
  | { type: 'master_fade_out' }
  /** Unmute and fade in epilogue walk-out music tracks */
  | { type: 'epilogue_music_start'; trackIndices: number[]; fadeInBeats: number }
  /** Opener slide media: one-shot playback (fade in, play one loop, fade out, stop) */
  | { type: 'slide_media_start'; trackIndices: number[]; durationBeats: number }
  /** Opener slide media: cancel any in-progress slide playback */
  | { type: 'slide_media_stop' };

// ============================================================================
// Conductor Commands (Input)
// ============================================================================

export type ConductorCommand =
  // Show flow
  | { type: 'ADVANCE_PHASE' }
  | { type: 'JUMP_TO_PHASE'; phase: ShowPhase; attemptIndex?: number }
  | { type: 'ADVANCE_SLIDE' }
  | { type: 'SLIDE_MEDIA_READY' }  // Projector signals browser media is playing → trigger Ableton audio
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

  // Audio
  | { type: 'AUDIO_TRANSPORT'; action: 'play' | 'stop' }
  | { type: 'AUDIO_PANIC' }
  | { type: 'MASTER_PANIC' }            // Authoritative: query Ableton, mute all non-foldable tracks
  | { type: 'RESET_UTILITIES' }         // Emergency: reset all Utility gains to 0 dB
  | { type: 'MASTER_DUCK' }
  | { type: 'MASTER_UNDUCK' }

  // Connection
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId }
  | { type: 'USER_DISCONNECT'; userId: UserId }

  // Finale — Vote phase (V3.4)
  | { type: 'START_VOTE' }
  | { type: 'SUBMIT_EMOTION'; userId: UserId; chapterId: string; questionIndex: number }
  | { type: 'REQUEST_NEXT_QUESTION'; userId: UserId }
  | { type: 'POOL_CAP_REACHED' }

  // Finale — Remix phase (V3.4)
  | { type: 'START_REMIX' }
  | { type: 'QUEUE_TOKEN'; granularType: string; chapterId: string; instant?: boolean }
  | { type: 'CANCEL_QUEUE'; granularType: string }
  | { type: 'ADVANCE_NODE'; granularType: string }
  | { type: 'TOGGLE_AUDIENCE_INTERACTION' }
  | { type: 'LOOP_BOUNDARY' }

  // Finale — Audience Remix (swarm orbs)
  | { type: 'PLACE_ORB'; userId: UserId; orbIndex: number; granularType: string }
  | { type: 'RECALL_ORB'; userId: UserId; orbIndex: number }
  | { type: 'SET_DECAY_RATE'; loops: number }
  | { type: 'SET_CROSSFADE_MODE'; instant: boolean }
  | { type: 'SCATTER_NODE'; granularType: string }
  | { type: 'SCATTER_ALL' }
  | { type: 'LOCK_NODE'; granularType: string; chapterId: string }
  | { type: 'UNLOCK_NODE'; granularType: string }
  | { type: 'ENABLE_NODE'; granularType: string }
  | { type: 'DISABLE_NODE'; granularType: string }
  | { type: 'FALLBACK_PERFORMER_REMIX'; instant?: boolean }

  // Manual end (V3.4)
  | { type: 'END_SHOW' }

  // Testing — inject tokens directly into the pool
  | { type: 'INJECT_TOKENS'; chapterId: string; count: number }

  // Failsafe — generate a valid finale from a blank show using config-driven default winners
  | { type: 'GENERATE_VALID_FINALE' }

  // Emergency — generate orbs for all connected users during remix (bypasses vote phase)
  | { type: 'GENERATE_ORBS' }

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

  // Finale — Vote phase
  | { type: 'VOTE_STARTED' }
  | { type: 'EMOTION_RECEIVED'; userId: UserId; chapterId: string; questionIndex: number; poolSize: number }
  | { type: 'NEXT_QUESTION'; userId: UserId; questionIndex: number; questionText: string; answers?: QuestionAnswer[] | null }
  | { type: 'POOL_CAP_REACHED'; finalPoolSize: number }
  | { type: 'POOL_READY'; pool: TokenPool }

  // Finale — Remix phase (V3.4)
  | { type: 'REMIX_STARTED'; pool: TokenPool }
  | { type: 'TOKEN_QUEUED'; granularType: string; chapterId: string; queueDepth: number }
  | { type: 'TOKEN_CANCELLED'; granularType: string; chapterId: string; returnedToPool: boolean }
  | { type: 'TOKEN_ACTIVATED'; granularType: string; chapterId: string; tokenId: string; trackIndices: number[] }
  | { type: 'TOKEN_SPENT'; granularType: string; tokenId: string; poolRemaining: number }
  | { type: 'NODE_SILENT'; granularType: string }
  | { type: 'NODE_ADVANCED'; granularType: string }
  | { type: 'POOL_EMPTY' }

  // Finale — Audience Remix events
  | { type: 'ORB_PLACED'; userId: UserId; orbIndex: number; granularType: string; chapterId: string }
  | { type: 'ORB_RECALLED'; userId: UserId; orbIndex: number; granularType: string; chapterId: string }
  | { type: 'ORB_DECAYED'; userId: UserId; orbIndex: number; granularType: string }
  | { type: 'NODE_TALLY_CHANGED'; granularType: string; dominantChapter: string | null; votes: Array<{ chapterId: string; count: number }> }
  | { type: 'NODE_LOCKED'; granularType: string; chapterId: string }
  | { type: 'NODE_UNLOCKED'; granularType: string }
  | { type: 'NODES_SCATTERED'; granularType: string | null; affectedUsers: UserId[] }
  | { type: 'NODE_ENABLED'; granularType: string }
  | { type: 'NODE_DISABLED'; granularType: string }
  | { type: 'DECAY_RATE_CHANGED'; loops: number }
  | { type: 'CROSSFADE_MODE_CHANGED'; instant: boolean }
  | { type: 'FALLBACK_ACTIVATED'; instant: boolean }

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
  songIndex?: number;  // V3.4: maps chapter to song index (0, 1, 2) for track resolution
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
  armTrackIndices?: number[];   // Input tracks to arm for recording (falls back to trackIndices if absent)
  armMuteExceptions?: number[]; // Tracks that get armed but stay muted (e.g., vocoder carrier)
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
  defaultWinners?: ('A' | 'B')[];         // Failsafe: predetermined winners per layer for GENERATE_VALID_FINALE
}

/**
 * A granular fragment is the atomic unit of the elegy display.
 * Song-building produces LayerGroup results; those are decomposed into GranularFragments
 * (one per granular track per option).
 *
 * GranularFragment may be used for a future elegy display (see conductor/fragments.ts).
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
  myFinale: AudienceVoteView | AudienceRemixView | null;
  config: {
    lobby: { waitingMessage: string; onboarding?: OnboardingConfig };
    chapters: ChapterConfig[];
    granularTypes: GranularType[];
    intrusiveThoughts: IntrusiveThoughtsConfig[];
  };
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

// ============================================================================
// V3.4 Token Pool — Types
// ============================================================================

/**
 * Serialized token pool counts for transport over the wire and event payloads.
 * Maps are used internally in FinaleState; TokenPool is the wire-safe form.
 */
export interface TokenPool {
  available: Map<string, number>;  // chapterId → remaining available count
  total: Map<string, number>;      // chapterId → original count (for display)
}

/** A single emotional vote token created by an audience member. */
export interface Token {
  id: string;
  ownerId: UserId;
  chapterId: string;
  questionIndex: number;
  status: 'available' | 'queued' | 'playing' | 'spent';
}

/** A token queued for the next loop boundary on a granular type node. */
export interface QueuedToken {
  tokenId: string;
  chapterId: string;
  queuedAt: number;  // Timestamp
}

/** The currently-playing token on a granular type node. */
export interface ActiveNode {
  tokenId: string;
  chapterId: string;
  startedAtLoop: number;
  trackIndices: number[];  // Resolved Ableton track indices (multiple tracks per granular type)
  persistent: boolean;     // True when activated in audience interaction mode — loops until overridden
}

// ============================================================================
// V3.4 Finale State
// ============================================================================

/**
 * Finale state (V3.4 — "Token Pool").
 * Phases: finale_vote → finale_remix.
 */
export interface FinaleState {
  phase: 'vote' | 'remix';

  // Vote phase tracking
  vote: {
    questionsAnsweredByUser: Map<UserId, number>;  // How many questions each person has answered
  };

  // Token pool
  pool: {
    tokens: Token[];                            // All tokens (available + queued + playing + spent)
    availableByChapter: Map<string, number>;    // chapterId → remaining available count
    totalByChapter: Map<string, number>;        // chapterId → original count
    totalRemaining: number;                     // Sum of all available
    targetPoolSize: number;                     // Config-driven cap
  };

  // Performer queue (what's coming on the next loop boundary)
  queue: Map<string, QueuedToken[]>;  // granularType → ordered list of queued tokens

  // Currently playing (what's active right now)
  active: Map<string, ActiveNode>;    // granularType → currently playing info

  // Mode
  audienceInteraction: boolean;  // When true: instant crossfade + persistent looping

  // Chapter → songIndex mapping (e.g., "ambition" → 0, "love" → 1)
  chapterSongIndex: Map<string, number>;

  // Track resolution (granularType → songIndex → Ableton trackIndices)
  trackMap: Map<string, Map<number, number[]>>;

  // Loop tracking
  loopCount: number;
  loopProgress: number;  // 0.0–1.0, for display

  npc: { currentMessage: string | null };

  // Audience remix (swarm orbs)
  audienceOrbs: Map<UserId, UserRemixState>;  // Per-user orb state
  nodeTallies: Map<string, NodeVoteTally>;    // Per-node aggregate tally
  orbDecayLoops: number;                       // Current decay rate (live-adjustable)
  instantCrossfade: boolean;                   // Current crossfade mode (live-adjustable)
  enabledNodes: Set<string>;                   // Granular types currently accepting orbs (empty = all disabled)
  fallbackMode: boolean;                       // True when performer has taken over via fallback
}

// ============================================================================
// V3.4 Finale Config
// ============================================================================

/** Per-question answer label mapping a chapter to custom display text. */
export interface QuestionAnswer {
  chapterId: string;  // Maps to a chapter (e.g., "ambition")
  label: string;      // Custom display text (e.g., "The truth about what he's chasing")
}

/** Question in the vote phase question bank. */
export interface QuestionConfig {
  text: string;  // e.g., "What does he need to hear?"
  answers?: QuestionAnswer[];  // Per-question custom answer labels (falls back to chapter.label if absent)
}

/** Vote phase configuration. */
export interface VotePhaseConfig {
  questions: QuestionConfig[];       // Ordered question bank
  shuffleQuestions: boolean;         // Randomize order per person (default: false)
  targetPoolSize: number;            // Pool cap — total tokens before phones go dark (default: 120)
  questionDelayMs: number;           // Delay between answer and next question (default: 3000)
  revealPoolOnProjector: boolean;    // Show dots blooming on projector in real time (default: true)
  alarmColor?: string;               // CSS color for alarm edge flash (default: '#ff0000')
}

/** Remix phase configuration. */
export interface RemixConfig {
  audienceInteraction: boolean;  // Default mode: false (standard loop-quantized behavior)
  orbsPerPerson: number;         // Number of orbs per audience member (default: 6)
  orbDecayLoops: number;         // Loops before placed orbs decay back to hand (0 = no decay, default: 3)
  tallyBroadcastMs: number;      // Tally broadcast interval in ms (default: 500)
  instantCrossfade: boolean;     // True = crossfade on tally change, false = at loop boundary (default: true)
}

/** Finale configuration (V3.4). */
export interface FinaleConfig {
  bothOptionsSurvive: boolean;
  soundscapeTrackIndices: number[];
  audioPreviewPath: string;
  npcMessages: NpcMessageConfig[];
  vote: VotePhaseConfig;
  remix: RemixConfig;
  epilogue?: { trackIndices: number[]; fadeInBeats: number };
}

// ============================================================================
// V3.4 Audience Remix — Orb Types
// ============================================================================

/** A personal orb owned by an audience member, generated from their vote phase answers. */
export interface AudienceOrb {
  index: number;              // 0-5 (position in the user's orb array)
  chapterId: string;          // Chapter from their vote answer
  placedOnNode: string | null; // granularType if placed, null if in hand
  placedAtLoop: number;       // Loop count when placed (for decay calculation), 0 if in hand
}

/** Per-user remix state tracked server-side. */
export interface UserRemixState {
  userId: UserId;
  orbs: AudienceOrb[];       // Always length = orbsPerPerson (e.g., 6)
}

/** Aggregate vote tally for a single node, derived from all audience orbs. */
export interface NodeVoteTally {
  granularType: string;
  votes: Map<string, number>;     // chapterId → count of orbs placed here
  dominantChapter: string | null;  // Highest count wins (tie = incumbent stays), null if no orbs
  locked: boolean;                 // If true, performer has locked this node
  lockedChapter: string | null;    // The chapter it's locked to (null if unlocked)
}

// ============================================================================
// V3.4 Audio Cues
// ============================================================================

/**
 * Remix-specific audio cues (V3.4).
 * These are also added as variants to the main AudioCue union above.
 * RemixAudioCue is a convenience alias for remix-phase cue handlers.
 */
export type RemixAudioCue =
  | { type: 'remix_start' }
  | { type: 'node_unmute'; granularType: string; trackIndices: number[] }
  | { type: 'node_crossfade'; granularType: string; muteTracks: number[]; unmuteTracks: number[] }
  | { type: 'node_instant_crossfade'; granularType: string; muteTracks: number[]; unmuteTracks: number[] }
  | { type: 'node_fade_out'; granularType: string; trackIndices: number[] }
  | { type: 'transport'; action: 'play' | 'stop' }
  | { type: 'panic' };

// ============================================================================
// V3.4 Client State Types
// ============================================================================

/**
 * Finale view sent to audience clients during finale_vote (V3.4).
 * Personalized: includes current question and answer count for this user.
 */
export interface AudienceVoteView {
  finalePhase: 'vote';
  questions: QuestionConfig[];  // Full question bank — client iterates locally
  answeredCount: number;    // How many questions this user has already answered (for resume)
  chapters: ChapterConfig[];  // For rendering the 3 option cards (chapter identity)
  npcMessage: string | null;
  npcIntro: string[];       // NPC intro messages for client-side staging (vote_intro_1, vote_intro_2)
  alarmColor: string;       // CSS color for alarm edge flash
  shuffleQuestions: boolean; // Whether to shuffle question order per user
}

/**
 * Finale view sent to audience clients during finale_remix (V3.4).
 * In audience swarm mode: personalized orb state + node tallies.
 * In fallback mode: phones down (no interactive UI).
 */
export interface AudienceRemixView {
  finalePhase: 'remix';
  npcMessage: string | null;
  fallbackMode: boolean;           // True = phones down (performer took over)
  orbs: AudienceOrb[];             // This user's 6 orbs (empty in fallback mode)
  nodeTallies: Array<{             // Aggregate tally per node (for radial visualization)
    granularType: string;
    votes: Array<{ chapterId: string; count: number }>;
    dominantChapter: string | null;
    locked: boolean;
    lockedChapter: string | null;
  }>;
  chapters: ChapterConfig[];       // For color resolution
  granularTypes: GranularType[];   // For node labels
  enabledNodes: string[];          // Which nodes are currently accepting orbs
}

/**
 * Finale state sent to projector clients during V3.4 finale phases (public — no per-user data).
 * Used for both finale_vote (pool fill visualization) and finale_remix (pentagon nodes + pool).
 */
export interface ProjectorFinaleView {
  finalePhase: 'vote' | 'remix';
  // Pool state (serialized for JSON transport)
  pool: {
    availableByChapter: Array<{ chapterId: string; count: number }>;
    totalByChapter: Array<{ chapterId: string; count: number }>;
    totalRemaining: number;
    targetPoolSize: number;
  };
  // Active nodes (what's currently playing on each granular type)
  active: Array<{
    granularType: string;
    chapterId: string;
    trackIndices: number[];
    persistent: boolean;
  }>;
  // Queue depth per granular type (for stack indicators on nodes)
  queueDepth: Array<{ granularType: string; depth: number; nextChapterId: string | null }>;
  // Valid granularType+chapter combos (have tracks from song-building)
  validNodes: Array<{ granularType: string; chapterId: string }>;
  // Loop state
  loopCount: number;
  loopProgress: number;
  // Mode
  audienceInteraction: boolean;
  // NPC
  npcMessage: string | null;
  // Audience remix tally (for radial arc visualization)
  nodeTallies: Array<{
    granularType: string;
    votes: Array<{ chapterId: string; count: number }>;
    dominantChapter: string | null;
    locked: boolean;
    lockedChapter: string | null;
  }>;
  fallbackMode: boolean;
  enabledNodes: string[];
}

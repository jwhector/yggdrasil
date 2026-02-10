/**
 * Solo Show — Core Type Definitions
 * 
 * This file defines the shared language for the entire system.
 * Changes here affect conductor, server, and client packages.
 * 
 * See ARCHITECTURE.md for detailed documentation of each type.
 */

// ============================================================================
// Primitive Types
// ============================================================================

export type UserId = string;
export type OptionId = string;
export type ShowId = string;
export type SeatId = string;
export type FactionId = 0 | 1 | 2 | 3;
export type Timestamp = number;

// ============================================================================
// Seat Topology
// ============================================================================

/**
 * Defines which seats are adjacent to each other.
 * Used for faction assignment optimization.
 */
export interface AdjacencyGraph {
  getNeighbors(seatId: SeatId): SeatId[];
}

export type TopologyType = 'theater_rows' | 'tables' | 'grid' | 'none';

export interface SeatTopologyConfig {
  type: TopologyType;
  // Additional config per type (e.g., rows/cols for grid, table assignments for tables)
  data?: Record<string, unknown>;
}

// ============================================================================
// User
// ============================================================================

export interface User {
  id: UserId;
  seatId: SeatId | null;        // From QR code, null if unknown
  faction: FactionId | null;    // null until assignment phase completes
  connected: boolean;
  joinedAt: Timestamp;
}

// ============================================================================
// Faction
// ============================================================================

export interface Faction {
  id: FactionId;
  name: string;
  color: string;
  coupUsed: boolean;
  coupMultiplier: number;
  currentRowCoupVotes: Set<UserId>;
}

// ============================================================================
// Row & Options
// ============================================================================

export type RowPhase =
  | 'pending'
  | 'voting'        // Now includes audition playback
  | 'revealing'
  | 'coup_window'
  | 'committed';

export type RowType = 'layer' | 'effect';

/**
 * Options are musically ambiguous — they are NOT tied to specific factions.
 * The 4 factions and 4 options per row is thematic parallelism, not mechanical coupling.
 * A faction wins by having its members align on ANY option.
 */
export interface Option {
  id: OptionId;
  index: number;  // 0–3, position within row
  audioRef: string;
  harmonicGroup?: string;
}

export interface Row {
  index: number;
  label: string;
  type: RowType;
  options: [Option, Option, Option, Option];
  phase: RowPhase;
  committedOption: OptionId | null;
  attempts: number;
  currentAuditionIndex: number | null;  // Used during 'voting' phase for audition playback
  auditionComplete: boolean;             // Tracks if all options have been heard
}

// ============================================================================
// Voting
// ============================================================================

export interface Vote {
  userId: UserId;
  rowIndex: number;
  factionVote: OptionId;
  personalVote: OptionId;
  timestamp: Timestamp;
  attempt: number;
}

// ============================================================================
// Personal Tree (for Finale)
// ============================================================================

/**
 * Tracks each user's personal votes and their response to the lobby prompt.
 * Used during finale to play back "songs that could've been" with imagined alternate lives.
 */
export interface PersonalTree {
  userId: UserId;
  path: OptionId[];                     // One entry per row (personal votes)
  figTreeResponse: string | null;       // Response to lobby prompt (e.g., "What lives on your fig tree?")
}

// ============================================================================
// Show State
// ============================================================================

export type ShowPhase =
  | 'lobby'           // Audience joining, factions not yet assigned, fig tree prompt
  | 'assigning'       // Brief phase during faction assignment (reveal animation)
  | 'running'         // Main show loop
  | 'finale'          // Playing back personal timelines
  | 'ended'
  | 'paused';

export interface TimingConfig {
  auditionLoopsPerOption: number;     // How many times each option loops during audition (default: 2)
  auditionLoopsPerRow: number;        // How many complete cycles through all 4 options (default: 1)
  auditionPerOptionMs: number;        // ms per loop
  votingWindowMs: number;
  revealDurationMs: number;
  coupWindowMs: number;
}

export interface CoupConfig {
  threshold: number;
  multiplierBonus: number;
}

export interface LobbyConfig {
  projectorContent: string;             // Text displayed on projector during lobby
  audiencePrompt: string;               // Prompt for audience input (e.g., "What lives on your fig tree?")
}

export interface ShowConfig {
  rowCount: number;
  factions: FactionConfig[];
  timing: TimingConfig;
  coup: CoupConfig;
  lobby: LobbyConfig;
  rows: RowConfig[];
  topology: SeatTopologyConfig;
}

export interface FactionConfig {
  id: FactionId;
  name: string;
  color: string;
}

export interface RowConfig {
  index: number;
  label: string;
  type: RowType;
  description?: string;
  keyDecision?: boolean;
  options: OptionConfig[];
}

export interface OptionConfig {
  id: OptionId;
  index: number;  // 0–3, position within row
  audioRef: string;
  harmonicGroup?: string;
}

// ============================================================================
// Dual Path Tracking
// ============================================================================

/**
 * The system tracks two parallel paths through the Song Tree:
 * - factionPath: Determined by coherence competition ("the song we built")
 * - popularPath: Determined by personal vote plurality ("the song we wanted")
 */
export interface DualPaths {
  factionPath: OptionId[];    // Committed options (coherence winners)
  popularPath: OptionId[];    // Personal vote plurality winners
}

// ============================================================================
// Show State
// ============================================================================

export interface ShowState {
  id: ShowId;
  version: number;            // Monotonic, increments on every state change
  lastUpdated: Timestamp;     // Wall clock time of last change
  phase: ShowPhase;
  currentRowIndex: number;
  rows: Row[];
  factions: [Faction, Faction, Faction, Faction];
  users: Map<UserId, User>;
  votes: Vote[];
  personalTrees: Map<UserId, PersonalTree>;
  paths: DualPaths;           // Faction path and popular path
  config: ShowConfig;
  pausedPhase: ShowPhase | null;
}

// ============================================================================
// Conductor Commands (Input)
// ============================================================================

export type ConductorCommand =
  // Phase control
  | { type: 'ADVANCE_PHASE' }
  | { type: 'START_SHOW' }
  | { type: 'ASSIGN_FACTIONS' }
  | { type: 'FORCE_FINALE' }
  
  // User actions
  | { type: 'SUBMIT_VOTE'; userId: UserId; factionVote: OptionId; personalVote: OptionId }
  | { type: 'SUBMIT_COUP_VOTE'; userId: UserId }
  | { type: 'SUBMIT_FIG_TREE_RESPONSE'; userId: UserId; text: string }
  
  // Connection management
  | { type: 'USER_CONNECT'; userId: UserId; seatId?: SeatId; existingFaction?: FactionId }
  | { type: 'USER_DISCONNECT'; userId: UserId }
  | { type: 'USER_RECONNECT'; userId: UserId; lastVersion: number }
  
  // Performer controls
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SKIP_ROW' }
  | { type: 'RESTART_ROW' }
  | { type: 'TRIGGER_COUP'; factionId: FactionId }
  | { type: 'SET_TIMING'; timing: Partial<TimingConfig> }
  
  // Emergency recovery (controller only)
  | { type: 'RESET_TO_LOBBY'; preserveUsers: boolean }
  | { type: 'IMPORT_STATE'; state: ShowState }
  | { type: 'FORCE_RECONNECT_ALL' };

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
// Conductor Events (Output)
// ============================================================================

export interface FactionResult {
  factionId: FactionId;
  rawCoherence: number;
  weightedCoherence: number;
  voteCount: number;
  votedForOption: OptionId;             // Which option this faction's largest bloc voted for
}

export interface TieInfo {
  occurred: boolean;
  tiedFactionIds: FactionId[];          // Empty if no tie
}

export interface PopularVoteResult {
  optionId: OptionId;                   // Option with most personal votes
  voteCount: number;
  divergedFromFaction: boolean;         // True if popular ≠ faction choice
}

export interface RevealPayload {
  rowIndex: number;
  factionResults: FactionResult[];
  tie: TieInfo;
  winningOptionId: OptionId;            // Resolved winner (random if tie)
  winningFactionId: FactionId;          // Resolved winner (random if tie)
  popularVote: PopularVoteResult;
}

export interface FinaleTimeline {
  userId: UserId;
  path: OptionId[];
  figTreeResponse: string;
  harmonicGroup: string;
}

export type AudioCueType =
  | 'play_option'
  | 'stop_option'
  | 'commit_layer'
  | 'uncommit_layer'
  | 'play_timeline';

export interface AudioCue {
  type: AudioCueType;
  rowIndex?: number;
  optionId?: OptionId;
  path?: OptionId[];
  userId?: UserId;  // Present for individual timeline playback
}

export type ConductorEvent =
  // Phase and game flow
  | { type: 'ROW_PHASE_CHANGED'; row: number; phase: RowPhase }
  | { type: 'AUDITION_OPTION_CHANGED'; row: number; optionIndex: number }
  | { type: 'AUDITION_COMPLETE'; row: number }
  | { type: 'VOTE_RECEIVED'; userId: UserId; row: number }
  | { type: 'REVEAL'; payload: RevealPayload }
  | { type: 'TIE_DETECTED'; row: number; tiedFactionIds: FactionId[] }
  | { type: 'TIE_RESOLVED'; row: number; winningFactionId: FactionId }
  | { type: 'PATHS_UPDATED'; paths: DualPaths }
  | { type: 'COUP_METER_UPDATE'; factionId: FactionId; progress: number }
  | { type: 'COUP_TRIGGERED'; factionId: FactionId; row: number }
  | { type: 'ROW_COMMITTED'; row: number; optionId: OptionId; popularOptionId: OptionId }
  | { type: 'SHOW_PHASE_CHANGED'; phase: ShowPhase }
  
  // Faction assignment
  | { type: 'FACTIONS_ASSIGNED'; assignments: Map<UserId, FactionId> }
  | { type: 'FACTION_ASSIGNED'; userId: UserId; faction: FactionId }
  
  // Finale
  | { type: 'FINALE_POPULAR_SONG'; path: OptionId[] }
  | { type: 'FINALE_TIMELINE'; timeline: FinaleTimeline }
  
  // Audio
  | { type: 'AUDIO_CUE'; cue: AudioCue }
  
  // Connection management
  | { type: 'USER_JOINED'; userId: UserId; faction: FactionId | null }
  | { type: 'USER_LEFT'; userId: UserId }
  | { type: 'USER_RECONNECTED'; userId: UserId; missedEvents: number }
  
  // State sync (sent to individual client on connect/reconnect)
  | { type: 'STATE_SYNC'; state: ShowState; forUserId: UserId }
  
  // Recovery
  | { type: 'FORCE_RECONNECT'; reason: string }  // Broadcast to all clients
  | { type: 'SHOW_RESET'; preservedUsers: boolean }
  
  // Errors
  | { type: 'ERROR'; message: string; command?: ConductorCommand };

// ============================================================================
// Audio Adapter Interface
// ============================================================================

export interface AudioAdapter {
  initialize(config: ShowConfig): Promise<void>;
  playOption(rowIndex: number, optionId: OptionId): Promise<void>;
  stopOption(rowIndex: number, optionId: OptionId): Promise<void>;
  commitLayer(rowIndex: number, optionId: OptionId): Promise<void>;
  uncommitLayer(rowIndex: number): Promise<void>;
  playPopularPath(path: OptionId[]): Promise<void>;       // "The song we wanted"
  playPersonalTimeline(path: OptionId[]): Promise<void>;  // Individual finale timelines
  dispose(): Promise<void>;
}

// ============================================================================
// Client State (subset visible to each client type)
// ============================================================================

export interface AudienceClientState {
  userId: UserId;
  seatId: SeatId | null;
  faction: FactionId | null;  // null until assignment phase
  showPhase: ShowPhase;
  figTreeResponseSubmitted: boolean;  // Whether user has responded to lobby prompt
  currentRow: {
    index: number;
    phase: RowPhase;
    options: Option[];
    currentAuditionIndex: number | null;
    auditionComplete: boolean;
  } | null;
  myVote: { factionVote: OptionId; personalVote: OptionId } | null;
  coupMeter: number | null; // Only if in coup_window
  canCoup: boolean;
}

export interface ProjectorClientState {
  showPhase: ShowPhase;
  currentRowIndex: number;
  rows: Array<{
    index: number;
    label: string;
    type: RowType;
    options: Option[];
    phase: RowPhase;
    committedOption: OptionId | null;
    currentAuditionIndex: number | null;
    auditionComplete: boolean;
    attempts: number;
  }>;
  paths: DualPaths;           // Faction path (solid) and popular path (ghost)
  factions: Array<{ id: FactionId; name: string; color: string }>;
  lastReveal: RevealPayload | null;
  tiebreaker: {
    active: boolean;
    tiedFactionIds: FactionId[];
  } | null;
  currentFinaleTimeline: FinaleTimeline | null;
  finalePhase: 'popular_song' | 'individual_timelines' | null;
  
}

export interface ControllerClientState {
  showPhase: ShowPhase;
  currentRowIndex: number;
  rows: Row[];
  factions: Faction[];
  paths: DualPaths;
  userCount: number;
  factionCounts: [number, number, number, number];
  config: ShowConfig;
}

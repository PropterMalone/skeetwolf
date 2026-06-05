/** Bluesky DID (decentralized identifier) */
export type Did = string;

/** Bluesky handle (e.g., alice.bsky.social) */
export type Handle = string;

/** Unique game identifier */
export type GameId = string;

// -- Roles --

export type TownRole = 'villager' | 'cop' | 'doctor' | 'vigilante';
export type MafiaRole = 'mafioso' | 'godfather';
export type NeutralRole = 'jester';
export type Role = TownRole | MafiaRole | NeutralRole;
export type Alignment = 'town' | 'mafia' | 'neutral';

export function alignmentOf(role: Role): Alignment {
	if (role === 'jester') return 'neutral';
	const mafiaRoles: Set<string> = new Set(['mafioso', 'godfather']);
	return mafiaRoles.has(role) ? 'mafia' : 'town';
}

// -- Players --

export interface Player {
	did: Did;
	handle: Handle;
	role: Role;
	alive: boolean;
}

// -- Phases --

export type PhaseKind = 'night' | 'day';

export interface Phase {
	kind: PhaseKind;
	number: number; // Night 0, Day 1, Night 1, Day 2, ...
}

// -- Votes --

export interface Vote {
	voter: Did;
	target: Did | null; // null = unvote
	timestamp: number;
}

// -- Night Actions --

export type NightActionKind = 'kill' | 'investigate' | 'protect' | 'vigilante_kill';

export interface NightAction {
	actor: Did;
	kind: NightActionKind;
	target: Did;
}

// -- Game State --

export type GameStatus = 'signup' | 'active' | 'finished';

export type WinCondition = 'town' | 'mafia' | 'jester' | null;

export interface GameConfig {
	/** Minimum players to start */
	minPlayers: number;
	/** Maximum players */
	maxPlayers: number;
	/** Day phase duration in milliseconds */
	dayDurationMs: number;
	/** Night phase duration in milliseconds */
	nightDurationMs: number;
	/** Signup window duration in milliseconds */
	signupDurationMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
	minPlayers: 7,
	maxPlayers: 7,
	dayDurationMs: 24 * 60 * 60 * 1000, // 24 hours
	nightDurationMs: 12 * 60 * 60 * 1000, // 12 hours
	signupDurationMs: 24 * 60 * 60 * 1000, // 24 hours
};

// -- Game Presets --

export type PresetName = 'turbo' | 'standard' | 'marathon';

export const GAME_PRESETS: Record<PresetName, { label: string; config: Partial<GameConfig> }> = {
	turbo: {
		label: 'turbo — 6h days, 3h nights',
		config: {
			dayDurationMs: 6 * 60 * 60 * 1000,
			nightDurationMs: 3 * 60 * 60 * 1000,
		},
	},
	standard: {
		label: 'standard — 24h days, 12h nights',
		config: {},
	},
	marathon: {
		label: 'marathon — 48h days, 24h nights',
		config: {
			dayDurationMs: 48 * 60 * 60 * 1000,
			nightDurationMs: 24 * 60 * 60 * 1000,
		},
	},
};

/** Format milliseconds as a human-readable duration (e.g., "24 hours", "30 minutes") */
export function formatDuration(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
	const hours = Math.round(ms / 3_600_000);
	return `${hours} hour${hours !== 1 ? 's' : ''}`;
}

// -- Public Queue --

export interface QueueEntry {
	did: Did;
	handle: Handle;
	joinedAt: number;
}

export interface PublicQueue {
	entries: QueueEntry[];
}

export interface QueueResult {
	ok: boolean;
	error?: string;
	queue: PublicQueue;
}

// -- Invite Games --

export type InviteStatus = 'pending' | 'active' | 'cancelled';

export interface InviteSlot {
	did: Did;
	handle: Handle;
	confirmed: boolean;
}

export interface InviteGame {
	id: GameId;
	initiatorDid: Did;
	initiatorHandle: Handle;
	slots: InviteSlot[];
	status: InviteStatus;
	createdAt: number;
	config: GameConfig;
}

export interface InviteResult {
	ok: boolean;
	error?: string;
	invite: InviteGame;
}

// -- Game State --

export interface GameState {
	id: GameId;
	config: GameConfig;
	status: GameStatus;
	phase: Phase;
	players: Player[];
	votes: Vote[]; // current day's votes only
	nightActions: NightAction[]; // current night's actions only
	winner: WinCondition;
	/** Post URI of the game announcement (thread root) */
	announcementUri: string | null;
	/** Post CID of the game announcement (needed for reply threading) */
	announcementCid: string | null;
	/** Current day's thread root URI (fresh thread each day) */
	dayThreadUri: string | null;
	/** Current day's thread root CID */
	dayThreadCid: string | null;
	/** Timestamp when the current phase started (for timer-based transitions) */
	phaseStartedAt: number;
	createdAt: number;
	/** DIDs of players whose role DMs failed delivery. Empty = all delivered. */
	pendingDmDids: Did[];
	/** Name of the flavor pack used for this game's text. */
	flavorPackName: string;
	/** Remaining vigilante shots (0 if no vigilante in game) */
	vigilanteShots: number;
}

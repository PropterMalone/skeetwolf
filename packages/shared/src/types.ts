/** Bluesky DID (decentralized identifier) */
export type Did = string;

/** Bluesky handle (e.g., alice.bsky.social) */
export type Handle = string;

/** Unique game identifier */
export type GameId = string;

// -- Roles --

export type TownRole = 'villager' | 'cop' | 'doctor';
export type MafiaRole = 'mafioso' | 'godfather';
export type Role = TownRole | MafiaRole;
export type Alignment = 'town' | 'mafia';

export function alignmentOf(role: Role): Alignment {
	const mafiaRoles: Set<Role> = new Set(['mafioso', 'godfather']);
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

export type NightActionKind = 'kill' | 'investigate' | 'protect';

export interface NightAction {
	actor: Did;
	kind: NightActionKind;
	target: Did;
}

// -- Game State --

export type GameStatus = 'signup' | 'active' | 'finished';

export type WinCondition = 'town' | 'mafia' | null;

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
	minPlayers: 5,
	maxPlayers: 15,
	dayDurationMs: 24 * 60 * 60 * 1000, // 24 hours
	nightDurationMs: 12 * 60 * 60 * 1000, // 12 hours
	signupDurationMs: 24 * 60 * 60 * 1000, // 24 hours
};

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
	/** Timestamp when the current phase started (for timer-based transitions) */
	phaseStartedAt: number;
	createdAt: number;
}

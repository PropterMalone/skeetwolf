/**
 * Pure game logic — no side effects, no I/O.
 * All functions take state in, return new state out.
 */
import type {
	Did,
	GameConfig,
	GameId,
	GameState,
	Handle,
	NightAction,
	Phase,
	Player,
	Role,
	Vote,
	WinCondition,
} from './types.js';
import { DEFAULT_CONFIG, alignmentOf } from './types.js';

// -- Game Creation --

export function createGame(
	id: GameId,
	config: Partial<GameConfig> = {},
	flavorPackName = 'Bluesky Standard',
): GameState {
	const now = Date.now();
	return {
		id,
		config: { ...DEFAULT_CONFIG, ...config },
		status: 'signup',
		phase: { kind: 'night', number: 0 },
		players: [],
		votes: [],
		nightActions: [],
		winner: null,
		announcementUri: null,
		announcementCid: null,
		dayThreadUri: null,
		dayThreadCid: null,
		phaseStartedAt: now,
		createdAt: now,
		pendingDmDids: [],
		flavorPackName,
	};
}

// -- Signup --

export interface SignupResult {
	ok: boolean;
	error?: string;
	state: GameState;
}

export function addPlayer(state: GameState, did: Did, handle: string): SignupResult {
	if (state.status !== 'signup') {
		return { ok: false, error: 'game is not in signup phase', state };
	}
	if (state.players.length >= state.config.maxPlayers) {
		return { ok: false, error: 'game is full', state };
	}
	if (state.players.some((p) => p.did === did)) {
		return { ok: false, error: 'already signed up', state };
	}
	const player: Player = { did, handle, role: 'villager', alive: true };
	return {
		ok: true,
		state: { ...state, players: [...state.players, player] },
	};
}

// -- Role Assignment --

/**
 * Assign roles to players. Mafia count scales with player count.
 * Returns a new state with roles assigned and status set to 'active'.
 *
 * rolePool is optional — if not provided, uses default distribution.
 * shuffleFn is injectable for testing (default: Fisher-Yates).
 */
export function assignRoles(
	state: GameState,
	shuffleFn: <T>(arr: T[]) => T[] = fisherYatesShuffle,
): SignupResult {
	const count = state.players.length;
	if (count < state.config.minPlayers) {
		return { ok: false, error: `need at least ${state.config.minPlayers} players`, state };
	}

	const roles = buildRolePool(count);
	const shuffledRoles = shuffleFn(roles);

	const players = state.players.map((p, i) => {
		const role = shuffledRoles[i];
		if (!role) throw new Error(`role pool shorter than player count at index ${i}`);
		return { ...p, role };
	});

	return {
		ok: true,
		state: {
			...state,
			players,
			status: 'active',
			phase: { kind: 'night', number: 0 },
			phaseStartedAt: Date.now(),
		},
	};
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
	godfather:
		'Godfather — Mafia leader. Appears TOWN to cop investigations. Votes on the mafia kill target.',
	mafioso: 'Mafioso — Mafia member. Votes on the mafia kill target.',
	cop: 'Cop — Town investigator. Investigates one player per night to learn their alignment (town/mafia). Note: the Godfather reads as TOWN.',
	doctor: 'Doctor — Town protector. Chooses one player per night to protect from the mafia kill.',
	villager:
		'Villager — Town citizen. No special ability. Use discussion and voting to find the mafia.',
	jester:
		'Jester — Neutral wildcard. Win by getting yourself eliminated during the day vote. You have no night action. If you die at night, you lose.',
};

/** Describe the role setup for a game — counts + descriptions. For defined-role games
 *  where players know what roles are in the game but not who has them. */
export function describeRoleSetup(playerCount: number): string {
	const roles = buildRolePool(playerCount);
	const counts = new Map<Role, number>();
	for (const role of roles) {
		counts.set(role, (counts.get(role) ?? 0) + 1);
	}

	const lines: string[] = [];
	for (const [role, count] of counts) {
		const prefix = count > 1 ? `${count}x ` : '';
		lines.push(`${prefix}${ROLE_DESCRIPTIONS[role]}`);
	}
	return lines.join('\n');
}

/** Default role distribution: ~1/3 mafia (rounded down), 1 cop, 1 doctor, rest villagers.
 *  Neutral: 1 jester at 8+ players. */
export function buildRolePool(playerCount: number): Role[] {
	const mafiaCount = Math.max(1, Math.floor(playerCount / 3));
	const roles: Role[] = [];

	// Mafia
	roles.push('godfather');
	for (let i = 1; i < mafiaCount; i++) {
		roles.push('mafioso');
	}

	// Town power roles (only if enough players)
	if (playerCount >= 6) roles.push('cop');
	if (playerCount >= 7) roles.push('doctor');

	// Neutral roles
	if (playerCount >= 8) roles.push('jester');

	// Fill rest with villagers
	while (roles.length < playerCount) {
		roles.push('villager');
	}

	return roles;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = result[i];
		result[i] = result[j] as T;
		result[j] = temp as T;
	}
	return result;
}

// -- Voting --

export interface VoteResult {
	ok: boolean;
	error?: string;
	state: GameState;
}

export function castVote(state: GameState, voter: Did, target: Did | null): VoteResult {
	if (state.status !== 'active' || state.phase.kind !== 'day') {
		return { ok: false, error: 'voting only allowed during day phase', state };
	}

	const voterPlayer = state.players.find((p) => p.did === voter);
	if (!voterPlayer || !voterPlayer.alive) {
		return { ok: false, error: 'voter is not an alive player', state };
	}

	if (target !== null) {
		const targetPlayer = state.players.find((p) => p.did === target);
		if (!targetPlayer || !targetPlayer.alive) {
			return { ok: false, error: 'target is not an alive player', state };
		}
	}

	// Replace any existing vote from this voter
	const otherVotes = state.votes.filter((v) => v.voter !== voter);
	const newVote: Vote = { voter, target, timestamp: Date.now() };

	return {
		ok: true,
		state: { ...state, votes: [...otherVotes, newVote] },
	};
}

/** Tally votes and return DID with most votes, or null for no majority */
export function tallyVotes(state: GameState): { target: Did | null; counts: Map<Did, number> } {
	const counts = new Map<Did, number>();
	for (const vote of state.votes) {
		if (vote.target !== null) {
			counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
		}
	}

	const aliveCount = state.players.filter((p) => p.alive).length;
	const majority = Math.floor(aliveCount / 2) + 1;

	let topTarget: Did | null = null;
	let topCount = 0;
	for (const [did, count] of counts) {
		if (count > topCount) {
			topCount = count;
			topTarget = did;
		}
	}

	// Require majority for elimination
	return {
		target: topCount >= majority ? topTarget : null,
		counts,
	};
}

// -- Night Actions --

export interface ActionResult {
	ok: boolean;
	error?: string;
	state: GameState;
}

export function submitNightAction(state: GameState, action: NightAction): ActionResult {
	if (state.status !== 'active' || state.phase.kind !== 'night') {
		return { ok: false, error: 'night actions only allowed at night', state };
	}

	const actor = state.players.find((p) => p.did === action.actor);
	if (!actor || !actor.alive) {
		return { ok: false, error: 'actor is not an alive player', state };
	}

	// No kills on Night 0 — info-gathering only
	if (action.kind === 'kill' && state.phase.number === 0) {
		return { ok: false, error: 'no kills on Night 0', state };
	}

	// Validate action matches role
	if (!canPerformAction(actor.role, action.kind)) {
		return { ok: false, error: `${actor.role} cannot perform ${action.kind}`, state };
	}

	// Doctor cannot protect themselves
	if (action.kind === 'protect' && action.target === action.actor) {
		return { ok: false, error: 'you cannot protect yourself', state };
	}

	// Replace any existing action from this actor
	const otherActions = state.nightActions.filter((a) => a.actor !== action.actor);

	return {
		ok: true,
		state: { ...state, nightActions: [...otherActions, action] },
	};
}

function canPerformAction(role: Role, action: NightAction['kind']): boolean {
	switch (action) {
		case 'kill':
			return alignmentOf(role) === 'mafia';
		case 'investigate':
			return role === 'cop';
		case 'protect':
			return role === 'doctor';
	}
}

// -- Night Resolution --

export interface NightResolution {
	killed: Did | null;
	investigated: { cop: Did; target: Did; result: 'town' | 'mafia' } | null;
	state: GameState;
}

export function resolveNight(state: GameState): NightResolution {
	const killAction = state.nightActions.find((a) => a.kind === 'kill');
	const protectAction = state.nightActions.find((a) => a.kind === 'protect');
	const investigateAction = state.nightActions.find((a) => a.kind === 'investigate');

	let killed: Did | null = null;

	// Resolve kill (blocked by doctor protection)
	if (killAction) {
		const isProtected = protectAction?.target === killAction.target;
		if (!isProtected) {
			killed = killAction.target;
		}
	}

	// Resolve investigation — godfather and jester appear town
	let investigated: NightResolution['investigated'] = null;
	if (investigateAction) {
		const target = state.players.find((p) => p.did === investigateAction.target);
		if (target) {
			const result =
				target.role === 'godfather' || target.role === 'jester' ? 'town' : alignmentOf(target.role);
			investigated = { cop: investigateAction.actor, target: investigateAction.target, result };
		}
	}

	// Apply kill
	const players = killed
		? state.players.map((p) => (p.did === killed ? { ...p, alive: false } : p))
		: state.players;

	return {
		killed,
		investigated,
		state: {
			...state,
			players,
			nightActions: [],
		},
	};
}

// -- Phase Transitions --

/** Check if a day elimination killed the jester (triggers jester win). */
export function isJesterElimination(state: GameState, eliminatedDid: Did): boolean {
	const player = state.players.find((p) => p.did === eliminatedDid);
	return player?.role === 'jester';
}

/** Eliminate a player by vote (day phase). Returns updated state. */
export function eliminatePlayer(state: GameState, target: Did): GameState {
	return {
		...state,
		players: state.players.map((p) => (p.did === target ? { ...p, alive: false } : p)),
		votes: [],
	};
}

export function advancePhase(state: GameState): GameState {
	const next = nextPhase(state.phase);
	return {
		...state,
		phase: next,
		phaseStartedAt: Date.now(),
		votes: [],
		nightActions: [],
	};
}

/** Returns the deadline timestamp for the current phase, or null if not active */
export function getPhaseDeadline(state: GameState): number | null {
	if (state.status !== 'active') return null;
	const duration =
		state.phase.kind === 'day' ? state.config.dayDurationMs : state.config.nightDurationMs;
	return state.phaseStartedAt + duration;
}

/** Check if the current phase has expired */
export function isPhaseExpired(state: GameState, now: number): boolean {
	const deadline = getPhaseDeadline(state);
	return deadline !== null && now >= deadline;
}

function nextPhase(current: Phase): Phase {
	if (current.kind === 'night') {
		return { kind: 'day', number: current.number + 1 };
	}
	return { kind: 'night', number: current.number };
}

// -- Win Condition --

export function checkWinCondition(state: GameState): WinCondition {
	const alive = state.players.filter((p) => p.alive);
	const mafiaAlive = alive.filter((p) => alignmentOf(p.role) === 'mafia').length;
	const townAlive = alive.filter((p) => alignmentOf(p.role) === 'town').length;

	if (mafiaAlive === 0) return 'town';
	if (mafiaAlive >= townAlive) return 'mafia';
	return null;
}

export function applyWinCondition(state: GameState): GameState {
	const winner = checkWinCondition(state);
	if (winner) {
		return { ...state, status: 'finished', winner };
	}
	return state;
}

// -- Player Replacement --

export interface ReplaceResult {
	ok: boolean;
	error?: string;
	state: GameState;
}

/** Swap a player's identity while preserving their role. Only allowed during Night 0. */
export function replacePlayer(
	state: GameState,
	oldDid: Did,
	newDid: Did,
	newHandle: Handle,
): ReplaceResult {
	if (state.phase.kind !== 'night' || state.phase.number !== 0) {
		return { ok: false, error: 'replacement only allowed during Night 0', state };
	}
	const idx = state.players.findIndex((p) => p.did === oldDid);
	if (idx === -1) {
		return { ok: false, error: 'player not found', state };
	}
	if (state.players.some((p) => p.did === newDid)) {
		return { ok: false, error: 'replacement player already in game', state };
	}
	const old = state.players[idx] as Player;
	const updated = { ...old, did: newDid, handle: newHandle };
	const players = [...state.players];
	players[idx] = updated;
	return { ok: true, state: { ...state, players } };
}

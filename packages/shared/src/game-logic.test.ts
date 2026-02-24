import { describe, expect, it } from 'vitest';
import {
	addPlayer,
	advancePhase,
	assignRoles,
	buildRolePool,
	castVote,
	checkWinCondition,
	createGame,
	eliminatePlayer,
	getPhaseDeadline,
	isJesterElimination,
	isPhaseExpired,
	replacePlayer,
	resolveNight,
	submitNightAction,
	tallyVotes,
} from './game-logic.js';
import { type GameState, alignmentOf } from './types.js';

function gameWithPlayers(count: number): GameState {
	let state = createGame('test-1', { minPlayers: count, maxPlayers: count });
	for (let i = 0; i < count; i++) {
		const result = addPlayer(state, `did:plc:player${i}`, `player${i}.bsky.social`);
		state = result.state;
	}
	return state;
}

/** Deterministic "shuffle" that returns the array as-is */
function noShuffle<T>(arr: T[]): T[] {
	return [...arr];
}

describe('createGame', () => {
	it('creates a game in signup phase', () => {
		const game = createGame('abc');
		expect(game.id).toBe('abc');
		expect(game.status).toBe('signup');
		expect(game.players).toHaveLength(0);
		expect(game.phase).toEqual({ kind: 'night', number: 0 });
	});
});

describe('addPlayer', () => {
	it('adds a player during signup', () => {
		const game = createGame('test');
		const result = addPlayer(game, 'did:plc:alice', 'alice.bsky.social');
		expect(result.ok).toBe(true);
		expect(result.state.players).toHaveLength(1);
		expect(result.state.players[0]?.handle).toBe('alice.bsky.social');
	});

	it('rejects duplicate signups', () => {
		const game = createGame('test');
		const r1 = addPlayer(game, 'did:plc:alice', 'alice.bsky.social');
		const r2 = addPlayer(r1.state, 'did:plc:alice', 'alice.bsky.social');
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('already signed up');
	});

	it('rejects signups when game is full', () => {
		let state = createGame('test', { maxPlayers: 2 });
		state = addPlayer(state, 'did:plc:a', 'a').state;
		state = addPlayer(state, 'did:plc:b', 'b').state;
		const result = addPlayer(state, 'did:plc:c', 'c');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('game is full');
	});
});

describe('assignRoles', () => {
	it('assigns roles and transitions to active', () => {
		const state = gameWithPlayers(7);
		const result = assignRoles(state, noShuffle);
		expect(result.ok).toBe(true);
		expect(result.state.status).toBe('active');

		const roles = result.state.players.map((p) => p.role);
		// 7 players with noShuffle: godfather, mafioso, cop, doctor, villager, villager, villager
		expect(roles).toEqual([
			'godfather',
			'mafioso',
			'cop',
			'doctor',
			'villager',
			'villager',
			'villager',
		]);
	});

	it('rejects with too few players', () => {
		// Use default config (minPlayers=7) with only 3 players
		let state = createGame('test-1');
		for (let i = 0; i < 3; i++) {
			const r = addPlayer(state, `did:plc:player${i}`, `player${i}.bsky.social`);
			state = r.state;
		}
		const result = assignRoles(state);
		expect(result.ok).toBe(false);
		expect(result.error).toContain('at least');
	});

	it('assigns 2 mafia for 7 players', () => {
		const state = gameWithPlayers(7);
		const result = assignRoles(state, noShuffle);
		const mafiaCount = result.state.players.filter((p) => alignmentOf(p.role) === 'mafia').length;
		expect(mafiaCount).toBe(2);
	});
});

describe('voting', () => {
	function dayGameWith7(): GameState {
		const state = gameWithPlayers(7);
		const result = assignRoles(state, noShuffle);
		return advancePhase(result.state); // Night 0 → Day 1
	}

	it('allows alive players to vote', () => {
		const state = dayGameWith7();
		const result = castVote(state, 'did:plc:player0', 'did:plc:player1');
		expect(result.ok).toBe(true);
		expect(result.state.votes).toHaveLength(1);
	});

	it('rejects votes during night', () => {
		const state = gameWithPlayers(7);
		const active = assignRoles(state, noShuffle).state; // still Night 0
		const result = castVote(active, 'did:plc:player0', 'did:plc:player1');
		expect(result.ok).toBe(false);
	});

	it('replaces existing vote from same voter', () => {
		let state = dayGameWith7();
		state = castVote(state, 'did:plc:player0', 'did:plc:player1').state;
		state = castVote(state, 'did:plc:player0', 'did:plc:player2').state;
		expect(state.votes).toHaveLength(1);
		expect(state.votes[0]?.target).toBe('did:plc:player2');
	});

	it('tallies majority correctly', () => {
		let state = dayGameWith7();
		// 7 alive, majority = 4
		state = castVote(state, 'did:plc:player0', 'did:plc:player5').state;
		state = castVote(state, 'did:plc:player1', 'did:plc:player5').state;
		state = castVote(state, 'did:plc:player2', 'did:plc:player5').state;

		let tally = tallyVotes(state);
		expect(tally.target).toBeNull(); // only 3 votes, need 4

		state = castVote(state, 'did:plc:player3', 'did:plc:player5').state;
		tally = tallyVotes(state);
		expect(tally.target).toBe('did:plc:player5');
	});
});

describe('night actions', () => {
	// Roles with noShuffle: godfather(0), mafioso(1), cop(2), doctor(3), villager(4,5,6)
	function night0Game(): GameState {
		const state = gameWithPlayers(7);
		return assignRoles(state, noShuffle).state; // Night 0, active
	}

	/** Night 1 game — advance past Night 0 and Day 1 so kills are allowed */
	function nightGame(): GameState {
		let state = night0Game();
		state = advancePhase(state); // Night 0 → Day 1
		state = advancePhase(state); // Day 1 → Night 1
		return state;
	}

	it('rejects kill on Night 0', () => {
		const state = night0Game();
		const result = submitNightAction(state, {
			actor: 'did:plc:player0', // godfather
			kind: 'kill',
			target: 'did:plc:player4',
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('Night 0');
	});

	it('allows cop investigate on Night 0', () => {
		const state = night0Game();
		const result = submitNightAction(state, {
			actor: 'did:plc:player2', // cop
			kind: 'investigate',
			target: 'did:plc:player0',
		});
		expect(result.ok).toBe(true);
	});

	it('allows doctor protect on Night 0', () => {
		const state = night0Game();
		const result = submitNightAction(state, {
			actor: 'did:plc:player3', // doctor
			kind: 'protect',
			target: 'did:plc:player4',
		});
		expect(result.ok).toBe(true);
	});

	it('allows mafia to submit kill', () => {
		const state = nightGame();
		const result = submitNightAction(state, {
			actor: 'did:plc:player0', // godfather
			kind: 'kill',
			target: 'did:plc:player4',
		});
		expect(result.ok).toBe(true);
	});

	it('rejects cop trying to kill', () => {
		const state = nightGame();
		const result = submitNightAction(state, {
			actor: 'did:plc:player2', // cop
			kind: 'kill',
			target: 'did:plc:player4',
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('cannot perform');
	});

	it('resolves kill when unprotected', () => {
		let state = nightGame();
		state = submitNightAction(state, {
			actor: 'did:plc:player0',
			kind: 'kill',
			target: 'did:plc:player4',
		}).state;

		const resolution = resolveNight(state);
		expect(resolution.killed).toBe('did:plc:player4');
		expect(resolution.state.players.find((p) => p.did === 'did:plc:player4')?.alive).toBe(false);
	});

	it('doctor blocks the kill', () => {
		let state = nightGame();
		state = submitNightAction(state, {
			actor: 'did:plc:player0',
			kind: 'kill',
			target: 'did:plc:player4',
		}).state;
		state = submitNightAction(state, {
			actor: 'did:plc:player3', // doctor
			kind: 'protect',
			target: 'did:plc:player4',
		}).state;

		const resolution = resolveNight(state);
		expect(resolution.killed).toBeNull();
		expect(resolution.state.players.find((p) => p.did === 'did:plc:player4')?.alive).toBe(true);
	});

	it('rejects doctor self-protection', () => {
		const state = nightGame();
		const result = submitNightAction(state, {
			actor: 'did:plc:player3', // doctor
			kind: 'protect',
			target: 'did:plc:player3', // self
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('cannot protect yourself');
	});

	it('godfather appears town to cop', () => {
		let state = nightGame();
		state = submitNightAction(state, {
			actor: 'did:plc:player2', // cop
			kind: 'investigate',
			target: 'did:plc:player0', // godfather
		}).state;

		const resolution = resolveNight(state);
		expect(resolution.investigated?.result).toBe('town');
	});

	it('mafioso appears mafia to cop', () => {
		let state = nightGame();
		state = submitNightAction(state, {
			actor: 'did:plc:player2', // cop
			kind: 'investigate',
			target: 'did:plc:player1', // mafioso
		}).state;

		const resolution = resolveNight(state);
		expect(resolution.investigated?.result).toBe('mafia');
	});
});

describe('win conditions', () => {
	it('town wins when all mafia dead', () => {
		const state = gameWithPlayers(7);
		const game = assignRoles(state, noShuffle).state;
		// Kill both mafia: godfather (player0) and mafioso (player1)
		let afterKill = eliminatePlayer(game, 'did:plc:player0');
		afterKill = eliminatePlayer(afterKill, 'did:plc:player1');
		expect(checkWinCondition(afterKill)).toBe('town');
	});

	it('mafia wins when they equal town', () => {
		const state = gameWithPlayers(7);
		const game = assignRoles(state, noShuffle).state;
		// 7 players with noShuffle: godfather(0), mafioso(1), cop(2), doctor(3), villager(4,5,6)
		// Kill 3 townies → 2 mafia, 2 town → mafia wins
		let g = eliminatePlayer(game, 'did:plc:player2');
		g = eliminatePlayer(g, 'did:plc:player3');
		g = eliminatePlayer(g, 'did:plc:player4');
		expect(checkWinCondition(g)).toBe('mafia');
	});

	it('returns null when game is still going', () => {
		const state = gameWithPlayers(7);
		const game = assignRoles(state, noShuffle).state;
		expect(checkWinCondition(game)).toBeNull();
	});
});

describe('phase transitions', () => {
	it('advances night → day', () => {
		const state = createGame('test');
		const advanced = advancePhase(state); // Night 0 → Day 1
		expect(advanced.phase).toEqual({ kind: 'day', number: 1 });
	});

	it('advances day → night', () => {
		const state = createGame('test');
		const day = advancePhase(state); // Night 0 → Day 1
		const night = advancePhase(day); // Day 1 → Night 1
		expect(night.phase).toEqual({ kind: 'night', number: 1 });
	});

	it('clears votes and actions on phase change', () => {
		let state = gameWithPlayers(7);
		state = assignRoles(state, noShuffle).state;
		// Use investigate (allowed on Night 0) to test action clearing
		state = submitNightAction(state, {
			actor: 'did:plc:player2', // cop
			kind: 'investigate',
			target: 'did:plc:player0',
		}).state;
		expect(state.nightActions).toHaveLength(1);

		const advanced = advancePhase(state);
		expect(advanced.nightActions).toHaveLength(0);
		expect(advanced.votes).toHaveLength(0);
	});

	it('sets phaseStartedAt on advance', () => {
		const state = createGame('test');
		const before = Date.now();
		const advanced = advancePhase(state);
		expect(advanced.phaseStartedAt).toBeGreaterThanOrEqual(before);
	});
});

describe('phase timers', () => {
	it('returns deadline based on phase duration', () => {
		let state = gameWithPlayers(7);
		state = assignRoles(state, noShuffle).state;
		// Night phase — deadline = phaseStartedAt + nightDurationMs
		const deadline = getPhaseDeadline(state);
		expect(deadline).toBe(state.phaseStartedAt + state.config.nightDurationMs);
	});

	it('returns null for non-active games', () => {
		const state = createGame('test'); // signup phase
		expect(getPhaseDeadline(state)).toBeNull();
	});

	it('detects expired phase', () => {
		let state = gameWithPlayers(7);
		state = assignRoles(state, noShuffle).state;
		// Force phaseStartedAt to the past
		state = { ...state, phaseStartedAt: Date.now() - state.config.nightDurationMs - 1 };
		expect(isPhaseExpired(state, Date.now())).toBe(true);
	});

	it('does not expire before deadline', () => {
		let state = gameWithPlayers(7);
		state = assignRoles(state, noShuffle).state;
		// Just started
		expect(isPhaseExpired(state, Date.now())).toBe(false);
	});

	it('uses day duration for day phase', () => {
		let state = gameWithPlayers(7);
		state = assignRoles(state, noShuffle).state;
		state = advancePhase(state); // Night 0 → Day 1
		const deadline = getPhaseDeadline(state);
		expect(deadline).toBe(state.phaseStartedAt + state.config.dayDurationMs);
	});
});

describe('replacePlayer', () => {
	function night0Game(): GameState {
		const state = gameWithPlayers(7);
		return assignRoles(state, noShuffle).state; // Night 0, active
	}

	it('swaps player identity while preserving role', () => {
		const state = night0Game();
		const oldPlayer = state.players[0]; // godfather
		if (!oldPlayer) throw new Error('expected player');
		const result = replacePlayer(state, oldPlayer.did, 'did:plc:newguy', 'newguy.bsky.social');
		expect(result.ok).toBe(true);
		const replaced = result.state.players[0];
		if (!replaced) throw new Error('expected replaced player');
		expect(replaced.did).toBe('did:plc:newguy');
		expect(replaced.handle).toBe('newguy.bsky.social');
		expect(replaced.role).toBe(oldPlayer.role);
		expect(replaced.alive).toBe(true);
	});

	it('rejects replacement outside Night 0', () => {
		let state = night0Game();
		state = advancePhase(state); // Day 1
		const result = replacePlayer(state, 'did:plc:player0', 'did:plc:new', 'new');
		expect(result.ok).toBe(false);
		expect(result.error).toContain('Night 0');
	});

	it('rejects if old player not found', () => {
		const state = night0Game();
		const result = replacePlayer(state, 'did:plc:nobody', 'did:plc:new', 'new');
		expect(result.ok).toBe(false);
		expect(result.error).toContain('not found');
	});

	it('rejects if new player already in game', () => {
		const state = night0Game();
		const result = replacePlayer(state, 'did:plc:player0', 'did:plc:player1', 'player1');
		expect(result.ok).toBe(false);
		expect(result.error).toContain('already in game');
	});
});

describe('jester role', () => {
	it('buildRolePool includes jester at 8+ players', () => {
		const roles8 = buildRolePool(8);
		expect(roles8).toContain('jester');
	});

	it('buildRolePool does not include jester at 7 players', () => {
		const roles7 = buildRolePool(7);
		expect(roles7).not.toContain('jester');
	});

	it('jester is excluded from win condition math', () => {
		// 8 players with noShuffle: godfather, mafioso, cop, doctor, jester, villager, villager, villager
		const state = gameWithPlayers(8);
		const game = assignRoles(state, noShuffle).state;

		// Kill all town: cop(2), doctor(3), villager(5,6,7) → 2 mafia + 1 jester alive → mafia wins
		let g = eliminatePlayer(game, 'did:plc:player2');
		g = eliminatePlayer(g, 'did:plc:player3');
		g = eliminatePlayer(g, 'did:plc:player5');
		g = eliminatePlayer(g, 'did:plc:player6');
		g = eliminatePlayer(g, 'did:plc:player7');
		expect(checkWinCondition(g)).toBe('mafia');
	});

	it('cop investigating jester reads as town', () => {
		const state = gameWithPlayers(8);
		let game = assignRoles(state, noShuffle).state;
		// noShuffle 8p: godfather(0), mafioso(1), cop(2), doctor(3), jester(4), villager(5,6,7)
		game = advancePhase(game); // Night 0 → Day 1
		game = advancePhase(game); // Day 1 → Night 1

		game = submitNightAction(game, {
			actor: 'did:plc:player2', // cop
			kind: 'investigate',
			target: 'did:plc:player4', // jester
		}).state;

		const resolution = resolveNight(game);
		expect(resolution.investigated?.result).toBe('town');
	});

	it('isJesterElimination returns true for jester', () => {
		const state = gameWithPlayers(8);
		const game = assignRoles(state, noShuffle).state;
		// player4 is jester with noShuffle at 8 players
		expect(isJesterElimination(game, 'did:plc:player4')).toBe(true);
	});

	it('isJesterElimination returns false for non-jester', () => {
		const state = gameWithPlayers(8);
		const game = assignRoles(state, noShuffle).state;
		expect(isJesterElimination(game, 'did:plc:player0')).toBe(false);
	});
});

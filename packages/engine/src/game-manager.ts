/**
 * Manages the lifecycle of active games.
 * Bridges pure game logic (shared) with I/O (bot, db).
 */
import type { AtpAgent } from '@atproto/api';
import {
	type GameId,
	type GameState,
	type NightAction,
	addPlayer,
	advancePhase,
	alignmentOf,
	applyWinCondition,
	assignRoles,
	castVote,
	createGame,
	eliminatePlayer,
	resolveNight,
	submitNightAction,
	tallyVotes,
} from '@skeetwolf/shared';
import type Database from 'better-sqlite3';
import { type DmSender, postMessage } from './bot.js';
import { loadActiveGames, saveGame } from './db.js';

export class GameManager {
	private games = new Map<GameId, GameState>();

	constructor(
		private db: Database.Database,
		private agent: AtpAgent,
		private dm: DmSender,
	) {}

	/** Load all active games from the database into memory */
	hydrate(): void {
		const active = loadActiveGames(this.db);
		for (const game of active) {
			this.games.set(game.id, game);
		}
		console.log(`Hydrated ${active.length} active game(s)`);
	}

	/** Create a new game and announce it */
	async newGame(id: GameId): Promise<GameState> {
		const state = createGame(id);
		this.persist(state);

		const uri = await postMessage(
			this.agent,
			`🐺 Skeetwolf Game #${id} — signup is open!\n\nReply to join. Game starts when we have ${state.config.minPlayers}+ players.`,
		);
		const withUri: GameState = { ...state, announcementUri: uri };
		this.persist(withUri);

		return withUri;
	}

	/** Register a player for a game */
	signup(gameId: GameId, did: string, handle: string): string | null {
		const state = this.games.get(gameId);
		if (!state) return 'game not found';

		const result = addPlayer(state, did, handle);
		if (!result.ok) return result.error ?? 'signup failed';

		this.persist(result.state);
		return null;
	}

	/** Start a game — assign roles, DM them, transition to Night 0 */
	async startGame(gameId: GameId): Promise<string | null> {
		const state = this.games.get(gameId);
		if (!state) return 'game not found';

		const result = assignRoles(state);
		if (!result.ok) return result.error ?? 'cannot start';

		const game = result.state;
		this.persist(game);

		// DM roles to all players
		for (const player of game.players) {
			const alignment = alignmentOf(player.role);
			const teammates =
				alignment === 'mafia'
					? game.players
							.filter((p) => alignmentOf(p.role) === 'mafia' && p.did !== player.did)
							.map((p) => `@${p.handle}`)
							.join(', ')
					: null;

			let message = `🐺 Skeetwolf Game #${gameId}\n\nYour role: ${player.role.toUpperCase()}`;
			if (teammates) {
				message += `\nYour mafia teammates: ${teammates}`;
			}
			if (player.role === 'cop') {
				message += '\nEach night, DM me a handle to investigate.';
			}
			if (player.role === 'doctor') {
				message += '\nEach night, DM me a handle to protect.';
			}

			await this.dm.sendDm(player.did, message);
		}

		// Create mafia group DM
		const mafiaPlayers = game.players.filter((p) => alignmentOf(p.role) === 'mafia');
		if (mafiaPlayers.length > 1) {
			await this.dm.createGroupDm(
				mafiaPlayers.map((p) => p.did),
				`Mafia chat for Game #${gameId}. Coordinate your night kill here.`,
			);
		}

		await postMessage(
			this.agent,
			`Game #${gameId} has begun! ${game.players.length} players. Night 0 — roles have been sent via DM. Night ends in ${game.config.nightDurationMs / 3600000}h.`,
		);

		return null;
	}

	/** Process a vote during day phase */
	vote(gameId: GameId, voterDid: string, targetDid: string | null): string | null {
		const state = this.games.get(gameId);
		if (!state) return 'game not found';

		const result = castVote(state, voterDid, targetDid);
		if (!result.ok) return result.error ?? 'vote failed';

		this.persist(result.state);
		return null;
	}

	/** Process a night action */
	nightAction(gameId: GameId, action: NightAction): string | null {
		const state = this.games.get(gameId);
		if (!state) return 'game not found';

		const result = submitNightAction(state, action);
		if (!result.ok) return result.error ?? 'action failed';

		this.persist(result.state);
		return null;
	}

	/** End the day phase — tally votes, eliminate, check win, advance */
	async endDay(gameId: GameId): Promise<void> {
		let state = this.games.get(gameId);
		if (!state) return;

		const { target, counts } = tallyVotes(state);

		// Announce vote results
		const countStr = [...counts.entries()]
			.map(([did, n]) => {
				const p = state.players.find((pl) => pl.did === did);
				return `${p?.handle ?? did}: ${n}`;
			})
			.join(', ');

		if (target) {
			const eliminated = state.players.find((p) => p.did === target);
			state = eliminatePlayer(state, target);
			state = applyWinCondition(state);

			const role = eliminated?.role;
			const alignment = role ? alignmentOf(role) : 'unknown';
			await postMessage(
				this.agent,
				`Day ${state.phase.number} results — votes: ${countStr}\n\n@${eliminated?.handle} has been eliminated. They were ${(role ?? 'unknown').toUpperCase()} (${alignment}).`,
			);
		} else {
			await postMessage(
				this.agent,
				`Day ${state.phase.number} results — no majority reached. Votes: ${countStr}\n\nNo one is eliminated.`,
			);
		}

		if (state.winner) {
			await this.announceWinner(state);
		} else {
			state = advancePhase(state);
			await postMessage(
				this.agent,
				`Night ${state.phase.number} begins. Power roles: send your actions via DM. Night ends in ${state.config.nightDurationMs / 3600000}h.`,
			);
		}

		this.persist(state);
	}

	/** End the night phase — resolve actions, announce, advance */
	async endNight(gameId: GameId): Promise<void> {
		let state = this.games.get(gameId);
		if (!state) return;

		const resolution = resolveNight(state);
		state = resolution.state;

		// DM cop result
		if (resolution.investigated) {
			await this.dm.sendDm(
				resolution.investigated.cop,
				`Investigation result: @${state.players.find((p) => p.did === resolution.investigated?.target)?.handle} is ${resolution.investigated.result.toUpperCase()}.`,
			);
		}

		// Announce night result
		if (resolution.killed) {
			const victim = state.players.find((p) => p.did === resolution.killed);
			state = applyWinCondition(state);
			await postMessage(
				this.agent,
				`Dawn breaks. @${victim?.handle} was found dead. They were ${victim?.role.toUpperCase()} (${victim ? alignmentOf(victim.role) : 'unknown'}).`,
			);
		} else {
			await postMessage(this.agent, 'Dawn breaks. No one died in the night.');
		}

		if (state.winner) {
			await this.announceWinner(state);
		} else {
			state = advancePhase(state);
			await postMessage(
				this.agent,
				`Day ${state.phase.number} begins. Discuss and vote! Day ends in ${state.config.dayDurationMs / 3600000}h.`,
			);
		}

		this.persist(state);
	}

	/** Check if any game phases need transitioning based on timers */
	getGamesNeedingTransition(_now: number): { gameId: GameId; kind: 'day' | 'night' }[] {
		const result: { gameId: GameId; kind: 'day' | 'night' }[] = [];
		// TODO: track phase start times to compare against durations
		// For now, phase transitions are triggered manually or by the scheduler
		return result;
	}

	private async announceWinner(state: GameState): Promise<void> {
		const winners = state.players
			.filter((p) => alignmentOf(p.role) === state.winner)
			.map((p) => `@${p.handle}`)
			.join(', ');
		await postMessage(
			this.agent,
			`🏆 Game #${state.id} is over! ${state.winner?.toUpperCase()} wins!\n\nWinners: ${winners}\n\nRoles: ${state.players.map((p) => `@${p.handle} (${p.role})`).join(', ')}`,
		);
	}

	private persist(state: GameState): void {
		this.games.set(state.id, state);
		saveGame(this.db, state);
	}
}

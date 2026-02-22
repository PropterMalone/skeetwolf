/**
 * Manages the lifecycle of active games.
 * Bridges pure game logic (shared) with I/O (bot, db).
 */
import type { AtpAgent } from '@atproto/api';
import {
	type Did,
	type GameId,
	type GameState,
	type NightAction,
	type NightActionKind,
	addPlayer,
	advancePhase,
	alignmentOf,
	applyWinCondition,
	assignRoles,
	castVote,
	createGame,
	eliminatePlayer,
	isPhaseExpired,
	resolveNight,
	submitNightAction,
	tallyVotes,
} from '@skeetwolf/shared';
import type Database from 'better-sqlite3';
import { type DmSender, postMessage, replyToPost } from './bot.js';
import { type PostKind, loadActiveGames, recordGamePost, saveGame } from './db.js';

const POST_KIND_LABELS: Record<PostKind, string[]> = {
	announcement: ['skeetwolf', 'game-announcement'],
	phase: ['skeetwolf', 'game-phase'],
	death: ['skeetwolf', 'game-death'],
	vote_result: ['skeetwolf', 'game-vote'],
	game_over: ['skeetwolf', 'game-over'],
	reply: ['skeetwolf', 'game-reply'],
	player: ['skeetwolf'],
};

export class GameManager {
	private games = new Map<GameId, GameState>();
	/** Maps relay group ID → member DIDs (mirrors what DmSender tracks internally) */
	private mafiaRelayIds = new Map<GameId, string>();

	constructor(
		private db: Database.Database,
		private agent: AtpAgent,
		private dm: DmSender,
	) {}

	/** Get a game's current state (or null if not loaded) */
	getGame(gameId: GameId): GameState | null {
		return this.games.get(gameId) ?? null;
	}

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

		const { uri, cid } = await this.post(
			id,
			`🐺 Skeetwolf Game #${id} — signup is open!\n\nReply to join. Game starts when we have ${state.config.minPlayers}+ players.`,
			'announcement',
		);
		const withUri: GameState = { ...state, announcementUri: uri, announcementCid: cid };
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

		// Set up mafia relay group (bot-relayed 1:1 DMs since Bluesky lacks group DMs)
		const mafiaPlayers = game.players.filter((p) => alignmentOf(p.role) === 'mafia');
		if (mafiaPlayers.length > 1) {
			const relayId = `mafia-${gameId}`;
			this.mafiaRelayIds.set(gameId, relayId);
			this.dm.createRelayGroup(
				relayId,
				mafiaPlayers.map((p) => p.did),
			);
			await this.dm.sendToRelayGroup(
				relayId,
				`Mafia chat for Game #${gameId}. DM me to coordinate — I'll relay to your teammates.`,
			);
		}

		await this.post(
			gameId,
			`Game #${gameId} has begun! ${game.players.length} players. Night 0 — roles have been sent via DM. Night ends in ${game.config.nightDurationMs / 3600000}h.`,
			'phase',
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

	/** Cast a vote and check if majority was reached — triggers endDay if so */
	async voteAndCheckMajority(
		gameId: GameId,
		voterDid: string,
		targetDid: string,
	): Promise<{ error: string | null; majorityReached: boolean }> {
		const error = this.vote(gameId, voterDid, targetDid);
		if (error) return { error, majorityReached: false };

		const state = this.games.get(gameId);
		if (!state) return { error: null, majorityReached: false };

		const { target } = tallyVotes(state);
		if (target) {
			await this.endDay(gameId);
			return { error: null, majorityReached: true };
		}
		return { error: null, majorityReached: false };
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
		const currentState = state;
		const countStr = [...counts.entries()]
			.map(([did, n]) => {
				const p = currentState.players.find((pl) => pl.did === did);
				return `${p?.handle ?? did}: ${n}`;
			})
			.join(', ');

		if (target) {
			const eliminated = state.players.find((p) => p.did === target);
			state = eliminatePlayer(state, target);
			state = applyWinCondition(state);

			const role = eliminated?.role;
			const alignment = role ? alignmentOf(role) : 'unknown';
			await this.post(
				gameId,
				`Day ${state.phase.number} results — votes: ${countStr}\n\n@${eliminated?.handle} has been eliminated. They were ${(role ?? 'unknown').toUpperCase()} (${alignment}).`,
				'death',
			);
		} else {
			await this.post(
				gameId,
				`Day ${state.phase.number} results — no majority reached. Votes: ${countStr}\n\nNo one is eliminated.`,
				'vote_result',
			);
		}

		if (state.winner) {
			await this.announceWinner(state);
		} else {
			state = advancePhase(state);
			await this.post(
				gameId,
				`Night ${state.phase.number} begins. Power roles: send your actions via DM. Night ends in ${state.config.nightDurationMs / 3600000}h.`,
				'phase',
			);
		}

		this.persist(state);
		this.cleanupFinishedGame(state);
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
			await this.post(
				gameId,
				`Dawn breaks. @${victim?.handle} was found dead. They were ${victim?.role.toUpperCase()} (${victim ? alignmentOf(victim.role) : 'unknown'}).`,
				'death',
			);
		} else {
			await this.post(gameId, 'Dawn breaks. No one died in the night.', 'phase');
		}

		if (state.winner) {
			await this.announceWinner(state);
		} else {
			state = advancePhase(state);
			await this.post(
				gameId,
				`Day ${state.phase.number} begins. Discuss and vote! Day ends in ${state.config.dayDurationMs / 3600000}h.`,
				'phase',
			);
		}

		this.persist(state);
		this.cleanupFinishedGame(state);
	}

	/** Find the active game a player is in. Returns null if not in any game. */
	findGameForPlayer(did: Did): GameState | null {
		for (const state of this.games.values()) {
			if (state.status !== 'active') continue;
			if (state.players.some((p) => p.did === did && p.alive)) {
				return state;
			}
		}
		return null;
	}

	/** Resolve a handle to a DID using the game's player list (no API call needed) */
	resolveHandleInGame(gameId: GameId, handle: string): Did | null {
		const state = this.games.get(gameId);
		if (!state) return null;
		// Match handle with or without .bsky.social suffix
		const normalized = handle.toLowerCase();
		const player = state.players.find(
			(p) =>
				p.handle.toLowerCase() === normalized ||
				p.handle.toLowerCase() === `${normalized}.bsky.social`,
		);
		return player?.did ?? null;
	}

	/** Submit a night action by handle (resolves handle → DID internally) */
	nightActionByHandle(
		gameId: GameId,
		actorDid: Did,
		kind: NightActionKind,
		targetHandle: string,
	): string | null {
		const targetDid = this.resolveHandleInGame(gameId, targetHandle);
		if (!targetDid) return `player "${targetHandle}" not found in this game`;
		return this.nightAction(gameId, { actor: actorDid, kind, target: targetDid });
	}

	/** Forward a mafia chat message to the relay group for the player's game */
	async relayMafiaChat(senderDid: Did, text: string): Promise<string | null> {
		const game = this.findGameForPlayer(senderDid);
		if (!game) return 'not in an active game';

		const sender = game.players.find((p) => p.did === senderDid);
		if (!sender || alignmentOf(sender.role) !== 'mafia') return 'not a mafia member';

		const relayId = this.mafiaRelayIds.get(game.id);
		if (!relayId) return 'no mafia relay group for this game';

		const senderLabel = `@${sender.handle}`;
		await this.dm.sendToRelayGroup(relayId, `${senderLabel}: ${text}`);
		return null;
	}

	/** Check which active games have expired phases that need transitioning */
	getGamesNeedingTransition(now: number): { gameId: GameId; phaseKind: 'day' | 'night' }[] {
		const result: { gameId: GameId; phaseKind: 'day' | 'night' }[] = [];
		for (const [id, state] of this.games) {
			if (state.status === 'active' && isPhaseExpired(state, now)) {
				result.push({ gameId: id, phaseKind: state.phase.kind });
			}
		}
		return result;
	}

	/** Run scheduled phase transitions for all expired games */
	async tick(now: number): Promise<void> {
		const expired = this.getGamesNeedingTransition(now);
		for (const { gameId, phaseKind } of expired) {
			console.log(`Phase expired for game ${gameId} (${phaseKind})`);
			if (phaseKind === 'day') {
				await this.endDay(gameId);
			} else {
				await this.endNight(gameId);
			}
		}
	}

	private async announceWinner(state: GameState): Promise<void> {
		const winners = state.players
			.filter((p) => alignmentOf(p.role) === state.winner)
			.map((p) => `@${p.handle}`)
			.join(', ');
		await this.post(
			state.id,
			`🏆 Game #${state.id} is over! ${state.winner?.toUpperCase()} wins!\n\nWinners: ${winners}\n\nRoles: ${state.players.map((p) => `@${p.handle} (${p.role})`).join(', ')}`,
			'game_over',
		);
	}

	/** Remove a finished game from in-memory state (already persisted to DB) */
	private cleanupFinishedGame(state: GameState): void {
		if (state.winner) {
			this.games.delete(state.id);
			this.mafiaRelayIds.delete(state.id);
		}
	}

	/** Post a message and record it in game_posts for the feed generator */
	private async post(
		gameId: GameId,
		text: string,
		kind: PostKind,
	): Promise<{ uri: string; cid: string }> {
		const { uri, cid } = await postMessage(this.agent, text, POST_KIND_LABELS[kind]);
		const botDid = this.agent.session?.did ?? 'unknown';
		const state = this.games.get(gameId);
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid: botDid, kind, phase });
		return { uri, cid };
	}

	/** Reply to a mention and record the reply in game_posts.
	 * Threads under the game announcement (root) when available,
	 * with the triggering mention as the parent. */
	async reply(gameId: GameId, text: string, parentUri: string, parentCid: string): Promise<void> {
		const state = this.games.get(gameId);
		const rootUri = state?.announcementUri ?? parentUri;
		const rootCid = state?.announcementCid ?? parentCid;

		const replyLabels = POST_KIND_LABELS.reply;
		const { uri } = await replyToPost(
			this.agent,
			text,
			parentUri,
			parentCid,
			rootUri,
			rootCid,
			replyLabels,
		);
		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid: botDid, kind: 'reply', phase });
	}

	/** Record a player's post (mention/reply) as part of a game */
	recordPlayerPost(gameId: GameId, uri: string, authorDid: string): void {
		const state = this.games.get(gameId);
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid, kind: 'player', phase });
	}

	private persist(state: GameState): void {
		this.games.set(state.id, state);
		saveGame(this.db, state);
	}
}

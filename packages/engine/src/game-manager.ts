/**
 * Manages the lifecycle of active games.
 * Bridges pure game logic (shared) with I/O (bot, db).
 */
import type { AtpAgent } from '@atproto/api';
import {
	DEFAULT_CONFIG,
	DEFAULT_FLAVOR,
	type Did,
	type GameId,
	type GameState,
	type Handle,
	type InviteGame,
	type NightAction,
	type NightActionKind,
	type PublicQueue,
	type Role,
	addInviteSlot,
	addPlayer,
	addToQueue,
	advancePhase,
	alignmentOf,
	applyWinCondition,
	assignRoles,
	canPopQueue,
	cancelInvite,
	castVote,
	confirmInvite,
	createGame,
	createInviteGame,
	createQueue,
	eliminatePlayer,
	flavor,
	formatDuration,
	inviteGameToPlayers,
	isInviteReady,
	isPhaseExpired,
	popQueue,
	removeFromQueue,
	resolveNight,
	submitNightAction,
	tallyVotes,
} from '@skeetwolf/shared';
import type { LabelerServer } from '@skyware/labeler';
import type Database from 'better-sqlite3';
import {
	type DmSender,
	createPostgate,
	createThreadgate,
	deletePostgate,
	postMessage,
	postWithQuote,
	replyToPost,
	resolveHandle,
} from './bot.js';
import {
	type PostKind,
	clearQueueEntries,
	loadActiveGames,
	loadActiveInviteGames,
	loadPublicQueue,
	recordGamePost,
	removeQueueEntry,
	saveGame,
	saveInviteGame,
	saveQueueEntry,
} from './db.js';
import { labelPost } from './labeler.js';

const POST_KIND_LABELS: Record<PostKind, string[]> = {
	announcement: ['skeetwolf', 'game-announcement'],
	phase: ['skeetwolf', 'game-phase'],
	death: ['skeetwolf', 'game-death'],
	vote_result: ['skeetwolf', 'game-vote'],
	game_over: ['skeetwolf', 'game-over'],
	reply: ['skeetwolf', 'game-reply'],
	player: ['skeetwolf'],
	day_thread: ['skeetwolf', 'game-day-thread'],
};

export class GameManager {
	private games = new Map<GameId, GameState>();
	/** Maps relay group ID → member DIDs (mirrors what DmSender tracks internally) */
	private mafiaRelayIds = new Map<GameId, string>();
	private publicQueue: PublicQueue = createQueue();
	private inviteGames = new Map<GameId, InviteGame>();

	constructor(
		private db: Database.Database,
		private agent: AtpAgent,
		private dm: DmSender,
		private labeler: LabelerServer | null = null,
	) {}

	/** Get a game's current state (or null if not loaded) */
	getGame(gameId: GameId): GameState | null {
		return this.games.get(gameId) ?? null;
	}

	/** Load all active games, queue, and invites from the database into memory */
	hydrate(): void {
		const active = loadActiveGames(this.db);
		for (const game of active) {
			this.games.set(game.id, game);

			// Rebuild mafia relay groups for active games
			const mafiaPlayers = game.players.filter((p) => p.alive && alignmentOf(p.role) === 'mafia');
			if (mafiaPlayers.length > 1) {
				const relayId = `mafia-${game.id}`;
				this.mafiaRelayIds.set(game.id, relayId);
				this.dm.createRelayGroup(
					relayId,
					mafiaPlayers.map((p) => p.did),
				);
			}
		}

		this.publicQueue = loadPublicQueue(this.db);

		const invites = loadActiveInviteGames(this.db);
		for (const invite of invites) {
			this.inviteGames.set(invite.id, invite);
		}

		console.log(
			`Hydrated ${active.length} game(s), ${this.publicQueue.entries.length} queued player(s), ${invites.length} invite(s)`,
		);
	}

	/** Create a new game and announce it (manual flow — signup post, not day thread) */
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
		await this.announceGameStart(game);

		return null;
	}

	/** DM roles and set up mafia relay. No public Night 0 post — first public post is Day 1. */
	private async announceGameStart(game: GameState): Promise<void> {
		const gameId = game.id;

		// DM roles to all players
		const f = DEFAULT_FLAVOR;
		for (const player of game.players) {
			const alignment = alignmentOf(player.role);
			const teammates =
				alignment === 'mafia'
					? game.players
							.filter((p) => alignmentOf(p.role) === 'mafia' && p.did !== player.did)
							.map((p) => `@${p.handle}`)
							.join(', ')
					: null;

			const roleText = flavor(f.roleAssignment[player.role as Role], {
				teammates: teammates ?? '',
			});
			let message = `🐺 Skeetwolf Game #${gameId}\n\n${roleText}`;
			if (teammates) {
				message += `\nYour mafia teammates: ${teammates}`;
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

		// DM all players that Night 0 has started (no public post)
		for (const player of game.players) {
			await this.dm.sendDm(
				player.did,
				`${flavor(f.nightStart)} Night ends in ${formatDuration(game.config.nightDurationMs)}.`,
			);
		}
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

	/** End the day phase — tally votes, eliminate, check win, lock thread, DM night */
	async endDay(gameId: GameId): Promise<void> {
		let state = this.games.get(gameId);
		if (!state) return;

		const { target, counts } = tallyVotes(state);

		// Announce vote results in the day thread
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
			// Persist after game logic mutations, before any API calls
			this.persist(state);

			const victimRole = (eliminated?.role ?? 'villager') as Role;
			const elimText = flavor(DEFAULT_FLAVOR.dayElimination[victimRole], {
				victim: eliminated?.handle ?? 'unknown',
				votes: countStr,
			});
			try {
				await this.postInThread(
					state,
					`Day ${state.phase.number} results — votes: ${countStr}\n\n${elimText}`,
					'death',
				);
			} catch (err) {
				console.error(`Failed to post day results for game ${gameId}:`, err);
			}
		} else {
			const noMajText = flavor(DEFAULT_FLAVOR.dayNoMajority, { votes: countStr });
			try {
				await this.postInThread(
					state,
					`Day ${state.phase.number} results — ${noMajText}`,
					'vote_result',
				);
			} catch (err) {
				console.error(`Failed to post no-majority results for game ${gameId}:`, err);
			}
		}

		if (state.winner) {
			try {
				await this.announceWinner(state);
			} catch (err) {
				console.error(`Failed to announce winner for game ${gameId}:`, err);
			}
		} else {
			// Lock the day thread
			if (state.dayThreadUri) {
				try {
					await createThreadgate(this.agent, state.dayThreadUri);
				} catch (err) {
					console.error(`Failed to create threadgate for ${state.dayThreadUri}:`, err);
				}
			}

			state = advancePhase(state);
			// Clear day thread — night has no public thread
			state = { ...state, dayThreadUri: null, dayThreadCid: null };

			// DM night announcement instead of public post
			const alivePlayers = state.players.filter((p) => p.alive);
			for (const player of alivePlayers) {
				try {
					await this.dm.sendDm(
						player.did,
						`${flavor(DEFAULT_FLAVOR.nightStart)} Night ends in ${formatDuration(state.config.nightDurationMs)}.`,
					);
				} catch (err) {
					console.error(`Failed to DM night start to ${player.did}:`, err);
				}
			}
		}

		this.persist(state);
		this.cleanupFinishedGame(state);
	}

	/** End the night phase — resolve actions, post day thread */
	async endNight(gameId: GameId): Promise<void> {
		let state = this.games.get(gameId);
		if (!state) return;

		const resolution = resolveNight(state);
		state = resolution.state;

		// Build dawn results text (before any API calls)
		let dawnResults: string;
		if (resolution.killed) {
			const victim = state.players.find((p) => p.did === resolution.killed);
			state = applyWinCondition(state);
			const victimRole = (victim?.role ?? 'villager') as Role;
			dawnResults = flavor(DEFAULT_FLAVOR.nightKill[victimRole], {
				victim: victim?.handle ?? 'unknown',
			});
		} else {
			dawnResults = flavor(DEFAULT_FLAVOR.dawnPeaceful);
		}

		// Persist after game logic mutations, before any API calls
		this.persist(state);

		// DM cop result (non-fatal)
		if (resolution.investigated) {
			const targetHandle =
				state.players.find((p) => p.did === resolution.investigated?.target)?.handle ?? 'unknown';
			try {
				await this.dm.sendDm(
					resolution.investigated.cop,
					flavor(DEFAULT_FLAVOR.copResult, {
						target: targetHandle,
						result: resolution.investigated.result.toUpperCase(),
					}),
				);
			} catch (err) {
				console.error(`Failed to DM cop result for game ${gameId}:`, err);
			}
		}

		if (state.winner) {
			// Post final day thread with results, then game over
			const dayNumber = state.phase.number + 1;
			const playerList = state.players
				.filter((p) => p.alive)
				.map((p) => `@${p.handle}`)
				.join(' ');
			const text = `🐺 Skeetwolf Game #${gameId} — Day ${dayNumber}\n\nDawn breaks. ${dawnResults}\n\nPlayers alive: ${playerList}`;
			const previousDayUri = state.dayThreadUri;
			const previousDayCid = state.dayThreadCid;
			try {
				const { uri, cid } = await this.postDayThread(
					state,
					text,
					previousDayUri ?? undefined,
					previousDayCid ?? undefined,
				);
				state = { ...state, dayThreadUri: uri, dayThreadCid: cid };
				this.persist(state);
			} catch (err) {
				console.error(`Failed to post final day thread for game ${gameId}:`, err);
			}

			try {
				await this.announceWinner(state);
			} catch (err) {
				console.error(`Failed to announce winner for game ${gameId}:`, err);
			}
		} else {
			state = advancePhase(state);
			const dayNumber = state.phase.number;

			const playerList = state.players
				.filter((p) => p.alive)
				.map((p) => `@${p.handle}`)
				.join(' ');

			const text = `🐺 Skeetwolf Game #${gameId} — Day ${dayNumber}!\n\nDawn breaks. ${dawnResults}\n\nPlayers alive: ${playerList}\nDiscuss and vote! Day ends in ${formatDuration(state.config.dayDurationMs)}.`;

			const previousDayUri = state.dayThreadUri;
			const previousDayCid = state.dayThreadCid;

			try {
				const { uri, cid } = await this.postDayThread(
					state,
					text,
					previousDayUri ?? undefined,
					previousDayCid ?? undefined,
				);
				state = {
					...state,
					dayThreadUri: uri,
					dayThreadCid: cid,
				};

				// Day 1 = game announcement post; set announcementUri if not already set
				if (!state.announcementUri) {
					state = { ...state, announcementUri: uri, announcementCid: cid };
				}
			} catch (err) {
				console.error(`Failed to post day thread for game ${gameId}:`, err);
			}

			// Register per-game feed on Day 1
			if (dayNumber === 1) {
				await this.registerGameFeed(gameId);
			}
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
		const winnersStr = state.players
			.filter((p) => alignmentOf(p.role) === state.winner)
			.map((p) => `@${p.handle}`)
			.join(', ');
		const rolesStr = state.players.map((p) => `@${p.handle} (${p.role})`).join(', ');
		const variants = state.winner === 'town' ? DEFAULT_FLAVOR.townWins : DEFAULT_FLAVOR.mafiaWins;
		const winText = flavor(variants, {
			winners: `Winners: ${winnersStr}`,
			roles: `Roles: ${rolesStr}`,
		});
		await this.postInThread(state, `🏆 Game #${state.id} is over!\n\n${winText}`, 'game_over');
	}

	/** Remove a finished game from in-memory state (already persisted to DB) */
	private cleanupFinishedGame(state: GameState): void {
		if (state.winner) {
			this.games.delete(state.id);
			this.mafiaRelayIds.delete(state.id);
		}
	}

	/** Post a day thread — top-level for Day 1, QT of previous day for Day 2+ */
	private async postDayThread(
		state: GameState,
		text: string,
		previousDayUri?: string,
		previousDayCid?: string,
	): Promise<{ uri: string; cid: string }> {
		const labels = POST_KIND_LABELS.day_thread;
		let uri: string;
		let cid: string;

		if (previousDayUri && previousDayCid) {
			// QT the previous day: delete postgate → QT → re-create postgate
			try {
				await deletePostgate(this.agent, previousDayUri);
			} catch {
				// Postgate might not exist (e.g., first run after upgrade)
			}
			const result = await postWithQuote(this.agent, text, previousDayUri, previousDayCid, labels);
			uri = result.uri;
			cid = result.cid;
			try {
				await createPostgate(this.agent, previousDayUri);
			} catch (err) {
				console.error(`Failed to re-create postgate for ${previousDayUri}:`, err);
			}
		} else {
			// Day 1: top-level post
			const result = await postMessage(this.agent, text, labels);
			uri = result.uri;
			cid = result.cid;
		}

		// Postgate on the new day post (disable QTs)
		try {
			await createPostgate(this.agent, uri);
		} catch (err) {
			console.error(`Failed to create postgate for day thread ${uri}:`, err);
		}

		// Label via external labeler
		if (this.labeler) {
			await labelPost(this.labeler, uri, 'skeetwolf-game');
		}

		// Record in game_posts
		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = `${state.phase.kind}-${state.phase.number}`;
		recordGamePost(this.db, {
			uri,
			gameId: state.id,
			authorDid: botDid,
			kind: 'day_thread',
			phase,
		});

		return { uri, cid };
	}

	/** Post a top-level message, add postgate, label, and record in game_posts */
	private async post(
		gameId: GameId,
		text: string,
		kind: PostKind,
	): Promise<{ uri: string; cid: string }> {
		const { uri, cid } = await postMessage(this.agent, text, POST_KIND_LABELS[kind]);

		// Postgate on all bot posts (disable QTs)
		try {
			await createPostgate(this.agent, uri);
		} catch (err) {
			console.error(`Failed to create postgate for ${uri}:`, err);
		}

		// Label via external labeler
		if (this.labeler) {
			await labelPost(this.labeler, uri, 'skeetwolf-game');
		}

		const botDid = this.agent.session?.did ?? 'unknown';
		const state = this.games.get(gameId);
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid: botDid, kind, phase });
		return { uri, cid };
	}

	/** Post a reply in the current day thread. Falls back to standalone reply if no thread. */
	private async postInThread(
		state: GameState,
		text: string,
		kind: PostKind,
	): Promise<{ uri: string; cid: string }> {
		const rootUri = state.dayThreadUri;
		const rootCid = state.dayThreadCid;
		if (!rootUri || !rootCid) {
			// No active day thread — post as top-level
			return this.post(state.id, text, kind);
		}

		const { uri, cid } = await replyToPost(
			this.agent,
			text,
			rootUri,
			rootCid,
			rootUri,
			rootCid,
			POST_KIND_LABELS[kind],
		);

		// Postgate on replies too
		try {
			await createPostgate(this.agent, uri);
		} catch (err) {
			console.error(`Failed to create postgate for reply ${uri}:`, err);
		}

		// Label via external labeler
		if (this.labeler) {
			await labelPost(this.labeler, uri, 'skeetwolf-game');
		}

		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = `${state.phase.kind}-${state.phase.number}`;
		recordGamePost(this.db, { uri, gameId: state.id, authorDid: botDid, kind, phase });
		return { uri, cid };
	}

	/** Reply to a mention — threads under day thread (root) with mention as parent.
	 * During night (no day thread), falls back to parent-as-root. */
	async reply(gameId: GameId, text: string, parentUri: string, parentCid: string): Promise<void> {
		const state = this.games.get(gameId);
		// Use day thread as root during day phase, fall back to announcement, then parent
		const rootUri = state?.dayThreadUri ?? state?.announcementUri ?? parentUri;
		const rootCid = state?.dayThreadCid ?? state?.announcementCid ?? parentCid;

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

		// Postgate on reply
		try {
			await createPostgate(this.agent, uri);
		} catch (err) {
			console.error(`Failed to create postgate for reply ${uri}:`, err);
		}

		// Label via external labeler
		if (this.labeler) {
			await labelPost(this.labeler, uri, 'skeetwolf-game');
		}

		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid: botDid, kind: 'reply', phase });
	}

	// -- Public Queue --

	/** Add a player to the public queue. Auto-pops and starts a game if threshold reached. */
	async addToQueue(did: Did, handle: Handle, replyUri: string, replyCid: string): Promise<void> {
		// Reject if player is in an active game
		if (this.findGameForPlayer(did)) {
			await this.replyNoGame('You are already in an active game', replyUri, replyCid);
			return;
		}

		const result = addToQueue(this.publicQueue, did, handle, Date.now());
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'queue error', replyUri, replyCid);
			return;
		}

		this.publicQueue = result.queue;
		const entry = result.queue.entries.find((e) => e.did === did);
		if (!entry) throw new Error(`Queue entry not found for ${did} after successful join`);

		saveQueueEntry(this.db, entry);

		const { minPlayers } = DEFAULT_CONFIG;
		const count = this.publicQueue.entries.length;
		await this.replyNoGame(
			`You're in the queue (${count}/${minPlayers}). Game starts when the queue fills.`,
			replyUri,
			replyCid,
		);

		if (canPopQueue(this.publicQueue, minPlayers)) {
			await this.popAndStartGame(minPlayers, replyUri, replyCid);
		}
	}

	/** Report queue status */
	async queueStatus(replyUri: string, replyCid: string): Promise<void> {
		const entries = this.publicQueue.entries;
		const { minPlayers } = DEFAULT_CONFIG;
		if (entries.length === 0) {
			await this.replyNoGame(`Queue is empty (need ${minPlayers} to start)`, replyUri, replyCid);
		} else {
			const names = entries.map((e) => `@${e.handle}`).join(', ');
			await this.replyNoGame(
				`Queue: ${entries.length}/${minPlayers} — ${names}`,
				replyUri,
				replyCid,
			);
		}
	}

	/** Remove a player from the public queue */
	async removeFromQueue(did: Did, replyUri: string, replyCid: string): Promise<void> {
		const result = removeFromQueue(this.publicQueue, did);
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'queue error', replyUri, replyCid);
			return;
		}

		this.publicQueue = result.queue;
		removeQueueEntry(this.db, did);
		await this.replyNoGame('You left the queue', replyUri, replyCid);
	}

	/** Pop players from queue and start a game. No public announcement — DM only. */
	private async popAndStartGame(
		count: number,
		triggerUri?: string,
		triggerCid?: string,
	): Promise<void> {
		const { popped, queue } = popQueue(this.publicQueue, count);

		// Filter out players who entered a game since queuing
		const eligible = popped.filter((e) => !this.findGameForPlayer(e.did));
		if (eligible.length < count) {
			// Not enough eligible — put them back, don't start
			return;
		}

		this.publicQueue = queue;
		clearQueueEntries(
			this.db,
			popped.map((e) => e.did),
		);

		const id = Date.now().toString(36);
		let state = createGame(id);
		this.persist(state);

		// Add all popped players
		for (const entry of eligible) {
			const r = addPlayer(state, entry.did, entry.handle);
			if (r.ok) state = r.state;
		}
		this.persist(state);

		// Assign roles and start
		const roleResult = assignRoles(state);
		if (!roleResult.ok) {
			console.error(`Queue game ${id} failed to assign roles: ${roleResult.error}`);
			return;
		}
		state = roleResult.state;
		this.persist(state);

		// Reply in queue thread: "Game starting — check your DMs!"
		if (triggerUri && triggerCid) {
			await this.replyNoGame(
				`🐺 Game #${id} starting — ${flavor(DEFAULT_FLAVOR.gameStart)}`,
				triggerUri,
				triggerCid,
			);
		}

		await this.announceGameStart(state);
	}

	// -- Invite Games --

	/** Create an invite game. Resolves handles, creates invite, notifies invited players. */
	async createInviteGame(
		initiatorDid: Did,
		initiatorHandle: Handle,
		handles: string[],
		replyUri: string,
		replyCid: string,
	): Promise<void> {
		// Filter out the bot handle
		const botHandle = this.agent.session?.handle;
		const filteredHandles = handles.filter((h) => h.toLowerCase() !== botHandle?.toLowerCase());

		if (filteredHandles.length === 0) {
			await this.replyNoGame('No valid handles to invite', replyUri, replyCid);
			return;
		}

		// Resolve all handles to DIDs
		const resolved: { did: Did; handle: Handle }[] = [];
		const failed: string[] = [];
		for (const handle of filteredHandles) {
			const did = await resolveHandle(this.agent, handle);
			if (did) {
				resolved.push({ did, handle });
			} else {
				failed.push(handle);
			}
		}

		if (failed.length > 0) {
			await this.replyNoGame(
				`Could not resolve: ${failed.map((h) => `@${h}`).join(', ')}`,
				replyUri,
				replyCid,
			);
			if (resolved.length === 0) return;
		}

		const id = Date.now().toString(36);
		const result = createInviteGame(id, initiatorDid, initiatorHandle, resolved);
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'invite error', replyUri, replyCid);
			return;
		}

		const invite = result.invite;
		this.inviteGames.set(id, invite);
		saveInviteGame(this.db, invite);

		const minPlayers = invite.config.minPlayers;
		const invitedMentions = resolved.map((r) => `@${r.handle}`).join(' ');
		await this.replyNoGame(
			`Invite game #${id} created! ${invitedMentions} — reply "confirm #${id}" to join. Need ${minPlayers} total players.`,
			replyUri,
			replyCid,
		);
	}

	/** Confirm a slot in an invite game */
	async confirmInviteSlot(
		gameId: GameId,
		did: Did,
		replyUri: string,
		replyCid: string,
	): Promise<void> {
		const invite = this.inviteGames.get(gameId);
		if (!invite) {
			await this.replyNoGame('invite game not found', replyUri, replyCid);
			return;
		}

		const result = confirmInvite(invite, did);
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'confirm error', replyUri, replyCid);
			return;
		}

		this.inviteGames.set(gameId, result.invite);
		saveInviteGame(this.db, result.invite);

		const confirmed = result.invite.slots.filter((s) => s.confirmed).length;
		const total = result.invite.slots.length;
		const minPlayers = result.invite.config.minPlayers;

		await this.replyNoGame(
			`Confirmed for game #${gameId} (${confirmed}/${total} confirmed, need ${minPlayers})`,
			replyUri,
			replyCid,
		);

		if (isInviteReady(result.invite, minPlayers)) {
			await this.startInviteGame(gameId, replyUri, replyCid);
		}
	}

	/** Add a replacement player to an invite game (initiator only) */
	async addInvitePlayer(
		gameId: GameId,
		initiatorDid: Did,
		handle: Handle,
		replyUri: string,
		replyCid: string,
	): Promise<void> {
		const invite = this.inviteGames.get(gameId);
		if (!invite) {
			await this.replyNoGame('invite game not found', replyUri, replyCid);
			return;
		}
		if (invite.initiatorDid !== initiatorDid) {
			await this.replyNoGame('only the initiator can invite new players', replyUri, replyCid);
			return;
		}

		const did = await resolveHandle(this.agent, handle);
		if (!did) {
			await this.replyNoGame(`could not resolve @${handle}`, replyUri, replyCid);
			return;
		}

		const result = addInviteSlot(invite, did, handle);
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'invite error', replyUri, replyCid);
			return;
		}

		this.inviteGames.set(gameId, result.invite);
		saveInviteGame(this.db, result.invite);
		await this.replyNoGame(
			`@${handle} added to invite game #${gameId}. They need to "confirm #${gameId}".`,
			replyUri,
			replyCid,
		);
	}

	/** Cancel an invite game (initiator only) */
	async cancelInviteGame(
		gameId: GameId,
		initiatorDid: Did,
		replyUri: string,
		replyCid: string,
	): Promise<void> {
		const invite = this.inviteGames.get(gameId);
		if (!invite) {
			await this.replyNoGame('invite game not found', replyUri, replyCid);
			return;
		}
		if (invite.initiatorDid !== initiatorDid) {
			await this.replyNoGame('only the initiator can cancel', replyUri, replyCid);
			return;
		}

		const result = cancelInvite(invite);
		if (!result.ok) {
			await this.replyNoGame(result.error ?? 'cancel error', replyUri, replyCid);
			return;
		}

		this.inviteGames.set(gameId, result.invite);
		saveInviteGame(this.db, result.invite);
		this.inviteGames.delete(gameId);
		await this.replyNoGame(`Invite game #${gameId} cancelled`, replyUri, replyCid);
	}

	/** Convert a ready invite into a real game and start it. No public announcement. */
	private async startInviteGame(
		inviteId: GameId,
		triggerUri?: string,
		triggerCid?: string,
	): Promise<void> {
		const invite = this.inviteGames.get(inviteId);
		if (!invite) return;

		const players = inviteGameToPlayers(invite);
		const id = inviteId; // Use the same ID for continuity

		let state = createGame(id);
		this.persist(state);

		for (const p of players) {
			const r = addPlayer(state, p.did, p.handle);
			if (r.ok) state = r.state;
		}
		this.persist(state);

		const roleResult = assignRoles(state);
		if (!roleResult.ok) {
			console.error(`Invite game ${id} failed to assign roles: ${roleResult.error}`);
			return;
		}
		state = roleResult.state;
		this.persist(state);

		// Reply in invite thread: "Game starting — check your DMs!"
		if (triggerUri && triggerCid) {
			await this.replyNoGame(
				`🐺 Game #${id} starting — ${flavor(DEFAULT_FLAVOR.gameStart)}`,
				triggerUri,
				triggerCid,
			);
		}

		await this.announceGameStart(state);

		// Mark invite as active and remove from tracking
		const activatedInvite = { ...invite, status: 'active' as const };
		saveInviteGame(this.db, activatedInvite);
		this.inviteGames.delete(inviteId);
	}

	/** Record a player's post (mention/reply) as part of a game */
	recordPlayerPost(gameId: GameId, uri: string, authorDid: string): void {
		const state = this.games.get(gameId);
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		recordGamePost(this.db, { uri, gameId, authorDid, kind: 'player', phase });
	}

	/** Reply to a mention that isn't associated with a game thread */
	async replyNoGame(text: string, parentUri: string, parentCid: string): Promise<void> {
		const replyLabels = POST_KIND_LABELS.reply;
		await replyToPost(this.agent, text, parentUri, parentCid, parentUri, parentCid, replyLabels);
	}

	/** Register a per-game feed with Bluesky */
	private async registerGameFeed(gameId: GameId): Promise<void> {
		const did = this.agent.session?.did;
		if (!did) return;

		try {
			await this.agent.api.com.atproto.repo.createRecord({
				repo: did,
				collection: 'app.bsky.feed.generator',
				rkey: `skeetwolf-${gameId}`,
				record: {
					did: process.env['FEED_PUBLISHER_DID'] ?? did,
					displayName: `Skeetwolf Game #${gameId}`,
					description: `Follow Skeetwolf Game #${gameId} — all day threads, votes, and results.`,
					createdAt: new Date().toISOString(),
				},
			});
			console.log(`Registered feed for game ${gameId}`);
		} catch (err) {
			console.error(`Failed to register feed for game ${gameId}:`, err);
		}
	}

	private persist(state: GameState): void {
		this.games.set(state.id, state);
		saveGame(this.db, state);
	}
}

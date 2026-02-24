/**
 * Manages the lifecycle of active games.
 * Bridges pure game logic (shared) with I/O (bot, db).
 */
import type { AtpAgent } from '@atproto/api';
import {
	DEFAULT_CONFIG,
	type Did,
	type FlavorPack,
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
	getFlavorPack,
	inviteGameToPlayers,
	isInviteReady,
	isPhaseExpired,
	popQueue,
	randomFlavorPackName,
	removeFromQueue,
	replacePlayer,
	resolveNight,
	submitNightAction,
	tallyVotes,
} from '@skeetwolf/shared';
import type { LabelerServer } from '@skyware/labeler';
import type Database from 'better-sqlite3';
import {
	type DmSender,
	type PostRef,
	type ThreadReply,
	createPostgate,
	createThreadgate,
	deletePostgate,
	deleteThreadgate,
	getThreadReplies,
	postMessageChain,
	postWithQuoteChain,
	replyToPost,
	replyToPostChain,
	resolveHandle,
} from './bot.js';
import { parseMention } from './command-parser.js';
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

/** Night 0 check interval — only evaluate early end on hourly boundaries to avoid leaking action timing. */
const NIGHT_0_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** How long to wait before replacing unreachable players with queue substitutes */
const DM_RETRY_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

interface PendingDmFailure {
	did: Did;
	handle: Handle;
	role: Role;
	addedAt: number; // when this failure was first detected (per-player timer)
}

interface PendingDmGame {
	gameId: GameId;
	failures: PendingDmFailure[];
	triggerUri?: string;
	triggerCid?: string;
	warnedHandles: Set<string>;
}

/** Check if all meaningful Night 0 actions are in. Only cop matters — doctor protect is
 *  a no-op (no kill to block) and we don't want to force a pointless action. */
function allNight0ActionsIn(state: GameState): boolean {
	const hasCop = state.players.some((p) => p.role === 'cop' && p.alive);
	const hasInvestigate = state.nightActions.some((a) => a.kind === 'investigate');
	return !hasCop || hasInvestigate;
}

/** Interval for periodic vote count posts during day phase */
const VOTE_COUNT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class GameManager {
	private games = new Map<GameId, GameState>();
	/** Maps relay group ID → member DIDs (mirrors what DmSender tracks internally) */
	private mafiaRelayIds = new Map<GameId, string>();
	/** Tracks which hourly boundary we last checked for Night 0 auto-advance */
	private night0LastCheckedHour = new Map<GameId, number>();
	/** Tracks which hourly boundary we last posted vote counts for day phases */
	private voteCountLastPostedHour = new Map<GameId, number>();
	/** Games blocked on DM delivery — retried each tick until resolved or timed out */
	private pendingDmRetries = new Map<GameId, PendingDmGame>();
	private publicQueue: PublicQueue = createQueue();
	private inviteGames = new Map<GameId, InviteGame>();

	constructor(
		private db: Database.Database,
		private agent: AtpAgent,
		private dm: DmSender,
		private labeler: LabelerServer | null = null,
	) {}

	/** Number of active games in memory */
	activeGameCount(): number {
		return this.games.size;
	}

	/** Get a game's current state (or null if not loaded) */
	getGame(gameId: GameId): GameState | null {
		return this.games.get(gameId) ?? null;
	}

	/** Get the flavor pack for a game (falls back to default for pre-existing games) */
	private flavorFor(gameId: GameId): FlavorPack {
		const state = this.games.get(gameId);
		return getFlavorPack(state?.flavorPackName ?? '');
	}

	/** Load all active games, queue, and invites from the database into memory */
	async hydrate(): Promise<void> {
		const now = Date.now();
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

			// Catch up hourly trackers so we don't retroactively post on restart
			if (game.phase.kind === 'day') {
				const elapsed = now - game.phaseStartedAt;
				const hoursPassed = Math.floor(elapsed / VOTE_COUNT_INTERVAL_MS);
				if (hoursPassed >= 1) {
					this.voteCountLastPostedHour.set(game.id, hoursPassed);
				}
			}
		}

		this.publicQueue = loadPublicQueue(this.db);

		const invites = loadActiveInviteGames(this.db);
		for (const invite of invites) {
			this.inviteGames.set(invite.id, invite);
		}

		// Rebuild DM retry state for games with undelivered role DMs
		for (const game of active) {
			const pendingDids = game.pendingDmDids ?? [];
			if (pendingDids.length > 0 && game.phase.kind === 'night' && game.phase.number === 0) {
				const failures: PendingDmFailure[] = pendingDids
					.map((did) => {
						const player = game.players.find((p) => p.did === did);
						if (!player) return null;
						return { did, handle: player.handle, role: player.role, addedAt: now };
					})
					.filter((f): f is PendingDmFailure => f !== null);
				if (failures.length > 0) {
					this.pendingDmRetries.set(game.id, {
						gameId: game.id,
						failures,
						warnedHandles: new Set(failures.map((f) => f.handle)),
					});
				}
			}
		}

		console.log(
			`Hydrated ${active.length} game(s), ${this.publicQueue.entries.length} queued player(s), ${invites.length} invite(s)`,
		);

		// Rehydrate votes from Bluesky threads for active day-phase games
		for (const game of active) {
			if (game.phase.kind === 'day' && game.dayThreadUri) {
				await this.rehydrateVotes(game.id, game.dayThreadUri);
			}
		}
	}

	/** Rebuild vote state from the Bluesky day thread. Replays vote/unvote commands
	 *  from thread replies into game state, making the thread the source of truth. */
	private async rehydrateVotes(gameId: GameId, dayThreadUri: string): Promise<void> {
		let replies: ThreadReply[];
		try {
			replies = await getThreadReplies(this.agent, dayThreadUri);
		} catch (err) {
			console.error(`Failed to fetch thread for vote rehydration (game ${gameId}):`, err);
			return;
		}

		const botDid = this.agent.session?.did;
		const botHandle = this.agent.session?.handle;
		let state = this.games.get(gameId);
		if (!state) return;

		let rehydrated = 0;
		for (const reply of replies) {
			// Skip bot's own posts
			if (reply.authorDid === botDid) continue;

			// Strip @bot mention, then require text starts with a command keyword.
			// This prevents casual conversation like "I don't think unvote works"
			// from being treated as game commands.
			const stripped = botHandle
				? reply.text.replace(new RegExp(`@${botHandle}\\s*`, 'gi'), '').trim()
				: reply.text.trim();
			if (!/^(vote|unvote)\b/i.test(stripped)) continue;

			const cmd = parseMention(reply.text, botHandle);
			if (cmd.kind === 'vote') {
				const targetDid = this.resolveHandleInGame(gameId, cmd.targetHandle);
				if (!targetDid) continue;
				const result = castVote(state, reply.authorDid, targetDid);
				if (result.ok) {
					state = result.state;
					rehydrated++;
				}
			} else if (cmd.kind === 'unvote') {
				const result = castVote(state, reply.authorDid, null);
				if (result.ok) {
					state = result.state;
					rehydrated++;
				}
			}
		}

		if (rehydrated > 0) {
			this.persist(state);
			console.log(`Rehydrated ${rehydrated} vote(s) for game ${gameId} from thread`);

			// Check if rehydrated votes form a majority — trigger endDay if so
			const { target } = tallyVotes(state);
			if (target) {
				console.log(`Majority detected after rehydration for game ${gameId} — ending day`);
				await this.endDay(gameId);
			}
		}
	}

	/** Create a new game and announce it (manual flow — signup post, not day thread) */
	async newGame(id: GameId): Promise<GameState> {
		const state = createGame(id, {}, randomFlavorPackName());
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
		const failures = await this.announceGameStart(game);
		if (failures.length > 0) {
			this.enterPendingDmState(game, failures);
		}

		return null;
	}

	/** Send role DMs. Returns list of failures (empty = all delivered).
	 *  If all succeed, also sends mafia relay + Night 0 guidance. */
	private async announceGameStart(
		game: GameState,
		targetDids?: Did[],
	): Promise<PendingDmFailure[]> {
		const gameId = game.id;
		const now = Date.now();
		const failures: PendingDmFailure[] = [];

		// DM roles to targeted players (or all if not specified)
		const recipients = targetDids
			? game.players.filter((p) => targetDids.includes(p.did))
			: game.players;

		const f = this.flavorFor(gameId);
		for (const player of recipients) {
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
			const playerList = game.players.map((p) => `@${p.handle}`).join(', ');
			let message = `🐺 Skeetwolf Game #${gameId}\n\nPlayers: ${playerList}\n\n${roleText}`;
			if (teammates) {
				message += `\nYour mafia teammates: ${teammates}`;
			}
			const faqUrl = process.env['FAQ_URL'];
			if (faqUrl) {
				message += `\n\nHow to play: ${faqUrl}`;
			}

			const ok = await this.dm.sendDm(player.did, message);
			if (!ok) {
				failures.push({ did: player.did, handle: player.handle, role: player.role, addedAt: now });
			}
		}

		if (failures.length > 0) return failures;

		// All DMs delivered — finish game start
		await this.completeGameStart(game);
		return [];
	}

	/** Send mafia relay + Night 0 guidance. Called after all role DMs are confirmed delivered. */
	private async completeGameStart(game: GameState): Promise<void> {
		const gameId = game.id;
		const f = this.flavorFor(gameId);

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

		// DM all players Night 0 guidance (role-specific, no public post)
		for (const player of game.players) {
			await this.dm.sendDm(player.did, flavor(f.night0Guidance[player.role as Role]));
		}

		// Mark DM delivery complete
		const updated = { ...game, pendingDmDids: [] as Did[] };
		this.persist(updated);
	}

	/** Post a public warning about players whose DM settings blocked delivery */
	private async warnDmFailures(
		failedHandles: string[],
		game: GameState,
		replyUri?: string,
		replyCid?: string,
	): Promise<void> {
		if (failedHandles.length === 0) return;
		const handles = failedHandles.map((h) => `@${h}`).join(', ');
		const text = `⚠️ ${handles} — couldn't send you a DM with your role. Either follow @skeetwolf.bsky.social or open your Bluesky chat settings. The game won't start until all players can receive DMs. You have 6 hours before your spot goes to the next player in queue.`;
		try {
			if (replyUri && replyCid) {
				await this.replyNoGame(text, replyUri, replyCid);
			} else if (game.announcementUri) {
				await this.postInThread(game, text, 'player');
			} else {
				console.error(`DM failures for game ${game.id} but nowhere to post warning: ${handles}`);
			}
		} catch (err) {
			console.error(`Failed to post DM warning for game ${game.id}:`, err);
		}
	}

	/** Record DM failures and block game from advancing until resolved */
	private enterPendingDmState(
		game: GameState,
		failures: PendingDmFailure[],
		triggerUri?: string,
		triggerCid?: string,
	): void {
		const pending: PendingDmGame = {
			gameId: game.id,
			failures,
			triggerUri,
			triggerCid,
			warnedHandles: new Set<string>(),
		};
		this.pendingDmRetries.set(game.id, pending);

		// Persist which DIDs have pending DMs
		const updated = { ...game, pendingDmDids: failures.map((f) => f.did) };
		this.persist(updated);

		// Warn failed players (fire-and-forget)
		const newHandles = failures.map((f) => f.handle);
		for (const h of newHandles) pending.warnedHandles.add(h);
		this.warnDmFailures(newHandles, game, triggerUri, triggerCid);
	}

	/** Check if a game is blocked on pending DM delivery */
	hasPendingDms(gameId: GameId): boolean {
		return this.pendingDmRetries.has(gameId);
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

	/** Process a night action. Returns error string or null on success. */
	async nightAction(gameId: GameId, action: NightAction): Promise<string | null> {
		const state = this.games.get(gameId);
		if (!state) return 'game not found';

		const result = submitNightAction(state, action);
		if (!result.ok) return result.error ?? 'action failed';

		this.persist(result.state);

		// Night 0: tick() handles auto-advance after minimum wait + all actions in

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
			const elimText = flavor(this.flavorFor(gameId).dayElimination[victimRole], {
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
			const noMajText = flavor(this.flavorFor(gameId).dayNoMajority, { votes: countStr });
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
			// Lock the day thread — delete mentionRule threadgate, replace with block-all
			if (state.dayThreadUri) {
				try {
					await deleteThreadgate(this.agent, state.dayThreadUri);
				} catch {
					// May not exist (e.g., game started before this feature)
				}
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
				await this.sendGameDm(
					state,
					player.did,
					`${flavor(this.flavorFor(gameId).nightStart)} Night ends in ${formatDuration(state.config.nightDurationMs)}.`,
				);
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
			dawnResults = flavor(this.flavorFor(gameId).nightKill[victimRole], {
				victim: victim?.handle ?? 'unknown',
			});
		} else {
			dawnResults = flavor(this.flavorFor(gameId).dawnPeaceful);
		}

		// Persist after game logic mutations, before any API calls
		this.persist(state);

		// DM cop result (non-fatal)
		if (resolution.investigated) {
			const targetHandle =
				state.players.find((p) => p.did === resolution.investigated?.target)?.handle ?? 'unknown';
			await this.sendGameDm(
				state,
				resolution.investigated.cop,
				flavor(this.flavorFor(gameId).copResult, {
					target: targetHandle,
					result: resolution.investigated.result.toUpperCase(),
				}),
			);
		}

		if (state.winner) {
			// Post final day thread with results, then game over
			const dayNumber = state.phase.number + 1;
			const playerList = state.players
				.filter((p) => p.alive)
				.map((p) => `@${p.handle}`)
				.join(' ');
			const text = `🐺 Skeetwolf Game #${gameId} — Day ${dayNumber}\n\nPlayers alive: ${playerList}\n\nDawn breaks. ${dawnResults}`;
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

			let text = `🐺 Skeetwolf Game #${gameId} — Day ${dayNumber}!\n\nPlayers alive: ${playerList}\n\nDawn breaks. ${dawnResults}\n\nDiscuss and vote! Day ends in ${formatDuration(state.config.dayDurationMs)}.`;

			// Day 1: include feed URL so players can follow the game
			if (dayNumber === 1) {
				text += `\n\n📡 Follow this game: ${this.feedUrl(gameId)}`;
			}

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

	/** Format current vote tally for a game. Returns null if not in day phase. */
	formatVoteCount(gameId: GameId): string | null {
		const state = this.games.get(gameId);
		if (!state || state.phase.kind !== 'day') return null;

		const { counts } = tallyVotes(state);
		const aliveCount = state.players.filter((p) => p.alive).length;
		const majority = Math.floor(aliveCount / 2) + 1;

		if (counts.size === 0) {
			return `📊 Day ${state.phase.number} vote count — no votes yet (${majority} needed for majority)`;
		}

		const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		const lines = sorted.map(([did, n]) => {
			const p = state.players.find((pl) => pl.did === did);
			return `@${p?.handle ?? did}: ${n}`;
		});
		return `📊 Day ${state.phase.number} vote count — ${lines.join(', ')} (${majority} needed for majority)`;
	}

	/** Post the current vote count in the day thread */
	async postVoteCount(gameId: GameId): Promise<void> {
		const text = this.formatVoteCount(gameId);
		if (!text) return;

		const state = this.games.get(gameId);
		if (!state) return;

		await this.postInThread(state, text, 'vote_result');
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
	async nightActionByHandle(
		gameId: GameId,
		actorDid: Did,
		kind: NightActionKind,
		targetHandle: string,
	): Promise<string | null> {
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
		// DM retry loop — process before phase transitions
		await this.tickDmRetries(now);

		const expired = this.getGamesNeedingTransition(now);
		for (const { gameId, phaseKind } of expired) {
			// Skip games blocked on DM delivery
			if (this.pendingDmRetries.has(gameId)) continue;
			console.log(`Phase expired for game ${gameId} (${phaseKind})`);
			if (phaseKind === 'day') {
				await this.endDay(gameId);
			} else {
				await this.endNight(gameId);
			}
		}

		// Night 0 early end: check on hourly boundaries only (not on every tick)
		// to avoid leaking when a player submitted their action.
		for (const [id, state] of this.games) {
			if (this.pendingDmRetries.has(id)) continue;
			if (state.status !== 'active' || state.phase.kind !== 'night' || state.phase.number !== 0) {
				continue;
			}
			const elapsed = now - state.phaseStartedAt;
			const hoursPassed = Math.floor(elapsed / NIGHT_0_CHECK_INTERVAL_MS);
			const lastCheckedHour = this.night0LastCheckedHour.get(id) ?? 0;
			if (hoursPassed <= lastCheckedHour) continue;
			this.night0LastCheckedHour.set(id, hoursPassed);
			if (allNight0ActionsIn(state)) {
				console.log(`Night 0 auto-advancing for game ${id} (all actions in, hour ${hoursPassed})`);
				await this.endNight(id);
				this.night0LastCheckedHour.delete(id);
			}
		}

		// Hourly vote count posts during day phases
		for (const [id, state] of this.games) {
			if (state.status !== 'active' || state.phase.kind !== 'day') continue;
			const elapsed = now - state.phaseStartedAt;
			const hoursPassed = Math.floor(elapsed / VOTE_COUNT_INTERVAL_MS);
			if (hoursPassed < 1) continue; // No post in the first hour
			const lastPostedHour = this.voteCountLastPostedHour.get(id) ?? 0;
			if (hoursPassed <= lastPostedHour) continue;
			this.voteCountLastPostedHour.set(id, hoursPassed);
			// Skip auto-post when no votes have been cast (just noise)
			if (state.votes.length === 0) continue;
			console.log(`Posting hourly vote count for game ${id} (hour ${hoursPassed})`);
			await this.postVoteCount(id);
		}
	}

	/** Retry failed DMs and handle timeouts with player replacement */
	private async tickDmRetries(now: number): Promise<void> {
		for (const [gameId, pending] of this.pendingDmRetries) {
			let game = this.games.get(gameId);
			if (!game) {
				this.pendingDmRetries.delete(gameId);
				continue;
			}

			const stillFailing: PendingDmFailure[] = [];
			const timedOut: PendingDmFailure[] = [];

			for (const failure of pending.failures) {
				if (now - failure.addedAt >= DM_RETRY_TIMEOUT_MS) {
					timedOut.push(failure);
				} else {
					// Retry the DM
					const ok = await this.dm.sendDm(failure.did, this.buildRoleDmText(game, failure.did));
					if (!ok) {
						stillFailing.push(failure);
					}
				}
			}

			// Handle timed-out players — replace from queue
			for (const expired of timedOut) {
				game = this.games.get(gameId) ?? game;
				const replacement = this.publicQueue.entries[0];
				if (!replacement) {
					// No replacement available — post warning
					try {
						const text = `⚠️ Game #${gameId} is stalled — @${expired.handle} can't receive DMs and no one is in the queue to replace them.`;
						if (pending.triggerUri && pending.triggerCid) {
							await this.replyNoGame(text, pending.triggerUri, pending.triggerCid);
						} else if (game.announcementUri) {
							await this.postInThread(game, text, 'player');
						}
					} catch (err) {
						console.error(`Failed to post stall warning for game ${gameId}:`, err);
					}
					stillFailing.push(expired); // keep in failures
					continue;
				}

				// Pop from queue
				const { queue } = popQueue(this.publicQueue, 1);
				this.publicQueue = queue;
				clearQueueEntries(this.db, [replacement.did]);

				// Swap the player
				const result = replacePlayer(game, expired.did, replacement.did, replacement.handle);
				if (!result.ok) {
					console.error(`replacePlayer failed for game ${gameId}: ${result.error}`);
					stillFailing.push(expired);
					continue;
				}
				game = result.state;
				this.persist(game);
				console.log(`Replaced ${expired.handle} with ${replacement.handle} in game ${gameId}`);

				// Send role DM to replacement
				const ok = await this.dm.sendDm(
					replacement.did,
					this.buildRoleDmText(game, replacement.did),
				);
				if (!ok) {
					// Replacement also can't receive DMs — add them to failures
					const player = game.players.find((p) => p.did === replacement.did);
					if (player) {
						stillFailing.push({
							did: replacement.did,
							handle: replacement.handle,
							role: player.role,
							addedAt: now,
						});
						// Warn the new player
						if (!pending.warnedHandles.has(replacement.handle)) {
							pending.warnedHandles.add(replacement.handle);
							await this.warnDmFailures(
								[replacement.handle],
								game,
								pending.triggerUri,
								pending.triggerCid,
							);
						}
					}
				}
			}

			if (stillFailing.length === 0) {
				// All resolved — complete game start
				this.pendingDmRetries.delete(gameId);
				game = this.games.get(gameId) ?? game;
				await this.completeGameStart(game);
				console.log(`DM delivery complete for game ${gameId} — game starting`);
			} else {
				pending.failures = stillFailing;
				const updated = { ...game, pendingDmDids: stillFailing.map((f) => f.did) };
				this.persist(updated);
			}
		}
	}

	/** Send a DM during an active game. On failure, post a public warning nudging the player. */
	private async sendGameDm(state: GameState, recipientDid: Did, text: string): Promise<boolean> {
		const ok = await this.dm.sendDm(recipientDid, text);
		if (!ok) {
			const player = state.players.find((p) => p.did === recipientDid);
			if (player) {
				const warning = `⚠️ @${player.handle} — couldn't send you a DM. Either follow @skeetwolf.bsky.social or open your Bluesky chat settings so you can receive game messages.`;
				try {
					if (state.dayThreadUri) {
						await this.postInThread(state, warning, 'reply');
					} else if (state.announcementUri) {
						await this.postInThread(state, warning, 'reply');
					}
				} catch (err) {
					console.error(`Failed to post mid-game DM warning for ${player.handle}:`, err);
				}
			}
		}
		return ok;
	}

	/** Build role DM text for a specific player */
	private buildRoleDmText(game: GameState, playerDid: Did): string {
		const player = game.players.find((p) => p.did === playerDid);
		if (!player) return '';
		const f = this.flavorFor(game.id);
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
		const playerList = game.players.map((p) => `@${p.handle}`).join(', ');
		let message = `🐺 Skeetwolf Game #${game.id}\n\nPlayers: ${playerList}\n\n${roleText}`;
		if (teammates) {
			message += `\nYour mafia teammates: ${teammates}`;
		}
		const faqUrl = process.env['FAQ_URL'];
		if (faqUrl) {
			message += `\n\nHow to play: ${faqUrl}`;
		}
		return message;
	}

	private async announceWinner(state: GameState): Promise<void> {
		const winnersStr = state.players
			.filter((p) => alignmentOf(p.role) === state.winner)
			.map((p) => `@${p.handle}`)
			.join(', ');
		const rolesStr = state.players.map((p) => `@${p.handle} (${p.role})`).join(', ');
		const f = this.flavorFor(state.id);
		const variants = state.winner === 'town' ? f.townWins : f.mafiaWins;
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
			this.voteCountLastPostedHour.delete(state.id);
			this.pendingDmRetries.delete(state.id);
		}
	}

	/** Post a day thread — top-level for Day 1, QT of previous day for Day 2+.
	 *  Auto-splits long text into a chain and records all posts. */
	private async postDayThread(
		state: GameState,
		text: string,
		previousDayUri?: string,
		previousDayCid?: string,
	): Promise<{ uri: string; cid: string }> {
		const labels = POST_KIND_LABELS.day_thread;
		let refs: [PostRef, ...PostRef[]];

		if (previousDayUri && previousDayCid) {
			// QT the previous day: delete postgate → QT → re-create postgate
			try {
				await deletePostgate(this.agent, previousDayUri);
			} catch {
				// Postgate might not exist (e.g., first run after upgrade)
			}
			refs = await postWithQuoteChain(this.agent, text, previousDayUri, previousDayCid, labels);
			try {
				await createPostgate(this.agent, previousDayUri);
			} catch (err) {
				console.error(`Failed to re-create postgate for ${previousDayUri}:`, err);
			}
		} else {
			// Day 1: top-level post
			refs = await postMessageChain(this.agent, text, labels);
		}

		// Postgate, label, and record every post in the chain
		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = `${state.phase.kind}-${state.phase.number}`;
		for (const ref of refs) {
			try {
				await createPostgate(this.agent, ref.uri);
			} catch (err) {
				console.error(`Failed to create postgate for day thread ${ref.uri}:`, err);
			}
			if (this.labeler) {
				await labelPost(this.labeler, ref.uri, 'skeetwolf-game');
			}
			recordGamePost(this.db, {
				uri: ref.uri,
				gameId: state.id,
				authorDid: botDid,
				kind: 'day_thread',
				phase,
			});
		}

		const [first] = refs;
		return first;
	}

	/** Post a top-level message, add postgate, label, and record in game_posts.
	 *  Auto-splits long text into a chain and records all posts. */
	private async post(
		gameId: GameId,
		text: string,
		kind: PostKind,
	): Promise<{ uri: string; cid: string }> {
		const [first, ...rest] = await postMessageChain(this.agent, text, POST_KIND_LABELS[kind]);

		const botDid = this.agent.session?.did ?? 'unknown';
		const state = this.games.get(gameId);
		const phase = state ? `${state.phase.kind}-${state.phase.number}` : null;
		for (const ref of [first, ...rest]) {
			try {
				await createPostgate(this.agent, ref.uri);
			} catch (err) {
				console.error(`Failed to create postgate for ${ref.uri}:`, err);
			}
			if (this.labeler) {
				await labelPost(this.labeler, ref.uri, 'skeetwolf-game');
			}
			recordGamePost(this.db, { uri: ref.uri, gameId, authorDid: botDid, kind, phase });
		}

		return first;
	}

	/** Post a reply in the current day thread. Falls back to standalone reply if no thread.
	 *  Auto-splits long text into a chain and records all posts. */
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

		const [first, ...rest] = await replyToPostChain(
			this.agent,
			text,
			rootUri,
			rootCid,
			rootUri,
			rootCid,
			POST_KIND_LABELS[kind],
		);

		// Postgate, label, and record every post in the chain
		const botDid = this.agent.session?.did ?? 'unknown';
		const phase = `${state.phase.kind}-${state.phase.number}`;
		for (const ref of [first, ...rest]) {
			try {
				await createPostgate(this.agent, ref.uri);
			} catch (err) {
				console.error(`Failed to create postgate for reply ${ref.uri}:`, err);
			}
			if (this.labeler) {
				await labelPost(this.labeler, ref.uri, 'skeetwolf-game');
			}
			recordGamePost(this.db, { uri: ref.uri, gameId: state.id, authorDid: botDid, kind, phase });
		}

		return first;
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
		let state = createGame(id, {}, randomFlavorPackName());
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
				`🐺 Game #${id} starting — ${flavor(this.flavorFor(id).gameStart)}`,
				triggerUri,
				triggerCid,
			);
		}

		const failures = await this.announceGameStart(state);
		if (failures.length > 0) {
			this.enterPendingDmState(state, failures, triggerUri, triggerCid);
		}
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

		let state = createGame(id, {}, randomFlavorPackName());
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
				`🐺 Game #${id} starting — ${flavor(this.flavorFor(id).gameStart)}`,
				triggerUri,
				triggerCid,
			);
		}

		const failures = await this.announceGameStart(state);
		if (failures.length > 0) {
			this.enterPendingDmState(state, failures, triggerUri, triggerCid);
		}

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

	/** Build the bsky.app feed URL for a game */
	private feedUrl(gameId: GameId): string {
		const did = process.env['FEED_PUBLISHER_DID'] ?? this.agent.session?.did ?? 'unknown';
		return `https://bsky.app/profile/${did}/feed/skeetwolf-${gameId}`;
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

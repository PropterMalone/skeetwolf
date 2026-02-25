/**
 * Skeetwolf engine entry point.
 * Connects to Bluesky, hydrates game state, starts polling loop.
 */
import { createAgent, pollMentions, resolveHandle } from './bot.js';
import { parseDm, parseMention } from './command-parser.js';
import { loadBotState, openDatabase, saveBotState } from './db.js';
import {
	createBlueskyDmSender,
	createChatAgent,
	createConsoleDmSender,
	pollInboundDms,
} from './dm.js';
import type { DmSender } from './dm.js';
import { GameManager } from './game-manager.js';
import { createLabelerClient } from './labeler-client.js';

let BOT_HANDLE = 'skeetwolf.bsky.social';

const POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const POLL_TIMEOUT_MS = 60_000;

/** Run an async function with a timeout. Rejects with an error if the timeout is exceeded. */
function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		fn().then(
			(val) => {
				clearTimeout(timer);
				resolve(val);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

process.on('unhandledRejection', (err) => {
	console.error('Unhandled rejection:', err);
});

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const useLiveDms = process.env['LIVE_DMS'] === '1';

	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD environment variables');
		process.exit(1);
	}

	const db = openDatabase(process.env['DB_PATH'] || 'skeetwolf.db');
	const agent = await createAgent({ identifier, password });

	if (agent.session?.handle) {
		BOT_HANDLE = agent.session.handle;
	}

	const dm = useLiveDms ? createBlueskyDmSender(createChatAgent(agent)) : createConsoleDmSender();
	const chatAgent = useLiveDms ? createChatAgent(agent) : null;

	const labelerUrl = process.env['LABELER_URL'];
	const labelerSecret = process.env['LABELER_SECRET'];
	const labeler =
		labelerUrl && labelerSecret ? createLabelerClient(labelerUrl, labelerSecret) : null;
	if (labeler) console.log(`Labeler: ${labelerUrl}`);

	const manager = new GameManager(db, agent, dm, labeler);
	await manager.hydrate();

	// Graceful shutdown — close DB on SIGTERM/SIGINT (Docker sends SIGTERM on stop)
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			console.log(`${signal} received, shutting down...`);
			db.close();
			process.exit(0);
		});
	}

	console.log(
		`Skeetwolf engine started as @${BOT_HANDLE}. DMs: ${useLiveDms ? 'LIVE' : 'console'}. Polling...`,
	);

	let dmMessageId: string | undefined = loadBotState(db, 'dm_message_id') ?? undefined;
	let backoffMs = POLL_INTERVAL_MS;

	// Safety net: track processed mention URIs to prevent duplicate handling
	// even if updateSeenNotifications races or fails
	const processedMentionUris = new Set<string>();

	let pollCount = 0;

	async function poll() {
		let hadError = false;
		pollCount++;

		// --- Mentions (independent of DMs) ---
		try {
			const { notifications } = await withTimeout(
				() => pollMentions(agent),
				POLL_TIMEOUT_MS,
				'pollMentions',
			);

			const botDid = agent.session?.did;
			for (const mention of notifications) {
				if (botDid && mention.authorDid === botDid) continue;
				if (processedMentionUris.has(mention.uri)) {
					console.log(`Skipping already-processed mention: ${mention.uri}`);
					continue;
				}
				processedMentionUris.add(mention.uri);
				await handleMention(
					manager,
					agent,
					mention.uri,
					mention.cid,
					mention.authorDid,
					mention.authorHandle,
					mention.text,
				);
			}

			// Cap the set size to prevent unbounded memory growth
			if (processedMentionUris.size > 1000) {
				const toDelete = [...processedMentionUris].slice(0, 500);
				for (const uri of toDelete) processedMentionUris.delete(uri);
			}
		} catch (err) {
			hadError = true;
			if (isAuthError(err)) {
				console.log('Auth error detected, refreshing session...');
				try {
					await agent.login({ identifier: identifier as string, password: password as string });
					console.log('Session refreshed');
				} catch (loginErr) {
					console.error('Session refresh failed:', loginErr);
				}
			}
			console.error('Mention poll error:', err);
		}

		// --- DMs (independent of mentions) ---
		if (chatAgent) {
			try {
				const { messages, latestMessageId } = await withTimeout(
					() => pollInboundDms(chatAgent, dmMessageId),
					POLL_TIMEOUT_MS,
					'pollInboundDms',
				);

				for (const msg of messages) {
					await handleDm(manager, dm, msg.senderDid, msg.text);
				}

				if (latestMessageId) {
					dmMessageId = latestMessageId;
					saveBotState(db, 'dm_message_id', latestMessageId);
				}
			} catch (err) {
				hadError = true;
				console.error('DM poll error:', err);
			}
		}

		// --- Tick (always runs — phase timers must not stall) ---
		try {
			await manager.tick(Date.now());
		} catch (err) {
			hadError = true;
			console.error('Tick error:', err);
		}

		// Backoff only on errors, reset immediately on clean poll
		if (hadError) {
			backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
			console.log(`Backing off: next poll in ${backoffMs / 1000}s`);
		} else {
			backoffMs = POLL_INTERVAL_MS;
		}

		// Heartbeat every 10 polls (~5 min at normal cadence)
		if (pollCount % 10 === 0) {
			const games = manager.activeGameCount();
			console.log(`[heartbeat] poll #${pollCount}, ${games} active game(s)`);
		}

		setTimeout(poll, backoffMs);
	}

	await poll();
}

function isAuthError(err: unknown): boolean {
	if (err instanceof Error) {
		if (err.message.includes('ExpiredToken')) return true;
	}
	if (typeof err === 'object' && err !== null && 'status' in err) {
		return (err as { status: number }).status === 401;
	}
	return false;
}

async function handleMention(
	manager: GameManager,
	agent: import('@atproto/api').AtpAgent,
	postUri: string,
	postCid: string,
	authorDid: string,
	authorHandle: string,
	text: string,
): Promise<void> {
	const cmd = parseMention(text, BOT_HANDLE);

	switch (cmd.kind) {
		case 'new_game': {
			const id = Date.now().toString(36);
			const game = await manager.newGame(id);
			console.log(`New game created: ${game.id}`);
			await manager.reply(
				id,
				`Game #${id} created — reply "join #${id}" to play`,
				postUri,
				postCid,
			);
			break;
		}
		case 'join': {
			const error = manager.signup(cmd.gameId, authorDid, authorHandle);
			if (error) {
				console.log(`Signup failed for ${authorHandle}: ${error}`);
				await manager.reply(cmd.gameId, error, postUri, postCid);
			} else {
				const game = manager.getGame(cmd.gameId);
				const count = game?.players.length ?? 0;
				const min = game?.config.minPlayers ?? 7;
				console.log(`${authorHandle} joined game ${cmd.gameId}`);
				await manager.reply(
					cmd.gameId,
					`You're in game #${cmd.gameId} (${count}/${min} players)`,
					postUri,
					postCid,
				);
			}
			break;
		}
		case 'start': {
			const error = await manager.startGame(cmd.gameId);
			if (error) {
				console.log(`Start failed for game ${cmd.gameId}: ${error}`);
				await manager.reply(cmd.gameId, error, postUri, postCid);
			} else {
				console.log(`Game ${cmd.gameId} started`);
				await manager.reply(
					cmd.gameId,
					`Game #${cmd.gameId} started — check your DMs for your role`,
					postUri,
					postCid,
				);
			}
			break;
		}
		case 'vote': {
			let voteGameId = cmd.gameId;
			if (!voteGameId) {
				const game = manager.findGameForPlayer(authorDid);
				if (!game) {
					await manager.replyNoGame(
						'Include a game ID (e.g., "vote #abc @player") or join a game first.',
						postUri,
						postCid,
					);
					break;
				}
				voteGameId = game.id;
			}
			let targetDid = manager.resolveHandleInGame(voteGameId, cmd.targetHandle);
			if (!targetDid) {
				targetDid = await resolveHandle(agent, cmd.targetHandle);
			}
			if (!targetDid) {
				console.log(`Could not resolve handle: ${cmd.targetHandle}`);
				await manager.reply(
					voteGameId,
					`Could not resolve handle: @${cmd.targetHandle}`,
					postUri,
					postCid,
				);
				break;
			}
			const { error, majorityReached } = await manager.voteAndCheckMajority(
				voteGameId,
				authorDid,
				targetDid,
			);
			if (error) {
				console.log(`Vote failed: ${error}`);
				await manager.reply(voteGameId, error, postUri, postCid);
			} else {
				const targetHandle = cmd.targetHandle;
				console.log(`${authorHandle} voted for @${targetHandle} in game ${voteGameId}`);
				manager.recordPlayerPost(voteGameId, postUri, authorDid);
				if (!majorityReached) {
					await manager.postVoteCount(voteGameId);
				}
			}
			break;
		}
		case 'unvote': {
			let unvoteGameId = cmd.gameId;
			if (!unvoteGameId) {
				const game = manager.findGameForPlayer(authorDid);
				if (!game) {
					await manager.replyNoGame('Include a game ID or join a game first.', postUri, postCid);
					break;
				}
				unvoteGameId = game.id;
			}
			const error = manager.vote(unvoteGameId, authorDid, null);
			if (error) {
				console.log(`Unvote failed: ${error}`);
				await manager.reply(unvoteGameId, error, postUri, postCid);
			} else {
				console.log(`${authorHandle} unvoted in game ${unvoteGameId}`);
			}
			break;
		}
		case 'vote_count': {
			let countGameId = cmd.gameId;
			if (!countGameId) {
				const game = manager.findGameForPlayer(authorDid);
				if (!game) {
					await manager.replyNoGame(
						'Include a game ID (e.g., "votes #abc") or join a game first.',
						postUri,
						postCid,
					);
					break;
				}
				countGameId = game.id;
			}
			const countText = manager.formatVoteCount(countGameId);
			if (countText) {
				console.log(`${authorHandle} requested vote count for game ${countGameId}`);
				await manager.reply(countGameId, countText, postUri, postCid);
			} else {
				await manager.reply(
					countGameId,
					'Vote count is only available during the day phase.',
					postUri,
					postCid,
				);
			}
			break;
		}
		case 'queue_status': {
			console.log(`${authorHandle} checking queue status`);
			await manager.queueStatus(postUri, postCid);
			break;
		}
		case 'queue': {
			console.log(`${authorHandle} joining queue`);
			await manager.addToQueue(authorDid, authorHandle, postUri, postCid);
			break;
		}
		case 'unqueue': {
			console.log(`${authorHandle} leaving queue`);
			await manager.removeFromQueue(authorDid, postUri, postCid);
			break;
		}
		case 'new_invite_game': {
			console.log(
				`${authorHandle} creating invite game for ${cmd.handles.join(', ')}${cmd.preset ? ` (${cmd.preset})` : ''}`,
			);
			await manager.createInviteGame(
				authorDid,
				authorHandle,
				cmd.handles,
				postUri,
				postCid,
				cmd.preset,
			);
			break;
		}
		case 'confirm': {
			console.log(`${authorHandle} confirming invite ${cmd.gameId}`);
			await manager.confirmInviteSlot(cmd.gameId, authorDid, postUri, postCid);
			break;
		}
		case 'invite': {
			console.log(`${authorHandle} inviting @${cmd.handle} to ${cmd.gameId}`);
			await manager.addInvitePlayer(cmd.gameId, authorDid, cmd.handle, postUri, postCid);
			break;
		}
		case 'cancel': {
			console.log(`${authorHandle} cancelling invite ${cmd.gameId}`);
			await manager.cancelInviteGame(cmd.gameId, authorDid, postUri, postCid);
			break;
		}
		case 'unknown':
			console.log(`Unrecognized mention from ${authorHandle}: ${cmd.text}`);
			break;
	}
}

async function handleDm(
	manager: GameManager,
	dm: DmSender,
	senderDid: string,
	text: string,
): Promise<void> {
	const cmd = parseDm(text);

	switch (cmd.kind) {
		case 'kill':
		case 'investigate':
		case 'protect':
		case 'shoot': {
			const game = manager.findGameForPlayer(senderDid);
			if (!game) {
				console.log(`Night action from ${senderDid} but not in any active game`);
				await dm.sendDm(senderDid, 'You are not in any active game.');
				break;
			}
			const actionKind = cmd.kind === 'shoot' ? 'vigilante_kill' : cmd.kind;
			const error = await manager.nightActionByHandle(
				game.id,
				senderDid,
				actionKind,
				cmd.targetHandle,
			);
			if (error) {
				console.log(`Night action failed: ${error}`);
				await dm.sendDm(senderDid, error);
			} else {
				console.log(`${senderDid}: ${cmd.kind} @${cmd.targetHandle} in game ${game.id}`);
				await dm.sendDm(senderDid, `Action received: ${cmd.kind} @${cmd.targetHandle}`);
			}
			break;
		}
		case 'mafia_chat': {
			const error = await manager.relayMafiaChat(senderDid, cmd.text);
			if (error) {
				console.log(`Mafia relay failed for ${senderDid}: ${error}`);
				await dm.sendDm(senderDid, error);
			}
			break;
		}
		case 'unknown':
			console.log(`Unknown DM from ${senderDid}: ${cmd.text}`);
			break;
	}
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});

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

let BOT_HANDLE = 'skeetwolf.bsky.social';

const POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

async function main() {
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	const useLiveDms = process.env.LIVE_DMS === '1';

	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD environment variables');
		process.exit(1);
	}

	const db = openDatabase(process.env.DB_PATH || 'skeetwolf.db');
	const agent = await createAgent({ identifier, password });

	if (agent.session?.handle) {
		BOT_HANDLE = agent.session.handle;
	}

	const dm = useLiveDms ? createBlueskyDmSender(createChatAgent(agent)) : createConsoleDmSender();
	const chatAgent = useLiveDms ? createChatAgent(agent) : null;

	const manager = new GameManager(db, agent, dm);
	manager.hydrate();

	console.log(
		`Skeetwolf engine started as @${BOT_HANDLE}. DMs: ${useLiveDms ? 'LIVE' : 'console'}. Polling...`,
	);

	let mentionCursor: string | undefined = loadBotState(db, 'mention_cursor') ?? undefined;
	let dmMessageId: string | undefined = loadBotState(db, 'dm_message_id') ?? undefined;
	let backoffMs = POLL_INTERVAL_MS;

	async function poll() {
		try {
			const { notifications, cursor: newCursor } = await pollMentions(agent, mentionCursor);
			if (newCursor) {
				mentionCursor = newCursor;
				saveBotState(db, 'mention_cursor', newCursor);
			}

			for (const mention of notifications) {
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

			if (chatAgent) {
				const { messages, latestMessageId } = await pollInboundDms(chatAgent, dmMessageId);
				if (latestMessageId) {
					dmMessageId = latestMessageId;
					saveBotState(db, 'dm_message_id', latestMessageId);
				}

				for (const msg of messages) {
					await handleDm(manager, dm, msg.senderDid, msg.text);
				}
			}

			await manager.tick(Date.now());

			// Reset backoff on success
			backoffMs = POLL_INTERVAL_MS;
		} catch (err) {
			// Session refresh on auth errors
			if (isAuthError(err)) {
				console.log('Auth error detected, refreshing session...');
				try {
					await agent.login({ identifier, password });
					console.log('Session refreshed');
				} catch (loginErr) {
					console.error('Session refresh failed:', loginErr);
				}
			}

			console.error('Poll error:', err);
			backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
			console.log(`Backing off: next poll in ${backoffMs / 1000}s`);
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
				const min = game?.config.minPlayers ?? 5;
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
			if (!cmd.gameId) {
				console.log(`Vote from ${authorHandle} missing game ID`);
				break;
			}
			let targetDid = manager.resolveHandleInGame(cmd.gameId, cmd.targetHandle);
			if (!targetDid) {
				targetDid = await resolveHandle(agent, cmd.targetHandle);
			}
			if (!targetDid) {
				console.log(`Could not resolve handle: ${cmd.targetHandle}`);
				await manager.reply(
					cmd.gameId,
					`Could not resolve handle: @${cmd.targetHandle}`,
					postUri,
					postCid,
				);
				break;
			}
			const { error, majorityReached } = await manager.voteAndCheckMajority(
				cmd.gameId,
				authorDid,
				targetDid,
			);
			if (error) {
				console.log(`Vote failed: ${error}`);
				await manager.reply(cmd.gameId, error, postUri, postCid);
			} else {
				const targetHandle = cmd.targetHandle;
				console.log(`${authorHandle} voted for @${targetHandle} in game ${cmd.gameId}`);
				manager.recordPlayerPost(cmd.gameId, postUri, authorDid);
				let replyText = `Vote recorded: @${authorHandle} → @${targetHandle}`;
				if (majorityReached) {
					replyText += ' — majority reached!';
				}
				await manager.reply(cmd.gameId, replyText, postUri, postCid);
			}
			break;
		}
		case 'unvote': {
			if (!cmd.gameId) {
				console.log(`Unvote from ${authorHandle} missing game ID`);
				break;
			}
			const error = manager.vote(cmd.gameId, authorDid, null);
			if (error) {
				console.log(`Unvote failed: ${error}`);
				await manager.reply(cmd.gameId, error, postUri, postCid);
			} else {
				console.log(`${authorHandle} unvoted in game ${cmd.gameId}`);
				await manager.reply(cmd.gameId, 'Vote withdrawn', postUri, postCid);
			}
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
		case 'protect': {
			const game = manager.findGameForPlayer(senderDid);
			if (!game) {
				console.log(`Night action from ${senderDid} but not in any active game`);
				await dm.sendDm(senderDid, 'You are not in any active game.');
				break;
			}
			const error = manager.nightActionByHandle(game.id, senderDid, cmd.kind, cmd.targetHandle);
			if (error) {
				console.log(`Night action failed: ${error}`);
				await dm.sendDm(senderDid, error);
			} else {
				console.log(`${senderDid}: ${cmd.kind} @${cmd.targetHandle} in game ${game.id}`);
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

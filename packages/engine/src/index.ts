/**
 * Skeetwolf engine entry point.
 * Connects to Bluesky, hydrates game state, starts polling loop.
 */
import { createAgent, pollMentions, resolveHandle } from './bot.js';
import { parseDm, parseMention } from './command-parser.js';
import { openDatabase } from './db.js';
import {
	createBlueskyDmSender,
	createChatAgent,
	createConsoleDmSender,
	pollInboundDms,
} from './dm.js';
import { GameManager } from './game-manager.js';

let BOT_HANDLE = 'skeetwolf.bsky.social';

async function main() {
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	const useLiveDms = process.env.LIVE_DMS === '1';

	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD environment variables');
		process.exit(1);
	}

	const db = openDatabase('skeetwolf.db');
	const agent = await createAgent({ identifier, password });

	// Resolve actual bot handle from session
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

	let mentionCursor: string | undefined;
	let dmMessageId: string | undefined;
	const POLL_INTERVAL_MS = 30_000;

	async function poll() {
		try {
			const { notifications, cursor: newCursor } = await pollMentions(agent, mentionCursor);
			mentionCursor = newCursor;

			for (const mention of notifications) {
				await handleMention(manager, agent, mention.authorDid, mention.authorHandle, mention.text);
			}

			if (chatAgent) {
				const { messages, latestMessageId } = await pollInboundDms(chatAgent, dmMessageId);
				dmMessageId = latestMessageId;

				for (const msg of messages) {
					await handleDm(manager, msg.senderDid, msg.text);
				}
			}

			await manager.tick(Date.now());
		} catch (err) {
			console.error('Poll error:', err);
		}
	}

	await poll();
	setInterval(poll, POLL_INTERVAL_MS);
}

async function handleMention(
	manager: GameManager,
	agent: import('@atproto/api').AtpAgent,
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
			break;
		}
		case 'join': {
			const error = manager.signup(cmd.gameId, authorDid, authorHandle);
			if (error) console.log(`Signup failed for ${authorHandle}: ${error}`);
			else console.log(`${authorHandle} joined game ${cmd.gameId}`);
			break;
		}
		case 'start': {
			const error = await manager.startGame(cmd.gameId);
			if (error) console.log(`Start failed for game ${cmd.gameId}: ${error}`);
			else console.log(`Game ${cmd.gameId} started`);
			break;
		}
		case 'vote': {
			if (!cmd.gameId) {
				console.log(`Vote from ${authorHandle} missing game ID`);
				break;
			}
			// Try local resolution first, fall back to API
			let targetDid = manager.resolveHandleInGame(cmd.gameId, cmd.targetHandle);
			if (!targetDid) {
				targetDid = await resolveHandle(agent, cmd.targetHandle);
			}
			if (!targetDid) {
				console.log(`Could not resolve handle: ${cmd.targetHandle}`);
				break;
			}
			const error = manager.vote(cmd.gameId, authorDid, targetDid);
			if (error) console.log(`Vote failed: ${error}`);
			else console.log(`${authorHandle} voted for @${cmd.targetHandle} in game ${cmd.gameId}`);
			break;
		}
		case 'unvote': {
			if (!cmd.gameId) {
				console.log(`Unvote from ${authorHandle} missing game ID`);
				break;
			}
			const error = manager.vote(cmd.gameId, authorDid, null);
			if (error) console.log(`Unvote failed: ${error}`);
			else console.log(`${authorHandle} unvoted in game ${cmd.gameId}`);
			break;
		}
		case 'unknown':
			console.log(`Unrecognized mention from ${authorHandle}: ${cmd.text}`);
			break;
	}
}

async function handleDm(manager: GameManager, senderDid: string, text: string): Promise<void> {
	const cmd = parseDm(text);

	switch (cmd.kind) {
		case 'kill':
		case 'investigate':
		case 'protect': {
			const game = manager.findGameForPlayer(senderDid);
			if (!game) {
				console.log(`Night action from ${senderDid} but not in any active game`);
				break;
			}
			const error = manager.nightActionByHandle(game.id, senderDid, cmd.kind, cmd.targetHandle);
			if (error) console.log(`Night action failed: ${error}`);
			else console.log(`${senderDid}: ${cmd.kind} @${cmd.targetHandle} in game ${game.id}`);
			break;
		}
		case 'mafia_chat': {
			const error = await manager.relayMafiaChat(senderDid, cmd.text);
			if (error) console.log(`Mafia relay failed for ${senderDid}: ${error}`);
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

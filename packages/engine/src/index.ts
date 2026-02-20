/**
 * Skeetwolf engine entry point.
 * Connects to Bluesky, hydrates game state, starts polling loop.
 */
import { createAgent, createConsoleDmSender, pollMentions } from './bot.js';
import { openDatabase } from './db.js';
import { GameManager } from './game-manager.js';

async function main() {
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;

	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD environment variables');
		process.exit(1);
	}

	const db = openDatabase('skeetwolf.db');
	const agent = await createAgent({ identifier, password });
	const dm = createConsoleDmSender(); // TODO: replace with real DM sender

	const manager = new GameManager(db, agent, dm);
	manager.hydrate();

	console.log('Skeetwolf engine started. Polling for mentions...');

	// Main poll loop
	let cursor: string | undefined;
	const POLL_INTERVAL_MS = 30_000; // 30 seconds

	async function poll() {
		try {
			const { notifications, cursor: newCursor } = await pollMentions(agent, cursor);
			cursor = newCursor;

			for (const mention of notifications) {
				await handleMention(manager, mention.authorDid, mention.authorHandle, mention.text);
			}
		} catch (err) {
			console.error('Poll error:', err);
		}
	}

	// Initial poll + interval
	await poll();
	setInterval(poll, POLL_INTERVAL_MS);
}

/**
 * Parse and route mention commands.
 * Recognized commands:
 *   "new game" — create a new game
 *   "join #<id>" — sign up for a game
 *   "vote @<handle>" — cast a vote
 *   "unvote" — retract vote
 */
async function handleMention(
	manager: GameManager,
	authorDid: string,
	authorHandle: string,
	text: string,
): Promise<void> {
	const lower = text.toLowerCase();

	if (lower.includes('new game')) {
		const id = Date.now().toString(36); // simple unique-enough ID
		const game = await manager.newGame(id);
		console.log(`New game created: ${game.id}`);
		return;
	}

	const joinMatch = lower.match(/join\s+#?(\w+)/);
	if (joinMatch?.[1]) {
		const error = manager.signup(joinMatch[1], authorDid, authorHandle);
		if (error) console.log(`Signup failed for ${authorHandle}: ${error}`);
		else console.log(`${authorHandle} joined game ${joinMatch[1]}`);
		return;
	}

	// TODO: vote parsing, start game command, etc.
	console.log(`Unrecognized mention from ${authorHandle}: ${text}`);
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});

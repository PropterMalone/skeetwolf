/**
 * Live test: queue + invite commands from bobbyquine.bsky.social → skeetwolf.bsky.social
 * Run with: BOBBY_IDENTIFIER=bobbyquine.bsky.social BOBBY_PASSWORD=... npx tsx scripts/live-test-queue.ts
 */
import { AtpAgent, RichText } from '@atproto/api';

const BOT_HANDLE = 'skeetwolf.bsky.social';
const POLL_WAIT_MS = 35_000; // wait for bot to poll + process

async function main() {
	const identifier = process.env.BOBBY_IDENTIFIER;
	const password = process.env.BOBBY_PASSWORD;
	if (!identifier || !password) {
		console.error('Set BOBBY_IDENTIFIER and BOBBY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle}`);

	const postedUris: string[] = [];

	async function mention(text: string): Promise<{ uri: string; cid: string }> {
		const fullText = `@${BOT_HANDLE} ${text}`;
		const rt = new RichText({ text: fullText });
		await rt.detectFacets(agent);
		const result = await agent.post({
			text: rt.text,
			facets: rt.facets,
		});
		postedUris.push(result.uri);
		console.log(`\n>>> Posted: "${fullText}"`);
		return result;
	}

	let lastSeenBotPostUri: string | undefined;

	async function waitForReply(_parentUri: string, label: string): Promise<string | null> {
		console.log(`    Waiting ${POLL_WAIT_MS / 1000}s for bot to respond (${label})...`);
		await sleep(POLL_WAIT_MS);

		// Check bot's recent posts for the newest one we haven't seen
		const botDid = await agent.resolveHandle({ handle: BOT_HANDLE });
		const feed = await agent.getAuthorFeed({ actor: botDid.data.did, limit: 5 });
		const posts = feed.data.feed;

		for (const item of posts) {
			const uri = item.post.uri;
			if (uri === lastSeenBotPostUri) break; // Already seen this one
			const record = item.post.record as Record<string, unknown>;
			const text = record.text as string;
			// Check if it's a reply (has reply parent)
			const replyRef = record.reply;
			if (replyRef) {
				console.log(`    <<< Bot replied: "${text}"`);
				lastSeenBotPostUri = uri;
				return text;
			}
		}

		// Fallback: just return the newest post if it's new
		if (posts.length > 0 && posts[0]?.post.uri !== lastSeenBotPostUri) {
			const text = (posts[0]?.post.record as Record<string, unknown>).text as string;
			console.log(`    <<< Bot posted: "${text}"`);
			lastSeenBotPostUri = posts[0]?.post.uri;
			return text;
		}

		console.log('    <<< No bot reply found');
		return null;
	}

	async function cleanup() {
		console.log(`\nCleaning up ${postedUris.length} test posts...`);
		for (const uri of postedUris) {
			try {
				await agent.deletePost(uri);
			} catch {
				// bot's posts can't be deleted from this account
			}
			await sleep(200);
		}

		// Also clean up the bot's posts (the game announcement from stale notification)
		const botAgent = new AtpAgent({ service: 'https://bsky.social' });
		const botId = process.env.BSKY_IDENTIFIER;
		const botPw = process.env.BSKY_PASSWORD;
		if (botId && botPw) {
			await botAgent.login({ identifier: botId, password: botPw });
			const feed = await botAgent.getAuthorFeed({
				actor: botAgent.session?.did,
				limit: 50,
			});
			for (const item of feed.data.feed) {
				await botAgent.deletePost(item.post.uri);
				await sleep(200);
			}
			console.log(`Cleaned up ${feed.data.feed.length} bot posts`);
		}
		console.log('Cleanup done');
	}

	try {
		// Test 1: Queue status (empty)
		console.log('\n=== Test 1: Queue status (empty) ===');
		const status1 = await mention('queue?');
		const reply1 = await waitForReply(status1.uri, 'queue status');
		assert(reply1?.includes('empty'), 'Expected empty queue', reply1);

		// Test 2: Join queue
		console.log('\n=== Test 2: Join queue ===');
		const join1 = await mention('queue');
		const reply2 = await waitForReply(join1.uri, 'queue join');
		assert(reply2?.includes('1/5'), 'Expected 1/5 count', reply2);

		// Test 3: Queue status (1 player)
		console.log('\n=== Test 3: Queue status (1 player) ===');
		const status2 = await mention('queue?');
		const reply3 = await waitForReply(status2.uri, 'queue status');
		assert(
			reply3?.includes('1/5') && reply3?.includes('bobbyquine'),
			'Expected bobby in queue',
			reply3,
		);

		// Test 4: Duplicate queue join
		console.log('\n=== Test 4: Duplicate queue join ===');
		const join2 = await mention('queue');
		const reply4 = await waitForReply(join2.uri, 'duplicate join');
		assert(reply4?.includes('already'), 'Expected already in queue', reply4);

		// Test 5: Leave queue
		console.log('\n=== Test 5: Leave queue ===');
		const leave = await mention('unqueue');
		const reply5 = await waitForReply(leave.uri, 'unqueue');
		assert(reply5?.includes('left'), 'Expected left the queue', reply5);

		// Test 6: Create invite game
		console.log('\n=== Test 6: Create invite game ===');
		const invite = await mention('new game @proptermalone.bsky.social @skyhooked.bsky.social');
		const reply6 = await waitForReply(invite.uri, 'invite create');
		assert(reply6?.includes('Invite game'), 'Expected invite created', reply6);

		// Extract game ID from reply
		const gameIdMatch = reply6?.match(/#(\w+)/);
		const gameId = gameIdMatch?.[1];
		assert(gameId, 'Expected game ID in reply', reply6);

		// Test 7: Cancel invite
		console.log('\n=== Test 7: Cancel invite ===');
		const cancel = await mention(`cancel #${gameId}`);
		const reply7 = await waitForReply(cancel.uri, 'cancel');
		assert(reply7?.includes('cancelled'), 'Expected cancelled', reply7);

		console.log('\n✓ All tests passed!');
	} catch (err) {
		console.error('\n✗ Test failed:', err);
	} finally {
		await cleanup();
	}
}

function assert(condition: unknown, message: string, actual?: string | null): void {
	if (!condition) {
		throw new Error(`${message} (got: ${actual ?? 'null'})`);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});

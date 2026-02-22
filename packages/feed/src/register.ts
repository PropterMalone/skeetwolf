/**
 * One-time CLI script to register the Skeetwolf feed generator with Bluesky.
 *
 * Creates/updates an app.bsky.feed.generator record in the bot account's repo
 * that points to the feed service.
 *
 * Required env vars:
 *   BSKY_IDENTIFIER  — bot's Bluesky handle or DID
 *   BSKY_PASSWORD    — bot's app password
 *   FEED_SERVICE_DID — did:web of the feed server (e.g. did:web:feed.skeetwolf.example)
 *   FEED_HOSTNAME    — hostname for the feed service endpoint
 *
 * Usage: npx tsx src/register.ts
 */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const feedServiceDid = process.env['FEED_SERVICE_DID'];
	const feedHostname = process.env['FEED_HOSTNAME'];

	if (!identifier || !password || !feedServiceDid || !feedHostname) {
		console.error(
			'Missing required env vars: BSKY_IDENTIFIER, BSKY_PASSWORD, FEED_SERVICE_DID, FEED_HOSTNAME',
		);
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle} (${agent.session?.did})`);

	const record = {
		did: feedServiceDid,
		displayName: 'Skeetwolf',
		description:
			'Forum Mafia (Werewolf) games on Bluesky. Follow game announcements, votes, and eliminations.',
		createdAt: new Date().toISOString(),
	};

	const response = await agent.com.atproto.repo.putRecord({
		repo: agent.session?.did ?? identifier,
		collection: 'app.bsky.feed.generator',
		rkey: 'skeetwolf',
		record,
	});

	console.log(`Feed generator registered: ${response.data.uri}`);
	console.log(`Service DID: ${feedServiceDid}`);
	console.log(`Hostname: ${feedHostname}`);
}

main().catch((err) => {
	console.error('Feed registration failed:', err);
	process.exit(1);
});

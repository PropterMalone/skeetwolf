/**
 * One-time script to register the Skeetwolf feed generator with Bluesky.
 * Publishes an app.bsky.feed.generator record so the main feed appears in search.
 *
 * Usage:
 *   npx tsx scripts/register-feed.ts
 *
 * Env vars: BSKY_IDENTIFIER, BSKY_PASSWORD, FEED_PUBLISHER_DID, FEED_HOSTNAME
 */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	const publisherDid = process.env.FEED_PUBLISHER_DID;
	const feedHostname = process.env.FEED_HOSTNAME;

	if (!identifier || !password || !publisherDid || !feedHostname) {
		console.error(
			'Required env vars: BSKY_IDENTIFIER, BSKY_PASSWORD, FEED_PUBLISHER_DID, FEED_HOSTNAME',
		);
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	const did = agent.session?.did;
	if (!did) {
		console.error('Login failed — no session DID');
		process.exit(1);
	}

	// Register the main skeetwolf feed
	const rkey = 'skeetwolf';
	try {
		await agent.api.com.atproto.repo.createRecord({
			repo: did,
			collection: 'app.bsky.feed.generator',
			rkey,
			record: {
				did: publisherDid,
				displayName: 'Skeetwolf',
				description:
					'Forum Mafia (Werewolf) on Bluesky. Follow all active Skeetwolf games — day threads, votes, eliminations, and results.',
				createdAt: new Date().toISOString(),
			},
		});
		console.log(`Feed registered: at://${did}/app.bsky.feed.generator/${rkey}`);
	} catch (err) {
		if (String(err).includes('already exists')) {
			console.log('Feed already registered, updating...');
			await agent.api.com.atproto.repo.putRecord({
				repo: did,
				collection: 'app.bsky.feed.generator',
				rkey,
				record: {
					did: publisherDid,
					displayName: 'Skeetwolf',
					description:
						'Forum Mafia (Werewolf) on Bluesky. Follow all active Skeetwolf games — day threads, votes, eliminations, and results.',
					createdAt: new Date().toISOString(),
				},
			});
			console.log('Feed record updated');
		} else {
			throw err;
		}
	}
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});

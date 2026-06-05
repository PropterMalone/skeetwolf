/**
 * One-shot cleanup script: deletes all posts from the bot's account.
 * Run with: npx tsx scripts/cleanup-spam.ts
 * Requires BSKY_IDENTIFIER and BSKY_PASSWORD env vars.
 */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	const did = agent.session?.did;
	console.log(`Logged in as ${agent.session?.handle} (${did})`);

	let cursor: string | undefined;
	let deleted = 0;

	do {
		const response = await agent.getAuthorFeed({ actor: did, limit: 100, cursor });
		const posts = response.data.feed;
		cursor = response.data.cursor;

		for (const item of posts) {
			const uri = item.post.uri;
			console.log(`Deleting: ${uri}`);
			await agent.deletePost(uri);
			deleted++;
			// Small delay to avoid rate limits
			await new Promise((r) => setTimeout(r, 200));
		}
	} while (cursor);

	console.log(`Done. Deleted ${deleted} posts.`);
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});

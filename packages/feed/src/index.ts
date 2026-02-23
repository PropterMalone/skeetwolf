/**
 * Skeetwolf feed generator.
 *
 * Serves app.bsky.feed.getFeedSkeleton for per-game feeds.
 * Reads from the engine's SQLite database (game_posts table).
 *
 * Feed URIs follow the pattern:
 *   at://{publisher-did}/app.bsky.feed.generator/skeetwolf-{gameId}
 *
 * The ?feed query param from Bluesky contains the full URI. We extract
 * the game ID from the rkey (the part after the last slash).
 */
import { createServer } from 'node:http';
import { FAQ_HTML } from './faq.js';
import { createFeedHandler } from './handler.js';

const PORT = Number(process.env.FEED_PORT) || 3001;
const DB_PATH = process.env.DB_PATH || '../engine/skeetwolf.db';
const PUBLISHER_DID = process.env.FEED_PUBLISHER_DID ?? 'did:web:skeetwolf.example';

const handler = createFeedHandler(DB_PATH, PUBLISHER_DID);

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

	if (url.pathname === '/xrpc/app.bsky.feed.getFeedSkeleton') {
		try {
			const result = handler(url.searchParams);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(result));
		} catch (err) {
			console.error('Feed error:', err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'InternalServerError', message: 'feed generation failed' }));
		}
		return;
	}

	if (url.pathname === '/xrpc/app.bsky.feed.describeFeedGenerator') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				did: PUBLISHER_DID,
				feeds: handler.listFeeds(),
			}),
		);
		return;
	}

	if (url.pathname === '/.well-known/did.json') {
		const hostname = process.env.FEED_HOSTNAME ?? 'localhost';
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: `did:web:${hostname}`,
				service: [
					{
						id: '#bsky_fg',
						type: 'BskyFeedGenerator',
						serviceEndpoint: `https://${hostname}`,
					},
				],
			}),
		);
		return;
	}

	if (url.pathname === '/faq') {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(FAQ_HTML);
		return;
	}

	// Health check
	if (url.pathname === '/') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('skeetwolf feed generator');
		return;
	}

	res.writeHead(404);
	res.end('not found');
});

server.listen(PORT, () => {
	console.log(`Skeetwolf feed generator listening on port ${PORT}`);
	console.log(`DB: ${DB_PATH}`);
});

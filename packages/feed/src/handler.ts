/**
 * Feed skeleton handler — pure logic, no HTTP concerns.
 * Reads game_posts from SQLite, returns feed skeletons.
 */
import Database from 'better-sqlite3';

export interface FeedSkeleton {
	feed: { post: string }[];
	cursor?: string;
}

export interface FeedInfo {
	uri: string;
}

export interface FeedHandler {
	(params: URLSearchParams): FeedSkeleton;
	listFeeds(): FeedInfo[];
	close(): void;
}

/**
 * Create a feed handler backed by the given SQLite database.
 *
 * Feed URI format: at://{did}/app.bsky.feed.generator/skeetwolf-{gameId}
 * The feed param is the full AT URI. We extract the game ID from the rkey.
 */
export function createFeedHandler(dbPath: string, publisherDid: string): FeedHandler {
	const db = new Database(dbPath, { readonly: true });
	db.pragma('journal_mode = WAL');

	const handler = ((params: URLSearchParams): FeedSkeleton => {
		const feedUri = params.get('feed');
		if (!feedUri) {
			return { feed: [] };
		}

		const gameId = extractGameId(feedUri);
		if (!gameId) {
			return { feed: [] };
		}

		const limit = Math.min(Number(params.get('limit')) || 30, 100);
		const cursorParam = params.get('cursor');
		const cursor = cursorParam ? Number(cursorParam) : undefined;

		const posts = getGamePosts(db, gameId, limit, cursor);

		const feed = posts.map((p) => ({ post: p.uri }));
		const lastPost = posts[posts.length - 1];
		const nextCursor = lastPost ? String(lastPost.indexed_at) : undefined;

		return { feed, cursor: nextCursor };
	}) as FeedHandler;

	handler.close = () => db.close();

	handler.listFeeds = (): FeedInfo[] => {
		const rows = db.prepare('SELECT DISTINCT game_id FROM game_posts ORDER BY game_id').all() as {
			game_id: string;
		}[];
		return rows.map((r) => ({
			uri: `at://${publisherDid}/app.bsky.feed.generator/skeetwolf-${r.game_id}`,
		}));
	};

	return handler;
}

/** Extract game ID from feed URI rkey: "skeetwolf-{gameId}" */
function extractGameId(feedUri: string): string | null {
	// at://did:web:example/app.bsky.feed.generator/skeetwolf-abc123
	const rkey = feedUri.split('/').pop();
	if (!rkey?.startsWith('skeetwolf-')) return null;
	return rkey.slice('skeetwolf-'.length);
}

interface PostRow {
	uri: string;
	game_id: string;
	author_did: string;
	kind: string;
	phase: string | null;
	indexed_at: number;
}

function getGamePosts(
	db: Database.Database,
	gameId: string,
	limit: number,
	cursor?: number,
): PostRow[] {
	if (cursor) {
		return db
			.prepare(
				'SELECT * FROM game_posts WHERE game_id = ? AND indexed_at < ? ORDER BY indexed_at DESC LIMIT ?',
			)
			.all(gameId, cursor, limit) as PostRow[];
	}
	return db
		.prepare('SELECT * FROM game_posts WHERE game_id = ? ORDER BY indexed_at DESC LIMIT ?')
		.all(gameId, limit) as PostRow[];
}

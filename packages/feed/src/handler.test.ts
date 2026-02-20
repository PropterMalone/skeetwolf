import { existsSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FeedHandler, createFeedHandler } from './handler.js';

const TEST_DB = 'test-feed.db';

function setupDb(): Database.Database {
	const db = new Database(TEST_DB);
	db.pragma('journal_mode = WAL');
	db.exec(`
		CREATE TABLE IF NOT EXISTS game_posts (
			uri TEXT PRIMARY KEY,
			game_id TEXT NOT NULL,
			author_did TEXT NOT NULL,
			kind TEXT NOT NULL,
			phase TEXT,
			indexed_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_game_posts_game_id ON game_posts(game_id, indexed_at);
	`);
	return db;
}

function insertPost(
	db: Database.Database,
	uri: string,
	gameId: string,
	indexedAt: number,
	kind = 'phase',
) {
	db.prepare(
		'INSERT INTO game_posts (uri, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
	).run(uri, gameId, 'did:plc:bot', kind, 'day-1', indexedAt);
}

describe('feed handler', () => {
	let db: Database.Database;
	let handler: FeedHandler | null = null;

	beforeEach(() => {
		db = setupDb();
	});

	afterEach(() => {
		handler?.close();
		handler = null;
		db.close();
		if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
		for (const suffix of ['-wal', '-shm']) {
			if (existsSync(TEST_DB + suffix)) unlinkSync(TEST_DB + suffix);
		}
	});

	it('returns empty feed for unknown game', () => {
		handler = createFeedHandler(TEST_DB);
		const params = new URLSearchParams({
			feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-nonexistent',
		});
		const result = handler(params);
		expect(result.feed).toHaveLength(0);
	});

	it('returns posts for a game', () => {
		insertPost(db, 'at://did:plc:bot/post/1', 'game1', 1000);
		insertPost(db, 'at://did:plc:bot/post/2', 'game1', 2000);
		insertPost(db, 'at://did:plc:bot/post/3', 'game2', 3000); // different game

		handler = createFeedHandler(TEST_DB);
		const params = new URLSearchParams({
			feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-game1',
		});
		const result = handler(params);
		expect(result.feed).toHaveLength(2);
		// Newest first
		expect(result.feed[0]?.post).toBe('at://did:plc:bot/post/2');
		expect(result.feed[1]?.post).toBe('at://did:plc:bot/post/1');
	});

	it('supports cursor-based pagination', () => {
		for (let i = 1; i <= 5; i++) {
			insertPost(db, `at://did:plc:bot/post/${i}`, 'game1', i * 1000);
		}

		handler = createFeedHandler(TEST_DB);

		// First page: limit 2
		const page1 = handler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-game1',
				limit: '2',
			}),
		);
		expect(page1.feed).toHaveLength(2);
		expect(page1.feed[0]?.post).toBe('at://did:plc:bot/post/5');
		expect(page1.cursor).toBeDefined();

		// Second page using cursor
		const page2 = handler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-game1',
				limit: '2',
				cursor: page1.cursor ?? '',
			}),
		);
		expect(page2.feed).toHaveLength(2);
		expect(page2.feed[0]?.post).toBe('at://did:plc:bot/post/3');
	});

	it('returns empty feed when no feed param', () => {
		handler = createFeedHandler(TEST_DB);
		const result = handler(new URLSearchParams());
		expect(result.feed).toHaveLength(0);
	});

	it('returns empty feed for non-skeetwolf feed URI', () => {
		handler = createFeedHandler(TEST_DB);
		const params = new URLSearchParams({
			feed: 'at://did:web:example/app.bsky.feed.generator/something-else',
		});
		const result = handler(params);
		expect(result.feed).toHaveLength(0);
	});

	it('lists active feeds', () => {
		insertPost(db, 'at://did:plc:bot/post/1', 'game1', 1000);
		insertPost(db, 'at://did:plc:bot/post/2', 'game2', 2000);

		handler = createFeedHandler(TEST_DB);
		const feeds = handler.listFeeds();
		expect(feeds).toHaveLength(2);
		expect(feeds[0]?.uri).toContain('skeetwolf-game1');
		expect(feeds[1]?.uri).toContain('skeetwolf-game2');
	});
});

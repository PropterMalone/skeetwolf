/**
 * Integration test: engine → feed.
 *
 * Runs a full game lifecycle through GameManager with a real SQLite DB,
 * then verifies the feed handler serves the correct posts.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { alignmentOf } from '@skeetwolf/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FeedHandler, createFeedHandler } from '../../feed/src/handler.js';
import { openDatabase } from './db.js';
import { GameManager } from './game-manager.js';

const TEST_DB = 'test-integration.db';
let postCounter = 0;

// biome-ignore lint/suspicious/noExplicitAny: test mock
function createMockAgent(): any {
	return {
		post: vi.fn().mockImplementation(() => {
			postCounter++;
			return Promise.resolve({ uri: `at://did:plc:bot/post/${postCounter}` });
		}),
		session: { did: 'did:plc:bot' },
	};
}

function createMockDm() {
	const sent: { did: string; text: string }[] = [];
	return {
		sender: {
			async sendDm(did: string, text: string) {
				sent.push({ did, text });
			},
			createRelayGroup(_groupId: string, _memberDids: string[]) {},
			async sendToRelayGroup(_groupId: string, _text: string) {},
		},
		sent,
	};
}

function cleanupDb() {
	for (const suffix of ['', '-wal', '-shm']) {
		const path = TEST_DB + suffix;
		if (existsSync(path)) unlinkSync(path);
	}
}

describe('engine → feed integration', () => {
	let db: ReturnType<typeof openDatabase>;
	let feedHandler: FeedHandler;

	beforeEach(() => {
		postCounter = 0;
		cleanupDb();
		db = openDatabase(TEST_DB);
	});

	afterEach(() => {
		feedHandler?.close();
		db.close();
		cleanupDb();
	});

	it('full game lifecycle produces correct feed', async () => {
		const agent = createMockAgent();
		const dm = createMockDm();
		const manager = new GameManager(db, agent, dm.sender);

		// 1. Create game
		await manager.newGame('test1');

		// 2. Signup 7 players (enough for all roles including doctor)
		for (let i = 0; i < 7; i++) {
			manager.signup('test1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}

		// 3. Start game (assigns roles, DMs them, posts phase announcement)
		const startErr = await manager.startGame('test1');
		expect(startErr).toBeNull();

		// Verify DMs were sent to all players
		expect(dm.sent.length).toBe(7);

		// 4. Record some player posts (simulating vote mentions)
		manager.recordPlayerPost('test1', 'at://did:plc:p0/post/vote1', 'did:plc:p0');
		manager.recordPlayerPost('test1', 'at://did:plc:p1/post/vote2', 'did:plc:p1');

		// 5. Cast votes — find town players and have them vote for a mafia member
		const game = manager.findGameForPlayer('did:plc:p0');
		if (!game) throw new Error('expected game to exist');

		const townPlayers = game.players.filter((p) => alignmentOf(p.role) === 'town' && p.alive);
		const mafiaPlayer = game.players.find((p) => alignmentOf(p.role) === 'mafia');
		if (!mafiaPlayer) throw new Error('expected at least one mafia player');

		// Need majority — have all town players vote for the same mafia member
		// First advance to day phase manually by ending night
		await manager.endNight('test1');

		// Now cast day votes
		for (const p of townPlayers) {
			manager.vote('test1', p.did, mafiaPlayer.did);
		}

		// 6. End day — should eliminate the mafia player
		await manager.endDay('test1');

		// -- Now verify the feed --
		feedHandler = createFeedHandler(TEST_DB);

		const result = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-test1',
			}),
		);

		// Should have posts: announcement, phase (game start), phase (dawn/night end),
		// phase (day start), death (elimination), phase or game_over (next phase)
		// Plus 2 player posts
		expect(result.feed.length).toBeGreaterThanOrEqual(5);

		// All posts should be AT URIs
		for (const item of result.feed) {
			expect(item.post).toMatch(/^at:\/\//);
		}

		// Player posts should be in the feed
		const playerPostUris = result.feed.map((f) => f.post);
		expect(playerPostUris).toContain('at://did:plc:p0/post/vote1');
		expect(playerPostUris).toContain('at://did:plc:p1/post/vote2');

		// Feed should be newest-first (last indexed_at first)
		// The last post in the feed should be the oldest (announcement)
		// First post should be the most recent game event
	});

	it('different games produce separate feeds', async () => {
		const agent = createMockAgent();
		const dm = createMockDm();
		const manager = new GameManager(db, agent, dm.sender);

		// Create two games
		await manager.newGame('game-a');
		await manager.newGame('game-b');

		// Signup + start both
		for (let i = 0; i < 5; i++) {
			manager.signup('game-a', `did:plc:a${i}`, `alice${i}.bsky.social`);
			manager.signup('game-b', `did:plc:b${i}`, `bob${i}.bsky.social`);
		}
		await manager.startGame('game-a');
		await manager.startGame('game-b');

		// Record player posts in each game
		manager.recordPlayerPost('game-a', 'at://did:plc:a0/post/1', 'did:plc:a0');
		manager.recordPlayerPost('game-b', 'at://did:plc:b0/post/1', 'did:plc:b0');

		feedHandler = createFeedHandler(TEST_DB);

		const feedA = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-game-a',
			}),
		);
		const feedB = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-game-b',
			}),
		);

		// Each feed should only contain its own posts
		const feedAUris = feedA.feed.map((f) => f.post);
		const feedBUris = feedB.feed.map((f) => f.post);

		expect(feedAUris).toContain('at://did:plc:a0/post/1');
		expect(feedAUris).not.toContain('at://did:plc:b0/post/1');

		expect(feedBUris).toContain('at://did:plc:b0/post/1');
		expect(feedBUris).not.toContain('at://did:plc:a0/post/1');

		// listFeeds should show both games
		const feeds = feedHandler.listFeeds();
		expect(feeds.length).toBe(2);
	});

	it('feed pagination works across engine-recorded posts', async () => {
		const agent = createMockAgent();
		const dm = createMockDm();
		const manager = new GameManager(db, agent, dm.sender);

		await manager.newGame('pag1');
		for (let i = 0; i < 5; i++) {
			manager.signup('pag1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('pag1');

		// Record several player posts to have enough for pagination
		for (let i = 0; i < 10; i++) {
			manager.recordPlayerPost('pag1', `at://did:plc:p0/post/p${i}`, 'did:plc:p0');
		}

		feedHandler = createFeedHandler(TEST_DB);

		// Get first page
		const page1 = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-pag1',
				limit: '5',
			}),
		);
		expect(page1.feed).toHaveLength(5);
		expect(page1.cursor).toBeDefined();

		// Get second page
		const page2 = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-pag1',
				limit: '5',
				cursor: page1.cursor ?? '',
			}),
		);
		expect(page2.feed.length).toBeGreaterThan(0);

		// No overlap between pages
		const page1Uris = new Set(page1.feed.map((f) => f.post));
		for (const item of page2.feed) {
			expect(page1Uris.has(item.post)).toBe(false);
		}
	});

	it('post kinds are recorded correctly', async () => {
		const agent = createMockAgent();
		const dm = createMockDm();
		const manager = new GameManager(db, agent, dm.sender);

		await manager.newGame('kinds1');
		for (let i = 0; i < 5; i++) {
			manager.signup('kinds1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('kinds1');

		// Check what kinds got recorded
		const rows = db
			.prepare(
				"SELECT kind, COUNT(*) as count FROM game_posts WHERE game_id = 'kinds1' GROUP BY kind ORDER BY kind",
			)
			.all() as { kind: string; count: number }[];

		const kindMap = new Map(rows.map((r) => [r.kind, r.count]));

		// Should have an announcement and at least one phase post
		expect(kindMap.get('announcement')).toBe(1);
		expect(kindMap.get('phase')).toBeGreaterThanOrEqual(1);
	});
});

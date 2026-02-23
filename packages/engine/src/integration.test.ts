/**
 * Integration tests: engine game flow + feed.
 *
 * Runs game lifecycles through GameManager with a real SQLite DB,
 * then verifies game state, DB records, DM captures, and feed output.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { type FeedHandler, createFeedHandler } from '@skeetwolf/feed/handler';
import type { GameState, Player, Role } from '@skeetwolf/shared';
import { alignmentOf } from '@skeetwolf/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGame, openDatabase } from './db.js';
import { GameManager } from './game-manager.js';

const TEST_DB = 'test-integration.db';
let postCounter = 0;

// biome-ignore lint/suspicious/noExplicitAny: test mock
function createMockAgent(): any {
	return {
		post: vi.fn().mockImplementation(() => {
			postCounter++;
			return Promise.resolve({
				uri: `at://did:plc:bot/post/${postCounter}`,
				cid: `cid-mock-${postCounter}`,
			});
		}),
		session: { did: 'did:plc:bot' },
		api: {
			com: {
				atproto: {
					repo: {
						createRecord: vi.fn().mockResolvedValue({}),
						deleteRecord: vi.fn().mockResolvedValue({}),
					},
				},
			},
		},
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

		// Verify DMs were sent to all players (role DMs + Night 0 DMs)
		expect(dm.sent.length).toBe(14);

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
		feedHandler = createFeedHandler(TEST_DB, 'did:web:test.example');

		const result = feedHandler(
			new URLSearchParams({
				feed: 'at://did:web:example/app.bsky.feed.generator/skeetwolf-test1',
			}),
		);

		// Should have posts: announcement, day_thread (Day 1), death (elimination in thread),
		// game_over or night DMs, plus 2 player posts
		expect(result.feed.length).toBeGreaterThanOrEqual(4);

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
		for (let i = 0; i < 7; i++) {
			manager.signup('game-a', `did:plc:a${i}`, `alice${i}.bsky.social`);
			manager.signup('game-b', `did:plc:b${i}`, `bob${i}.bsky.social`);
		}
		await manager.startGame('game-a');
		await manager.startGame('game-b');

		// Record player posts in each game
		manager.recordPlayerPost('game-a', 'at://did:plc:a0/post/1', 'did:plc:a0');
		manager.recordPlayerPost('game-b', 'at://did:plc:b0/post/1', 'did:plc:b0');

		feedHandler = createFeedHandler(TEST_DB, 'did:web:test.example');

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
		for (let i = 0; i < 7; i++) {
			manager.signup('pag1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('pag1');

		// Record several player posts with distinct timestamps for pagination
		let fakeTime = 1000000;
		const realDateNow = Date.now;
		Date.now = () => ++fakeTime;
		for (let i = 0; i < 10; i++) {
			manager.recordPlayerPost('pag1', `at://did:plc:p0/post/p${i}`, 'did:plc:p0');
		}
		Date.now = realDateNow;

		feedHandler = createFeedHandler(TEST_DB, 'did:web:test.example');

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
		for (let i = 0; i < 7; i++) {
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

		// Should have an announcement (from newGame). No phase post — game start is DM-only.
		expect(kindMap.get('announcement')).toBe(1);
	});
});

// -- Helpers for full game flow tests --

/** Throws if value is nullish — satisfies biome's no-non-null-assertion rule */
function must<T>(value: T | null | undefined, label = 'value'): T {
	if (value == null) throw new Error(`expected ${label} to exist`);
	return value;
}

function findByRole(players: Player[], role: Role): Player {
	return must(
		players.find((pl) => pl.role === role && pl.alive),
		`alive player with role ${role}`,
	);
}

function findVillager(players: Player[]): Player {
	return must(
		players.find((p) => p.role === 'villager' && p.alive),
		'alive villager',
	);
}

function findAllByAlignment(players: Player[], alignment: 'town' | 'mafia'): Player[] {
	return players.filter((p) => alignmentOf(p.role) === alignment && p.alive);
}

function getPostKinds(db: ReturnType<typeof openDatabase>, gameId: string): Map<string, number> {
	const rows = db
		.prepare(
			'SELECT kind, COUNT(*) as count FROM game_posts WHERE game_id = ? GROUP BY kind ORDER BY kind',
		)
		.all(gameId) as { kind: string; count: number }[];
	return new Map(rows.map((r) => [r.kind, r.count]));
}

function mustLoadGame(db: ReturnType<typeof openDatabase>, gameId: string): GameState {
	return must(loadGame(db, gameId), `game ${gameId}`);
}

/** Set up a game with N players, started and in Night 0. */
async function setupGame(db: ReturnType<typeof openDatabase>, gameId: string, playerCount: number) {
	const agent = createMockAgent();
	const dm = createMockDm();
	const manager = new GameManager(db, agent, dm.sender);

	await manager.newGame(gameId);
	for (let i = 0; i < playerCount; i++) {
		manager.signup(gameId, `did:plc:p${i}`, `player${i}.bsky.social`);
	}
	const err = await manager.startGame(gameId);
	if (err) throw new Error(`startGame failed: ${err}`);

	const state = must(manager.findGameForPlayer('did:plc:p0'), 'game after start');

	return { manager, state, dm, agent };
}

describe('full game flow', () => {
	let db: ReturnType<typeof openDatabase>;

	beforeEach(() => {
		postCounter = 0;
		cleanupDb();
		db = openDatabase(TEST_DB);
	});

	afterEach(() => {
		db.close();
		cleanupDb();
	});

	it('town wins — full game to completion', async () => {
		// 7 players: godfather, mafioso, cop, doctor, 3 villagers
		const { manager, state } = await setupGame(db, 'tw1', 7);
		const godfather = findByRole(state.players, 'godfather');
		const mafioso = findByRole(state.players, 'mafioso');
		// Night 0: no kill allowed, just advance
		await manager.endNight('tw1');

		// Day 1: town votes out the godfather
		const gameAfterNight = must(manager.findGameForPlayer(godfather.did), 'game after night');
		const aliveAfterNight = findAllByAlignment(gameAfterNight.players, 'town');
		for (const p of aliveAfterNight) {
			manager.vote('tw1', p.did, godfather.did);
		}
		await manager.endDay('tw1');

		// Night 1: mafioso kills a townie
		const gameNight1 = mustLoadGame(db, 'tw1');
		const secondVictim = must(
			gameNight1.players.find((p) => alignmentOf(p.role) === 'town' && p.alive),
			'second town victim',
		);
		manager.nightAction('tw1', { actor: mafioso.did, kind: 'kill', target: secondVictim.did });
		await manager.endNight('tw1');

		// Day 2: town votes out the mafioso
		const gameDay2 = mustLoadGame(db, 'tw1');
		const aliveDay2 = gameDay2.players.filter((p) => alignmentOf(p.role) === 'town' && p.alive);
		for (const p of aliveDay2) {
			manager.vote('tw1', p.did, mafioso.did);
		}
		await manager.endDay('tw1');

		// Verify game finished with town win
		const final = mustLoadGame(db, 'tw1');
		expect(final.winner).toBe('town');
		expect(final.status).toBe('finished');

		const kinds = getPostKinds(db, 'tw1');
		expect(kinds.get('game_over')).toBe(1);
	});

	it('mafia wins — full game to completion', async () => {
		// 7 players: godfather, mafioso, cop, doctor, 3 villagers
		const { manager, state } = await setupGame(db, 'mw1', 7);
		const godfather = findByRole(state.players, 'godfather');
		let townPlayers = findAllByAlignment(state.players, 'town');

		// Night 0: no kill, just advance
		const gameId = 'mw1';
		await manager.endNight(gameId);
		await manager.endDay(gameId); // Day 1: no votes

		// Drive rounds: godfather kills each night, town never reaches majority
		let round = 0;
		while (round < 10) {
			const target = townPlayers[0];
			if (!target) break;
			manager.nightAction(gameId, { actor: godfather.did, kind: 'kill', target: target.did });
			await manager.endNight(gameId);

			const current = mustLoadGame(db, gameId);
			if (current.winner) break;

			// Day: no votes → no elimination
			await manager.endDay(gameId);

			const afterDay = mustLoadGame(db, gameId);
			if (afterDay.winner) break;

			townPlayers = findAllByAlignment(afterDay.players, 'town');
			round++;
		}

		const final = mustLoadGame(db, gameId);
		expect(final.winner).toBe('mafia');
		expect(final.status).toBe('finished');

		const kinds = getPostKinds(db, gameId);
		expect(kinds.get('game_over')).toBe(1);
	});

	it('night kill produces death post', async () => {
		const { manager, state } = await setupGame(db, 'nk1', 7);
		const godfather = findByRole(state.players, 'godfather');
		const victim = must(findAllByAlignment(state.players, 'town')[0], 'town victim');

		// Advance past Night 0 (no kills allowed)
		await manager.endNight('nk1');
		await manager.endDay('nk1');

		// Night 1: godfather kills
		manager.nightAction('nk1', { actor: godfather.did, kind: 'kill', target: victim.did });
		await manager.endNight('nk1');

		const afterNight = mustLoadGame(db, 'nk1');
		const victimAfter = must(
			afterNight.players.find((p) => p.did === victim.did),
			'victim in state',
		);
		expect(victimAfter.alive).toBe(false);

		// Night kill result is embedded in the day_thread post, not a separate death record
		const kinds = getPostKinds(db, 'nk1');
		expect(kinds.get('day_thread')).toBeGreaterThanOrEqual(1);
	});

	it('doctor saves target — no one dies', async () => {
		// 7 players: godfather, mafioso, cop, doctor, 3 villagers
		const { manager, state } = await setupGame(db, 'ds1', 7);
		const godfather = findByRole(state.players, 'godfather');
		const doctor = findByRole(state.players, 'doctor');
		const victim = findVillager(state.players);

		// Advance past Night 0 (no kills allowed)
		await manager.endNight('ds1');
		await manager.endDay('ds1');

		// Night 1: mafia targets a villager, doctor protects the same villager
		manager.nightAction('ds1', { actor: godfather.did, kind: 'kill', target: victim.did });
		manager.nightAction('ds1', { actor: doctor.did, kind: 'protect', target: victim.did });
		await manager.endNight('ds1');

		const afterNight = mustLoadGame(db, 'ds1');
		expect(afterNight.players.every((p) => p.alive)).toBe(true);

		const kinds = getPostKinds(db, 'ds1');
		expect(kinds.has('death')).toBe(false);
		// Day thread posted (dawn with no death), announcement from newGame
		expect(kinds.get('day_thread')).toBeGreaterThanOrEqual(1);
	});

	it('cop investigates godfather — appears town', async () => {
		const { manager, state, dm } = await setupGame(db, 'ci1', 7);
		const cop = findByRole(state.players, 'cop');
		const godfather = findByRole(state.players, 'godfather');

		manager.nightAction('ci1', { actor: cop.did, kind: 'investigate', target: godfather.did });
		await manager.endNight('ci1');

		const copDms = dm.sent.filter((m) => m.did === cop.did && m.text.includes(godfather.handle));
		expect(copDms).toHaveLength(1);
		expect(must(copDms[0], 'cop DM').text).toContain('TOWN');
	});

	it('cop investigates mafioso — appears mafia', async () => {
		const { manager, state, dm } = await setupGame(db, 'ci2', 7);
		const cop = findByRole(state.players, 'cop');
		const mafioso = findByRole(state.players, 'mafioso');

		manager.nightAction('ci2', { actor: cop.did, kind: 'investigate', target: mafioso.did });
		await manager.endNight('ci2');

		const copDms = dm.sent.filter((m) => m.did === cop.did && m.text.includes(mafioso.handle));
		expect(copDms).toHaveLength(1);
		expect(must(copDms[0], 'cop DM').text).toContain('MAFIA');
	});

	it('no-majority day — no elimination', async () => {
		const { manager, state } = await setupGame(db, 'nm1', 7);

		// End night first to get to day
		await manager.endNight('nm1');

		// Cast a single scattered vote (not enough for majority)
		const townPlayers = findAllByAlignment(state.players, 'town');
		const voter = must(townPlayers[0], 'voter');
		const target = must(townPlayers[1], 'vote target');
		manager.vote('nm1', voter.did, target.did);

		await manager.endDay('nm1');

		const afterDay = mustLoadGame(db, 'nm1');
		expect(afterDay.players.every((p) => p.alive)).toBe(true);

		const kinds = getPostKinds(db, 'nm1');
		expect(kinds.get('vote_result')).toBe(1);

		expect(afterDay.status).toBe('active');
		expect(afterDay.phase.kind).toBe('night');
	});

	it('phase timer expiry via tick()', async () => {
		await setupGame(db, 'pt1', 7);

		// Game starts in Night 0. Force phaseStartedAt far in the past.
		const state = mustLoadGame(db, 'pt1');
		const expired: GameState = {
			...state,
			phaseStartedAt: Date.now() - state.config.nightDurationMs - 1,
		};
		db.prepare('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify(expired), 'pt1');

		// Create a fresh manager and hydrate from DB
		const agent2 = createMockAgent();
		const dm2 = createMockDm();
		const manager2 = new GameManager(db, agent2, dm2.sender);
		manager2.hydrate();

		await manager2.tick(Date.now());

		const afterTick = mustLoadGame(db, 'pt1');
		expect(afterTick.phase.kind).toBe('day');
		expect(afterTick.phase.number).toBe(1);

		const kinds = getPostKinds(db, 'pt1');
		// Timer expired night → day: should have day_thread post
		expect(kinds.get('day_thread')).toBeGreaterThanOrEqual(1);
	});

	it('hydrate — persist and reload game state', async () => {
		await setupGame(db, 'hy1', 7);

		const original = mustLoadGame(db, 'hy1');

		// Close and reopen DB, create new manager, hydrate
		db.close();
		db = openDatabase(TEST_DB);
		const agent2 = createMockAgent();
		const dm2 = createMockDm();
		const manager2 = new GameManager(db, agent2, dm2.sender);
		manager2.hydrate();

		const reloaded = must(manager2.findGameForPlayer('did:plc:p0'), 'rehydrated game');
		expect(reloaded.id).toBe('hy1');
		expect(reloaded.players).toHaveLength(7);
		expect(reloaded.status).toBe('active');
		expect(reloaded.phase).toEqual(original.phase);

		// Roles preserved
		for (let i = 0; i < 7; i++) {
			expect(must(reloaded.players[i], `player ${i}`).role).toBe(
				must(original.players[i], `original player ${i}`).role,
			);
			expect(must(reloaded.players[i], `player ${i}`).did).toBe(
				must(original.players[i], `original player ${i}`).did,
			);
		}
	});

	it('multi-round game — Night 1 → Day 2 → Night 2', async () => {
		const { manager, state } = await setupGame(db, 'mr1', 7);
		const godfather = findByRole(state.players, 'godfather');

		// Night 0 → Day 1 (no kill on Night 0)
		await manager.endNight('mr1');

		let current = mustLoadGame(db, 'mr1');
		expect(current.phase).toEqual({ kind: 'day', number: 1 });
		expect(current.nightActions).toHaveLength(0);

		// Day 1: no majority → Night 1
		await manager.endDay('mr1');
		current = mustLoadGame(db, 'mr1');
		expect(current.phase).toEqual({ kind: 'night', number: 1 });
		expect(current.votes).toHaveLength(0);

		// Night 1: godfather kills → Day 2
		const victim0 = findVillager(current.players);
		manager.nightAction('mr1', { actor: godfather.did, kind: 'kill', target: victim0.did });
		await manager.endNight('mr1');

		current = mustLoadGame(db, 'mr1');
		expect(current.phase).toEqual({ kind: 'day', number: 2 });
		expect(current.nightActions).toHaveLength(0);

		// Day 2: no majority → Night 2
		await manager.endDay('mr1');
		current = mustLoadGame(db, 'mr1');
		expect(current.phase).toEqual({ kind: 'night', number: 2 });
		expect(current.votes).toHaveLength(0);

		// Night 2: godfather kills → Day 3
		const victim1 = findVillager(current.players);
		manager.nightAction('mr1', { actor: godfather.did, kind: 'kill', target: victim1.did });
		await manager.endNight('mr1');

		current = mustLoadGame(db, 'mr1');
		expect(current.phase).toEqual({ kind: 'day', number: 3 });

		// Night kills are embedded in day_thread posts (not separate death records)
		const kinds = getPostKinds(db, 'mr1');
		expect(kinds.get('day_thread')).toBe(3);
	});
});

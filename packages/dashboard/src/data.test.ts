import { existsSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DashboardData, createDashboardData } from './data.js';

const TEST_DB = 'test-dashboard.db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_posts (
  uri TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  author_did TEXT NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_posts_game_id ON game_posts(game_id, indexed_at);
CREATE TABLE IF NOT EXISTS public_queue (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);
`;

function makeGameState(
	overrides: Partial<{
		id: string;
		status: string;
		phaseKind: string;
		phaseNumber: number;
		players: { did: string; handle: string; role: string; alive: boolean }[];
		votes: { voter: string; target: string | null; timestamp: number }[];
		winner: string | null;
		announcementUri: string | null;
		phaseStartedAt: number;
		createdAt: number;
	}> = {},
) {
	return JSON.stringify({
		id: overrides.id ?? 'game1',
		status: overrides.status ?? 'active',
		phase: {
			kind: overrides.phaseKind ?? 'day',
			number: overrides.phaseNumber ?? 1,
		},
		players: overrides.players ?? [
			{ did: 'did:plc:alice', handle: 'alice.bsky.social', role: 'villager', alive: true },
			{ did: 'did:plc:bob', handle: 'bob.bsky.social', role: 'cop', alive: true },
			{ did: 'did:plc:carol', handle: 'carol.bsky.social', role: 'godfather', alive: false },
		],
		votes: overrides.votes ?? [],
		winner: overrides.winner ?? null,
		announcementUri: overrides.announcementUri ?? null,
		phaseStartedAt: overrides.phaseStartedAt ?? 1000,
		config: { dayDurationMs: 86400000, nightDurationMs: 43200000 },
		createdAt: overrides.createdAt ?? 500,
	});
}

function setupDb(): Database.Database {
	const db = new Database(TEST_DB);
	db.pragma('journal_mode = WAL');
	db.exec(SCHEMA);
	return db;
}

function cleanup() {
	for (const suffix of ['', '-wal', '-shm']) {
		const path = TEST_DB + suffix;
		if (existsSync(path)) unlinkSync(path);
	}
}

describe('dashboard data', () => {
	let db: Database.Database;
	let data: DashboardData | null = null;

	beforeEach(() => {
		cleanup();
		db = setupDb();
	});

	afterEach(() => {
		data?.close();
		data = null;
		db.close();
		cleanup();
	});

	it('returns active games', () => {
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			makeGameState({ id: 'game1', status: 'active' }),
			1000,
			2000,
		);
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game2',
			makeGameState({ id: 'game2', status: 'finished', winner: 'town' }),
			500,
			3000,
		);

		data = createDashboardData(TEST_DB);
		const active = data.getActiveGames();
		expect(active).toHaveLength(1);
		expect(active[0]?.id).toBe('game1');
		expect(active[0]?.playersAlive).toBe(2);
		expect(active[0]?.playersTotal).toBe(3);
	});

	it('returns recent finished games', () => {
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			makeGameState({ id: 'game1', status: 'finished', winner: 'town' }),
			500,
			3000,
		);
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game2',
			makeGameState({ id: 'game2', status: 'finished', winner: 'mafia' }),
			600,
			4000,
		);
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game3',
			makeGameState({ id: 'game3', status: 'active' }),
			700,
			5000,
		);

		data = createDashboardData(TEST_DB);
		const finished = data.getRecentFinished(10);
		expect(finished).toHaveLength(2);
		// Most recently updated first
		expect(finished[0]?.id).toBe('game2');
	});

	it('returns null for unknown game', () => {
		data = createDashboardData(TEST_DB);
		expect(data.getGame('nonexistent')).toBeNull();
	});

	it('returns game detail with votes resolved to handles', () => {
		const state = makeGameState({
			id: 'game1',
			votes: [
				{ voter: 'did:plc:alice', target: 'did:plc:carol', timestamp: 5000 },
				{ voter: 'did:plc:bob', target: null, timestamp: 6000 },
			],
		});
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			state,
			1000,
			2000,
		);

		data = createDashboardData(TEST_DB);
		const detail = data.getGame('game1');
		expect(detail).not.toBeNull();
		expect(detail?.players).toHaveLength(3);
		// Active game — roles/alignment hidden
		expect(detail?.players[2]?.role).toBeNull();
		expect(detail?.players[2]?.alignment).toBeNull();
		expect(detail?.votes[0]?.voterHandle).toBe('alice.bsky.social');
		expect(detail?.votes[0]?.targetHandle).toBe('carol.bsky.social');
		expect(detail?.votes[1]?.targetHandle).toBeNull();
	});

	it('reveals roles and alignment for finished games', () => {
		const state = makeGameState({
			id: 'game1',
			status: 'finished',
			winner: 'town',
		});
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			state,
			1000,
			2000,
		);

		data = createDashboardData(TEST_DB);
		const detail = data.getGame('game1');
		expect(detail?.players[0]?.role).toBe('villager');
		expect(detail?.players[0]?.alignment).toBe('town');
		expect(detail?.players[2]?.role).toBe('godfather');
		expect(detail?.players[2]?.alignment).toBe('mafia');
	});

	it('returns game posts in chronological order', () => {
		db.prepare(
			'INSERT INTO game_posts (uri, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
		).run('at://post/1', 'game1', 'did:plc:bot', 'announcement', null, 1000);
		db.prepare(
			'INSERT INTO game_posts (uri, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
		).run('at://post/2', 'game1', 'did:plc:bot', 'phase', 'day-1', 2000);
		db.prepare(
			'INSERT INTO game_posts (uri, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
		).run('at://post/3', 'game2', 'did:plc:bot', 'phase', 'day-1', 3000);

		data = createDashboardData(TEST_DB);
		const posts = data.getGamePosts('game1');
		expect(posts).toHaveLength(2);
		expect(posts[0]?.uri).toBe('at://post/1');
		expect(posts[1]?.kind).toBe('phase');
	});

	it('returns queue entries', () => {
		db.prepare('INSERT INTO public_queue (did, handle, joined_at) VALUES (?, ?, ?)').run(
			'did:plc:alice',
			'alice.bsky.social',
			1000,
		);
		db.prepare('INSERT INTO public_queue (did, handle, joined_at) VALUES (?, ?, ?)').run(
			'did:plc:bob',
			'bob.bsky.social',
			2000,
		);

		data = createDashboardData(TEST_DB);
		const queue = data.getQueue();
		expect(queue).toHaveLength(2);
		expect(queue[0]?.handle).toBe('alice.bsky.social');
	});

	it('computes leaderboard from finished games', () => {
		// Game 1: town wins. Alice (villager, town), Bob (cop, town), Carol (godfather, mafia)
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			makeGameState({ id: 'game1', status: 'finished', winner: 'town' }),
			500,
			3000,
		);
		// Game 2: mafia wins. Alice (villager, town), Bob (mafioso, mafia)
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game2',
			makeGameState({
				id: 'game2',
				status: 'finished',
				winner: 'mafia',
				players: [
					{ did: 'did:plc:alice', handle: 'alice.bsky.social', role: 'villager', alive: false },
					{ did: 'did:plc:bob', handle: 'bob.bsky.social', role: 'mafioso', alive: true },
				],
			}),
			600,
			4000,
		);

		data = createDashboardData(TEST_DB);
		const lb = data.getLeaderboard();

		const alice = lb.find((e) => e.handle === 'alice.bsky.social');
		expect(alice?.gamesPlayed).toBe(2);
		expect(alice?.wins).toBe(1); // won game1 as town
		expect(alice?.townGames).toBe(2);
		expect(alice?.townWins).toBe(1);

		const bob = lb.find((e) => e.handle === 'bob.bsky.social');
		expect(bob?.gamesPlayed).toBe(2);
		expect(bob?.wins).toBe(2); // won game1 as town cop, game2 as mafia
		expect(bob?.townGames).toBe(1);
		expect(bob?.mafiaGames).toBe(1);
		expect(bob?.mafiaWins).toBe(1);

		// Carol only played game1 as mafia, lost
		const carol = lb.find((e) => e.handle === 'carol.bsky.social');
		expect(carol?.gamesPlayed).toBe(1);
		expect(carol?.wins).toBe(0);
		expect(carol?.mafiaGames).toBe(1);
	});

	it('excludes active games from leaderboard', () => {
		db.prepare('INSERT INTO games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
			'game1',
			makeGameState({ id: 'game1', status: 'active' }),
			500,
			3000,
		);

		data = createDashboardData(TEST_DB);
		const lb = data.getLeaderboard();
		expect(lb).toHaveLength(0);
	});
});

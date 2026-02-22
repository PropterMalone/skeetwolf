import type { GameId, GameState } from '@skeetwolf/shared';
/**
 * SQLite persistence for game state.
 * Stores serialized game state per game — simple and sufficient for MVP.
 * Upgrade to normalized tables if/when query patterns demand it.
 */
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
`;

export function openDatabase(path: string): Database.Database {
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.exec(SCHEMA);
	return db;
}

export function saveGame(db: Database.Database, state: GameState): void {
	const stmt = db.prepare(`
		INSERT INTO games (id, state, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET state = ?, updated_at = ?
	`);
	const now = Date.now();
	const json = JSON.stringify(state);
	stmt.run(state.id, json, state.createdAt, now, json, now);
}

export function loadGame(db: Database.Database, id: GameId): GameState | null {
	const row = db.prepare('SELECT state FROM games WHERE id = ?').get(id) as
		| { state: string }
		| undefined;
	if (!row) return null;
	return JSON.parse(row.state) as GameState;
}

export function loadActiveGames(db: Database.Database): GameState[] {
	const rows = db
		.prepare("SELECT state FROM games WHERE json_extract(state, '$.status') != 'finished'")
		.all() as { state: string }[];
	return rows.map((r) => JSON.parse(r.state) as GameState);
}

/** Post kinds for the game_posts table */
export type PostKind =
	| 'announcement'
	| 'phase'
	| 'vote_result'
	| 'death'
	| 'game_over'
	| 'player'
	| 'reply';

export interface GamePost {
	uri: string;
	gameId: string;
	authorDid: string;
	kind: PostKind;
	phase: string | null;
	indexedAt: number;
}

export function recordGamePost(db: Database.Database, post: Omit<GamePost, 'indexedAt'>): void {
	db.prepare(
		'INSERT OR IGNORE INTO game_posts (uri, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
	).run(post.uri, post.gameId, post.authorDid, post.kind, post.phase, Date.now());
}

export function getGamePosts(
	db: Database.Database,
	gameId: string,
	limit = 50,
	cursor?: number,
): GamePost[] {
	const query = cursor
		? 'SELECT * FROM game_posts WHERE game_id = ? AND indexed_at < ? ORDER BY indexed_at DESC LIMIT ?'
		: 'SELECT * FROM game_posts WHERE game_id = ? ORDER BY indexed_at DESC LIMIT ?';

	const params = cursor ? [gameId, cursor, limit] : [gameId, limit];
	const rows = db.prepare(query).all(...params) as {
		uri: string;
		game_id: string;
		author_did: string;
		kind: PostKind;
		phase: string | null;
		indexed_at: number;
	}[];

	return rows.map((r) => ({
		uri: r.uri,
		gameId: r.game_id,
		authorDid: r.author_did,
		kind: r.kind,
		phase: r.phase,
		indexedAt: r.indexed_at,
	}));
}

/** Get all active game IDs (for feed discovery) */
export function getActiveGameIds(db: Database.Database): string[] {
	const rows = db
		.prepare("SELECT id FROM games WHERE json_extract(state, '$.status') != 'finished'")
		.all() as { id: string }[];
	return rows.map((r) => r.id);
}

export function saveBotState(db: Database.Database, key: string, value: string): void {
	db.prepare('INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)').run(key, value);
}

export function loadBotState(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

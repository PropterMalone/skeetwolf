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

export function saveBotState(db: Database.Database, key: string, value: string): void {
	db.prepare('INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)').run(key, value);
}

export function loadBotState(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

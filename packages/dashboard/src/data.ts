/**
 * Read-only SQLite queries for the dashboard.
 * Parses GameState JSON blobs on the fly — fine at current scale.
 */
import Database from 'better-sqlite3';

// Subset of GameState fields we actually need (avoid importing shared to keep dashboard standalone)
interface StoredGameState {
	id: string;
	status: 'signup' | 'active' | 'finished';
	phase: { kind: 'night' | 'day'; number: number };
	players: {
		did: string;
		handle: string;
		role: string;
		alive: boolean;
	}[];
	votes: { voter: string; target: string | null; timestamp: number }[];
	winner: 'town' | 'mafia' | null;
	announcementUri: string | null;
	phaseStartedAt: number;
	config: {
		dayDurationMs: number;
		nightDurationMs: number;
	};
	createdAt: number;
}

export interface GameSummary {
	id: string;
	status: string;
	phase: { kind: string; number: number };
	playersAlive: number;
	playersTotal: number;
	phaseStartedAt: number;
	phaseDurationMs: number;
	winner: string | null;
	createdAt: number;
}

export interface GameDetail {
	id: string;
	status: string;
	phase: { kind: string; number: number };
	players: {
		handle: string;
		role: string;
		alive: boolean;
		alignment: 'town' | 'mafia';
	}[];
	votes: { voterHandle: string; targetHandle: string | null }[];
	winner: string | null;
	announcementUri: string | null;
	phaseStartedAt: number;
	phaseDurationMs: number;
	createdAt: number;
}

export interface GamePostRow {
	uri: string;
	kind: string;
	phase: string | null;
	indexedAt: number;
}

export interface QueueEntryRow {
	handle: string;
	joinedAt: number;
}

export interface LeaderboardEntry {
	handle: string;
	gamesPlayed: number;
	wins: number;
	winRate: number;
	townGames: number;
	townWins: number;
	mafiaGames: number;
	mafiaWins: number;
}

export interface DashboardData {
	getActiveGames(): GameSummary[];
	getRecentFinished(limit: number): GameSummary[];
	getGame(id: string): GameDetail | null;
	getGamePosts(id: string): GamePostRow[];
	getQueue(): QueueEntryRow[];
	getLeaderboard(): LeaderboardEntry[];
	close(): void;
}

const MAFIA_ROLES = new Set(['mafioso', 'godfather']);

function alignmentOf(role: string): 'town' | 'mafia' {
	return MAFIA_ROLES.has(role) ? 'mafia' : 'town';
}

function toSummary(state: StoredGameState): GameSummary {
	const phaseDurationMs =
		state.phase.kind === 'day' ? state.config.dayDurationMs : state.config.nightDurationMs;
	return {
		id: state.id,
		status: state.status,
		phase: state.phase,
		playersAlive: state.players.filter((p) => p.alive).length,
		playersTotal: state.players.length,
		phaseStartedAt: state.phaseStartedAt,
		phaseDurationMs,
		winner: state.winner,
		createdAt: state.createdAt,
	};
}

function toDetail(state: StoredGameState): GameDetail {
	const handleByDid = new Map(state.players.map((p) => [p.did, p.handle]));
	const phaseDurationMs =
		state.phase.kind === 'day' ? state.config.dayDurationMs : state.config.nightDurationMs;
	return {
		id: state.id,
		status: state.status,
		phase: state.phase,
		players: state.players.map((p) => ({
			handle: p.handle,
			role: p.role,
			alive: p.alive,
			alignment: alignmentOf(p.role),
		})),
		votes: state.votes.map((v) => ({
			voterHandle: handleByDid.get(v.voter) ?? v.voter,
			targetHandle: v.target ? (handleByDid.get(v.target) ?? v.target) : null,
		})),
		winner: state.winner,
		announcementUri: state.announcementUri,
		phaseStartedAt: state.phaseStartedAt,
		phaseDurationMs,
		createdAt: state.createdAt,
	};
}

export function createDashboardData(dbPath: string): DashboardData {
	const db = new Database(dbPath, { readonly: true });
	db.pragma('journal_mode = WAL');

	return {
		getActiveGames(): GameSummary[] {
			const rows = db
				.prepare(
					"SELECT state FROM games WHERE json_extract(state, '$.status') != 'finished' ORDER BY created_at DESC",
				)
				.all() as { state: string }[];
			return rows.map((r) => toSummary(JSON.parse(r.state) as StoredGameState));
		},

		getRecentFinished(limit: number): GameSummary[] {
			const rows = db
				.prepare(
					"SELECT state FROM games WHERE json_extract(state, '$.status') = 'finished' ORDER BY updated_at DESC LIMIT ?",
				)
				.all(limit) as { state: string }[];
			return rows.map((r) => toSummary(JSON.parse(r.state) as StoredGameState));
		},

		getGame(id: string): GameDetail | null {
			const row = db.prepare('SELECT state FROM games WHERE id = ?').get(id) as
				| { state: string }
				| undefined;
			if (!row) return null;
			return toDetail(JSON.parse(row.state) as StoredGameState);
		},

		getGamePosts(id: string): GamePostRow[] {
			const rows = db
				.prepare(
					'SELECT uri, kind, phase, indexed_at FROM game_posts WHERE game_id = ? ORDER BY indexed_at ASC',
				)
				.all(id) as { uri: string; kind: string; phase: string | null; indexed_at: number }[];
			return rows.map((r) => ({
				uri: r.uri,
				kind: r.kind,
				phase: r.phase,
				indexedAt: r.indexed_at,
			}));
		},

		getQueue(): QueueEntryRow[] {
			const rows = db
				.prepare('SELECT handle, joined_at FROM public_queue ORDER BY joined_at ASC')
				.all() as { handle: string; joined_at: number }[];
			return rows.map((r) => ({ handle: r.handle, joinedAt: r.joined_at }));
		},

		getLeaderboard(): LeaderboardEntry[] {
			const rows = db
				.prepare("SELECT state FROM games WHERE json_extract(state, '$.status') = 'finished'")
				.all() as { state: string }[];

			const stats = new Map<
				string,
				{
					gamesPlayed: number;
					wins: number;
					townGames: number;
					townWins: number;
					mafiaGames: number;
					mafiaWins: number;
				}
			>();

			for (const row of rows) {
				const state = JSON.parse(row.state) as StoredGameState;
				for (const player of state.players) {
					const existing = stats.get(player.handle) ?? {
						gamesPlayed: 0,
						wins: 0,
						townGames: 0,
						townWins: 0,
						mafiaGames: 0,
						mafiaWins: 0,
					};
					existing.gamesPlayed++;
					const alignment = alignmentOf(player.role);
					if (alignment === 'town') {
						existing.townGames++;
						if (state.winner === 'town') {
							existing.wins++;
							existing.townWins++;
						}
					} else {
						existing.mafiaGames++;
						if (state.winner === 'mafia') {
							existing.wins++;
							existing.mafiaWins++;
						}
					}
					stats.set(player.handle, existing);
				}
			}

			return Array.from(stats.entries())
				.map(([handle, s]) => ({
					handle,
					...s,
					winRate: s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0,
				}))
				.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
		},

		close() {
			db.close();
		},
	};
}

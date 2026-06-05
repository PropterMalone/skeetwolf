/**
 * Skeetwolf dashboard server.
 * Read-only view of game state, queue, and player stats.
 */
import { createServer } from 'node:http';
import { createDashboardData } from './data.js';
import { gameNotFoundPage, gamePage } from './pages/game.js';
import { homePage } from './pages/home.js';
import { statsPage } from './pages/stats.js';

const PORT = Number(process.env['DASHBOARD_PORT']) || 3003;
const DB_PATH = process.env['DB_PATH'] || '../engine/skeetwolf.db';

const data = createDashboardData(DB_PATH);

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

	try {
		// Home
		if (url.pathname === '/') {
			const activeGames = data.getActiveGames();
			const queue = data.getQueue();
			const recentFinished = data.getRecentFinished(10);
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(homePage(activeGames, queue, recentFinished));
			return;
		}

		// Game detail: /game/:id
		const gameMatch = url.pathname.match(/^\/game\/([a-zA-Z0-9_-]+)$/);
		if (gameMatch?.[1]) {
			const gameId = gameMatch[1];
			const game = data.getGame(gameId);
			if (!game) {
				res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(gameNotFoundPage(gameId));
				return;
			}
			const posts = data.getGamePosts(gameId);
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(gamePage(game, posts));
			return;
		}

		// Stats
		if (url.pathname === '/stats') {
			const leaderboard = data.getLeaderboard();
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(statsPage(leaderboard));
			return;
		}

		// FAQ redirect to feed service
		if (url.pathname === '/faq') {
			res.writeHead(302, { Location: 'https://bsky.app/profile/skeetwolf.bsky.social' });
			res.end();
			return;
		}

		// Health check
		if (url.pathname === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('not found');
	} catch (err) {
		console.error('Dashboard error:', err);
		res.writeHead(500, { 'Content-Type': 'text/plain' });
		res.end('internal server error');
	}
});

server.listen(PORT, () => {
	console.log(`Skeetwolf dashboard listening on port ${PORT}`);
	console.log(`DB: ${DB_PATH}`);
});

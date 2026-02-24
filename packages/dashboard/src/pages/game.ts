import type { GameDetail, GamePostRow } from '../data.js';
import { layout } from './layout.js';

function phaseBadge(status: string, phase: { kind: string; number: number }): string {
	if (status === 'signup') return '<span class="badge badge-signup">Signup</span>';
	if (status === 'finished') return '<span class="badge badge-finished">Finished</span>';
	const cls = phase.kind === 'day' ? 'badge-day' : 'badge-night';
	const label = phase.kind === 'day' ? `Day ${phase.number}` : `Night ${phase.number}`;
	return `<span class="badge ${cls}">${label}</span>`;
}

function timeRemaining(phaseStartedAt: number, phaseDurationMs: number): string {
	const elapsed = Date.now() - phaseStartedAt;
	const remaining = phaseDurationMs - elapsed;
	if (remaining <= 0) return 'Phase ending soon';
	const hours = Math.floor(remaining / 3_600_000);
	const minutes = Math.floor((remaining % 3_600_000) / 60_000);
	if (hours > 0) return `${hours}h ${minutes}m remaining`;
	return `${minutes}m remaining`;
}

function playerRow(
	p: {
		handle: string;
		role: string | null;
		alive: boolean;
		alignment: 'town' | 'mafia' | 'neutral' | null;
	},
	showRoles: boolean,
): string {
	const status = p.alive
		? '<span class="badge-alive">Alive</span>'
		: '<span class="badge-dead">Dead</span>';
	const role = showRoles
		? `<td><span class="badge badge-${p.alignment}">${p.role}</span></td>`
		: '<td></td>';
	return `<tr><td>@${p.handle}</td><td>${status}</td>${role}</tr>`;
}

function postRow(post: GamePostRow): string {
	const time = new Date(post.indexedAt).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
	const bskyUrl = atUriToBskyUrl(post.uri);
	const link = bskyUrl ? `<a href="${bskyUrl}" target="_blank">view</a>` : '';
	return `<tr><td>${time}</td><td>${post.kind}</td><td>${post.phase ?? ''}</td><td>${link}</td></tr>`;
}

/** Convert at:// URI to bsky.app URL */
function atUriToBskyUrl(uri: string): string | null {
	// at://did:plc:abc123/app.bsky.feed.post/xyz789
	const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
	if (!match) return null;
	return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
}

export function gamePage(game: GameDetail, posts: GamePostRow[]): string {
	const showRoles = game.status === 'finished';
	const roleHeader = showRoles ? '<th>Role</th>' : '<th></th>';

	const timerInfo =
		game.status === 'active'
			? `<p>${timeRemaining(game.phaseStartedAt, game.phaseDurationMs)}</p>`
			: '';

	const threadLink = game.announcementUri
		? (() => {
				const url = atUriToBskyUrl(game.announcementUri);
				return url ? `<p><a href="${url}" target="_blank">View thread on Bluesky</a></p>` : '';
			})()
		: '';

	const winnerText = game.winner
		? `<p><span class="badge badge-${game.winner}">${game.winner === 'town' ? 'Town' : 'Mafia'} wins!</span></p>`
		: '';

	// Link to game-over wrap post (has role reveals and setup info)
	const gameOverPost = posts.find((p) => p.kind === 'game_over');
	const wrapLink = gameOverPost
		? (() => {
				const url = atUriToBskyUrl(gameOverPost.uri);
				return url
					? `<p><a href="${url}" target="_blank">View game wrap-up &amp; roles</a></p>`
					: '';
			})()
		: '';

	const votesSection =
		game.status === 'active' && game.phase.kind === 'day' && game.votes.length > 0
			? `<h2>Current Votes</h2>
      <table>
        <tr><th>Voter</th><th>Target</th></tr>
        ${game.votes.map((v) => `<tr><td>@${v.voterHandle}</td><td>${v.targetHandle ? `@${v.targetHandle}` : '<em>unvoted</em>'}</td></tr>`).join('\n')}
      </table>`
			: '';

	const postsSection =
		posts.length > 0
			? `<h2>Posts</h2>
      <table>
        <tr><th>Time</th><th>Type</th><th>Phase</th><th></th></tr>
        ${posts.map(postRow).join('\n')}
      </table>`
			: '';

	const autoRefresh = game.status !== 'finished' ? 30 : undefined;

	return layout(
		`Game #${game.id}`,
		`
    <h2>Game #${game.id} ${phaseBadge(game.status, game.phase)}</h2>
    <p class="theme">Theme: ${game.theme}</p>
    ${winnerText}
    ${wrapLink}
    ${timerInfo}
    ${threadLink}

    <h2>Players</h2>
    <table>
      <tr><th>Handle</th><th>Status</th>${roleHeader}</tr>
      ${game.players.map((p) => playerRow(p, showRoles)).join('\n')}
    </table>

    ${votesSection}
    ${postsSection}
  `,
		autoRefresh,
	);
}

export function gameNotFoundPage(id: string): string {
	return layout('Not Found', `<p class="empty">Game #${escapeHtml(id)} not found.</p>`);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

import type { LeaderboardEntry } from '../data.js';
import { layout } from './layout.js';

function pct(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

function leaderboardRow(e: LeaderboardEntry, rank: number): string {
	return `<tr>
    <td>${rank}</td>
    <td>@${e.handle}</td>
    <td>${e.gamesPlayed}</td>
    <td>${e.wins}</td>
    <td>${pct(e.winRate)}</td>
    <td>${e.townWins}/${e.townGames}</td>
    <td>${e.mafiaWins}/${e.mafiaGames}</td>
  </tr>`;
}

export function statsPage(leaderboard: LeaderboardEntry[]): string {
	const totalPlayers = leaderboard.length;

	const tableContent =
		leaderboard.length > 0
			? `<table>
        <tr><th>#</th><th>Player</th><th>Games</th><th>Wins</th><th>Win%</th><th>Town W/G</th><th>Mafia W/G</th></tr>
        ${leaderboard.map((e, i) => leaderboardRow(e, i + 1)).join('\n')}
      </table>`
			: '<p class="empty">No finished games yet</p>';

	return layout(
		'Leaderboard',
		`
    <h2>Leaderboard</h2>
    <p>${totalPlayers} players across finished games</p>
    ${tableContent}
  `,
	);
}

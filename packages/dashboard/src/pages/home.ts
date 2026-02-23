import type { GameSummary, QueueEntryRow } from '../data.js';
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
	if (remaining <= 0) return 'ending soon';
	const hours = Math.floor(remaining / 3_600_000);
	const minutes = Math.floor((remaining % 3_600_000) / 60_000);
	if (hours > 0) return `${hours}h ${minutes}m left`;
	return `${minutes}m left`;
}

function winnerBadge(winner: string | null): string {
	if (!winner) return '';
	const cls = winner === 'town' ? 'badge-town' : 'badge-mafia';
	return ` <span class="badge ${cls}">${winner} wins</span>`;
}

function gameRow(g: GameSummary): string {
	const timer =
		g.status === 'active'
			? `<td>${timeRemaining(g.phaseStartedAt, g.phaseDurationMs)}</td>`
			: '<td></td>';
	return `<tr>
    <td><a href="/game/${g.id}" class="mono">#${g.id}</a></td>
    <td>${phaseBadge(g.status, g.phase)}${winnerBadge(g.winner)}</td>
    <td>${g.playersAlive}/${g.playersTotal}</td>
    ${timer}
  </tr>`;
}

export function homePage(
	activeGames: GameSummary[],
	queue: QueueEntryRow[],
	recentFinished: GameSummary[],
): string {
	const activeSection =
		activeGames.length > 0
			? `<table>
        <tr><th>Game</th><th>Phase</th><th>Alive</th><th>Timer</th></tr>
        ${activeGames.map(gameRow).join('\n')}
      </table>`
			: '<p class="empty">No active games</p>';

	const queueSection =
		queue.length > 0
			? `<div class="card">
        <strong>${queue.length}/7</strong> in queue: ${queue.map((q) => `@${q.handle}`).join(', ')}
      </div>`
			: '<p class="empty">Queue is empty</p>';

	const finishedSection =
		recentFinished.length > 0
			? `<table>
        <tr><th>Game</th><th>Result</th><th>Players</th><th></th></tr>
        ${recentFinished.map(gameRow).join('\n')}
      </table>`
			: '<p class="empty">No finished games yet</p>';

	return layout(
		'Dashboard',
		`
    <h2>Active Games</h2>
    ${activeSection}

    <h2>Queue</h2>
    ${queueSection}

    <h2>Recent Games</h2>
    ${finishedSection}
  `,
		30,
	);
}

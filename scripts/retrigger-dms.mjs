import { BskyAgent } from '@atproto/api';
import { DEFAULT_FLAVOR, flavor } from '@skeetwolf/shared';
import Database from 'better-sqlite3';

const GAME_ID = process.argv[2];
if (!GAME_ID) {
	console.error('Usage: node scripts/retrigger-dms.mjs <gameId>');
	process.exit(1);
}

const db = new Database(process.env.DB_PATH || './data/skeetwolf.db');
const row = db.prepare('SELECT state FROM games WHERE id = ?').get(GAME_ID);
if (!row) {
	console.error(`Game ${GAME_ID} not found`);
	process.exit(1);
}
const game = JSON.parse(row.state);

const agent = new BskyAgent({ service: 'https://bsky.social' });
await agent.login({
	identifier: process.env.BSKY_IDENTIFIER,
	password: process.env.BSKY_PASSWORD,
});
const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat');

function alignmentOf(role) {
	return role === 'mafioso' || role === 'godfather' ? 'mafia' : 'town';
}

async function sendDm(recipientDid, text) {
	try {
		const resp = await chatAgent.chat.bsky.convo.getConvoForMembers({
			members: [recipientDid],
		});
		await chatAgent.chat.bsky.convo.sendMessage({
			convoId: resp.data.convo.id,
			message: { text },
		});
		return true;
	} catch (err) {
		console.error(`DM to ${recipientDid} failed:`, err.message);
		return false;
	}
}

const f = DEFAULT_FLAVOR;
const failedHandles = [];

// Role DMs
for (const player of game.players) {
	const alignment = alignmentOf(player.role);
	const teammates =
		alignment === 'mafia'
			? game.players
					.filter((p) => alignmentOf(p.role) === 'mafia' && p.did !== player.did)
					.map((p) => `@${p.handle}`)
					.join(', ')
			: null;

	const roleText = flavor(f.roleAssignment[player.role], {
		teammates: teammates ?? '',
	});
	const playerList = game.players.map((p) => `@${p.handle}`).join(', ');
	let message = `🐺 Skeetwolf Game #${GAME_ID}\n\nPlayers: ${playerList}\n\n${roleText}`;
	if (teammates) message += `\nYour mafia teammates: ${teammates}`;
	const faqUrl = process.env.FAQ_URL;
	if (faqUrl) message += `\n\nHow to play: ${faqUrl}`;

	const ok = await sendDm(player.did, message);
	if (ok) console.log(`✓ Role DM sent to ${player.handle}`);
	else failedHandles.push(player.handle);
}

// Mafia relay message
const mafiaPlayers = game.players.filter((p) => alignmentOf(p.role) === 'mafia');
if (mafiaPlayers.length > 1) {
	for (const p of mafiaPlayers) {
		const ok = await sendDm(
			p.did,
			`Mafia chat for Game #${GAME_ID}. DM me to coordinate — I'll relay to your teammates.`,
		);
		if (ok) console.log(`✓ Mafia relay msg sent to ${p.handle}`);
	}
}

// Night 0 guidance
for (const player of game.players) {
	const ok = await sendDm(player.did, flavor(f.night0Guidance[player.role]));
	if (ok) console.log(`✓ Night 0 guidance sent to ${player.handle}`);
	else console.log(`✗ Night 0 guidance failed for ${player.handle}`);
}

console.log(`\nFailed handles: ${failedHandles.length > 0 ? failedHandles.join(', ') : '(none)'}`);

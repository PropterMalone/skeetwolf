/**
 * DM smoke test — verifies the bot can send and receive DMs.
 *
 * 1. Bobby creates an invite game mentioning Starcountr
 * 2. Starcountr confirms
 * 3. Game starts → bot sends role DMs
 * 4. Wait for role DMs to arrive
 * 5. Mafia player sends a kill DM
 * 6. Check for confirmation DM back
 *
 * Run: BSKY_IDENTIFIER=skeetwolf.bsky.social BSKY_PASSWORD=... \
 *      BOBBY_IDENTIFIER=bobbyquine.bsky.social BOBBY_PASSWORD=... \
 *      STARCOUNTR_IDENTIFIER=starcountr.bsky.social STARCOUNTR_PASSWORD=... \
 *      npx tsx scripts/smoke-test-dms.ts
 */
import { AtpAgent, RichText } from '@atproto/api';

const SERVICE = 'https://bsky.social';

async function login(identifier: string, password: string, label: string): Promise<AtpAgent> {
	const agent = new AtpAgent({ service: SERVICE });
	await agent.login({ identifier, password });
	console.log(`✓ ${label} logged in as ${agent.session?.handle}`);
	return agent;
}

/** Post with proper mention facets so ATProto registers it as a mention notification */
async function postWithFacets(
	agent: AtpAgent,
	text: string,
): Promise<{ uri: string; cid: string }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	const result = await agent.post({
		text: rt.text,
		facets: rt.facets,
	});
	return { uri: result.uri, cid: result.cid };
}

function chatAgent(agent: AtpAgent): AtpAgent {
	return agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;
}

async function getLatestDmsFrom(chat: AtpAgent, fromDid: string, limit = 5): Promise<string[]> {
	const { data } = await chat.chat.bsky.convo.listConvos({ limit: 20 });
	const texts: string[] = [];
	for (const convo of data.convos) {
		const { data: msgs } = await chat.chat.bsky.convo.getMessages({
			convoId: convo.id,
			limit,
		});
		for (const msg of msgs.messages) {
			const sender = msg.sender as { did: string };
			if (sender.did === fromDid && msg.$type === 'chat.bsky.convo.defs#messageView') {
				texts.push((msg as { text?: string }).text ?? '');
			}
		}
	}
	return texts;
}

async function sendDmTo(chat: AtpAgent, recipientDid: string, text: string): Promise<void> {
	const { data } = await chat.chat.bsky.convo.getConvoForMembers({
		members: [recipientDid],
	});
	await chat.chat.bsky.convo.sendMessage({
		convoId: data.convo.id,
		message: { text },
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	const botId = process.env['BSKY_IDENTIFIER'];
	const botPw = process.env['BSKY_PASSWORD'];
	const bobbyId = process.env['BOBBY_IDENTIFIER'];
	const bobbyPw = process.env['BOBBY_PASSWORD'];
	const starId = process.env['STARCOUNTR_IDENTIFIER'];
	const starPw = process.env['STARCOUNTR_PASSWORD'];

	if (!botId || !botPw || !bobbyId || !bobbyPw || !starId || !starPw) {
		console.error(
			'Set all env vars: BSKY_IDENTIFIER, BSKY_PASSWORD, BOBBY_IDENTIFIER, BOBBY_PASSWORD, STARCOUNTR_IDENTIFIER, STARCOUNTR_PASSWORD',
		);
		process.exit(1);
	}

	const bot = await login(botId, botPw, 'Bot');
	const bobby = await login(bobbyId, bobbyPw, 'Bobby');
	const star = await login(starId, starPw, 'Starcountr');
	const botDid = bot.session?.did as string;

	console.log('\n--- Step 1: Bobby creates invite game mentioning Starcountr ---');
	const mentionText = `@${botId} new game @${star.session?.handle}`;
	console.log(`  Posting: "${mentionText}"`);
	await postWithFacets(bobby, mentionText);

	console.log('  Waiting 35s for bot poll cycle...');
	await sleep(35_000);

	// Check Bobby's DMs for the invite confirmation reply
	// (The reply comes as a mention reply, not a DM — skip DM check for this step)

	console.log('\n--- Step 2: Check Bobby notifications for game ID ---');
	const bobbyNotifs = await bobby.listNotifications({ limit: 10 });
	const botReply = bobbyNotifs.data.notifications.find(
		(n) => n.author.did === botDid && (n.record as Record<string, unknown>).text,
	);
	const replyText = (botReply?.record as Record<string, unknown>)?.text as string | undefined;
	console.log(`  Bot replied: "${replyText ?? '(no reply found)'}"`);

	// Extract game ID from reply
	const gameIdMatch = replyText?.match(/#(\w+)/);
	const gameId = gameIdMatch?.[1];
	if (!gameId) {
		console.error('  ✗ Could not extract game ID from bot reply. Aborting.');
		process.exit(1);
	}
	console.log(`  Game ID: ${gameId}`);

	console.log('\n--- Step 3: Starcountr confirms ---');
	const confirmText = `@${botId} confirm #${gameId}`;
	console.log(`  Posting: "${confirmText}"`);
	await postWithFacets(star, confirmText);

	console.log('  Waiting 35s for bot poll cycle...');
	await sleep(35_000);

	console.log('\n--- Step 4: Check for role DMs ---');
	const bobbyChat = chatAgent(bobby);
	const starChat = chatAgent(star);

	const bobbyDms = await getLatestDmsFrom(bobbyChat, botDid);
	const starDms = await getLatestDmsFrom(starChat, botDid);

	console.log(`  Bobby received ${bobbyDms.length} DM(s) from bot:`);
	for (const dm of bobbyDms.slice(0, 5)) {
		console.log(`    "${dm.slice(0, 120)}${dm.length > 120 ? '...' : ''}"`);
	}
	console.log(`  Starcountr received ${starDms.length} DM(s) from bot:`);
	for (const dm of starDms.slice(0, 5)) {
		console.log(`    "${dm.slice(0, 120)}${dm.length > 120 ? '...' : ''}"`);
	}

	const hasRoleDm = (dms: string[]) => dms.some((d) => d.includes('Skeetwolf Game'));
	if (hasRoleDm(bobbyDms) && hasRoleDm(starDms)) {
		console.log('  ✓ Both players received role DMs!');
	} else {
		console.log('  ✗ Missing role DMs. Check engine logs.');
	}

	console.log('\n--- Step 5: Test night action DM ---');
	// Figure out who is mafia by checking DM content
	const bobbyIsMafia = bobbyDms.some(
		(d) => d.toLowerCase().includes('mafia') || d.toLowerCase().includes('godfather'),
	);
	const mafiaChat = bobbyIsMafia ? bobbyChat : starChat;
	const mafiaLabel = bobbyIsMafia ? 'Bobby' : 'Starcountr';
	const targetHandle = bobbyIsMafia ? star.session?.handle : bobby.session?.handle;

	console.log(`  ${mafiaLabel} is mafia. Sending kill DM...`);
	await sendDmTo(mafiaChat, botDid, `kill @${targetHandle}`);

	console.log('  Waiting 35s for bot poll cycle...');
	await sleep(35_000);

	console.log('\n--- Step 6: Check for confirmation DM ---');
	const mafiaDmsAfter = await getLatestDmsFrom(mafiaChat, botDid);
	const hasConfirmation = mafiaDmsAfter.some((d) => d.includes('Action received'));
	if (hasConfirmation) {
		console.log('  ✓ Night action confirmation DM received!');
	} else {
		console.log('  ✗ No confirmation DM. Check engine logs.');
		console.log('  Latest DMs:', mafiaDmsAfter.slice(0, 3));
	}

	console.log('\n--- Smoke test complete ---');
	console.log('Summary:');
	console.log(`  Role DMs:    ${hasRoleDm(bobbyDms) && hasRoleDm(starDms) ? '✓' : '✗'}`);
	console.log(`  Night action: ${hasConfirmation ? '✓' : '✗'}`);
	console.log('\nCheck docker logs skeetwolf-engine-1 for full bot output.');
}

main().catch((err) => {
	console.error('Smoke test failed:', err);
	process.exit(1);
});

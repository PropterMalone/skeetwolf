/**
 * Bluesky bot interactions — posting, DMs, mention polling.
 * Imperative shell: all ATProto I/O lives here.
 */
import { AtpAgent } from '@atproto/api';

export interface BotConfig {
	identifier: string;
	password: string;
	service?: string;
}

export async function createAgent(config: BotConfig): Promise<AtpAgent> {
	const agent = new AtpAgent({
		service: config.service ?? 'https://bsky.social',
	});
	await agent.login({
		identifier: config.identifier,
		password: config.password,
	});
	return agent;
}

export async function postMessage(agent: AtpAgent, text: string): Promise<string> {
	const response = await agent.post({ text });
	return response.uri;
}

export async function replyToPost(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
): Promise<string> {
	const response = await agent.post({
		text,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	});
	return response.uri;
}

/**
 * Poll for new notifications (mentions).
 * Returns unread notifications since the given cursor.
 */
export async function pollMentions(
	agent: AtpAgent,
	cursor?: string,
): Promise<{ notifications: MentionNotification[]; cursor: string | undefined }> {
	const response = await agent.listNotifications({ cursor, limit: 50 });
	const mentions = response.data.notifications
		.filter((n) => n.reason === 'mention' || n.reason === 'reply')
		.map((n) => ({
			uri: n.uri,
			cid: n.cid,
			authorDid: n.author.did,
			authorHandle: n.author.handle,
			text: (n.record as { text?: string }).text ?? '',
			indexedAt: n.indexedAt,
		}));

	return {
		notifications: mentions,
		cursor: response.data.cursor,
	};
}

export interface MentionNotification {
	uri: string;
	cid: string;
	authorDid: string;
	authorHandle: string;
	text: string;
	indexedAt: string;
}

// DM support — using chat.bsky.convo lexicon
// TODO: Implement when we have DM API access confirmed.
// For now, stub the interface so engine can be built against it.

export interface DmSender {
	sendDm(recipientDid: string, text: string): Promise<void>;
	createGroupDm(memberDids: string[], text: string): Promise<string>;
	sendToGroupDm(convoId: string, text: string): Promise<void>;
}

/**
 * Placeholder DM sender that logs to console.
 * Replace with real implementation once chat.bsky.convo API usage is confirmed.
 */
export function createConsoleDmSender(): DmSender {
	return {
		async sendDm(recipientDid, text) {
			console.log(`[DM → ${recipientDid}] ${text}`);
		},
		async createGroupDm(memberDids, text) {
			const id = `group-${Date.now()}`;
			console.log(`[GROUP DM ${id} → ${memberDids.join(', ')}] ${text}`);
			return id;
		},
		async sendToGroupDm(convoId, text) {
			console.log(`[GROUP DM ${convoId}] ${text}`);
		},
	};
}

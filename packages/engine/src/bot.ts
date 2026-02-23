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

export async function postMessage(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const record: Record<string, unknown> = { text };
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await agent.post(record);
	return { uri: response.uri, cid: response.cid };
}

export async function replyToPost(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const record: Record<string, unknown> = {
		text,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	};
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await agent.post(record);
	return { uri: response.uri, cid: response.cid };
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
		.filter((n) => (n.reason === 'mention' || n.reason === 'reply') && !n.isRead)
		.map((n) => ({
			uri: n.uri,
			cid: n.cid,
			authorDid: n.author.did,
			authorHandle: n.author.handle,
			text: (n.record as { text?: string }).text ?? '',
			indexedAt: n.indexedAt,
		}));

	// Mark all notifications as seen so they won't be returned as unread next poll
	if (mentions.length > 0) {
		await agent.updateSeenNotifications();
	}

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

/** Extract the rkey (record key) from an AT URI: at://did/collection/rkey */
export function extractRkey(uri: string): string {
	const rkey = uri.split('/').pop();
	if (!rkey) throw new Error(`extractRkey: invalid AT URI "${uri}"`);
	return rkey;
}

/** Post with a quote-embed of another post */
export async function postWithQuote(
	agent: AtpAgent,
	text: string,
	quotedUri: string,
	quotedCid: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const record: Record<string, unknown> = {
		text,
		embed: {
			$type: 'app.bsky.embed.record',
			record: { uri: quotedUri, cid: quotedCid },
		},
	};
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await agent.post(record);
	return { uri: response.uri, cid: response.cid };
}

/** Create a threadgate that blocks all replies (allow: []) */
export async function createThreadgate(agent: AtpAgent, postUri: string): Promise<void> {
	const rkey = extractRkey(postUri);
	const did = agent.session?.did;
	if (!did) throw new Error('createThreadgate: no active session');
	await agent.api.com.atproto.repo.createRecord({
		repo: did,
		collection: 'app.bsky.feed.threadgate',
		rkey,
		record: {
			$type: 'app.bsky.feed.threadgate',
			post: postUri,
			allow: [],
			createdAt: new Date().toISOString(),
		},
	});
}

/** Create a postgate that disables quote-posts */
export async function createPostgate(agent: AtpAgent, postUri: string): Promise<void> {
	const rkey = extractRkey(postUri);
	const did = agent.session?.did;
	if (!did) throw new Error('createPostgate: no active session');
	await agent.api.com.atproto.repo.createRecord({
		repo: did,
		collection: 'app.bsky.feed.postgate',
		rkey,
		record: {
			$type: 'app.bsky.feed.postgate',
			post: postUri,
			embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
			createdAt: new Date().toISOString(),
		},
	});
}

/** Delete a postgate (to temporarily allow QTs before re-creating it) */
export async function deletePostgate(agent: AtpAgent, postUri: string): Promise<void> {
	const rkey = extractRkey(postUri);
	const did = agent.session?.did;
	if (!did) throw new Error('deletePostgate: no active session');
	await agent.api.com.atproto.repo.deleteRecord({
		repo: did,
		collection: 'app.bsky.feed.postgate',
		rkey,
	});
}

/** Resolve a Bluesky handle to a DID. Returns null if not found. */
export async function resolveHandle(agent: AtpAgent, handle: string): Promise<string | null> {
	try {
		const response = await agent.resolveHandle({ handle });
		return response.data.did;
	} catch {
		return null;
	}
}

// DM support moved to dm.ts — re-export for convenience
export type { DmSender, InboundDm } from './dm.js';
export {
	createBlueskyDmSender,
	createConsoleDmSender,
	createChatAgent,
	pollInboundDms,
} from './dm.js';

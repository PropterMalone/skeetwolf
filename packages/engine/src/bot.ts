/**
 * Bluesky bot interactions — posting, DMs, mention polling.
 * Imperative shell: all ATProto I/O lives here.
 */
import { AtpAgent, RichText } from '@atproto/api';

const BLUESKY_MAX_GRAPHEMES = 300;

/** Truncate text to Bluesky's 300-grapheme limit. Uses Intl.Segmenter for correct grapheme counting. */
export function truncateToLimit(text: string, limit = BLUESKY_MAX_GRAPHEMES): string {
	// Intl.Segmenter handles multi-byte characters and emoji correctly
	const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
	const segments = [...segmenter.segment(text)];
	if (segments.length <= limit) return text;
	return `${segments
		.slice(0, limit - 1)
		.map((s) => s.segment)
		.join('')}…`;
}

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

/** Detect @mention and link facets in text. Resolves handles → DIDs via the agent. */
async function buildFacets(
	agent: AtpAgent,
	text: string,
): Promise<{ text: string; facets: RichText['facets'] }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	return { text: rt.text, facets: rt.facets };
}

export async function postMessage(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = { text: truncated };
	if (facets?.length) record['facets'] = facets;
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
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = {
		text: truncated,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	};
	if (facets?.length) record['facets'] = facets;
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
 * Always fetches from page 1 — Bluesky's listNotifications cursor is for
 * pagination, not "after this point". We rely on isRead + the dedup set in
 * index.ts to avoid reprocessing.
 */
export async function pollMentions(
	agent: AtpAgent,
): Promise<{ notifications: MentionNotification[] }> {
	const allMentions: MentionNotification[] = [];
	let pageCursor: string | undefined;

	// Paginate until we hit read notifications or run out of pages
	for (let page = 0; page < 5; page++) {
		const response = await agent.listNotifications({ cursor: pageCursor, limit: 50 });
		const notifs = response.data.notifications;
		if (notifs.length === 0) break;

		const mentions = notifs
			.filter((n) => (n.reason === 'mention' || n.reason === 'reply') && !n.isRead)
			.map((n) => ({
				uri: n.uri,
				cid: n.cid,
				authorDid: n.author.did,
				authorHandle: n.author.handle,
				text: (n.record as { text?: string }).text ?? '',
				indexedAt: n.indexedAt,
			}));

		allMentions.push(...mentions);

		// If any notification on this page was already read, we've caught up
		if (notifs.some((n) => n.isRead)) break;

		pageCursor = response.data.cursor;
		if (!pageCursor) break;
	}

	// Mark all notifications as seen so they won't be returned as unread next poll
	if (allMentions.length > 0) {
		await agent.updateSeenNotifications();
	}

	return { notifications: allMentions };
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
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = {
		text: truncated,
		embed: {
			$type: 'app.bsky.embed.record',
			record: { uri: quotedUri, cid: quotedCid },
		},
	};
	if (facets?.length) record['facets'] = facets;
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

/** Create a threadgate that allows only mentioned users to reply (mentionRule) */
export async function createDayThreadgate(agent: AtpAgent, postUri: string): Promise<void> {
	const rkey = extractRkey(postUri);
	const did = agent.session?.did;
	if (!did) throw new Error('createDayThreadgate: no active session');
	await agent.api.com.atproto.repo.createRecord({
		repo: did,
		collection: 'app.bsky.feed.threadgate',
		rkey,
		record: {
			$type: 'app.bsky.feed.threadgate',
			post: postUri,
			allow: [{ $type: 'app.bsky.feed.threadgate#mentionRule' }],
			createdAt: new Date().toISOString(),
		},
	});
}

/** Delete a threadgate record */
export async function deleteThreadgate(agent: AtpAgent, postUri: string): Promise<void> {
	const rkey = extractRkey(postUri);
	const did = agent.session?.did;
	if (!did) throw new Error('deleteThreadgate: no active session');
	await agent.api.com.atproto.repo.deleteRecord({
		repo: did,
		collection: 'app.bsky.feed.threadgate',
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

/** Reply in a thread — author DID, handle, and text */
export interface ThreadReply {
	uri: string;
	authorDid: string;
	authorHandle: string;
	text: string;
}

/** Fetch all replies in a thread tree (walks nested replies recursively) */
export async function getThreadReplies(agent: AtpAgent, postUri: string): Promise<ThreadReply[]> {
	const response = await agent.api.app.bsky.feed.getPostThread({
		uri: postUri,
		depth: 6,
	});

	const thread = response.data.thread;
	if (thread.$type !== 'app.bsky.feed.defs#threadViewPost') return [];

	type ThreadNode = {
		$type?: string;
		post?: {
			uri?: string;
			author?: { did?: string; handle?: string };
			record?: { text?: string };
		};
		replies?: ThreadNode[];
	};

	const replies: ThreadReply[] = [];
	function walk(nodes: unknown[]): void {
		for (const node of nodes) {
			const r = node as ThreadNode;
			if (r.$type !== 'app.bsky.feed.defs#threadViewPost' || !r.post) continue;
			replies.push({
				uri: r.post.uri ?? '',
				authorDid: r.post.author?.did ?? '',
				authorHandle: r.post.author?.handle ?? '',
				text: r.post.record?.text ?? '',
			});
			if (Array.isArray(r.replies)) walk(r.replies);
		}
	}

	const threadView = thread as ThreadNode;
	if (Array.isArray(threadView.replies)) walk(threadView.replies);
	return replies;
}

// DM support moved to dm.ts — re-export for convenience
export type { DmSender, InboundDm } from './dm.js';
export {
	createBlueskyDmSender,
	createConsoleDmSender,
	createChatAgent,
	pollInboundDms,
} from './dm.js';

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

/** Count graphemes in a string using Intl.Segmenter */
function graphemeLength(text: string): number {
	const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
	let count = 0;
	for (const _ of segmenter.segment(text)) count++;
	return count;
}

/**
 * Split text into chunks that each fit within Bluesky's grapheme limit.
 * Split strategy (greedy packing):
 *   1. Split on \n\n (paragraph boundaries)
 *   2. If a paragraph exceeds limit, split on \n
 *   3. If a line exceeds limit, split on space boundaries
 *   4. Never split inside an @mention (@+non-whitespace is atomic)
 */
export function splitForPost(text: string, limit = BLUESKY_MAX_GRAPHEMES): [string, ...string[]] {
	if (graphemeLength(text) <= limit) return [text];

	const paragraphs = text.split('\n\n');
	const chunks: string[] = [];
	let current = '';

	for (const para of paragraphs) {
		const candidate = current ? `${current}\n\n${para}` : para;
		if (graphemeLength(candidate) <= limit) {
			current = candidate;
		} else if (!current) {
			// Single paragraph exceeds limit — split further
			for (const piece of splitParagraph(para, limit)) {
				chunks.push(piece);
			}
		} else {
			chunks.push(current);
			// Try the paragraph on its own
			if (graphemeLength(para) <= limit) {
				current = para;
			} else {
				current = '';
				for (const piece of splitParagraph(para, limit)) {
					chunks.push(piece);
				}
			}
		}
	}
	if (current) chunks.push(current);

	// Always at least one chunk — input text is non-empty (passed grapheme length check above)
	return chunks as [string, ...string[]];
}

/** Split a single paragraph (no \n\n) into chunks, splitting on \n then space */
function splitParagraph(para: string, limit: number): string[] {
	const lines = para.split('\n');
	const chunks: string[] = [];
	let current = '';

	for (const line of lines) {
		const candidate = current ? `${current}\n${line}` : line;
		if (graphemeLength(candidate) <= limit) {
			current = candidate;
		} else if (!current) {
			// Single line exceeds limit — split on spaces
			for (const piece of splitLine(line, limit)) {
				chunks.push(piece);
			}
		} else {
			chunks.push(current);
			if (graphemeLength(line) <= limit) {
				current = line;
			} else {
				current = '';
				for (const piece of splitLine(line, limit)) {
					chunks.push(piece);
				}
			}
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

/** Split a single line on space boundaries, keeping @mentions atomic */
function splitLine(line: string, limit: number): string[] {
	// Tokenize: split on spaces but keep @mentions together
	const tokens = tokenize(line);
	const chunks: string[] = [];
	let current = '';

	for (const token of tokens) {
		const candidate = current ? `${current} ${token}` : token;
		if (graphemeLength(candidate) <= limit) {
			current = candidate;
		} else {
			if (current) chunks.push(current);
			// If a single token exceeds limit, hard-split by grapheme (last resort)
			if (graphemeLength(token) > limit) {
				const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
				let buf = '';
				for (const { segment } of segmenter.segment(token)) {
					if (graphemeLength(buf + segment) > limit) {
						chunks.push(buf);
						buf = segment;
					} else {
						buf += segment;
					}
				}
				current = buf;
			} else {
				current = token;
			}
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

/** Split text on spaces, but never break inside @mentions */
function tokenize(text: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	let current = '';

	while (i < text.length) {
		if (text[i] === '@') {
			// Consume entire @mention (@ + non-whitespace)
			let mention = '@';
			i++;
			while (i < text.length && !/\s/.test(text[i] ?? '')) {
				mention += text[i];
				i++;
			}
			current += mention;
		} else if (text[i] === ' ') {
			if (current) tokens.push(current);
			current = '';
			i++;
		} else {
			current += text[i];
			i++;
		}
	}
	if (current) tokens.push(current);
	return tokens;
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

export type PostRef = { uri: string; cid: string };

export async function postMessage(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<PostRef> {
	const [first] = await postMessageChain(agent, text, labels);
	return first;
}

/** Post a message, auto-splitting into a self-reply chain if it exceeds 300 graphemes.
 *  Returns refs for all posts in the chain (always at least one). */
export async function postMessageChain(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<[PostRef, ...PostRef[]]> {
	const [firstChunk, ...restChunks] = splitForPost(text);
	const labelsRecord = labels?.length
		? {
				labels: {
					$type: 'com.atproto.label.defs#selfLabels',
					values: labels.map((val) => ({ val })),
				},
			}
		: {};

	// First chunk — always a top-level post
	const { facets: firstFacets } = await buildFacets(agent, firstChunk);
	const firstRecord: Record<string, unknown> = { text: firstChunk, ...labelsRecord };
	if (firstFacets?.length) firstRecord['facets'] = firstFacets;
	const firstResponse = await agent.post(firstRecord);
	const first: PostRef = { uri: firstResponse.uri, cid: firstResponse.cid };
	const refs: [PostRef, ...PostRef[]] = [first];

	// Subsequent chunks — self-reply chain
	let prev = first;
	for (const chunk of restChunks) {
		const { facets } = await buildFacets(agent, chunk);
		const record: Record<string, unknown> = {
			text: chunk,
			...labelsRecord,
			reply: {
				parent: { uri: prev.uri, cid: prev.cid },
				root: { uri: first.uri, cid: first.cid },
			},
		};
		if (facets?.length) record['facets'] = facets;
		const response = await agent.post(record);
		prev = { uri: response.uri, cid: response.cid };
		refs.push(prev);
	}

	return refs;
}

export async function replyToPost(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
	labels?: string[],
): Promise<PostRef> {
	const [first] = await replyToPostChain(
		agent,
		text,
		parentUri,
		parentCid,
		rootUri,
		rootCid,
		labels,
	);
	return first;
}

/** Reply to a post, auto-splitting into a chain if needed. Returns all refs (always at least one). */
export async function replyToPostChain(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
	labels?: string[],
): Promise<[PostRef, ...PostRef[]]> {
	const [firstChunk, ...restChunks] = splitForPost(text);
	const labelsRecord = labels?.length
		? {
				labels: {
					$type: 'com.atproto.label.defs#selfLabels',
					values: labels.map((val) => ({ val })),
				},
			}
		: {};

	// First chunk — reply to the specified parent
	const { facets: firstFacets } = await buildFacets(agent, firstChunk);
	const firstRecord: Record<string, unknown> = {
		text: firstChunk,
		...labelsRecord,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	};
	if (firstFacets?.length) firstRecord['facets'] = firstFacets;
	const firstResponse = await agent.post(firstRecord);
	const first: PostRef = { uri: firstResponse.uri, cid: firstResponse.cid };
	const refs: [PostRef, ...PostRef[]] = [first];

	// Subsequent chunks — chain under same root
	let prev = first;
	for (const chunk of restChunks) {
		const { facets } = await buildFacets(agent, chunk);
		const record: Record<string, unknown> = {
			text: chunk,
			...labelsRecord,
			reply: {
				parent: { uri: prev.uri, cid: prev.cid },
				root: { uri: rootUri, cid: rootCid },
			},
		};
		if (facets?.length) record['facets'] = facets;
		const response = await agent.post(record);
		prev = { uri: response.uri, cid: response.cid };
		refs.push(prev);
	}

	return refs;
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
): Promise<PostRef> {
	const [first] = await postWithQuoteChain(agent, text, quotedUri, quotedCid, labels);
	return first;
}

/** Post with quote-embed, auto-splitting into chain. Only first post gets the embed. */
export async function postWithQuoteChain(
	agent: AtpAgent,
	text: string,
	quotedUri: string,
	quotedCid: string,
	labels?: string[],
): Promise<[PostRef, ...PostRef[]]> {
	const [firstChunk, ...restChunks] = splitForPost(text);
	const labelsRecord = labels?.length
		? {
				labels: {
					$type: 'com.atproto.label.defs#selfLabels',
					values: labels.map((val) => ({ val })),
				},
			}
		: {};

	// First chunk — includes the quote embed
	const { facets: firstFacets } = await buildFacets(agent, firstChunk);
	const firstRecord: Record<string, unknown> = {
		text: firstChunk,
		...labelsRecord,
		embed: {
			$type: 'app.bsky.embed.record',
			record: { uri: quotedUri, cid: quotedCid },
		},
	};
	if (firstFacets?.length) firstRecord['facets'] = firstFacets;
	const firstResponse = await agent.post(firstRecord);
	const first: PostRef = { uri: firstResponse.uri, cid: firstResponse.cid };
	const refs: [PostRef, ...PostRef[]] = [first];

	// Subsequent chunks — self-reply chain, no embed
	let prev = first;
	for (const chunk of restChunks) {
		const { facets } = await buildFacets(agent, chunk);
		const record: Record<string, unknown> = {
			text: chunk,
			...labelsRecord,
			reply: {
				parent: { uri: prev.uri, cid: prev.cid },
				root: { uri: first.uri, cid: first.cid },
			},
		};
		if (facets?.length) record['facets'] = facets;
		const response = await agent.post(record);
		prev = { uri: response.uri, cid: response.cid };
		refs.push(prev);
	}

	return refs;
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
		depth: 100,
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

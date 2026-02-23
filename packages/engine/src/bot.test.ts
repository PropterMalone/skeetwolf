import { describe, expect, it, vi } from 'vitest';
import {
	createDayThreadgate,
	createPostgate,
	createThreadgate,
	deletePostgate,
	deleteThreadgate,
	extractRkey,
	postWithQuote,
	truncateToLimit,
} from './bot.js';

describe('extractRkey', () => {
	it('extracts rkey from a standard AT URI', () => {
		expect(extractRkey('at://did:plc:abc123/app.bsky.feed.post/3abc')).toBe('3abc');
	});

	it('extracts rkey from a URI with longer rkey', () => {
		expect(extractRkey('at://did:plc:xyz/collection/rkey-with-dashes')).toBe('rkey-with-dashes');
	});

	it('throws on empty string', () => {
		expect(() => extractRkey('')).toThrow('invalid AT URI');
	});
});

describe('truncateToLimit', () => {
	it('returns short text unchanged', () => {
		expect(truncateToLimit('hello', 300)).toBe('hello');
	});

	it('truncates text exceeding limit', () => {
		const text = 'a'.repeat(350);
		const result = truncateToLimit(text, 300);
		// 299 chars + ellipsis
		expect([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(result)]).toHaveLength(
			300,
		);
		expect(result.endsWith('…')).toBe(true);
	});

	it('handles emoji graphemes correctly', () => {
		// Each flag emoji is 1 grapheme but multiple code points
		const flags = '🇺🇸'.repeat(150); // 150 graphemes
		const result = truncateToLimit(flags, 100);
		const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(result)];
		expect(segments.length).toBe(100);
	});
});

/** Minimal agent mock with identity resolver for RichText.detectFacets */
function mockAgent(postResult = { uri: 'at://bot/post/1', cid: 'cid-1' }) {
	return {
		post: vi.fn().mockResolvedValue(postResult),
		com: {
			atproto: {
				identity: {
					resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:resolved' } }),
				},
			},
		},
	};
}

describe('postWithQuote', () => {
	it('posts with quote embed and labels', async () => {
		const agent = mockAgent();

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await postWithQuote(agent as any, 'Day 2!', 'at://prev/post/1', 'cid-prev', [
			'skeetwolf',
		]);

		expect(result).toEqual({ uri: 'at://bot/post/1', cid: 'cid-1' });
		const call = agent.post.mock.calls[0]?.[0];
		expect(call.text).toBe('Day 2!');
		expect(call.embed).toEqual({
			$type: 'app.bsky.embed.record',
			record: { uri: 'at://prev/post/1', cid: 'cid-prev' },
		});
		expect(call.labels).toBeDefined();
	});

	it('posts without labels when none provided', async () => {
		const agent = mockAgent();

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await postWithQuote(agent as any, 'text', 'at://x/y/z', 'cid-x');

		const call = agent.post.mock.calls[0]?.[0];
		expect(call.labels).toBeUndefined();
	});

	it('includes facets when text contains mentions', async () => {
		const agent = mockAgent();

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await postWithQuote(agent as any, 'Hey @alice.bsky.social!', 'at://x/y/z', 'cid-x');

		const call = agent.post.mock.calls[0]?.[0];
		expect(call.facets).toBeDefined();
		expect(call.facets.length).toBeGreaterThan(0);
	});
});

describe('createThreadgate', () => {
	it('creates a threadgate record with empty allow list', async () => {
		const createRecord = vi.fn().mockResolvedValue({});
		const agent = {
			session: { did: 'did:plc:bot' },
			api: { com: { atproto: { repo: { createRecord } } } },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await createThreadgate(agent as any, 'at://did:plc:bot/app.bsky.feed.post/abc123');

		expect(createRecord).toHaveBeenCalledOnce();
		const arg = createRecord.mock.calls[0]?.[0];
		expect(arg.collection).toBe('app.bsky.feed.threadgate');
		expect(arg.rkey).toBe('abc123');
		expect(arg.record.post).toBe('at://did:plc:bot/app.bsky.feed.post/abc123');
		expect(arg.record.allow).toEqual([]);
	});

	it('throws without active session', async () => {
		const agent = { session: null, api: { com: { atproto: { repo: { createRecord: vi.fn() } } } } };
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expect(createThreadgate(agent as any, 'at://x/y/z')).rejects.toThrow('no active session');
	});
});

describe('createPostgate', () => {
	it('creates a postgate record with disableRule', async () => {
		const createRecord = vi.fn().mockResolvedValue({});
		const agent = {
			session: { did: 'did:plc:bot' },
			api: { com: { atproto: { repo: { createRecord } } } },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await createPostgate(agent as any, 'at://did:plc:bot/app.bsky.feed.post/xyz');

		expect(createRecord).toHaveBeenCalledOnce();
		const arg = createRecord.mock.calls[0]?.[0];
		expect(arg.collection).toBe('app.bsky.feed.postgate');
		expect(arg.rkey).toBe('xyz');
		expect(arg.record.embeddingRules).toEqual([{ $type: 'app.bsky.feed.postgate#disableRule' }]);
	});
});

describe('deletePostgate', () => {
	it('deletes a postgate record by rkey', async () => {
		const deleteRecord = vi.fn().mockResolvedValue({});
		const agent = {
			session: { did: 'did:plc:bot' },
			api: { com: { atproto: { repo: { deleteRecord } } } },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await deletePostgate(agent as any, 'at://did:plc:bot/app.bsky.feed.post/abc');

		expect(deleteRecord).toHaveBeenCalledOnce();
		const arg = deleteRecord.mock.calls[0]?.[0];
		expect(arg.collection).toBe('app.bsky.feed.postgate');
		expect(arg.rkey).toBe('abc');
	});
});

describe('createDayThreadgate', () => {
	it('creates a threadgate with mentionRule', async () => {
		const createRecord = vi.fn().mockResolvedValue({});
		const agent = {
			session: { did: 'did:plc:bot' },
			api: { com: { atproto: { repo: { createRecord } } } },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await createDayThreadgate(agent as any, 'at://did:plc:bot/app.bsky.feed.post/day1');

		expect(createRecord).toHaveBeenCalledOnce();
		const arg = createRecord.mock.calls[0]?.[0];
		expect(arg.collection).toBe('app.bsky.feed.threadgate');
		expect(arg.rkey).toBe('day1');
		expect(arg.record.allow).toEqual([{ $type: 'app.bsky.feed.threadgate#mentionRule' }]);
	});

	it('throws without active session', async () => {
		const agent = { session: null, api: { com: { atproto: { repo: { createRecord: vi.fn() } } } } };
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expect(createDayThreadgate(agent as any, 'at://x/y/z')).rejects.toThrow(
			'no active session',
		);
	});
});

describe('deleteThreadgate', () => {
	it('deletes a threadgate record by rkey', async () => {
		const deleteRecord = vi.fn().mockResolvedValue({});
		const agent = {
			session: { did: 'did:plc:bot' },
			api: { com: { atproto: { repo: { deleteRecord } } } },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await deleteThreadgate(agent as any, 'at://did:plc:bot/app.bsky.feed.post/day1');

		expect(deleteRecord).toHaveBeenCalledOnce();
		const arg = deleteRecord.mock.calls[0]?.[0];
		expect(arg.collection).toBe('app.bsky.feed.threadgate');
		expect(arg.rkey).toBe('day1');
	});

	it('throws without active session', async () => {
		const agent = { session: null, api: { com: { atproto: { repo: { deleteRecord: vi.fn() } } } } };
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expect(deleteThreadgate(agent as any, 'at://x/y/z')).rejects.toThrow('no active session');
	});
});

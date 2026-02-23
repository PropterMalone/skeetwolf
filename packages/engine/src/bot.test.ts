import { describe, expect, it, vi } from 'vitest';
import {
	createPostgate,
	createThreadgate,
	deletePostgate,
	extractRkey,
	postWithQuote,
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

describe('postWithQuote', () => {
	it('posts with quote embed and labels', async () => {
		const agent = {
			post: vi.fn().mockResolvedValue({ uri: 'at://bot/post/1', cid: 'cid-1' }),
		};

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
		const agent = {
			post: vi.fn().mockResolvedValue({ uri: 'at://bot/post/1', cid: 'cid-1' }),
		};

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await postWithQuote(agent as any, 'text', 'at://x/y/z', 'cid-x');

		const call = agent.post.mock.calls[0]?.[0];
		expect(call.labels).toBeUndefined();
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

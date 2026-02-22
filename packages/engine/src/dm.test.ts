import type { AtpAgent } from '@atproto/api';
import { describe, expect, it, vi } from 'vitest';
import {
	createBlueskyDmSender,
	createChatAgent,
	createConsoleDmSender,
	pollInboundDms,
} from './dm.js';

describe('createConsoleDmSender', () => {
	it('sends a DM to console', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		await sender.sendDm('did:plc:alice', 'hello');

		expect(spy).toHaveBeenCalledWith('[DM → did:plc:alice] hello');
		spy.mockRestore();
	});

	it('creates and sends to relay group', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		sender.createRelayGroup('mafia-1', ['did:plc:alice', 'did:plc:bob']);
		await sender.sendToRelayGroup('mafia-1', 'lets kill charlie');

		expect(spy).toHaveBeenCalledWith('[RELAY GROUP mafia-1] created: did:plc:alice, did:plc:bob');
		expect(spy).toHaveBeenCalledWith('[RELAY mafia-1 → did:plc:alice] lets kill charlie');
		expect(spy).toHaveBeenCalledWith('[RELAY mafia-1 → did:plc:bob] lets kill charlie');
		spy.mockRestore();
	});

	it('handles unknown relay group gracefully', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		// No members → no output
		await sender.sendToRelayGroup('nonexistent', 'hello');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

function createMockChatAgent(botDid = 'did:plc:bot') {
	const getConvoForMembers = vi.fn().mockResolvedValue({
		data: { convo: { id: 'convo-default' } },
	});
	const sendMessage = vi.fn().mockResolvedValue({});
	const listConvos = vi.fn().mockResolvedValue({ data: { convos: [] } });
	const getMessages = vi.fn().mockResolvedValue({ data: { messages: [] } });
	const updateRead = vi.fn().mockResolvedValue({});

	return {
		session: { did: botDid },
		chat: {
			bsky: {
				convo: {
					getConvoForMembers,
					sendMessage,
					listConvos,
					getMessages,
					updateRead,
				},
			},
		},
		// Expose stubs for direct assertion
		stubs: { getConvoForMembers, sendMessage, listConvos, getMessages, updateRead },
	};
}

describe('createChatAgent', () => {
	it('calls withProxy with chat service DID', () => {
		const mockProxy = { chat: {} };
		const agent = { withProxy: vi.fn().mockReturnValue(mockProxy) } as unknown as AtpAgent;

		const result = createChatAgent(agent);

		expect(agent.withProxy).toHaveBeenCalledWith('bsky_chat', 'did:web:api.bsky.chat');
		expect(result).toBe(mockProxy);
	});
});

describe('createBlueskyDmSender', () => {
	it('sendDm resolves convo and sends message', async () => {
		const mock = createMockChatAgent();
		mock.stubs.getConvoForMembers.mockResolvedValue({
			data: { convo: { id: 'convo-alice' } },
		});
		const sender = createBlueskyDmSender(mock as unknown as AtpAgent);

		await sender.sendDm('did:plc:alice', 'hello');

		expect(mock.stubs.getConvoForMembers).toHaveBeenCalledWith({
			members: ['did:plc:alice'],
		});
		expect(mock.stubs.sendMessage).toHaveBeenCalledWith({
			convoId: 'convo-alice',
			message: { text: 'hello' },
		});
	});

	it('caches convoId — second sendDm skips getConvoForMembers', async () => {
		const mock = createMockChatAgent();
		mock.stubs.getConvoForMembers.mockResolvedValue({
			data: { convo: { id: 'convo-alice' } },
		});
		const sender = createBlueskyDmSender(mock as unknown as AtpAgent);

		await sender.sendDm('did:plc:alice', 'first');
		await sender.sendDm('did:plc:alice', 'second');

		expect(mock.stubs.getConvoForMembers).toHaveBeenCalledTimes(1);
		expect(mock.stubs.sendMessage).toHaveBeenCalledTimes(2);
	});

	it('createRelayGroup + sendToRelayGroup sends to all members', async () => {
		const mock = createMockChatAgent();
		let callCount = 0;
		mock.stubs.getConvoForMembers.mockImplementation(async () => {
			callCount++;
			return { data: { convo: { id: `convo-${callCount}` } } };
		});
		const sender = createBlueskyDmSender(mock as unknown as AtpAgent);

		sender.createRelayGroup('mafia-1', ['did:plc:alice', 'did:plc:bob']);
		await sender.sendToRelayGroup('mafia-1', 'night action');

		expect(mock.stubs.sendMessage).toHaveBeenCalledTimes(2);
		expect(mock.stubs.sendMessage).toHaveBeenCalledWith({
			convoId: 'convo-1',
			message: { text: 'night action' },
		});
		expect(mock.stubs.sendMessage).toHaveBeenCalledWith({
			convoId: 'convo-2',
			message: { text: 'night action' },
		});
	});

	it('sendToRelayGroup with unknown group logs error and does not throw', async () => {
		const mock = createMockChatAgent();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const sender = createBlueskyDmSender(mock as unknown as AtpAgent);

		await sender.sendToRelayGroup('nonexistent', 'hello');

		expect(spy).toHaveBeenCalledWith('relay group nonexistent not found');
		expect(mock.stubs.sendMessage).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('pollInboundDms', () => {
	it('throws if agent not authenticated', async () => {
		const mock = createMockChatAgent();
		(mock as Record<string, unknown>)['session'] = undefined;

		await expect(pollInboundDms(mock as unknown as AtpAgent)).rejects.toThrow(
			'chat agent not authenticated',
		);
	});

	it('returns messages from non-bot senders', async () => {
		const mock = createMockChatAgent('did:plc:bot');
		mock.stubs.listConvos.mockResolvedValue({
			data: {
				convos: [{ id: 'convo-1', unreadCount: 1 }],
			},
		});
		mock.stubs.getMessages.mockResolvedValue({
			data: {
				messages: [
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-1',
						sender: { did: 'did:plc:alice' },
						text: 'kill bob',
						sentAt: '2026-01-01T00:00:00Z',
					},
				],
			},
		});

		const result = await pollInboundDms(mock as unknown as AtpAgent);

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toEqual({
			senderDid: 'did:plc:alice',
			convoId: 'convo-1',
			messageId: 'msg-1',
			text: 'kill bob',
			sentAt: '2026-01-01T00:00:00Z',
		});
		expect(result.latestMessageId).toBe('msg-1');
	});

	it('skips convos with unreadCount === 0', async () => {
		const mock = createMockChatAgent();
		mock.stubs.listConvos.mockResolvedValue({
			data: {
				convos: [
					{ id: 'convo-1', unreadCount: 0 },
					{ id: 'convo-2', unreadCount: 1 },
				],
			},
		});
		mock.stubs.getMessages.mockResolvedValue({
			data: {
				messages: [
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-1',
						sender: { did: 'did:plc:alice' },
						text: 'hi',
						sentAt: '2026-01-01T00:00:00Z',
					},
				],
			},
		});

		await pollInboundDms(mock as unknown as AtpAgent);

		// Only convo-2 should have been fetched
		expect(mock.stubs.getMessages).toHaveBeenCalledTimes(1);
		expect(mock.stubs.getMessages).toHaveBeenCalledWith({ convoId: 'convo-2', limit: 20 });
	});

	it('filters out bot own messages', async () => {
		const mock = createMockChatAgent('did:plc:bot');
		mock.stubs.listConvos.mockResolvedValue({
			data: { convos: [{ id: 'convo-1', unreadCount: 1 }] },
		});
		mock.stubs.getMessages.mockResolvedValue({
			data: {
				messages: [
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-1',
						sender: { did: 'did:plc:bot' },
						text: 'my own message',
						sentAt: '2026-01-01T00:00:00Z',
					},
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-2',
						sender: { did: 'did:plc:alice' },
						text: 'player message',
						sentAt: '2026-01-01T00:01:00Z',
					},
				],
			},
		});

		const result = await pollInboundDms(mock as unknown as AtpAgent);

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]!.senderDid).toBe('did:plc:alice');
	});

	it('filters messages older than sinceMessageId', async () => {
		const mock = createMockChatAgent();
		mock.stubs.listConvos.mockResolvedValue({
			data: { convos: [{ id: 'convo-1', unreadCount: 1 }] },
		});
		mock.stubs.getMessages.mockResolvedValue({
			data: {
				messages: [
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-1',
						sender: { did: 'did:plc:alice' },
						text: 'old',
						sentAt: '2026-01-01T00:00:00Z',
					},
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-5',
						sender: { did: 'did:plc:alice' },
						text: 'new',
						sentAt: '2026-01-01T00:05:00Z',
					},
				],
			},
		});

		const result = await pollInboundDms(mock as unknown as AtpAgent, 'msg-3');

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]!.messageId).toBe('msg-5');
		expect(result.latestMessageId).toBe('msg-5');
	});

	it('calls updateRead on processed convos', async () => {
		const mock = createMockChatAgent();
		mock.stubs.listConvos.mockResolvedValue({
			data: {
				convos: [
					{ id: 'convo-1', unreadCount: 2 },
					{ id: 'convo-2', unreadCount: 1 },
				],
			},
		});
		mock.stubs.getMessages.mockResolvedValue({
			data: {
				messages: [
					{
						$type: 'chat.bsky.convo.defs#messageView',
						id: 'msg-1',
						sender: { did: 'did:plc:alice' },
						text: 'hi',
						sentAt: '2026-01-01T00:00:00Z',
					},
				],
			},
		});

		await pollInboundDms(mock as unknown as AtpAgent);

		expect(mock.stubs.updateRead).toHaveBeenCalledTimes(2);
		expect(mock.stubs.updateRead).toHaveBeenCalledWith({ convoId: 'convo-1' });
		expect(mock.stubs.updateRead).toHaveBeenCalledWith({ convoId: 'convo-2' });
	});
});

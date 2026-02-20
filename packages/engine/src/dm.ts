/**
 * DM handling via chat.bsky.convo.
 *
 * Group DMs don't exist on Bluesky yet, so "group" chat is bot-relayed:
 * each member has a 1:1 convo with the bot, and the bot forwards messages
 * between them.
 */
import type { AtpAgent } from '@atproto/api';

/** Outbound DM capabilities */
export interface DmSender {
	sendDm(recipientDid: string, text: string): Promise<void>;
	/** Create a relay group — bot will forward messages between members via 1:1 DMs */
	createRelayGroup(groupId: string, memberDids: string[]): void;
	/** Send a message to all members of a relay group */
	sendToRelayGroup(groupId: string, text: string): Promise<void>;
}

/** Inbound DM from a player */
export interface InboundDm {
	senderDid: string;
	convoId: string;
	messageId: string;
	text: string;
	sentAt: string;
}

/**
 * Create a chat-proxied agent for DM operations.
 * All chat requests need the Atproto-Proxy header pointing to the chat service.
 */
export function createChatAgent(agent: AtpAgent): AtpAgent {
	return agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;
}

/**
 * Real DM sender using chat.bsky.convo API.
 * Caches convo IDs to avoid repeated lookups.
 */
export function createBlueskyDmSender(chatAgent: AtpAgent): DmSender {
	const convoCache = new Map<string, string>(); // did → convoId
	const relayGroups = new Map<string, string[]>(); // groupId → memberDids

	async function getOrCreateConvo(recipientDid: string): Promise<string> {
		const cached = convoCache.get(recipientDid);
		if (cached) return cached;

		const response = await chatAgent.chat.bsky.convo.getConvoForMembers({
			members: [recipientDid],
		});
		const convoId = response.data.convo.id;
		convoCache.set(recipientDid, convoId);
		return convoId;
	}

	return {
		async sendDm(recipientDid: string, text: string): Promise<void> {
			const convoId = await getOrCreateConvo(recipientDid);
			await chatAgent.chat.bsky.convo.sendMessage({
				convoId,
				message: { text },
			});
		},

		createRelayGroup(groupId: string, memberDids: string[]): void {
			relayGroups.set(groupId, memberDids);
		},

		async sendToRelayGroup(groupId: string, text: string): Promise<void> {
			const members = relayGroups.get(groupId);
			if (!members) {
				console.error(`relay group ${groupId} not found`);
				return;
			}
			await Promise.all(
				members.map(async (did) => {
					const convoId = await getOrCreateConvo(did);
					await chatAgent.chat.bsky.convo.sendMessage({
						convoId,
						message: { text },
					});
				}),
			);
		},
	};
}

/**
 * Poll for new DMs across all conversations.
 * Returns messages newer than the given cursor (message ID).
 *
 * Strategy: list recent convos, fetch new messages from each.
 * This is O(convos) per poll — fine for small game counts.
 */
export async function pollInboundDms(
	chatAgent: AtpAgent,
	sinceMessageId?: string,
): Promise<{ messages: InboundDm[]; latestMessageId: string | undefined }> {
	const botDid = chatAgent.session?.did;
	if (!botDid) throw new Error('chat agent not authenticated');

	// List recent conversations
	const { data: convoList } = await chatAgent.chat.bsky.convo.listConvos({ limit: 50 });

	const allMessages: InboundDm[] = [];
	let latestId = sinceMessageId;

	for (const convo of convoList.convos) {
		// Skip convos with no unread messages (optimization)
		if (convo.unreadCount === 0) continue;

		const { data: msgData } = await chatAgent.chat.bsky.convo.getMessages({
			convoId: convo.id,
			limit: 20,
		});

		for (const msg of msgData.messages) {
			// Skip our own messages
			if (msg.sender.did === botDid) continue;

			// Skip if we've already seen this message
			if (sinceMessageId && msg.id <= sinceMessageId) continue;

			// Only handle regular text messages
			if (msg.$type !== 'chat.bsky.convo.defs#messageView') continue;

			allMessages.push({
				senderDid: msg.sender.did,
				convoId: convo.id,
				messageId: msg.id,
				text: (msg as { text?: string }).text ?? '',
				sentAt: msg.sentAt,
			});

			if (!latestId || msg.id > latestId) {
				latestId = msg.id;
			}
		}

		// Mark conversation as read
		await chatAgent.chat.bsky.convo.updateRead({ convoId: convo.id });
	}

	return { messages: allMessages, latestMessageId: latestId };
}

/**
 * Console-based DM sender for local development.
 * Logs all DMs to stdout instead of sending via API.
 */
export function createConsoleDmSender(): DmSender {
	const relayGroups = new Map<string, string[]>();

	return {
		async sendDm(recipientDid, text) {
			console.log(`[DM → ${recipientDid}] ${text}`);
		},
		createRelayGroup(groupId, memberDids) {
			relayGroups.set(groupId, memberDids);
			console.log(`[RELAY GROUP ${groupId}] created: ${memberDids.join(', ')}`);
		},
		async sendToRelayGroup(groupId, text) {
			const members = relayGroups.get(groupId) ?? [];
			for (const did of members) {
				console.log(`[RELAY ${groupId} → ${did}] ${text}`);
			}
		},
	};
}

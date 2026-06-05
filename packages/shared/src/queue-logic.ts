/**
 * Pure queue + invite logic — no side effects, no I/O.
 * All functions take state in, return new state out.
 */
import type {
	Did,
	GameConfig,
	GameId,
	Handle,
	InviteGame,
	InviteResult,
	InviteSlot,
	PublicQueue,
	QueueEntry,
	QueueResult,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// -- Public Queue --

export function createQueue(): PublicQueue {
	return { entries: [] };
}

export function addToQueue(queue: PublicQueue, did: Did, handle: Handle, now: number): QueueResult {
	if (queue.entries.some((e) => e.did === did)) {
		return { ok: false, error: 'already in queue', queue };
	}
	const entry: QueueEntry = { did, handle, joinedAt: now };
	return { ok: true, queue: { entries: [...queue.entries, entry] } };
}

export function removeFromQueue(queue: PublicQueue, did: Did): QueueResult {
	const before = queue.entries.length;
	const entries = queue.entries.filter((e) => e.did !== did);
	if (entries.length === before) {
		return { ok: false, error: 'not in queue', queue };
	}
	return { ok: true, queue: { entries } };
}

export function isQueued(queue: PublicQueue, did: Did): boolean {
	return queue.entries.some((e) => e.did === did);
}

export function canPopQueue(queue: PublicQueue, minPlayers: number): boolean {
	return queue.entries.length >= minPlayers;
}

/** Pop the first `count` entries from the queue (FIFO). Returns popped entries and remaining queue. */
export function popQueue(
	queue: PublicQueue,
	count: number,
): { popped: QueueEntry[]; queue: PublicQueue } {
	const popped = queue.entries.slice(0, count);
	const remaining = queue.entries.slice(count);
	return { popped, queue: { entries: remaining } };
}

// -- Invite Games --

export function createInviteGame(
	id: GameId,
	initiatorDid: Did,
	initiatorHandle: Handle,
	invitedSlots: { did: Did; handle: Handle }[],
	config: Partial<GameConfig> = {},
	now: number = Date.now(),
): InviteResult {
	const fullConfig = { ...DEFAULT_CONFIG, ...config };

	// Initiator is auto-confirmed
	const slots: InviteSlot[] = [
		{ did: initiatorDid, handle: initiatorHandle, confirmed: true },
		...invitedSlots.map((s) => ({ did: s.did, handle: s.handle, confirmed: false })),
	];

	const invite: InviteGame = {
		id,
		initiatorDid,
		initiatorHandle,
		slots,
		status: 'pending',
		createdAt: now,
		config: fullConfig,
	};

	return { ok: true, invite };
}

export function confirmInvite(invite: InviteGame, did: Did): InviteResult {
	if (invite.status !== 'pending') {
		return { ok: false, error: 'invite is not pending', invite };
	}
	const slot = invite.slots.find((s) => s.did === did);
	if (!slot) {
		return { ok: false, error: 'not invited to this game', invite };
	}
	if (slot.confirmed) {
		return { ok: false, error: 'already confirmed', invite };
	}
	const slots = invite.slots.map((s) => (s.did === did ? { ...s, confirmed: true } : s));
	return { ok: true, invite: { ...invite, slots } };
}

export function addInviteSlot(invite: InviteGame, did: Did, handle: Handle): InviteResult {
	if (invite.status !== 'pending') {
		return { ok: false, error: 'invite is not pending', invite };
	}
	if (invite.slots.some((s) => s.did === did)) {
		return { ok: false, error: 'already in this invite', invite };
	}
	const slots = [...invite.slots, { did, handle, confirmed: false }];
	return { ok: true, invite: { ...invite, slots } };
}

export function removeInviteSlot(invite: InviteGame, did: Did): InviteResult {
	if (invite.status !== 'pending') {
		return { ok: false, error: 'invite is not pending', invite };
	}
	if (invite.initiatorDid === did) {
		return { ok: false, error: 'cannot remove the initiator', invite };
	}
	const before = invite.slots.length;
	const slots = invite.slots.filter((s) => s.did !== did);
	if (slots.length === before) {
		return { ok: false, error: 'not in this invite', invite };
	}
	return { ok: true, invite: { ...invite, slots } };
}

export function cancelInvite(invite: InviteGame): InviteResult {
	if (invite.status !== 'pending') {
		return { ok: false, error: 'invite is not pending', invite };
	}
	return { ok: true, invite: { ...invite, status: 'cancelled' } };
}

export function isInviteReady(invite: InviteGame, minPlayers: number): boolean {
	if (invite.status !== 'pending') return false;
	const confirmed = invite.slots.filter((s) => s.confirmed).length;
	return confirmed >= minPlayers;
}

/** Convert a ready invite into the player list for game creation */
export function inviteGameToPlayers(invite: InviteGame): { did: Did; handle: Handle }[] {
	return invite.slots.filter((s) => s.confirmed).map((s) => ({ did: s.did, handle: s.handle }));
}

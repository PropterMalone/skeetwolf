import { describe, expect, it } from 'vitest';
import {
	addInviteSlot,
	addToQueue,
	canPopQueue,
	cancelInvite,
	confirmInvite,
	createInviteGame,
	createQueue,
	inviteGameToPlayers,
	isInviteReady,
	isQueued,
	popQueue,
	removeFromQueue,
	removeInviteSlot,
} from './queue-logic.js';

describe('public queue', () => {
	it('creates an empty queue', () => {
		const q = createQueue();
		expect(q.entries).toEqual([]);
	});

	it('adds a player to the queue', () => {
		const q = createQueue();
		const result = addToQueue(q, 'did:alice', 'alice.bsky.social', 1000);
		expect(result.ok).toBe(true);
		expect(result.queue.entries).toHaveLength(1);
		expect(result.queue.entries[0]).toEqual({
			did: 'did:alice',
			handle: 'alice.bsky.social',
			joinedAt: 1000,
		});
	});

	it('rejects duplicate queue entry', () => {
		const q = createQueue();
		const r1 = addToQueue(q, 'did:alice', 'alice.bsky.social', 1000);
		const r2 = addToQueue(r1.queue, 'did:alice', 'alice.bsky.social', 2000);
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('already in queue');
	});

	it('removes a player from the queue', () => {
		let q = createQueue();
		q = addToQueue(q, 'did:alice', 'alice', 1000).queue;
		q = addToQueue(q, 'did:bob', 'bob', 2000).queue;
		const result = removeFromQueue(q, 'did:alice');
		expect(result.ok).toBe(true);
		expect(result.queue.entries).toHaveLength(1);
		expect(result.queue.entries[0].did).toBe('did:bob');
	});

	it('returns error when removing someone not in queue', () => {
		const q = createQueue();
		const result = removeFromQueue(q, 'did:alice');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('not in queue');
	});

	it('checks if a player is queued', () => {
		let q = createQueue();
		expect(isQueued(q, 'did:alice')).toBe(false);
		q = addToQueue(q, 'did:alice', 'alice', 1000).queue;
		expect(isQueued(q, 'did:alice')).toBe(true);
	});

	it('checks if queue can pop', () => {
		let q = createQueue();
		expect(canPopQueue(q, 3)).toBe(false);
		q = addToQueue(q, 'did:a', 'a', 1).queue;
		q = addToQueue(q, 'did:b', 'b', 2).queue;
		expect(canPopQueue(q, 3)).toBe(false);
		q = addToQueue(q, 'did:c', 'c', 3).queue;
		expect(canPopQueue(q, 3)).toBe(true);
	});

	it('pops entries FIFO', () => {
		let q = createQueue();
		q = addToQueue(q, 'did:a', 'a', 1).queue;
		q = addToQueue(q, 'did:b', 'b', 2).queue;
		q = addToQueue(q, 'did:c', 'c', 3).queue;
		q = addToQueue(q, 'did:d', 'd', 4).queue;

		const { popped, queue } = popQueue(q, 3);
		expect(popped).toHaveLength(3);
		expect(popped[0].did).toBe('did:a');
		expect(popped[1].did).toBe('did:b');
		expect(popped[2].did).toBe('did:c');
		expect(queue.entries).toHaveLength(1);
		expect(queue.entries[0].did).toBe('did:d');
	});

	it('pops all entries when count >= length', () => {
		let q = createQueue();
		q = addToQueue(q, 'did:a', 'a', 1).queue;
		const { popped, queue } = popQueue(q, 5);
		expect(popped).toHaveLength(1);
		expect(queue.entries).toHaveLength(0);
	});

	it('does not mutate original queue', () => {
		const q = createQueue();
		const r = addToQueue(q, 'did:a', 'a', 1);
		expect(q.entries).toHaveLength(0);
		expect(r.queue.entries).toHaveLength(1);
	});
});

describe('invite games', () => {
	const NOW = 1000;

	it('creates an invite game with initiator auto-confirmed', () => {
		const result = createInviteGame(
			'game1',
			'did:init',
			'init.bsky.social',
			[
				{ did: 'did:a', handle: 'a.bsky.social' },
				{ did: 'did:b', handle: 'b.bsky.social' },
			],
			{},
			NOW,
		);
		expect(result.ok).toBe(true);
		expect(result.invite.slots).toHaveLength(3);
		expect(result.invite.slots[0]).toEqual({
			did: 'did:init',
			handle: 'init.bsky.social',
			confirmed: true,
		});
		expect(result.invite.slots[1].confirmed).toBe(false);
		expect(result.invite.slots[2].confirmed).toBe(false);
		expect(result.invite.status).toBe('pending');
	});

	it('confirms an invited player', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[{ did: 'did:a', handle: 'a' }],
			{},
			NOW,
		);
		const result = confirmInvite(invite, 'did:a');
		expect(result.ok).toBe(true);
		expect(result.invite.slots.find((s) => s.did === 'did:a')?.confirmed).toBe(true);
	});

	it('rejects confirming if not invited', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const result = confirmInvite(invite, 'did:stranger');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('not invited to this game');
	});

	it('rejects double confirmation', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[{ did: 'did:a', handle: 'a' }],
			{},
			NOW,
		);
		const r1 = confirmInvite(invite, 'did:a');
		const r2 = confirmInvite(r1.invite, 'did:a');
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('already confirmed');
	});

	it('adds a new invite slot', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const result = addInviteSlot(invite, 'did:new', 'new.bsky.social');
		expect(result.ok).toBe(true);
		expect(result.invite.slots).toHaveLength(2);
		expect(result.invite.slots[1]).toEqual({
			did: 'did:new',
			handle: 'new.bsky.social',
			confirmed: false,
		});
	});

	it('rejects adding duplicate slot', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[{ did: 'did:a', handle: 'a' }],
			{},
			NOW,
		);
		const result = addInviteSlot(invite, 'did:a', 'a');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('already in this invite');
	});

	it('removes an invite slot', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[{ did: 'did:a', handle: 'a' }],
			{},
			NOW,
		);
		const result = removeInviteSlot(invite, 'did:a');
		expect(result.ok).toBe(true);
		expect(result.invite.slots).toHaveLength(1);
	});

	it('cannot remove the initiator', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const result = removeInviteSlot(invite, 'did:init');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('cannot remove the initiator');
	});

	it('cancels an invite', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const result = cancelInvite(invite);
		expect(result.ok).toBe(true);
		expect(result.invite.status).toBe('cancelled');
	});

	it('cannot cancel an already cancelled invite', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const cancelled = cancelInvite(invite).invite;
		const result = cancelInvite(cancelled);
		expect(result.ok).toBe(false);
		expect(result.error).toBe('invite is not pending');
	});

	it('checks if invite is ready', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[
				{ did: 'did:a', handle: 'a' },
				{ did: 'did:b', handle: 'b' },
				{ did: 'did:c', handle: 'c' },
				{ did: 'did:d', handle: 'd' },
			],
			{},
			NOW,
		);
		// Only initiator confirmed (1/5)
		expect(isInviteReady(invite, 5)).toBe(false);

		// Confirm all 4 invited players
		let current = invite;
		for (const did of ['did:a', 'did:b', 'did:c', 'did:d']) {
			current = confirmInvite(current, did).invite;
		}
		expect(isInviteReady(current, 5)).toBe(true);
	});

	it('isInviteReady returns false for cancelled invite', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const cancelled = cancelInvite(invite).invite;
		expect(isInviteReady(cancelled, 1)).toBe(false);
	});

	it('converts invite to player list (confirmed only)', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[
				{ did: 'did:a', handle: 'a' },
				{ did: 'did:b', handle: 'b' },
			],
			{},
			NOW,
		);
		// Only confirm did:a, not did:b
		const confirmed = confirmInvite(invite, 'did:a').invite;
		const players = inviteGameToPlayers(confirmed);
		expect(players).toEqual([
			{ did: 'did:init', handle: 'init' },
			{ did: 'did:a', handle: 'a' },
		]);
	});

	it('operations on non-pending invite return errors', () => {
		const { invite } = createInviteGame('g1', 'did:init', 'init', [], {}, NOW);
		const cancelled = cancelInvite(invite).invite;

		expect(confirmInvite(cancelled, 'did:init').ok).toBe(false);
		expect(addInviteSlot(cancelled, 'did:x', 'x').ok).toBe(false);
		expect(removeInviteSlot(cancelled, 'did:init').ok).toBe(false);
	});

	it('does not mutate original invite', () => {
		const { invite } = createInviteGame(
			'g1',
			'did:init',
			'init',
			[{ did: 'did:a', handle: 'a' }],
			{},
			NOW,
		);
		const original = invite.slots[1].confirmed;
		confirmInvite(invite, 'did:a');
		expect(invite.slots[1].confirmed).toBe(original);
	});
});

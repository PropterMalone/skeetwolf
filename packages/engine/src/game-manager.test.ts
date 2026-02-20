import { alignmentOf } from '@skeetwolf/shared';
import { describe, expect, it, vi } from 'vitest';
import { GameManager } from './game-manager.js';

// biome-ignore lint/suspicious/noExplicitAny: test mocks
function createMockAgent(): any {
	return {
		post: vi.fn().mockResolvedValue({ uri: 'at://mock/post/1' }),
	};
}

// biome-ignore lint/suspicious/noExplicitAny: test mocks
function createMockDb(): any {
	return {
		prepare: vi.fn().mockReturnValue({
			run: vi.fn(),
			get: vi.fn(),
			all: vi.fn().mockReturnValue([]),
		}),
		pragma: vi.fn(),
		exec: vi.fn(),
	};
}

function createMockDm() {
	const groups = new Map<string, string[]>();
	const sent: { did: string; text: string }[] = [];
	const relayed: { groupId: string; text: string }[] = [];
	return {
		sender: {
			async sendDm(did: string, text: string) {
				sent.push({ did, text });
			},
			createRelayGroup(groupId: string, memberDids: string[]) {
				groups.set(groupId, memberDids);
			},
			async sendToRelayGroup(groupId: string, text: string) {
				relayed.push({ groupId, text });
			},
		},
		sent,
		relayed,
		groups,
	};
}

describe('GameManager.findGameForPlayer', () => {
	it('finds a game the player is in', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);

		const _game = await manager.newGame('g1');
		manager.signup('g1', 'did:plc:p0', 'p0.bsky.social');
		manager.signup('g1', 'did:plc:p1', 'p1.bsky.social');
		manager.signup('g1', 'did:plc:p2', 'p2.bsky.social');
		manager.signup('g1', 'did:plc:p3', 'p3.bsky.social');
		manager.signup('g1', 'did:plc:p4', 'p4.bsky.social');
		await manager.startGame('g1');

		const found = manager.findGameForPlayer('did:plc:p2');
		expect(found).not.toBeNull();
		expect(found?.id).toBe('g1');
	});

	it('returns null for unknown player', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');

		expect(manager.findGameForPlayer('did:plc:nobody')).toBeNull();
	});
});

describe('GameManager.resolveHandleInGame', () => {
	it('resolves exact handle match', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		manager.signup('g1', 'did:plc:alice', 'alice.bsky.social');

		expect(manager.resolveHandleInGame('g1', 'alice.bsky.social')).toBe('did:plc:alice');
	});

	it('resolves handle without .bsky.social suffix', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		manager.signup('g1', 'did:plc:alice', 'alice.bsky.social');

		// "alice" should match "alice.bsky.social"
		expect(manager.resolveHandleInGame('g1', 'alice')).toBe('did:plc:alice');
	});

	it('is case-insensitive', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		manager.signup('g1', 'did:plc:alice', 'Alice.bsky.social');

		expect(manager.resolveHandleInGame('g1', 'ALICE.BSKY.SOCIAL')).toBe('did:plc:alice');
	});

	it('returns null for unknown handle', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');

		expect(manager.resolveHandleInGame('g1', 'nobody')).toBeNull();
	});
});

describe('GameManager.nightActionByHandle', () => {
	it('resolves handle and submits action', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		// Find the actual godfather (roles are randomly shuffled)
		const game = manager.findGameForPlayer('did:plc:p0');
		const godfather = game?.players.find((p) => p.role === 'godfather');
		const townPlayer = game?.players.find((p) => alignmentOf(p.role) === 'town');
		expect(godfather).toBeDefined();
		expect(townPlayer).toBeDefined();

		const error = manager.nightActionByHandle('g1', godfather?.did, 'kill', townPlayer?.handle);
		expect(error).toBeNull();
	});

	it('returns error for unknown target handle', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 5; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		const error = manager.nightActionByHandle('g1', 'did:plc:p0', 'kill', 'nobody');
		expect(error).toContain('not found');
	});
});

describe('GameManager.relayMafiaChat', () => {
	it('relays message to mafia group', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		// Find an actual mafia player
		const game = manager.findGameForPlayer('did:plc:p0');
		const mafiaPlayer = game?.players.find((p) => alignmentOf(p.role) === 'mafia');
		expect(mafiaPlayer).toBeDefined();

		dm.relayed.length = 0; // clear relay messages from startGame
		const error = await manager.relayMafiaChat(mafiaPlayer?.did, 'lets get someone');
		expect(error).toBeNull();
		expect(dm.relayed).toHaveLength(1);
		expect(dm.relayed[0]?.text).toContain('lets get someone');
		expect(dm.relayed[0]?.text).toContain(`@${mafiaPlayer?.handle}`);
	});

	it('rejects non-mafia players', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		// Find an actual town player (roles are randomly shuffled)
		const game = manager.findGameForPlayer('did:plc:p0');
		const townPlayer = game?.players.find((p) => alignmentOf(p.role) === 'town');
		expect(townPlayer).toBeDefined();

		const error = await manager.relayMafiaChat(townPlayer?.did, 'hello');
		expect(error).toBe('not a mafia member');
	});

	it('rejects player not in a game', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);

		const error = await manager.relayMafiaChat('did:plc:nobody', 'hello');
		expect(error).toBe('not in an active game');
	});
});

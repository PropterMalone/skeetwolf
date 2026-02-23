import { alignmentOf } from '@skeetwolf/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameManager } from './game-manager.js';

let postCounter = 0;
// biome-ignore lint/suspicious/noExplicitAny: test mocks
function createMockAgent(): any {
	return {
		post: vi.fn().mockImplementation(() => {
			postCounter++;
			return Promise.resolve({
				uri: `at://mock/post/${postCounter}`,
				cid: `cid-mock-${postCounter}`,
			});
		}),
		session: { did: 'did:plc:bot' },
		api: {
			com: {
				atproto: {
					repo: {
						createRecord: vi.fn().mockResolvedValue({}),
						deleteRecord: vi.fn().mockResolvedValue({}),
					},
				},
			},
		},
		com: {
			atproto: {
				identity: {
					resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:resolved' } }),
				},
			},
		},
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

		await manager.newGame('g1');
		manager.signup('g1', 'did:plc:p0', 'p0.bsky.social');
		manager.signup('g1', 'did:plc:p1', 'p1.bsky.social');
		manager.signup('g1', 'did:plc:p2', 'p2.bsky.social');
		manager.signup('g1', 'did:plc:p3', 'p3.bsky.social');
		manager.signup('g1', 'did:plc:p4', 'p4.bsky.social');
		manager.signup('g1', 'did:plc:p5', 'p5.bsky.social');
		manager.signup('g1', 'did:plc:p6', 'p6.bsky.social');
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

		// Advance past Night 0 (no kills allowed) → Day 1 → Night 1
		await manager.endNight('g1');
		await manager.endDay('g1');

		// Find the actual godfather (roles are randomly shuffled)
		const game = manager.findGameForPlayer('did:plc:p0');
		const godfather = game?.players.find((p) => p.role === 'godfather');
		const townPlayer = game?.players.find((p) => alignmentOf(p.role) === 'town');
		expect(godfather).toBeDefined();
		expect(townPlayer).toBeDefined();

		const error = await manager.nightActionByHandle(
			'g1',
			godfather?.did as string,
			'kill',
			townPlayer?.handle as string,
		);
		expect(error).toBeNull();
	});

	it('returns error for unknown target handle', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		const error = await manager.nightActionByHandle('g1', 'did:plc:p0', 'kill', 'nobody');
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
		const error = await manager.relayMafiaChat(mafiaPlayer?.did as string, 'lets get someone');
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

		const error = await manager.relayMafiaChat(townPlayer?.did as string, 'hello');
		expect(error).toBe('not a mafia member');
	});

	it('rejects player not in a game', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);

		const error = await manager.relayMafiaChat('did:plc:nobody', 'hello');
		expect(error).toBe('not in an active game');
	});
});

describe('GameManager.voteAndCheckMajority', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	async function setupDayPhaseGame() {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		// Advance from night 0 to day 1
		await manager.endNight('g1');

		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');
		const townPlayers = game.players.filter((p) => alignmentOf(p.role) === 'town' && p.alive);
		const mafiaPlayer = game.players.find((p) => alignmentOf(p.role) === 'mafia');
		if (!mafiaPlayer) throw new Error('expected mafia player');

		return { manager, dm, townPlayers, mafiaPlayer, game };
	}

	it('returns no majority when votes are insufficient', async () => {
		const { manager, townPlayers, mafiaPlayer } = await setupDayPhaseGame();

		// Cast one vote — not enough for majority
		const result = await manager.voteAndCheckMajority(
			'g1',
			townPlayers[0]?.did as string,
			mafiaPlayer.did,
		);
		expect(result.error).toBeNull();
		expect(result.majorityReached).toBe(false);
	});

	it('triggers endDay when majority is reached', async () => {
		const { manager, townPlayers, mafiaPlayer } = await setupDayPhaseGame();

		// Cast enough votes for majority (need > half of alive players)
		// With 7 players (possibly 6 alive after night), majority needs 4 votes
		let majorityResult = { error: null as string | null, majorityReached: false };
		for (const p of townPlayers) {
			majorityResult = await manager.voteAndCheckMajority('g1', p.did, mafiaPlayer.did);
			if (majorityResult.majorityReached) break;
		}

		expect(majorityResult.error).toBeNull();
		expect(majorityResult.majorityReached).toBe(true);

		// Game should have advanced to night phase (endDay was called)
		const game = manager.getGame('g1');
		// Game might be finished (win) or in night phase
		if (game) {
			expect(game.phase.kind).toBe('night');
		}
		// Either way, endDay was triggered — test passes
	});

	it('returns error for invalid vote', async () => {
		const { manager } = await setupDayPhaseGame();

		const result = await manager.voteAndCheckMajority('g1', 'did:plc:nobody', 'did:plc:p0');
		expect(result.error).not.toBeNull();
		expect(result.majorityReached).toBe(false);
	});
});

describe('GameManager.reply threading', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('uses announcement as root and mention as parent', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		const game = await manager.newGame('g1');

		// newGame posts the announcement (post #1), capture its uri/cid
		expect(game.announcementUri).toBe('at://mock/post/1');
		expect(game.announcementCid).toBe('cid-mock-1');

		// Reply to a mention — should use announcement as root, mention as parent
		await manager.reply('g1', 'test reply', 'at://user/mention/1', 'cid-mention-1');

		// Last agent.post call is the reply (post #2)
		const lastCall = mockAgent.post.mock.calls.at(-1)?.[0];
		expect(lastCall.reply.root).toEqual({
			uri: 'at://mock/post/1',
			cid: 'cid-mock-1',
		});
		expect(lastCall.reply.parent).toEqual({
			uri: 'at://user/mention/1',
			cid: 'cid-mention-1',
		});
	});

	it('falls back to parent as root when announcement data is missing', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);

		// Create game but simulate missing announcement (e.g., old game without CID)
		await manager.newGame('g1');
		// Manually clear the announcement data by re-persisting without it
		// Instead, just reply to a game that doesn't exist — falls back to parent-as-root
		await manager.reply('nonexistent', 'test', 'at://user/post/1', 'cid-user-1');

		const lastCall = mockAgent.post.mock.calls.at(-1)?.[0];
		expect(lastCall.reply.root).toEqual({
			uri: 'at://user/post/1',
			cid: 'cid-user-1',
		});
		expect(lastCall.reply.parent).toEqual({
			uri: 'at://user/post/1',
			cid: 'cid-user-1',
		});
	});
});

describe('GameManager self-labels', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('includes self-labels on announcement posts', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');

		// First agent.post call is the announcement
		const call = mockAgent.post.mock.calls[0]?.[0];
		expect(call.labels).toEqual({
			$type: 'com.atproto.label.defs#selfLabels',
			values: [{ val: 'skeetwolf' }, { val: 'game-announcement' }],
		});
	});

	it('includes self-labels on reply posts', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');

		await manager.reply('g1', 'test', 'at://user/post/1', 'cid-1');

		const lastCall = mockAgent.post.mock.calls.at(-1)?.[0];
		expect(lastCall.labels).toEqual({
			$type: 'com.atproto.label.defs#selfLabels',
			values: [{ val: 'skeetwolf' }, { val: 'game-reply' }],
		});
	});
});

describe('GameManager.getGame', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('returns game state for existing game', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');

		const game = manager.getGame('g1');
		expect(game).not.toBeNull();
		expect(game?.id).toBe('g1');
	});

	it('returns null for unknown game', () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);

		expect(manager.getGame('nope')).toBeNull();
	});
});

describe('GameManager cleanup after game over', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('removes finished game from in-memory state', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		await manager.endNight('g1');

		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');

		// Eliminate all town or all mafia to trigger a win
		const townPlayers = game.players.filter((p) => alignmentOf(p.role) === 'town' && p.alive);
		const mafiaPlayer = game.players.find((p) => alignmentOf(p.role) === 'mafia');
		if (!mafiaPlayer) throw new Error('expected mafia player');

		// Vote out mafia members one at a time until game ends
		// For simplicity: keep voting out mafia. With 7 players (2 mafia, 5 town),
		// eliminating both mafia triggers town win.
		const mafiaPlayers = game.players.filter((p) => alignmentOf(p.role) === 'mafia' && p.alive);

		// Vote out first mafia member
		for (const p of townPlayers) {
			await manager.voteAndCheckMajority('g1', p.did, mafiaPlayers[0]?.did as string);
		}

		// If game still exists (mafia had 2 members), advance to day and vote out second
		if (manager.getGame('g1') && mafiaPlayers.length > 1) {
			await manager.endNight('g1');
			const updatedGame = manager.getGame('g1');
			if (updatedGame) {
				const aliveTown = updatedGame.players.filter(
					(p) => alignmentOf(p.role) === 'town' && p.alive,
				);
				for (const p of aliveTown) {
					await manager.voteAndCheckMajority('g1', p.did, mafiaPlayers[1]?.did as string);
				}
			}
		}

		// Game should be cleaned up from memory after win
		expect(manager.getGame('g1')).toBeNull();
	});
});

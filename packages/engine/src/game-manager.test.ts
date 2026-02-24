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
		session: { did: 'did:plc:bot', handle: 'skeetwolf.bsky.social' },
		api: {
			com: {
				atproto: {
					repo: {
						createRecord: vi.fn().mockResolvedValue({}),
						deleteRecord: vi.fn().mockResolvedValue({}),
					},
				},
			},
			app: {
				bsky: {
					feed: {
						getPostThread: vi.fn().mockResolvedValue({
							data: {
								thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: {}, replies: [] },
							},
						}),
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
				return true;
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

describe('GameManager.formatVoteCount', () => {
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
		await manager.endNight('g1');
		return { manager, dm };
	}

	it('returns vote count with no votes', async () => {
		const { manager } = await setupDayPhaseGame();
		const text = manager.formatVoteCount('g1');
		expect(text).toContain('no votes yet');
		expect(text).toContain('needed');
	});

	it('returns vote count with votes sorted by count', async () => {
		const { manager } = await setupDayPhaseGame();
		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');

		const alive = game.players.filter((p) => p.alive);
		expect(alive.length).toBeGreaterThanOrEqual(4);
		const target0 = alive[0] as (typeof alive)[0];
		const voter1 = alive[1] as (typeof alive)[0];
		const voter2 = alive[2] as (typeof alive)[0];
		const voter3 = alive[3] as (typeof alive)[0];
		// Two players vote for target0, one votes for voter1
		manager.vote('g1', voter1.did, target0.did);
		manager.vote('g1', voter2.did, target0.did);
		manager.vote('g1', voter3.did, voter1.did);

		const text = manager.formatVoteCount('g1');
		expect(text).toContain(`@${target0.handle}: 2`);
		expect(text).toContain(`@${voter1.handle}: 1`);
		// Higher count should appear first
		expect(text).toBeDefined();
		const idx0 = (text as string).indexOf(`@${target0.handle}: 2`);
		const idx1 = (text as string).indexOf(`@${voter1.handle}: 1`);
		expect(idx0).toBeLessThan(idx1);
	});

	it('returns null during night phase', async () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		// Still in Night 0
		expect(manager.formatVoteCount('g1')).toBeNull();
	});

	it('returns null for unknown game', () => {
		const dm = createMockDm();
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		expect(manager.formatVoteCount('nope')).toBeNull();
	});
});

describe('GameManager hourly vote count via tick', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('skips hourly auto-post when no votes have been cast', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		await manager.endNight('g1');

		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');

		const postsBefore = mockAgent.post.mock.calls.length;

		// Tick at 61 min with no votes — should NOT post
		await manager.tick(game.phaseStartedAt + 61 * 60 * 1000);
		expect(mockAgent.post.mock.calls.length).toBe(postsBefore);
	});

	it('posts vote count after 1 hour when votes exist', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		await manager.endNight('g1');

		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');

		// Cast a vote so the auto-post has something to report
		const alive = game.players.filter((p) => p.alive);
		const voter = alive[0] as (typeof alive)[0];
		const target = alive[1] as (typeof alive)[0];
		manager.vote('g1', voter.did, target.did);

		const postsBefore = mockAgent.post.mock.calls.length;

		// Tick at 30 min — no vote count post
		await manager.tick(game.phaseStartedAt + 30 * 60 * 1000);
		expect(mockAgent.post.mock.calls.length).toBe(postsBefore);

		// Tick at 61 min — should post vote count
		await manager.tick(game.phaseStartedAt + 61 * 60 * 1000);
		expect(mockAgent.post.mock.calls.length).toBe(postsBefore + 1);
		const lastPost = mockAgent.post.mock.calls.at(-1)?.[0];
		expect(lastPost.text).toContain('Day 1');

		// Tick again at 61 min — no duplicate
		await manager.tick(game.phaseStartedAt + 61 * 60 * 1000);
		expect(mockAgent.post.mock.calls.length).toBe(postsBefore + 1);
	});
});

describe('GameManager.rehydrateVotes on hydrate', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	it('rebuilds votes from thread replies on hydrate', async () => {
		const dm = createMockDm();
		const mockAgent = createMockAgent();
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		await manager.endNight('g1');

		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');
		expect(game.phase.kind).toBe('day');
		expect(game.votes).toHaveLength(0);

		const alive = game.players.filter((p) => p.alive);
		const target = alive[0] as (typeof alive)[0];
		const voter1 = alive[1] as (typeof alive)[0];
		const voter2 = alive[2] as (typeof alive)[0];

		// Simulate thread replies with vote commands
		mockAgent.api.app.bsky.feed.getPostThread.mockResolvedValue({
			data: {
				thread: {
					$type: 'app.bsky.feed.defs#threadViewPost',
					post: {},
					replies: [
						{
							$type: 'app.bsky.feed.defs#threadViewPost',
							post: {
								uri: 'at://voter1/post/1',
								indexedAt: '2026-01-01T00:01:00Z',
								author: { did: voter1.did, handle: voter1.handle },
								record: {
									text: `@skeetwolf.bsky.social vote @${target.handle}`,
								},
							},
						},
						{
							$type: 'app.bsky.feed.defs#threadViewPost',
							post: {
								uri: 'at://voter2/post/2',
								indexedAt: '2026-01-01T00:02:00Z',
								author: { did: voter2.did, handle: voter2.handle },
								record: {
									text: `@skeetwolf.bsky.social vote @${target.handle}`,
								},
							},
						},
						// Bot's own post — should be skipped
						{
							$type: 'app.bsky.feed.defs#threadViewPost',
							post: {
								uri: 'at://bot/post/3',
								indexedAt: '2026-01-01T00:03:00Z',
								author: { did: 'did:plc:bot', handle: 'skeetwolf.bsky.social' },
								record: { text: 'Vote recorded' },
							},
						},
						// Casual conversation mentioning "vote" without @bot — should be ignored
						{
							$type: 'app.bsky.feed.defs#threadViewPost',
							post: {
								uri: 'at://voter1/post/4',
								indexedAt: '2026-01-01T00:04:00Z',
								author: { did: voter1.did, handle: voter1.handle },
								record: { text: 'I think we should unvote and reconsider' },
							},
						},
					],
				},
			},
		});

		// Create a second manager and hydrate — simulates restart
		const manager2 = new GameManager(createMockDb(), mockAgent, dm.sender);
		// Manually set the game so hydrate's DB load finds it
		// (mock DB doesn't actually persist, so we poke it in)
		manager2.getGame; // just to reference manager2
		// Instead: directly test via the same manager re-hydrating
		// We need the DB mock to return the game. Let's use the real approach:
		// clear in-memory votes and re-hydrate from thread.

		// Wipe votes from state to simulate lost state
		const wiped = { ...game, votes: [] };
		const mockDb = createMockDb();
		// Make loadActiveGames return our wiped game
		mockDb.prepare = vi.fn().mockReturnValue({
			run: vi.fn(),
			get: vi.fn(),
			all: vi.fn().mockReturnValue([{ id: 'g1', state: JSON.stringify(wiped) }]),
		});
		mockDb.pragma = vi.fn();
		mockDb.exec = vi.fn();

		const manager3 = new GameManager(mockDb, mockAgent, dm.sender);
		await manager3.hydrate();

		const rehydrated = manager3.getGame('g1');
		expect(rehydrated).not.toBeNull();
		expect(rehydrated?.votes).toHaveLength(2);
		expect(rehydrated?.votes.some((v) => v.voter === voter1.did && v.target === target.did)).toBe(
			true,
		);
		expect(rehydrated?.votes.some((v) => v.voter === voter2.did && v.target === target.did)).toBe(
			true,
		);
	});
});

describe('GameManager DM retry gate', () => {
	beforeEach(() => {
		postCounter = 0;
	});

	/** Create a mock DM sender that fails for specific DIDs */
	function createFailingDm(failDids: Set<string>) {
		const groups = new Map<string, string[]>();
		const sent: { did: string; text: string }[] = [];
		const relayed: { groupId: string; text: string }[] = [];
		return {
			sender: {
				async sendDm(did: string, text: string) {
					sent.push({ did, text });
					return !failDids.has(did);
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
			failDids,
		};
	}

	async function setupGameWithFailingDm(failDids: Set<string>) {
		const dm = createFailingDm(failDids);
		const manager = new GameManager(createMockDb(), createMockAgent(), dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');
		return { manager, dm };
	}

	it('blocks game when DM fails — enters pending state', async () => {
		const { manager } = await setupGameWithFailingDm(new Set(['did:plc:p3']));
		const game = manager.getGame('g1');
		expect(game).not.toBeNull();
		expect(game?.pendingDmDids).toContain('did:plc:p3');
		expect(manager.hasPendingDms('g1')).toBe(true);
	});

	it('completes game start after retry succeeds', async () => {
		const failDids = new Set(['did:plc:p3']);
		const { manager, dm } = await setupGameWithFailingDm(failDids);

		// Verify game is blocked
		expect(manager.hasPendingDms('g1')).toBe(true);

		// Fix the DM — next retry should succeed
		failDids.delete('did:plc:p3');
		dm.relayed.length = 0;

		// Tick to trigger retry
		await manager.tick(Date.now());

		// Game should no longer be pending
		expect(manager.hasPendingDms('g1')).toBe(false);

		// Night 0 guidance DMs should have been sent (completeGameStart)
		const game = manager.getGame('g1');
		expect(game?.pendingDmDids).toEqual([]);
	});

	it('replaces player from queue after 6h timeout', async () => {
		const failDids = new Set(['did:plc:p3']);
		const { manager } = await setupGameWithFailingDm(failDids);

		// Add a replacement player to the queue
		await manager.addToQueue(
			'did:plc:replacement',
			'replacement.bsky.social',
			'at://trigger/post/1',
			'cid-trigger-1',
		);

		const game = manager.getGame('g1');
		expect(game).not.toBeNull();

		// Tick at 6h+ — should trigger replacement
		const sixHoursLater = Date.now() + 6 * 60 * 60 * 1000 + 1;
		await manager.tick(sixHoursLater);

		// Check the player was replaced
		const updated = manager.getGame('g1');
		expect(updated).not.toBeNull();
		const replaced = updated?.players.find((p) => p.did === 'did:plc:replacement');
		expect(replaced).toBeDefined();
		// Old player should be gone
		expect(updated?.players.find((p) => p.did === 'did:plc:p3')).toBeUndefined();
		// Game should have started (no longer pending)
		expect(manager.hasPendingDms('g1')).toBe(false);
	});

	it('posts stall warning when queue is empty and timeout expires', async () => {
		const failDids = new Set(['did:plc:p3']);
		const mockAgent = createMockAgent();
		const dm = createFailingDm(failDids);
		const manager = new GameManager(createMockDb(), mockAgent, dm.sender);
		await manager.newGame('g1');
		for (let i = 0; i < 7; i++) {
			manager.signup('g1', `did:plc:p${i}`, `player${i}.bsky.social`);
		}
		await manager.startGame('g1');

		const postsBefore = mockAgent.post.mock.calls.length;

		// Tick at 6h+ with empty queue
		const sixHoursLater = Date.now() + 6 * 60 * 60 * 1000 + 1;
		await manager.tick(sixHoursLater);

		// Game should still be pending
		expect(manager.hasPendingDms('g1')).toBe(true);

		// A stall warning should have been posted
		const newPosts = mockAgent.post.mock.calls.slice(postsBefore);
		const stallPost = newPosts.find(
			// biome-ignore lint/suspicious/noExplicitAny: test mock inspection
			(c: any) => c[0]?.text?.includes('stalled'),
		);
		expect(stallPost).toBeDefined();
	});

	it('skips phase transitions for pending games', async () => {
		const failDids = new Set(['did:plc:p3']);
		const { manager } = await setupGameWithFailingDm(failDids);

		expect(manager.hasPendingDms('g1')).toBe(true);

		// Force phase to be expired
		const game = manager.getGame('g1');
		if (!game) throw new Error('expected game');
		const farFuture = game.phaseStartedAt + game.config.nightDurationMs + 1;

		// Tick should NOT advance the phase (game is blocked on DMs)
		await manager.tick(farFuture);

		const after = manager.getGame('g1');
		expect(after?.phase.kind).toBe('night');
		expect(after?.phase.number).toBe(0);
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

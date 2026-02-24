import { describe, expect, it } from 'vitest';
import { parseDm, parseMention } from './command-parser.js';

describe('parseMention', () => {
	const bot = 'skeetwolf.bsky.social';

	it('parses "new game"', () => {
		expect(parseMention('@skeetwolf.bsky.social new game', bot)).toEqual({ kind: 'new_game' });
	});

	it('parses "new game" case-insensitively', () => {
		expect(parseMention('New Game please', bot)).toEqual({ kind: 'new_game' });
	});

	it('parses "join #id"', () => {
		expect(parseMention('@skeetwolf.bsky.social join #abc123', bot)).toEqual({
			kind: 'join',
			gameId: 'abc123',
		});
	});

	it('parses "join id" without hash', () => {
		expect(parseMention('join abc123', bot)).toEqual({ kind: 'join', gameId: 'abc123' });
	});

	it('parses "start #id"', () => {
		expect(parseMention('start #abc123', bot)).toEqual({ kind: 'start', gameId: 'abc123' });
	});

	it('parses "vote @handle"', () => {
		expect(parseMention('vote @alice.bsky.social #game1', bot)).toEqual({
			kind: 'vote',
			gameId: 'game1',
			targetHandle: 'alice.bsky.social',
		});
	});

	it('parses "vote @handle" without game id', () => {
		const result = parseMention('vote @alice.bsky.social', bot);
		expect(result).toEqual({ kind: 'vote', gameId: '', targetHandle: 'alice.bsky.social' });
	});

	it('parses "unvote"', () => {
		expect(parseMention('unvote #game1', bot)).toEqual({ kind: 'unvote', gameId: 'game1' });
	});

	it('parses "unvote" without game id', () => {
		expect(parseMention('unvote', bot)).toEqual({ kind: 'unvote', gameId: '' });
	});

	it('parses "new game @a @b @c" as invite game', () => {
		expect(parseMention('@skeetwolf.bsky.social new game @alice @bob @charlie', bot)).toEqual({
			kind: 'new_invite_game',
			handles: ['alice', 'bob', 'charlie'],
		});
	});

	it('parses "new game @a.bsky.social @b.bsky.social" with full handles', () => {
		const result = parseMention('new game @alice.bsky.social @bob.bsky.social', bot);
		expect(result).toEqual({
			kind: 'new_invite_game',
			handles: ['alice.bsky.social', 'bob.bsky.social'],
		});
	});

	it('parses "queue"', () => {
		expect(parseMention('@skeetwolf.bsky.social queue', bot)).toEqual({ kind: 'queue' });
	});

	it('parses "lfg" as queue', () => {
		expect(parseMention('lfg', bot)).toEqual({ kind: 'queue' });
	});

	it('parses "queue?" as queue_status', () => {
		expect(parseMention('queue?', bot)).toEqual({ kind: 'queue_status' });
	});

	it('parses "queue status" as queue_status', () => {
		expect(parseMention('queue status', bot)).toEqual({ kind: 'queue_status' });
	});

	it('parses "who\'s in the queue" as queue_status', () => {
		expect(parseMention("who's in the queue", bot)).toEqual({ kind: 'queue_status' });
	});

	it('parses "unqueue"', () => {
		expect(parseMention('unqueue', bot)).toEqual({ kind: 'unqueue' });
	});

	it('parses "leave queue"', () => {
		expect(parseMention('leave queue', bot)).toEqual({ kind: 'unqueue' });
	});

	it('parses "confirm #id"', () => {
		expect(parseMention('confirm #abc123', bot)).toEqual({
			kind: 'confirm',
			gameId: 'abc123',
		});
	});

	it('parses "invite #id @handle"', () => {
		expect(parseMention('invite #abc123 @alice.bsky.social', bot)).toEqual({
			kind: 'invite',
			gameId: 'abc123',
			handle: 'alice.bsky.social',
		});
	});

	it('parses "cancel #id"', () => {
		expect(parseMention('cancel #abc123', bot)).toEqual({
			kind: 'cancel',
			gameId: 'abc123',
		});
	});

	it('parses "vote count" as vote_count', () => {
		expect(parseMention('vote count', bot)).toEqual({ kind: 'vote_count', gameId: '' });
	});

	it('parses "vote count #game1" with game id', () => {
		expect(parseMention('vote count #game1', bot)).toEqual({
			kind: 'vote_count',
			gameId: 'game1',
		});
	});

	it('parses "votes" as vote_count', () => {
		expect(parseMention('votes', bot)).toEqual({ kind: 'vote_count', gameId: '' });
	});

	it('parses "votes?" as vote_count', () => {
		expect(parseMention('votes?', bot)).toEqual({ kind: 'vote_count', gameId: '' });
	});

	it('parses "tally" as vote_count', () => {
		expect(parseMention('tally #game1', bot)).toEqual({
			kind: 'vote_count',
			gameId: 'game1',
		});
	});

	it('returns unknown for unrecognized text', () => {
		const result = parseMention('hello world', bot);
		expect(result.kind).toBe('unknown');
	});

	it('strips bot handle before parsing', () => {
		expect(parseMention('@skeetwolf.bsky.social join #x', bot)).toEqual({
			kind: 'join',
			gameId: 'x',
		});
	});
});

describe('parseDm', () => {
	it('parses "kill @handle"', () => {
		expect(parseDm('kill @alice.bsky.social')).toEqual({
			kind: 'kill',
			targetHandle: 'alice.bsky.social',
		});
	});

	it('requires @ prefix — "kill handle" without @ is mafia chat', () => {
		expect(parseDm('kill alice.bsky.social')).toEqual({
			kind: 'mafia_chat',
			text: 'kill alice.bsky.social',
		});
	});

	it('parses "investigate @handle"', () => {
		expect(parseDm('investigate @bob.bsky.social')).toEqual({
			kind: 'investigate',
			targetHandle: 'bob.bsky.social',
		});
	});

	it('parses "check @handle" as investigate', () => {
		expect(parseDm('check @bob.bsky.social')).toEqual({
			kind: 'investigate',
			targetHandle: 'bob.bsky.social',
		});
	});

	it('parses "protect @handle"', () => {
		expect(parseDm('protect @charlie.bsky.social')).toEqual({
			kind: 'protect',
			targetHandle: 'charlie.bsky.social',
		});
	});

	it('parses "save @handle" as protect', () => {
		expect(parseDm('save @charlie.bsky.social')).toEqual({
			kind: 'protect',
			targetHandle: 'charlie.bsky.social',
		});
	});

	it('treats unrecognized text as mafia chat', () => {
		expect(parseDm('I think we should target the doctor tonight')).toEqual({
			kind: 'mafia_chat',
			text: 'I think we should target the doctor tonight',
		});
	});

	it('is case insensitive for commands', () => {
		expect(parseDm('KILL @alice.bsky.social')).toEqual({
			kind: 'kill',
			targetHandle: 'alice.bsky.social',
		});
	});

	// Natural language false-positive regression tests
	it('treats "kill anyone" as mafia chat (no @ prefix)', () => {
		expect(parseDm("we don't get to kill anyone")).toEqual({
			kind: 'mafia_chat',
			text: "we don't get to kill anyone",
		});
	});

	it('treats "check this out" as mafia chat', () => {
		expect(parseDm('check this out')).toEqual({ kind: 'mafia_chat', text: 'check this out' });
	});

	it('treats "save the date" as mafia chat', () => {
		expect(parseDm('save the date')).toEqual({ kind: 'mafia_chat', text: 'save the date' });
	});

	it('treats "check our options" as mafia chat', () => {
		expect(parseDm('check our options')).toEqual({
			kind: 'mafia_chat',
			text: 'check our options',
		});
	});

	it('treats "protect ourselves" as mafia chat', () => {
		expect(parseDm('we need to protect ourselves')).toEqual({
			kind: 'mafia_chat',
			text: 'we need to protect ourselves',
		});
	});

	it('treats "investigate further" as mafia chat', () => {
		expect(parseDm('lets investigate further')).toEqual({
			kind: 'mafia_chat',
			text: 'lets investigate further',
		});
	});

	it('treats "kill time" as mafia chat', () => {
		expect(parseDm('kill time')).toEqual({ kind: 'mafia_chat', text: 'kill time' });
	});
});

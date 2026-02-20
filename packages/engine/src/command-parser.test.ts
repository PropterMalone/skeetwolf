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

	it('parses "kill handle" without @', () => {
		expect(parseDm('kill alice.bsky.social')).toEqual({
			kind: 'kill',
			targetHandle: 'alice.bsky.social',
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
});

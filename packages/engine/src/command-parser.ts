/**
 * Parse player commands from mention text and DM text.
 * All parsing is pure — no I/O.
 */

export type MentionCommand =
	| { kind: 'new_game' }
	| { kind: 'join'; gameId: string }
	| { kind: 'start'; gameId: string }
	| { kind: 'vote'; gameId: string; targetHandle: string }
	| { kind: 'unvote'; gameId: string }
	| { kind: 'unknown'; text: string };

export type DmCommand =
	| { kind: 'kill'; targetHandle: string }
	| { kind: 'investigate'; targetHandle: string }
	| { kind: 'protect'; targetHandle: string }
	| { kind: 'mafia_chat'; text: string }
	| { kind: 'unknown'; text: string };

/**
 * Parse a public mention into a command.
 *
 * Recognized patterns:
 *   "new game"
 *   "join #<id>" or "join <id>"
 *   "start #<id>" or "start <id>"
 *   "vote @<handle>" (with optional #<id> game context)
 *   "unvote" (with optional #<id> game context)
 *
 * The bot handle is stripped before parsing if present.
 */
export function parseMention(rawText: string, botHandle?: string): MentionCommand {
	let text = rawText;
	// Strip the bot's @handle if present
	if (botHandle) {
		text = text.replace(new RegExp(`@${escapeRegex(botHandle)}\\s*`, 'gi'), '');
	}
	text = text.trim();
	const lower = text.toLowerCase();

	if (lower.includes('new game')) {
		return { kind: 'new_game' };
	}

	const joinMatch = lower.match(/join\s+#?(\w+)/);
	if (joinMatch?.[1]) {
		return { kind: 'join', gameId: joinMatch[1] };
	}

	const startMatch = lower.match(/start\s+#?(\w+)/);
	if (startMatch?.[1]) {
		return { kind: 'start', gameId: startMatch[1] };
	}

	// Vote: "vote @handle" with optional "#gameId" anywhere
	const voteMatch = text.match(/vote\s+@([\w.:-]+)/i);
	if (voteMatch?.[1]) {
		const gameId = extractGameId(lower);
		return { kind: 'vote', gameId: gameId ?? '', targetHandle: voteMatch[1] };
	}

	// Unvote: just "unvote" with optional "#gameId"
	if (lower.includes('unvote')) {
		const gameId = extractGameId(lower);
		return { kind: 'unvote', gameId: gameId ?? '' };
	}

	return { kind: 'unknown', text };
}

/**
 * Parse a DM from a player into a command.
 *
 * Recognized patterns:
 *   "kill @<handle>"
 *   "investigate @<handle>" or "check @<handle>"
 *   "protect @<handle>" or "save @<handle>"
 *   anything else → mafia chat relay
 */
export function parseDm(rawText: string): DmCommand {
	const text = rawText.trim();

	const killMatch = text.match(/kill\s+@?([\w.:-]+)/i);
	if (killMatch?.[1]) {
		return { kind: 'kill', targetHandle: killMatch[1] };
	}

	const investigateMatch = text.match(/(?:investigate|check)\s+@?([\w.:-]+)/i);
	if (investigateMatch?.[1]) {
		return { kind: 'investigate', targetHandle: investigateMatch[1] };
	}

	const protectMatch = text.match(/(?:protect|save)\s+@?([\w.:-]+)/i);
	if (protectMatch?.[1]) {
		return { kind: 'protect', targetHandle: protectMatch[1] };
	}

	// If it doesn't match a command, treat as mafia chat
	return { kind: 'mafia_chat', text };
}

/** Extract a #gameId from text */
function extractGameId(lower: string): string | undefined {
	const match = lower.match(/#(\w+)/);
	return match?.[1];
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

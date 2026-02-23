/**
 * Parse player commands from mention text and DM text.
 * All parsing is pure — no I/O.
 */

export type MentionCommand =
	| { kind: 'new_game' }
	| { kind: 'new_invite_game'; handles: string[] }
	| { kind: 'join'; gameId: string }
	| { kind: 'start'; gameId: string }
	| { kind: 'vote'; gameId: string; targetHandle: string }
	| { kind: 'unvote'; gameId: string }
	| { kind: 'queue' }
	| { kind: 'unqueue' }
	| { kind: 'queue_status' }
	| { kind: 'confirm'; gameId: string }
	| { kind: 'invite'; gameId: string; handle: string }
	| { kind: 'cancel'; gameId: string }
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

	// "new game @a @b @c" — invite game (must check before plain "new game")
	if (lower.includes('new game')) {
		const handles = extractHandles(text);
		if (handles.length > 0) {
			return { kind: 'new_invite_game', handles };
		}
		return { kind: 'new_game' };
	}

	// Queue commands — status checks before join/leave
	if (
		/queue\s*\?|queue\s+status|who.s\s+(in\s+)?(the\s+)?queue/i.test(lower)
	) {
		return { kind: 'queue_status' };
	}
	if (lower.includes('leave queue') || lower.includes('unqueue')) {
		return { kind: 'unqueue' };
	}
	if (lower.includes('queue') || lower.includes('lfg')) {
		return { kind: 'queue' };
	}

	// Confirm invite: "confirm #id"
	const confirmMatch = lower.match(/confirm\s+#?(\w+)/);
	if (confirmMatch?.[1]) {
		return { kind: 'confirm', gameId: confirmMatch[1] };
	}

	// Invite replacement: "invite #id @handle"
	const inviteMatch = text.match(/invite\s+#?(\w+)\s+@([\w.:-]+)/i);
	if (inviteMatch?.[1] && inviteMatch[2]) {
		return { kind: 'invite', gameId: inviteMatch[1], handle: inviteMatch[2] };
	}

	// Cancel invite: "cancel #id"
	const cancelMatch = lower.match(/cancel\s+#?(\w+)/);
	if (cancelMatch?.[1]) {
		return { kind: 'cancel', gameId: cancelMatch[1] };
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

/** Extract all @handles from text (excluding the bot handle if already stripped) */
function extractHandles(text: string): string[] {
	const matches = text.matchAll(/@([\w.:-]+)/g);
	return [...matches].map((m) => m[1]).filter((h): h is string => h !== undefined);
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Flavor text for game events.
 * Each event type has variants — one is picked at random per occurrence.
 * Kill/elimination events are keyed by the victim's role for role-specific flavor.
 * Placeholders: {victim}, {role}, {alignment}, {player}, {players}, {winners}, {roles}, {votes}, {result}, {target}, {teammates}
 * Eventually this becomes a standard format so communities can submit their own packs.
 */

import type { Role } from './types.js';

export interface FlavorPack {
	name: string;

	/** Night kill — dawn announcement. Keyed by victim's role. {victim} */
	nightKill: Record<Role, string[]>;

	/** Dawn — no one died */
	dawnPeaceful: string[];

	/** Day elimination — majority vote. Keyed by victim's role. {victim}, {votes} */
	dayElimination: Record<Role, string[]>;

	/** Day end — no majority reached */
	dayNoMajority: string[];

	/** Game over — town wins. {winners}, {roles} */
	townWins: string[];

	/** Game over — mafia wins. {winners}, {roles} */
	mafiaWins: string[];

	/** Role assignment DMs. Keyed by role. {teammates} for mafia roles */
	roleAssignment: Record<Role, string[]>;

	/** Cop investigation result. {target}, {result} */
	copResult: string[];

	/** Night start DM */
	nightStart: string[];

	/** Night 0 guidance — role-specific. Sent after role DMs. */
	night0Guidance: Record<Role, string[]>;

	/** Game start announcement */
	gameStart: string[];
}

export const DEFAULT_FLAVOR: FlavorPack = {
	name: 'Bluesky Standard',

	nightKill: {
		villager: [
			'The timeline refreshes, but @{victim} will never post again. They were an innocent villager.',
			"@{victim}'s account has gone dark. Just a regular poster who got caught in the crossfire.",
			"A final notification for @{victim} — but they'll never read it. They were a villager, taken too soon.",
			"@{victim} has been ratio'd into oblivion. The town lost one of its own.",
		],
		cop: [
			"@{victim}'s investigation notes are scattered across the timeline. The town's detective is gone.",
			'The wolves got to @{victim} — the cop. Whatever they knew dies with them.',
			"@{victim} won't be filing any more reports. The town just lost its best investigator.",
			'Trust & Safety has lost its lead analyst. @{victim} the cop is gone.',
		],
		doctor: [
			"@{victim} couldn't save themselves. The town's doctor has flatlined.",
			"The healer becomes the patient. @{victim} the doctor is gone, and no one's left to run the backup servers.",
			"@{victim}'s protective powers are offline permanently. The doctor is out.",
			'The wolves took out @{victim} — the one person who could have saved the others.',
		],
		godfather: [
			"@{victim} is gone — and the town just killed a wolf in sheep's clothing. The godfather has fallen.",
			"The wolves' leader @{victim} has been silenced. But can the pack survive without their boss?",
			"@{victim} the godfather won't be running any more operations from the shadows.",
			"The head wolf @{victim} is down. The town didn't even know what they had.",
		],
		mafioso: [
			"@{victim} is gone. A wolf in poster's clothing — exposed at last.",
			'The wolves are one fewer. @{victim} the mafioso has been silenced.',
			"@{victim}'s cover is blown permanently. One less wolf on the timeline.",
			"A wolf falls in the night. @{victim} the mafioso won't be scheming anymore.",
		],
	},

	dawnPeaceful: [
		'Dawn breaks over the timeline. Everyone made it through the night.',
		'A quiet night on the feed. All accounts are still active.',
		"The morning's first posts roll in. No one was silenced overnight.",
		"Notifications light up — everyone's still here.",
		'Another sunrise, another scroll. The timeline is intact.',
	],

	dayElimination: {
		villager: [
			'The community has spoken. @{victim} is blocked by consensus — but they were just a villager. An innocent poster, gone.',
			'@{victim}\'s final post: "wait, I can explain—" Too late. They were a villager. The town got it wrong.',
			'The town smashes the block button on @{victim}. A villager. Oops.',
			'@{victim} has been voted off the timeline. They were a villager. The wolves are still out there.',
		],
		cop: [
			'@{victim} is eliminated — and the town just destroyed its own detective. The cop is gone.',
			'The votes pile up against @{victim}. Tragic — they were the cop, trying to protect everyone.',
			'@{victim} gets the block. They were the cop. The wolves are celebrating tonight.',
			'The town votes out its own investigator. @{victim} the cop is gone. Who watches the watchmen now?',
		],
		doctor: [
			'@{victim} is voted out. They were the doctor — the town just eliminated its own lifeline.',
			'The consensus turns on @{victim}. They were the doctor. Now no one can be saved.',
			'@{victim} gets blocked. They were the doctor, and the town just made a critical mistake.',
			"The town eliminates @{victim} — their own healer. The wolves couldn't have planned it better.",
		],
		godfather: [
			"@{victim} is dragged into the light. The godfather — the wolves' untouchable leader — has been found out at last.",
			"The town nails @{victim}. The godfather. Even that innocent investigation result couldn't save them.",
			'@{victim} goes down. They were the godfather. The biggest wolf falls to the vote.',
			'The community roots out @{victim} — the godfather. A major win for town.',
		],
		mafioso: [
			'@{victim} is blocked by popular demand. A mafioso — the town found a wolf!',
			'The votes stack up against @{victim}. A mafioso is exposed and eliminated.',
			'@{victim} is voted off the timeline. They were a mafioso. One wolf down.',
			"The town gets it right. @{victim} was a mafioso, and they're out.",
		],
	},

	dayNoMajority: [
		'The discourse goes in circles. No consensus is reached, and the sun sets on an indecisive town.',
		'Hot takes fly, but nobody commits. The day ends without action.',
		'Too many quote-tweets, not enough agreement. No one is eliminated.',
		'The town doomscrolls past sunset without reaching a decision.',
		'Everyone subtweeted, nobody voted. The day ends in stalemate.',
	],

	townWins: [
		"The last wolf's alt account is exposed. The timeline is safe again.\n\n{winners}\n\n{roles}",
		'The wolves have been defederated. Peace returns to the feed.\n\n{winners}\n\n{roles}',
		'Trust & Safety prevails. The town has rooted out the wolves.\n\n{winners}\n\n{roles}',
		'The bad actors are banned. The community can post in peace.\n\n{winners}\n\n{roles}',
	],

	mafiaWins: [
		"The wolves own the timeline now. There aren't enough voices left to stop them.\n\n{winners}\n\n{roles}",
		'The feed belongs to the wolves. The remaining townsfolk can only watch.\n\n{winners}\n\n{roles}',
		'The algorithm favors the wolves. The town has been overrun.\n\n{winners}\n\n{roles}',
		'The wolves control the discourse. Democracy has left the chat.\n\n{winners}\n\n{roles}',
	],

	roleAssignment: {
		villager: [
			"You're a VILLAGER. Just a regular poster trying to survive the discourse. Find the wolves before they silence you.",
			"You're a VILLAGER. No special powers — just your wits and your posting instincts. Spot the wolves, vote them out.",
			"You're a VILLAGER. An ordinary member of the timeline. Pay attention to who's sus and vote accordingly.",
		],
		cop: [
			"You're the COP. Each night, DM me a handle to investigate — I'll tell you if they're town or mafia. Use this intel wisely.",
			"You're the COP. Think of yourself as Trust & Safety. Each night, DM me someone to investigate. I'll report back.",
			"You're the COP. You can see through the alts. Each night, DM me a name and I'll tell you what side they're on.",
		],
		doctor: [
			"You're the DOCTOR. Each night, DM me a handle to protect. If the wolves target them, they survive. You can't protect yourself.",
			"You're the DOCTOR. The timeline's guardian angel. Each night, DM me who to shield from the wolves.",
			"You're the DOCTOR. You run the backup servers. Each night, DM me someone to protect from deletion.",
		],
		godfather: [
			"You're the GODFATHER. Leader of the wolves. Each night, DM me who to eliminate. You appear innocent to investigations.",
			"You're the GODFATHER. You run the wolf pack. DM me your kill target each night. The cop can't touch you — you read as town.",
			"You're the GODFATHER. Top wolf. Pick your targets carefully and lead the pack. Investigations can't expose you.",
		],
		mafioso: [
			"You're a MAFIOSO. One of the wolves. Coordinate with your team via DM — I'll relay messages. If the godfather goes down, you take the lead.",
			"You're a MAFIOSO. A wolf in poster's clothing. Work with your pack through the bot relay. Stay hidden, vote strategically.",
			"You're a MAFIOSO. Part of the wolf pack. Keep your cover, coordinate through DMs, and help your team dominate the timeline.",
		],
	},

	copResult: [
		'Your investigation is complete: @{target} reads as {result}.',
		'Intel report on @{target}: {result}.',
		"You checked @{target}'s account. The result: {result}.",
	],

	nightStart: [
		'Night falls on the timeline. Power roles: send your actions now.',
		'The feed goes quiet. Somewhere in the dark, the wolves are planning. Power roles: DM your actions.',
		'Notifications go silent. The night belongs to the wolves — and those brave enough to act in the dark.',
	],

	night0Guidance: {
		villager: [
			"It's Night 0 — nothing for you to do yet. The power roles are making their moves. Day 1 starts once they're done.",
			'Night 0 is just setup. Sit tight while the power roles submit their actions. Day 1 is coming.',
			"Hang tight — Night 0 is for power roles only. You'll get your chance to post and vote when day breaks.",
		],
		cop: [
			"It's Night 0 — DM me a handle to investigate. Day 1 starts once all night actions are in.",
			'Night 0: time to do some digging. DM me someone to investigate. The sooner you act, the sooner day begins.',
			"The game starts in the dark. DM me who you want to investigate — once you do, we're one step closer to Day 1.",
		],
		doctor: [
			"It's Night 0 — no kill tonight, so your protection isn't needed yet. Sit tight until Day 1.",
			"Night 0: the wolves can't kill yet, so there's no one to save. Relax — Day 1 is coming soon.",
			'Nothing to do tonight, doc. No kill on Night 0 means no one needs saving. Day 1 starts once the other roles finish up.',
		],
		godfather: [
			"It's Night 0 — no kill tonight. Use this time to coordinate with your team. Day 1 starts once all night actions are in.",
			'Night 0: no kill yet, but the relay is open. Talk strategy with your team. Day 1 is coming.',
			"The wolves can't hunt on Night 0. Get to know your team through the relay. The real game starts at dawn.",
		],
		mafioso: [
			"It's Night 0 — no kill tonight. Use the relay to coordinate with your team. Day 1 starts soon.",
			'Night 0: no hunting yet. Chat with your teammates through the bot relay. Day 1 is on the way.',
			"Can't make a move tonight — Night 0 is just for setup. Use the relay to plan with your pack.",
		],
	},

	gameStart: [
		'The game is afoot. Check your DMs for your role.',
		'Roles have been dealt. Check your DMs — and trust no one.',
		'The wolves walk among you. Check your DMs to learn who you are.',
	],
};

/** Pick a random variant from an array */
export function pickFlavor(variants: string[]): string {
	return variants[Math.floor(Math.random() * variants.length)] ?? '';
}

/** Fill placeholders in a flavor string */
export function fillFlavor(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replaceAll(`{${key}}`, value);
	}
	return result;
}

/** Pick and fill a flavor string in one call */
export function flavor(variants: string[], vars: Record<string, string> = {}): string {
	return fillFlavor(pickFlavor(variants), vars);
}

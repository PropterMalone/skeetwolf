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

export const NOIR_FLAVOR: FlavorPack = {
	name: 'Noir Detective',

	nightKill: {
		villager: [
			'When the fog lifted, @{victim} was face-down in the gutter. Just an honest citizen who knew too little and trusted too much.',
			"The rain washed the chalk outline away by noon, but @{victim} — a regular citizen — wasn't coming back.",
			'@{victim} took their last breath in a back alley. No enemies, no debts — just a citizen in the wrong borough.',
			"They found @{victim} slumped in a phone booth, receiver still in hand. An honest citizen who'd never make that call.",
		],
		cop: [
			"@{victim}'s office was tossed — files scattered, bourbon still warm. The private eye is out of the picture.",
			"The city's best gumshoe @{victim} got too close to the truth. Someone made sure that case stays cold.",
			'@{victim} the private eye should have watched their own back. The case dies with them.',
			'They got to the detective. @{victim} was found at their desk, investigation notes missing.',
		],
		doctor: [
			"@{victim} the sawbones won't be patching anyone up anymore. Even a steady hand can't stop a bullet.",
			'The doc is dead. @{victim} kept this city breathing, and the syndicate took that away.',
			"@{victim}'s medical bag was found by the docks. The sawbones made a house call they didn't come back from.",
			'No more midnight stitchwork. @{victim} the doctor has been permanently retired by the syndicate.',
		],
		godfather: [
			"@{victim}'s empire crumbles. The boss of the syndicate sleeps with the fishes tonight.",
			"They found @{victim} in the back of their own club. The godfather's luck finally ran dry.",
			"The big boss @{victim} is gone. Even the head of the syndicate can't dodge every bullet.",
			"@{victim}'s reign over the underworld is finished. The godfather has been rubbed out.",
		],
		mafioso: [
			"@{victim}'s cheap suit and cheaper alibi couldn't save them. One less syndicate goon on the streets.",
			'A two-bit hood goes down. @{victim} the enforcer has been silenced — permanently.',
			"@{victim} won't be shaking anyone down anymore. Another syndicate rat flushed out.",
			'The syndicate is one soldier lighter. @{victim} the mafioso has been dealt with.',
		],
	},

	dawnPeaceful: [
		'Morning light creeps through the venetian blinds. Against all odds, everyone survived the night.',
		'The city wakes. No bodies, no crime scenes, no headlines. A rare quiet night.',
		'Dawn breaks over rain-slicked streets. Every soul in this rotten borough is still breathing.',
		"The morning paper's got nothing. No murders, no missing persons. The city holds its breath.",
		'Sunrise hits the fire escapes. Everyone made it through — but the night will come again.',
	],

	dayElimination: {
		villager: [
			'The borough points its collective finger at @{victim}. An honest citizen — railroaded by paranoia.',
			"@{victim} pleads their innocence to the last. Nobody listens. They were just a citizen, and now they're gone.",
			'The mob turns on @{victim}. Wrong call — they were clean. Just a citizen caught in the crossfire.',
			'@{victim} gets the boot. A regular citizen. This city eats its own.',
		],
		cop: [
			'@{victim} is run out of town. They were the private eye — the only one asking the right questions.',
			'The borough just threw out its best detective. @{victim} the PI is gone, and the syndicate is popping champagne.',
			'@{victim} tried to show them the evidence. They showed them the door instead. The private eye is finished.',
			"The city silences its own investigator. @{victim} the cop won't be solving this case.",
		],
		doctor: [
			'@{victim} is cast out. They were the sawbones — and this city just lost its last lifeline.',
			"The borough turns on @{victim} the doctor. Now when the syndicate strikes, there's nobody to stitch the wounds.",
			'@{victim} gets fingered by the mob. Wrong target — that was the doc. The syndicate is grinning.',
			"The sawbones @{victim} is out. The syndicate couldn't have done it better themselves.",
		],
		godfather: [
			"@{victim} goes down smooth — too smooth. They were the godfather, and this city's finally free of the syndicate's boss.",
			"The borough nails @{victim}. The big boss. Even that clean investigation record couldn't save the godfather.",
			"@{victim} is finished. The godfather's reign of terror ends not with a bullet, but a vote.",
			'They got the head of the snake. @{victim} the godfather is out, and the syndicate trembles.',
		],
		mafioso: [
			'@{victim} tries to talk their way out. No dice. A syndicate enforcer, exposed and expelled.',
			"The borough catches a break. @{victim} was muscle for the syndicate — and now they're on the curb.",
			'@{victim} the mafioso goes down. One less goon. The city breathes a little easier.',
			'The mob finds a real crook for once. @{victim} the mafioso is out.',
		],
	},

	dayNoMajority: [
		'Everyone points fingers, but nobody commits. The sun sets on a divided borough.',
		'Accusations fly like cigarette smoke, but nothing sticks. The day ends without a verdict.',
		'Too many suspects, not enough guts. The city lets another day slip through its fingers.',
		'The bourbon flows, the arguments circle, and nobody gets pinched. Another wasted day.',
		"The whole borough talks a big game, but when it's time to point the finger, they all clam up.",
	],

	townWins: [
		"Case closed. The syndicate's been dismantled, and the borough can sleep easy — for now.\n\n{winners}\n\n{roles}",
		"The private eyes and honest citizens did what the law couldn't. The syndicate is finished.\n\n{winners}\n\n{roles}",
		'Rain washes the blood off the streets. The good guys won this one.\n\n{winners}\n\n{roles}',
		"The city's finest hour. The syndicate rats are behind bars where they belong.\n\n{winners}\n\n{roles}",
	],

	mafiaWins: [
		'The syndicate owns this city now. The honest citizens never stood a chance.\n\n{winners}\n\n{roles}',
		"The boss lights a cigar. The borough belongs to the syndicate, and there's nobody left to fight back.\n\n{winners}\n\n{roles}",
		"The rain keeps falling, but nobody's left to care. The syndicate runs the show.\n\n{winners}\n\n{roles}",
		"This city's rotten to the core. The syndicate won, and the good folks are just memories.\n\n{winners}\n\n{roles}",
	],

	roleAssignment: {
		villager: [
			"You're a CITIZEN. No badge, no piece — just your instincts and a city full of liars. Find the syndicate before they find you.",
			"You're a CITIZEN. An honest soul in a crooked borough. Keep your head on a swivel and trust nobody.",
			"You're a CITIZEN. Regular Joe in an irregular city. Watch who's talking too much — and who's saying nothing at all.",
		],
		cop: [
			"You're the PRIVATE EYE. Each night, DM me a name to investigate — I'll dig up whether they're clean or dirty.",
			"You're the PRIVATE EYE. This city needs a gumshoe. DM me a name each night, and I'll tell you what side they're on.",
			"You're the PRIVATE EYE. Every night, you tail a suspect. DM me who — I'll report back what I find.",
		],
		doctor: [
			"You're the SAWBONES. Each night, DM me someone to patch up. If the syndicate targets them, they'll live to see morning.",
			"You're the SAWBONES. The city's underground doc. DM me a name each night — if the syndicate comes for them, you'll keep them breathing.",
			"You're the SAWBONES. You keep people alive in a city that wants them dead. DM me who to protect each night.",
		],
		godfather: [
			"You're the GODFATHER. You run the syndicate. DM me your hit each night. The PI can't touch you — you come up clean.",
			"You're the GODFATHER. Boss of the operation. Pick your targets, run your crew. Investigations slide right off you.",
			"You're the GODFATHER. The syndicate answers to you. DM me who to rub out each night. You're invisible to the private eye.",
		],
		mafioso: [
			"You're an ENFORCER. Syndicate muscle. Coordinate with your crew through the relay. If the boss goes down, you step up.",
			"You're an ENFORCER. Part of the syndicate. Work through the relay, keep your cover, and follow the boss's lead.",
			"You're an ENFORCER. A soldier in the syndicate. Use the relay to plan with your crew. Stay in the shadows.",
		],
	},

	copResult: [
		'Case file on @{target}: {result}. Do with it what you will, gumshoe.',
		'Your tail on @{target} turned up something: {result}.',
		'The dirt on @{target}: {result}. Watch your back out there.',
	],

	nightStart: [
		'The streetlights flicker. The city goes dark, and the syndicate goes to work. Power roles: make your moves.',
		"Night falls like a curtain. Somewhere out there, someone's making a list. Power roles: DM your actions.",
		'The neon signs dim. Another dangerous night in the borough. Power roles: time to act.',
	],

	night0Guidance: {
		villager: [
			"Night 0 — nothing for you to do, citizen. The professionals are working. Day 1 starts once they're done.",
			"Sit tight. Night 0 is for the people with badges and black bags. You'll get your say when the sun comes up.",
			'Night 0. No action needed — just keep your door locked. Day breaks once the power roles finish.',
		],
		cop: [
			'Night 0, PI. Time for your first tail. DM me a name to investigate — Day 1 starts once all the night owls check in.',
			"The case starts now. DM me someone to look into — once you do, we're one step closer to dawn.",
			'Night 0. Start building your case, gumshoe. DM me a name to investigate.',
		],
		doctor: [
			"Night 0 — no hit tonight, sawbones. The syndicate doesn't strike on the first night. Sit tight until Day 1.",
			"Easy night, doc. No one's getting whacked on Night 0. You'll be needed soon enough.",
			"Night 0. No patients tonight — the syndicate's still casing the joint. Day 1 is on its way.",
		],
		godfather: [
			'Night 0 — no hit tonight, boss. Use the relay to get your crew in line. Day 1 starts once all night actions are in.',
			"Night 0. Can't make a move yet, but the relay's open. Talk strategy with your enforcers.",
			"No rubbing anyone out on Night 0. Plan your next move with the crew. Dawn's coming.",
		],
		mafioso: [
			'Night 0 — no action tonight. Use the relay to sync up with your crew. Day 1 is coming.',
			"Night 0. The boss calls the shots, but the relay's open for planning. Sit tight.",
			"Can't do anything tonight — Night 0 is just setup. Use the relay to coordinate with the syndicate.",
		],
	},

	gameStart: [
		'The case begins. Check your DMs — and trust nobody in this city.',
		'The game is on, and the streets are watching. Check your DMs for your assignment.',
		'Someone in this borough has blood on their hands. Check your DMs to find out who you are.',
	],
};

export const CORPORATE_FLAVOR: FlavorPack = {
	name: 'Corporate Office',

	nightKill: {
		villager: [
			"@{victim}'s badge no longer works. Security escorted them out before sunrise — a loyal employee, laid off without cause.",
			"@{victim}'s desk has been cleared overnight. Just a regular employee who showed up to the wrong meeting.",
			"@{victim} got a 2 AM Slack from HR: 'Your position has been eliminated.' They were just an employee doing their job.",
			"@{victim}'s laptop was remotely wiped. Another honest employee taken out by the saboteurs.",
		],
		cop: [
			"@{victim}'s audit files have been shredded. The internal auditor is gone — and so is the paper trail.",
			'@{victim} the auditor dug too deep into the books. Someone made sure they were terminated first.',
			"The auditor @{victim} won't be filing any more compliance reports. Their access has been permanently revoked.",
			'They got to @{victim} before the quarterly review. The company just lost its only honest auditor.',
		],
		doctor: [
			'@{victim} from HR has been let go. The one person who could protect employees from the saboteurs is out.',
			"@{victim}'s HR credentials are revoked. The saboteurs took out the only one watching out for the team.",
			"The HR rep @{victim} has been 'restructured' out of a job. No more saving people from the chopping block.",
			"@{victim} from HR won't be mediating any more disputes. The saboteurs got to them overnight.",
		],
		godfather: [
			"@{victim}'s corner office is empty. The ringleader of the saboteurs got a taste of their own restructuring.",
			"The head saboteur @{victim} has been escorted out. Their golden parachute won't save them now.",
			'@{victim} the VP of sabotage is gone. But can the company survive the damage they already did?',
			"@{victim}'s LinkedIn already says 'Open to Work.' The mastermind behind the sabotage is finally out.",
		],
		mafioso: [
			"@{victim}'s Slack is deactivated. One less corporate saboteur undermining the company.",
			"@{victim} won't be filing any more false expense reports. A saboteur exposed and eliminated.",
			'Another saboteur bites the dust. @{victim} has been terminated — for real this time.',
			"@{victim}'s access badge is shredded. A corporate saboteur, gone before the morning standup.",
		],
	},

	dawnPeaceful: [
		'The morning standup starts on time. Miraculously, nobody was laid off overnight.',
		'Everyone logs into Slack to find zero termination notices. A rare peaceful night at the company.',
		'Coffee is brewing, badges are working, and everyone made it through the night. Suspicious.',
		"The 9 AM all-hands reveals a full roster. No overnight layoffs — but don't get comfortable.",
		'Surprisingly, all desks are occupied this morning. The saboteurs held off for one night.',
	],

	dayElimination: {
		villager: [
			'The team votes @{victim} off the org chart. But they were just a regular employee — the saboteurs are still billing hours.',
			'@{victim}\'s exit interview was quick: "But I hit all my KPIs!" Didn\'t matter. They were just an employee.',
			'@{victim} gets a pink slip from the team. Wrong call — they were a loyal employee. The saboteurs are high-fiving.',
			'Performance review: @{victim} is out. They were just an employee. The company got it wrong.',
		],
		cop: [
			"@{victim} is voted out — and the company just fired its own auditor. Who's checking the books now?",
			'The team eliminates @{victim}. They were the internal auditor. The saboteurs are popping champagne in the break room.',
			'@{victim} tried to show them the receipts. They showed them the door. The auditor is gone.',
			"The company fires its own compliance officer. @{victim} the auditor won't be reviewing any more expense reports.",
		],
		doctor: [
			'@{victim} is voted out. They were HR — the one person protecting employees from the saboteurs.',
			"The team turns on @{victim} from HR. Now there's nobody to file a grievance with.",
			"@{victim} gets a unanimous thumbs-down. They were HR. The saboteurs couldn't have restructured it better.",
			"The company eliminates its own HR rep. @{victim} is out, and nobody's safe anymore.",
		],
		godfather: [
			'@{victim} is escorted out by security. The ringleader of the saboteurs — caught at last.',
			"The team nails @{victim}. The mastermind. Even those clean audits couldn't save the head saboteur.",
			'@{victim} gets a termination letter signed by the whole team. The VP of sabotage is finished.',
			"They found the mole. @{victim} the ringleader is out, and the company's stock is already recovering.",
		],
		mafioso: [
			'@{victim} tries to talk their way through the PIP. No dice. A saboteur, caught and terminated.',
			"The team catches a break. @{victim} was a saboteur all along — and now they're cleaning out their desk.",
			'@{victim} the saboteur is out. One less mole in the company. Time to update the org chart.',
			"HR finally got one right. @{victim} was a corporate saboteur, and they're out.",
		],
	},

	dayNoMajority: [
		'The meeting runs over with no action items. Another day wasted in corporate indecision.',
		'Twelve people in a conference room and zero decisions made. Classic. The day ends without a termination.',
		'Too many reply-all threads, not enough consensus. No one gets the axe today.',
		'The team tables the discussion until the next sprint. Nobody is eliminated.',
		'Passive-aggressive Slack messages fly all day, but nobody pulls the trigger. Meeting adjourned.',
	],

	townWins: [
		'The saboteurs have been identified and terminated. The company can finally hit its quarterly targets.\n\n{winners}\n\n{roles}',
		'Compliance wins. The corporate saboteurs are out, and the honest employees can get back to work.\n\n{winners}\n\n{roles}',
		'The moles are gone. Time to send a company-wide Slack celebration.\n\n{winners}\n\n{roles}',
		'Internal affairs prevails. The saboteurs are escorted out, and the org chart is clean.\n\n{winners}\n\n{roles}',
	],

	mafiaWins: [
		'The saboteurs own the company now. The honest employees never stood a chance against corporate politics.\n\n{winners}\n\n{roles}',
		'Hostile takeover complete. The saboteurs run the show, and the real employees are updating their résumés.\n\n{winners}\n\n{roles}',
		"The company belongs to the saboteurs. There aren't enough loyal employees left to file a complaint.\n\n{winners}\n\n{roles}",
		'The saboteurs have the board seats. The good employees? Restructured into oblivion.\n\n{winners}\n\n{roles}',
	],

	roleAssignment: {
		villager: [
			"You're an EMPLOYEE. No special role — just an honest worker trying to survive the corporate sabotage. Spot the moles, vote them out.",
			"You're an EMPLOYEE. Regular staff in a company full of backstabbers. Trust your instincts and watch who's sandbagging the projects.",
			"You're an EMPLOYEE. Keep your head down, do your job, and figure out who's sabotaging this company from the inside.",
		],
		cop: [
			"You're the INTERNAL AUDITOR. Each night, DM me someone to audit — I'll tell you if they're a loyal employee or a saboteur.",
			"You're the INTERNAL AUDITOR. Compliance is your game. DM me a name each night, and I'll pull their file.",
			"You're the INTERNAL AUDITOR. Every night, you review someone's record. DM me who — I'll report what I find.",
		],
		doctor: [
			"You're HR. Each night, DM me someone to protect. If the saboteurs target them, you'll block the termination.",
			"You're HR. The company's safety net. DM me a name each night — if the saboteurs come for them, you'll intervene.",
			"You're HR. You keep good employees employed. DM me who to shield from the saboteurs each night.",
		],
		godfather: [
			"You're the RINGLEADER. Head of the corporate saboteurs. DM me who to terminate each night. Audits can't touch you — your books are clean.",
			"You're the RINGLEADER. You run the sabotage operation. Pick your targets carefully. The auditor can't find dirt on you.",
			"You're the RINGLEADER. The saboteurs answer to you. DM me who to eliminate each night. You're audit-proof.",
		],
		mafioso: [
			"You're a SABOTEUR. Corporate mole. Coordinate with your team through the relay. If the ringleader gets caught, you take over.",
			"You're a SABOTEUR. Working from the inside. Use the relay to plan with your crew. Stay under the radar.",
			"You're a SABOTEUR. Part of the operation. Keep your cover, coordinate through the relay, and undermine the company from within.",
		],
	},

	copResult: [
		'Audit complete on @{target}: {result}. File accordingly.',
		'Your review of @{target} is in: {result}.',
		"@{target}'s records show: {result}. Handle with discretion.",
	],

	nightStart: [
		'The office lights go dark. Somewhere, the saboteurs are meeting in a conference room. Power roles: submit your actions.',
		'After-hours. The Slack channels go quiet, but the saboteurs are just getting started. Power roles: DM your actions.',
		'The building empties, but not everyone goes home. Power roles: time to make your moves.',
	],

	night0Guidance: {
		villager: [
			"Night 0 — nothing for you to do, employee. The specialists are working. Day 1 starts once they're done.",
			"Sit tight. Night 0 is for the power roles. You'll get your say at the next all-hands.",
			'Night 0. No action needed — just check your email in the morning. Day breaks once the power roles finish.',
		],
		cop: [
			'Night 0, auditor. Time for your first review. DM me a name to audit — Day 1 starts once all night actions are in.',
			'Start pulling records. DM me someone to look into — the sooner you act, the sooner the workday begins.',
			'Night 0. Open your first case, auditor. DM me a name to investigate.',
		],
		doctor: [
			"Night 0 — no terminations tonight, HR. The saboteurs don't strike on the first night. Sit tight until Day 1.",
			"Easy night. No one's getting fired on Night 0. You'll be needed soon enough.",
			'Night 0. No one to protect tonight — the saboteurs are still settling in. Day 1 is on the way.',
		],
		godfather: [
			'Night 0 — no terminations tonight, boss. Use the relay to coordinate with your team. Day 1 starts once all night actions are in.',
			"Night 0. Can't make a move yet, but the relay's open. Talk strategy with your saboteurs.",
			'No layoffs on Night 0. Plan your next restructuring with the crew. Morning meeting is coming.',
		],
		mafioso: [
			'Night 0 — no action tonight. Use the relay to sync up with your team. Day 1 is coming.',
			"Night 0. The ringleader calls the shots, but the relay's open for planning. Sit tight.",
			"Can't do anything tonight — Night 0 is just onboarding. Use the relay to coordinate with the team.",
		],
	},

	gameStart: [
		'The all-hands is called. Check your DMs for your role — and watch your back in the break room.',
		'New reorg just dropped. Check your DMs to find out where you landed.',
		'Something is rotten in this company. Check your DMs to learn your role.',
	],
};

export const VICTORIAN_FLAVOR: FlavorPack = {
	name: 'Victorian Murders',

	nightKill: {
		villager: [
			'The morning post brings grim news: @{victim}, a respectable citizen of the borough, was found lifeless in the fog.',
			"@{victim}'s gas lamp still burns in the window, but its owner shall never return. A good citizen, taken by the society.",
			'The constable found @{victim} in the alley behind the public house. Merely a citizen — wrong place, wrong evening.',
			'@{victim} attended no secret meetings, kept no dark company. Yet the society found them all the same. An innocent citizen, gone.',
		],
		cop: [
			"@{victim}'s case files are scattered across the inspector's desk. Scotland Yard's finest shall investigate no more.",
			'Inspector @{victim} got too close to the truth. The society made sure the case went cold — permanently.',
			'The inspector @{victim} has been silenced. Their notebook, alas, was taken with them.',
			"@{victim} of the Yard is dead. The borough's best investigator shall file no further reports.",
		],
		doctor: [
			"@{victim} the physician could not heal thyself. The borough's medical guardian is no more.",
			"Dr. @{victim}'s black bag was found on the riverbank. The society has eliminated the one who kept the borough alive.",
			'The physician @{victim} made one final house call — from which they did not return.',
			'@{victim} the doctor is gone. The society struck down the only healer in the borough.',
		],
		godfather: [
			"@{victim}'s secret chamber has been laid bare. The grandmaster of the murderous society is no more.",
			'The head of the serpent is severed. @{victim}, grandmaster of the society, meets a fitting end.',
			"@{victim}'s reign of terror is over. The grandmaster falls, and the society trembles.",
			'The grandmaster @{victim} is found at last — though not alive. The society has lost its architect.',
		],
		mafioso: [
			'@{victim} is unmasked — a member of the secret society, now brought to justice most final.',
			'One less shadow in the gaslight. @{victim} the cultist shall conspire no more.',
			'@{victim}, once hidden behind a respectable facade, is revealed as a member of the murderous society.',
			'The society loses a foot soldier. @{victim} the cultist has been dealt with.',
		],
	},

	dawnPeaceful: [
		'The morning fog lifts to reveal all residents accounted for. A rare mercy in these troubled times.',
		'Dawn breaks over the rooftops. The borough stirs — and every soul still draws breath.',
		'The lamplighter makes his rounds. No bodies, no constables, no commotion. An uneventful night.',
		'The church bells toll the hour, and all parishioners are present. The society stayed its hand tonight.',
		'A peaceful dawn in the borough. One might almost forget the darkness that lurks beneath.',
	],

	dayElimination: {
		villager: [
			'The borough passes its verdict on @{victim}. A respectable citizen — condemned by suspicion alone.',
			'@{victim} protests their innocence to the last. The mob cares not. They were merely a citizen.',
			'The crowd turns upon @{victim}. A grievous error — they were but an honest citizen of the borough.',
			'@{victim} is cast out in disgrace. They were a citizen, nothing more. The society remains at large.',
		],
		cop: [
			'@{victim} is condemned — and the borough has destroyed its own inspector. Who shall investigate now?',
			'The borough expels @{victim}. They were the inspector — the only one with the wit to find the society.',
			'@{victim} the inspector is driven out. The society raises a glass behind closed doors.',
			'Inspector @{victim} is gone. The borough just eliminated the one person who could have solved the case.',
		],
		doctor: [
			"@{victim} is cast out. They were the physician — the borough's only protection against the society's blade.",
			'The borough condemns @{victim} the doctor. Now when the society strikes, there shall be no one to tend the wounded.',
			'Dr. @{victim} is expelled. A catastrophic error — the healer is gone.',
			"The physician @{victim} is banished. The society couldn't have orchestrated it better themselves.",
		],
		godfather: [
			'@{victim} is exposed at last — the grandmaster of the secret society, brought low by the will of the people.',
			"The borough unmasks @{victim}. The grandmaster. Even a clean inspector's report couldn't save them.",
			"@{victim} the grandmaster is condemned. The society's leader falls to the court of public opinion.",
			'Justice finds @{victim} — the grandmaster of the murderous society. A triumph for the borough.',
		],
		mafioso: [
			'@{victim} is condemned by the borough. A cultist — the people have found a true villain.',
			'The evidence mounts against @{victim}. A member of the society, exposed and expelled.',
			'@{victim} the cultist is driven from the borough. One less conspirator in the shadows.',
			'The borough roots out @{victim} — a soldier of the secret society. Well done, citizens.',
		],
	},

	dayNoMajority: [
		'The borough debates until sundown, but no consensus is reached. The gaslights flicker on an indecisive evening.',
		'Accusations are hurled like penny dreadfuls, but no verdict comes. The day ends without condemnation.',
		'Much discussion over tea, precious little action. The borough retires without reaching a decision.',
		'The assembly dissolves in disagreement. No one is condemned, and the society lives to conspire another night.',
		'Gentlemen argue, ladies whisper, and nothing is decided. The borough wastes another day.',
	],

	townWins: [
		'The secret society is dismantled. The borough may rest easy — for now.\n\n{winners}\n\n{roles}',
		'Justice prevails in the gaslit streets. The murderous society is no more.\n\n{winners}\n\n{roles}',
		"The inspector's work is done. The society's members are in irons, and the borough is safe.\n\n{winners}\n\n{roles}",
		'Order is restored to the borough. The secret society shall trouble these streets no longer.\n\n{winners}\n\n{roles}',
	],

	mafiaWins: [
		'The society owns the borough now. The respectable citizens never stood a chance.\n\n{winners}\n\n{roles}',
		'The gaslights dim on a conquered borough. The society has won, and darkness reigns.\n\n{winners}\n\n{roles}',
		"The borough belongs to the society. There aren't enough good citizens left to resist.\n\n{winners}\n\n{roles}",
		'The secret society controls all. The honest citizens are but memories in the fog.\n\n{winners}\n\n{roles}',
	],

	roleAssignment: {
		villager: [
			'You are a CITIZEN of the borough. No special talents — merely your wits and your reputation. Find the society before they find you.',
			'You are a CITIZEN. An upstanding member of the community. Pay attention to who speaks too carefully — and who says too little.',
			'You are a CITIZEN. Ordinary, respectable, and in grave danger. Observe, discuss, and vote wisely.',
		],
		cop: [
			'You are the INSPECTOR. Each night, DM me a name to investigate — I shall report whether they serve the borough or the society.',
			"You are the INSPECTOR. Scotland Yard's finest. DM me a name each night, and I shall uncover the truth.",
			'You are the INSPECTOR. Each night, you pursue a lead. DM me who — I shall report my findings.',
		],
		doctor: [
			'You are the PHYSICIAN. Each night, DM me someone to attend. If the society targets them, your care shall preserve their life.',
			"You are the PHYSICIAN. The borough's guardian. DM me a name each night — if the society comes for them, you shall intervene.",
			'You are the PHYSICIAN. You keep the borough alive. DM me who to protect from the society each night.',
		],
		godfather: [
			'You are the GRANDMASTER. Leader of the secret society. DM me your target each night. The inspector cannot touch you — your reputation is spotless.',
			'You are the GRANDMASTER. The society answers to you. Choose your victims carefully. Investigations reveal nothing.',
			'You are the GRANDMASTER. Head of the murderous society. DM me who to eliminate each night. You are above suspicion.',
		],
		mafioso: [
			'You are a CULTIST. A member of the secret society. Coordinate with your fellows through the relay. If the grandmaster falls, you must lead.',
			"You are a CULTIST. Sworn to the society. Work through the relay, maintain your cover, and serve the grandmaster's designs.",
			'You are a CULTIST. Part of the secret order. Keep your facade, coordinate through the relay, and help the society conquer the borough.',
		],
	},

	copResult: [
		'Your investigation of @{target} reveals: {result}. Proceed with caution, inspector.',
		'The evidence on @{target}: {result}. Make of it what you will.',
		'Your inquiries into @{target} are conclusive: {result}. The case file is yours.',
	],

	nightStart: [
		'The gaslights dim. The borough sleeps, but the society does not. Power roles: make your moves under cover of darkness.',
		'Fog rolls through the streets. Somewhere behind closed doors, the society convenes. Power roles: DM your actions.',
		'Night descends upon the borough. The lamplighter passes, and the shadows grow long. Power roles: act now.',
	],

	night0Guidance: {
		villager: [
			'Night 0 — nothing for you to do, citizen. The professionals are at work. Day 1 begins once they have finished.',
			'Rest easy tonight. Night 0 is for the power roles. Your voice shall be heard when morning comes.',
			'Night 0. No action required — retire for the evening. Day breaks once the power roles have concluded.',
		],
		cop: [
			'Night 0, inspector. Time for your first investigation. DM me a name — Day 1 begins once all night actions are submitted.',
			'Begin your inquiry. DM me someone to investigate — the sooner you act, the sooner dawn arrives.',
			'Night 0. Open your first case, inspector. DM me a name to look into.',
		],
		doctor: [
			'Night 0 — no murder tonight, physician. The society does not strike on the first night. Rest until Day 1.',
			'A quiet evening, doctor. No one falls on Night 0. You shall be needed soon enough.',
			'Night 0. No patients tonight — the society is still gathering its members. Day 1 approaches.',
		],
		godfather: [
			'Night 0 — no killing tonight, grandmaster. Use the relay to organize your society. Day 1 begins once all night actions are in.',
			'Night 0. The blade stays sheathed, but the relay is open. Confer with your cultists.',
			'No blood on Night 0. Plan your campaign with the society. Dawn is coming.',
		],
		mafioso: [
			'Night 0 — no action tonight. Use the relay to coordinate with the society. Day 1 approaches.',
			'Night 0. The grandmaster leads, but the relay is open for discussion. Await the dawn.',
			'Nothing to do tonight — Night 0 is merely preparation. Use the relay to confer with the society.',
		],
	},

	gameStart: [
		'The game is afoot. Check your DMs — and trust no one in these foggy streets.',
		'Roles have been assigned by lamplight. Check your DMs to learn your place in this affair.',
		'A darkness stirs in the borough. Check your DMs to discover who you truly are.',
	],
};

export const MONSTER_MASH_FLAVOR: FlavorPack = {
	name: 'Monster Mash',

	nightKill: {
		villager: [
			'The screams echoed through the village at midnight. @{victim}, a hapless villager, was found at dawn — another victim of the monsters.',
			"@{victim}'s cottage door was torn off its hinges. Just an ordinary villager who couldn't outrun the creatures.",
			'@{victim} should have stayed indoors. The monsters got another innocent villager, and the village grows smaller.',
			'@{victim} was dragged into the darkness. A simple villager who never stood a chance against the things that go bump in the night.',
		],
		cop: [
			'@{victim} the monster hunter is no more. Their crossbow was found snapped in two beside the old cemetery.',
			"The monsters got to the hunter. @{victim}'s silver bullets won't be protecting anyone else.",
			"@{victim}'s monster-hunting journal ends mid-sentence. The creatures silenced the one person who could track them.",
			'The village\'s best monster hunter @{victim} has fallen. Their last entry: "I know what they are—"',
		],
		doctor: [
			'@{victim} the mad scientist was found slumped over their bubbling apparatus. No more experimental cures for the village.',
			"Dr. @{victim}'s laboratory is dark and silent. The friendly mad scientist has been taken by the very monsters they tried to understand.",
			"@{victim}'s potions are spilled across the floor. The village's eccentric protector is gone.",
			"The monsters smashed their way into @{victim}'s lab. The mad scientist won't be saving anyone else.",
		],
		godfather: [
			"@{victim}'s monstrous true form is revealed at last. The alpha creature lies still — the pack has lost its master.",
			'The head monster @{victim} has been destroyed. But can the village survive what they left behind?',
			"@{victim} the alpha monster won't be leading any more midnight raids. The biggest beast falls.",
			"@{victim}'s reign of terror ends. The alpha creature is vanquished, though the pack may yet survive.",
		],
		mafioso: [
			"@{victim}'s disguise falls away — claws, fangs, the whole deal. One less monster stalking the village.",
			'The villagers unmask @{victim}. Literally — underneath was something with far too many teeth.',
			'@{victim} the creature is destroyed. One less monster hiding behind a human face.',
			'Another monster down. @{victim} reverts to their true hideous form as the sun rises.',
		],
	},

	dawnPeaceful: [
		'The roosters crow and — miracle of miracles — everyone survived the night. The monsters must have been busy elsewhere.',
		'Dawn breaks. Every villager is accounted for. Even the monsters take a night off sometimes.',
		'The morning fog reveals no new victims. The village holds its breath — how long can this last?',
		'All torches still burning, all doors intact. A rare peaceful night in the monster-plagued village.',
		"Sunrise. The garlic held, the silver worked, or maybe the monsters just weren't hungry. Everyone's alive.",
	],

	dayElimination: {
		villager: [
			'The angry mob descends on @{victim} with pitchforks and torches. But wait — no claws, no fangs. Just a villager. Oops.',
			"@{victim} protests through the mob's chanting: \"I'm not a monster!\" They weren't. The real monsters are still out there.",
			"The village burns @{victim}'s cottage. Turns out they were just a regular villager. The monsters are laughing.",
			'@{victim} is driven from the village. They were just a hapless villager. The real creatures watch from the shadows.',
		],
		cop: [
			'@{victim} is cast out — and the village just lost its monster hunter. Who hunts the creatures now?',
			'The mob turns on @{victim}. They were the monster hunter. The monsters are howling with delight.',
			'@{victim} the hunter is driven out by the very people they protected. The village just disarmed itself.',
			"The village banishes its own monster hunter. @{victim} is gone, and the creatures couldn't be happier.",
		],
		doctor: [
			'@{victim} is chased out of town. They were the mad scientist — the only one who could protect the village.',
			"The mob storms @{victim}'s laboratory. They were the friendly mad scientist. Now nobody's brewing antidotes.",
			'@{victim} the mad scientist is expelled. The village just lost its only defense against the monsters.',
			"The villagers destroy @{victim}'s lab and drive them out. The monsters couldn't have planned it better.",
		],
		godfather: [
			'@{victim} is dragged into the light and — fangs! Claws! The alpha monster is exposed at last!',
			"The village gets it right! @{victim} was the alpha creature all along. Even that innocent disguise couldn't save the head monster.",
			'@{victim} transforms before the mob. The alpha monster is vanquished by torchlight.',
			'The village finds the head creature. @{victim} the alpha monster is destroyed, and the pack is crippled.',
		],
		mafioso: [
			'@{victim} is cornered by the mob. Their disguise slips — definitely a monster. The village got one right!',
			'Pitchforks find their mark. @{victim} was a monster all along — exposed and expelled from the village.',
			'@{victim} the creature is caught. One less monster hiding among the villagers.',
			"The torches and pitchforks work! @{victim} was a monster, and they're out of the village.",
		],
	},

	dayNoMajority: [
		'The mob argues over who to chase with torches, but nobody can agree. The sun sets without a lynching.',
		'Everyone waves their pitchforks at different people. No consensus, no banishment. The monsters live another night.',
		'The villagers spend all day boarding up windows instead of making a decision. No one is expelled.',
		'Too much garlic, not enough agreement. The village wastes another day while the monsters wait patiently.',
		'The angry mob disperses without picking a target. The monsters are probably thrilled.',
	],

	townWins: [
		'The last monster crumbles to dust in the morning light. The village is safe — the creature feature is over!\n\n{winners}\n\n{roles}',
		'Every monster has been found and destroyed. The villagers can sleep without garlic necklaces again.\n\n{winners}\n\n{roles}',
		"The monster hunter's work is done. The creatures are vanquished, and the village throws a torchlit celebration.\n\n{winners}\n\n{roles}",
		'The horror is over. The monsters are gone, and the village can finally stop buying silver bullets in bulk.\n\n{winners}\n\n{roles}',
	],

	mafiaWins: [
		"The monsters own the village now. The remaining villagers barricade their doors, but it's too late.\n\n{winners}\n\n{roles}",
		"The creatures have overrun the village. There aren't enough pitchforks left to fight back.\n\n{winners}\n\n{roles}",
		'The village belongs to the monsters. The hapless villagers are just dinner with extra steps.\n\n{winners}\n\n{roles}',
		'The monsters win. The village is their playground now, and the screaming never stops.\n\n{winners}\n\n{roles}',
	],

	roleAssignment: {
		villager: [
			"You're a VILLAGER. No weapons, no powers — just a torch and your survival instincts. Find the monsters before they eat everyone.",
			"You're a VILLAGER. A regular person in a very irregular situation. Figure out who the monsters are and vote them out.",
			"You're a VILLAGER. Hapless but determined. Watch for anyone acting suspiciously inhuman.",
		],
		cop: [
			"You're the MONSTER HUNTER. Each night, DM me a name to investigate — I'll tell you if they're human or creature.",
			"You're the MONSTER HUNTER. Armed with silver and suspicion. DM me someone to investigate each night.",
			"You're the MONSTER HUNTER. Every night, you set a trap. DM me who — I'll tell you what I catch.",
		],
		doctor: [
			"You're the MAD SCIENTIST (the friendly kind). Each night, DM me someone to protect with your experimental monster repellent.",
			"You're the MAD SCIENTIST. Your potions keep people alive. DM me who to protect each night — your serum will shield them.",
			"You're the MAD SCIENTIST. Eccentric but essential. DM me someone to protect from the creatures each night.",
		],
		godfather: [
			"You're the ALPHA MONSTER. Leader of the creatures. DM me who to devour each night. The hunter's traps can't detect you — you pass as human.",
			"You're the ALPHA MONSTER. Top of the food chain. Pick your prey and lead the pack. Investigations show you as human.",
			"You're the ALPHA MONSTER. The creatures follow your lead. DM me your target each night. You're undetectable.",
		],
		mafioso: [
			"You're a CREATURE. One of the monsters in disguise. Coordinate with the pack through the relay. If the alpha falls, you lead.",
			"You're a CREATURE. Monster in human skin. Work through the relay, keep your disguise, and follow the alpha's lead.",
			"You're a CREATURE. Part of the monster pack. Stay hidden among the villagers, coordinate through the relay.",
		],
	},

	copResult: [
		'Your investigation of @{target}: {result}. Keep your silver close, hunter.',
		'The trap results for @{target}: {result}.',
		"You checked @{target}'s reflection in the mirror: {result}. Interesting.",
	],

	nightStart: [
		'The sun sets and the howling begins. The monsters are on the prowl. Power roles: make your moves.',
		'Darkness falls over the village. Something is scratching at the doors. Power roles: DM your actions.',
		'The torches flicker and the shadows grow teeth. Power roles: time to act before something eats you.',
	],

	night0Guidance: {
		villager: [
			"Night 0 — stay in your cottage, villager. The specialists are working. Day 1 starts once they're done.",
			'Board up the windows and wait. Night 0 is for the power roles. Your pitchfork will be needed at dawn.',
			'Night 0. Nothing for you to do but survive. Day breaks once the power roles finish.',
		],
		cop: [
			'Night 0, hunter. Time to set your first trap. DM me a name to investigate — Day 1 starts once all night actions are in.',
			'Start hunting. DM me someone to investigate — the sooner you act, the sooner dawn arrives.',
			'Night 0. Load your silver bullets, hunter. DM me a name to investigate.',
		],
		doctor: [
			"Night 0 — no monsters attack on the first night, doc. Your potions aren't needed yet. Day 1 is coming.",
			'Easy night, scientist. No one gets eaten on Night 0. Save your serum for later.',
			'Night 0. No patients tonight — the monsters are still waking up. Day 1 is on the way.',
		],
		godfather: [
			'Night 0 — no hunting tonight, alpha. Use the relay to organize the pack. Day 1 starts once all night actions are in.',
			'Night 0. The hunger can wait. Use the relay to coordinate with your creatures.',
			'No feasting on Night 0. Rally the pack through the relay. Dawn is coming.',
		],
		mafioso: [
			'Night 0 — no action tonight. Use the relay to connect with the pack. Day 1 is coming.',
			"Night 0. The alpha leads, but the relay's open for pack coordination. Wait for dawn.",
			"Can't hunt tonight — Night 0 is just for gathering the pack. Use the relay to plan.",
		],
	},

	gameStart: [
		'The monsters are among you. Check your DMs to find out what you are — human or otherwise.',
		'Something wicked this way comes. Check your DMs for your role in this creature feature.',
		'The village trembles. Check your DMs — are you hunter, healer, or something with fangs?',
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

/** All available flavor packs, keyed by name */
export const FLAVOR_PACKS: Record<string, FlavorPack> = {
	[DEFAULT_FLAVOR.name]: DEFAULT_FLAVOR,
	[NOIR_FLAVOR.name]: NOIR_FLAVOR,
	[CORPORATE_FLAVOR.name]: CORPORATE_FLAVOR,
	[VICTORIAN_FLAVOR.name]: VICTORIAN_FLAVOR,
	[MONSTER_MASH_FLAVOR.name]: MONSTER_MASH_FLAVOR,
};

const PACK_NAMES = Object.keys(FLAVOR_PACKS);

/** Get a flavor pack by name, falling back to default */
export function getFlavorPack(name: string): FlavorPack {
	return FLAVOR_PACKS[name] ?? DEFAULT_FLAVOR;
}

/** Pick a random flavor pack name */
export function randomFlavorPackName(): string {
	return PACK_NAMES[Math.floor(Math.random() * PACK_NAMES.length)] ?? DEFAULT_FLAVOR.name;
}

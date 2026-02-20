# Skeetwolf: Forum Mafia on ATProto

## Project Purpose

Moderatorless Werewolf/Mafia game played through Bluesky. An automated bot manages game state, role assignment, phase transitions, and announcements. Players interact via Bluesky posts (public discussion, voting) and DMs (role assignment, night actions, mafia coordination).

## Technology Stack

- **Language**: TypeScript 5.7+ (strict mode)
- **Runtime**: Node.js 20+
- **Testing**: Vitest 3
- **Linting/Formatting**: Biome (tabs, single quotes, 100 char width)
- **Package Manager**: npm workspaces
- **ATProto**: @atproto/api for Bluesky interaction
- **Database**: SQLite via better-sqlite3 (game state persistence)
- **Deployment target**: Mini PC (long-running Node service) — not yet available

## Architecture

**FCIS (Functional Core, Imperative Shell)**

### Packages (npm workspaces)

```
packages/
├── shared/     # Functional core — types, pure game logic, role definitions
│   └── src/
│       ├── types.ts          # Game types (Player, Phase, Vote, NightAction, GameState)
│       ├── game-logic.ts     # Pure state machine (create, signup, roles, vote, night, win)
│       └── index.ts
├── engine/     # Imperative shell — bot I/O, DB, game manager
│   └── src/
│       ├── bot.ts            # Bluesky posting, mention polling, DM interface
│       ├── db.ts             # SQLite persistence (serialized game state)
│       ├── game-manager.ts   # Bridges game logic with I/O
│       └── index.ts          # Entry point, polling loop
└── feed/       # Feed generator stub (Cloudflare Worker, future)
    └── src/
        └── index.ts
```

### Key Design Decisions

- **Game state is immutable** — all game-logic functions return new state, never mutate
- **DB stores serialized GameState** — simple JSON blob per game, no normalized tables yet
- **DMs stubbed** — `DmSender` interface with console logger; real implementation pending chat.bsky.convo API confirmation
- **Phase timers not yet implemented** — transitions are manual/command-driven for now
- **No custom lexicon yet** — MVP uses mention-based commands; structured records later

## Commands

```bash
npm run validate    # biome check + tsc --noEmit + vitest run
npm run test        # vitest (watch mode)
npm run build       # tsc -b across all packages
npm run dev         # run engine (requires BSKY_IDENTIFIER + BSKY_PASSWORD)
```

## Game Flow

1. Someone mentions bot with "new game" → bot creates game, posts announcement
2. Players reply "join #<id>" → added to player list
3. Bot assigns roles (DM), starts Night 0
4. Night: power roles DM actions to bot; mafia coordinate in group DM
5. Day: public discussion + voting via mentions; majority = elimination
6. Repeat until win condition (all mafia dead OR mafia >= town)

## Environment Variables

```
BSKY_IDENTIFIER=    # Bot's Bluesky handle or DID
BSKY_PASSWORD=      # Bot's app password
```

## Testing

- Colocated: `foo.ts` → `foo.test.ts`
- Game logic is 100% pure functions — easy to test with injectable shuffle
- `noShuffle` helper in tests for deterministic role assignment

## Future Work (roughly ordered)

1. Real DM sender (chat.bsky.convo)
2. Phase timer implementation
3. Vote parsing from mentions
4. Labeler for game posts
5. Feed generator (Cloudflare Worker)
6. Custom lexicon for structured game actions

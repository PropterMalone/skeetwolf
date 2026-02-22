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
- **Deployment target**: malone (`ssh malone` / `ssh malone-ts`) — AMD Ryzen 7 7730U, 32GB RAM, Ubuntu Server 24.04, Docker + Node.js 22. See `~/.claude/projects/C--Users-karls/memory/malone.md` for full details.

## Architecture

**FCIS (Functional Core, Imperative Shell)**

### Packages (npm workspaces)

```
packages/
├── shared/     # Functional core — types, pure game logic, role definitions
│   └── src/
│       ├── types.ts          # Game types (Player, Phase, Vote, NightAction, GameState, Queue, Invite)
│       ├── game-logic.ts     # Pure state machine (create, signup, roles, vote, night, win)
│       ├── queue-logic.ts    # Pure queue + invite logic (public queue, invite games)
│       └── index.ts
├── engine/     # Imperative shell — bot I/O, DB, game manager
│   └── src/
│       ├── bot.ts            # Bluesky posting, mention polling, DM interface
│       ├── db.ts             # SQLite persistence (serialized game state)
│       ├── game-manager.ts   # Bridges game logic with I/O
│       └── index.ts          # Entry point, polling loop
├── feed/       # Feed generator — per-game feed skeletons from SQLite
│   └── src/
│       ├── handler.ts       # Pure feed logic (createFeedHandler, listFeeds)
│       ├── handler.test.ts  # Feed handler tests
│       └── index.ts         # HTTP server (getFeedSkeleton, describeFeedGenerator, did.json)
└── labeler/    # ATProto labeler for game post tagging (future)
```

### Key Design Decisions

- **Game state is immutable** — all game-logic functions return new state, never mutate
- **DB stores serialized GameState** — simple JSON blob per game, no normalized tables yet
- **DMs via chat.bsky.convo** — bot-relay pattern (no group DMs on Bluesky), `DmSender` interface with live + console implementations
- **Phase timers** — `phaseStartedAt` on GameState, `manager.tick()` auto-transitions expired phases
- **Command parsing** — `parseMention` (public commands) + `parseDm` (night actions, mafia chat)
- **Reply threading** — bot replies thread under game announcement (root) with triggering mention as parent
- **Cursor persistence** — mention and DM poll cursors saved to `bot_state` table, survive restarts
- **Feed generator** — reads `game_posts` table from engine's SQLite, no labeler yet
- **Post recording** — engine records all game posts (announcement, phase, vote_result, death, game_over, player) to `game_posts` table
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
LIVE_DMS=1          # Enable real Bluesky DMs (default: console logging)
FEED_PORT=3001      # Feed generator HTTP port
FEED_HOSTNAME=      # Feed generator public hostname (for did.json)
FEED_PUBLISHER_DID= # DID for describeFeedGenerator
DB_PATH=            # Path to engine's SQLite DB (feed reads from this)
```

## Deployment

Docker Compose on malone. **Always commit before building** — `docker compose build` copies the working tree, so uncommitted changes silently ship (or silently don't). Run `npm run validate` then commit, then build.

```bash
docker compose build          # rebuild images
docker compose up -d           # start/restart
docker logs skeetwolf-engine-1 # check logs
```

The engine container runs as root; SQLite data lives in `./data/` (bind mount). After stopping the container, fix file ownership if needed: `sudo chown -R $(whoami) data/`.

## Testing

- Colocated: `foo.ts` → `foo.test.ts`
- Game logic is 100% pure functions — easy to test with injectable shuffle
- `noShuffle` helper in tests for deterministic role assignment

## Future Work (roughly ordered)

1. ~~Real DM sender (chat.bsky.convo)~~ ✓
2. ~~Phase timer implementation~~ ✓
3. ~~Vote parsing from mentions~~ ✓
4. ~~Feed generator~~ ✓
5. Labeler (pre-launch — lets non-players mute game posts)
6. Feed registration with Bluesky (publishFeed call)
7. Integration testing (end-to-end with real Bluesky posts)
8. Custom lexicon for structured game actions

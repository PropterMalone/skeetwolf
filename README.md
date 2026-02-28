# Skeetwolf

Forum Werewolf (Mafia) on Bluesky. An automated bot runs social deduction games entirely through posts and DMs — no external app needed.

**Bot:** [@skeetwolf.bsky.social](https://bsky.app/profile/skeetwolf.bsky.social)
**FAQ:** [malone.taildf301e.ts.net/skeetwolf/faq](https://malone.taildf301e.ts.net/skeetwolf/faq)

## How It Works

Mention the bot to queue up or start a game. The bot assigns roles via DM, manages phase transitions, and announces results publicly. All player interaction happens on Bluesky.

- **Public commands** (mentions): `queue`/`lfg` to join, `vote @player`/`unvote` during day phases
- **DM commands** (night actions): `kill`, `investigate`, `heal`, `shoot`
- **Game presets**: turbo (6h day / 3h night), standard (24h/12h), marathon (48h/24h)

## Roles

| Role | Team | Ability | Min Players |
|------|------|---------|-------------|
| Villager | Town | None | — |
| Cop | Town | Investigate one player per night | — |
| Doctor | Town | Protect one player per night | — |
| Mafioso | Mafia | Kill one player per night (coordinated) | — |
| Godfather | Mafia | Appears innocent to cop | — |
| Jester | Neutral | Wins if voted out during the day | 8 |
| Vigilante | Town | Shoot one player per night | 9 |

## Features

- **Queue system** — players queue up, game auto-starts at threshold
- **Invite system** — create private games with invited players
- **Per-game Bluesky feeds** — follow a game's posts in real time
- **Thread-per-day structure** — each day phase gets its own thread for clean discussion
- **Flavor text packs** — themed death/event messages
- **Dashboard** — spectate active games
- **Labeler integration** — filter game posts from your main feed

## Architecture

Monorepo with npm workspaces:

```
packages/
  shared/   — Pure game logic (types, state machine, role definitions)
  engine/   — Bot (Bluesky I/O, SQLite persistence, game manager)
  feed/     — Feed generator (per-game feed skeletons)
```

Game state is immutable — all logic functions return new state, never mutate. The functional core (`shared`) has zero I/O dependencies and is fully testable with deterministic shuffles.

Built on [propter-bsky-kit](https://github.com/PropterMalone/propter-bsky-kit) for all Bluesky I/O.

## Self-Hosting

The bot is live — you can just play by mentioning [@skeetwolf.bsky.social](https://bsky.app/profile/skeetwolf.bsky.social) on Bluesky. No need to self-host unless you want to run your own instance.

If you do want to run it yourself:

```bash
npm install
cp .env.example .env  # fill in BSKY_IDENTIFIER and BSKY_PASSWORD
npm run build
npm run dev
```

## License

[MIT](LICENSE) — study it, fork it, learn from it.

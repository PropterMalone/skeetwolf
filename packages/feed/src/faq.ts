/** Static FAQ page served at /faq */

export const FAQ_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skeetwolf — How to Play</title>
<style>
  :root { --bg: #0d1117; --fg: #e6edf3; --accent: #58a6ff; --dim: #8b949e; --card: #161b22; --border: #30363d; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem 1rem; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h1 span { color: var(--dim); font-weight: normal; font-size: 1rem; }
  h2 { color: var(--accent); font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  p, li { color: var(--fg); margin-bottom: 0.5rem; }
  ul { padding-left: 1.5rem; }
  code { background: var(--card); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; color: var(--accent); }
  .role { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 0.75rem 0; }
  .role strong { color: var(--accent); }
  .role .tag { display: inline-block; font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 4px; margin-left: 0.5rem; }
  .town { background: #1a4d2e; color: #3fb950; }
  .mafia { background: #4d1a1a; color: #f85149; }
  a { color: var(--accent); }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--dim); font-size: 0.85rem; }
</style>
</head>
<body>

<h1>🐺 Skeetwolf <span>Forum Mafia on Bluesky</span></h1>

<p>Skeetwolf is an automated <a href="https://en.wikipedia.org/wiki/Mafia_(party_game)">Werewolf/Mafia</a> game played through Bluesky posts and DMs. No moderator needed — the bot handles everything.</p>

<h2>Quick Start</h2>
<ul>
  <li>Mention <code>@skeetwolf.bsky.social queue</code> to join the public queue</li>
  <li>When 7 players are queued, the game starts automatically</li>
  <li>Check your DMs for your secret role</li>
  <li>Discuss during the day, vote to eliminate suspects, survive the night</li>
</ul>

<h2>How a Game Works</h2>
<p>Each game alternates between <strong>day</strong> and <strong>night</strong> phases:</p>
<ul>
  <li><strong>Night 0</strong> — Roles are dealt via DM. Cop investigates, doctor protects, mafia coordinates — but <strong>no kill</strong>. First kill happens Night 1. No public posts yet.</li>
  <li><strong>Day</strong> — The bot posts a public thread. Everyone discusses and votes. If a majority votes for someone, that player is eliminated and their role is revealed.</li>
  <li><strong>Night</strong> — The thread locks. Mafia chooses a target to kill (via DM). Cop and doctor submit actions via DM.</li>
  <li>Repeat until one side wins.</li>
</ul>

<h2>Win Conditions</h2>
<ul>
  <li><strong>Town wins</strong> when all mafia members are eliminated.</li>
  <li><strong>Mafia wins</strong> when mafia players equal or outnumber town players.</li>
</ul>

<h2>Roles</h2>

<div class="role">
  <strong>Villager</strong> <span class="tag town">Town</span>
  <p>No special abilities. Use discussion and deduction to find the wolves. Your vote is your weapon.</p>
</div>

<div class="role">
  <strong>Cop</strong> <span class="tag town">Town</span>
  <p>Each night, DM the bot a player's handle to investigate. You'll learn whether they're <em>town</em> or <em>mafia</em>. The Godfather is immune — they always appear as town.</p>
</div>

<div class="role">
  <strong>Doctor</strong> <span class="tag town">Town</span>
  <p>Each night, DM the bot a player's handle to protect. If the mafia targets that player, the kill is blocked. You cannot protect yourself.</p>
</div>

<div class="role">
  <strong>Godfather</strong> <span class="tag mafia">Mafia</span>
  <p>Leader of the mafia. Each night, DM the bot your kill target. You appear as <em>town</em> to cop investigations.</p>
</div>

<div class="role">
  <strong>Mafioso</strong> <span class="tag mafia">Mafia</span>
  <p>Mafia team member. Coordinate with your teammates through the bot's DM relay. If the Godfather is eliminated, you inherit the kill action.</p>
</div>

<h2>Commands</h2>
<p>All public commands are mentions of <code>@skeetwolf.bsky.social</code>:</p>
<ul>
  <li><code>queue</code> or <code>lfg</code> — Join the public queue</li>
  <li><code>unqueue</code> — Leave the queue</li>
  <li><code>queue?</code> — Check queue status</li>
  <li><code>vote @handle</code> — Vote to eliminate someone (during day phase)</li>
  <li><code>unvote</code> — Retract your vote</li>
</ul>
<p>Night actions are sent as DMs to <code>@skeetwolf.bsky.social</code>:</p>
<ul>
  <li><code>kill @handle</code> — Mafia kill target</li>
  <li><code>investigate @handle</code> or <code>check @handle</code> — Cop investigation</li>
  <li><code>protect @handle</code> or <code>save @handle</code> — Doctor protection</li>
</ul>

<h2>DM Setup</h2>
<p>The bot sends roles and night results via DM. For this to work, you need to <strong>follow @skeetwolf.bsky.social</strong> so it can message you. If your DM settings are restricted, the bot won't be able to reach you.</p>

<h2>Game Feeds</h2>
<p>Each game gets its own Bluesky feed containing all game posts. You can follow your game's feed to keep track without cluttering your main timeline.</p>
<p>If you want to hide Skeetwolf posts from your timeline entirely, subscribe to the <a href="https://bsky.app/profile/skeetwolf-labels.bsky.social">Skeetwolf labeler</a> and set it to hide.</p>

<h2>Tips</h2>
<ul>
  <li>Mafia members can coordinate through the bot — DM the bot and your message is relayed to your teammates.</li>
  <li>The Godfather appears innocent to the cop. Don't assume a "town" result means someone is safe.</li>
  <li>Days have a time limit. If no majority is reached, no one is eliminated — which generally favors the mafia.</li>
  <li>Pay attention to who's voting for whom and who's avoiding commitment.</li>
</ul>

<h2>Invite Games</h2>
<p>Want to play with specific people? You can create a private invite game:</p>
<ul>
  <li><code>new game @player1 @player2 @player3 ...</code> — Create an invite game</li>
  <li><code>confirm #gameid</code> — Accept an invite</li>
  <li><code>cancel #gameid</code> — Cancel a game you created</li>
</ul>
<p>The game starts once enough players have confirmed.</p>

<footer>
  <p>Skeetwolf is open source: <a href="https://github.com/PropterMalone/skeetwolf">github.com/PropterMalone/skeetwolf</a></p>
  <p>Run by <a href="https://bsky.app/profile/proptermalone.bsky.social">@proptermalone.bsky.social</a></p>
</footer>

</body>
</html>`;

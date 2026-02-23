/** Shared HTML shell for all dashboard pages. CSS reuses FAQ color scheme. */

export function layout(title: string, body: string, autoRefreshSeconds?: number): string {
	const refreshMeta = autoRefreshSeconds
		? `<meta http-equiv="refresh" content="${autoRefreshSeconds}">`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshMeta}
<title>${title} — Skeetwolf</title>
<style>
  :root { --bg: #0d1117; --fg: #e6edf3; --accent: #58a6ff; --dim: #8b949e; --card: #161b22; --border: #30363d; --green: #3fb950; --red: #f85149; --blue: #58a6ff; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem 1rem; max-width: 900px; margin: 0 auto; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h1 span { color: var(--dim); font-weight: normal; font-size: 1rem; }
  h2 { color: var(--accent); font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  nav { margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border); display: flex; gap: 1.5rem; align-items: baseline; }
  nav a { font-size: 0.95rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--dim); font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge { display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 600; }
  .badge-day { background: #1a4d2e; color: var(--green); }
  .badge-night { background: #1a3a5c; color: var(--blue); }
  .badge-signup { background: #3d2e00; color: #d29922; }
  .badge-finished { background: #21262d; color: var(--dim); }
  .badge-town { background: #1a4d2e; color: var(--green); }
  .badge-mafia { background: #4d1a1a; color: var(--red); }
  .badge-alive { color: var(--green); }
  .badge-dead { color: var(--dim); text-decoration: line-through; }
  .empty { color: var(--dim); font-style: italic; padding: 1rem 0; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 0.75rem 0; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9em; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--dim); font-size: 0.85rem; }
</style>
</head>
<body>

<h1><a href="/">Skeetwolf</a> <span>Dashboard</span></h1>
<nav>
  <a href="/">Home</a>
  <a href="/stats">Leaderboard</a>
  <a href="/faq">How to Play</a>
</nav>

${body}

<footer>
  <a href="https://bsky.app/profile/skeetwolf.bsky.social">@skeetwolf.bsky.social</a> &middot;
  <a href="https://github.com/PropterMalone/skeetwolf">Source</a>
</footer>

</body>
</html>`;
}

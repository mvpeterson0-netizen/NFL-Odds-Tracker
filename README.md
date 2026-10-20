# NFL Prop Tracker (2026)

A research site for NFL player props. For each team's QB1, RB1–2, WR1–3 and TE1–2 it shows, game by game,
the pre-game prop line (captured ~3 hours before kickoff), the odds, the actual result, and over / under / push / void,
plus snap share and targets. Deeper analysis (rolling averages, hit rates, line moves, implied vs. actual) is one click away.

Real data only. Anything unavailable is labeled ("no data", "not collected", "no pre-game line", "reason unknown").

## How the automation works

One GitHub Actions workflow (`.github/workflows/update.yml`) runs every 15 minutes (at :08, :23, :38, :53).
Each run:

1. **Schedule** – refreshes the 2026 schedule from nflverse (only re-downloads when nflverse updates it).
2. **Props** – for any game kicking off within 3.5 hours that has no line yet, calls The Odds API once:
   DraftKings and FanDuel, player props for that game. The target window is 2.5–3.5 h before kickoff;
   if no run lands in it, the next run before kickoff takes the pull and its real capture time is stored.
   Nothing is pulled at or after kickoff. A game with no successful pull is logged as missed and shows
   "no pre-game line".
3. **Quota guard** (free plan, 500 credits/month) – the 5 core markets (pass yds, rush att, rush yds,
   receptions, rec yds) are always requested. QB pass attempts and completions are added only when the
   remaining credits still cover the core markets for every remaining game that month plus a reserve.
   Each pull logs the real credit cost and balance returned by the API.
4. **Stats and grading** – when nflverse publishes new stats, snaps, injuries, depth charts or rosters,
   the site data is rebuilt: slots are computed, props graded, missing-data reasons attached.
5. **Log and publish** – every run appends a line to `data/runs/YYYY-MM.csv` and commits it. If the site data
   changed, the site is redeployed to GitHub Pages. A failed run is retried by the next scheduled run.
   Each run also re-enables the workflow, so GitHub's 60-day inactivity shutdown cannot stop it in the off-season.

The site shows the time of the last successful run (read live from GitHub) and a warning banner if the
last success is more than 75 minutes old or the latest run failed.

## Data sources

| Data | Source |
|---|---|
| Pre-game lines and odds | [The Odds API](https://the-odds-api.com) – DraftKings, FanDuel |
| Weekly player stats | nflverse `stats_player` |
| Snap counts | nflverse `snap_counts` (Pro Football Reference) |
| Injury reports | nflverse `injuries` (official NFL report) |
| Depth charts | nflverse `depth_charts` (ESPN, timestamped snapshots) |
| Rosters / inactive status | nflverse `weekly_rosters` |
| Schedule | nflverse `schedules` |

nflverse data is CC-BY 4.0: https://github.com/nflverse/nflverse-data

## Slots

Computed per team per week from pre-game information only, frozen at kickoff:

- Latest ESPN depth chart snapshot before kickoff (via nflverse)
- Average offensive snap share over the player's last 3 games played for the team
- That week's injury report: Out players excluded, Doubtful ranked last; reserve-list players excluded
- RB/WR/TE score = 0.6 × snap % + 0.4 × depth points (rank 1 = 100, rank 2 = 80, …); no snaps yet = 0.6 × depth points
- QB1 = highest-ranked QB on the depth chart who is not Out (Doubtful ranked last)

When a slot changes from the prior week, the change and its reason are shown.

## Grading

- Over / under / push: actual stat vs. the stored pre-game line.
- Void: the player had a line but did not play (no snaps and no stats). The reason comes from the weekly roster
  (inactive / reserve) and the official injury report; otherwise "reason unknown".
- A player who logged snaps but no stat line is graded with 0 and labeled.
- Primary line: DraftKings; FanDuel when DraftKings has none. Both are stored.

## Files

| Path | What it holds |
|---|---|
| `data/prop_captures.csv` | Every captured line (append-only; the irreplaceable data) |
| `data/pull_log.csv` | Every pull attempt, its status, timing and API credit cost |
| `data/slots.csv` | Weekly slots with basis and change notes |
| `data/runs/` | One line per scheduled run |
| `site/` | Static site (GitHub Pages); `site/data/data.json` is generated |
| `pipeline/` | Python, standard library only |

Captured lines are stored as CSV in the repo rather than a SQLite file so every change is a readable diff.

## Setup

1. Repo secret `ODDS_API_KEY` (Settings → Secrets and variables → Actions).
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions tab → `update` → **Run workflow** once.

Run locally: `python -m pipeline.run` (set `ODDS_API_KEY` to pull props; `FORCE_BUILD=1` to rebuild).

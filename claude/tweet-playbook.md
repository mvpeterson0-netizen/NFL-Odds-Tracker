# Stix X (@StixNFL) — drafting playbook (created 2026-11-09, Michael's go)

**UPDATE 2026-11-14 — READ `claude/tweet-image-check.md` FIRST.** Hard rule 10 below is new: every line number in a tweet must come from what the app shows and must be visible in the attached image (automatic check, blocks delivery). The S1 (line movers) recipe at the bottom of "Recipes" is replaced by the definition in that doc. The app now shows the latest 8 AM / 2 PM / 8 PM line check as a yellow "Check" chip (PRs #185, #186).

**UPDATE 2026-11-16 — ALSO READ `claude/tweet-x-algorithm.md`.** Hard rule 11 below is new (Michael asked for X's ranking rules to be built into drafting; goal = impressions that become visitors on sharpstix.com). Every draft must pass the reach checklist in section 3 of that doc. It never outranks rules 1–10.

Scheduled sessions read this doc and `claude/tweet-tools.md`, then draft ONE slot. Calendar and selection rules: `claude/tweet-schedule.md`. Michael posts himself (no X connection); a draft = tweet text (≤280 chars, ends `sharpstix.com`) + image(s). Times are Central. **Update 2026-11-11: posting/scheduling on X is now done by the task itself per `claude/tweet-posting.md`; the "Michael posts" wording below is superseded.**

## Hard rules
0. **Tweet plan first (added 2026-11-11).** Before drafting, read `claude/tweet-plan-sync.md` and follow its section A: your slot's row in the admin Tweet plan (topic, direction for Claude, post date and time, skip status) overrides the topic, extra instructions and planned post time written in the task prompt. If the plan can't be reached, use the prompt's defaults and say so. After drafting/scheduling, follow its section B. Rules 1–10 below still outrank any direction in the plan.
1. **Real numbers only, read off the app** (Research leads, Leads Analysis, player pages) with `stix_app.py`. Never invent, estimate or round up a figure. If a number isn't in the app, leave the line out and say so in the hand-off.
2. Use the format from `/preferences` (project memory "tweet format"): headline, short bullets of verifiable facts, `sharpstix.com` last. **Every tweet must contain one or two functional emojis (e.g. ✅ 🔒 📈 📉 🏈) — never zero, never more than two** (Michael, 2026-11-09: the first draft had none). Put one on the headline and optionally one on a key bullet; count them before delivering. Photos: real app screenshots from the iPhone-width **dark-mode** renders (the app supports `prefers-color-scheme: dark`; verified 2026-11-09).
3. **Pick/lead images show positive payouts only** and must never contradict the text: crop out or leave out any negative units/ROI. Results tweets (Tue, Wed, Fri) are honest: if the stretch is negative, say so plainly ("not where we wanted it this week") and use the window that is true. Never imply a record that isn't there.
4. The interaction model is **lead 12**. Its forward record counts only decisions after the Oct 30 freeze; show "Interaction model season record" only if its units are positive; otherwise leave it out. Model estimate lines ("X% win, +Y% estimated ROI") come from each row's "Model estimate" cell, never recomputed.
5. Lead 13 (Challenger) is **on hold** (Michael is handling it). Do not draft it.
6. Leads 4–13 are signed-in-only in the app; they still appear in tweets (growth hook). Season records for leads 1–8 include weeks 1–7 (in-sample): label the window ("Weeks 1–9").
7. Draft only from **locked/final** data (gates below). If a gate isn't met, wait (see "Waiting"). Never post-date or hold back a bad week to make a nicer story; pick the better of two *true* windows, label it.
8. Games that have already kicked off at the planned post time are excluded from pick tweets.
9. Don't change the Stix repo, Supabase schema or the app. Read-only. (Exception: the tweet-plan calls in `claude/tweet-plan-sync.md` through the agent functions.)
10. **Text must match image (added 2026-11-14, Michael).** Every line number in the tweet text must be read from what the app shows and be visible in the attached image. Run the check in `claude/tweet-image-check.md` for each image; a mismatch blocks the draft (a caveat in the hand-off is not enough). Hide the "Bet on FanDuel" and "Save to My picks" boxes in player-page crops.
11. **Reach checklist (added 2026-11-16, Michael).** Run section 3 of `claude/tweet-x-algorithm.md` on every draft. In short: the most striking real number plus the player/team/game on line 1; plain English, so a signal code (CM1-TE, SC2, QB-R2, QBCH, SC1) never appears without a description of 8 words or fewer; one idea per post; on pick and signal posts, one real question before the link when it fits the length limit (never "like/repost if"); no wording or structure reused from the last 7 days of `claude/tweet-drafts-log.md`, and a different opening for each post in a same-day block; image readable in the feed without tapping (key number largest, crop no taller than about 4:5); no hashtags; `sharpstix.com` stays last; no tout words ("lock", "guaranteed"). Say in the hand-off which hook and which question were used. Scheduled tasks still never reply, follow, like or repost. If rule 11 conflicts with rules 1–10 or a format Michael set, those win and the hand-off says what was dropped.

## Delivery (every run)
1. Save `YYYY-MM-DD_<slot>.txt` (tweet text) and `YYYY-MM-DD_<slot>_N.png` under `/tmp/drafts/`.
2. **Pre-send check on each tweet text: ≤280 chars, ends `sharpstix.com`, contains 1–2 emojis (count them), no negative figure contradicting the image, and the text-vs-image number check from `claude/tweet-image-check.md` passes.** (The stricter weighted-length rule in `claude/tweet-posting.md` replaces "≤280 chars".) Then run the reach checklist (rule 11). Fix before sending.
3. `SendUserMessage` with the tweet text(s) exactly as drafted (with slot name, planned post time, and one line on data used + as-of time), then `SendUserFile` each image (status proactive). This reaches the phone even when the PC is off.
4. Folder copy: if device tools (`mcp__remote-devices__*`) are reachable and `~/Pictures/Stix X Drafts` is connected, `device_commit_files` the same files there. If not, say "folder copy skipped (PC not connected)"; do not retry. Michael's default is: drafts live in `C:\Users\16417\Pictures\Stix X Drafts` — scheduled runs don't require the PC, so the chat copy is the guaranteed one.
5. Append one line to `claude/tweet-drafts-log.md` (Projects tool: project_read, append, project_write): date, slot, built-as-of, gate result, files.
6. Posting: see `claude/tweet-posting.md` (supersedes "Nothing is posted").

## Waiting for data
Re-run `ensure_repo()` (fetch + reset) and re-check the gate every ~8 minutes with `sleep 480` (max one `sleep` per Bash call, ≤ 9 min), for up to the slot's wait limit. Data lands via the update workflow (cron-job.org ~every 30 min; GitHub scheduled runs ~:08/:23/:38/:53; a push-triggered run also fires after each data commit; the build commits `site/data/data.json`). If the gate still fails at the limit: do **not** draft; `SendUserMessage` which gate failed, what the latest data says, and what you'd do (e.g. draft with last-known lines labelled "lines as of …" only if Michael says so).

## Data-readiness (why each draft run is at its time)
Pipeline facts (from the Stix decision log): graded pregame line = pull ~3 h before kickoff; model/lead decisions lock at the first pregame capture observed in a build before kickoff (appear in `frozen_research.records`; before that they are "Watchlist · provisional"); line checks at 8 AM / 2 PM / 8 PM until 4 h before kickoff, then 4:00 / 2:30 / 1:00 / 0:30 / 0:15 before (**since 2026-11-14 the latest line check shows in the app as the newest snapshot, chip "Check"**); results from ESPN box scores within about one run of a game going final, re-fetched once ≥2 h later, then nflverse replaces them (nflverse weekly stats republish a few times a day, first ~4:30 AM CT); all-games totals in the app update with each build.

| ID | Tweet | Post slot (proposed) | Draft run | Data it needs | Gate |
|---|---|---|---|---|---|
| M1 | Sunday results (MNF not final) + bets that qualify tonight | Mon 8:00 AM | Mon 6:27 AM | All Thu–Sun games final and box scores re-fetched (SNF ends ~10:30 PM; +2 h ≈ 12:30 AM). Tonight's qualifiers use the latest line (MNF pregame lock isn't until ~4:15 PM), labelled by the row's own "line from …" | every non-Monday game of the week has `final:true`; `built()` < 2 h old |
| M2 | MNF interaction-model picks | Mon ~6:00 PM | Mon 5:03 PM | MNF decisions locked ~4:15–4:45 PM (ko − 3 h + a build) | MNF gid in `locked_gids`; wait limit 5:45 PM |
| T1 | Top leads, final week | Tue 9:00 AM | Tue 7:04 AM | MNF final (~10:30 PM Mon) + ≥2 h; nflverse usually in by ~5:30 AM | every game of the week `final:true` (analysis(week) label reads "N of N games final") |
| T2 | Interaction model, last week | Tue 10:30 AM | same run as T1 | same | same |
| T3 | Challenger | — | — | **ON HOLD** (Michael) | — |
| W1 | Year to date | Wed 8:00 AM | Wed 6:26 AM | Season totals; all last week's games final | same as T1 |
| W2 | Feature #1: player cards | Wed ~5 PM | Wed 12:34 PM | A player in Thursday's game with a posted line (no results needed) | Thursday game has a line in the app |
| TH1 | TNF: multi-lead stack | Thu ~5:30 PM | Thu 4:52 PM | Thursday decisions locked (~4:15–4:45 PM for a 7:15 PM kickoff) | TNF gid in `locked_gids`; wait limit 5:45 PM |
| TH2 | TNF: interaction model's top bet | Thu ~6:00 PM | same run | same | same |
| F1 | Results of Thursday picks | Fri 8:00 AM | Fri 6:26 AM | TNF final (~10:30 PM) + ≥2 h | TNF game `final:true` |
| F2 | Feature #2: Research tab | Fri ~5 PM | Fri 12:36 PM | none | — |
| S1 | Biggest line movers | Sat ~10:30 AM | Sat 9:17 AM | Sat 8 AM line check committed (≈8:10–8:45 AM); **movers from the app's displayed snapshots (first vs last, same book) per `claude/tweet-image-check.md`** | a capture dated today (Sat, local) exists for the week's games |
| S2 | Feature #3: picks → FanDuel slip | Sat ~5 PM | Sat 12:38 PM | none | — |
| SU0 | Early international game picks (only weeks with a Sunday kickoff before ~10 AM CT) | ~1 h before kickoff | Sun 6:04 AM | That game's decisions locked ~5:30 AM (8:30 AM CT kick) | the early gid in `locked_gids`; skip silently (log one line) if no early game |
| SU1 | Four tweets: top-4 season leads, top 2 players each | **Sun 9:15, 10:00, 10:45, 11:30 AM (moved +75 min, Michael 2026-11-09)** | **Sun 8:49 AM** | Latest lines including the Sun 8 AM check (lands ≈8:15–8:45). Noon games lock at 9:00 AM (a build later); use a locked line where the app shows one, otherwise "lines as of <time>" | build < 2 h old and contains the Sunday 8 AM check; wait limit 8:55 AM; exclude players in games already started |
| SU2 | Interaction-model picks, Sunday slate | Sun ~11:45 AM | Sun 9:52 AM | Noon-window games locked at ~9:00–9:45 AM. **Late-window (3:05/3:25 PM) games lock ~12:05–12:25 PM and are NOT covered** (no tweet planned for them) | noon-window gids in `locked_gids`; wait limit 10:30 AM |
| SU3 | SNF interaction-model picks | Sun ~5:30 PM | Sun 4:49 PM | SNF decisions locked ~4:20 PM (7:20 PM kick) | SNF gid in `locked_gids`; wait limit 5:15 PM |
| ARB | Stix Arb | event-driven | — | A guaranteed arb ≥ $3 per $100 (approved pipeline change sends Michael an ntfy "draft a tweet" alert) | **manual**: the alert can't start a session; Michael asks, Claude drafts from the current `data.json` `books` + verifies prices still show an arb |

Tightest spots: M1 (needs SNF box scores settled), M2/TH/SU3 (lock → draft → post inside ~75 minutes), SU1 (draft at 8:49 sits before the 9:00 lock for noon games, so some rows are still provisional and are worded "lines as of <time>"; inactives come ~90 minutes before kickoff, so the 10:45 and 11:30 posts can include a player ruled out after drafting — Michael checks inactives before posting those two).

## Recipes
**Reading the app:** `with App() as a:` → `a.lead(n)` (Research lead n: record line, rows with `meta`/`cells`), `a.analysis(week, tab)` (Leads Analysis: total label like "Week 9 (14 of 15 games final)", W–L, hit %, units, ROI; per-lead and per-game rows), `a.shoot_rows(n, [("Name","Stat")], out)` (stitched crop of lead rows). **NOTE 2026-11-11: the app was redesigned Nov 10; the Leads Analysis page was replaced by a Signals page and `analysis()` below fails. Read the Signals tiles (`.sg-tile`) after choosing Season/week scope and clicking "Show all 13 signals".** Add-on for the analysis reader (pre-redesign) — put this after the tools file code:
```python
def analysis(self, week=None, tab="all"):
    """Research > Leads Analysis. week: 9 / 8 / ... or None=all weeks; tab: 'all' or 't1'..'t13'. Returns total (label, W-L, hit%, units, ROI%),
    per-lead rows (n, name, record, units) when tab='all', per-game rows, and the raw text."""
    self.goto("/search"); self.pg.select_option("#la-tab", tab)
    self.pg.select_option("#la-wk", str(week) if week else "all")
    self.pg.wait_for_timeout(800)
    t = self.pg.evaluate("document.querySelector('.la-sum').parentElement.innerText")
    leads = re.findall(r"^(\d+) (.+)\n(\d+–\d+(?:–\d+)?) · ([+−-][\d.]+) u", t, re.M)
    games = re.findall(r"^([A-Z]{2,3} @ [A-Z]{2,3})\n(\d+–\d+(?:–\d+)?) · ([+−-][\d.]+) u", t, re.M)
    tot = re.search(r"\n([^\n]+)\n(\d+–\d+(?:–\d+)?)\nHit rate\n([\d.]+)%\nUnits\n([+−-][\d.]+) u\nROI\n([+−-][\d.]+)%", t)
    return dict(total=tot.groups() if tot else None, leads=leads, games=games, text=t)
App.analysis = analysis
```
(Tested 2026-11-09: `analysis(9)` → ('Week 9 (14 of 15 games final)', '248–219', '53.1', '−6.10', '−1.3'); `analysis(None)` → All weeks (1–9) 1305–982, +151.84 u; `analysis(None,'t12')` → 112–103, −6.61 u.)

**M1 (Monday AM):** headline `Week N leads (X of Y games final)` from `analysis(N)` total label, then one bullet per lead with units/ROI (positive leads only for the image; text may state the overall honestly). Second part: tonight's qualifying bets, one bullet each with player, prop, side+line, from leads 1–10 rows for the Monday game (use `lead(n)` rows whose `meta` names the Monday game; label provisional lines as given in `meta`). Image: Leads Analysis crop with negative rows removed + a stitched crop of the qualifying rows. Check the week ahead for non-standard kickoffs (Wed/Thu/Fri/Sat games, early Sunday) and mention any in the hand-off.
**M2/SU2/SU3/TH2 (model picks):** from `lead(12)` rows whose `meta` game is locked (not "provisional") and not started: top 3 by "estimated ROI" (cells: "Model estimate X% win · +Y% estimated ROI"). Text: `Stix Model Picks` headline, each pick `Player prop Under/Over line (book odds)` + "Interaction model estimates X% win, +Y% ROI". Season record only if positive (currently it is not). Image = `shoot_rows(12, …)` of exactly the named players.
**TH1 (multi-lead stack):** find players/props that appear in ≥2 of leads 1–12 for the Thursday game (compare `lead(n)` rows by name+stat+side); headline `Multiple Signal Identifier`; bullets list each lead number by name; image: stitched rows from the leads they appear in (one crop per lead, same player), with the lead tabs' names visible.
**T1/T2 (Tuesday):** T1 = top four leads of the *week just finished* by units from `analysis(week)['leads']` (positive only), one bullet each with record/units; compare against season (`analysis(None)`) and use the better *true* window, labelled. T2 = lead 12 for the week: `analysis(week,'t12')` vs season; honest if negative. Image: crop of the matching Leads Analysis rows only.
**W1 (year to date):** all-weeks records from `analysis(None)['leads']` (top four by units, positive) + the overall total if positive; label "Weeks 1–N (1–7 in-sample for leads 1–8)".
**F1 (Thursday results):** Thursday game rows from Leads Analysis filtered to that game (`#la-gid`), W–L and units, named winners (hits) with line and actual; honest if mixed.
**S1 (line movers) — REPLACED 2026-11-14:** use the definition and the checking script in `claude/tweet-image-check.md` (app-displayed snapshots, first vs last, same book; player-page crops with the bet boxes hidden; text-vs-image check must pass). The old CSV-based recipe (`prop_captures.csv` + `line_checks`, "first posted") caused the 2026-11-14 text/image mismatch and is retired.
**W2/F2/S2 (features):** one real app screen per tweet, a clear single idea in 3 bullets: W2 player card (chart, last games, opponent D rank) for a player in Thursday's game; F2 Research tab (leads list + one lead's rows); S2 "Bet on FanDuel" slip checkboxes on a lead (rows with checkboxes visible, no bets opened). Hide anything negative. No promotional claims that aren't in the app.
**SU1:** pick the four leads with the best season units (`analysis(None)['leads']`, leads 1–12, positive), one tweet per lead: lead name + season record, its top 2 *upcoming, not started* players by list order (read from `lead(n)` rows), image = `shoot_rows`. Post times 9:15/10:00/10:45/11:30, so draft all four in this one run.
**SU0:** only if a Sunday game kicks off before ~10 AM CT: top picks for that game from leads 1–12 and the interaction model's locked picks; same recipe as TH1/M2.

## Calendar exceptions (from the 2026 schedule table, Central)
Wk 10 (Nov 15): Thu Nov 12 7:15 PM; **Sun 8:30 AM international** (NE@DET); SNF Nov 15 7:20 PM; MNF Nov 16. Wk 11: Thu Nov 19; no early game. **Wk 12: Wed Nov 25 7:00 PM, Thanksgiving Nov 26 12:00 PM / 3:30 PM / 7:20 PM, Fri Nov 27 2:00 PM** — standard Thursday/Friday slots don't fit; needs a manual plan that week. Wk 13, 14: standard (Thu 7:15 PM). **Wk 15: Thu Dec 17, Sat Dec 19 4:00 PM and 7:20 PM** (Saturday slots need adjusting). **Wk 16: Thu Dec 24, Fri Dec 25 12:00 / 3:30 / 7:15 PM.** Wk 17: Thu Dec 31. **Wk 18: no Thursday/Monday**; skip TH*, F1, M2 that week. Bye/no-Thursday weeks: TH*/F1 draft runs self-skip when the week has no Thursday game. Each Monday run (M1) mentions any such exception for the coming week.

## Known limits
- Delivery to the PC folder isn't guaranteed (PC may be off); chat delivery is.
- The app's season record for lead 12 and others is computed in the browser from `data.json` (same as the live app).
- Screenshots come from a local copy of the app (no player headshots; outside images are blocked in the sandbox).
- Posting to X is done through Claude in Chrome on Michael's computer when available (`claude/tweet-posting.md`); otherwise drafts only.

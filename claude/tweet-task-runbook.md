# Stix tweet task runbook (created 2026-11-17, Michael's request)

**Why this doc exists.** Every scheduled Stix tweet task used to carry its own long copy of the rules, so when the plan, the content focus or the playbook changed, prompts went stale (2026-11-17: the T1 task still said "T2 is retired, do not draft it", no T2 task existed, and T2 was never drafted at 7:04). Now each scheduled task prompt is a short pointer: **"you are slot X: read this runbook, follow Common and the section for slot X."** To change how any tweet is drafted, edit this doc (or the docs it points to). No scheduled-task prompt edit is needed.

**What reflects what**
- Michael edits a tweet in the app's Tweet plan tab (topic, direction, date, time, status): saved at once; every task reads its row when it runs (Common step 1), so the row wins over anything here.
- Michael adds a tweet in the app: the **plan dispatcher** (section DISPATCH) drafts it when its post time is within 3 hours.
- Michael deletes a tweet in the app: the daily roll and the tasks must not bring it back (known-rows list, below).
- Michael moves a tweet's time so the slot's normal draft run would be too late: the dispatcher drafts it.
- Michael changes the content focus, calendar, rules or a recipe: edit the doc; the next run uses it.
- The app cannot push to Claude; Claude checks the plan on its schedule (per-slot runs, daily roll at 5:41 AM CT, dispatcher hourly 6 AM-10 PM CT).

## Common (every run, every slot)
**0. Never.** Reply, follow, like or repost. Post to X except by Claude in Chrome per `claude/tweet-posting.md` when those tools exist (cloud runs: they don't; that is normal, not a failure). Change the repo, database, app or any scheduled task. Touch a row with status `Posted`. Invent or round a number. Use the retired interaction model (T11/T12) or the Challenger (13); never review register section C.
**1. Plan row first.** Read `claude/tweet-plan-sync.md` (sections A, B, D; connection, token, functions). Call `tweet_agent_pending`; find your row (`slot_key = <Central post date>_<slot>`; the first row of that slot dated today or later if the exact key is missing).
  - Status `Failed / skipped` or `Manual`: log one line, say "<slot> skipped per tweet plan", stop. `Posted`: stop. A pending `delete` request on the row: stop.
  - Status `Drafted (chat only)` or `Scheduled on X`: already drafted: stop (a redraft is only done by the redraft task or when Michael asks). Exception: the row's `last_result` starts "NEEDS REDRAFT".
  - `last_result` starting "Dispatcher drafting" within the last 30 minutes: another run has it: stop.
  - **Row missing:** check `claude/tweet-plan-known-rows.md`. If the key is listed there, Michael deleted it: do not recreate or draft; log one line; stop. If it is not listed, add it with the section-C defaults (`tweet_agent_add_row`) and go on.
  - Topic, direction and post date/time on the row override this runbook and the prompt (within the hard rules). Say in the hand-off which direction parts you followed or could not.
**2. Read the rules.** `claude/tweet-playbook.md` (hard rules 0-11), `claude/tweet-x-algorithm.md` section 3 (reach checklist), `claude/tweet-image-check.md`, `claude/tweet-content-focus.md` (pillars, calendar, link test), `claude/tweet-posting.md` (LENGTH RULE: weighted <= 260; URL 23, emoji 2, non-ASCII 2), `claude/tweet-tools.md` (helper code to `~/tweet-tools/stix_app.py`), the project memory `/preferences` (tweet format), and the last 7 days of drafts logs (`claude/tweet-drafts-log.md` plus the dated `claude/tweet-drafts-log-YYYY-MM-DD.md` files) so no wording or structure repeats.
**3. App notes (verified 2026-11-17).** The app was redesigned Nov 10: the Leads Analysis page, `analysis()`, `lead()` and `data-rtab` are gone. Signals page `#/search`: tiles `.sg-tile[data-sig=<id>]` (record, ROI, "N next wk"), click a tile to list "Players who fit this signal" (`.rlrow`, hide `.rl-ck`), the tile's `.rinfo[data-rinfo]` "i" opens the app's own plain-English rule + audit replay + 95% interval popup (`.share-box`). Reload via `about:blank` between tile clicks. Run with `TZ=America/Chicago`. Player pages `#/player/<pid>`; Indicators `#/search/indicators`; Results `#/results`; Arbitrage tab. Playwright launches either `/usr/bin/google-chrome` or the bundled chromium; use whichever starts. `lead()`/`shoot_rows()` in tweet-tools.md may fail: use `.rlrow` and element screenshots.
**4. Gates.** Data build under ~2 h old (`Data built N min ago`). Wait per the slot section (re-fetch every ~8 min, one `sleep` per Bash call). If the gate fails at the limit: do not draft; SendUserMessage what failed; set the row `last_result`; stop.
**5. Draft.** Follow the slot section. Hard rules: real numbers read off the app and visible in the image (text-vs-image check, `claude/tweet-image-check.md`); 1-2 emojis; weighted <= 260; ends `sharpstix.com` on odd dates (link test through 2026-11-30: even dates leave the link out and Michael self-replies it); no hashtags, no tout words; label the window on any record ("2026 weeks 1-10"); signals are historical replays, forward tracking starts Week 11 (0 forward bets before Thu 2026-11-19); signal codes never appear without a description of 8 words or fewer; honest in down weeks.
**6. Deliver.** `SendUserMessage` (tweet text exactly, planned post time, data as-of, weighted length, hook, question, link arm, anything dropped) and `SendUserFile` for each image. Save in the app: `tweet_agent_save_draft` (section D). Update the row (section B): status `Drafted (chat only)`, `draft_run`, `last_result` (one line; add "not scheduled on X: Chrome tools unavailable" when so). If Chrome tools exist, schedule per `claude/tweet-posting.md`, else skip silently. Append one line to today's dated log `claude/tweet-drafts-log-<YYYY-MM-DD>.md` (project_read, append, project_write; create it if missing).
**7. If something is wrong with the plan itself** (non-standard week, request needing Michael): SendUserMessage once. Otherwise stay quiet.

## Default slots (Central; the plan row's time wins)
| Slot | Task run (draft) | Planned post | Wait limit |
|---|---|---|---|
| M1 | Mon 6:27 AM | Mon 8:00 AM | 8:00 AM |
| M2 | Mon 5:03 PM | Mon ~6:00 PM | 5:45 PM |
| M3 | Mon 11:03 PM | soon after | 12:20 AM |
| T1 | Tue 7:04 AM | Tue 9:00 AM | 8:15 AM |
| T2 | Tue 7:34 AM | Tue 10:30 AM | 9:30 AM |
| W1 | Wed 6:26 AM | Wed 8:00 AM | 7:30 AM |
| W2 | Wed 12:34 PM | Wed ~5:00 PM | none |
| TH1, TH2 | Thu 4:52 PM | Thu 5:30 / 6:00 PM | 5:45 PM |
| F1 | Fri 6:26 AM | Fri 8:00 AM | 7:30 AM |
| F2 | Fri 12:36 PM | Fri ~5:00 PM | none |
| S1 | Sat 9:17 AM | Sat 10:30 AM | 10:00 AM |
| S2 | Sat 12:38 PM | Sat ~5:00 PM | none |
| SU0 | Sun 6:04 AM | ~1 h before an early kickoff | 6:45 AM |
| SU1 (a-d) | Sun 8:49 AM | 9:15 / 10:00 / 10:45 / 11:30 AM | 8:55 AM |
| SU2 | Sun 9:52 AM | Sun ~11:45 AM | 10:30 AM |
| SU3 | Sun 4:49 PM | skip (retired) | |
Non-standard weeks (Thanksgiving, Wk 15 Saturday games, Wk 16 Christmas, Wk 18): see the playbook's calendar exceptions; the roll lists the rows it cannot make.

## Slot sections
**M1 (Mon, Sunday recap + tonight's plan).** Headline `Week N signals (X of Y games final)`; Week N = the week with Sunday games just played. Gate: every non-Monday game final, build < 2 h. Read Wk N per-signal records from the Signals tiles' weekly rows; one bullet per signal (positive for the image; text honest); then tonight's qualifying plays (Signals players in the Monday game), one bullet each with prop and line, ending with a FanDuel-slip line ("Add them to your FanDuel slip from the app."). List non-standard kickoffs next week in the hand-off. Pillars 2 and 4.
**M2 (Mon ~6 PM, player card).** Player card for a starter in Thursday's game with a posted line (Monday snapshot); see W2 recipe. The interaction model is retired: never draft model picks. Pillar 1. If no Thursday game this week, log and stop.
**M3 (Mon night).** Retired with the interaction model (there are no M2 pick lines to grade). Log one line and stop, unless the row's direction asks for something else.
**T1 (Tue, signal results).** Starts with which signals and indicators are current and when each was theorized (register `claude/frozen-signal-register.md` sections A and B only), then how they are doing. Use today's 6:55 AM report in `claude/frozen-signal-report-log.md` rather than recomputing. Report the FORWARD window honestly (Wk 11 onward); before Week 11 has bets say "forward tracking starts Week 11"; never present discovery results as proof; label every window. Do not draft the Challenger or the interaction model. Images: a clean roster-by-date table (the one non-app image Michael allowed) and, only if its numbers match the text, a real Signals screenshot. Gate: every game of the week final, build < 2 h; wait to 8:15 AM.
**T2 (Tue, one signal explained).** One signal in plain English, when it was identified, its record, with a concrete current example if one exists. Pick one signal from register section A that has not been the main subject of a post in the last 7 days; prefer one with "next wk" players. Rule text from the app's own info popup (`.rinfo`); first-identified date from the register; record from the tile (label the window; forward bets 0 until Wk 11). Include the 95% interval in the image when the popup shows it. Images: tile + the current player row; the popup cropped to the rule and audit replay (<= 4:5). One question before the link ("Take it?"). Example of a passing draft: 2026-11-17 T2 (SC2, Aaron Jones Sr. U31.5). Pillar 2.
**W1 (Wed, season record per signal).** Season record per signal, honest; positive ones in the image; no overall total (signals overlap); label the window and the in-sample weeks. Gate: last week fully final, build < 2 h; wait to 7:30 AM.
**W2 (Wed ~5 PM, player card).** One real player page (`#/player/<pid>`, dark mode, iPhone width) for a notable player in Thursday's game with a posted line (else a first-Sunday-slate player). Three short bullets on what the card shows (line history chart, last games vs line, opponent defense rank), only what is visible; hide the FanDuel and save-pick boxes and anything negative; no claims the app does not support. Pillar 1.
**TH1 (Thu ~5:30 PM, signal players in the Thursday game + slip line).** Players from the Signals page who fit a signal in the Thursday game; one idea; end with the FanDuel-slip line. Gate: Thursday game locked (`gid` in `frozen_research.records`), wait to 5:45 PM, else say lines are "as of <time>" truthfully or stop and tell Michael. If the week has no Thursday game, log and stop; holiday Thursdays need a manual plan. Image: the rows, positive payouts only. Pillars 2, 4.
**TH2 (Thu ~6 PM, second player card).** A second player card for the Thursday game (W2 recipe), a different player from W2/M2. Pillar 1.
**F1 (Fri, Thursday results).** Results of what was shown for the Thursday game (TH1 players and cards), read from the app (Results page `#/results`, player pages). Honest if mixed; image never contradicts text. Gate: Thursday game final and results in the app (about 2 h after the final whistle); wait to 7:30 AM. No Thursday game: log and stop.
**F2 (Fri ~5 PM, arbitrage).** If the app's Arbitrage tab shows a guaranteed gap of $3 or more per $100, draft the arb template from `/preferences` (verify prices still show it). Otherwise a feature post on how the Arbitrage tab works, only what is visible. Pillar 3.
**S1 (Sat ~10:30 AM, line movers).** Definition and check script in `claude/tweet-image-check.md` (app-displayed snapshots, same book at both ends, first line >= 15, top 4 by absolute % move). Gate: a Saturday 8 AM line check exists; wait to 10:00 AM. Player-page crops with bet boxes hidden. Pillar 1.
**S2 (Sat ~5 PM, picks to FanDuel slip).** Real Signals page with the players checked and the "Add checked to FanDuel slip" button visible (no bet placed); three short bullets of what the app does. Pillar 4.
**SU0 (Sun, early international game).** Only if a game kicks off before about 10:00 AM CT: signal players in that game (Signals page), image of just those rows, positive payouts only. Gate: game locked, wait to 6:45 AM. Otherwise log one line and stop silently.
**SU1 (Sun, four posts a-d).** Four tweets, one per top-4 signal by season units (positive), top 2 players each in games that will not have started by post time; each ends with the slip line; a different opening for each; label the window. Times 9:15, 10:00, 10:45, 11:30 (rows SU1a-SU1d, each with its own topic/direction/time). Say in the hand-off that inactives were not re-checked. Pillars 2, 4.
**SU2 (Sun ~11:45 AM, arbitrage check).** Draft an arb post only if the app shows an arb of $3+ per $100 right now; otherwise skip: log one line and set the row `last_result` "no arb". Pillar 3.
**SU3.** Retired. Set the row status `Failed / skipped` with `last_result` "SU3 retired per content focus"; log one line; stop.
**ARB.** Manual, event-driven; only when Michael asks.
**CUSTOM (a row Michael added in the app, or any slot with no section).** Topic, direction and time come from the row. Pick the nearest pillar from `claude/tweet-content-focus.md`, follow Common, ask nothing, and say in the hand-off which pillar you used. If the topic needs data that does not exist, say so on the row (`last_result`) and in chat; do not invent.

## DAILY ROLL (5:41 AM CT)
1. `tweet_agent_pending`. Read `claude/tweet-content-focus.md` section 2 for the weekly calendar and section "Default slots" above for times.
2. Make sure plan rows exist for today and the next 7 Central days (`tweet_agent_add_row`; default topic from the calendar, time from the table). **Add only; never overwrite, delete or re-add a row listed in `claude/tweet-plan-known-rows.md`** (a listed key that is missing from the plan was deleted by Michael). Skip ARB. List what you cannot make (holiday or non-standard weeks) for Michael.
3. Update `claude/tweet-plan-known-rows.md`: append every `slot_key` in the plan that is not yet listed (project_read, append, project_write). Never remove keys.
4. Pending requests (only changes to tweets already scheduled on X): per `claude/tweet-plan-sync.md` section C (Chrome tools only on Michael's computer; otherwise finish `needs_attention` with the one-sentence result).
5. Stale-prompt check: `list_triggers`; every Stix tweet task's prompt should be the short pointer to this runbook. If one still carries long rules, say so in one SendUserMessage. Never edit a scheduled task from here.
6. SendUserMessage once only if something needs Michael; otherwise silent.

## DISPATCH (plan dispatcher, hourly 6 AM-10 PM CT)
Purpose: draft plan rows that no per-slot task will cover in time. Drafts only; never post or schedule.
1. `tweet_agent_pending`. Now = Central time. If nothing below applies, **stop at once without reading any other doc** (most runs are no-ops).
2. A row needs drafting now when ALL hold: status exactly `Not drafted`; `last_result` empty; has `post_date` and `post_time`; post time is between now+15 minutes and now+3 hours; and it is not covered:
   - **Custom** (slot not in the Default slots table, e.g. a key like `c1k3x9ab`): covered by nobody, draft it.
   - **Default slot** whose task run time (table above, for that row's date) is still in the future AND at least 20 minutes before the row's post time: the per-slot task will do it; skip.
   - **Default slot** whose task run time has passed (plus its wait limit) but the row is still `Not drafted` with empty `last_result`: the task did not run or failed silently: draft it now.
   - **Default slot** whose post time was moved so the task run would land less than 20 minutes before it (or after it): draft it now.
3. Claim before drafting: `tweet_agent_update_plan` `last_result: "Dispatcher drafting <time> CT"`. Then follow Common steps 2-6 and the slot's section (or CUSTOM). If a gate cannot be met in time, set `last_result` to what is missing and send one SendUserMessage.
4. At most 2 rows per run; the rest wait for the next hour.
5. Rows Michael set to `Manual`, `Failed / skipped` or `Posted`, rows with a pending delete, and past post times are never touched.

## Changelog
- 2026-11-17: created. Replaces the long per-slot prompts. Added the T2 task (Tue 7:34 AM) and the dispatcher. Slots M2, TH1, TH2, F2, SU2, SU3 follow `claude/tweet-content-focus.md` section 2 (their old prompts still described interaction-model picks). T1's "T2 is retired, do not draft" line removed (obsolete since Michael's 2026-11-16 focus change). Known-rows list added so deleted rows stay deleted. Rollback: the old prompts are not stored verbatim; the slot sections above keep their substance; per-slot recipes from before the redesign are in `claude/tweet-playbook.md` "Recipes".

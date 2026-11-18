# Stix X (@StixNFL) — posting procedure for scheduled tweet tasks (Michael, 2026-11-11)

Supersedes the "Michael posts himself / Nothing is posted / No X integration" lines in `claude/tweet-playbook.md` and `claude/tweet-schedule.md`. Michael wants each scheduled tweet task to put its tweet on X itself through **Claude in Chrome** on his plugged-in computer (his Claude desktop app and Chrome stay open). Everything else in the playbook (gates, real numbers only, 1–2 emojis, positive-image rule, ends sharpstix.com, Challenger on hold) is unchanged. The arb tweet stays manual.

Method: **schedule each tweet in X's own scheduler for its planned post time** (not "Post now"), so it goes out on time even if the computer sleeps afterwards. Verified working 2026-11-11 (W1 8:00, T1 9:30, T2 11:00 AM scheduled this way).

## LENGTH RULE (Michael, 2026-11-11; supersedes every "280 chars" / "≤280" line in the playbook, schedule doc and task prompts)
The W2 tweet on 2026-11-11 was 268 Python characters but went over X's limit, because X does not count characters the way `len()` does. Count the tweet the way X does and keep it **at or under 260 weighted characters** (a safety margin of 20 under X's 280):
- every URL / domain-looking link such as `sharpstix.com` counts as **23**, not its 13 letters;
- every emoji counts **2** (🏈📈📉✅🔒 etc.);
- every other character counts 1, including spaces, each newline, bullets (•), arrows, and punctuation. Treat any character outside plain ASCII (•, →, ↑, −, –, —, curly quotes) as 2 to be safe, or use plain ASCII equivalents (-, ->, ").
Compute it in code before delivering, e.g. `w = sum(2 if ord(c) > 127 else 1 for c in text.replace("sharpstix.com", "")) + 23` (this treats every non-ASCII character, emojis and bullets included, as 2). If w > 260, shorten the text (drop a bullet or tighten wording) and recompute. State the weighted count in the hand-off ("weighted 241/280"). In step 3.5 below, after typing, X's own character counter in the composer must show no negative number / red ring; if it does, discard, shorten, retry once.

## 0. Preconditions (check first)
- Load the Chrome tools in ONE ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__file_upload,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__read_page`.
- If those tools do not exist in this session (cloud run, not on Michael's computer) or Chrome does not answer: **do not improvise**. Deliver the drafts to chat as the playbook says, state plainly "nothing was scheduled on X: <reason>", log it, stop.
- Post only after the draft passed every gate and pre-send check (weighted length ≤ 260 per the LENGTH RULE, ends `sharpstix.com`, 1–2 emojis, image never contradicts text, real numbers). If any check or gate fails, schedule nothing. Nobody reviews the tweet before it goes out, so be strict.
- Always deliver the draft text + image to chat as well (record of what was scheduled).

## 1. Planned post time
**The admin Tweet plan decides (added 2026-11-11).** If your slot's row in the plan (see `claude/tweet-plan-sync.md`) has a `post_date` and `post_time`, schedule for exactly that date and time (Central); they override any time written in the task prompt. If the plan is unreachable or the row has no date/time, use the time named in the task prompt (Central). X needs the time to be at least ~5 minutes ahead: if the planned time is less than 6 minutes away or already past, use now + 6 minutes (round up to the next minute), and say so. Never schedule after the game's kickoff. "As soon as ready" = now + 6 minutes. A plan status of `Failed / skipped` or `Manual` means schedule nothing (see the sync doc).

## 2. Image file
Save the PNG in the container (e.g. `/mnt/user-data/outputs/<name>.png`). `file_upload` must be given an absolute container path. If a path is rejected, copy the file to `/mnt/user-data/uploads/<name>.png` and retry once. If it still fails, do not post a text-only tweet (every tweet needs a photo): report and stop.

## 3. Compose and schedule (one tweet at a time; repeat for each tweet in the run)
1. `tabs_context_mcp` (createIfEmpty), then `tabs_create_mcp`; `navigate` to `https://x.com/compose/post` with `force: true` if a "Leave site?" dialog appears. Wait ~3 s. Confirm you are logged in as the Stix account (STIX avatar bottom-left, "What's happening" composer). If you see a login page, stop and report.
2. Use ONLY elements inside the **Compose post modal dialog**: `find` "text box and Add photos file input inside the Compose post modal dialog (not the home timeline)". Do not use the home-timeline composer behind it (a click there once opened someone else's post; and the image attached to the wrong box). Never click in the feed.
3. Click the text box and `type` the tweet text **without the leading emoji** (newlines are typed as-is). Typing an emoji first scrambles the caret and pushes it to the end.
4. `file_upload` (origin `https://x.com`) the image into the dialog's file input ref.
5. Click the text box again, press `ctrl+Home`, `type` the emoji followed by a space. (If a tweet has a second emoji elsewhere, type it in its own `type` action at the right spot and check by screenshot.) Take a screenshot and confirm the text reads exactly as drafted, one image is attached, nothing extra, and the character counter shows the tweet is within the limit (no red / negative count).
6. Click the calendar-clock icon in the dialog toolbar. In the Schedule dialog `find` the Date / Hour / Minute / AM/PM selects and use `form_input` to set the planned date and time (time zone Central Standard Time). Zoom the dialog and confirm the line "Will send on <day>, <date> at <time>" matches the plan. Click **Confirm**, then click the button that now reads **Schedule** (never "Post").
7. Move on only after the dialog closes.

## 4. Verify
`navigate` to `https://x.com/compose/post/unsent/scheduled` (force true). Screenshot the Scheduled list: each tweet from this run must appear with its first line, the right time and a thumbnail. Do not open, edit or delete anything else in that list. If a tweet is missing or wrong: delete only that scheduled item if you created it wrongly (Edit → select → Delete), recompose once; if it fails again, report and stop.

## 5. Failure handling and finish
- Any surprise (login wall, error banner, wrong text, character-count error, stuck dialog, unexpected navigation): stop, discard the composer (navigate with force), do not retry more than once, and `SendUserMessage` the full tweet text + what happened so Michael can post it by hand. Never post to any other account; never like, repost, reply or follow.
- Close every tab you created (`tabs_close_mcp`).
- Append to `claude/tweet-drafts-log.md`: `scheduled on X for <time> CT` or `NOT scheduled: <reason>` for each tweet.
- **Update the admin Tweet plan row** (section B of `claude/tweet-plan-sync.md`: status, draft_run, x_time, last_result) and the live tracker (below).
- Final chat message: one line per tweet with its scheduled time (or the reason it was not scheduled).

## 6. Known limits
- Sunday four-tweet block (SU1) and the Sunday-slate picks (SU2): a player ruled inactive after drafting can no longer be caught before posting, because posts are scheduled ahead. Say in the hand-off that inactives were not re-checked after drafting.
- Scheduling only works while Michael's computer is on with Chrome and the Claude desktop app open at draft time. After scheduling, the computer may sleep.
- Chrome silently blocks more than one file download per tab; not needed here since images come from the container.
- Changing a tweet that is already scheduled on X (new time or topic from the admin plan) needs Chrome on his computer; a cloud-only run can only update the plan and flag it (see the sync doc, section C).

## Live tracker (added 2026-11-11)
Michael's tracker is a Sheet: "Stix tweet schedule – live tracker", https://claude.ai/artifact/5ZZk77q5LxFiQqpeEKnXDE (artifact id 24f088b3-bd89-4a35-a389-6a9515312905), one row per tweet (Day, Slot, Tweet about, Post slot, Data first available, Draft run, Status, Scheduled on X for, Notes). The admin Tweet plan (Supabase) is the source of truth once it is live; the Sheet is a convenience copy. If the Claude Docs connector (read/update, workbook engine) is available in this session, then after drafting and again after scheduling, find your slot's row and set Status (Not drafted / Drafted (chat only) / Scheduled on X / Posted / Failed / skipped / Manual) and "Scheduled on X for" (day + time CT), and put any reason in Notes. Read the sheet first and edit only your row's cells G:I. If the connector is unavailable, skip it silently; it is not a gate.

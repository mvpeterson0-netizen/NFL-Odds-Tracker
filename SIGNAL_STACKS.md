# Signal Stacks (NFL side only; CFB untouched)

Shows when several **distinct families** of evidence point at the same side of a prop. It is a research aid, not a recommendation, and nothing in it is proven yet.

## Evidence states
- **Context**: research observation (e.g. weather). Shown, never counted.
- **Testing**: a versioned rule that fires on upcoming props and is graded forward from its lock. Counted in the stack, labeled "Testing".
- **Qualified**: met every criterion in `pipeline/signals.py` `QUALIFY` on *forward* bets (>=150 bets, >=60 games, >=4 weeks, ROI>0 with game-clustered p<=0.10 after Benjamini-Hochberg, positive in >=60% of weeks and without the 3 best games, still positive with prices shaded 5 points). Historical results never qualify a rule. **No signal is Qualified today.**

## Families (a family counts once per side)
game_script (SP1-SP5, leads 6-8: all read one input, the team spread), recent_form (L1, L9, L10), line_move (L2), role_base_rate (L3, L4), workload (L5), weather (WX1, WX2; Context). A family whose rules point both ways is **mixed**: it supports neither side and counts as opposition.
The frozen models (T11/T12) and Challenger (T13) are shown as a separate "model callout" and are never a family. The declared model-input overlap is tested against `pipeline/frozen_models.json` columns. No spread rule reuses a model input.

## Workflow
1. Watchlist: recomputed every build from the latest pending capture; not persisted.
2. Lock (ledger stored in the admin-only Supabase row `ledger` when the service key is set, never in git; local runs use a git-ignored file; a failed remote read means no locks that run): at the first eligible pregame capture (graded `ok`, before kickoff, within 4 h of it, after the ledger start, line and both prices present) the record is written once to `data/signal_stacks.json` with line, book, both prices, inputs, timestamps, rule versions and registry hash. It is never recomputed; repeat captures change nothing.
3. If the rule registry changes without a version bump, no new locks are written.
4. Forward grading: `forward_report` (writes `data/challenger/signal_stacks_forward.json`, and the admin-only `signal_research` table when a service key exists) grades each locked prop-side once for groups 1, 2, 3+ clean, 3+ with opposition, weekly and cumulative, against a same-market/side baseline, and compares frozen-model picks with the stack-supported subset (coverage lost).

## Availability (otherwise "unavailable", never guessed)
Spread read must be <=36 h old; forecast <=8 h old and roof "open" (domes = indoor; retractable = unknown).

## Public/private boundary
Signal Stacks is ADMIN ONLY for now: `data.json` has no `signal_stacks` key; the display payload and research rows live in the admin-only `signal_research` table and are read by `admin_signal_research()` after the server-side admin check. The nav link is hidden for everyone else. The display payload carries only the fields in `PUBLIC_FIELDS` / `PUBLIC_CHIP_FIELDS` / `PUBLIC_REGISTRY_FIELDS` (tests enforce this). Season splits, ROI and forward results are admin-only (Supabase `signal_research` via `admin_signal_research()`). Caveats: this repo is public, so the committed ledger and forward JSON are visible in git, and `data/history_2025` is already public.

## Spread orientation
nflverse `spread_line` = points the HOME team is favored by. Team spread = `-spread_line` (home) or `+spread_line` (away); negative = player's team favored. This is the opposite sign of `frozen.py` (+ = favored); code converts explicitly.

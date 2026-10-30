# 2025 lead research archive

Approved October 30, 2026: download passing yards, carries, rushing yards,
receptions and receiving yards at kickoff minus three hours. Raw snapshots
include up to ten books at one region-equivalent cost. Results live only in
`data/history_2025/`; nothing is added to live captures or site data.

These five markets cover leads 1 and 3–8 across the existing position/market
universe. Lead 2 is covered on these markets only; QB passing attempts and
completions are deliberately excluded. Maximum full-season prop cost: 13,600
credits plus historical event lookups. Download chronologically and resume
between runs; stop before the next request could breach the paid reserve.
A partial season is reported as partial, not as a complete validation.

## Keys and budget

Live pulls use `ODDS_API_KEY`, then `_2` through `_6`, then `ODDS_API_KEY_20K`.
Duplicate secrets are deduplicated; any duplicate of the paid secret stays last.
A free key that can afford the five core markets is used before the paid key,
even when it cannot afford the two optional markets. Unknown balances cannot
permit spending. Free keys do not support historical endpoints, so the archive
uses only the paid key. Secret values never belong in code, output or reports.

The backfill verifies the paid balance through a free events request immediately
before **every** billable call, including historical event discovery. It budgets
the maximum request cost against a zero-credit reserve, saves actual API costs,
and pauses on missing quota information. Live NFL pulls also respect the paid
zero-credit floor until the deadline and recheck before using the paid key.

The NBA app is a separate concurrent consumer: it can spend the reserve and
can race a balance check. This code controls NFL requests, not NBA requests;
The zero-credit limit is a spending floor for this code, not a claim about two days of NBA
usage. API balances and secret availability must be verified in Actions.

## One-time lifecycle

The scheduled pipeline processes at most 16 games per run, runs on push or schedule, and commits raw odds, event cache, schedule and state with normal data.
The existing workflow concurrency group serializes NFL archive/live runs.
Paid reserve/auth stops are persisted, and a balance increase stops the job
rather than using a reset allowance. It never downloads at or after
2026-11-01 00:00 UTC (Saturday Oct 31, 7 PM Central), deliberately before Sunday.
Re-enabling a stopped or expired job requires a new explicit budget decision.

No historical API calls were made during local tests. Tests mock quotas and
responses and verify free-first ordering, core fallback, reserve boundaries,
missing balances, deadline/reset protection, archive persistence and resume.

The nflverse 2025 depth-chart asset exists with `dt`, `team`, `gsis_id`,
`pos_abb` and `pos_rank` fields needed by the existing slot code. Lead grading
and slot reconstruction are a separate step after the archive is downloaded;
this change does not claim to have evaluated the eight leads.

Budget revised October 30 after NBA free-first routing was enabled: use the remaining paid balance, with no 500-credit reserve. NBA may fall back to paid only when free keys cannot fund a request. Both apps can exhaust their credits before reset.

Priority revised with execution approval: archive passing yards, rushing yards, receptions and receiving yards across all 272 games FIRST (10,880 maximum prop credits). Then archive carries in separate carries/ files with whatever balance remains. No passing attempts or completions. Carries coverage can be partial; lead 5 and lead 2 must report that limitation.

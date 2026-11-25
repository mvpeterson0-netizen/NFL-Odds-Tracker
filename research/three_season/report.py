"""Write the markdown report from /tmp/three_season_rules.json, /tmp/shop.json, /tmp/shop_rules.json."""
import json
from pathlib import Path

R = {r["id"]: r for r in json.load(open("/tmp/three_season_rules.json"))}
SHOP = json.load(open("/tmp/shop.json"))
SR = json.load(open("/tmp/shop_rules.json"))
OUT = Path(__file__).with_name("out") / "report.md"


def pc(v, d=1):
    return "–" if v is None else f"{v:+.{d}f}%"


def cell(r, s):
    if s == "f":
        n, rec, roi = r.get("n26f", 0), r.get("rec26f", ""), r.get("roi26f")
    elif s == "o":
        n, rec, roi = r.get("oos_n"), r.get("oos_rec", ""), r.get("oos_roi")
        if n is None:
            return "n/a"
    else:
        n, rec, roi = r.get(f"n{s}", 0), r.get(f"rec{s}", ""), r.get(f"roi{s}")
    return "–" if not n else f"{rec} ({pc(roi, 0)})"


HDR = "| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"


def row(r):
    if not r.get("bets"):
        return f"| {r['id']} | {'Under' if r['side'] == 'U' else 'Over'} | no bets | | | | | | | | | | | |\n"
    q1 = f"{r['q_family']:.3f}" if "q_family" in r else "–"
    q2 = f"{r['q_global']:.2f}" if "q_global" in r else "–"
    return (f"| {r['id']} | {'Under' if r['side'] == 'U' else 'Over'} | {r['w']}-{r['l']}" + (f"-{r['p']}" if r['p'] else "") +
            f" | **{pc(r['roi'])}** | {r['lo']:+.0f} to {r['hi']:+.0f} | {q1} | {q2} | {r['roi'] - r['base']:+.1f} | {pc(r['roi_m10'])} | "
            f"{cell(r, 2024)} | {cell(r, 2025)} | {cell(r, 2026)} | {cell(r, 'f')} | {cell(r, 'o')} |\n")


def table(ids, defs=True):
    t = HDR + "".join(row(R[i]) for i in ids)
    if defs:
        t += "\n" + "".join(f"- **{i}**: {R[i]['desc']}. *Source: {R[i]['origin']}.*\n" for i in ids)
    return t


def fam(f, sort=True):
    ids = [i for i, r in R.items() if r["family"] == f and r.get("bets", 0) > 0]
    if sort:
        ids.sort(key=lambda i: R[i].get("p1", 1))
    return ids


md = []
A = md.append
A("""# Every thesis re-run on three seasons (2024, 2025, 2026 weeks 1–11) — 2026-11-22

NFL side. Built from scratch in `research/three_season/` on the `history-2024` branch (data.py → features.py → rules.py → shop.py → report.py).
The full ledger of all 1,207 rules is in `claude/three-season-ledger-2026-11-22.csv`.

## 1. Bottom line

- **No rule survives correction for everything tested.** 1,166 rules had 20+ bets; the smallest all-rules q-value is 0.19. Anything below is a candidate, not a proven edge.
- **Betting every Under is about break-even (−0.4%)** and every Over loses about 11%, in all three seasons. So an Under rule only has to beat about 0%, not the −4.5% a typical price implies.
- **2024 was the real test** for the theses found on 2025–2026. Most of them failed it: the late-yardage family (except one variant), SC1/SC2, L9/S03, QBCH, L5 and the frozen leads were flat or negative in 2024.
- **What held up best** (positive in every season it can be tested in, positive out of sample, still positive at prices 10 cents worse):
  1. **CM1 family** (QB passing line cut, receivers' lines not cut → receivers Under). Strongest family-level evidence (q 0.010), but it can't be tested on 2024 (no passing lines pulled).
  2. **QB rushing Unders** (QB-R1 "avg 25", QBRu "25+", QB-R3). Positive all three seasons, including 2024, but much smaller in 2024.
  3. **SY-c40** (short-yardage receiver with 40+ career catches, last game Over with 40+ yds, line raised → Under). The only late-yardage version that was positive in 2024 (+14.9%, 31 bets).
  4. **Big-underdog receiving Unders** (SP1 rec yds, SP2 receptions, WR receptions at +10). Positive in every season, but the spread used is a closing-type number.
  5. **Receptions line raised vs his last game → receptions Under** (SEQ-RC-LUP-U). High volume (772 bets), +8.8%, both seasons and the 2026 forward weeks positive. Not testable on 2024.
- **Line shopping adds about +1.9 points to every Under**, consistently in all three seasons (section 9). It is the most reliable improvement found, and it stacks on top of any rule.

## 2. Data and method

| Season | Games | Markets with lines | Graded props | Source of lines |
|---|---|---|---|---|
| 2024 | 272 (reg. season) | rush yds, rec yds | 4,477 | Odds API historical snapshot, kickoff − 3 h (archive pulled tonight) |
| 2025 | 272 | pass yds, rush yds, receptions, rec yds | 7,619 | Odds API historical snapshot, kickoff − 3 h |
| 2026 | 161 final (weeks 1–11) | same four | 5,232 | The app's graded pregame line (~3 h before kickoff) |

- **Line used**: DraftKings main line (the point whose two prices are closest to even), FanDuel only when DraftKings has none. Same rule as the app and the 2025 audit.
- **Grading**: 1 unit per bet at the saved price of the side bet; push = 0; a player who did not play is void (not counted).
- **95% CI**: 4,000 bootstrap resamples of whole season-weeks (47 clusters).
- **p / q**: one-sided p = share of resamples with ROI ≤ 0. q = Benjamini–Hochberg within the rule's family ("q family") and across all 1,166 rules ("q all").
- **vs base**: ROI minus the ROI of betting the same side on every prop with the same season × position × market mix.
- **at −10¢**: ROI if every price were 10 cents worse (e.g. −110 → −120).
- **Out-of-sample** = data that was not available when the rule was found: frozen leads (found 2026 wk 1–7) → 2024, 2025, 2026 wk 8+; audit theses (2025 + 2026 wk 1–9) → 2024 and 2026 wk 10–11; late-yardage (2025 + 2026 wk 1–10) → 2024 and 2026 wk 11. New grids: none (all three seasons are fresh, so only q protects them).
- **Approximations**: depth slots (WR2, TE1, QB1…) are rebuilt for all three seasons from pre-game snap share (last 3 games played; week 1 uses the prior season), not the app's slots. Spread, total and weather are nflverse closing-type / observed values (as in every earlier audit; the 2026-11-01 independent study found spreads somewhat leaky). 2026 weather is mostly not yet published, so weather rules are 2024–2025 only. CM rules use the main line per player one week apart, not the audit's same-book synchronized captures.

### Implementation check
The same code reproduces the audit's and the late-yardage study's 2025 ROI exactly for QB-R1 (23.2), QB-R4 25–39.5 (6.2), QB-R4 40+ (13.2), L9 (20.0), L10 (12.6), SP1 (17.8), SP2 (16.6), SP3 (9.0), SY-R25 (24.0), SY-NL (14.5), SY-YPC (19.2), FH-R30 (16.9), FH-NL (11.9), BL-200 (6.6) and NL-U20 (4.2). Within 2 points: SC1, SC2, S03, SP5, QB-R2, CM1-TE, CM1-20. Larger gaps, explained: SP4 (17.0 vs 22.2, small sample), QBCH (7.3 vs 11.5: this game's QB is taken from the posted QB line here).

## 3. Baselines
""")
A(HDR + "".join(row(R[i]) for i in ["BASE-ALL-U", "BASE-ALL-O", "BASE-rec_yds-U", "BASE-rec-U", "BASE-rush_yds-U", "BASE-pass_yds-U", "BASE-pass_yds-O"]))
A("""
## 4. Strongest candidates

Ranked by the low end of the 95% CI. Each was positive in every season with 20+ bets, positive out of sample where that exists, and still positive at prices 10 cents worse.

""")
top = ["SY-c40", "CM1-TE", "QB-R3", "CM1", "QB-R1", "SEQ-RC-LUP-U", "CM1-20", "SY-L45+", "SP2", "SP1", "WX1", "WXG-WRTE-rec_yds-wind>=15-U", "SPG-WR-rec-dog10+-U", "QBRu-25", "SP5", "SY-YPC"]
A(table(top))
A("""
### How the top variants differ

**CM1 family (QB line cut, receivers not cut).** Each week, take the team's QB with a passing-yards line and compare it with his line the previous calendar week. Then add up the week-over-week change in every teammate's receiving-yards line (WR/TE/RB with a line both weeks; at least 3). "Gap" = receivers' total change minus the QB's change.
- **CM1**: QB down 15+ AND gap 10+ (the receivers' lines fell at least 10 yds less, in total, than the QB's). Bet every matched receiver's rec yds Under.
- **CM1-20** (Signals page "CM1 All"): the same, but the QB must be down 20+. Fewer, larger cuts. It was weaker in 2026 (+11%) and went 3–4 (−19%) in weeks 10–11.
- **CM1-TE** (Signals page "CM1 TE"): CM1, but only the tight end is bet. Best ROI (+32%) on 53 bets. Smallest sample.
- **CM1-ctl** (control): QB down 15+ but the receivers' lines DID follow. It is +6.6% overall (+11% in 2025, −1% in 2026, 7–9 in weeks 10–11). So part of CM1's result comes from the QB cut alone. The lag still adds about 10 points (CM1 +16.2% vs control +6.6%).
- Line shopping does not help CM1 (other books have already cut the receivers' lines; DK/FD's lag is the edge).

**QB rushing Unders.**
- **QBRu 25+**: every QB rushing line of 25+. Broadest version (307 bets, +9.5%), positive every season but its CI touches 0.
- **QB-R1 / QBRu "avg 25"**: line 25+ AND he averaged 25+ rush yds over his last 3 games played. It filters out QBs whose line is high without the recent running to match. +18.7% on 175. 2024 +6.6%.
- **QB-R1s**: 30/30 instead of 25/25. Higher ROI in 2025–26, but only +4.1% in 2024.
- **QB-R2 / QBRu "+5"**: line 5+ above his previous game's line. Big ROI in 2025–26 (+34%, +45%), but 15–14 in 2024.
- **QB-R3**: the opposite end. Line under 15 but 5+ above his last-3 average (a non-runner's line nudged up). 37–15, positive every season, but only 52 bets.

**Short-yardage receivers (late-yardage family).** Base: last game he went Over his rec-yds line with 40+ yds, and this week's line is higher. "Short-yardage" = his yards per catch on every catch since the start of 2024, before that game, is under 10.6.
- **SY** (headline): needs 20+ earlier catches. 2024 −5.3% (111 bets).
- **SY-c40**: needs 40+ earlier catches, so only receivers with an established short-catch profile count. +22.3% on 241, 2024 +14.9%. This is the version to prefer, with two cautions. It was row 2 of about 140 versions in the 2026-11-15 study, picked after seeing 2025–26. And in 2024 the catch count starts at zero in week 1, so only receivers past 40 catches by mid-season could qualify (31 bets).
- **SY-R25** (Signals "SY +25%"): SY plus a line raised 25%+. 2024 −15.5% (22 bets).
- **SY-NL** (Signals "SY No Long"): SY plus still Over without his single longest catch. 2024 −11.8%.
- **SY-YPC** (Signals "SY Fluke"): SY plus that game's yards per catch 1.5x his norm. Positive every season (2024 +3.3%), 130 bets.
- **SY-L45+**: SY with this week's line 45+. +26.0% on 84, 2024 +19.7%.

**Underdog receiving Unders.** Team spread from nflverse (closing-type).
- **SP1**: team a 10+ point underdog → WR/TE/RB rec yds Under. +14.3% on 342; 2024 +3.0%. Shopping lifts it to +17.3%.
- **SP2**: same trigger, receptions. +16.2% on 247 (2025–26 only).
- **SPG-WR-rec-dog10+**: SP2 for WRs only. +18.9%.

**Receptions line raised → Under (SEQ-RC-LUP-U).** Any player's receptions line is higher than his line at his previous game played. 772 bets, +8.8%, CI +4 to +14, positive in 2025, 2026 and weeks 10–11. Compare **L2** (any market, away team, line raised vs his previous team game): +1.9% overall and +0.5% out of sample. The effect is much stronger for receptions than for yardage lines.

**Wind (WX1).** Outdoor, observed wind 15+ mph → pass yds, receptions and rec yds Under. +12.1% on 606 (2024 +3.0%, 2025 +15.5%). The wind is observed after the game, so a forecast version is the bettable one; it has too few games to judge yet.
""")
A("""
## 5. Current Signals page and Indicators page
""")
sig = ["QBRu-25", "QB-R1", "QB-R2", "CM1-TE", "CM1-20", "SC2", "SC1", "SY-R25", "SY-NL", "SY-YPC", "FH-R30", "FH-NL"]
ind = ["QBCH", "L9", "L10", "S03", "SP1", "SP2", "SP3", "SP4", "SP5", "SY-R25", "SY-NL", "SY-YPC", "FH-R30", "FH-NL", "BL-200", "NL-U20"]
A("**Signals page** (QBRu 25+ / avg 25 / +5, CM1 TE / All, GS RB / WR-TE, SY +25% / No Long / Fluke, 1H +30% / No Long):\n\n" + table(sig, defs=False))
A("\n**Indicators page:**\n\n" + table([i for i in ind if i not in sig], defs=False))
A("""
Verdict by tile:
- **Keep, strongest**: QBRu (prefer "avg 25"), CM1 (TE and All). Note that CM1-20 lost in weeks 10–11.
- **Keep, modest**: SP1, SP2, SP5 (positive all seasons, small to moderate ROI).
- **Weakened by 2024**: GS (SC1 2024 −7%, SC2 2024 −6%), SY +25%, SY No Long, 1H +30%, 1H No Long (all negative in 2024; still positive overall only because of the 2025–26 discovery data).
- **Failed**: BL-200 and NL-U20 (2024 −21% and −29%), S03 (−12% in 2024, about 0% overall), L9 (2024 −4%), QBCH (2024 −1%).
- **Consider replacing SY +25% / No Long with SY-c40 and SY-YPC**, which held up in 2024.
""")
A("## 6. Every named thesis (frozen leads, audit shortlist, combos)\n\n" + table(fam("NAMED")))
A("\n## 7. QB rushing study\n\n" + table(fam("QB")))
A("\n## 8. CM (correlated line movement; 2025–2026 only)\n\n" + table(fam("CM")))
A("\n## 9. Line shopping\n\nThe Under at the highest line available across books at the same moment (and the best Under price at that line), against the DK main line. 2024–2025: raw snapshots, 10 books. 2026: weeks 8–11 only (the other-books pulls started in week 8).\n\n")
A("| Books | Side | Subset | Market | Bets | ROI | 2024 | 2025 | 2026 |\n|---|---|---|---|---|---|---|---|---|\n")
for r in SHOP:
    if r["market"] == "ALL" or (r["subset"] == "best line 5+ yds above DK/FD main" and r["pool"].startswith("major")):
        A(f"| {r['pool']} | {'Under' if r['side'] == 'U' else 'Over'} | {r['subset']} | {r['market']} | {r['bets']:,} | **{pc(r['roi'])}** | {pc(r['roi2024'])} ({r['n2024']}) | {pc(r['roi2025'])} ({r['n2025']}) | {pc(r['roi2026'])} ({r['n2026']}) |\n")
A("""
- Taking every Under at the best line among the major books (DK, FD, BetMGM, Caesars, BetRivers, theScore, Fanatics, Hard Rock) turns −0.1% into +1.8%. It was positive in every season (+0.1%, +2.9%, +1.2%).
- Only betting when another book's line is higher than DK/FD's adds nothing by itself (+0.3%). The gain comes from always taking the best number, not from disagreement as a signal. Exception: when a book is 5+ yds above DK/FD on rushing yards (69 bets, +20%), which is too small to rely on.
- Fliff and Bally are left out of "major books": they are less widely available (Fliff is a sweepstakes app).

Rules re-graded at the best line (props where other books' lines exist):

| Rule | Bets covered | ROI at DK line | ROI at best line | Change |
|---|---|---|---|---|
""")
for i, v in SR.items():
    A(f"| {i} | {v['cov']} of {v['n']} | {pc(v['dk_on_cov'])} | {pc(v['shop_on_cov'])} | {v['shop_on_cov'] - v['dk_on_cov']:+.1f} |\n")
A("\n## 10. Late-yardage family (all versions re-run)\n\nBase for every row: last game Over his rec-yds line with 40+ yds, and this week's line higher. Bet the Under. Sorted by strength (p-value).\n\n" + table(fam("LY")))
A("\n## 11. Weather\n\n" + table(fam("WX")))
A("""
## 12. Grids: old (sequence, spread, ATS) and new

New grids were written before looking at any result: line vs last-3 average (FORM3), line vs season average (FORMS), line move vs his previous game (MOVE), last game's result as a multiple of its line (RESID), situation (SIT: home/away, prime time, division, short rest, after bye, total 48+/40−, dome, weeks 1–4 / 14+), opponent's season-to-date allowed (DEF), line size (LINE) and price (PRICE). Each is crossed with the 9 position-markets (QB pass/rush, RB rush/rec/rec yds, WR rec/rec yds, TE rec/rec yds) and both sides.

| Family | Rules (20+ bets) | Best q (family) | Rules with q ≤ 0.10 | CI above 0 | Under cells positive |
|---|---|---|---|---|---|
""")
import collections
fams = collections.defaultdict(list)
for r in R.values():
    if r.get("bets", 0) >= 20 and r["family"] not in ("BASE",):
        fams[r["family"]].append(r)
for k in ["SEQ", "SPG", "ATS", "FORM3", "FORMS", "MOVE", "RESID", "SIT", "DEF", "LINE", "PRICE", "NAMED", "QB", "CM", "LY", "WX"]:
    v = fams[k]; u = [r for r in v if r["side"] == "U"]
    A(f"| {k} | {len(v)} | {min(r['q_family'] for r in v):.3f} | {sum(r['q_family'] <= .1 for r in v)} | {sum(r['lo'] > 0 for r in v)} | {sum(r['roi'] > 0 for r in u)} of {len(u)} |\n")
A("""
With about half of the Under cells positive in every new grid, these results are what chance alone would produce. The individual cells with a CI above zero are listed below for future tracking, not betting.

""")
best = sorted([r for k in ["SEQ", "SPG", "ATS", "FORM3", "FORMS", "MOVE", "RESID", "SIT", "DEF", "LINE", "PRICE"] for r in fams[k] if r["lo"] > 0], key=lambda r: -r["lo"])
A(table([r["id"] for r in best]))
A("""
## 13. Not re-run, and why

- **Models** (MDL-*, the frozen interaction model T11–T13, the Challenger, COMBO-F/G): they need retraining, not a rule replay. The 2026-11-12 audit found no model edge.
- **Injury-report rules** (INJ-Q, INJ-LP): the injury report would have to be rebuilt for 2024 and 2026. It was flat in 2025.
- **"Not measurable" rows** (NM-*): no data source exists.
- **Late-yardage "all three yardage markets" versions**: they need rushing and passing play-by-play detail that wasn't built here.
- **2024 passing-yard and receptions theses** (CM, SP2–SP4, L10, SEQ-RC/PY, receptions grids): the 2024 pull was rushing and receiving yards only. Pulling those two markets for 2024 would cost about 5,700 credits.

## 14. What to bet, track or drop

- **Bet / keep on the page**: CM1 (TE and All; watch CM1-20 after its weeks 10–11 loss), QBRu (default to "avg 25"), SP1/SP2. Always take the best line available.
- **Track forward (good but not proven)**: SY-c40, SY-YPC, SEQ-RC-LUP-U (receptions line raised → Under), SP5, WX1 using forecast wind.
- **Drop or demote**: BL-200, NL-U20, S03, L9, QBCH, L5, frozen leads 1–8, SC1/SC2, and the SY +25% / No Long and 1H tiles.
- **The honest caveat**: nothing here clears the all-rules multiple-testing bar. The best-supported findings are the CM1 lag (strong family-level evidence, two seasons) and QB rushing Unders (positive in three seasons). The safest edge is line shopping, which is structural rather than statistical.
""")
OUT.write_text("".join(md))
print(OUT, len("".join(md)))

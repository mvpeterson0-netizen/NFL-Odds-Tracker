# Every thesis re-run on three seasons (2024, 2025, 2026 weeks 1–11) — 2026-11-22

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
| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE-ALL-U | Under | 9201-8127 | **-0.4%** | -2 to +1 | – | – | +0.0 | -4.1% | 2338-2139 (-2%) | 4086-3533 (+1%) | 2777-2455 (-1%) | 455-396 (-0%) | n/a |
| BASE-ALL-O | Over | 8127-9201 | **-11.2%** | -13 to -10 | – | – | -0.0 | -14.5% | 2139-2338 (-11%) | 3533-4086 (-12%) | 2455-2777 (-10%) | 396-455 (-11%) | n/a |
| BASE-rec_yds-U | Under | 4175-3746 | **-0.6%** | -3 to +2 | – | – | -0.0 | -4.4% | 1580-1467 (-3%) | 1538-1339 (+1%) | 1057-940 (+0%) | 173-154 (+0%) | n/a |
| BASE-rec-U | Under | 2586-2161 | **+0.9%** | -2 to +3 | – | – | +0.0 | -2.6% | – | 1527-1240 (+2%) | 1059-921 (-1%) | 183-144 (+3%) | n/a |
| BASE-rush_yds-U | Under | 2019-1775 | **-0.1%** | -3 to +3 | – | – | -0.0 | -3.9% | 758-672 (-1%) | 750-680 (-1%) | 511-423 (+3%) | 75-72 (-4%) | n/a |
| BASE-pass_yds-U | Under | 421-445 | **-8.0%** | -15 to -2 | – | – | +0.0 | -11.6% | – | 271-274 (-6%) | 150-171 (-12%) | 24-26 (-9%) | n/a |
| BASE-pass_yds-O | Over | 445-421 | **-2.8%** | -9 to +4 | – | – | -0.0 | -6.5% | – | 274-271 (-5%) | 171-150 (+1%) | 26-24 (-2%) | n/a |

## 4. Strongest candidates

Ranked by the low end of the 95% CI. Each was positive in every season with 20+ bets, positive out of sample where that exists, and still positive at prices 10 cents worse.

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SY-c40 | Under | 156-85 | **+22.3%** | +12 to +32 | 0.022 | 0.19 | +21.2 | +17.6% | 19-12 (+15%) | 80-47 (+19%) | 57-26 (+30%) | 12-3 (+52%) | 25-15 (+17%) |
| CM1-TE | Under | 37-16 | **+32.0%** | +12 to +51 | 0.010 | 0.35 | +28.2 | +26.9% | – | 21-10 (+28%) | 16-6 (+38%) | 5-2 (+36%) | 5-2 (+36%) |
| QB-R3 | Under | 37-15 | **+33.3%** | +9 to +55 | 0.067 | 0.44 | +34.1 | +28.3% | 15-7 (+26%) | 14-6 (+33%) | 8-2 (+49%) | – | 15-7 (+26%) |
| CM1 | Under | 132-83 | **+16.2%** | +5 to +28 | 0.010 | 0.35 | +15.3 | +11.7% | – | 85-56 (+14%) | 47-27 (+20%) | 13-8 (+17%) | 13-8 (+17%) |
| QB-R1 | Under | 110-65 | **+18.7%** | +4 to +33 | 0.067 | 0.44 | +19.7 | +14.2% | 48-37 (+7%) | 41-22 (+23%) | 21-6 (+47%) | – | 48-37 (+7%) |
| SEQ-RC-LUP-U | Under | 483-289 | **+8.8%** | +4 to +14 | 0.076 | 0.22 | +7.8 | +5.6% | – | 269-170 (+7%) | 214-119 (+12%) | 37-23 (+8%) | 37-23 (+8%) |
| CM1-20 | Under | 68-40 | **+19.2%** | +6 to +35 | 0.010 | 0.35 | +18.4 | +14.6% | – | 45-24 (+24%) | 23-16 (+11%) | 3-4 (-19%) | 3-4 (-19%) |
| SY-L45+ | Under | 56-28 | **+26.0%** | +4 to +49 | 0.108 | 0.50 | +26.6 | +21.1% | 26-15 (+20%) | 21-8 (+37%) | 9-5 (+22%) | 2-0 (+91%) | 26-15 (+20%) |
| SP2 | Under | 153-94 | **+16.2%** | +2 to +30 | 0.176 | 0.45 | +15.3 | +12.0% | – | 95-58 (+17%) | 58-36 (+16%) | 32-13 (+32%) | 32-13 (+32%) |
| SP1 | Under | 207-135 | **+14.3%** | +2 to +25 | 0.176 | 0.45 | +14.5 | +9.9% | 50-41 (+3%) | 97-59 (+18%) | 60-35 (+19%) | 31-14 (+30%) | 81-55 (+12%) |
| WX1 | Under | 361-245 | **+12.1%** | +2 to +20 | 0.089 | 0.45 | +12.0 | +7.9% | 91-75 (+3%) | 270-170 (+15%) | – | – | 91-75 (+3%) |
| WXG-WRTE-rec_yds-wind>=15-U | Under | 172-111 | **+14.7%** | +1 to +26 | 0.089 | 0.54 | +15.1 | +10.3% | 71-55 (+6%) | 101-56 (+22%) | – | – | 71-55 (+6%) |
| SPG-WR-rec-dog10+-U | Under | 80-46 | **+18.9%** | +5 to +31 | 0.541 | 0.44 | +17.5 | +14.6% | – | 51-26 (+23%) | 29-20 (+12%) | 17-6 (+36%) | 17-6 (+36%) |
| QBRu-25 | Under | 178-129 | **+9.5%** | -1 to +20 | 0.194 | 0.66 | +10.1 | +5.3% | 73-61 (+3%) | 63-48 (+7%) | 42-20 (+28%) | 4-0 (+88%) | 77-61 (+5%) |
| SP5 | Under | 528-410 | **+5.7%** | +0 to +11 | 0.176 | 0.54 | +6.1 | +1.7% | 208-171 (+2%) | 180-133 (+8%) | 140-106 (+8%) | 18-14 (+6%) | 226-185 (+2%) |
| SY-YPC | Under | 80-50 | **+16.1%** | +0 to +31 | 0.148 | 0.55 | +15.9 | +11.6% | 22-18 (+3%) | 41-24 (+19%) | 17-8 (+28%) | 6-2 (+42%) | 26-20 (+6%) |

- **SY-c40**: SY needing 40+ earlier catches. *Source: late-yardage study (2026-11-15).*
- **CM1-TE**: CM1, TE only (Signals page CM1 TE). *Source: audit / Signals page.*
- **QB-R3**: Small line (<15) that is 5+ above his last-3 average -> Under. *Source: audit.*
- **CM1**: QB pass-yds line down 15+ vs last week AND his receivers' rec-yds lines fell 10+ yds less in total -> every matched receiver's rec yds Under. *Source: audit.*
- **QB-R1**: QBRu 'avg 25': line 25+ AND he averaged 25+ rush yds over his last 3 games played. *Source: Signals page QBRu mode 2.*
- **SEQ-RC-LUP-U**: rec: LUP pattern over his recent games played -> Under. *Source: audit grid.*
- **CM1-20**: As CM1 with QB drop 20+ (Signals page CM1 'All'). *Source: Signals page.*
- **SY-L45+**: SY AND line 45+. *Source: late-yardage study (2026-11-15).*
- **SP2**: Team a 10+ pt underdog -> receptions Under. *Source: audit / indicator.*
- **SP1**: Team a 10+ pt underdog -> WR/TE/RB receiving yards Under. *Source: audit / indicator.*
- **WX1**: Outdoor, observed wind 15+ mph -> pass yds / receptions / rec yds Under. *Source: audit.*
- **WXG-WRTE-rec_yds-wind>=15-U**: WRTE-rec_yds Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **SPG-WR-rec-dog10+-U**: WR rec when team is dog10+. *Source: audit grid.*
- **QBRu-25**: QBRu '25+': any QB rushing line of 25 or more. *Source: Signals page QBRu mode 1.*
- **SP5**: Team a 3 to 6.5 pt underdog -> QB/RB rushing yards Under. *Source: audit / indicator.*
- **SY-YPC**: SY AND that game's yds/catch 1.5x his normal (Signals SY Fluke). *Source: late-yardage study (2026-11-15).*

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

## 5. Current Signals page and Indicators page
**Signals page** (QBRu 25+ / avg 25 / +5, CM1 TE / All, GS RB / WR-TE, SY +25% / No Long / Fluke, 1H +30% / No Long):

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QBRu-25 | Under | 178-129 | **+9.5%** | -1 to +20 | 0.194 | 0.66 | +10.1 | +5.3% | 73-61 (+3%) | 63-48 (+7%) | 42-20 (+28%) | 4-0 (+88%) | 77-61 (+5%) |
| QB-R1 | Under | 110-65 | **+18.7%** | +4 to +33 | 0.067 | 0.44 | +19.7 | +14.2% | 48-37 (+7%) | 41-22 (+23%) | 21-6 (+47%) | – | 48-37 (+7%) |
| QB-R2 | Under | 47-26 | **+21.3%** | +5 to +39 | 0.067 | 0.45 | +22.4 | +16.6% | 15-14 (-3%) | 22-9 (+34%) | 10-3 (+45%) | 2-0 (+88%) | 17-14 (+3%) |
| CM1-TE | Under | 37-16 | **+32.0%** | +12 to +51 | 0.010 | 0.35 | +28.2 | +26.9% | – | 21-10 (+28%) | 16-6 (+38%) | 5-2 (+36%) | 5-2 (+36%) |
| CM1-20 | Under | 68-40 | **+19.2%** | +6 to +35 | 0.010 | 0.35 | +18.4 | +14.6% | – | 45-24 (+24%) | 23-16 (+11%) | 3-4 (-19%) | 3-4 (-19%) |
| SC2 | Under | 72-48 | **+13.3%** | -6 to +32 | 0.377 | 0.96 | +13.7 | +8.9% | 24-24 (-6%) | 28-16 (+20%) | 20-8 (+35%) | 3-1 (+43%) | 27-25 (-2%) |
| SC1 | Under | 223-173 | **+6.5%** | -4 to +18 | 0.441 | 1.00 | +7.1 | +2.4% | 76-79 (-7%) | 78-63 (+5%) | 69-31 (+31%) | 10-5 (+26%) | 86-84 (-4%) |
| SY-R25 | Under | 71-38 | **+22.9%** | +5 to +39 | 0.108 | 0.44 | +22.0 | +18.2% | 10-12 (-15%) | 36-19 (+24%) | 25-7 (+47%) | 4-2 (+26%) | 13-14 (-10%) |
| SY-NL | Under | 149-102 | **+12.1%** | -3 to +25 | 0.193 | 0.81 | +11.7 | +7.8% | 38-43 (-12%) | 63-41 (+14%) | 48-18 (+38%) | 8-2 (+51%) | 44-45 (-7%) |
| SY-YPC | Under | 80-50 | **+16.1%** | +0 to +31 | 0.148 | 0.55 | +15.9 | +11.6% | 22-18 (+3%) | 41-24 (+19%) | 17-8 (+28%) | 6-2 (+42%) | 26-20 (+6%) |
| FH-R30 | Under | 137-98 | **+10.1%** | -2 to +22 | 0.193 | 0.81 | +10.6 | +5.9% | 37-42 (-11%) | 60-37 (+17%) | 40-19 (+28%) | 8-3 (+37%) | 41-45 (-10%) |
| FH-NL | Under | 305-233 | **+7.1%** | -1 to +15 | 0.161 | 0.69 | +7.7 | +3.0% | 104-108 (-8%) | 113-78 (+12%) | 88-47 (+23%) | 17-8 (+29%) | 111-114 (-7%) |

**Indicators page:**

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QBCH | Under | 290-238 | **+3.5%** | -4 to +10 | 0.473 | 1.00 | +3.8 | -0.5% | 92-82 (-1%) | 123-94 (+7%) | 75-62 (+3%) | 18-15 (+3%) | 110-97 (-0%) |
| L9 | Under | 167-126 | **+7.7%** | -3 to +18 | 0.377 | 0.88 | +9.3 | +3.5% | 67-65 (-4%) | 64-37 (+20%) | 36-24 (+14%) | 9-5 (+22%) | 145-115 (+5%) |
| L10 | Under | 117-80 | **+9.7%** | -2 to +22 | 0.377 | 0.81 | +8.1 | +5.9% | – | 78-50 (+13%) | 39-30 (+4%) | 12-8 (+11%) | 96-68 (+8%) |
| S03 | Under | 281-252 | **-0.3%** | -9 to +8 | 0.836 | 1.00 | +1.3 | -4.1% | 104-119 (-12%) | 109-84 (+7%) | 68-49 (+10%) | 20-14 (+12%) | 250-231 (-2%) |
| SP1 | Under | 207-135 | **+14.3%** | +2 to +25 | 0.176 | 0.45 | +14.5 | +9.9% | 50-41 (+3%) | 97-59 (+18%) | 60-35 (+19%) | 31-14 (+30%) | 81-55 (+12%) |
| SP2 | Under | 153-94 | **+16.2%** | +2 to +30 | 0.176 | 0.45 | +15.3 | +12.0% | – | 95-58 (+17%) | 58-36 (+16%) | 32-13 (+32%) | 32-13 (+32%) |
| SP3 | Over | 29-19 | **+14.4%** | -16 to +44 | 0.463 | 1.00 | +17.5 | +10.0% | – | 19-14 (+9%) | 10-5 (+26%) | 5-2 (+35%) | 5-2 (+35%) |
| SP4 | Under | 29-20 | **+12.1%** | -20 to +41 | 0.577 | 1.00 | +19.7 | +7.8% | – | 21-13 (+17%) | 8-7 (+1%) | 5-2 (+35%) | 5-2 (+35%) |
| SP5 | Under | 528-410 | **+5.7%** | +0 to +11 | 0.176 | 0.54 | +6.1 | +1.7% | 208-171 (+2%) | 180-133 (+8%) | 140-106 (+8%) | 18-14 (+6%) | 226-185 (+2%) |
| BL-200 | Under | 176-149 | **+2.4%** | -9 to +12 | 0.455 | 1.00 | +2.9 | -1.6% | 50-69 (-21%) | 62-48 (+7%) | 64-32 (+26%) | 15-3 (+58%) | 58-71 (-15%) |
| NL-U20 | Under | 158-147 | **-2.2%** | -14 to +9 | 0.694 | 1.00 | -1.9 | -5.9% | 45-73 (-29%) | 55-45 (+4%) | 58-29 (+26%) | 6-2 (+42%) | 46-73 (-28%) |

Verdict by tile:
- **Keep, strongest**: QBRu (prefer "avg 25"), CM1 (TE and All). Note that CM1-20 lost in weeks 10–11.
- **Keep, modest**: SP1, SP2, SP5 (positive all seasons, small to moderate ROI).
- **Weakened by 2024**: GS (SC1 2024 −7%, SC2 2024 −6%), SY +25%, SY No Long, 1H +30%, 1H No Long (all negative in 2024; still positive overall only because of the 2025–26 discovery data).
- **Failed**: BL-200 and NL-U20 (2024 −21% and −29%), S03 (−12% in 2024, about 0% overall), L9 (2024 −4%), QBCH (2024 −1%).
- **Consider replacing SY +25% / No Long with SY-c40 and SY-YPC**, which held up in 2024.
## 6. Every named thesis (frozen leads, audit shortlist, combos)

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SP2 | Under | 153-94 | **+16.2%** | +2 to +30 | 0.176 | 0.45 | +15.3 | +12.0% | – | 95-58 (+17%) | 58-36 (+16%) | 32-13 (+32%) | 32-13 (+32%) |
| SP1 | Under | 207-135 | **+14.3%** | +2 to +25 | 0.176 | 0.45 | +14.5 | +9.9% | 50-41 (+3%) | 97-59 (+18%) | 60-35 (+19%) | 31-14 (+30%) | 81-55 (+12%) |
| COMBO-C1 | Under | 44-17 | **+26.0%** | +3 to +47 | 0.176 | 0.51 | +24.5 | +22.2% | – | 28-10 (+30%) | 16-7 (+19%) | 3-3 (-14%) | 3-3 (-14%) |
| SP5 | Under | 528-410 | **+5.7%** | +0 to +11 | 0.176 | 0.54 | +6.1 | +1.7% | 208-171 (+2%) | 180-133 (+8%) | 140-106 (+8%) | 18-14 (+6%) | 226-185 (+2%) |
| L1 | Under | 451-346 | **+6.5%** | +0 to +13 | 0.176 | 0.54 | +7.0 | +2.5% | 113-103 (-1%) | 196-147 (+7%) | 142-96 (+12%) | 35-15 (+32%) | 361-283 (+5%) |
| L10 | Under | 117-80 | **+9.7%** | -2 to +22 | 0.377 | 0.81 | +8.1 | +5.9% | – | 78-50 (+13%) | 39-30 (+4%) | 12-8 (+11%) | 96-68 (+8%) |
| L9 | Under | 167-126 | **+7.7%** | -3 to +18 | 0.377 | 0.88 | +9.3 | +3.5% | 67-65 (-4%) | 64-37 (+20%) | 36-24 (+14%) | 9-5 (+22%) | 145-115 (+5%) |
| SC2-all | Under | 78-52 | **+13.2%** | -6 to +31 | 0.377 | 0.93 | +13.7 | +8.9% | 25-25 (-6%) | 32-18 (+21%) | 21-9 (+32%) | 3-1 (+43%) | 28-26 (-2%) |
| SC2 | Under | 72-48 | **+13.3%** | -6 to +32 | 0.377 | 0.96 | +13.7 | +8.9% | 24-24 (-6%) | 28-16 (+20%) | 20-8 (+35%) | 3-1 (+43%) | 27-25 (-2%) |
| SC1-all | Under | 244-188 | **+6.8%** | -3 to +17 | 0.377 | 0.98 | +7.4 | +2.7% | 82-83 (-6%) | 85-69 (+4%) | 77-36 (+29%) | 12-6 (+26%) | 94-89 (-3%) |
| COMBO-D | Under | 67-47 | **+10.9%** | -6 to +27 | 0.377 | 0.98 | +11.5 | +6.6% | 28-22 (+5%) | 21-18 (+2%) | 18-7 (+37%) | – | 28-22 (+5%) |
| SC1 | Under | 223-173 | **+6.5%** | -4 to +18 | 0.441 | 1.00 | +7.1 | +2.4% | 76-79 (-7%) | 78-63 (+5%) | 69-31 (+31%) | 10-5 (+26%) | 86-84 (-4%) |
| L2 | Under | 1475-1220 | **+1.9%** | -2 to +5 | 0.463 | 1.00 | +2.7 | -1.9% | 420-382 (-2%) | 615-517 (+1%) | 440-321 (+7%) | 86-61 (+9%) | 1210-1031 (+0%) |
| SP3 | Over | 29-19 | **+14.4%** | -16 to +44 | 0.463 | 1.00 | +17.5 | +10.0% | – | 19-14 (+9%) | 10-5 (+26%) | 5-2 (+35%) | 5-2 (+35%) |
| QBCH | Under | 290-238 | **+3.5%** | -4 to +10 | 0.473 | 1.00 | +3.8 | -0.5% | 92-82 (-1%) | 123-94 (+7%) | 75-62 (+3%) | 18-15 (+3%) | 110-97 (-0%) |
| SP4 | Under | 29-20 | **+12.1%** | -20 to +41 | 0.577 | 1.00 | +19.7 | +7.8% | – | 21-13 (+17%) | 8-7 (+1%) | 5-2 (+35%) | 5-2 (+35%) |
| TE-RY | Under | 1025-881 | **+1.3%** | -3 to +5 | 0.602 | 1.00 | +0.0 | -2.5% | 365-339 (-3%) | 376-314 (+3%) | 284-228 (+5%) | 48-36 (+8%) | 413-375 (-2%) |
| RET-U | Under | 308-257 | **+2.6%** | -6 to +12 | 0.602 | 1.00 | +3.4 | -1.2% | 61-67 (-11%) | 149-105 (+10%) | 98-85 (+1%) | 30-24 (+5%) | 91-91 (-6%) |
| L3 | Under | 664-567 | **+1.7%** | -4 to +7 | 0.602 | 1.00 | +0.5 | -2.2% | 241-233 (-5%) | 246-208 (+2%) | 177-126 (+11%) | 31-18 (+19%) | 546-487 (-0%) |
| LOWP-U | Under | 189-152 | **+3.1%** | -7 to +15 | 0.602 | 1.00 | +3.4 | -0.6% | 55-41 (+7%) | 86-74 (+0%) | 48-37 (+4%) | 8-10 (-16%) | 63-51 (+3%) |
| COMBO-C2 | Under | 170-143 | **+2.6%** | -8 to +13 | 0.626 | 1.00 | +4.3 | -1.3% | 63-70 (-11%) | 57-48 (+3%) | 50-25 (+26%) | 13-8 (+17%) | 76-78 (-7%) |
| L4 | Under | 642-553 | **+0.3%** | -5 to +5 | 0.836 | 1.00 | +0.7 | -3.4% | 234-199 (+0%) | 236-231 (-5%) | 172-123 (+9%) | 20-25 (-17%) | 524-473 (-2%) |
| L5 | Under | 525-446 | **+0.4%** | -6 to +6 | 0.836 | 1.00 | +0.4 | -3.3% | 147-141 (-4%) | 239-202 (+1%) | 139-103 (+5%) | 33-33 (-7%) | 458-399 (-1%) |
| S04b | Under | 142-126 | **+0.1%** | -11 to +12 | 0.836 | 1.00 | +1.7 | -3.7% | 56-58 (-7%) | 56-40 (+11%) | 30-28 (-2%) | 6-8 (-19%) | 127-114 (-0%) |
| S03 | Under | 281-252 | **-0.3%** | -9 to +8 | 0.836 | 1.00 | +1.3 | -4.1% | 104-119 (-12%) | 109-84 (+7%) | 68-49 (+10%) | 20-14 (+12%) | 250-231 (-2%) |
| USG-ST-U | Under | 673-599 | **-0.2%** | -5 to +4 | 0.836 | 1.00 | +0.3 | -4.0% | 247-247 (-6%) | 263-214 (+4%) | 163-138 (+2%) | 27-26 (-4%) | 274-273 (-6%) |
| S04a | Under | 139-126 | **-0.7%** | -12 to +11 | 0.836 | 1.00 | +0.8 | -4.5% | 48-61 (-17%) | 53-44 (+4%) | 38-21 (+22%) | 14-6 (+33%) | 123-117 (-3%) |
| L6 | Under | 168-151 | **-0.7%** | -10 to +9 | 0.836 | 1.00 | -0.4 | -4.5% | 53-54 (-7%) | 70-67 (-3%) | 45-30 (+13%) | 9-7 (+7%) | 139-137 (-5%) |
| COMBO-B | Under | 4-4 | **-4.6%** | -73 to +66 | – | – | -2.6 | -8.4% | 2-1 (+29%) | 1-1 (-7%) | 1-2 (-36%) | 1-0 (+91%) | 3-1 (+44%) |
| SC4 | Under | 62-58 | **-2.2%** | -23 to +19 | 0.858 | 1.00 | +5.3 | -6.0% | – | 44-42 (-3%) | 18-16 (+0%) | 3-3 (-5%) | 3-3 (-5%) |
| USG-UP-U | Under | 1045-941 | **-0.6%** | -5 to +4 | 0.858 | 1.00 | +0.1 | -4.4% | 375-385 (-7%) | 412-340 (+4%) | 258-216 (+3%) | 58-39 (+13%) | 433-424 (-5%) |
| RET3-U | Under | 91-88 | **-4.1%** | -19 to +12 | 0.937 | 1.00 | -2.9 | -7.8% | 15-23 (-25%) | 46-33 (+10%) | 30-32 (-9%) | 13-9 (+13%) | 28-32 (-11%) |
| L2h | Under | 1479-1314 | **-1.3%** | -5 to +2 | 0.997 | 1.00 | -0.5 | -4.9% | 444-451 (-7%) | 610-523 (+0%) | 425-340 (+3%) | 72-59 (+2%) | 1210-1093 (-2%) |
| USG-DN-U | Under | 952-908 | **-3.5%** | -9 to +2 | 1.000 | 1.00 | -2.8 | -7.2% | 377-355 (-3%) | 363-332 (-1%) | 212-221 (-8%) | 48-51 (-8%) | 425-406 (-4%) |
| COMBO-E | Under | 155-159 | **-6.7%** | -17 to +4 | 1.000 | 1.00 | -5.3 | -10.3% | 52-75 (-23%) | 68-57 (+3%) | 35-27 (+7%) | 9-8 (+0%) | 61-83 (-20%) |
| SC1c | Under | 616-585 | **-3.2%** | -8 to +2 | 1.000 | 1.00 | -2.4 | -6.9% | 237-256 (-10%) | 239-189 (+6%) | 140-140 (-5%) | 29-23 (+6%) | 266-279 (-8%) |
| L7 | Over | 54-71 | **-18.2%** | -37 to +1 | 1.000 | 1.00 | -15.2 | -21.4% | – | 31-53 (-30%) | 23-18 (+6%) | 3-6 (-37%) | 36-65 (-33%) |
| SC3 | Over | 27-40 | **-23.7%** | -46 to -0 | 1.000 | 1.00 | -20.5 | -26.7% | – | 18-30 (-29%) | 9-10 (-10%) | 3-5 (-29%) | 3-5 (-29%) |
| USG-DN-O | Over | 908-952 | **-8.0%** | -14 to -3 | 1.000 | 1.00 | +2.9 | -11.5% | 355-377 (-9%) | 332-363 (-10%) | 221-212 (-3%) | 51-48 (-2%) | 406-425 (-9%) |
| LOWP-O | Over | 152-189 | **-15.9%** | -28 to -5 | 1.000 | 1.00 | -4.5 | -19.0% | 41-55 (-20%) | 74-86 (-12%) | 37-48 (-17%) | 10-8 (+4%) | 51-63 (-16%) |
| L8 | Over | 330-420 | **-17.1%** | -24 to -10 | 1.000 | 1.00 | -6.1 | -20.3% | 115-126 (-11%) | 122-198 (-28%) | 93-96 (-7%) | 16-30 (-34%) | 271-376 (-21%) |
| USG-UP-O | Over | 941-1045 | **-10.9%** | -15 to -7 | 1.000 | 1.00 | -0.1 | -14.3% | 385-375 (-6%) | 340-412 (-14%) | 216-258 (-14%) | 39-58 (-24%) | 424-433 (-8%) |
| USG-ST-O | Over | 599-673 | **-11.3%** | -16 to -7 | 1.000 | 1.00 | -0.3 | -14.7% | 247-247 (-7%) | 214-263 (-15%) | 138-163 (-13%) | 26-27 (-7%) | 273-274 (-7%) |

- **SP2**: Team a 10+ pt underdog -> receptions Under. *Source: audit / indicator.*
- **SP1**: Team a 10+ pt underdog -> WR/TE/RB receiving yards Under. *Source: audit / indicator.*
- **COMBO-C1**: L10 (rising WR receptions) AND receptions line raised vs last game. *Source: audit combo.*
- **SP5**: Team a 3 to 6.5 pt underdog -> QB/RB rushing yards Under. *Source: audit / indicator.*
- **L1**: WR2 (approx slot): same-stat line in his team's previous game went Over -> Under; all 4 markets. *Source: frozen lead 1 (2026 discovery).*
- **L10**: WR receptions rose in each of his last 3 games (strictly) -> receptions Under. *Source: lead 10 / indicator.*
- **L9**: WR: each of his last 3 games played went Over its graded rec-yds line -> Under. *Source: lead 9 / indicator.*
- **SC2-all**: SC2 on every quoted RB. *Source: variant.*
- **SC2**: RB (slotted): team led by 7+ on half its plays last game, he went Over his rush line, line raised -> rush yds Under. *Source: Signals page (GS RB).*
- **SC1-all**: SC1 on every quoted WR/TE (no slot filter). *Source: variant.*
- **COMBO-D**: RB rush Under, team +3 to +6.5, team covered last game, opponent did not. *Source: audit combo.*
- **SC1**: WR/TE (slotted): team trailed by 7+ on half its plays last game, he went Over, line raised -> rec yds Under. *Source: Signals page (GS WR/TE).*
- **L2**: Away team AND line higher than his line in his team's previous game -> Under; all markets, all quoted players. *Source: frozen lead 2.*
- **SP3**: Team favoured by 10+ -> QB passing yards Over. *Source: audit / indicator.*
- **QBCH**: WR/TE rec yds Under when his team's QB this game is not the 1st-quarter QB of its previous game. *Source: Indicators page.*
- **SP4**: Team a 10+ pt underdog -> QB passing yards Under. *Source: audit / indicator.*
- **TE-RY**: Any TE receiving yards -> Under (base rate). *Source: audit.*
- **RET-U**: First game back after missing 1+ team games -> Under (any market). *Source: audit.*
- **L3**: TE1 (approx slot) receiving yards -> Under. *Source: frozen lead 3.*
- **LOWP-U**: Same trigger -> Under. *Source: audit.*
- **COMBO-C2**: S03 (rising WR rec yds) AND rec-yds line raised. *Source: audit combo.*
- **L4**: QB1 rushing yards -> Under. *Source: frozen lead 4.*
- **L5**: Usage down (last-2 avg target share 5+ pts / RB snap share 10+ pts below his earlier games; 4+ games) AND line within 5 yds / 0.5 of last game's line -> Under. *Source: frozen lead 5.*
- **S04b**: S03 WITHOUT a 3+ pt target-share rise. *Source: audit.*
- **S03**: WR receiving yards rose in each of his last 3 games -> Under. *Source: indicator.*
- **USG-ST-U**: WR/TE rec yds Under when target share within 3 pts in his last game vs the game before. *Source: audit.*
- **S04a**: S03 AND target share up 3+ pts in his last game. *Source: audit.*
- **L6**: Team favoured by 7+ -> RB rushing yards Under. *Source: frozen lead 6.*
- **COMBO-B**: L9 AND team a 10+ pt underdog. *Source: audit combo.*
- **SC4**: Team trailed by 13+ on 40%+ of plays last game -> QB pass yds Under. *Source: audit.*
- **USG-UP-U**: WR/TE rec yds Under when target share up 3+ pts in his last game vs the game before. *Source: audit.*
- **RET3-U**: First game back after missing 3+ team games -> Under. *Source: audit.*
- **L2h**: Control for L2: home team, line raised -> Under. *Source: audit control.*
- **USG-DN-U**: WR/TE rec yds Under when target share down 3+ pts in his last game vs the game before. *Source: audit.*
- **COMBO-E**: WR: last game 50%+ above his prior-3 average, line raised, target share up no more than 10 pts. *Source: audit combo.*
- **SC1c**: Control: same but team did NOT trail 7+ on half its plays. *Source: audit control.*
- **L7**: Team a 7+ underdog -> QB passing yards Over. *Source: frozen lead 7.*
- **SC3**: Team passes 10+ pts more often when down 13+ than when close (season to date) AND is a 7+ underdog -> QB pass yds Over. *Source: audit.*
- **USG-DN-O**: WR/TE rec yds Over when target share down 3+ pts in his last game vs the game before. *Source: audit.*
- **LOWP-O**: Last game his snap share fell 20+ pts and 40%+ below his prior 3 -> Over. *Source: audit.*
- **L8**: Team a 7+ underdog -> WR/TE receiving yards Over. *Source: frozen lead 8.*
- **USG-UP-O**: WR/TE rec yds Over when target share up 3+ pts in his last game vs the game before. *Source: audit.*
- **USG-ST-O**: WR/TE rec yds Over when target share within 3 pts in his last game vs the game before. *Source: audit.*

## 7. QB rushing study

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QB-R3 | Under | 37-15 | **+33.3%** | +9 to +55 | 0.067 | 0.44 | +34.1 | +28.3% | 15-7 (+26%) | 14-6 (+33%) | 8-2 (+49%) | – | 15-7 (+26%) |
| QB-R1 | Under | 110-65 | **+18.7%** | +4 to +33 | 0.067 | 0.44 | +19.7 | +14.2% | 48-37 (+7%) | 41-22 (+23%) | 21-6 (+47%) | – | 48-37 (+7%) |
| QB-R2 | Under | 47-26 | **+21.3%** | +5 to +39 | 0.067 | 0.45 | +22.4 | +16.6% | 15-14 (-3%) | 22-9 (+34%) | 10-3 (+45%) | 2-0 (+88%) | 17-14 (+3%) |
| QB-R2a | Under | 31-17 | **+21.8%** | -2 to +46 | 0.194 | 0.66 | +22.5 | +17.1% | 9-10 (-12%) | 14-5 (+40%) | 8-2 (+51%) | 2-0 (+88%) | 11-10 (-2%) |
| QBRu-25 | Under | 178-129 | **+9.5%** | -1 to +20 | 0.194 | 0.66 | +10.1 | +5.3% | 73-61 (+3%) | 63-48 (+7%) | 42-20 (+28%) | 4-0 (+88%) | 77-61 (+5%) |
| QB-R2+7 | Under | 21-10 | **+27.8%** | -4 to +59 | 0.194 | 0.70 | +27.9 | +22.9% | 6-7 (-13%) | 9-1 (+70%) | 6-2 (+41%) | 2-0 (+88%) | 8-7 (+0%) |
| QB-R1s | Under | 66-39 | **+18.7%** | -4 to +41 | 0.213 | 0.81 | +19.9 | +14.2% | 32-26 (+4%) | 24-11 (+30%) | 10-2 (+57%) | – | 32-26 (+4%) |
| QB-R4-25-39.5-U | Under | 135-100 | **+8.5%** | -3 to +20 | 0.224 | 0.88 | +9.0 | +4.4% | 46-41 (-0%) | 51-40 (+6%) | 38-19 (+26%) | 4-0 (+88%) | 50-41 (+3%) |
| QB-R4-dog7+-U | Under | 93-68 | **+8.4%** | -5 to +22 | 0.308 | 1.00 | +9.1 | +4.3% | 27-21 (+5%) | 42-30 (+9%) | 24-17 (+11%) | 5-4 (+5%) | 32-25 (+5%) |
| QB-R4-away-U | Under | 361-288 | **+4.1%** | -3 to +11 | 0.315 | 1.00 | +4.6 | +0.2% | 138-101 (+7%) | 128-124 (-5%) | 95-63 (+13%) | 12-13 (-10%) | 150-114 (+6%) |
| QB-R4-40+-U | Under | 43-29 | **+12.5%** | -15 to +39 | 0.448 | 1.00 | +13.7 | +8.2% | 27-20 (+8%) | 12-8 (+13%) | 4-1 (+51%) | – | 27-20 (+8%) |
| QB-R4-dog-U | Under | 359-297 | **+2.4%** | -4 to +9 | 0.540 | 1.00 | +2.8 | -1.5% | 130-108 (+1%) | 137-120 (+0%) | 92-69 (+8%) | 12-13 (-9%) | 142-121 (+0%) |
| QB-R4-outdoor<50F-U | Under | 91-76 | **+2.0%** | -16 to +18 | 0.808 | 1.00 | +5.3 | -1.8% | 40-30 (+8%) | 51-46 (-2%) | – | – | 40-30 (+8%) |
| QB-RU | Under | 696-609 | **-0.4%** | -5 to +4 | 0.960 | 1.00 | -0.0 | -4.1% | 258-223 (-0%) | 255-249 (-5%) | 183-137 (+7%) | 23-27 (-14%) | 281-250 (-2%) |
| QB-R4-<=1.5-U | Under | 74-56 | **-1.2%** | -18 to +15 | 0.960 | 1.00 | -1.3 | -4.2% | 23-13 (+12%) | 31-22 (-1%) | 20-21 (-13%) | 2-4 (-41%) | 25-17 (+4%) |
| QB-R4-fav7+-U | Under | 89-80 | **-2.2%** | -17 to +12 | 0.960 | 1.00 | -1.6 | -5.8% | 27-29 (-10%) | 39-33 (-0%) | 23-18 (+5%) | 6-3 (+23%) | 33-32 (-5%) |
| QB-R4-2-14.5-U | Under | 306-276 | **-1.2%** | -7 to +5 | 0.960 | 1.00 | -0.9 | -4.9% | 117-104 (-2%) | 106-107 (-6%) | 83-65 (+6%) | 12-14 (-12%) | 129-118 (-3%) |
| QB-R4-15-24.5-O | Over | 148-138 | **-2.4%** | -14 to +9 | 0.960 | 1.00 | +8.7 | -6.2% | 45-45 (-7%) | 72-55 (+7%) | 31-38 (-15%) | 9-5 (+22%) | 54-50 (-3%) |
| QB-R4-wind15+-U | Under | 33-32 | **-5.9%** | -25 to +13 | 0.990 | 1.00 | -2.6 | -9.3% | 12-15 (-18%) | 21-17 (+3%) | – | – | 12-15 (-18%) |
| QB-R4-fav-U | Under | 337-312 | **-3.2%** | -10 to +4 | 1.000 | 1.00 | -2.8 | -6.8% | 128-115 (-2%) | 118-129 (-11%) | 91-68 (+7%) | 11-14 (-18%) | 139-129 (-3%) |
| QB-R4-<=1.5-O | Over | 56-74 | **-13.1%** | -31 to +6 | 1.000 | 1.00 | -1.4 | -16.7% | 13-23 (-28%) | 22-31 (-16%) | 21-20 (+4%) | 4-2 (+33%) | 17-25 (-20%) |
| QB-R4-home-U | Under | 335-321 | **-4.9%** | -12 to +2 | 1.000 | 1.00 | -4.5 | -8.4% | 120-122 (-8%) | 127-125 (-6%) | 88-74 (+2%) | 11-14 (-17%) | 131-136 (-9%) |
| QB-R4-15-24.5-U | Under | 138-148 | **-9.1%** | -21 to +2 | 1.000 | 1.00 | -8.4 | -12.6% | 45-45 (-7%) | 55-72 (-18%) | 38-31 (+4%) | 5-9 (-33%) | 50-54 (-10%) |
| QB-R4-40+-O | Over | 29-43 | **-24.5%** | -51 to +3 | 1.000 | 1.00 | -13.2 | -27.4% | 20-27 (-21%) | 8-12 (-24%) | 1-4 (-62%) | – | 20-27 (-21%) |
| QB-R4-2-14.5-O | Over | 276-306 | **-10.6%** | -17 to -4 | 1.000 | 1.00 | +1.1 | -14.0% | 104-117 (-12%) | 107-106 (-5%) | 65-83 (-17%) | 14-12 (+1%) | 118-129 (-10%) |
| QB-R4-25-39.5-O | Over | 100-135 | **-20.0%** | -31 to -9 | 1.000 | 1.00 | -8.5 | -23.0% | 41-46 (-12%) | 40-51 (-17%) | 19-38 (-37%) | 0-4 (-100%) | 41-50 (-16%) |

- **QB-R3**: Small line (<15) that is 5+ above his last-3 average -> Under. *Source: audit.*
- **QB-R1**: QBRu 'avg 25': line 25+ AND he averaged 25+ rush yds over his last 3 games played. *Source: Signals page QBRu mode 2.*
- **QB-R2**: QBRu '+5': line 5+ yds above his line in his team's previous game. *Source: Signals page QBRu mode 3.*
- **QB-R2a**: Audit version: line more than 5 above his line at his previous PLAYED game. *Source: audit.*
- **QBRu-25**: QBRu '25+': any QB rushing line of 25 or more. *Source: Signals page QBRu mode 1.*
- **QB-R2+7**: Line 7+ above previous game's line. *Source: old page toggle.*
- **QB-R1s**: Sensitivity: 30/30 instead of 25/25. *Source: audit.*
- **QB-R4-25-39.5-U**: QB rushing line 25-39.5 -> Under. *Source: audit.*
- **QB-R4-dog7+-U**: QB rushing Under when dog7+. *Source: audit.*
- **QB-R4-away-U**: QB rushing Under when away. *Source: audit.*
- **QB-R4-40+-U**: QB rushing line 40+ -> Under. *Source: audit.*
- **QB-R4-dog-U**: QB rushing Under when dog. *Source: audit.*
- **QB-R4-outdoor<50F-U**: QB rushing Under when outdoor<50F. *Source: audit.*
- **QB-RU**: Every QB rushing line -> Under. *Source: audit.*
- **QB-R4-<=1.5-U**: QB rushing line <=1.5 -> Under. *Source: audit.*
- **QB-R4-fav7+-U**: QB rushing Under when fav7+. *Source: audit.*
- **QB-R4-2-14.5-U**: QB rushing line 2-14.5 -> Under. *Source: audit.*
- **QB-R4-15-24.5-O**: QB rushing line 15-24.5 -> Over. *Source: audit.*
- **QB-R4-wind15+-U**: QB rushing Under when wind15+. *Source: audit.*
- **QB-R4-fav-U**: QB rushing Under when fav. *Source: audit.*
- **QB-R4-<=1.5-O**: QB rushing line <=1.5 -> Over. *Source: audit.*
- **QB-R4-home-U**: QB rushing Under when home. *Source: audit.*
- **QB-R4-15-24.5-U**: QB rushing line 15-24.5 -> Under. *Source: audit.*
- **QB-R4-40+-O**: QB rushing line 40+ -> Over. *Source: audit.*
- **QB-R4-2-14.5-O**: QB rushing line 2-14.5 -> Over. *Source: audit.*
- **QB-R4-25-39.5-O**: QB rushing line 25-39.5 -> Over. *Source: audit.*

## 8. CM (correlated line movement; 2025–2026 only)

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CM1-TE | Under | 37-16 | **+32.0%** | +12 to +51 | 0.010 | 0.35 | +28.2 | +26.9% | – | 21-10 (+28%) | 16-6 (+38%) | 5-2 (+36%) | 5-2 (+36%) |
| CM1-20 | Under | 68-40 | **+19.2%** | +6 to +35 | 0.010 | 0.35 | +18.4 | +14.6% | – | 45-24 (+24%) | 23-16 (+11%) | 3-4 (-19%) | 3-4 (-19%) |
| CM1 | Under | 132-83 | **+16.2%** | +5 to +28 | 0.010 | 0.35 | +15.3 | +11.7% | – | 85-56 (+14%) | 47-27 (+20%) | 13-8 (+17%) | 13-8 (+17%) |
| CM1-ctl | Under | 127-99 | **+6.6%** | -2 to +16 | 0.149 | 0.88 | +5.8 | +2.4% | – | 82-58 (+11%) | 45-41 (-1%) | 7-9 (-17%) | 7-9 (-17%) |
| CM1-RB | Under | 33-21 | **+15.8%** | -5 to +37 | 0.149 | 0.88 | +15.5 | +11.3% | – | 21-15 (+11%) | 12-6 (+25%) | 4-1 (+50%) | 4-1 (+50%) |
| CM1-10 | Under | 173-129 | **+8.4%** | -3 to +20 | 0.149 | 0.93 | +7.6 | +4.3% | – | 107-78 (+9%) | 66-51 (+7%) | 21-20 (-3%) | 21-20 (-3%) |
| CM1-WR | Under | 62-46 | **+8.6%** | -9 to +24 | 0.246 | 1.00 | +8.9 | +4.4% | – | 43-31 (+10%) | 19-15 (+6%) | 4-5 (-16%) | 4-5 (-16%) |
| CM1-rec | Under | 123-87 | **+7.0%** | -11 to +24 | 0.293 | 1.00 | +6.2 | +3.4% | – | 70-51 (+7%) | 53-36 (+7%) | 15-6 (+31%) | 15-6 (+31%) |
| CM3 | Under | 54-52 | **-3.6%** | -20 to +15 | 0.812 | 1.00 | +4.8 | -7.3% | – | 31-29 (-2%) | 23-23 (-5%) | 4-4 (-5%) | 4-4 (-5%) |
| CM2 | Over | 112-124 | **-10.1%** | -22 to +2 | 0.990 | 1.00 | +1.3 | -13.6% | – | 63-63 (-5%) | 49-61 (-16%) | 11-24 (-40%) | 11-24 (-40%) |
| CM3d | Over | 36-56 | **-25.9%** | -45 to -5 | 0.990 | 1.00 | -22.9 | -28.8% | – | 24-38 (-27%) | 12-18 (-24%) | 4-3 (+8%) | 4-3 (+8%) |

- **CM1-TE**: CM1, TE only (Signals page CM1 TE). *Source: audit / Signals page.*
- **CM1-20**: As CM1 with QB drop 20+ (Signals page CM1 'All'). *Source: Signals page.*
- **CM1**: QB pass-yds line down 15+ vs last week AND his receivers' rec-yds lines fell 10+ yds less in total -> every matched receiver's rec yds Under. *Source: audit.*
- **CM1-ctl**: Control: QB down 15+ but receivers' lines DID follow (gap < 10). *Source: audit control.*
- **CM1-RB**: CM1, RB only. *Source: audit / Signals page.*
- **CM1-10**: As CM1 with QB drop 10+. *Source: audit.*
- **CM1-WR**: CM1, WR only. *Source: audit / Signals page.*
- **CM1-rec**: QB down 15+, receivers' receptions lines not cut at all -> receptions Under. *Source: audit.*
- **CM3**: QB pass-yds line up 15+ vs last week -> Under. *Source: audit.*
- **CM2**: Mirror: QB line up 15+, receivers' lines lag -> rec yds Over. *Source: audit.*
- **CM3d**: QB pass-yds line down 15+ vs last week -> Over. *Source: audit.*

## 9. Line shopping

The Under at the highest line available across books at the same moment (and the best Under price at that line), against the DK main line. 2024–2025: raw snapshots, 10 books. 2026: weeks 8–11 only (the other-books pulls started in week 8).

| Books | Side | Subset | Market | Bets | ROI | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| all books | Under | all | ALL | 13,757 | **+1.8%** | +0.1% (4435) | +2.8% (7495) | +1.5% (1827) |
| all books | Under | best line above DK/FD main | ALL | 7,261 | **+0.1%** | -0.0% (2647) | +1.0% (3823) | -3.7% (791) |
| all books | Under | best line 5+ yds above DK/FD main | ALL | 405 | **+6.3%** | +13.6% (132) | +3.5% (241) | -2.4% (32) |
| all books | Over | all | ALL | 13,757 | **-8.4%** | -7.6% (4435) | -8.8% (7495) | -9.4% (1827) |
| major books (no Fliff/Bally) | Under | all | ALL | 13,757 | **+1.8%** | +0.1% (4435) | +2.9% (7495) | +1.2% (1827) |
| major books (no Fliff/Bally) | Under | best line above DK/FD main | ALL | 7,088 | **+0.3%** | -0.0% (2644) | +1.2% (3665) | -3.3% (779) |
| major books (no Fliff/Bally) | Under | best line 5+ yds above DK/FD main | ALL | 398 | **+6.8%** | +13.6% (132) | +4.2% (234) | -2.4% (32) |
| major books (no Fliff/Bally) | Under | best line 5+ yds above DK/FD main | rec_yds | 152 | **+9.1%** | +6.0% (90) | +18.2% (58) | -53.3% (4) |
| major books (no Fliff/Bally) | Under | best line 5+ yds above DK/FD main | rush_yds | 69 | **+20.3%** | +29.6% (42) | +4.0% (24) | +21.0% (3) |
| major books (no Fliff/Bally) | Under | best line 5+ yds above DK/FD main | pass_yds | 177 | **-0.5%** | – (0) | -1.1% (152) | +2.9% (25) |
| major books (no Fliff/Bally) | Over | all | ALL | 13,757 | **-8.5%** | -7.6% (4435) | -8.8% (7495) | -9.7% (1827) |
| DK + FD only | Under | all | ALL | 13,757 | **+1.0%** | -0.8% (4435) | +2.2% (7495) | +0.8% (1827) |
| DK + FD only | Under | best line above DK/FD main | ALL | 2,542 | **+0.1%** | +0.4% (1034) | -0.2% (1221) | +0.8% (287) |
| DK + FD only | Under | best line 5+ yds above DK/FD main | ALL | 31 | **-14.5%** | -52.3% (4) | +8.2% (21) | -68.6% (6) |
| DK + FD only | Over | all | ALL | 13,757 | **-9.7%** | -8.3% (4435) | -10.5% (7495) | -9.8% (1827) |
| reference: DK main (FD fallback) | Under | all | ALL | 13,757 | **-0.1%** | -2.1% (4435) | +0.9% (7495) | +0.2% (1827) |
| reference: DK main (FD fallback) | Over | all | ALL | 13,757 | **-11.7%** | -10.9% (4435) | -12.2% (7495) | -11.3% (1827) |

- Taking every Under at the best line among the major books (DK, FD, BetMGM, Caesars, BetRivers, theScore, Fanatics, Hard Rock) turns −0.1% into +1.8%. It was positive in every season (+0.1%, +2.9%, +1.2%).
- Only betting when another book's line is higher than DK/FD's adds nothing by itself (+0.3%). The gain comes from always taking the best number, not from disagreement as a signal. Exception: when a book is 5+ yds above DK/FD on rushing yards (69 bets, +20%), which is too small to rely on.
- Fliff and Bally are left out of "major books": they are less widely available (Fliff is a sweepstakes app).

Rules re-graded at the best line (props where other books' lines exist):

| Rule | Bets covered | ROI at DK line | ROI at best line | Change |
|---|---|---|---|---|
| L1 | 642 of 797 | +5.6% | +6.2% | +0.6 |
| L2 | 2218 of 2695 | +0.5% | +2.0% | +1.5 |
| L5 | 852 of 971 | -0.7% | +1.1% | +1.8 |
| L9 | 255 of 293 | +5.9% | +7.7% | +1.7 |
| S03 | 474 of 533 | -1.0% | +0.9% | +2.0 |
| SP1 | 299 of 342 | +14.3% | +17.3% | +3.0 |
| SP2 | 205 of 247 | +17.5% | +17.8% | +0.3 |
| SP5 | 769 of 938 | +5.0% | +8.3% | +3.2 |
| SC1 | 323 of 396 | +2.5% | +1.9% | -0.6 |
| SC2 | 99 of 120 | +4.9% | +6.2% | +1.3 |
| QBCH | 455 of 528 | +5.1% | +8.3% | +3.2 |
| QB-R1 | 157 of 175 | +18.0% | +19.2% | +1.2 |
| QB-R2 | 64 of 73 | +20.6% | +19.8% | -0.7 |
| QB-R3 | 43 of 52 | +26.4% | +40.3% | +13.9 |
| QBRu-25 | 260 of 307 | +9.6% | +10.8% | +1.2 |
| CM1 | 166 of 215 | +16.3% | +14.4% | -1.9 |
| CM1-20 | 75 of 108 | +18.9% | +14.8% | -4.1 |
| CM1-TE | 39 of 53 | +30.9% | +29.3% | -1.5 |
| SY | 288 of 349 | +12.6% | +12.8% | +0.1 |
| SY-R25 | 89 of 109 | +20.8% | +19.7% | -1.0 |
| SY-NL | 208 of 251 | +9.8% | +10.4% | +0.6 |
| SY-c40 | 185 of 241 | +23.6% | +23.2% | -0.4 |
| FH-R30 | 199 of 235 | +8.3% | +8.2% | -0.1 |
| FH-NL | 448 of 538 | +4.5% | +5.8% | +1.2 |
| BL-200 | 267 of 325 | -0.1% | +1.0% | +1.1 |
| NL-U20 | 240 of 305 | -7.2% | -5.8% | +1.4 |
| SEQ-RC-LUP-U | 564 of 772 | +8.1% | +9.8% | +1.7 |
| SPG-WR-rec-dog10+-U | 106 of 126 | +22.7% | +24.0% | +1.3 |
| WX1 | 595 of 606 | +12.3% | +12.7% | +0.4 |
| BASE-ALL-U | 13776 of 17328 | -0.1% | +1.7% | +1.9 |

## 10. Late-yardage family (all versions re-run)

Base for every row: last game Over his rec-yds line with 40+ yds, and this week's line higher. Bet the Under. Sorted by strength (p-value).

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SY-c40 | Under | 156-85 | **+22.3%** | +12 to +32 | 0.022 | 0.19 | +21.2 | +17.6% | 19-12 (+15%) | 80-47 (+19%) | 57-26 (+30%) | 12-3 (+52%) | 25-15 (+17%) |
| SY-c30 | Under | 181-111 | **+17.1%** | +6 to +27 | 0.044 | 0.23 | +16.3 | +12.6% | 34-30 (-0%) | 87-54 (+17%) | 60-27 (+31%) | 13-3 (+54%) | 41-33 (+4%) |
| SY-R25 | Under | 71-38 | **+22.9%** | +5 to +39 | 0.108 | 0.44 | +22.0 | +18.2% | 10-12 (-15%) | 36-19 (+24%) | 25-7 (+47%) | 4-2 (+26%) | 13-14 (-10%) |
| SY-12.0 | Under | 352-250 | **+10.4%** | +2 to +18 | 0.108 | 0.44 | +10.2 | +6.2% | 95-84 (-0%) | 154-107 (+12%) | 103-59 (+20%) | 21-5 (+53%) | 107-87 (+4%) |
| SY-FH30 | Under | 43-19 | **+30.3%** | +8 to +55 | 0.108 | 0.44 | +29.5 | +25.4% | 7-4 (+18%) | 20-12 (+18%) | 16-3 (+58%) | 2-2 (-6%) | 9-6 (+12%) |
| SY | Under | 209-140 | **+13.0%** | +2 to +23 | 0.108 | 0.45 | +12.7 | +8.7% | 56-55 (-5%) | 91-58 (+15%) | 62-27 (+32%) | 13-3 (+54%) | 63-58 (-2%) |
| SY-9.0 | Under | 94-62 | **+13.6%** | +3 to +25 | 0.108 | 0.45 | +13.5 | +9.3% | 24-21 (+0%) | 35-25 (+10%) | 35-16 (+30%) | 6-2 (+42%) | 28-23 (+3%) |
| SY-11.0 | Under | 251-177 | **+10.7%** | +1 to +19 | 0.108 | 0.50 | +10.2 | +6.4% | 63-64 (-7%) | 117-78 (+13%) | 71-35 (+27%) | 16-4 (+51%) | 71-67 (-3%) |
| SY-L45+ | Under | 56-28 | **+26.0%** | +4 to +49 | 0.108 | 0.50 | +26.6 | +21.1% | 26-15 (+20%) | 21-8 (+37%) | 9-5 (+22%) | 2-0 (+91%) | 26-15 (+20%) |
| SY-11.5 | Under | 305-220 | **+9.7%** | +1 to +17 | 0.108 | 0.51 | +9.4 | +5.5% | 84-76 (-1%) | 134-95 (+11%) | 87-49 (+21%) | 18-5 (+48%) | 94-79 (+2%) |
| LY-4of4 | Under | 39-19 | **+26.3%** | +3 to +52 | 0.108 | 0.51 | +25.5 | +21.5% | 7-4 (+18%) | 18-12 (+13%) | 14-3 (+54%) | 2-2 (-6%) | 9-6 (+12%) |
| SY-H1 | Under | 112-72 | **+14.8%** | +2 to +27 | 0.108 | 0.51 | +14.4 | +10.4% | 29-25 (+1%) | 46-32 (+11%) | 37-15 (+34%) | 6-2 (+42%) | 34-27 (+5%) |
| SY-c10 | Under | 249-174 | **+11.1%** | +1 to +21 | 0.122 | 0.54 | +11.1 | +6.8% | 84-79 (-3%) | 101-64 (+16%) | 64-31 (+27%) | 13-3 (+54%) | 91-82 (-1%) |
| SY-YPC | Under | 80-50 | **+16.1%** | +0 to +31 | 0.148 | 0.55 | +15.9 | +11.6% | 22-18 (+3%) | 41-24 (+19%) | 17-8 (+28%) | 6-2 (+42%) | 26-20 (+6%) |
| LY-3of4 | Under | 230-161 | **+11.2%** | +0 to +21 | 0.148 | 0.56 | +11.3 | +6.9% | 62-71 (-12%) | 94-59 (+16%) | 74-31 (+33%) | 14-3 (+56%) | 70-74 (-8%) |
| SY-9.5 | Under | 114-79 | **+11.5%** | -0 to +23 | 0.149 | 0.59 | +11.2 | +7.2% | 27-27 (-6%) | 44-35 (+5%) | 43-17 (+36%) | 8-2 (+51%) | 33-29 (+0%) |
| LY-SYorFH30 | Under | 303-219 | **+9.7%** | -0 to +18 | 0.149 | 0.59 | +9.8 | +5.4% | 86-93 (-9%) | 131-83 (+16%) | 86-43 (+26%) | 19-4 (+56%) | 95-97 (-7%) |
| FH-RB | Under | 65-42 | **+14.7%** | -1 to +30 | 0.161 | 0.65 | +15.0 | +10.3% | 26-19 (+9%) | 19-13 (+12%) | 20-10 (+26%) | 4-2 (+27%) | 29-21 (+9%) |
| LY-SYorH1 | Under | 484-375 | **+6.4%** | -1 to +13 | 0.161 | 0.66 | +7.0 | +2.3% | 166-173 (-8%) | 192-126 (+14%) | 126-76 (+18%) | 28-11 (+36%) | 177-181 (-7%) |
| SY-lc<30 | Under | 135-94 | **+11.2%** | -1 to +24 | 0.161 | 0.66 | +10.8 | +7.0% | 36-37 (-8%) | 55-39 (+11%) | 44-18 (+34%) | 7-1 (+66%) | 38-38 (-6%) |
| FH-NL | Under | 305-233 | **+7.1%** | -1 to +15 | 0.161 | 0.69 | +7.7 | +3.0% | 104-108 (-8%) | 113-78 (+12%) | 88-47 (+23%) | 17-8 (+29%) | 111-114 (-7%) |
| NL-H1 | Under | 305-233 | **+7.1%** | -1 to +15 | 0.161 | 0.69 | +7.7 | +3.0% | 104-108 (-8%) | 113-78 (+12%) | 88-47 (+23%) | 17-8 (+29%) | 111-114 (-7%) |
| SY-lc30+ | Under | 74-46 | **+16.4%** | -2 to +33 | 0.161 | 0.69 | +16.2 | +11.9% | 20-18 (-1%) | 36-19 (+24%) | 18-9 (+26%) | 6-2 (+42%) | 25-20 (+5%) |
| FH-L40-59 | Under | 109-76 | **+11.2%** | -2 to +24 | 0.165 | 0.70 | +12.0 | +7.0% | 38-33 (+1%) | 44-27 (+17%) | 27-16 (+19%) | 3-1 (+42%) | 39-33 (+2%) |
| SY-need | Under | 60-38 | **+15.3%** | -3 to +33 | 0.172 | 0.74 | +15.1 | +10.9% | 18-12 (+12%) | 28-17 (+18%) | 14-9 (+15%) | 5-1 (+58%) | 19-13 (+11%) |
| FH-R30 | Under | 137-98 | **+10.1%** | -2 to +22 | 0.193 | 0.81 | +10.6 | +5.9% | 37-42 (-11%) | 60-37 (+17%) | 40-19 (+28%) | 8-3 (+37%) | 41-45 (-10%) |
| SY-NL | Under | 149-102 | **+12.1%** | -3 to +25 | 0.193 | 0.81 | +11.7 | +7.8% | 38-43 (-12%) | 63-41 (+14%) | 48-18 (+38%) | 8-2 (+51%) | 44-45 (-7%) |
| LY-SYorFH20 | Under | 337-259 | **+6.8%** | -2 to +14 | 0.193 | 0.82 | +7.1 | +2.7% | 103-115 (-11%) | 141-94 (+13%) | 93-50 (+23%) | 19-5 (+50%) | 112-119 (-9%) |
| FH-any | Under | 387-307 | **+5.3%** | -2 to +12 | 0.198 | 0.87 | +6.1 | +1.3% | 139-143 (-7%) | 147-100 (+13%) | 101-64 (+16%) | 21-10 (+28%) | 148-150 (-6%) |
| SY-noH1 | Under | 97-68 | **+11.0%** | -3 to +24 | 0.198 | 0.88 | +10.8 | +6.8% | 27-30 (-11%) | 45-26 (+20%) | 25-12 (+28%) | 7-1 (+66%) | 29-31 (-9%) |
| NL-lc20-29 | Under | 285-222 | **+6.3%** | -2 to +15 | 0.199 | 0.88 | +7.1 | +2.2% | 127-100 (+6%) | 105-75 (+10%) | 53-47 (+0%) | 13-6 (+30%) | 134-104 (+6%) |
| SY-L<30 | Under | 76-53 | **+11.1%** | -4 to +25 | 0.206 | 0.88 | +10.5 | +6.8% | 16-17 (-9%) | 28-25 (-0%) | 32-11 (+41%) | 7-2 (+47%) | 21-19 (-1%) |
| BL-150-200 | Under | 85-59 | **+11.4%** | -5 to +27 | 0.211 | 0.91 | +12.0 | +7.1% | 35-23 (+13%) | 38-24 (+16%) | 12-12 (-5%) | 4-3 (+8%) | 37-26 (+10%) |
| BL-150 | Under | 261-208 | **+5.2%** | -2 to +12 | 0.221 | 0.95 | +5.7 | +1.1% | 85-92 (-9%) | 100-72 (+10%) | 76-44 (+20%) | 19-6 (+44%) | 95-97 (-7%) |
| NL-bigplay | Under | 111-82 | **+8.8%** | -4 to +21 | 0.221 | 0.95 | +10.1 | +4.6% | 28-26 (-2%) | 43-33 (+7%) | 40-23 (+20%) | 8-3 (+38%) | 31-29 (-2%) |
| FH-WR | Under | 228-180 | **+5.6%** | -3 to +14 | 0.257 | 1.00 | +7.1 | +1.5% | 78-79 (-6%) | 94-58 (+17%) | 56-43 (+7%) | 10-6 (+19%) | 82-84 (-7%) |
| SY-10.0 | Under | 145-109 | **+7.8%** | -4 to +19 | 0.257 | 1.00 | +7.4 | +3.7% | 33-41 (-16%) | 62-46 (+9%) | 50-22 (+31%) | 11-2 (+60%) | 40-43 (-9%) |
| FH-up10-20 | Under | 109-81 | **+8.1%** | -5 to +21 | 0.259 | 1.00 | +8.8 | +4.0% | 42-36 (+1%) | 40-24 (+18%) | 27-21 (+7%) | 5-5 (-5%) | 45-40 (-1%) |
| FH-q4<10 | Under | 178-141 | **+5.4%** | -4 to +15 | 0.284 | 1.00 | +6.3 | +1.4% | 68-68 (-6%) | 70-42 (+18%) | 40-31 (+7%) | 11-5 (+30%) | 74-70 (-3%) |
| NL-sh40-50 | Under | 151-118 | **+6.0%** | -4 to +16 | 0.284 | 1.00 | +6.7 | +2.0% | 59-53 (-1%) | 59-44 (+8%) | 33-21 (+16%) | 4-4 (-5%) | 63-56 (-0%) |
| FH-R20 | Under | 188-148 | **+5.7%** | -5 to +16 | 0.284 | 1.00 | +6.3 | +1.7% | 57-68 (-14%) | 76-51 (+13%) | 55-29 (+24%) | 10-4 (+35%) | 62-71 (-12%) |
| FH-q4<25 | Under | 269-218 | **+4.3%** | -4 to +12 | 0.284 | 1.00 | +5.1 | +0.3% | 100-105 (-8%) | 101-68 (+13%) | 68-45 (+14%) | 15-6 (+35%) | 107-108 (-6%) |
| BL-50-H1 | Under | 352-288 | **+3.9%** | -3 to +11 | 0.287 | 1.00 | +4.6 | -0.1% | 126-136 (-9%) | 134-93 (+12%) | 92-59 (+15%) | 21-9 (+33%) | 135-143 (-8%) |
| SY-up<10 | Under | 55-39 | **+10.6%** | -11 to +31 | 0.333 | 1.00 | +10.7 | +6.3% | 22-18 (+4%) | 21-15 (+10%) | 12-6 (+26%) | 7-0 (+89%) | 24-18 (+8%) |
| FH-L60+ | Under | 63-46 | **+9.4%** | -10 to +29 | 0.338 | 1.00 | +10.8 | +5.2% | 20-21 (-7%) | 23-16 (+11%) | 20-9 (+31%) | 2-3 (-24%) | 21-23 (-9%) |
| BL-75 | Under | 491-408 | **+3.3%** | -4 to +10 | 0.338 | 1.00 | +4.0 | -0.7% | 179-187 (-8%) | 183-137 (+8%) | 129-84 (+15%) | 32-11 (+41%) | 194-196 (-6%) |
| SY-up10-25 | Under | 83-63 | **+7.2%** | -8 to +22 | 0.345 | 1.00 | +6.9 | +3.1% | 24-25 (-8%) | 34-24 (+11%) | 25-14 (+22%) | 2-1 (+26%) | 26-26 (-6%) |
| BL-50 | Under | 590-495 | **+2.8%** | -4 to +9 | 0.345 | 1.00 | +3.6 | -1.1% | 217-227 (-8%) | 214-162 (+8%) | 159-106 (+14%) | 38-13 (+41%) | 235-236 (-6%) |
| SY-lcsh50 | Under | 55-41 | **+7.9%** | -9 to +26 | 0.346 | 1.00 | +7.9 | +3.8% | 15-16 (-9%) | 28-16 (+20%) | 12-9 (+8%) | 5-2 (+35%) | 18-18 (-6%) |
| NL-big | Under | 386-324 | **+2.8%** | -4 to +9 | 0.346 | 1.00 | +3.6 | -1.2% | 142-144 (-6%) | 137-113 (+4%) | 107-67 (+16%) | 21-10 (+29%) | 153-151 (-5%) |
| NL | Under | 494-414 | **+2.8%** | -4 to +9 | 0.346 | 1.00 | +3.6 | -1.1% | 178-191 (-9%) | 176-139 (+6%) | 140-84 (+18%) | 27-11 (+35%) | 192-198 (-7%) |
| BL-50-100 | Under | 189-154 | **+4.4%** | -6 to +15 | 0.354 | 1.00 | +5.3 | +0.3% | 73-75 (-7%) | 62-46 (+9%) | 54-33 (+18%) | 12-4 (+42%) | 79-77 (-4%) |
| SY-L30-44 | Under | 77-59 | **+6.8%** | -11 to +23 | 0.374 | 1.00 | +6.2 | +2.7% | 14-23 (-30%) | 42-25 (+19%) | 21-11 (+24%) | 4-1 (+51%) | 16-24 (-26%) |
| FH-2x | Under | 122-99 | **+4.5%** | -8 to +16 | 0.374 | 1.00 | +5.3 | +0.5% | 42-48 (-12%) | 44-25 (+21%) | 36-26 (+10%) | 11-6 (+22%) | 46-53 (-12%) |
| FH-60pct | Under | 256-212 | **+3.4%** | -5 to +12 | 0.374 | 1.00 | +4.2 | -0.6% | 88-103 (-13%) | 103-63 (+17%) | 65-46 (+11%) | 11-8 (+10%) | 94-108 (-12%) |
| LY-base | Under | 771-659 | **+1.9%** | -4 to +7 | 0.386 | 1.00 | +2.7 | -2.0% | 290-302 (-8%) | 286-221 (+7%) | 195-136 (+12%) | 41-15 (+39%) | 309-311 (-6%) |
| BL-100 | Under | 401-341 | **+2.1%** | -5 to +9 | 0.426 | 1.00 | +2.8 | -1.8% | 144-152 (-8%) | 152-116 (+7%) | 105-73 (+12%) | 26-9 (+41%) | 156-159 (-7%) |
| NL-q4<25 | Under | 242-204 | **+2.6%** | -7 to +12 | 0.430 | 1.00 | +3.4 | -1.4% | 87-102 (-13%) | 84-64 (+7%) | 71-38 (+23%) | 13-7 (+23%) | 93-105 (-11%) |
| NL-mid | Under | 111-92 | **+3.4%** | -10 to +16 | 0.442 | 1.00 | +3.5 | -0.6% | 30-21 (+11%) | 47-43 (-1%) | 34-28 (+4%) | 7-1 (+65%) | 33-21 (+16%) |
| BL-25 | Under | 678-583 | **+1.6%** | -4 to +8 | 0.442 | 1.00 | +2.4 | -2.3% | 249-264 (-8%) | 251-198 (+6%) | 178-121 (+13%) | 39-13 (+42%) | 267-273 (-7%) |
| BL-200 | Under | 176-149 | **+2.4%** | -9 to +12 | 0.455 | 1.00 | +2.9 | -1.6% | 50-69 (-21%) | 62-48 (+7%) | 64-32 (+26%) | 15-3 (+58%) | 58-71 (-15%) |
| FH-1.5x-R20 | Under | 121-102 | **+2.7%** | -11 to +16 | 0.455 | 1.00 | +3.4 | -1.3% | 37-49 (-18%) | 44-30 (+13%) | 40-23 (+20%) | 8-4 (+26%) | 41-52 (-16%) |
| NL-sh50 | Under | 213-180 | **+2.4%** | -8 to +13 | 0.455 | 1.00 | +3.3 | -1.6% | 83-82 (-5%) | 79-54 (+12%) | 51-44 (+2%) | 20-5 (+52%) | 92-85 (-2%) |
| BL-0-25 | Under | 93-76 | **+4.0%** | -15 to +22 | 0.455 | 1.00 | +4.9 | -0.0% | 41-38 (-2%) | 35-23 (+14%) | 17-15 (+1%) | 2-2 (-5%) | 42-38 (-1%) |
| NL-small | Under | 108-90 | **+3.0%** | -11 to +18 | 0.455 | 1.00 | +3.5 | -1.0% | 36-47 (-18%) | 39-26 (+13%) | 33-17 (+25%) | 6-1 (+61%) | 39-47 (-15%) |
| NL-lc40+ | Under | 168-143 | **+2.1%** | -8 to +13 | 0.473 | 1.00 | +3.3 | -1.8% | 62-56 (-1%) | 57-52 (-1%) | 49-35 (+10%) | 15-4 (+49%) | 67-58 (+1%) |
| FH-L<40 | Under | 215-185 | **+1.4%** | -7 to +10 | 0.485 | 1.00 | +2.0 | -2.4% | 81-89 (-10%) | 80-57 (+11%) | 54-39 (+10%) | 16-6 (+38%) | 88-94 (-9%) |
| FH-1.25x | Under | 272-236 | **+1.1%** | -7 to +8 | 0.486 | 1.00 | +1.9 | -2.7% | 97-108 (-11%) | 101-77 (+7%) | 74-51 (+12%) | 17-8 (+29%) | 105-114 (-10%) |
| FH-WR-R20 | Under | 103-89 | **+1.5%** | -11 to +13 | 0.496 | 1.00 | +2.8 | -2.4% | 29-36 (-15%) | 47-34 (+10%) | 27-19 (+11%) | 4-2 (+27%) | 31-38 (-15%) |
| BL-50-noH1 | Under | 238-207 | **+1.2%** | -8 to +10 | 0.504 | 1.00 | +2.0 | -2.7% | 91-91 (-5%) | 80-69 (+2%) | 67-47 (+11%) | 17-4 (+53%) | 100-93 (-2%) |
| FH-up0-10 | Under | 90-78 | **+1.3%** | -14 to +16 | 0.529 | 1.00 | +2.4 | -2.6% | 40-39 (-4%) | 31-25 (+5%) | 19-14 (+9%) | 6-1 (+63%) | 41-39 (-3%) |
| FH-Q1 | Under | 111-97 | **+1.0%** | -12 to +13 | 0.529 | 1.00 | +1.7 | -2.9% | 43-46 (-9%) | 44-34 (+7%) | 24-17 (+11%) | 5-4 (+5%) | 45-49 (-9%) |
| NL-need | Under | 277-245 | **+0.3%** | -9 to +10 | 0.565 | 1.00 | +1.1 | -3.6% | 112-111 (-5%) | 110-82 (+8%) | 55-52 (-3%) | 14-4 (+47%) | 117-113 (-4%) |
| FH-1.5x | Under | 202-181 | **-0.3%** | -10 to +9 | 0.607 | 1.00 | +0.6 | -4.1% | 72-89 (-15%) | 71-52 (+9%) | 59-40 (+13%) | 16-8 (+26%) | 80-95 (-14%) |
| NL-sh25-40 | Under | 303-274 | **-0.7%** | -11 to +9 | 0.623 | 1.00 | +0.1 | -4.5% | 113-131 (-13%) | 108-96 (+0%) | 82-47 (+20%) | 13-5 (+37%) | 117-134 (-12%) |
| BL-300 | Under | 92-83 | **-0.5%** | -13 to +12 | 0.623 | 1.00 | +0.2 | -4.3% | 29-34 (-13%) | 33-28 (+3%) | 30-21 (+11%) | 10-3 (+46%) | 33-36 (-9%) |
| FH-need | Under | 82-74 | **-0.8%** | -12 to +12 | 0.624 | 1.00 | +0.3 | -4.6% | 35-35 (-6%) | 34-22 (+15%) | 13-17 (-18%) | 4-2 (+26%) | 37-36 (-5%) |
| FH-TE | Under | 94-85 | **-0.9%** | -13 to +12 | 0.626 | 1.00 | -1.7 | -4.7% | 35-45 (-18%) | 34-29 (+2%) | 25-11 (+31%) | 7-2 (+47%) | 37-45 (-15%) |
| FH-75pct | Under | 152-138 | **-1.0%** | -10 to +8 | 0.626 | 1.00 | +0.0 | -4.8% | 56-70 (-16%) | 57-40 (+11%) | 39-28 (+10%) | 9-6 (+14%) | 62-73 (-13%) |
| BL-<50 | Under | 181-164 | **-0.9%** | -11 to +10 | 0.626 | 1.00 | -0.2 | -4.7% | 73-75 (-7%) | 72-59 (+4%) | 36-30 (+3%) | 3-2 (+14%) | 74-75 (-7%) |
| NL-lc30-39 | Under | 160-147 | **-1.5%** | -11 to +8 | 0.690 | 1.00 | -0.7 | -5.3% | 56-73 (-18%) | 69-49 (+11%) | 35-25 (+10%) | 7-3 (+32%) | 62-76 (-15%) |
| FH-not | Under | 384-352 | **-1.3%** | -8 to +6 | 0.694 | 1.00 | -0.5 | -5.1% | 151-159 (-8%) | 139-121 (+1%) | 94-72 (+7%) | 20-5 (+51%) | 161-161 (-6%) |
| NL-U20 | Under | 158-147 | **-2.2%** | -14 to +9 | 0.694 | 1.00 | -1.9 | -5.9% | 45-73 (-29%) | 55-45 (+4%) | 58-29 (+26%) | 6-2 (+42%) | 46-73 (-28%) |
| FH-up20-30 | Under | 51-50 | **-4.5%** | -23 to +14 | 0.704 | 1.00 | -3.6 | -8.2% | 20-26 (-18%) | 16-14 (+1%) | 15-10 (+14%) | 2-1 (+27%) | 21-26 (-16%) |
| BL-100-150 | Under | 140-133 | **-3.1%** | -14 to +8 | 0.740 | 1.00 | -2.3 | -6.9% | 59-60 (-7%) | 52-44 (+2%) | 29-29 (-5%) | 7-3 (+32%) | 61-62 (-6%) |
| NL-noH1 | Under | 189-181 | **-3.3%** | -14 to +7 | 0.750 | 1.00 | -2.5 | -7.1% | 74-83 (-11%) | 63-61 (-4%) | 52-37 (+11%) | 10-3 (+45%) | 81-84 (-7%) |
| LY-2of4 | Under | 289-272 | **-2.6%** | -10 to +5 | 0.758 | 1.00 | -1.6 | -6.4% | 119-128 (-9%) | 103-85 (+4%) | 67-59 (+1%) | 16-9 (+21%) | 126-133 (-8%) |
| BL-25-50 | Under | 88-88 | **-5.7%** | -19 to +8 | 0.797 | 1.00 | -5.0 | -9.3% | 32-37 (-13%) | 37-36 (-4%) | 19-15 (+6%) | 1-0 (+88%) | 32-37 (-13%) |

- **SY-c40**: SY needing 40+ earlier catches. *Source: late-yardage study (2026-11-15).*
- **SY-c30**: SY needing 30+ earlier catches. *Source: late-yardage study (2026-11-15).*
- **SY-R25**: SY AND line raised 25%+ (indicator SY-R25 / Signals SY +25%). *Source: late-yardage study (2026-11-15).*
- **SY-12.0**: threshold 12.0. *Source: late-yardage study (2026-11-15).*
- **SY-FH30**: SY AND 1st-half yds above line AND raised 30%+. *Source: late-yardage study (2026-11-15).*
- **SY**: Short-yardage receiver: under 10.6 yds/catch on 20+ catches since 2024 (before that game). *Source: late-yardage study (2026-11-15).*
- **SY-9.0**: threshold 9.0. *Source: late-yardage study (2026-11-15).*
- **SY-11.0**: yds/catch threshold 11.0. *Source: late-yardage study (2026-11-15).*
- **SY-L45+**: SY AND line 45+. *Source: late-yardage study (2026-11-15).*
- **SY-11.5**: threshold 11.5. *Source: late-yardage study (2026-11-15).*
- **LY-4of4**: All four headlines. *Source: late-yardage study (2026-11-15).*
- **SY-H1**: SY AND 1st half above line. *Source: late-yardage study (2026-11-15).*
- **SY-c10**: SY needing 10+ earlier catches. *Source: late-yardage study (2026-11-15).*
- **SY-YPC**: SY AND that game's yds/catch 1.5x his normal (Signals SY Fluke). *Source: late-yardage study (2026-11-15).*
- **LY-3of4**: 3+ of the four headlines (SY, FH-R30, BL-50, NL) on the same bet. *Source: late-yardage study (2026-11-15).*
- **SY-9.5**: threshold 9.5. *Source: late-yardage study (2026-11-15).*
- **LY-SYorFH30**: SY OR FH-R30. *Source: late-yardage study (2026-11-15).*
- **FH-RB**: ...RB only. *Source: late-yardage study (2026-11-15).*
- **LY-SYorH1**: SY OR 1st half above. *Source: late-yardage study (2026-11-15).*
- **SY-lc<30**: SY AND no catch of 30+. *Source: late-yardage study (2026-11-15).*
- **FH-NL**: 1st half above line AND Over without longest catch (Signals 1H No Long). *Source: late-yardage study (2026-11-15).*
- **NL-H1**: NL AND 1st half above line. *Source: late-yardage study (2026-11-15).*
- **SY-lc30+**: SY AND a catch of 30+. *Source: late-yardage study (2026-11-15).*
- **FH-L40-59**: ...this week's line 40-59.5. *Source: late-yardage study (2026-11-15).*
- **SY-need**: SY but he needed his longest catch. *Source: late-yardage study (2026-11-15).*
- **FH-R30**: 1st-half yds alone above his line AND line raised 30%+ (Signals 1H +30%). *Source: late-yardage study (2026-11-15).*
- **SY-NL**: SY AND still Over without his longest catch (Signals SY No Long). *Source: late-yardage study (2026-11-15).*
- **LY-SYorFH20**: SY OR (1st half & raised 20%+). *Source: late-yardage study (2026-11-15).*
- **FH-any**: 1st half above line, any raise. *Source: late-yardage study (2026-11-15).*
- **SY-noH1**: SY but 1st half NOT above line. *Source: late-yardage study (2026-11-15).*
- **NL-lc20-29**: Longest catch 20-29. *Source: late-yardage study (2026-11-15).*
- **SY-L<30**: SY AND line under 30. *Source: late-yardage study (2026-11-15).*
- **BL-150-200**: Band 150-200%. *Source: late-yardage study (2026-11-15).*
- **BL-150**: Beat line by 150%+. *Source: late-yardage study (2026-11-15).*
- **NL-bigplay**: Big-play receiver (12.7+ ypc) and NL. *Source: late-yardage study (2026-11-15).*
- **FH-WR**: 1st half above line, WR only. *Source: late-yardage study (2026-11-15).*
- **SY-10.0**: threshold 10.0. *Source: late-yardage study (2026-11-15).*
- **FH-up10-20**: ...raise 10-20%. *Source: late-yardage study (2026-11-15).*
- **FH-q4<10**: ...and under 10% in Q4. *Source: late-yardage study (2026-11-15).*
- **NL-sh40-50**: Longest catch 40-50% of yds. *Source: late-yardage study (2026-11-15).*
- **FH-R20**: 1st half above line AND raised 20%+. *Source: late-yardage study (2026-11-15).*
- **FH-q4<25**: 1st half above line AND under 25% of yds in Q4. *Source: late-yardage study (2026-11-15).*
- **BL-50-H1**: Beat line by 50%+ AND 1st half above line. *Source: late-yardage study (2026-11-15).*
- **SY-up<10**: SY AND raise under 10%. *Source: late-yardage study (2026-11-15).*
- **FH-L60+**: ...line 60+. *Source: late-yardage study (2026-11-15).*
- **BL-75**: Beat line by 75%+. *Source: late-yardage study (2026-11-15).*
- **SY-up10-25**: SY AND raise 10-25%. *Source: late-yardage study (2026-11-15).*
- **BL-50**: Beat line by 50%+ (headline). *Source: late-yardage study (2026-11-15).*
- **SY-lcsh50**: SY AND longest catch 50%+ of his yards. *Source: late-yardage study (2026-11-15).*
- **NL-big**: NL but the long catch was big (30%+ of yds or 25+). *Source: late-yardage study (2026-11-15).*
- **NL**: Still Over after removing his single longest catch (headline). *Source: late-yardage study (2026-11-15).*
- **BL-50-100**: Band 50-100%. *Source: late-yardage study (2026-11-15).*
- **SY-L30-44**: SY AND this week's line 30-44.5. *Source: late-yardage study (2026-11-15).*
- **FH-2x**: 1st-half yds at least 2x line. *Source: late-yardage study (2026-11-15).*
- **FH-60pct**: 1st half above line AND 60%+ of yds before half. *Source: late-yardage study (2026-11-15).*
- **LY-base**: BASE of the family: last game Over his rec-yds line with 40+ yds, line raised this week. *Source: late-yardage study.*
- **BL-100**: Beat by 100%+. *Source: late-yardage study (2026-11-15).*
- **NL-q4<25**: NL AND under 25% of yds in Q4. *Source: late-yardage study (2026-11-15).*
- **NL-mid**: In-between receiver, NL. *Source: late-yardage study (2026-11-15).*
- **BL-25**: Beat by 25%+. *Source: late-yardage study (2026-11-15).*
- **BL-200**: Beat line by 200%+ (indicator BL-200). *Source: late-yardage study (2026-11-15).*
- **FH-1.5x-R20**: 1st half 1.5x line AND raised 20%+. *Source: late-yardage study (2026-11-15).*
- **NL-sh50**: Longest catch 50%+ of yds. *Source: late-yardage study (2026-11-15).*
- **BL-0-25**: Band 0-25%. *Source: late-yardage study (2026-11-15).*
- **NL-small**: NL and long catch small. *Source: late-yardage study (2026-11-15).*
- **NL-lc40+**: Longest catch 40+. *Source: late-yardage study (2026-11-15).*
- **FH-L<40**: ...line under 40. *Source: late-yardage study (2026-11-15).*
- **FH-1.25x**: 1st half 1.25x line. *Source: late-yardage study (2026-11-15).*
- **FH-WR-R20**: ...WR, raised 20%+. *Source: late-yardage study (2026-11-15).*
- **BL-50-noH1**: Beat by 50%+ but 1st half NOT above. *Source: late-yardage study (2026-11-15).*
- **FH-up0-10**: ...raise under 10%. *Source: late-yardage study (2026-11-15).*
- **FH-Q1**: Already above his line after the 1st quarter. *Source: late-yardage study (2026-11-15).*
- **NL-need**: Comparison: Over only because of longest catch. *Source: late-yardage study (2026-11-15).*
- **FH-1.5x**: 1st half 1.5x line. *Source: late-yardage study (2026-11-15).*
- **NL-sh25-40**: Longest 25-40% of yds. *Source: late-yardage study (2026-11-15).*
- **BL-300**: Beat by 300%+. *Source: late-yardage study (2026-11-15).*
- **FH-need**: 1st half above but needed longest catch. *Source: late-yardage study (2026-11-15).*
- **FH-TE**: ...TE only. *Source: late-yardage study (2026-11-15).*
- **FH-75pct**: ...75%+ of yds before half. *Source: late-yardage study (2026-11-15).*
- **BL-<50**: Comparison: beat by under 50%. *Source: late-yardage study (2026-11-15).*
- **NL-lc30-39**: Longest catch 30-39. *Source: late-yardage study (2026-11-15).*
- **FH-not**: Comparison: 1st half NOT above line. *Source: late-yardage study (2026-11-15).*
- **NL-U20**: Longest catch under 20 yds (indicator NL-U20). *Source: late-yardage study (2026-11-15).*
- **FH-up20-30**: ...raise 20-30%. *Source: late-yardage study (2026-11-15).*
- **BL-100-150**: Band 100-150%. *Source: late-yardage study (2026-11-15).*
- **NL-noH1**: NL but 1st half NOT above. *Source: late-yardage study (2026-11-15).*
- **LY-2of4**: Exactly 2 of the four. *Source: late-yardage study (2026-11-15).*
- **BL-25-50**: Band 25-50%. *Source: late-yardage study (2026-11-15).*

## 11. Weather

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WXG-QB-pass_yds-wind>=15-U | Under | 28-11 | **+36.0%** | +15 to +50 | 0.057 | 0.35 | +41.9 | +30.7% | – | 28-11 (+36%) | – | – | – |
| WXG-WRTE-rec-wind>=15-U | Under | 96-53 | **+20.4%** | +7 to +31 | 0.057 | 0.44 | +17.3 | +16.0% | – | 96-53 (+20%) | – | – | – |
| WX1 | Under | 361-245 | **+12.1%** | +2 to +20 | 0.089 | 0.45 | +12.0 | +7.9% | 91-75 (+3%) | 270-170 (+15%) | – | – | 91-75 (+3%) |
| WXG-QB-pass_yds-<40F-U | Under | 35-25 | **+10.5%** | +2 to +18 | 0.089 | 0.51 | +16.4 | +6.2% | – | 35-25 (+10%) | – | – | – |
| WXG-WRTE-rec_yds-wind>=15-U | Under | 172-111 | **+14.7%** | +1 to +26 | 0.089 | 0.54 | +15.1 | +10.3% | 71-55 (+6%) | 101-56 (+22%) | – | – | 71-55 (+6%) |
| WXG-RB-rush_yds-55-69F-U | Under | 248-177 | **+9.8%** | +0 to +19 | 0.090 | 0.55 | +10.4 | +5.6% | 110-67 (+16%) | 102-81 (+5%) | 36-29 (+5%) | – | 110-67 (+16%) |
| WXG-WRTE-rec-<40F-U | Under | 133-89 | **+8.8%** | +0 to +16 | 0.090 | 0.55 | +5.6 | +5.1% | – | 133-89 (+9%) | – | – | – |
| WXG-WRTE-rec-40-54F-U | Under | 183-128 | **+8.9%** | -3 to +19 | 0.182 | 0.80 | +5.8 | +5.2% | – | 183-128 (+9%) | – | – | – |
| WX2 | Under | 1158-954 | **+2.7%** | -2 to +7 | 0.390 | 1.00 | +2.3 | -1.1% | 351-352 (-6%) | 807-602 (+7%) | – | – | 351-352 (-6%) |
| WXG-QB-rush_yds-40-54F-U | Under | 80-59 | **+7.7%** | -8 to +24 | 0.452 | 1.00 | +10.6 | +3.6% | 43-27 (+16%) | 37-32 (-1%) | – | – | 43-27 (+16%) |
| WXG-WRTE-rec->=70F-U | Under | 373-301 | **+2.6%** | -4 to +8 | 0.496 | 1.00 | +0.7 | -1.0% | – | 236-198 (+0%) | 137-103 (+7%) | – | – |
| WXG-WRTE-rec-55-69F-U | Under | 324-270 | **+2.5%** | -6 to +10 | 0.644 | 1.00 | +0.2 | -1.2% | – | 243-194 (+4%) | 81-76 (-3%) | – | – |
| WXG-WRTE-rec_yds-40-54F-U | Under | 345-304 | **+0.2%** | -7 to +7 | 0.807 | 1.00 | +0.9 | -3.6% | 167-160 (-4%) | 178-144 (+5%) | – | – | 167-160 (-4%) |
| WXG-RB-rush_yds->=70F-U | Under | 253-224 | **-0.0%** | -9 to +9 | 0.807 | 1.00 | +0.5 | -3.8% | 101-96 (-4%) | 97-83 (+2%) | 55-45 (+4%) | – | 101-96 (-4%) |
| WXG-WRTE-rec_yds-55-69F-U | Under | 562-499 | **-0.2%** | -6 to +6 | 0.807 | 1.00 | +0.4 | -4.0% | 240-208 (+1%) | 238-218 (-1%) | 84-73 (+1%) | – | 240-208 (+1%) |
| WXG-WRTE-rec_yds->=70F-U | Under | 625-554 | **-0.1%** | -6 to +6 | 0.807 | 1.00 | +0.6 | -3.9% | 265-226 (+1%) | 236-210 (+0%) | 124-118 (-3%) | – | 265-226 (+1%) |
| WXG-WRTE-rec_yds-<40F-U | Under | 229-205 | **-0.4%** | -10 to +8 | 0.807 | 1.00 | +0.1 | -4.2% | 96-105 (-10%) | 133-100 (+8%) | – | – | 96-105 (-10%) |
| WXG-QB-rush_yds->=70F-U | Under | 137-122 | **-1.0%** | -14 to +13 | 0.807 | 1.00 | -0.2 | -4.7% | 59-44 (+6%) | 50-53 (-8%) | 28-25 (+0%) | – | 59-44 (+6%) |
| WXG-QB-pass_yds-40-54F-U | Under | 36-35 | **-4.1%** | -21 to +16 | 0.936 | 1.00 | +1.8 | -7.8% | – | 36-35 (-4%) | – | – | – |
| WXG-QB-rush_yds-wind>=15-U | Under | 33-32 | **-5.9%** | -25 to +13 | 0.936 | 1.00 | -2.6 | -9.3% | 12-15 (-18%) | 21-17 (+3%) | – | – | 12-15 (-18%) |
| WXG-QB-pass_yds->=70F-U | Under | 81-82 | **-6.0%** | -26 to +12 | 0.936 | 1.00 | +1.8 | -9.6% | – | 54-56 (-7%) | 27-26 (-4%) | – | – |
| WXG-QB-rush_yds-55-69F-U | Under | 117-114 | **-4.8%** | -16 to +8 | 0.936 | 1.00 | -3.4 | -8.4% | 47-47 (-7%) | 51-52 (-7%) | 19-15 (+6%) | – | 47-47 (-7%) |
| WXG-QB-rush_yds-<40F-U | Under | 47-50 | **-9.2%** | -30 to +13 | 0.936 | 1.00 | -5.9 | -12.6% | 20-20 (-6%) | 27-30 (-11%) | – | – | 20-20 (-6%) |
| WXG-QB-pass_yds-55-69F-U | Under | 71-75 | **-8.0%** | -23 to +5 | 0.967 | 1.00 | -0.8 | -11.5% | – | 56-56 (-5%) | 15-19 (-16%) | – | – |
| WXG-RB-rush_yds-40-54F-U | Under | 129-131 | **-6.3%** | -16 to +3 | 0.967 | 1.00 | -5.3 | -9.9% | 65-69 (-9%) | 64-62 (-4%) | – | – | 65-69 (-9%) |
| WXG-RB-rush_yds-wind>=15-U | Under | 54-60 | **-10.6%** | -24 to +3 | 0.967 | 1.00 | -9.9 | -14.0% | 24-26 (-10%) | 30-34 (-11%) | – | – | 24-26 (-10%) |
| WXG-RB-rush_yds-<40F-U | Under | 80-88 | **-10.0%** | -20 to +1 | 0.967 | 1.00 | -9.3 | -13.5% | 33-40 (-15%) | 47-48 (-6%) | – | – | 33-40 (-15%) |

- **WXG-QB-pass_yds-wind>=15-U**: QB-pass_yds Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **WXG-WRTE-rec-wind>=15-U**: WRTE-rec Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **WX1**: Outdoor, observed wind 15+ mph -> pass yds / receptions / rec yds Under. *Source: audit.*
- **WXG-QB-pass_yds-<40F-U**: QB-pass_yds Under, outdoor, <40F (observed). *Source: audit grid.*
- **WXG-WRTE-rec_yds-wind>=15-U**: WRTE-rec_yds Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **WXG-RB-rush_yds-55-69F-U**: RB-rush_yds Under, outdoor, 55-69F (observed). *Source: audit grid.*
- **WXG-WRTE-rec-<40F-U**: WRTE-rec Under, outdoor, <40F (observed). *Source: audit grid.*
- **WXG-WRTE-rec-40-54F-U**: WRTE-rec Under, outdoor, 40-54F (observed). *Source: audit grid.*
- **WX2**: Outdoor, observed temp under 55F -> receptions / rec yds Under. *Source: audit.*
- **WXG-QB-rush_yds-40-54F-U**: QB-rush_yds Under, outdoor, 40-54F (observed). *Source: audit grid.*
- **WXG-WRTE-rec->=70F-U**: WRTE-rec Under, outdoor, >=70F (observed). *Source: audit grid.*
- **WXG-WRTE-rec-55-69F-U**: WRTE-rec Under, outdoor, 55-69F (observed). *Source: audit grid.*
- **WXG-WRTE-rec_yds-40-54F-U**: WRTE-rec_yds Under, outdoor, 40-54F (observed). *Source: audit grid.*
- **WXG-RB-rush_yds->=70F-U**: RB-rush_yds Under, outdoor, >=70F (observed). *Source: audit grid.*
- **WXG-WRTE-rec_yds-55-69F-U**: WRTE-rec_yds Under, outdoor, 55-69F (observed). *Source: audit grid.*
- **WXG-WRTE-rec_yds->=70F-U**: WRTE-rec_yds Under, outdoor, >=70F (observed). *Source: audit grid.*
- **WXG-WRTE-rec_yds-<40F-U**: WRTE-rec_yds Under, outdoor, <40F (observed). *Source: audit grid.*
- **WXG-QB-rush_yds->=70F-U**: QB-rush_yds Under, outdoor, >=70F (observed). *Source: audit grid.*
- **WXG-QB-pass_yds-40-54F-U**: QB-pass_yds Under, outdoor, 40-54F (observed). *Source: audit grid.*
- **WXG-QB-rush_yds-wind>=15-U**: QB-rush_yds Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **WXG-QB-pass_yds->=70F-U**: QB-pass_yds Under, outdoor, >=70F (observed). *Source: audit grid.*
- **WXG-QB-rush_yds-55-69F-U**: QB-rush_yds Under, outdoor, 55-69F (observed). *Source: audit grid.*
- **WXG-QB-rush_yds-<40F-U**: QB-rush_yds Under, outdoor, <40F (observed). *Source: audit grid.*
- **WXG-QB-pass_yds-55-69F-U**: QB-pass_yds Under, outdoor, 55-69F (observed). *Source: audit grid.*
- **WXG-RB-rush_yds-40-54F-U**: RB-rush_yds Under, outdoor, 40-54F (observed). *Source: audit grid.*
- **WXG-RB-rush_yds-wind>=15-U**: RB-rush_yds Under, outdoor, wind>=15 (observed). *Source: audit grid.*
- **WXG-RB-rush_yds-<40F-U**: RB-rush_yds Under, outdoor, <40F (observed). *Source: audit grid.*

## 12. Grids: old (sequence, spread, ATS) and new

New grids were written before looking at any result: line vs last-3 average (FORM3), line vs season average (FORMS), line move vs his previous game (MOVE), last game's result as a multiple of its line (RESID), situation (SIT: home/away, prime time, division, short rest, after bye, total 48+/40−, dome, weeks 1–4 / 14+), opponent's season-to-date allowed (DEF), line size (LINE) and price (PRICE). Each is crossed with the 9 position-markets (QB pass/rush, RB rush/rec/rec yds, WR rec/rec yds, TE rec/rec yds) and both sides.

| Family | Rules (20+ bets) | Best q (family) | Rules with q ≤ 0.10 | CI above 0 | Under cells positive |
|---|---|---|---|---|---|
| SEQ | 102 | 0.076 | 1 | 2 | 22 of 51 |
| SPG | 126 | 0.541 | 0 | 5 | 34 of 63 |
| ATS | 72 | 1.000 | 0 | 0 | 16 of 36 |
| FORM3 | 90 | 0.045 | 1 | 1 | 19 of 45 |
| FORMS | 88 | 0.748 | 0 | 1 | 25 of 44 |
| MOVE | 82 | 0.041 | 1 | 5 | 19 of 41 |
| RESID | 88 | 1.000 | 0 | 1 | 20 of 44 |
| SIT | 198 | 1.000 | 0 | 3 | 49 of 99 |
| DEF | 36 | 1.000 | 0 | 0 | 8 of 18 |
| LINE | 78 | 0.234 | 0 | 2 | 18 of 39 |
| PRICE | 12 | 0.567 | 0 | 0 | 4 of 6 |
| NAMED | 42 | 0.176 | 0 | 5 | 23 of 34 |
| QB | 26 | 0.067 | 3 | 3 | 13 of 21 |
| CM | 11 | 0.010 | 3 | 3 | 8 of 9 |
| LY | 88 | 0.022 | 2 | 15 | 73 of 88 |
| WX | 27 | 0.057 | 7 | 7 | 13 of 27 |

With about half of the Under cells positive in every new grid, these results are what chance alone would produce. The individual cells with a CI above zero are listed below for future tracking, not betting.

| ID | Bet | Record | ROI | 95% CI | q (family) | q (all) | vs base | at −10¢ | 2024 | 2025 | 2026 | 2026 wk 10–11 | Out-of-sample |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MOVE-TE-rec-up10-25-U | Under | 25-6 | **+40.9%** | +19 to +61 | 0.041 | 0.19 | +38.3 | +36.6% | – | 15-3 (+44%) | 10-3 (+36%) | 1-0 (+66%) | n/a |
| FORM3-QB-pass_yds-form<0.75x-O | Over | 36-17 | **+28.6%** | +12 to +47 | 0.045 | 0.19 | +32.4 | +23.6% | – | 29-14 (+28%) | 7-3 (+33%) | 0-1 (-100%) | n/a |
| LINE-TE-rec-5-5.5-U | Under | 35-12 | **+33.2%** | +11 to +54 | 0.234 | 0.35 | +30.7 | +28.9% | – | 23-7 (+37%) | 12-5 (+26%) | 3-2 (+9%) | n/a |
| SPG-WR-rec-dog10+-U | Under | 80-46 | **+18.9%** | +5 to +31 | 0.541 | 0.44 | +17.5 | +14.6% | – | 51-26 (+23%) | 29-20 (+12%) | 17-6 (+36%) | 17-6 (+36%) |
| SEQ-RC-LUP-U | Under | 483-289 | **+8.8%** | +4 to +14 | 0.076 | 0.22 | +7.8 | +5.6% | – | 269-170 (+7%) | 214-119 (+12%) | 37-23 (+8%) | 37-23 (+8%) |
| FORMS-QB-rush_yds-szn0.90-1.10x-U | Under | 108-70 | **+14.4%** | +2 to +28 | 0.748 | 0.45 | +16.3 | +10.1% | 35-31 (-1%) | 52-36 (+12%) | 21-3 (+66%) | 4-1 (+51%) | n/a |
| SEQ-RC-AL4-U | Under | 254-176 | **+9.4%** | +2 to +16 | 0.331 | 0.44 | +8.3 | +5.6% | – | 165-115 (+11%) | 89-61 (+7%) | 22-14 (+12%) | 22-14 (+12%) |
| SIT-TE-rec_yds-wk1-4-U | Under | 301-215 | **+9.9%** | +2 to +18 | 1.000 | 0.44 | +8.2 | +5.7% | 109-65 (+17%) | 85-65 (+7%) | 107-85 (+5%) | – | n/a |
| SPG-TE-rec_yds-dog10+-U | Under | 54-29 | **+22.7%** | +2 to +43 | 0.541 | 0.54 | +20.8 | +18.0% | 11-11 (-7%) | 28-12 (+33%) | 15-6 (+35%) | 9-2 (+54%) | 20-13 (+14%) |
| MOVE-RB-rec_yds-up25+-U | Under | 137-91 | **+13.2%** | +1 to +24 | 0.353 | 0.51 | +13.4 | +8.8% | 52-43 (+2%) | 34-26 (+7%) | 51-22 (+32%) | 8-6 (+8%) | n/a |
| RESID-WR-rec-last>=2x-U | Under | 140-92 | **+11.8%** | +1 to +23 | 1.000 | 0.54 | +10.9 | +8.0% | – | 78-48 (+15%) | 62-44 (+9%) | 10-6 (+17%) | n/a |
| MOVE-QB-rush_yds-down25+-O | Over | 60-34 | **+19.7%** | +1 to +39 | 0.353 | 0.54 | +31.5 | +15.3% | 16-8 (+25%) | 23-16 (+10%) | 21-10 (+27%) | 7-0 (+87%) | n/a |
| SPG-TE-rec-dog10+-U | Under | 39-21 | **+24.2%** | +1 to +50 | 0.541 | 0.54 | +21.8 | +19.7% | – | 26-13 (+28%) | 13-8 (+18%) | 7-4 (+22%) | 7-4 (+22%) |
| MOVE-WR-rec-up25+-U | Under | 199-113 | **+11.2%** | +1 to +21 | 0.353 | 0.54 | +10.1 | +7.9% | – | 110-66 (+9%) | 89-47 (+13%) | 14-13 (-14%) | n/a |
| MOVE-TE-rec-up25+-U | Under | 104-58 | **+12.9%** | +0 to +26 | 0.353 | 0.54 | +10.3 | +9.5% | – | 53-34 (+8%) | 51-24 (+18%) | 11-2 (+54%) | n/a |
| SPG-RB-rec_yds-dog7-9.5-U | Under | 92-59 | **+15.1%** | +0 to +30 | 0.541 | 0.54 | +15.4 | +10.6% | 36-16 (+30%) | 34-26 (+7%) | 22-17 (+6%) | 2-1 (+29%) | 38-17 (+30%) |
| SIT-TE-rec_yds-dome-U | Under | 343-264 | **+6.5%** | +0 to +12 | 1.000 | 0.54 | +5.4 | +2.5% | 136-107 (+5%) | 115-93 (+5%) | 92-64 (+11%) | 17-9 (+24%) | n/a |
| SIT-RB-rec_yds-division-U | Under | 345-267 | **+6.3%** | +0 to +13 | 1.000 | 0.55 | +6.7 | +2.2% | 134-111 (+3%) | 121-94 (+6%) | 90-62 (+12%) | 17-14 (+3%) | n/a |
| SPG-RB-rec-fav7-9.5-U | Under | 55-37 | **+14.6%** | +0 to +29 | 0.541 | 0.55 | +16.3 | +10.5% | – | 33-24 (+10%) | 22-13 (+22%) | 2-1 (+35%) | 2-1 (+35%) |
| LINE-TE-rec_yds-50-64.5-U | Under | 76-51 | **+13.2%** | +0 to +26 | 0.955 | 0.55 | +11.7 | +8.9% | 19-23 (-14%) | 36-19 (+24%) | 21-9 (+32%) | 3-1 (+42%) | n/a |

- **MOVE-TE-rec-up10-25-U**: TE rec: line change vs his line in his team's previous game up10-25. *Source: new 2026-11-22.*
- **FORM3-QB-pass_yds-form<0.75x-O**: QB pass_yds: last-3-games average vs this line form<0.75x. *Source: new 2026-11-22.*
- **LINE-TE-rec-5-5.5-U**: TE rec line 5 to 5.5. *Source: new 2026-11-22.*
- **SPG-WR-rec-dog10+-U**: WR rec when team is dog10+. *Source: audit grid.*
- **SEQ-RC-LUP-U**: rec: LUP pattern over his recent games played -> Under. *Source: audit grid.*
- **FORMS-QB-rush_yds-szn0.90-1.10x-U**: QB rush_yds: season-to-date average (4+ games) vs this line szn0.90-1.10x. *Source: new 2026-11-22.*
- **SEQ-RC-AL4-U**: rec: AL4 pattern over his recent games played -> Under. *Source: audit grid.*
- **SIT-TE-rec_yds-wk1-4-U**: TE rec_yds: situation wk1-4. *Source: new 2026-11-22.*
- **SPG-TE-rec_yds-dog10+-U**: TE rec_yds when team is dog10+. *Source: audit grid.*
- **MOVE-RB-rec_yds-up25+-U**: RB rec_yds: line change vs his line in his team's previous game up25+. *Source: new 2026-11-22.*
- **RESID-WR-rec-last>=2x-U**: WR rec: last game's result as a multiple of last game's line last>=2x. *Source: new 2026-11-22.*
- **MOVE-QB-rush_yds-down25+-O**: QB rush_yds: line change vs his line in his team's previous game down25+. *Source: new 2026-11-22.*
- **SPG-TE-rec-dog10+-U**: TE rec when team is dog10+. *Source: audit grid.*
- **MOVE-WR-rec-up25+-U**: WR rec: line change vs his line in his team's previous game up25+. *Source: new 2026-11-22.*
- **MOVE-TE-rec-up25+-U**: TE rec: line change vs his line in his team's previous game up25+. *Source: new 2026-11-22.*
- **SPG-RB-rec_yds-dog7-9.5-U**: RB rec_yds when team is dog7-9.5. *Source: audit grid.*
- **SIT-TE-rec_yds-dome-U**: TE rec_yds: situation dome. *Source: new 2026-11-22.*
- **SIT-RB-rec_yds-division-U**: RB rec_yds: situation division. *Source: new 2026-11-22.*
- **SPG-RB-rec-fav7-9.5-U**: RB rec when team is fav7-9.5. *Source: audit grid.*
- **LINE-TE-rec_yds-50-64.5-U**: TE rec_yds line 50 to 64.5. *Source: new 2026-11-22.*

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

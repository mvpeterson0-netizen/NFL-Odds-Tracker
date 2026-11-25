# 2024-only discovery, graded on 2025 and 2026 (2026-11-22)

Rushing-yards and receiving-yards props only (the 2024 archive has no other markets). DraftKings main line, FanDuel fallback, 1 unit at the saved price, push = 0. 2026 = weeks 1–11. Career catches seeded from 2022–23. Spread, total and weather are nflverse closing-type/observed values. Code: `research/discover_2024/` (branch history-2024, not committed at time of writing).

## Findings

- **No 2024 rule survives a multiple-testing correction** (STRICT is empty). The best 2024 p-values are what 22,774 tries produce by chance.
- **2024 winners did no better than random rules in 2025–26.** Every discovery set's Under portfolio lands within a point of its matched baseline (LOOSE +0.4% vs +0.6%). Only about 2% of a rule's 2024 ROI carried forward (slope 0.02); single-condition rules kept about 5%.
- **Every 2024 Over discovery failed.** Overs lose about 11% a season in these markets, and no 2024 Over edge beat that.
- **Models trained on 2024 learned nothing that transferred.** Gradient boosting hit +37% to +78% in-sample and about 0% in 2025–26; neither model beat the market price's own ranking (AUC ≈ 0.50 vs 0.506).
- **The few 2024 finds that held are the themes 2025–26 found on their own:** QB rushing Unders on high lines and receiving Unders for big underdogs (mainly RBs). Agreement from two independent directions is the strongest evidence in this study, though each still has a 2025–26 range that touches or nearly touches zero except the QB rule.
- **The short-yardage (SY) family would not have been found in 2024** (closest cell ranked 1,688th; +4.3%).

## Design

- **Candidates:** 71 generic conditions with round-number thresholds (line vs recent form, line moves, last result vs line, streaks, usage, depth slot, line size, spread, total, home/away, rest, weather, last game's script, ATS, opponent, price, calendar, last game's receiving detail, career catch profile, QB change), used alone and in pairs, × 8 segments × Under/Over. 39,760 candidates; 22,774 had 40+ bets in 2024.

- **Discovery sets (picked on 2024 alone):**
  - LOOSE: 40+ bets, ROI ≥ +10%, one-sided week-bootstrap p ≤ 0.05 (what a typical scan would call a find).
  - SPLIT: LOOSE and positive in both halves of 2024 (wk 1–9, wk 10–18).
  - SINGLE: LOOSE, one condition only.
  - STRICT: Benjamini–Hochberg q ≤ 0.10 across all 22,774.
  - TOP50: 50 best 2024 p-values with 60+ bets.
  - BIG: 100+ bets, ROI ≥ +8%, p ≤ 0.05.
  - ROI20: LOOSE with ROI ≥ +20%.
  - LOOSE-Under: LOOSE, Under rules only.

- **Grouping:** rules sharing 50%+ of their 2024 bets with a stronger rule are counted as one group.

- **Test:** 2025 and 2026, never used for selection. Baseline = betting the same side on every prop in the same season × market × position mix.

## Headline

| Set | Rules | Groups | Median 2024 ROI | Median 2025–26 ROI | Rules positive 2025–26 | Positive both years | Under portfolio 2025–26 | 95% range | Matched baseline |
|---|---|---|---|---|---|---|---|---|---|
| LOOSE | 351 | 177 | +18.6% | -1.1% | 157/343 | 77/343 | 3204-2823 +0.4% | -1.6 to +2.5 | +0.6% |
| SPLIT | 277 | 141 | +18.9% | -1.8% | 119/274 | 59/274 | 2844-2516 +0.2% | -2.2 to +2.7 | +0.5% |
| SINGLE | 8 | 6 | +17.0% | +1.8% | 6/8 | 3/8 | 563-449 +5.1% | -0.5 to +10.8 | +1.5% |
| STRICT | 0 | – | – | – | – | – | – | – | – |
| TOP50 | 50 | 31 | +19.9% | -0.5% | 25/50 | 13/50 | 1953-1722 +0.3% | -2.6 to +3.4 | +0.6% |
| BIG | 109 | 56 | +13.4% | +0.0% | 55/109 | 32/109 | 3021-2655 +0.6% | -1.6 to +2.8 | +0.6% |
| ROI20 | 145 | 95 | +23.8% | -1.1% | 65/142 | 35/142 | 2204-1963 -0.1% | -2.7 to +2.6 | +0.7% |
| LOOSE-Under | 274 | 125 | +18.9% | +1.3% | 154/273 | 76/273 | 3204-2823 +0.4% | -1.6 to +2.5 | +0.6% |

Portfolio = every Under bet any rule in the set picks, each prop counted once.

## Does 2024 ROI predict 2025–26 ROI? (all candidates with 40+ test bets)

| Side | 2024 ROI band | Rules | Mean 2024 ROI | 2025–26 ROI (bet-weighted) | Share positive 2025–26 |
|---|---|---|---|---|---|
| U | ..-20 | 409 | -25.5% | +0.1% | 53% |
| U | -20..-10 | 1939 | -13.8% | +0.2% | 51% |
| U | -10..0 | 5101 | -4.7% | +0.5% | 52% |
| U | 0..10 | 2939 | +3.9% | +0.5% | 53% |
| U | 10..20 | 619 | +13.7% | +1.1% | 54% |
| U | 20..30 | 113 | +23.0% | +1.1% | 54% |
| U | 30.. | 18 | +33.3% | +1.9% | 61% |
| O | ..-20 | 1250 | -25.7% | -11.7% | 9% |
| O | -20..-10 | 4039 | -14.1% | -11.3% | 6% |
| O | -10..0 | 4404 | -5.8% | -11.3% | 6% |
| O | 0..10 | 1201 | +3.6% | -10.9% | 10% |
| O | 10..20 | 208 | +13.7% | -11.4% | 13% |
| O | 20..30 | 34 | +23.4% | -11.1% | 6% |
| O | 30.. | 2 | +36.2% | +0.5% | 50% |

- U slope: 11138 rules, slope 0.020, correlation 0.013
- O slope: 11138 rules, slope 0.018, correlation 0.012
- U slope k=1: 510 rules, slope 0.051, correlation 0.095
- U slope k=2: 10628 rules, slope 0.018, correlation 0.011
- O slope k=1: 510 rules, slope 0.049, correlation 0.106
- O slope k=2: 10628 rules, slope 0.017, correlation 0.010

Slope = how much of a rule's 2024 ROI carried into 2025–26 (1.0 = all of it, 0 = none).

## LOOSE-Under groups that were positive in both 2025 and 2026 (60+ test bets)

| Segment | Conditions (Under) | 2024 | p | 2025 | 2026 | 2025–26 | 95% range | Baseline | Rules in group |
|---|---|---|---|---|---|---|---|---|---|
| QB rush yds | line high third & weeks 5-11 | 41-23 +20.7% | 0.002 | 37-23 +16.7% | 32-14 +31.2% | +23.0% | +10 to +38 | +0.2% | 1 |
| RB rec yds | L<=0.8*szn & opp failed to cover last game | 88-50 +19.8% | 0.001 | 69-43 +16.7% | 34-28 +4.2% | +12.2% | -1 to +25 | +0.3% | 7 |
| QB rush yds | L<=0.8*L3avg & away | 47-24 +23.8% | 0.005 | 42-31 +8.2% | 24-14 +18.4% | +11.7% | -5 to +28 | -1.0% | 2 |
| RB rec yds | dog 7+ | 48-24 +25.6% | 0.008 | 55-43 +6.2% | 40-23 +19.8% | +11.5% | -5 to +28 | +0.4% | 3 |
| all rush yds | dog 7+ & team trailed 7+ on 40%+ of plays last game | 52-32 +15.8% | 0.022 | 54-38 +10.6% | 33-23 +11.6% | +11.0% | -0 to +23 | -0.0% | 2 |
| TE rec yds | slot 1 & weeks 1-4 | 76-41 +21.9% | 0.012 | 63-47 +8.3% | 70-47 +13.2% | +10.8% | +1 to +18 | +4.0% | 13 |
| all rec yds | last>=2xL & off bye (10+ days) | 35-22 +16.0% | 0.024 | 38-28 +8.9% | 29-20 +11.9% | +10.2% | -8 to +30 | +0.7% | 1 |
| QB rush yds | away & team trailed 7+ on 40%+ of plays last game | 49-28 +18.3% | 0.027 | 46-35 +6.7% | 32-21 +14.0% | +9.6% | -8 to +27 | -0.3% | 2 |
| all | dog 7+ & team covered last game | 101-60 +17.9% | 0.006 | 128-96 +8.2% | 53-37 +11.4% | +9.1% | -2 to +20 | +0.5% | 2 |
| WR rec yds | beat last line 50%+ & tgt share -5 pts last game | 27-15 +21.8% | 0.020 | 24-19 +5.6% | 11-7 +15.8% | +8.6% | -14 to +32 | -0.2% | 1 |
| RB rec yds | line up 10%+ & weeks 5-11 | 52-33 +14.5% | 0.048 | 37-32 +1.3% | 53-35 +14.0% | +8.4% | -6 to +24 | +0.7% | 1 |
| QB rush yds | away & opp failed to cover last game | 66-41 +14.3% | 0.028 | 67-58 +0.7% | 44-25 +20.5% | +7.8% | -5 to +19 | -0.8% | 1 |
| RB rec yds | opp tough vs position & weeks 5-11 | 43-28 +13.5% | 0.048 | 36-28 +6.3% | 43-32 +8.4% | +7.4% | -7 to +21 | +0.6% | 1 |
| WR rec yds | near pick (<3) & 1st half alone beat last line | 38-22 +20.3% | 0.046 | 35-25 +10.5% | 17-15 +0.2% | +7.0% | -11 to +23 | -0.4% | 1 |
| all | dog 7+ & opp failed to cover last game | 128-79 +15.8% | 0.012 | 157-116 +8.8% | 78-65 +3.1% | +6.8% | -2 to +15 | +0.6% | 4 |
| TE rec yds | under 4 games played & dome/closed | 48-24 +25.0% | 0.005 | 33-23 +11.5% | 34-29 +2.1% | +6.5% | -10 to +24 | +4.0% | 2 |
| all | line low third & dog 7+ | 109-72 +12.6% | 0.004 | 131-102 +6.2% | 91-70 +7.0% | +6.5% | -1 to +15 | +0.2% | 4 |
| all | tgt share -5 pts last game & 1st half alone beat last line | 43-22 +24.2% | 0.001 | 37-28 +7.6% | 18-15 +3.5% | +6.2% | -14 to +24 | +0.8% | 2 |
| WR rec yds | usage falling (last 2 vs earlier -5) & slot 3 | 39-17 +30.7% | 0.001 | 30-25 +3.4% | 13-9 +11.7% | +5.8% | -15 to +26 | -0.2% | 3 |
| all | line high third & QB changed this game | 61-38 +15.9% | 0.010 | 70-60 +1.8% | 39-26 +13.4% | +5.7% | -7 to +17 | +0.7% | 2 |
| WR rec yds | under 4 games played & team trailed 7+ on 40%+ of plays last game | 74-47 +14.8% | 0.049 | 61-51 +3.3% | 76-58 +7.3% | +5.5% | -5 to +16 | -1.2% | 1 |
| TE rec yds | line low third & team led 7+ on 40%+ of plays last game | 37-16 +30.6% | 0.000 | 24-18 +7.8% | 22-18 +2.0% | +5.0% | -17 to +27 | +3.9% | 1 |
| all | 2+ of last 3 Over & QB changed this game | 64-42 +13.4% | 0.016 | 67-53 +5.6% | 29-24 +3.2% | +4.9% | -6 to +16 | +0.6% | 1 |
| all | dome/closed & QB changed this game | 76-51 +12.3% | 0.010 | 71-63 +0.6% | 39-26 +12.4% | +4.4% | -7 to +15 | +0.5% | 2 |
| all rec yds | 3 straight Overs & tgt share +5 pts last game | 43-24 +20.7% | 0.005 | 38-32 +2.6% | 17-13 +7.3% | +4.0% | -17 to +22 | +0.5% | 2 |
| all | dog 3-6.5 & weeks 1-4 | 206-143 +10.4% | 0.043 | 122-102 +3.2% | 155-128 +3.7% | +3.5% | -5 to +11 | +0.7% | 1 |
| all | team trailed 7+ on 40%+ of plays last game & QB changed this game | 116-81 +10.7% | 0.018 | 126-100 +5.3% | 82-72 +0.6% | +3.4% | -5 to +10 | +0.6% | 7 |
| RB rec yds | L<=0.6*L3avg & away | 48-26 +22.5% | 0.039 | 29-25 +1.5% | 26-21 +4.9% | +3.1% | -22 to +24 | +0.5% | 1 |
| all rec yds | L<=0.8*szn & line high third | 85-49 +19.4% | 0.010 | 69-60 +1.2% | 48-38 +5.7% | +3.0% | -9 to +14 | +1.1% | 2 |
| RB rush yds | line low third & weeks 5-11 | 69-47 +10.8% | 0.043 | 54-46 +2.0% | 87-76 +0.9% | +1.3% | -13 to +15 | +0.8% | 1 |

117 LOOSE-Under groups had 60+ test bets; the table lists the 30 positive in both years. 3 had a 2025–26 range entirely above zero.

## SINGLE: every group

| Side | Segment | Conditions | 2024 | p | 2025 | 2026 | 2025–26 | 95% range | Baseline |
|---|---|---|---|---|---|---|---|---|---|
| U | RB rush yds | QB changed this game | 43-24 +20.8% | 0.004 | 43-40 -1.6% | 31-26 +2.9% | +0.2% | -18 to +17 | +0.6% |
| U | RB rec yds | dog 7+ | 48-24 +25.6% | 0.008 | 55-43 +6.2% | 40-23 +19.8% | +11.5% | -5 to +28 | +0.4% |
| U | TE rec yds | weeks 1-4 | 109-65 +17.4% | 0.012 | 85-65 +7.2% | 107-85 +5.4% | +6.2% | -2 to +15 | +4.0% |
| U | QB rush yds | usage rising (last 2 vs earlier +5) | 45-27 +16.7% | 0.022 | 37-40 -10.1% | 14-8 +19.0% | -3.6% | -21 to +14 | -2.5% |
| O | TE rec yds | fav 7+ | 52-30 +18.3% | 0.029 | 53-56 -7.9% | 30-33 -10.0% | -8.6% | -20 to +3 | -14.4% |
| U | RB rush yds | dog 7+ | 55-37 +12.7% | 0.033 | 62-57 -1.4% | 43-36 +3.0% | +0.3% | -9 to +10 | +0.6% |

## TOP50: every group

| Side | Segment | Conditions | 2024 | p | 2025 | 2026 | 2025–26 | 95% range | Baseline |
|---|---|---|---|---|---|---|---|---|---|
| O | WR rec yds | total <=41 & career long-catch (13+ ypc, 40+ catches) | 55-28 +23.3% | 0.000 | 25-30 -14.0% | 25-27 -9.2% | -11.7% | -27 to +4 | -9.8% |
| U | all rush yds | team covered last game & opp tough vs position | 87-48 +20.0% | 0.000 | 73-74 -6.9% | 48-35 +9.1% | -1.1% | -12 to +10 | +0.0% |
| U | all | L<=0.8*L3avg & team trailed 7+ on 40%+ of plays last game | 240-165 +11.3% | 0.000 | 230-167 +9.6% | 157-140 -0.2% | +5.5% | -2 to +12 | +0.5% |
| U | QB rush yds | division game & team covered last game | 52-22 +30.1% | 0.000 | 34-44 -18.8% | 32-15 +28.2% | -1.1% | -23 to +20 | -0.6% |
| U | all rush yds | line down 10%+ & prime time | 42-22 +22.2% | 0.000 | 33-39 -12.9% | 21-19 -0.6% | -8.5% | -24 to +10 | +0.5% |
| U | all | last<=0.5xL & under 4 games played | 150-107 +8.5% | 0.000 | 115-107 -2.2% | 123-124 -6.2% | -4.3% | -11 to +2 | +0.9% |
| U | all rush yds | team failed to cover last game & QB changed this game | 43-23 +22.2% | 0.001 | 45-41 -1.1% | 34-33 -3.9% | -2.3% | -17 to +11 | +0.4% |
| U | all | line low third & total 48+ | 171-109 +13.9% | 0.001 | 153-177 -12.9% | 169-119 +10.6% | -2.0% | -10 to +5 | +0.6% |
| U | TE rec yds | L<=0.8*szn & opp covered last game | 46-25 +21.4% | 0.001 | 28-38 -19.2% | 31-24 +6.4% | -7.6% | -24 to +12 | +3.8% |
| U | RB rec yds | tgt share -5 pts last game & team covered last game | 54-35 +13.8% | 0.001 | 38-33 +1.5% | 17-23 -19.5% | -6.1% | -23 to +10 | +0.3% |
| O | all rec yds | line low third & fav 7+ | 73-37 +23.8% | 0.001 | 73-73 -5.3% | 57-47 +3.7% | -1.6% | -14 to +8 | -11.2% |
| U | all | L>=1.4*L3avg & total 48+ | 65-38 +17.6% | 0.001 | 72-81 -12.0% | 57-39 +11.5% | -2.9% | -16 to +10 | +0.3% |
| U | RB rush yds | dog 3-6.5 & prime time | 49-23 +27.3% | 0.001 | 31-20 +15.4% | 22-20 -0.4% | +8.3% | -11 to +27 | +0.7% |
| U | all | tgt share -5 pts last game & 1st half alone beat last line | 43-22 +24.2% | 0.001 | 37-28 +7.6% | 18-15 +3.5% | +6.2% | -14 to +24 | +0.8% |
| U | RB rec yds | L<=0.8*szn & opp failed to cover last game | 88-50 +19.8% | 0.001 | 69-43 +16.7% | 34-28 +4.2% | +12.2% | -1 to +25 | +0.3% |
| U | all | L<=0.6*L3avg & line high third | 52-30 +19.3% | 0.001 | 50-39 +6.2% | 25-18 +10.0% | +7.4% | -7 to +23 | +0.7% |
| U | all rec yds | L<=0.6*L3avg & L<=0.8*szn | 155-113 +8.7% | 0.002 | 108-110 -6.1% | 97-97 -5.9% | -6.0% | -13 to +1 | +0.7% |
| U | QB rush yds | beat last line 50%+ & away | 40-21 +22.9% | 0.002 | 34-35 -6.5% | 27-10 +38.3% | +9.1% | -6 to +23 | -0.9% |
| O | all | L>=1.2*L3avg & fav 7+ | 64-38 +16.7% | 0.002 | 60-79 -18.2% | 45-33 +9.4% | -8.3% | -20 to +4 | -11.1% |
| U | QB rush yds | line high third & weeks 5-11 | 41-23 +20.7% | 0.002 | 37-23 +16.7% | 32-14 +31.2% | +23.0% | +10 to +38 | +0.2% |
| U | TE rec yds | line low third & team covered last game | 83-44 +22.1% | 0.004 | 43-39 -1.1% | 49-35 +9.1% | +4.1% | -10 to +18 | +3.9% |
| O | WR rec yds | under 4 games played & team led 7+ on 40%+ of plays last game | 56-36 +13.2% | 0.004 | 31-47 -24.9% | 41-37 -0.6% | -12.7% | -28 to +5 | -9.7% |
| U | all | line low third & dog 7+ | 109-72 +12.6% | 0.004 | 131-102 +6.2% | 91-70 +7.0% | +6.5% | -1 to +15 | +0.2% |
| U | all | L<=0.8*szn & 1st half alone beat last line | 98-58 +18.2% | 0.004 | 63-64 -5.9% | 52-51 -4.5% | -5.3% | -17 to +8 | +0.8% |
| U | all rush yds | off bye (10+ days) & team failed to cover last game | 50-29 +17.7% | 0.004 | 38-44 -12.2% | 25-32 -18.0% | -14.5% | -32 to +2 | +0.2% |
| U | TE rec yds | under 4 games played & dome/closed | 48-24 +25.0% | 0.005 | 33-23 +11.5% | 34-29 +2.1% | +6.5% | -10 to +24 | +4.0% |
| U | all rec yds | 3 straight Overs & tgt share +5 pts last game | 43-24 +20.7% | 0.005 | 38-32 +2.6% | 17-13 +7.3% | +4.0% | -17 to +22 | +0.5% |
| O | RB rush yds | slot 1 & opp soft vs position | 64-38 +17.2% | 0.005 | 38-62 -28.1% | 27-29 -8.7% | -21.1% | -35 to -7 | -11.3% |
| U | QB rush yds | L<=0.8*L3avg & away | 47-24 +23.8% | 0.005 | 42-31 +8.2% | 24-14 +18.4% | +11.7% | -5 to +28 | -1.0% |
| U | RB rec yds | last<=0.5xL & opp failed to cover last game | 60-34 +19.2% | 0.006 | 44-43 -4.1% | 27-30 -10.4% | -6.6% | -20 to +6 | +0.4% |
| U | all | dog 7+ & team covered last game | 101-60 +17.9% | 0.006 | 128-96 +8.2% | 53-37 +11.4% | +9.1% | -2 to +20 | +0.5% |

## Where theses found on 2025–26 would have ranked in the 2024 scan (Under, closest grid cell)

| Segment | Conditions | 2024 rank (of Under candidates, by p) | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| QB rush yds | line high third | 3461 of 11387 | 87-76 +0.4% | 81-67 +3.8% | 53-27 +25.0% |
| QB rush yds | line high third & weeks 5-11 | 36 of 11387 | 41-23 +20.7% | 37-23 +16.7% | 32-14 +31.2% |
| all rec yds | dog 7+ | 1441 of 11387 | 174-139 +4.4% | 253-165 +14.7% | 136-116 +2.0% |
| RB rec yds | dog 7+ | 67 of 11387 | 48-24 +25.6% | 55-43 +6.2% | 40-23 +19.8% |
| WR rec yds | dog 7+ | 5922 of 11387 | 84-80 -3.8% | 126-88 +11.6% | 62-67 -8.9% |
| TE rec yds | dog 7+ | 3079 of 11387 | 42-35 +1.9% | 72-34 +28.7% | 34-26 +6.9% |
| all rec yds | last game 40+ rec yds and Over & career short-catch (<10.6 ypc, 40+ catches) | 1688 of 11387 | 113-91 +4.3% | 112-72 +15.2% | 64-26 +34.5% |
| all rec yds | wind 15+ outdoor | 2311 of 11387 | 91-75 +3.0% | 123-82 +13.5% | no data |
| all rush yds | wind 15+ outdoor | 10214 of 11387 | 36-41 -12.8% | 51-51 -6.0% | no data |

2026 wind/temperature is not filled in nflverse yet, so weather rules have no 2026 bets.

## Models fit on 2024 only

Gradient boosting (depth 3, 200 trees) and L2 logistic regression on ~35 pre-game features plus the market's no-vig Under probability. Settings fixed before seeing 2025–26. Bet the side when the model's probability beats the price's implied probability by the edge shown.

**gbm**: 2025–26 AUC 0.496 vs market price alone 0.506; log loss 0.7040 vs market 0.6927 (lower is better); 2024 in-sample AUC 0.766.

| Side | Edge ≥ | 2024 (in-sample) | 2025 | 2026 | 2025–26 | 95% range |
|---|---|---|---|---|---|---|
| U | 0.00 | 1424-526 +36.9% | 1019-880 +1.4% | 656-614 -2.4% | -0.1% (n 3169) | -3.1 to +3.0 |
| O | 0.00 | 797-165 +54.3% | 504-585 -12.3% | 350-426 -14.6% | -13.3% (n 1865) | -16.7 to -10.0 |
| U | 0.02 | 1131-345 +43.7% | 763-651 +2.0% | 479-454 -3.0% | +0.0% (n 2347) | -3.7 to +3.6 |
| O | 0.02 | 592-90 +61.8% | 343-412 -13.9% | 251-300 -13.7% | -13.8% (n 1306) | -17.6 to -10.0 |
| U | 0.04 | 846-219 +49.0% | 543-444 +4.0% | 327-319 -4.4% | +0.7% (n 1633) | -4.6 to +5.4 |
| O | 0.04 | 426-33 +73.1% | 213-274 -17.2% | 169-201 -13.6% | -15.6% (n 857) | -19.9 to -10.8 |
| U | 0.06 | 599-114 +57.7% | 360-289 +4.9% | 209-208 -5.5% | +0.8% (n 1066) | -5.3 to +6.5 |
| O | 0.06 | 289-13 +78.3% | 136-175 -17.2% | 106-124 -12.9% | -15.4% (n 541) | -21.5 to -9.4 |
| U | 0.08 | 417-56 +65.6% | 218-174 +5.1% | 121-121 -5.8% | +1.0% (n 634) | -6.7 to +7.8 |
| O | 0.08 | 189-9 +78.0% | 77-114 -23.6% | 62-76 -14.9% | -20.0% (n 329) | -30.1 to -10.1 |

**logit**: 2025–26 AUC 0.505 vs market price alone 0.506; log loss 0.6957 vs market 0.6927 (lower is better); 2024 in-sample AUC 0.558.

| Side | Edge ≥ | 2024 (in-sample) | 2025 | 2026 | 2025–26 | 95% range |
|---|---|---|---|---|---|---|
| U | 0.00 | 978-730 +6.9% | 1055-927 +0.4% | 841-733 +0.8% | +0.6% (n 3556) | -1.9 to +3.1 |
| O | 0.00 | 259-213 +1.7% | 264-317 -14.1% | 112-131 -12.9% | -13.8% (n 824) | -20.3 to -7.5 |
| U | 0.02 | 611-424 +10.0% | 678-600 -0.0% | 564-485 +1.3% | +0.5% (n 2327) | -2.9 to +4.0 |
| O | 0.02 | 127-76 +15.7% | 127-159 -16.0% | 39-40 -6.8% | -14.0% (n 365) | -23.9 to -4.3 |
| U | 0.04 | 368-230 +14.4% | 393-343 +0.5% | 329-282 +1.3% | +0.9% (n 1347) | -3.9 to +5.8 |
| O | 0.04 | 51-36 +8.6% | 50-66 -18.5% | 14-17 -15.1% | -17.8% (n 147) | -32.6 to -3.1 |
| U | 0.06 | 193-102 +21.5% | 215-175 +3.4% | 139-123 -0.2% | +2.0% (n 652) | -4.6 to +9.1 |
| O | 0.06 | 25-14 +19.1% | 20-24 -14.0% | 3-8 -48.9% | -21.0% (n 55) | -48.8 to +3.9 |
| U | 0.08 | 93-47 +23.0% | 108-96 -1.4% | 72-57 +4.8% | +1.0% (n 333) | -7.9 to +9.7 |
| O | 0.08 | 11-6 +20.0% | 13-12 -1.6% | 3-5 -29.8% | -8.4% (n 33) | -41.9 to +13.8 |

"""Write the 2024-discovery report (markdown) from /tmp/disc/results.json and model.json."""
import json, os
D = os.environ.get("DISC_OUT", "/tmp/disc")
R = json.load(open(f"{D}/results.json")); M = json.load(open(f"{D}/model.json"))
f = lambda v, d=1: "–" if v is None else f"{v:+.{d}f}%"
o = []
w = o.append
w("# 2024-only discovery, graded on 2025 and 2026 (2026-11-22)\n")
w("Rushing-yards and receiving-yards props only (the 2024 archive has no other markets). DraftKings main line, FanDuel fallback, "
  "1 unit at the saved price, push = 0. 2026 = weeks 1–11. Career catches seeded from 2022–23. Spread, total and weather are "
  "nflverse closing-type/observed values. Code: `research/discover_2024/` (branch history-2024, not committed at time of writing).\n")
w("## Design\n")
w("- **Candidates:** 71 generic conditions with round-number thresholds (line vs recent form, line moves, last result vs line, "
  "streaks, usage, depth slot, line size, spread, total, home/away, rest, weather, last game's script, ATS, opponent, price, "
  "calendar, last game's receiving detail, career catch profile, QB change), used alone and in pairs, × 8 segments × Under/Over. "
  "39,760 candidates; 22,774 had 40+ bets in 2024.\n")
w("- **Discovery sets (picked on 2024 alone):**\n"
  "  - LOOSE: 40+ bets, ROI ≥ +10%, one-sided week-bootstrap p ≤ 0.05 (what a typical scan would call a find).\n"
  "  - SPLIT: LOOSE and positive in both halves of 2024 (wk 1–9, wk 10–18).\n"
  "  - SINGLE: LOOSE, one condition only.\n"
  "  - STRICT: Benjamini–Hochberg q ≤ 0.10 across all 22,774.\n"
  "  - TOP50: 50 best 2024 p-values with 60+ bets.\n"
  "  - BIG: 100+ bets, ROI ≥ +8%, p ≤ 0.05.\n"
  "  - ROI20: LOOSE with ROI ≥ +20%.\n"
  "  - LOOSE-Under: LOOSE, Under rules only.\n")
w("- **Grouping:** rules sharing 50%+ of their 2024 bets with a stronger rule are counted as one group.\n")
w("- **Test:** 2025 and 2026, never used for selection. Baseline = betting the same side on every prop in the same season × market × position mix.\n")
w("## Headline\n")
w("| Set | Rules | Groups | Median 2024 ROI | Median 2025–26 ROI | Rules positive 2025–26 | Positive both years | Under portfolio 2025–26 | 95% range | Matched baseline |")
w("|---|---|---|---|---|---|---|---|---|---|")
for s in R["summary"]:
    if not s.get("groups"):
        w(f"| {s['set']} | 0 | – | – | – | – | – | – | – | – |"); continue
    pu = s.get("portU_T"); ci = s.get("portU_T_ci")
    w(f"| {s['set']} | {s['rules']} | {s['groups']} | {f(s['median_roi24'])} | {f(s['median_roiT'])} | {s['rules_pos_test']} | {s['rules_pos_both']} | "
      f"{pu['rec']} {f(pu['roi'])} | {ci[0]:+.1f} to {ci[1]:+.1f} | {f(s['portU_T_base'])} |" if pu else "")
w("\nPortfolio = every Under bet any rule in the set picks, each prop counted once.\n")
w("## Does 2024 ROI predict 2025–26 ROI? (all candidates with 40+ test bets)\n")
w("| Side | 2024 ROI band | Rules | Mean 2024 ROI | 2025–26 ROI (bet-weighted) | Share positive 2025–26 |")
w("|---|---|---|---|---|---|")
for c in R["calibration"]:
    if "wmean_roiT" in c:
        w(f"| {c['side']} | {c['bin']} | {c['rules']} | {f(c['mean_roi24'])} | {f(c['wmean_roiT'])} | {c['pos_test']:.0f}% |")
w("")
for c in R["calibration"]:
    if "slope" in c:
        w(f"- {c['side']} {c['bin']}: {c['rules']} rules, slope {c['slope']:.3f}, correlation {c['corr']:.3f}")
w("\nSlope = how much of a rule's 2024 ROI carried into 2025–26 (1.0 = all of it, 0 = none).\n")
w("## LOOSE-Under groups that were positive in both 2025 and 2026 (60+ test bets)\n")
w("| Segment | Conditions (Under) | 2024 | p | 2025 | 2026 | 2025–26 | 95% range | Baseline | Rules in group |")
w("|---|---|---|---|---|---|---|---|---|---|")
L = [d for d in R["details"]["LOOSE-Under"] if d["nT"] >= 60]
for d in sorted([d for d in L if (d["roi25"] or -1) > 0 and (d["roi26"] or -1) > 0], key=lambda d: -d["roiT"]):
    w(f"| {d['seg']} | {d['conds']} | {d['w24']}-{d['l24']} {f(d['roi24'])} | {d['p24']:.3f} | {d['w25']}-{d['l25']} {f(d['roi25'])} | "
      f"{d['w26']}-{d['l26']} {f(d['roi26'])} | {f(d['roiT'])} | {d['loT']:+.0f} to {d['hiT']:+.0f} | {f(d['baseT'])} | {d['members']} |")
w(f"\n{len(L)} LOOSE-Under groups had 60+ test bets; the table lists the "
  f"{sum((d['roi25'] or -1) > 0 and (d['roi26'] or -1) > 0 for d in L)} positive in both years. "
  f"{sum(d['loT'] > 0 for d in L)} had a 2025–26 range entirely above zero.\n")
for nm in ("SINGLE", "TOP50"):
    w(f"## {nm}: every group\n")
    w("| Side | Segment | Conditions | 2024 | p | 2025 | 2026 | 2025–26 | 95% range | Baseline |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for d in R["details"][nm]:
        w(f"| {d['side']} | {d['seg']} | {d['conds']} | {d['w24']}-{d['l24']} {f(d['roi24'])} | {d['p24']:.3f} | {d['w25']}-{d['l25']} {f(d['roi25'])} | "
          f"{d['w26']}-{d['l26']} {f(d['roi26'])} | {f(d['roiT'])} | {d.get('loT', 0):+.0f} to {d.get('hiT', 0):+.0f} | {f(d.get('baseT'))} |")
    w("")
w("## Where theses found on 2025–26 would have ranked in the 2024 scan (Under, closest grid cell)\n")
w("| Segment | Conditions | 2024 rank (of Under candidates, by p) | 2024 | 2025 | 2026 |")
w("|---|---|---|---|---|---|")
for r in R["reference"]:
    if "rank24" in r:
        w(f"| {r['seg']} | {r['conds']} | {r['rank24']} of {r['of']} | {r['w24']}-{r['l24']} {f(r['roi24'])} | {r['w25']}-{r['l25']} {f(r['roi25'])} | "
          f"{(str(r['w26']) + '-' + str(r['l26']) + ' ' + f(r['roi26'])) if r['roi26'] is not None else 'no data'} |")
w("\n2026 wind/temperature is not filled in nflverse yet, so weather rules have no 2026 bets.\n")
w("## Models fit on 2024 only\n")
w("Gradient boosting (depth 3, 200 trees) and L2 logistic regression on ~35 pre-game features plus the market's no-vig Under probability. "
  "Settings fixed before seeing 2025–26. Bet the side when the model's probability beats the price's implied probability by the edge shown.\n")
for nm, r in M.items():
    w(f"**{nm}**: 2025–26 AUC {r['auc_test']:.3f} vs market price alone {r['auc_market_test']:.3f}; log loss {r['logloss_test']:.4f} vs market {r['logloss_market_test']:.4f} "
      f"(lower is better); 2024 in-sample AUC {r['auc_train']:.3f}.\n")
    w("| Side | Edge ≥ | 2024 (in-sample) | 2025 | 2026 | 2025–26 | 95% range |")
    w("|---|---|---|---|---|---|---|")
    for t in ("0.00", "0.02", "0.04", "0.06", "0.08"):
        for side in ("U", "O"):
            a = [r[f"{side}_t{t}_{s}"] for s in ("24", "25", "26")]; T = r.get(f"{side}_t{t}_T")
            w(f"| {side} | {t} | " + " | ".join(f"{x['rec']} {f(x['roi'])}" for x in a) +
              (f" | {f(T['roi'])} (n {T['n']}) | {T['ci'][0]:+.1f} to {T['ci'][1]:+.1f} |" if T else " | – | – |"))
    w("")
open(f"{D}/report.md", "w").write("\n".join(o))
print(len("\n".join(o)))

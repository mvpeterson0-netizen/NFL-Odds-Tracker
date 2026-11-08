"""Spread-band study on research/signal_stacks props.csv.  python -m research.signal_stacks.spread_study [--out DIR]

team_spread: points the player's team is favored by, NEGATIVE = favored (-10 = favored by 10, +10 = getting 10).
Decision hit rate = wins / (wins + losses); pushes are excluded from hit rate and from ROI stakes (stake refunded).
ROI = flat 1 unit per non-push bet at the recorded price of the side bet / number of non-push bets.
Rows with a missing price for the side bet are kept in W/L but excluded from ROI (counted in 'no_price').
Spread source is the nflverse schedule spread_line (post-hoc, closing-type) -> this is NOT a capture-time backtest.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from pathlib import Path

BANDS = [("<=-10", -1e9, -9.9999), ("-9.5..-7", -9.5, -7.0), ("-6.5..-3", -6.5, -3.0), ("-2.5..+2.5", -2.5, 2.5),
         ("+3..+6.5", 3.0, 6.5), ("+7..+9.5", 7.0, 9.5), (">=+10", 10.0, 1e9)]
MKTS = ["pass_yds", "rush_yds", "rec", "rec_yds"]


def band(s):
    for name, lo, hi in BANDS:
        if lo <= s <= hi:
            return name
    raise ValueError(f"spread {s} falls between bands")  # half-point grid: must never happen


def payout(price):
    p = float(price)
    return p / 100 if p > 0 else 100 / abs(p)


def load(path):
    out = []
    for r in csv.DictReader(open(path)):
        if r["result"] not in ("over", "under", "push") or r["team_spread"] == "":
            continue
        r["season"] = int(r["season"]); r["team_spread"] = float(r["team_spread"]); r["line"] = float(r["line"])
        r["band"] = band(r["team_spread"])
        for k in ("over_price", "under_price"):
            r[k] = float(r[k]) if r[k] not in ("", "None") else None
        out.append(r)
    return out


def summarize(rows, side):
    w = l = p = 0
    units = 0.0
    nbets = no_price = 0
    for r in rows:
        if r["result"] == "push":
            p += 1
            continue
        win = r["result"] == side
        w += win; l += not win
        pr = r[f"{side}_price"]
        if pr is None:
            no_price += 1
            continue
        nbets += 1
        units += payout(pr) if win else -1.0
    n = w + l
    return dict(over_under=side, W=w, L=l, P=p, n=n, hit=(w / n if n else None), units=units,
                roi=(units / nbets if nbets else None), bets_priced=nbets, no_price=no_price,
                games=len({r["gid"] for r in rows}))


def cluster_boot_roi(rows, side, reps=2000, seed=7):
    """Game-clustered bootstrap CI for flat ROI of betting `side` on `rows` (props in one game are correlated)."""
    by = defaultdict(list)
    for r in rows:
        by[r["gid"]].append(r)
    gids = list(by)
    per = {}
    for g, rs in by.items():
        u = n = 0
        for r in rs:
            if r["result"] == "push" or r[f"{side}_price"] is None:
                continue
            n += 1
            u += payout(r[f"{side}_price"]) if r["result"] == side else -1.0
        per[g] = (u, n)
    if len(gids) < 5:
        return None
    rnd = random.Random(seed)
    vals = []
    for _ in range(reps):
        u = n = 0
        for _ in gids:
            a, b = per[gids[rnd.randrange(len(gids))]]
            u += a; n += b
        if n:
            vals.append(u / n)
    vals.sort()
    return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]


def cell_pvalue(rows, base_rows, side, reps=2000, seed=11):
    """Two-sided game-cluster bootstrap p for (side win rate in cell) - (side win rate in all base_rows of the same market)."""
    def rate(rs):
        n = sum(r["result"] != "push" for r in rs)
        return sum(r["result"] == side for r in rs) / n if n else 0.0
    base = rate(base_rows)
    by = defaultdict(list)
    for r in rows:
        by[r["gid"]].append(r)
    gids = list(by)
    obs = rate(rows) - base
    rnd = random.Random(seed)
    cnt = 0
    for _ in range(reps):
        w = n = 0
        for _ in gids:
            for r in by[gids[rnd.randrange(len(gids))]]:
                if r["result"] != "push":
                    n += 1; w += r["result"] == side
        d = (w / n if n else 0.0) - rate(rows)   # centered on the cell's own rate -> null of 'no difference' around obs
        cnt += abs(d) >= abs(obs)
    return (cnt + 1) / (reps + 1)


def bh(pvals):
    idx = sorted(range(len(pvals)), key=lambda i: pvals[i])
    q = [0.0] * len(pvals)
    prev = 1.0
    for rank, i in reversed(list(enumerate(idx, 1))):
        prev = min(prev, pvals[i] * len(pvals) / rank)
        q[i] = prev
    return q


def fmt(x, pct=False, d=1):
    if x is None:
        return "n/a"
    return f"{100 * x:.{d}f}%" if pct else f"{x:+.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/home/claude/stix_research/out")
    a = ap.parse_args()
    out = Path(a.out)
    rows = load(out / "props.csv")
    res = []
    for scope, filt in (("pooled", lambda r: True), ("2025", lambda r: r["season"] == 2025), ("2026", lambda r: r["season"] == 2026)):
        for m in MKTS:
            mrows = [r for r in rows if r["market"] == m and filt(r)]
            for bn, _, _ in BANDS:
                cell = [r for r in mrows if r["band"] == bn]
                for side in ("over", "under"):
                    s = summarize(cell, side)
                    s.update(scope=scope, market=m, band=bn, props=len(cell))
                    res.append(s)
    # significance for pooled under rate vs market baseline, BH across 4 markets x 7 bands
    pooled = [r for r in res if r["scope"] == "pooled" and r["over_under"] == "under"]
    ps = []
    for s in pooled:
        mrows = [r for r in rows if r["market"] == s["market"]]
        cell = [r for r in mrows if r["band"] == s["band"]]
        s["p_vs_market_under_rate"] = cell_pvalue(cell, mrows, "under") if len(cell) >= 20 else 1.0
        ci = cluster_boot_roi(cell, "under")
        s["under_roi_ci"] = ci
        ps.append(s["p_vs_market_under_rate"])
    for s, q in zip(pooled, bh(ps)):
        s["bh_q"] = q
    with open(out / "spread_bands.csv", "w", newline="") as fh:
        keys = ["scope", "market", "band", "over_under", "props", "games", "W", "L", "P", "n", "hit", "units", "roi", "bets_priced", "no_price", "p_vs_market_under_rate", "bh_q", "under_roi_ci"]
        w = csv.DictWriter(fh, keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(res)
    # checkpoints
    def rec_of(m, lo, hi, side, season=None):
        c = [r for r in rows if r["market"] == m and lo <= r["team_spread"] <= hi and (season is None or r["season"] == season)]
        s = summarize(c, side)
        return f"{s['W']}-{s['L']}" + (f"-{s['P']}" if s["P"] else ""), s["games"]
    cps = []
    for label, m, lo, hi, side in (("Receiving yards Under, team +10 or more", "rec_yds", 10, 1e9, "under"),
                                   ("Receptions Under, team +10 or more", "rec", 10, 1e9, "under"),
                                   ("QB pass yds Over, team -10 or shorter", "pass_yds", -1e9, -10, "over"),
                                   ("QB pass yds Over, team +10 or more", "pass_yds", 10, 1e9, "over"),
                                   ("QB pass yds Under, team +10 or more", "pass_yds", 10, 1e9, "under"),
                                   ("Rushing yards Under, team +3 to +6.5 (pooled positions)", "rush_yds", 3, 6.5, "under")):
        cps.append((label, rec_of(m, lo, hi, side), rec_of(m, lo, hi, side, 2025), rec_of(m, lo, hi, side, 2026)))
    json.dump(cps, open(out / "checkpoints.json", "w"), indent=1)
    for c in cps:
        print(c)
    print("wrote spread_bands.csv", len(res))


if __name__ == "__main__":
    main()

"""Candidate-signal evaluation: spread bands + weather buckets over props.csv.
python -m research.signal_stacks.signal_eval [--out DIR]

For every candidate cell (market x condition x side) it reports pooled and per-season W-L-P, hit %, flat ROI at recorded
prices, distinct games, game-clustered bootstrap CI and p-value (props in one game are correlated, so games are resampled,
not props), ROI at a flat -110 and with every price shaded 5 points worse (price sensitivity), ROI after removing the 3
best games (concentration), the season-sign check, and a Benjamini-Hochberg q-value across the WHOLE candidate family
(all cells tried, both sides), so nothing is judged as if it were the only test run.

Weather: temperature/wind are the post-game nflverse record (2025, most of 2026) or Open-Meteo observed values (some
2026 games).  They describe what happened, NOT what a forecast said before kickoff.  Indoor = roof dome/closed.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

MKTS = ["pass_yds", "rush_yds", "rec", "rec_yds"]
SPREAD_BANDS = [("<=-10", -1e9, -9.9999), ("-9.5..-7", -9.5, -7.0), ("-6.5..-3", -6.5, -3.0), ("-2.5..+2.5", -2.5, 2.5),
                ("+3..+6.5", 3.0, 6.5), ("+7..+9.5", 7.0, 9.5), (">=+10", 10.0, 1e9)]
TEMP_BANDS = [("<40F", -99, 39.999), ("40-54F", 40, 54.999), ("55-69F", 55, 69.999), (">=70F", 70, 200)]


def payout(p):
    return p / 100 if p > 0 else 100 / abs(p)


def load(path):
    rows = []
    for r in csv.DictReader(open(path)):
        if r["result"] not in ("over", "under", "push"):
            continue
        r["season"] = int(r["season"]); r["line"] = float(r["line"])
        for k in ("over_price", "under_price", "team_spread", "temp_f", "wind_mph"):
            r[k] = float(r[k]) if r[k] not in ("", "None") else None
        rows.append(r)
    return rows


def conds(r):
    out = []
    if r["team_spread"] is not None:
        for n, lo, hi in SPREAD_BANDS:
            if lo <= r["team_spread"] <= hi:
                out.append(("spread", n))
    indoor = r["roof"] in ("dome", "closed")
    if indoor:
        out.append(("weather", "indoor/closed"))
    elif r["temp_f"] is not None:
        for n, lo, hi in TEMP_BANDS:
            if lo <= r["temp_f"] <= hi:
                out.append(("weather", "outdoor " + n))
        if r["temp_f"] < 55:
            out.append(("weather", "outdoor <55F (WX2 bucket)"))
        if r["wind_mph"] is not None:
            out.append(("weather", "outdoor wind>=15" if r["wind_mph"] >= 15 else "outdoor wind<15"))
    else:
        out.append(("weather", "outdoor, weather missing"))
    return out


def unit(r, side, shade=0, flat=None):
    """(units, counted) for one bet; pushes refunded (not counted)."""
    if r["result"] == "push":
        return 0.0, 0
    price = flat if flat is not None else r[f"{side}_price"]
    if price is None:
        return 0.0, 0
    if flat is None and shade:
        price = price - shade if price < 0 else price - shade
    return (payout(price) if r["result"] == side else -1.0), 1


def evaluate(cell, side, reps=2000, seed=5):
    w = sum(r["result"] == side for r in cell); l = sum(r["result"] not in (side, "push") for r in cell)
    p = sum(r["result"] == "push" for r in cell)
    per_game = defaultdict(lambda: [0.0, 0])
    per_player = defaultdict(float)
    for r in cell:
        u, c = unit(r, side)
        per_game[r["gid"]][0] += u; per_game[r["gid"]][1] += c
        per_player[r["pid"]] += u
    gids = list(per_game)
    U = np.array([per_game[g][0] for g in gids]); N = np.array([per_game[g][1] for g in gids])
    out = dict(W=w, L=l, P=p, games=len(gids), props=len(cell))
    n = N.sum()
    out["hit"] = w / (w + l) if w + l else None
    out["roi"] = float(U.sum() / n) if n else None
    out["units"] = float(U.sum())
    if len(gids) >= 8 and n:
        rng = np.random.default_rng(seed)
        idx = rng.integers(0, len(gids), size=(reps, len(gids)))
        boot = U[idx].sum(1) / np.maximum(N[idx].sum(1), 1)
        out["ci"] = (float(np.quantile(boot, .025)), float(np.quantile(boot, .975)))
        out["p"] = float(min(1.0, 2 * min((boot <= 0).mean(), (boot >= 0).mean()) + 1 / reps))
        keep = np.argsort(-U)[3:]
        out["roi_ex_top3_games"] = float(U[keep].sum() / max(N[keep].sum(), 1))
        top = sorted(per_player.values(), reverse=True)
        tot = sum(v for v in per_player.values() if v > 0)
        out["top_player_share_of_profit"] = float(top[0] / tot) if tot > 0 and top else None
    else:
        out.update(ci=None, p=1.0, roi_ex_top3_games=None, top_player_share_of_profit=None)
    for key, kw in (("roi_flat_m110", dict(flat=-110)), ("roi_shaded_5", dict(shade=5))):
        t = c = 0
        for r in cell:
            u, k = unit(r, side, **kw)
            t += u; c += k
        out[key] = t / c if c else None
    out["season_roi"] = {}
    for s in (2025, 2026):
        t = c = 0; ww = ll = 0
        for r in cell:
            if r["season"] != s:
                continue
            u, k = unit(r, side); t += u; c += k
            ww += r["result"] == side; ll += r["result"] not in (side, "push")
        out["season_roi"][s] = dict(roi=(t / c if c else None), W=ww, L=ll)
    return out


def bh(ps):
    order = np.argsort(ps)
    q = np.empty(len(ps)); prev = 1.0
    for rank, i in reversed(list(enumerate(order, 1))):
        prev = min(prev, ps[i] * len(ps) / rank); q[i] = prev
    return q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/home/claude/stix_research/out")
    out = Path(ap.parse_args().out)
    rows = load(out / "props.csv")
    cells = defaultdict(list)
    for r in rows:
        for fam, name in conds(r):
            cells[(fam, r["market"], name)].append(r)
            if r["market"] == "rush_yds":                       # position split for rushing (QB vs RB)
                cells[(fam, "rush_yds:" + r["pos"], name)].append(r)
    results = []
    for (fam, m, name), cell in sorted(cells.items()):
        if len(cell) < 30:
            continue
        for side in ("over", "under"):
            e = evaluate(cell, side)
            e.update(family=fam, market=m, condition=name, side=side)
            s25, s26 = e["season_roi"][2025]["roi"], e["season_roi"][2026]["roi"]
            e["same_sign_both_seasons"] = bool(s25 is not None and s26 is not None and (s25 > 0) == (s26 > 0) and e["roi"] is not None and (e["roi"] > 0) == (s25 > 0))
            results.append(e)
    # multiplicity family = every cell tried (both sides), excluding the position-split duplicates of rush_yds
    fam = [e for e in results if ":" not in e["market"]]
    q = bh(np.array([e["p"] for e in fam]))
    for e, qq in zip(fam, q):
        e["bh_q"] = float(qq)
    for e in results:
        e.setdefault("bh_q", None)
    json.dump(dict(family_size=len(fam), cells=results), open(out / "signal_candidates.json", "w"), indent=1, default=str)
    pos = sorted([e for e in fam if e["roi"] is not None and e["roi"] > 0.05 and e["games"] >= 20], key=lambda e: e["p"])
    print("family size", len(fam), "| cells with ROI>5% and >=20 games:", len(pos), "| min q:", min(e["bh_q"] for e in fam))
    for e in pos[:14]:
        print(f"{e['family']:7} {e['market']:9} {e['condition']:22} {e['side']:5} {e['W']}-{e['L']}-{e['P']} roi {e['roi']:+.3f} games {e['games']} p {e['p']:.3f} q {e['bh_q']:.2f} 25:{e['season_roi'][2025]['roi']} 26:{e['season_roi'][2026]['roi']} -110:{e['roi_flat_m110']:+.3f} shade5:{e['roi_shaded_5']:+.3f} ex3:{e['roi_ex_top3_games']}")
    # Weather table
    with open(out / "weather_splits.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["market", "condition", "side", "W", "L", "P", "hit", "roi", "games", "props", "roi_2025", "roi_2026", "ci_lo", "ci_hi", "p", "bh_q"])
        for e in results:
            if e["family"] == "weather":
                ci = e["ci"] or (None, None)
                w.writerow([e["market"], e["condition"], e["side"], e["W"], e["L"], e["P"], e["hit"], e["roi"], e["games"], e["props"],
                            e["season_roi"][2025]["roi"], e["season_roi"][2026]["roi"], ci[0], ci[1], e["p"], e["bh_q"]])
    miss = defaultdict(int)
    for r in rows:
        miss[(r["season"], "outdoor" if r["roof"] not in ("dome", "closed") else "indoor", r["temp_f"] is None)] += 1
    json.dump({str(k): v for k, v in miss.items()}, open(out / "weather_missing.json", "w"), indent=1)


if __name__ == "__main__":
    main()

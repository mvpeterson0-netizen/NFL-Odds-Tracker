"""Select 2024 discoveries (criteria fixed in discover.py's docstring) and grade them on 2025 and 2026."""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from research.discover_2024 import discover as D  # noqa: E402  (runs the candidate scan)

rows = D.rows
S, WK, UNITS, WIN, PUSH = D.S, D.WK, D.UNITS, D.WIN, D.PUSH
OUT = D.OUT
by_key = {}


def key_mask(r):
    k = (r["seg"], r["conds"], r["side"])
    if k not in by_key:
        by_key[k] = D.mask_of((r["seg"], tuple(r["conds"].split(" & ")), r["side"]))
    return by_key[k]


def rec(mask, side):
    n = int(mask.sum())
    if not n:
        return {"n": 0, "rec": "", "roi": None}
    w = int(WIN[side][mask].sum()); p = int(PUSH[mask].sum())
    return {"n": n, "rec": f"{w}-{n - w - p}", "roi": float(100 * UNITS[side][mask].sum() / n)}


def boot_ci(mask, side, seasons):
    sel = np.isin(D.CS, seasons)
    cu = np.bincount(D.CI[mask], weights=UNITS[side][mask], minlength=D.K)
    cn = np.bincount(D.CI[mask], minlength=D.K).astype(float)
    Wm = D.WT if seasons != [2024] else D.W24
    bu, bn = Wm @ cu, Wm @ cn
    r_ = np.where(bn > 0, bu / np.maximum(bn, 1), 0) * 100
    return float(np.percentile(r_, 2.5)), float(np.percentile(r_, 97.5)), float((np.sum(r_ <= 0) + 1) / (len(r_) + 1))


def matched_base(mask, side, seasons):
    tot, n = 0.0, 0
    for s in seasons:
        for sg in set(D.seg_of[mask & (S == s)]):
            k = int((mask & (S == s) & (D.seg_of == sg)).sum())
            bu, bn = D.base[(side, s, sg)]
            tot += k * bu / bn; n += k
    return 100 * tot / n if n else None


# ---------------------------------------------------------------- discovery sets
loose = [r for r in rows if r["n24"] >= 40 and r["roi24"] >= 10 and r["p24"] <= 0.05]
strict = [r for r in rows if r["q24"] <= 0.10]
single = [r for r in loose if r["k"] == 1]
top50 = sorted([r for r in rows if r["n24"] >= 60], key=lambda r: (r["p24"], -r["roi24"]))[:50]
# within-2024 replication: LOOSE and positive in both halves of 2024 (wk 1-9, wk 10-18)
split = []
for r in loose:
    m = key_mask(r)
    a = rec(m & (S == 2024) & (WK <= 9), r["side"]); b = rec(m & (S == 2024) & (WK >= 10), r["side"])
    if a["n"] >= 15 and b["n"] >= 15 and a["roi"] > 0 and b["roi"] > 0:
        split.append(r)
big = [r for r in rows if r["n24"] >= 100 and r["roi24"] >= 8 and r["p24"] <= 0.05]
roi20 = [r for r in loose if r["roi24"] >= 20]
under_only = [r for r in loose if r["side"] == "U"]
SETS = {"LOOSE": loose, "SPLIT": split, "SINGLE": single, "STRICT": strict, "TOP50": top50, "BIG": big, "ROI20": roi20,
        "LOOSE-Under": under_only}


def group(rs):
    """Greedy by 2024 p: a rule joins the first lead (same side) holding 50%+ of its 2024 bets."""
    leads = []
    for r in sorted(rs, key=lambda r: (r["p24"], -r["roi24"])):
        m = key_mask(r) & (S == 2024)
        for g in leads:
            if g["side"] == r["side"] and (m & g["_m24"]).sum() >= 0.5 * m.sum():
                g["members"].append(r)
                break
        else:
            leads.append({**r, "_m24": m, "members": [r]})
    return leads


def summarise(rs, name):
    out = {"set": name, "rules": len(rs)}
    if not rs:
        return out, []
    leads = group(rs)
    out["groups"] = len(leads)
    tested = [r for r in rs if r["nT"] >= 20]
    out["rules_pos_test"] = f"{sum(r['roiT'] > 0 for r in tested)}/{len(tested)}"
    out["rules_pos_both"] = f"{sum((r['roi25'] or -1) > 0 and (r['roi26'] or -1) > 0 for r in tested)}/{len(tested)}"
    out["median_roi24"] = float(np.median([r["roi24"] for r in rs]))
    out["median_roiT"] = float(np.median([r["roiT"] for r in tested])) if tested else None
    lt = [g for g in leads if g["nT"] >= 20]
    out["leads_pos_test"] = f"{sum(g['roiT'] > 0 for g in lt)}/{len(lt)}"
    # portfolio: every bet any rule in the set picks, each prop-side counted once
    for side in ("U", "O"):
        m = np.zeros(D.N, bool)
        for r in rs:
            if r["side"] == side:
                m |= key_mask(r)
        if m.any():
            for tag, ss in (("24", [2024]), ("25", [2025]), ("26", [2026]), ("T", [2025, 2026])):
                x = rec(m & np.isin(S, ss), side)
                out[f"port{side}_{tag}"] = x
            lo, hi, pv = boot_ci(m & np.isin(S, [2025, 2026]), side, [2025, 2026])
            out[f"port{side}_T_ci"] = [lo, hi, pv]
            out[f"port{side}_T_base"] = matched_base(m, side, [2025, 2026])
    detail = []
    for g in leads:
        m = key_mask(g)
        d = {k: g[k] for k in ("seg", "conds", "side", "n24", "w24", "l24", "roi24", "lo24", "hi24", "p24", "q24",
                                "n25", "w25", "l25", "roi25", "n26", "w26", "l26", "roi26", "nT", "w24", "roiT")}
        d["members"] = len(g["members"])
        d["member_list"] = [f"{x['seg']} | {x['conds']}" for x in g["members"][:12]]
        if g["nT"]:
            d["loT"], d["hiT"], d["pT"] = boot_ci(m & np.isin(S, [2025, 2026]), g["side"], [2025, 2026])
            d["baseT"] = matched_base(m & np.isin(S, [2025, 2026]), g["side"], [2025, 2026])
        detail.append(d)
    return out, detail


summ, details = [], {}
for nm, rs in SETS.items():
    s_, d_ = summarise(rs, nm)
    summ.append(s_)
    details[nm] = d_

# ---------------------------------------------------------------- calibration: does 2024 ROI predict 2025-26 ROI?
cal = []
bins = [(-1e9, -20), (-20, -10), (-10, 0), (0, 10), (10, 20), (20, 30), (30, 1e9)]
for side in ("U", "O"):
    pool = [r for r in rows if r["side"] == side and r["nT"] >= 40]
    for lo, hi in bins:
        b = [r for r in pool if lo <= r["roi24"] < hi]
        if not b:
            continue
        wt = np.array([r["nT"] for r in b], float)
        cal.append({"side": side, "bin": f"{lo if lo > -1e8 else ''}..{hi if hi < 1e8 else ''}", "rules": len(b),
                    "mean_roi24": float(np.mean([r["roi24"] for r in b])),
                    "wmean_roiT": float(np.average([r["roiT"] for r in b], weights=wt)),
                    "pos_test": float(np.mean([r["roiT"] > 0 for r in b]) * 100)})
    x = np.array([r["roi24"] for r in pool]); y = np.array([r["roiT"] for r in pool]); w = np.array([r["nT"] for r in pool], float)
    xm, ym = np.average(x, weights=w), np.average(y, weights=w)
    slope = np.sum(w * (x - xm) * (y - ym)) / np.sum(w * (x - xm) ** 2)
    cal.append({"side": side, "bin": "slope", "rules": len(pool), "slope": float(slope),
                "corr": float(np.corrcoef(x, y)[0, 1]), "all_pos_test": float(np.mean(y > 0) * 100)})

for side in ("U", "O"):
    for k in (1, 2):
        pool = [r for r in rows if r["side"] == side and r["nT"] >= 40 and r["k"] == k]
        x = np.array([r["roi24"] for r in pool]); y = np.array([r["roiT"] for r in pool]); w = np.array([r["nT"] for r in pool], float)
        xm, ym = np.average(x, weights=w), np.average(y, weights=w)
        cal.append({"side": side, "bin": f"slope k={k}", "rules": len(pool),
                    "slope": float(np.sum(w * (x - xm) * (y - ym)) / np.sum(w * (x - xm) ** 2)), "corr": float(np.corrcoef(x, y)[0, 1])})
# where the theses found on 2025-26 would have ranked in the 2024 scan (closest grid cell)
ref = [("QB rush yds", "line high third", "U"), ("QB rush yds", "line high third & weeks 5-11", "U"),
       ("all rec yds", "dog 7+", "U"), ("RB rec yds", "dog 7+", "U"), ("WR rec yds", "dog 7+", "U"), ("TE rec yds", "dog 7+", "U"),
       ("all rec yds", "last game 40+ rec yds and Over & career short-catch (<10.6 ypc, 40+ catches)", "U"),
       ("all rec yds", "wind 15+ outdoor", "U"), ("all rush yds", "wind 15+ outdoor", "U")]
U24 = sorted([r for r in rows if r["side"] == "U"], key=lambda r: r["p24"])
rank = {(r["seg"], r["conds"], r["side"]): i + 1 for i, r in enumerate(U24)}
refout = []
for sg, cs, sd in ref:
    hit = [r for r in rows if r["seg"] == sg and r["conds"] == cs and r["side"] == sd]
    if hit:
        r = hit[0]
        refout.append({"seg": sg, "conds": cs, "rank24": rank[(sg, cs, sd)], "of": len(U24), **{k: r[k] for k in
                       ("w24", "l24", "roi24", "p24", "w25", "l25", "roi25", "w26", "l26", "roi26", "roiT")}})
    else:
        refout.append({"seg": sg, "conds": cs, "note": "under 40 bets in 2024"})
json.dump({"summary": summ, "details": details, "calibration": cal, "reference": refout}, open(f"{OUT}/results.json", "w"), indent=1, default=str)
for s_ in summ:
    print({k: v for k, v in s_.items() if not k.startswith("port") or k.endswith("_T") or k.endswith("ci") or k.endswith("base")})
for c in cal:
    print(c)

"""2024-only discovery, graded on 2025 and 2026 (rec_yds + rush_yds; the only markets in the 2024 archive).

Design (fixed before looking at any 2025/2026 result of these rules):
  * Universe: REG-season props, rec_yds (WR/TE/RB) and rush_yds (QB/RB). 1 unit at the saved side price, push = 0.
  * Candidates: ~75 generic conditions with round-number thresholds, singly and in pairs, x 8 segments x Under/Over.
  * Discovery sets, chosen on 2024 alone:
      LOOSE  : 2024 bets >= 40, 2024 ROI >= +10%, 2024 one-sided week-bootstrap p <= 0.05
      STRICT : Benjamini-Hochberg q <= 0.10 across every candidate with 40+ 2024 bets
      SINGLE : LOOSE, but single-condition rules only (less mining)
      TOP50  : 50 best 2024 p-values among rules with 60+ 2024 bets
  * Overlapping discoveries are grouped (greedy by 2024 p; a rule joins a group when 50%+ of its 2024 bets are
    already in the group's lead rule) so one effect isn't counted twenty times.
  * Test = 2025 and 2026 (wk 1-11), never used for selection.
Career catches/yards are seeded from 2022-23 play-by-play (SEED2223=1) so 2024 short/long-catch labels are usable.
Spread, total and weather are nflverse closing-type / observed values (not what was known at line capture).
"""
from __future__ import annotations

import csv
import itertools
import json
import os
import sys
from collections import defaultdict

import numpy as np

os.environ.setdefault("SEED2223", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from research.three_season.features import build  # noqa: E402

np.seterr(all="ignore")
OUT = os.environ.get("DISC_OUT", "/tmp/disc")
os.makedirs(OUT, exist_ok=True)
B = 4000
rng = np.random.default_rng(20261122)

F = build()
keep = np.isin(F["mid"], ["rec_yds", "rush_yds"]) & ~((F["mid"] == "rush_yds") & ~np.isin(F["pos"], ["QB", "RB"]))
F = {k: v[keep] for k, v in F.items()}
N = len(F["line"])
S, WK, POS, MID, RES = F["season"].astype(int), F["wk"].astype(int), F["pos"], F["mid"], F["res"]
L, UP, OP = F["line"], F["up"], F["op"]


def payout(o):
    return np.where(o > 0, o / 100, 100 / np.abs(o))


UNITS = {"U": np.where(RES == "push", 0, np.where(RES == "under", payout(UP), -1.0)),
         "O": np.where(RES == "push", 0, np.where(RES == "over", payout(OP), -1.0))}
WIN = {"U": RES == "under", "O": RES == "over"}
PUSH = RES == "push"
CL = np.array([f"{s}-{w:02d}" for s, w in zip(S, WK)])
CLK = sorted(set(CL))
CI = np.array([CLK.index(c) for c in CL])
K = len(CLK)
CS = np.array([int(c[:4]) for c in CLK])

# ------------------------------------------------------------------ conditions (all pre-game except the noted closing-type)
f = F
nan = np.isnan
pl, pact, m3, mszn, a1 = f["pl"], f["pact"], f["m3"], f["mszn"], f["a1"]
pres = f["pres"]
ts, tot = f["ts"], f["total"]
hc, hy = f["hc"], f["hy"]
cyp = np.where(hc >= 40, hy / np.maximum(hc, 1), np.nan)
r3 = f["r3"]
n_over3 = np.array([x.split("|").count("over") if x else -1 for x in r3])
n_under3 = np.array([x.split("|").count("under") if x else -1 for x in r3])
slot = f["slot"]
yds_tol = 5.0

# line terciles per segment, from 2024 only
seg_of = np.array([f"{m}-{p}" for m, p in zip(MID, POS)])
lo_cut, hi_cut = {}, {}
for sg in set(seg_of):
    v = L[(seg_of == sg) & (S == 2024)]
    if len(v) >= 30:
        lo_cut[sg], hi_cut[sg] = np.percentile(v, [33.3, 66.7])
LO = np.array([L[i] <= lo_cut.get(seg_of[i], -1) for i in range(N)])
HI = np.array([L[i] >= hi_cut.get(seg_of[i], 1e9) for i in range(N)])

C = {
    # line vs his own recent production
    "L>=1.2*L3avg": L >= 1.2 * m3, "L<=0.8*L3avg": L <= 0.8 * m3,
    "L>=1.4*L3avg": L >= 1.4 * m3, "L<=0.6*L3avg": L <= 0.6 * m3,
    "L>=1.2*szn": L >= 1.2 * mszn, "L<=0.8*szn": L <= 0.8 * mszn,
    "last>=2xL": a1 >= 2 * L, "last<=0.5xL": a1 <= 0.5 * L,
    # line move vs his previous game's line
    "line up 10%+": ~nan(pl) & (L >= 1.10 * pl), "line up 25%+": ~nan(pl) & (L >= 1.25 * pl),
    "line down 10%+": ~nan(pl) & (L <= 0.90 * pl), "line down 25%+": ~nan(pl) & (L <= 0.75 * pl),
    "line flat": ~nan(pl) & (np.abs(L - pl) <= yds_tol),
    # previous result vs its line
    "last Over": pres == "over", "last Under": pres == "under",
    "beat last line 50%+": pact >= 1.5 * pl, "missed last line by 50%+": pact <= 0.5 * pl,
    "3 straight Overs": n_over3 == 3, "3 straight Unders": n_under3 == 3,
    "2+ of last 3 Over": n_over3 >= 2, "2+ of last 3 Under": n_under3 >= 2,
    # usage
    "tgt share +5 pts last game": f["tsh_chg"] >= 5, "tgt share -5 pts last game": f["tsh_chg"] <= -5,
    "usage rising (last 2 vs earlier +5)": f["u_last2"] >= f["u_early"] + 5,
    "usage falling (last 2 vs earlier -5)": f["u_last2"] <= f["u_early"] - 5,
    "low snaps last game": f["lowp"], "back from missed game": f["missed"] >= 1,
    "4+ games played": f["n_played"] >= 4, "under 4 games played": f["n_played"] < 4,
    # depth slot (approx pre-game, from snaps)
    "slot 1": np.char.endswith(slot.astype(str), "1"), "slot 2": np.char.endswith(slot.astype(str), "2"),
    "slot 3": np.char.endswith(slot.astype(str), "3"),
    # line size within segment (2024 terciles)
    "line low third": LO, "line high third": HI, "line mid third": ~LO & ~HI,
    # game context (spread/total closing-type)
    "fav 7+": ts <= -7, "fav 3-6.5": (ts > -7) & (ts <= -3), "near pick (<3)": np.abs(ts) < 3,
    "dog 3-6.5": (ts >= 3) & (ts < 7), "dog 7+": ts >= 7,
    "total 48+": tot >= 48, "total <=41": tot <= 41,
    "home": f["home"], "away": ~f["home"], "division game": f["div"], "prime time": f["prime"],
    "off bye (10+ days)": f["rest"] >= 10, "short rest (<=5)": f["rest"] <= 5,
    "wind 15+ outdoor": f["outdoor"] & (f["wind"] >= 15), "temp <=35": f["temp"] <= 35, "dome/closed": f["dome"],
    # previous team game script
    "team trailed 7+ on 40%+ of plays last game": f["tr7"] >= 0.4, "team led 7+ on 40%+ of plays last game": f["ld7"] >= 0.4,
    "team covered last game": f["ats_t"] == "C", "team failed to cover last game": f["ats_t"] == "NC",
    "opp covered last game": f["ats_o"] == "C", "opp failed to cover last game": f["ats_o"] == "NC",
    # opponent (this season's allowed, quartiles)
    "opp tough vs position": f["oppq"] == "tough", "opp soft vs position": f["oppq"] == "soft",
    # price the book hung on this side
    "Under priced -125 or shorter": UP <= -125, "Under priced -105 or longer": UP >= -105,
    # calendar
    "weeks 1-4": WK <= 4, "weeks 5-11": (WK >= 5) & (WK <= 11), "weeks 12+": WK >= 12,
    # receiving detail of his last game
    "last game 40+ rec yds and Over": (f["rd_tot"] >= 40) & (pres == "over"),
    "one catch was 50%+ of last game's yds": f["rd_lc"] >= 0.5 * f["rd_tot"],
    "1st half alone beat last line": f["rd_h1"] > pl,
    "career short-catch (<10.6 ypc, 40+ catches)": cyp < 10.6, "career long-catch (13+ ypc, 40+ catches)": cyp >= 13,
    "QB changed this game": f["qbch"],
}
C = {k: np.asarray(v, dtype=bool) for k, v in C.items()}
SEG = {
    "WR rec yds": (MID == "rec_yds") & (POS == "WR"), "TE rec yds": (MID == "rec_yds") & (POS == "TE"),
    "RB rec yds": (MID == "rec_yds") & (POS == "RB"), "RB rush yds": (MID == "rush_yds") & (POS == "RB"),
    "QB rush yds": (MID == "rush_yds") & (POS == "QB"), "all rec yds": MID == "rec_yds",
    "all rush yds": MID == "rush_yds", "all": np.ones(N, bool),
}
Y24 = S == 2024
TEST = (S == 2025) | (S == 2026)

# ------------------------------------------------------------------ enumerate
names = list(C)
rules = []  # (seg, conds tuple, side)
for sg in SEG:
    for side in ("U", "O"):
        for a in names:
            rules.append((sg, (a,), side))
        for a, b in itertools.combinations(names, 2):
            rules.append((sg, (a, b), side))


def mask_of(r):
    sg, cs, _ = r
    m = SEG[sg].copy()
    for c in cs:
        m &= C[c]
    return m


# bootstrap weights: separate resampling of 2024 weeks and of 2025-26 weeks
def wmat(sel):
    idx = np.where(sel)[0]
    Wm = np.zeros((B, K))
    for b in range(B):
        np.add.at(Wm[b], rng.choice(idx, len(idx)), 1)
    return Wm


W24, WT = wmat(CS == 2024), wmat(CS != 2024)

ONE = np.zeros((N, K))
ONE[np.arange(N), CI] = 1

rows = []
CH = 3000
for s0 in range(0, len(rules), CH):
    chunk = rules[s0:s0 + CH]
    M = np.array([mask_of(r) for r in chunk])
    n24 = (M & Y24).sum(1)
    ok = n24 >= 40
    if not ok.any():
        continue
    M, chunk = M[ok], [r for r, o in zip(chunk, ok) if o]
    for side in ("U", "O"):
        sel = np.array([r[2] == side for r in chunk])
        if not sel.any():
            continue
        Ms = M[sel].astype(float)
        cu = Ms @ (ONE * UNITS[side][:, None])      # rules x clusters units
        cn = Ms @ ONE                                # rules x clusters bets
        cw = Ms @ (ONE * WIN[side][:, None])
        cp = Ms @ (ONE * PUSH[:, None])

        def boot(Wm):
            bu, bn = cu @ Wm.T, cn @ Wm.T
            r_ = np.where(bn > 0, bu / np.maximum(bn, 1), 0)
            return r_

        b24, bT = boot(W24), boot(WT)
        for j, r in enumerate([r for r in chunk if r[2] == side]):
            out = {"seg": r[0], "conds": " & ".join(r[1]), "k": len(r[1]), "side": side}
            for tag, cm in (("24", CS == 2024), ("25", CS == 2025), ("26", CS == 2026), ("T", CS != 2024)):
                n = cn[j, cm].sum()
                out["n" + tag] = int(n)
                out["w" + tag] = int(cw[j, cm].sum())
                out["l" + tag] = int(n - cw[j, cm].sum() - cp[j, cm].sum())
                out["roi" + tag] = float(100 * cu[j, cm].sum() / n) if n else None
            out["p24"] = float((np.sum(b24[j] <= 0) + 1) / (B + 1))
            out["lo24"], out["hi24"] = (float(x) for x in np.percentile(b24[j] * 100, [2.5, 97.5]))
            if out["nT"]:
                out["pT"] = float((np.sum(bT[j] <= 0) + 1) / (B + 1))
                out["loT"], out["hiT"] = (float(x) for x in np.percentile(bT[j] * 100, [2.5, 97.5]))
            out["_i"] = len(rows)
            rows.append(out)
            R_MASK = None  # noqa
    print(f"{min(s0 + CH, len(rules))}/{len(rules)} candidates, {len(rows)} with 40+ 2024 bets", flush=True)

# BH q on 2024 p across all evaluated candidates
p = np.array([r["p24"] for r in rows])
o = np.argsort(p)
q = np.empty(len(p))
run = 1.0
for rank in range(len(p), 0, -1):
    i = o[rank - 1]
    run = min(run, p[i] * len(p) / rank)
    q[i] = run
for r, qq in zip(rows, q):
    r["q24"] = float(qq)

# matched baselines (same season x segment-market-position x side) for the test period
base = {}
for side in ("U", "O"):
    for s in (2024, 2025, 2026):
        for sg in set(seg_of):
            mk = (S == s) & (seg_of == sg)
            if mk.sum():
                base[(side, s, sg)] = (UNITS[side][mk].sum(), int(mk.sum()))

json.dump(rows, open(f"{OUT}/candidates.json", "w"))
print("candidates evaluated:", len(rows))

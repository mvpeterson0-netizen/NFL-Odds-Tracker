"""Line shopping: Under at the highest line / Over at the lowest line across books at the same moment (kickoff - 3 h).
2024/2025: raw archive snapshots (10 books). 2026 weeks 8+: prop_captures.csv (DK/FD) + data/other_books pregame pulls."""
from __future__ import annotations

import csv, glob, json, pickle
from collections import defaultdict
from pathlib import Path

import numpy as np

from pipeline.common import norm_name

ROOT = Path(__file__).resolve().parents[2]
KEY2MID = {"player_pass_yds": "pass_yds", "player_rush_yds": "rush_yds", "player_receptions": "rec", "player_reception_yds": "rec_yds"}
d = pickle.load(open("/tmp/three_season.pkl", "rb"))
games, props = d["games"], d["props"]
act = {}
names = defaultdict(dict)
for p in props:
    if p["res"] in ("over", "under", "push") and p["act"] is not None:
        act[(p["gid"], p["pid"], p["mid"])] = (p["act"], p["season"], p["wk"], p["pos"])
        names[p["gid"]][norm_name(p["name"])] = p["pid"]


def imp(o):
    return 100 / (o + 100) if o > 0 else -o / (-o + 100)


def main_pt(pts):
    two = {k: v for k, v in pts.items() if "Over" in v and "Under" in v}
    if not two:
        return None
    return min(two, key=lambda k: (abs(imp(two[k]["Over"]) / (imp(two[k]["Over"]) + imp(two[k]["Under"])) - 0.5), k))


rows = []   # (season, wk, pos, mid, act, {book: (line, op, up)})
for s in (2024, 2025):
    for f in glob.glob(str(ROOT / f"data/history_{s}/odds/*.json")):
        a = json.load(open(f))
        gid = a["game_id"]
        if gid not in games:
            continue
        per = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
        for b in (a["response"].get("data") or {}).get("bookmakers", []):
            for m in b["markets"]:
                mid = KEY2MID.get(m["key"])
                if not mid:
                    continue
                for o in m["outcomes"]:
                    per[(o["description"], mid)][b["key"]].setdefault(o["point"], {})[o["name"]] = o["price"]
        for (nm, mid), books in per.items():
            pid = names[gid].get(norm_name(nm))
            if not pid or (gid, pid, mid) not in act:
                continue
            bl = {}
            for bk, pts in books.items():
                pt = main_pt(pts)
                if pt is not None:
                    bl[bk] = (pt, pts[pt]["Over"], pts[pt]["Under"])
            av = act[(gid, pid, mid)]
            rows.append((s, av[2], av[3], mid, av[0], bl, gid, pid))
# 2026 weeks 8+
cap = defaultdict(dict)
for r in csv.DictReader(open(ROOT / "data/prop_captures.csv")):
    if r["pull_type"] != "pregame" or not r.get("gsis_id"):
        continue
    mid = KEY2MID.get(r["market"])
    if mid:
        cap[(r["game_id"], r["gsis_id"], mid)].setdefault(r["book"], []).append(r)
for f in glob.glob(str(ROOT / "data/other_books/week_*.csv")):
    for r in csv.DictReader(open(f)):
        if r["pull_type"] != "pregame" or not r.get("gsis_id"):
            continue
        mid = KEY2MID.get(r["market"])
        if mid:
            cap[(r["game_id"], r["gsis_id"], mid)].setdefault(r["book"], []).append(r)
for (gid, pid, mid), books in cap.items():
    if (gid, pid, mid) not in act or games.get(gid, {}).get("wk", 0) < 8 or games[gid]["season"] != 2026:
        continue
    bl = {}
    for bk, rs in books.items():
        first = min(rs, key=lambda x: x["captured_utc"])["captured_utc"]
        pts = defaultdict(dict)
        for x in rs:
            if x["captured_utc"] == first and x["over_price"] and x["under_price"]:
                pts[float(x["line"])] = {"Over": float(x["over_price"]), "Under": float(x["under_price"])}
        pt = main_pt(pts)
        if pt is not None:
            bl[bk] = (pt, pts[pt]["Over"], pts[pt]["Under"])
    av = act[(gid, pid, mid)]
    rows.append((2026, av[2], av[3], mid, av[0], bl, gid, pid))


def pay(o):
    return o / 100 if o > 0 else 100 / abs(o)


def grade(a, line, price, side):
    if a == line:
        return 0.0
    win = a < line if side == "U" else a > line
    return pay(price) if win else -1.0


MAJOR = {"draftkings", "fanduel", "betmgm", "williamhill_us", "betrivers", "espnbet", "fanatics", "hardrockbet"}
res = defaultdict(lambda: defaultdict(list))
BEST = {}
for s, wk, pos, mid, a, bl, gid, pid in rows:
    if "draftkings" not in bl and "fanduel" not in bl:
        continue
    ref = bl.get("draftkings") or bl.get("fanduel")
    for tag, pool in (("all books", bl), ("major books (no Fliff/Bally)", {k: v for k, v in bl.items() if k in MAJOR}), ("DK + FD only", {k: v for k, v in bl.items() if k in ("draftkings", "fanduel")})):
        if not pool:
            continue
        # Under: highest line, then best Under price at that line
        hi = max(v[0] for v in pool.values())
        upr = max(v[2] for v in pool.values() if v[0] == hi)
        lo = min(v[0] for v in pool.values())
        opr = max(v[1] for v in pool.values() if v[0] == lo)
        diff = hi - ref[0]
        res[(tag, "U")]["all"].append((s, mid, grade(a, hi, upr, "U")))
        if tag.startswith("major"):
            BEST[f"{gid}|{pid}|{mid}"] = (grade(a, hi, upr, "U"), grade(a, lo, opr, "O"))
        res[(tag, "O")]["all"].append((s, mid, grade(a, lo, opr, "O")))
        thr = 1.0 if mid != "rec" else 0.5
        if diff >= thr:
            res[(tag, "U")]["best line above DK/FD main"].append((s, mid, grade(a, hi, upr, "U")))
        if mid != "rec" and diff >= 5:
            res[(tag, "U")]["best line 5+ yds above DK/FD main"].append((s, mid, grade(a, hi, upr, "U")))
    res[("reference: DK main (FD fallback)", "U")]["all"].append((s, mid, grade(a, ref[0], ref[2], "U")))
    res[("reference: DK main (FD fallback)", "O")]["all"].append((s, mid, grade(a, ref[0], ref[1], "O")))
out = []
for (tag, side), dct in res.items():
    for sub, lst in dct.items():
        for mid in ("ALL", "rec_yds", "rush_yds", "rec", "pass_yds"):
            l2 = [x for x in lst if mid == "ALL" or x[1] == mid]
            if not l2:
                continue
            row = {"pool": tag, "side": side, "subset": sub, "market": mid, "bets": len(l2), "roi": 100 * sum(x[2] for x in l2) / len(l2)}
            for s in (2024, 2025, 2026):
                l3 = [x for x in l2 if x[0] == s]
                row[f"n{s}"] = len(l3); row[f"roi{s}"] = 100 * sum(x[2] for x in l3) / len(l3) if l3 else None
            out.append(row)
json.dump(out, open("/tmp/shop.json", "w"))
json.dump(BEST, open("/tmp/shop_best.json", "w"))
for r in out:
    if r["market"] == "ALL" or r["subset"] != "all":
        f_ = lambda v: "  -  " if v is None else f"{v:+.1f}"
        print(f"{r['pool'][:28]:28s} {r['side']} {r['subset'][:30]:30s} {r['market']:8s} n{r['bets']:6d} {f_(r['roi'])} | 24 {f_(r['roi2024'])} n{r['n2024']} | 25 {f_(r['roi2025'])} n{r['n2025']} | 26 {f_(r['roi2026'])} n{r['n2026']}")

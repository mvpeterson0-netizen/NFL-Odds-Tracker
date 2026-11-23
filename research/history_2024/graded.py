"""2024 graded props table from the raw archive in data/history_2024/odds (rush yds + rec yds).

Reproduce:  python -m research.history_2024.graded [--cache DIR] [--out DIR]
Same rules and columns as research/signal_stacks/dataset.py (2025 block), so 2024 rows can be scored with the
same signal code: main line = DraftKings first, FanDuel only when DK has no line for that player/market; within a
book the point whose two prices are closest to even money. Results from nflverse weekly player stats; a player
with snaps but no stat line = 0; a team that played but the player had no snaps = void. Regular season AND playoffs
(column game_type). Output props_2024.csv + unmatched_2024.csv in --out (not committed, like signal_stacks).
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

from pipeline.common import norm_name
from research.signal_stacks.dataset import FIELDS, KEY2MID, MARKETS, BOOK_ORDER, fl, main_line, rd, team_spread

ROOT = Path(__file__).resolve().parents[2]
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
FILES = {"stats_2024.csv": "stats_player/stats_player_week_2024.csv",
         "snaps_2024.csv": "snap_counts/snap_counts_2024.csv",
         "roster_2024.csv": "weekly_rosters/roster_weekly_2024.csv"}
POS = ("QB", "RB", "WR", "TE", "FB")


def fetch(cache: Path):
    cache.mkdir(parents=True, exist_ok=True)
    for name, rel in FILES.items():
        p = cache / name
        if not p.exists():
            req = urllib.request.Request(f"{NFLVERSE}/{rel}", headers={"User-Agent": "stix-research"})
            p.write_bytes(urllib.request.urlopen(req, timeout=180).read())


def build(cache: Path, out: Path):
    sched = {g["game_id"]: g for g in json.load(open(ROOT / "data/history_2024/schedule.json"))}
    stats = [r for r in rd(cache / "stats_2024.csv") if r["season_type"] in ("REG", "POST")]
    snaps = rd(cache / "snaps_2024.csv")
    roster = rd(cache / "roster_2024.csv")
    idx, info = defaultdict(dict), {}
    for r in stats:
        if r["position"] not in POS:
            continue
        idx[(int(r["week"]), r["team"])].setdefault(norm_name(r["player_display_name"]), set()).add(r["player_id"])
        info[r["player_id"]] = (r["player_display_name"], "RB" if r["position"] == "FB" else r["position"])
    for r in roster:
        pid = r.get("gsis_id") or ""
        if r["position"] not in POS or not pid:
            continue
        idx[(int(r["week"]), r["team"])].setdefault(norm_name(r["full_name"]), set()).add(pid)
        info.setdefault(pid, (r["full_name"], "RB" if r["position"] == "FB" else r["position"]))
    st = {(int(r["week"]), r["player_id"]): r for r in stats}
    snap_by_name, snap_games = defaultdict(float), set()
    for r in snaps:
        snap_by_name[(int(r["week"]), r["team"], norm_name(r["player"]))] += fl(r.get("offense_snaps")) or 0
        snap_games.add((int(r["week"]), r["team"]))
    stat_teams = {(int(r["week"]), r["team"]) for r in stats}

    def match(name, week, teams):
        nm = norm_name(name)
        hits = set()
        for t in teams:
            hits |= idx.get((week, t), {}).get(nm, set())
        if len(hits) == 1:
            return hits.pop()
        if not hits:
            parts = nm.split()
            if len(parts) >= 2:
                for t in teams:
                    for kk, pids in idx.get((week, t), {}).items():
                        p2 = kk.split()
                        if len(p2) >= 2 and p2[1:] == parts[1:] and min(len(parts[0]), len(p2[0])) >= 3 and \
                                (p2[0].startswith(parts[0]) or parts[0].startswith(p2[0])) and len(pids) == 1:
                            hits |= pids
                if len(hits) == 1:
                    return hits.pop()
        return None

    rows, unmatched = [], []
    for f in sorted(glob.glob(str(ROOT / "data/history_2024/odds/*.json"))):
        a = json.load(open(f))
        gid = a["game_id"]
        g = sched[gid]
        week = int(g["week"])
        snap_ts = a["response"].get("timestamp", "")
        per = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
        for b in (a["response"].get("data") or {}).get("bookmakers", []):
            if b["key"] not in BOOK_ORDER:
                continue
            for m in b["markets"]:
                mid = KEY2MID.get(m["key"])
                if not mid:
                    continue
                for o in m["outcomes"]:
                    per[(o["description"], mid)][b["key"]].setdefault(str(o["point"]), {})[o["name"].lower()] = o["price"]
        for (name, mid), books in per.items():
            ml = main_line(books)
            if ml is None:
                continue
            book, pt, op, up = ml
            teams = (g["home_team"], g["away_team"])
            pid = match(name, week, teams)
            row = st.get((week, pid)) if pid else None
            team = row["team"] if row else None
            if pid and team is None:
                cands = [t for t in teams if pid in idx.get((week, t), {}).get(norm_name(info[pid][0]), set())]
                team = cands[0] if len(cands) == 1 else None
            if pid is None or team not in teams:
                unmatched.append({"gid": gid, "name": name, "market": mid, "reason": "no unique player" if pid is None else "team"})
                continue
            nm, pos = info[pid]
            if row:
                played, actual = True, fl(row.get(MARKETS[mid][1])) or 0.0
            elif snap_by_name.get((week, team, norm_name(nm)), 0) > 0:
                played, actual = True, 0.0
            elif (week, team) in stat_teams and (week, team) in snap_games:
                played, actual = False, None
            else:
                played, actual = None, None
            ln = fl(pt)
            res = "void" if played is False else "" if actual is None else (
                "over" if actual > ln else "under" if actual < ln else "push")
            sp_home, _ = team_spread(g, g["home_team"])
            _, ts = team_spread(g, team)
            rows.append(dict(season=2024, week=week, gid=gid, pid=pid, name=nm, pos=pos, team=team,
                             ha="home" if team == g["home_team"] else "away", market=mid, line=ln,
                             over_price=op, under_price=up, book=book, cap_utc=snap_ts, mins_before_ko="180",
                             actual=actual, result=res, played=played, kickoff_utc=g["kickoff_utc"],
                             spread_home_fav=sp_home, team_spread=ts,
                             spread_src="nflverse schedule spread_line (post-hoc/closing-type; not capture-time)",
                             total_line=g.get("total_line"), roof=g.get("roof", ""), temp_f=fl(g.get("temp")),
                             wind_mph=fl(g.get("wind")), weather_src="nflverse schedule (post-game record)",
                             game_type=g["game_type"]))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "props_2024.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, FIELDS + ["game_type"])
        w.writeheader()
        w.writerows(rows)
    with open(out / "unmatched_2024.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, ["gid", "name", "market", "reason"])
        w.writeheader()
        w.writerows(unmatched)
    return rows, unmatched


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/tmp/nflverse_2024")
    ap.add_argument("--out", default="/tmp/history_2024_out")
    a = ap.parse_args()
    fetch(Path(a.cache))
    rows, un = build(Path(a.cache), Path(a.out))
    print(len(rows), "graded rows;", len(un), "unmatched")

"""Signal Stacks research dataset: one pregame main line per (season, game, player, market).

Reproduce:  python -m research.signal_stacks.dataset  [--cache DIR] [--out DIR]
Inputs (never committed): data/history_2025/odds/*.json (raw 2025 archive), site/data/data.json (2026 graded rows),
nflverse stats / snaps / rosters / schedule (downloaded into --cache).  Output: props.csv in --out (never inside
site/ and never committed -- see research/signal_stacks/README.md).

Main-line rule (same as the app's pipeline.build.choose_main): DraftKings first, FanDuel only when DraftKings has no
line for that player and market; within a book the point whose two prices are closest to even money (both prices
required when any point has both).  2025 = the archive snapshot at kickoff - 3 h; 2026 = the app's graded pregame
capture (each book's first pregame capture, ~3 h before kickoff).
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import urllib.request
from collections import defaultdict
from pathlib import Path

from pipeline.common import norm_name

ROOT = Path(__file__).resolve().parents[2]
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
MARKETS = {  # market id -> (odds api key, nflverse stats column)
    "pass_yds": ("player_pass_yds", "passing_yards"),
    "rush_yds": ("player_rush_yds", "rushing_yards"),
    "rec": ("player_receptions", "receptions"),
    "rec_yds": ("player_reception_yds", "receiving_yards"),
}
KEY2MID = {v[0]: k for k, v in MARKETS.items()}
BOOK_ORDER = ["draftkings", "fanduel"]
FILES = {
    "games.csv": "schedules/games.csv",
    "stats_2025.csv": "stats_player/stats_player_week_2025.csv",
    "stats_2026.csv": "stats_player/stats_player_week_2026.csv",
    "snaps_2025.csv": "snap_counts/snap_counts_2025.csv",
    "snaps_2026.csv": "snap_counts/snap_counts_2026.csv",
    "roster_2025.csv": "weekly_rosters/roster_weekly_2025.csv",
}
FIELDS = ["season", "week", "gid", "pid", "name", "pos", "team", "ha", "market", "line", "over_price", "under_price",
          "book", "cap_utc", "mins_before_ko", "actual", "result", "played", "kickoff_utc", "spread_home_fav",
          "team_spread", "spread_src", "total_line", "roof", "temp_f", "wind_mph", "weather_src"]


def fetch(cache: Path):
    cache.mkdir(parents=True, exist_ok=True)
    for name, rel in FILES.items():
        p = cache / name
        if not p.exists():
            req = urllib.request.Request(f"{NFLVERSE}/{rel}", headers={"User-Agent": "stix-research"})
            p.write_bytes(urllib.request.urlopen(req, timeout=180).read())


def rd(p):
    return list(csv.DictReader(open(p, encoding="utf-8-sig")))


def fl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def implied(price):
    p = fl(price)
    if p is None or p == 0:
        return None
    return 100 / (p + 100) if p > 0 else -p / (-p + 100)


def balance(o, u):
    a, b = implied(o), implied(u)
    if a is None or b is None:
        return 1.0
    return abs(a / (a + b) - 0.5)


def main_line(outcomes_by_book):
    """outcomes_by_book: book -> {point: {'over': price, 'under': price}} -> (book, point, over, under) or None."""
    for book in BOOK_ORDER:
        pts = outcomes_by_book.get(book)
        if not pts:
            continue
        two = {p: v for p, v in pts.items() if "over" in v and "under" in v}
        pool = two or pts
        pt = sorted(pool, key=lambda p: (balance(pool[p].get("over"), pool[p].get("under")), p))[0]
        return book, pt, pool[pt].get("over"), pool[pt].get("under")
    return None


def team_spread(g, team):
    """Points the player's TEAM is favored by, negative = favored (-10 = favored by 10, +10 = getting 10).
    nflverse spread_line = points the HOME team is favored by."""
    s = fl(g.get("spread_line"))
    if s is None:
        return None, None
    return s, (-s if team == g["home_team"] else s)


def build(cache: Path, out: Path):
    games = {r["game_id"]: r for r in rd(cache / "games.csv") if r["season"] in ("2025", "2026") and r["game_type"] == "REG"}
    sched25 = {r["game_id"]: r for r in json.load(open(ROOT / "data/history_2025/schedule.json"))}
    wx26 = {r["game_id"]: r for r in rd(ROOT / "data/weather.csv")}
    rows = []
    stats = {s: rd(cache / f"stats_{s}.csv") for s in ("2025", "2026")}
    snaps = {s: rd(cache / f"snaps_{s}.csv") for s in ("2025", "2026")}
    roster25 = rd(cache / "roster_2025.csv")

    def team_games(season):
        tg = {}
        for gid, g in games.items():
            if g["season"] == season:
                for t in (g["home_team"], g["away_team"]):
                    tg[(int(g["week"]), t)] = g
        return tg

    def weather(g, gid):
        roof, temp, wind, src = g.get("roof", ""), fl(g.get("temp")), fl(g.get("wind")), "nflverse schedule (post-game record)"
        if gid.startswith("2026"):
            w = wx26.get(gid)
            if w:
                roof = {"dome": "dome", "open": "outdoors", "retractable": "retractable"}.get(w["roof"], roof) if not roof else roof
                if temp is None and fl(w.get("obs_temp_f")) is not None:
                    temp, wind, src = fl(w["obs_temp_f"]), fl(w.get("obs_wind_mph")), "Open-Meteo observed (weather.csv)"
        return roof, temp, wind, src

    # ---------- 2025: raw archive ----------
    tg25 = team_games("2025")
    idx = defaultdict(dict)       # (week, team) -> norm name -> set(pid)
    info = {}                     # pid -> (name, pos)
    amb = defaultdict(set)
    for r in stats["2025"]:
        if r["season_type"] != "REG" or r["position"] not in ("QB", "RB", "WR", "TE", "FB"):
            continue
        k = (int(r["week"]), r["team"])
        nm = norm_name(r["player_display_name"])
        idx[k].setdefault(nm, set()).add(r["player_id"])
        info[r["player_id"]] = (r["player_display_name"], "RB" if r["position"] == "FB" else r["position"])
    for r in roster25:
        if r.get("game_type", "REG") != "REG" or r["position"] not in ("QB", "RB", "WR", "TE", "FB"):
            continue
        pid = r.get("gsis_id") or ""
        if not pid:
            continue
        k = (int(r["week"]), r["team"])
        idx[k].setdefault(norm_name(r["full_name"]), set()).add(pid)
        info.setdefault(pid, (r["full_name"], "RB" if r["position"] == "FB" else r["position"]))
    st25 = {(int(r["week"]), r["player_id"]): r for r in stats["2025"] if r["season_type"] == "REG"}
    sn25 = {(int(r["week"]), r["pfr_player_id"] if "pfr_player_id" in r else r.get("player", "")): r for r in snaps["2025"]}
    snap_by_name = defaultdict(float)
    snap_games = set()
    for r in snaps["2025"]:
        if r.get("game_type", "REG") != "REG":
            continue
        snap_by_name[(int(r["week"]), r["team"], norm_name(r["player"]))] += fl(r.get("offense_snaps")) or 0
        snap_games.add((int(r["week"]), r["team"]))
    stat_teams = {(int(r["week"]), r["team"]) for r in stats["2025"] if r["season_type"] == "REG"}

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

    unmatched = defaultdict(int)
    for f in sorted(glob.glob(str(ROOT / "data/history_2025/odds/*.json"))):
        a = json.load(open(f))
        gid = a["game_id"]
        g = games.get(gid)
        if g is None:
            continue
        week = int(g["week"])
        snap_ts = a["response"].get("timestamp", "")
        per = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))   # (name, mid) -> book -> point -> side
        for b in a["response"]["data"].get("bookmakers", []):
            if b["key"] not in BOOK_ORDER:
                continue
            for m in b["markets"]:
                mid = KEY2MID.get(m["key"])
                if not mid:
                    continue
                for o in m["outcomes"]:
                    per[(o["description"], mid)][b["key"]].setdefault(str(o["point"]), {})[o["name"].lower()] = o["price"]
        sp, _ = team_spread(g, g["home_team"])
        for (name, mid), books in per.items():
            ml = main_line(books)
            if ml is None:
                continue
            book, pt, op, up = ml
            pid = match(name, week, (g["home_team"], g["away_team"]))
            if pid is None:
                unmatched[name] += 1
                continue
            row = st25.get((week, pid))
            team = row["team"] if row else None
            if team is None:
                cands = [t for t in (g["home_team"], g["away_team"]) if pid in idx.get((week, t), {}).get(norm_name(info[pid][0]), set())]
                team = cands[0] if len(cands) == 1 else None
            if team not in (g["home_team"], g["away_team"]):
                unmatched[name] += 1
                continue
            nm, pos = info[pid]
            if row:
                played, actual = True, fl(row.get(MARKETS[mid][1])) or 0.0
            else:
                snapped = snap_by_name.get((week, team, norm_name(nm)), 0)
                if snapped > 0:
                    played, actual = True, 0.0   # same convention as the app: snaps but no stat line => 0
                elif (week, team) in stat_teams and (week, team) in snap_games:
                    played, actual = False, None  # void
                else:
                    played, actual = None, None
            ln = fl(pt)
            res = "void" if played is False else "" if actual is None else ("over" if actual > ln else "under" if actual < ln else "push")
            _, ts = team_spread(sched25.get(gid, g), team)
            sp_home, _ = team_spread(sched25.get(gid, g), g["home_team"])
            roof, temp, wind, wsrc = weather(sched25.get(gid, g), gid)
            ko = sched25.get(gid, {}).get("kickoff_utc", "")
            rows.append(dict(season=2025, week=week, gid=gid, pid=pid, name=nm, pos=pos, team=team,
                             ha="home" if team == g["home_team"] else "away", market=mid, line=ln,
                             over_price=op, under_price=up, book=book, cap_utc=snap_ts, mins_before_ko="180",
                             actual=actual, result=res, played=played, kickoff_utc=ko, spread_home_fav=sp_home,
                             team_spread=ts, spread_src="nflverse schedule spread_line (post-hoc/closing-type; not capture-time)",
                             total_line=g.get("total_line"), roof=roof, temp_f=temp, wind_mph=wind, weather_src=wsrc))

    # ---------- 2026: the app's graded pregame rows ----------
    D = json.load(open(ROOT / "site/data/data.json"))
    pinfo = {p["id"]: p for p in D["players"]}
    for pid, prs in D["rows"].items():
        p = pinfo.get(pid)
        for r in prs:
            if not r.get("final"):
                continue
            g = games.get(r["gid"])
            if g is None:
                continue
            for mid, m in (r.get("m") or {}).items():
                if mid not in MARKETS or m.get("lstat") != "ok":
                    continue
                team = r["team"]
                sp_home, ts = team_spread(g, team)
                roof, temp, wind, wsrc = weather(g, r["gid"])
                res = m.get("res", "")
                rows.append(dict(season=2026, week=r["wk"], gid=r["gid"], pid=pid, name=p["name"], pos=p["pos"], team=team,
                                 ha=r["ha"], market=mid, line=m["line"], over_price=m.get("op"), under_price=m.get("up"),
                                 book=m.get("book"), cap_utc=m.get("cap"), mins_before_ko=m.get("mins"),
                                 actual=m.get("act"), result=res if res in ("over", "under", "push", "void") else "",
                                 played=r.get("played"), kickoff_utc=r["ko"], spread_home_fav=sp_home, team_spread=ts,
                                 spread_src="nflverse schedule spread_line read at build time (not capture-time)",
                                 total_line=g.get("total_line"), roof=roof, temp_f=temp, wind_mph=wind, weather_src=wsrc))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "props.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, FIELDS)
        w.writeheader()
        w.writerows(rows)
    json.dump({"unmatched_2025_names": dict(sorted(unmatched.items(), key=lambda x: -x[1]))}, open(out / "unmatched.json", "w"), indent=1)
    print(len(rows), "rows;", sum(unmatched.values()), "unmatched 2025 line rows")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/home/claude/stix_research/cache")
    ap.add_argument("--out", default="/home/claude/stix_research/out")
    a = ap.parse_args()
    fetch(Path(a.cache))
    build(Path(a.cache), Path(a.out))

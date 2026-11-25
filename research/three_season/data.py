"""Unified 2024-2026 research data (regular season only).

Props: 2024 = data/history_2024 archive (rush yds, rec yds); 2025 = data/history_2025 archive (pass yds, rush yds,
receptions, rec yds); 2026 = the app's graded pregame lines in site/data/data.json (same 4 markets).
Main line = DraftKings first, FanDuel fallback (graded.py / the app). Timelines, snaps, targets from nflverse; game script,
receiving detail and 1st-quarter QBs from nflverse play-by-play. Builds a pickle used by rules.py.
"""
from __future__ import annotations

import csv, gzip, io, json, pickle, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/nfl_cache")
PROPS = {2024: Path("/tmp/history_2024_out/props_2024.csv"), 2025: Path("/tmp/h25/props_2025.csv")}
DATAJSON = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/data_main.json")
OUT = Path("/tmp/three_season.pkl")
MKTS = ("pass_yds", "rush_yds", "rec", "rec_yds")
COL = {"pass_yds": "passing_yards", "rush_yds": "rushing_yards", "rec": "receptions", "rec_yds": "receiving_yards"}


def fl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def rd(p):
    return list(csv.DictReader(open(p, encoding="utf-8-sig")))


def main():
    games = {}
    for r in rd(CACHE / "games.csv"):
        if r["season"] in ("2024", "2025", "2026") and r["game_type"] == "REG" and r["home_score"] != "":
            games[r["game_id"]] = {
                "season": int(r["season"]), "wk": int(r["week"]), "home": r["home_team"], "away": r["away_team"],
                "hs": int(r["home_score"]), "as": int(r["away_score"]), "spread": fl(r["spread_line"]),
                "total": fl(r["total_line"]), "roof": r["roof"], "temp": fl(r["temp"]), "wind": fl(r["wind"]),
                "gameday": r["gameday"], "weekday": r["weekday"], "gametime": r["gametime"],
                "div": r["div_game"] == "1", "home_rest": fl(r["home_rest"]), "away_rest": fl(r["away_rest"])}
    # ---- props ----
    props = []
    for s, p in PROPS.items():
        for r in rd(p):
            if r["gid"] not in games:
                continue
            res = r["result"] if r["result"] in ("over", "under", "push") else "void"
            props.append({"season": s, "wk": int(r["week"]), "gid": r["gid"], "pid": r["pid"], "name": r["name"],
                          "pos": r["pos"], "team": r["team"], "ha": r["ha"], "mid": r["market"], "line": fl(r["line"]),
                          "op": fl(r["over_price"]), "up": fl(r["under_price"]), "book": r["book"],
                          "act": fl(r["actual"]), "res": res})
    D = json.load(open(DATAJSON))
    pinfo = {p["id"]: p for p in D["players"]}
    seen = set()
    for pid, rows in D["rows"].items():
        p = pinfo.get(pid)
        if not p or p["pos"] not in ("QB", "RB", "WR", "TE"):
            continue
        for r in rows:
            if not r.get("final") or r["gid"] not in games:
                continue
            for mid in MKTS:
                m = (r.get("m") or {}).get(mid)
                if not m or m.get("lstat") != "ok" or m.get("line") is None:
                    continue
                k = (pid, r["gid"], mid)
                if k in seen:
                    continue
                seen.add(k)
                if r.get("played") is True and m.get("act") is not None:
                    a, ln = m["act"], m["line"]
                    res = "over" if a > ln else "under" if a < ln else "push"
                else:
                    res = "void"
                props.append({"season": 2026, "wk": r["wk"], "gid": r["gid"], "pid": pid, "name": p["name"],
                              "pos": p["pos"], "team": r["team"], "ha": r["ha"], "mid": mid, "line": m["line"],
                              "op": m.get("op"), "up": m.get("up"), "book": (m.get("book") or "").lower(),
                              "act": m.get("act"), "res": res})
    # ---- timelines (nflverse) ----
    tl = defaultdict(dict)   # (season, pid) -> wk -> entry
    team_gid = {}
    for gid, g in games.items():
        team_gid[(g["season"], g["home"], g["wk"])] = gid
        team_gid[(g["season"], g["away"], g["wk"])] = gid
    pfr2g = {}
    snaps = {}  # (season, wk, pfr) -> pct (0-100)
    for s in (2023, 2024, 2025, 2026):
        for r in rd(CACHE / f"snaps_{s}.csv"):
            if r["game_type"] == "REG":
                snaps[(s, int(r["week"]), r["pfr_player_id"])] = (100 * (fl(r["offense_pct"]) or 0), fl(r["offense_snaps"]) or 0, r["team"], r["position"])
    for s in (2024, 2025, 2026):
        for r in rd(CACHE / f"roster_{s}.csv"):
            if r.get("game_type", "REG") != "REG" or not r.get("gsis_id"):
                continue
            pos = "RB" if r["position"] == "FB" else r["position"]
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            w = int(r["week"])
            gid = team_gid.get((s, r["team"], w))
            if not gid:
                continue
            if r.get("pfr_id"):
                pfr2g[r["pfr_id"]] = r["gsis_id"]
            sn = snaps.get((s, w, r.get("pfr_id") or ""))
            tl[(s, r["gsis_id"])][w] = {"wk": w, "gid": gid, "team": r["team"], "pos": pos, "status": r["status"],
                                        "snap": sn[0] if sn else None, "offsnaps": sn[1] if sn else 0,
                                        "tshare": None, "tgt": None, "st": False, "act": {}}
        for r in rd(CACHE / f"stats_{s}.csv"):
            if r["season_type"] != "REG":
                continue
            w = int(r["week"])
            gid = team_gid.get((s, r["team"], w))
            if not gid:
                continue
            pos = "RB" if r["position"] == "FB" else r["position"]
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            e = tl[(s, r["player_id"])].setdefault(w, {"wk": w, "gid": gid, "team": r["team"], "pos": pos, "status": "ACT",
                                                        "snap": None, "offsnaps": 0, "act": {}})
            e["st"] = True
            e["tshare"] = 100 * (fl(r["target_share"]) or 0) if r["target_share"] != "" else 0.0
            e["tgt"] = fl(r["targets"]) or 0
            for mid, c in COL.items():
                e["act"][mid] = fl(r[c]) or 0.0
    for (s, pid), weeks in tl.items():
        for w, e in weeks.items():
            e["played"] = e.get("st", False) or (e.get("offsnaps") or 0) > 0
            if e["played"]:
                for mid in MKTS:
                    e["act"].setdefault(mid, 0.0)
                if e.get("tshare") is None:
                    e["tshare"] = 0.0
    # 2023 snaps for week-1 slot history (by gsis via pfr map)
    snap23 = defaultdict(list)  # gsis -> [(wk, team, pct)]
    for (s, w, pfr), v in snaps.items():
        if s == 2023 and pfr in pfr2g and v[1] > 0:
            snap23[pfr2g[pfr]].append((w, v[2], v[0]))
    # ---- play-by-play ----
    s7, states, rdet, q1, tr13 = {}, {}, {}, {}, {}
    for s in (2024, 2025, 2026):
        rows = csv.DictReader(io.StringIO(gzip.decompress((CACHE / f"pbp_{s}.csv.gz").read_bytes()).decode("utf-8")))
        q1c = defaultdict(dict)
        for p in rows:
            if p.get("season_type") != "REG":
                continue
            gid, team = p["game_id"], p.get("posteam")
            isplay = (p.get("pass") == "1" or p.get("rush") == "1") and p.get("qb_kneel") != "1" and p.get("qb_spike") != "1"
            if team and isplay:
                sd = fl(p.get("score_differential")) or 0
                e = s7.setdefault((gid, team), [0, 0, 0, 0])
                e[0] += 1; e[1] += sd <= -7; e[2] += sd >= 7; e[3] += sd <= -13
                st = states.setdefault((gid, team), {"dn": [0, 0], "cl": [0, 0]})
                ps = 1 if p.get("pass") == "1" else 0
                if sd <= -13:
                    st["dn"][0] += 1; st["dn"][1] += ps
                elif abs(sd) <= 6:
                    st["cl"][0] += 1; st["cl"][1] += ps
            if team and p.get("play_type") != "no_play":
                for k in ("passer_player_id", "rusher_player_id"):
                    pid = p.get(k)
                    if pid:
                        d = q1c[(gid, team)]
                        if pid not in d:
                            d[pid] = [0, len(d)]
                        if p.get("qtr") == "1":
                            d[pid][0] += 1
            if fl(p.get("two_point_attempt")) == 1:
                continue
            qtr = fl(p.get("qtr"))
            plays = []
            pid, y = p.get("receiver_player_id"), fl(p.get("receiving_yards"))
            if pid and y is not None:
                plays.append((pid, y, True))
            lp, ly = p.get("lateral_receiver_player_id"), fl(p.get("lateral_receiving_yards"))
            if lp and ly is not None:
                plays.append((lp, ly, False))
            for q, yds, own in plays:
                e = rdet.setdefault((gid, q), {"tot": 0.0, "h1": 0.0, "q1": 0.0, "q4": 0.0, "lc": None, "rc": 0, "ry": 0.0})
                e["tot"] += yds
                if qtr is not None and qtr <= 2:
                    e["h1"] += yds
                if qtr == 1:
                    e["q1"] += yds
                if qtr is not None and qtr >= 4:
                    e["q4"] += yds
                e["lc"] = yds if e["lc"] is None else max(e["lc"], yds)
                if own and p.get("play_type") == "pass" and fl(p.get("sack")) != 1:
                    e["rc"] += 1; e["ry"] += yds
        for k, d in q1c.items():
            q1[k] = d
    # ---- 2022-2023 career seed (catches/yards before 2024), same catch rule as rdet ----
    seed = defaultdict(lambda: [0, 0.0])
    for s_ in (2022, 2023):
        sp = Path("/tmp/nflverse_2223") / f"pbp_{s_}.csv.gz"
        for p in csv.DictReader(io.StringIO(gzip.decompress(sp.read_bytes()).decode("utf-8"))):
            if p.get("season_type") != "REG" or fl(p.get("two_point_attempt")) == 1:
                continue
            pid, y = p.get("receiver_player_id"), fl(p.get("receiving_yards"))
            if pid and y is not None and p.get("play_type") == "pass" and fl(p.get("sack")) != 1:
                seed[pid][0] += 1; seed[pid][1] += y
    pickle.dump({"seed": dict(seed), "games": games, "props": props, "tl": dict(tl), "snap23": dict(snap23), "s7": s7, "states": states,
                 "rdet": rdet, "q1": q1}, open(OUT, "wb"))
    import collections
    print(len(games), "games;", len(props), "props", collections.Counter((p["season"], p["mid"]) for p in props))


if __name__ == "__main__":
    main()

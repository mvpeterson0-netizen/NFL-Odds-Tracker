"""Score the Signals-page and Indicators-page rules on the 2024 archive (rush yds + rec yds only).

Rules are re-implemented from site/research.js ruleHits / qbchTeams (2026-11-22 version). Every bet: 1 unit at the
saved price of the bet side (Under price), push = 0. Inputs: props_2024.csv from graded.py, nflverse 2024 stats,
snap counts, weekly rosters, play-by-play (cache dir), data/history_2024/schedule.json.
Run:  python -m research.history_2024.score [--cache DIR] [--props DIR]
"""
from __future__ import annotations

import argparse, csv, gzip, io, json, random
from collections import defaultdict
from pathlib import Path

from pipeline.common import norm_name

ROOT = Path(__file__).resolve().parents[2]
SEASON = "2024"
MKT_COL = {"rush_yds": "rushing_yards", "rec_yds": "receiving_yards"}


def fl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def payout(o):
    return o / 100 if o > 0 else 100 / abs(o)


def load(cache: Path, props_dir: Path):
    sched = json.load(open(ROOT / f"data/history_{SEASON}/schedule.json"))
    games = {g["game_id"]: g for g in sched}
    team_week = {}
    for g in sched:
        for t in (g["home_team"], g["away_team"]):
            team_week[(t, int(g["week"]))] = g
    props = {}
    for r in csv.DictReader(open(props_dir / f"props_{SEASON}.csv")):
        props[(r["pid"], int(r["week"]), r["market"])] = r
    stats = {}
    for r in csv.DictReader(open(cache / f"stats_{SEASON}.csv", encoding="utf-8-sig")):
        if r["season_type"] in ("REG", "POST"):
            stats[(int(r["week"]), r["player_id"])] = r
    roster = defaultdict(dict)   # week -> gsis -> row
    for r in csv.DictReader(open(cache / f"roster_{SEASON}.csv", encoding="utf-8-sig")):
        if r.get("gsis_id"):
            roster[int(r["week"])][r["gsis_id"]] = r
    snaps = {}
    for r in csv.DictReader(open(cache / f"snaps_{SEASON}.csv", encoding="utf-8-sig")):
        snaps[(int(r["week"]), r["pfr_player_id"])] = r
    snaps_name = defaultdict(float)
    for r in snaps.values():
        snaps_name[(int(r["week"]), r["team"], norm_name(r["player"]))] += fl(r["offense_snaps"]) or 0
    return games, team_week, props, stats, roster, snaps, snaps_name


def pbp_derived(cache: Path, qb_ids):
    rows = csv.DictReader(io.StringIO(gzip.decompress((cache / f"pbp_{SEASON}.csv.gz").read_bytes()).decode("utf-8")))
    s7 = defaultdict(lambda: [0, 0, 0])        # (gid, team) -> [plays, trailing 7+, leading 7+]   (pipeline/script.py _team)
    rd = defaultdict(dict)                      # gid -> pid -> {tot,h1,lc,rc,ry}                   (pipeline/rec_detail.py _games)
    q1 = defaultdict(dict)                      # (gid, team) -> pid -> [q1 plays, order]          (pipeline/script.py _q1)
    for p in rows:
        if p.get("season_type") not in ("REG", "POST"):
            continue
        gid, team = p["game_id"], p.get("posteam")
        is_play = (p.get("pass") == "1" or p.get("rush") == "1") and p.get("qb_kneel") != "1" and p.get("qb_spike") != "1"
        if team and is_play:
            sd = fl(p.get("score_differential")) or 0
            e = s7[(gid, team)]
            e[0] += 1; e[1] += sd <= -7; e[2] += sd >= 7
        if team and p.get("play_type") != "no_play":
            for k in ("passer_player_id", "rusher_player_id"):
                pid = p.get(k)
                if pid:
                    d = q1[(gid, team)]
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
            e = rd[gid].setdefault(q, {"tot": 0.0, "h1": 0.0, "lc": None, "rc": 0, "ry": 0.0})
            e["tot"] += yds
            if qtr is not None and qtr <= 2:
                e["h1"] += yds
            e["lc"] = yds if e["lc"] is None else max(e["lc"], yds)
            if own and p.get("play_type") == "pass" and fl(p.get("sack")) != 1:
                e["rc"] += 1; e["ry"] += yds
    q1qb = {}
    for k, d in q1.items():
        qbs = [(v[0], -v[1], pid) for pid, v in d.items() if pid in qb_ids]
        if qbs:
            q1qb[k] = max(qbs)[2]
    return s7, rd, q1qb


def main(cache: Path, props_dir: Path, out: Path):
    games, team_week, props, stats, roster, snaps, snaps_name = load(cache, props_dir)
    qb_ids = {g for w in roster.values() for g, r in w.items() if r["position"] == "QB"} | \
             {k[1] for k, r in stats.items() if r["position"] == "QB"}
    s7, rd, q1qb = pbp_derived(cache, qb_ids)
    gweek = {gid: int(g["week"]) for gid, g in games.items()}

    # Player timelines: every week the player is on a team's weekly roster and that team has a game.
    def pos_of(r):
        return "RB" if r["position"] == "FB" else r["position"]

    def played_and_snaps(week, pid, team):
        r = roster[week].get(pid, {})
        sn = snaps.get((week, r.get("pfr_id", ""))) if r.get("pfr_id") else None
        off = fl(sn["offense_snaps"]) if sn else None
        if off is None and r:
            off = snaps_name.get((week, team, norm_name(r["full_name"])))
        pct = fl(sn["offense_pct"]) if sn else None
        st = stats.get((week, pid))
        played = bool(st) or (off or 0) > 0
        return played, pct, st

    timeline = defaultdict(list)  # pid -> [entry]
    weeks = sorted(roster)
    for w in weeks:
        for pid, r in roster[w].items():
            if pos_of(r) not in ("QB", "RB", "WR", "TE"):
                continue
            g = team_week.get((r["team"], w))
            if not g:
                continue
            played, pct, st = played_and_snaps(w, pid, r["team"])
            act = {m: ((fl(st.get(c)) or 0.0) if st else 0.0) if played else None for m, c in MKT_COL.items()}
            timeline[pid].append({"wk": w, "team": r["team"], "gid": g["game_id"], "played": played, "pct": pct,
                                  "act": act, "pos": pos_of(r), "status": r.get("status", "")})
    for pid in timeline:
        timeline[pid].sort(key=lambda e: e["wk"])
    # props players missing from roster (rare): add their bet weeks from the props table
    for (pid, w, m), r in props.items():
        if not any(e["wk"] == w for e in timeline.get(pid, [])):
            g = games[r["gid"]]
            timeline[pid].append({"wk": w, "team": r["team"], "gid": r["gid"], "played": r["played"] == "True", "pct": None,
                                  "act": {mm: (fl(stats.get((w, pid), {}).get(c)) or 0.0) if r["played"] == "True" else None
                                          for mm, c in MKT_COL.items()}, "pos": r["pos"], "status": ""})
            timeline[pid].sort(key=lambda e: e["wk"])

    # Approximate slots (pre-game): avg offensive snap % over the last 3 games played for this team; RES excluded.
    SLOTN = {"RB": 2, "WR": 3, "TE": 2}
    by_tw = defaultdict(list)
    for pid, tl in timeline.items():
        for i, e in enumerate(tl):
            by_tw[(e["team"], e["wk"])].append((pid, e, tl[:i]))
    slotted = set()   # (pid, week)
    slot_basis_missing = set()
    for (team, w), lst in by_tw.items():
        for pos, n in SLOTN.items():
            cand = []
            for pid, e, past in lst:
                if e["pos"] != pos or e["status"] == "RES":
                    continue
                hist = [x["pct"] for x in past if x["played"] and x["team"] == team and x["pct"] is not None][-3:]
                if hist:
                    cand.append((sum(hist) / len(hist), pid))
            if not cand:
                slot_basis_missing.add((team, w))
            for _, pid in sorted(cand, reverse=True)[:n]:
                slotted.add((pid, w))
    def is_slotted(pid, w, pos, team):
        if pos == "QB":
            return True   # QB1 approximated as the QB the book posted a rushing line for (see notes)
        return (pid, w) in slotted or (team, w) in slot_basis_missing

    # hc/hy before each game: cumulative own catches / yards on catches since 2024 week 1 (REG+POST), from pbp
    gid_order = sorted(games, key=lambda g: (games[g]["kickoff_utc"], g))
    cum, hist_before = defaultdict(lambda: [0, 0.0]), {}
    for gid in gid_order:
        for pid, e in rd.get(gid, {}).items():
            hist_before[(gid, pid)] = tuple(cum[pid])
        for pid, e in rd.get(gid, {}).items():
            cum[pid][0] += e["rc"]; cum[pid][1] += e["ry"]

    def favby(gid, team):
        g = games[gid]; s = fl(g.get("spread_line"))
        return None if s is None else s * (1 if team == g["home_team"] else -1)

    bets = defaultdict(list)   # rule -> [(week, gid, pid, name, units, outcome, game_type)]

    def add(rule, r, slot_ok):
        if r["result"] not in ("over", "under", "push"):
            return
        up = fl(r["under_price"])
        if up is None or fl(r["over_price"]) is None:
            return
        o = "push" if r["result"] == "push" else ("hit" if r["result"] == "under" else "miss")
        u = payout(up) if o == "hit" else (-1.0 if o == "miss" else 0.0)
        rec = (int(r["week"]), r["gid"], r["pid"], r["name"], u, o, games[r["gid"]].get("game_type", "REG"))
        bets[rule + ":all"].append(rec)
        if slot_ok:
            bets[rule + ":slot"].append(rec)

    for (pid, w, mid), r in props.items():
        pos, team, line = r["pos"], r["team"], fl(r["line"])
        tl = timeline.get(pid, [])
        past = [e for e in tl if e["wk"] < w]
        played = [e for e in past if e["played"]]
        prev = past[-1] if past else None
        pm = props.get((pid, prev["wk"], mid)) if prev else None
        pl = fl(pm["line"]) if pm else None
        sl = is_slotted(pid, w, pos, team)
        if pos == "QB" and mid == "rush_yds":
            l3 = [e["act"][mid] for e in played if e["act"][mid] is not None][-3:]
            avg3 = len(l3) == 3 and sum(l3) / 3 >= 25
            if line >= 25: add("QBRu 25+ (QB-R4 25)", r, sl)
            if line >= 40: add("QB-R4 40+", r, sl)
            if line >= 25 and avg3: add("QBRu avg 25 (QB-R1)", r, sl)
            if pl is not None and line - pl >= 5: add("QBRu +5 (QB-R2 +5)", r, sl)
            if pl is not None and line - pl >= 7: add("QB-R2 +7", r, sl)
        raised = pm is not None and pm["result"] == "over" and pl is not None and line > pl
        if raised:
            v = s7.get((prev["gid"], prev["team"]))
            if v and v[0]:
                if pos in ("WR", "TE") and mid == "rec_yds" and v[1] / v[0] >= 0.5: add("SC1 (GS WR/TE)", r, sl)
                if pos == "RB" and mid == "rush_yds" and v[2] / v[0] >= 0.5: add("SC2 (GS RB)", r, sl)
        l3e = played[-3:]
        if pos == "WR" and len(l3e) == 3 and mid == "rec_yds":
            if all((q := props.get((pid, e["wk"], "rec_yds"))) and q["result"] == "over" for e in l3e): add("L9", r, True)
            a = [e["act"]["rec_yds"] for e in l3e]
            if all(x is not None for x in a) and a[0] < a[1] < a[2]: add("S03", r, True)
        fb = favby(r["gid"], team)
        if fb is not None:
            if fb <= -10 and pos in ("WR", "TE", "RB") and mid == "rec_yds": add("SP1", r, True)
            if -6.5 <= fb <= -3 and pos in ("QB", "RB") and mid == "rush_yds": add("SP5", r, True)
        if mid == "rec_yds" and pos in ("WR", "TE", "RB") and raised and prev["played"]:
            d = rd.get(prev["gid"], {}).get(pid)
            if d and d["tot"] >= 40:
                hc, hy = hist_before.get((prev["gid"], pid), (0, 0.0))
                up_ = line / pl - 1
                need_long = d["tot"] - d["lc"] < pl
                ypc = hy / hc if hc >= 20 else None
                short = ypc is not None and ypc < 10.6
                if short and up_ >= 0.25: add("SY +25% (SY-R25)", r, True)
                if short and not need_long: add("SY No Long (SY-NL)", r, True)
                if short and d["rc"] > 0 and d["tot"] / d["rc"] >= 1.5 * ypc: add("SY Fluke (SY-YPC)", r, True)
                if d["h1"] > pl and up_ >= 0.30: add("1H +30% (FH-R30)", r, True)
                if d["h1"] > pl and not need_long: add("1H No Long (FH-NL)", r, True)
                pact = fl(pm["actual"])
                if pact is not None and pact / pl - 1 >= 2: add("BL-200", r, True)
                if d["lc"] < 20: add("NL-U20", r, True)

    # QBCH: this game's QB = QB the book posted a line for. We have no 2024 passing lines, so: the QB with a posted
    # rushing-yards line (highest line if two); if none, this game's 1st-quarter QB from play-by-play (hindsight, counted).
    qb_line = defaultdict(list)
    for (pid, w, mid), r in props.items():
        if r["pos"] == "QB" and mid == "rush_yds":
            qb_line[(r["gid"], r["team"])].append((fl(r["line"]), pid))
    team_games = defaultdict(list)
    for gid, g in games.items():
        for t in (g["home_team"], g["away_team"]):
            team_games[t].append(gid)
    fallback = 0
    qbch_teams = 0
    for team, gl in team_games.items():
        gl.sort(key=lambda g: games[g]["kickoff_utc"])
        for i, gid in enumerate(gl):
            if i == 0:
                continue
            prev_qb = q1qb.get((gl[i - 1], team))
            if prev_qb is None:
                continue
            cur = max(qb_line[(gid, team)])[1] if qb_line.get((gid, team)) else None
            if cur is None:
                cur = q1qb.get((gid, team)); fallback += 1
            if cur is None or cur == prev_qb:
                continue
            qbch_teams += 1
            w = gweek[gid]
            for (pid, ww, mid), r in props.items():
                if ww == w and mid == "rec_yds" and r["gid"] == gid and r["team"] == team and r["pos"] in ("WR", "TE"):
                    add("QBCH", r, True)
    # Variant for comparison: this game's QB = its 1st-quarter QB from play-by-play (uses the game itself; hindsight)
    for team, gl in team_games.items():
        for i, gid in enumerate(gl):
            if i == 0:
                continue
            a, b = q1qb.get((gl[i - 1], team)), q1qb.get((gid, team))
            if a is None or b is None or a == b:
                continue
            w = gweek[gid]
            for (pid, ww, mid), r in props.items():
                if ww == w and mid == "rec_yds" and r["gid"] == gid and r["team"] == team and r["pos"] in ("WR", "TE"):
                    add("QBCH-pbpQB", r, True)

    # Summaries
    rng = random.Random(7)
    def summ(lst):
        n = len(lst); u = sum(b[4] for b in lst)
        w = sum(b[5] == "hit" for b in lst); l = sum(b[5] == "miss" for b in lst); p = n - w - l
        byw = defaultdict(lambda: [0.0, 0])
        for b in lst:
            byw[b[0]][0] += b[4]; byw[b[0]][1] += 1
        ks = list(byw)
        sims = []
        for _ in range(4000):
            pick = [byw[rng.choice(ks)] for _ in ks]
            nn = sum(x[1] for x in pick)
            if nn:
                sims.append(100 * sum(x[0] for x in pick) / nn)
        sims.sort()
        ci = (sims[int(0.025 * len(sims))], sims[int(0.975 * len(sims)) - 1]) if sims else (None, None)
        return {"bets": n, "w": w, "l": l, "p": p, "units": round(u, 2), "roi": round(100 * u / n, 1) if n else None,
                "lo": round(ci[0], 1) if ci[0] is not None else None, "hi": round(ci[1], 1) if ci[1] is not None else None}
    res = {}
    for k, lst in sorted(bets.items()):
        reg = [b for b in lst if b[6] == "REG"]; post = [b for b in lst if b[6] != "REG"]
        res[k] = {"reg": summ(reg), "post": summ(post) if post else None}
    # baseline: every graded Under in the same market/position groups (context)
    base = defaultdict(list)
    for (pid, w, mid), r in props.items():
        if r["result"] in ("over", "under", "push") and r["under_price"] and games[r["gid"]].get("game_type", "REG") == "REG":
            up = fl(r["under_price"]); o = "push" if r["result"] == "push" else ("hit" if r["result"] == "under" else "miss")
            base[f"{r['pos']} {mid}"].append((w, r["gid"], pid, r["name"], payout(up) if o == "hit" else (-1.0 if o == "miss" else 0.0), o, "REG"))
    res["_baseline_all_unders"] = {k: summ(v) for k, v in sorted(base.items())}
    res["_notes"] = {"qbch_team_games": qbch_teams, "qbch_qb_from_pbp_fallback": fallback,
                     "slot_basis_missing_team_weeks": len(slot_basis_missing)}
    out.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(out / f"score_{SEASON}.json", "w"), indent=1)
    with open(out / f"bets_{SEASON}.csv", "w", newline="") as fh:
        wr = csv.writer(fh); wr.writerow(["rule", "week", "gid", "pid", "name", "units", "outcome", "game_type"])
        for k, lst in sorted(bets.items()):
            for b in lst:
                wr.writerow([k, *b])
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/tmp/nflverse_2024")
    ap.add_argument("--props", default="/tmp/history_2024_out")
    ap.add_argument("--season", default="2024")
    a = ap.parse_args()
    SEASON = a.season
    r = main(Path(a.cache), Path(a.props), Path(a.props))
    for k, v in r.items():
        if not k.startswith("_"):
            print(k, v["reg"], "POST", v["post"])
    print(json.dumps(r["_notes"]))

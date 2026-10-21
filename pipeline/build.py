"""Grade props and build the site's data file (site/data/data.json).

Everything shown on the site comes from nflverse or a stored Odds API capture.
Missing values stay missing and carry a reason; nothing is estimated.
"""
from __future__ import annotations

import os
from collections import defaultdict
from statistics import mean, median

from .common import (COLLECTION_START_UTC, DATA, SITE, iso, norm_name, parse_iso, read_csv, to_float, utcnow,
                     write_json)
from .defense import DefenseRanks, as_fields
from .nflverse import Data, load_sources
from .odds import CAPTURES_PATH, PULL_LOG_PATH, WINDOW_CLOSE, WINDOW_OPEN
from .slots import update_slots

MARKETS = [
    # id, odds key, nflverse stat column, label, positions
    ("pass_yds", "player_pass_yds", "passing_yards", "Pass yds", ("QB",)),
    ("pass_att", "player_pass_attempts", "attempts", "Pass att", ("QB",)),
    ("pass_cmp", "player_pass_completions", "completions", "Completions", ("QB",)),
    ("rush_att", "player_rush_attempts", "carries", "Rush att", ("RB",)),
    ("rush_yds", "player_rush_yds", "rushing_yards", "Rush yds", ("QB", "RB")),
    ("rec", "player_receptions", "receptions", "Receptions", ("RB", "WR", "TE")),
    ("rec_yds", "player_reception_yds", "receiving_yards", "Rec yds", ("WR", "TE")),
]
BOOK_NAMES = {"draftkings": "DraftKings", "fanduel": "FanDuel"}
BOOK_ORDER = ["draftkings", "fanduel"]
NAME_INDEX_PATH = DATA / "name_index.json"
OUT_PATH = SITE / "data" / "data.json"


def implied(price):
    p = to_float(price)
    if p is None or p == 0:
        return None
    return 100.0 / (p + 100.0) if p > 0 else -p / (-p + 100.0)


def novig_over(op, up):
    a, b = implied(op), implied(up)
    if a is None or b is None or a + b == 0:
        return None
    return a / (a + b)


def build_name_index(d):
    idx = defaultdict(dict)
    amb = defaultdict(set)
    latest = {}
    for (w, g), r in d.roster.items():
        if g not in latest or w > latest[g][0]:
            latest[g] = (w, r)
    for g, (w, r) in latest.items():
        team = r.get("team", "")
        keys = {norm_name(r.get("full_name", ""))}
        if r.get("football_name") and r.get("last_name"):
            keys.add(norm_name(f"{r['football_name']} {r['last_name']}"))
        for k in keys:
            if not k:
                continue
            if k in idx[team] and idx[team][k] != g:
                amb[team].add(k)
            idx[team][k] = g
    for team, ks in amb.items():
        for k in ks:
            idx[team].pop(k, None)
    out = {t: v for t, v in idx.items()}
    write_json(NAME_INDEX_PATH, out, compact=True)
    return out


def choose_main(caps):
    """Pick the displayed line: preferred book first, then the line closest to even money."""
    by_book = defaultdict(list)
    for c in caps:
        by_book[c["book"]].append(c)
    order = [b for b in BOOK_ORDER if b in by_book] + [b for b in by_book if b not in BOOK_ORDER]
    main, alts = None, []
    for b in order:
        rows = by_book[b]
        two = [r for r in rows if r["over_price"] != "" and r["under_price"] != ""]
        pool = two or rows

        def balance(r):
            nv = novig_over(r["over_price"], r["under_price"])
            return abs(nv - 0.5) if nv is not None else 1.0

        best = sorted(pool, key=balance)[0]
        if main is None:
            main = best
        else:
            alts.append(best)
    return main, alts


def stat_value(row, col):
    v = to_float(row.get(col)) if row else None
    return v


def build(log):
    d = Data()
    slots = update_slots(d)
    name_index = build_name_index(d)
    dranks = DefenseRanks(d, MARKETS)
    now = utcnow()

    games = [g for g in d.games if g.get("kickoff_utc")]
    games_by_id = {g["game_id"]: g for g in games}
    team_games = defaultdict(list)
    for g in games:
        team_games[g["home_team"]].append(g)
        team_games[g["away_team"]].append(g)
    for t in team_games:
        team_games[t].sort(key=lambda g: g["kickoff_utc"])
    next_game = {}
    for t, gl in team_games.items():
        for g in gl:
            if parse_iso(g["kickoff_utc"]) > now:
                next_game[t] = g["game_id"]
                break

    # Captures and pull log
    caps_by = defaultdict(list)
    unmatched = []
    for c in read_csv(CAPTURES_PATH):
        if not c.get("gsis_id"):
            g = games_by_id.get(c["game_id"])
            if g:
                k = norm_name(c["player_book_name"])
                c["gsis_id"] = (name_index.get(g["home_team"], {}).get(k)
                                or name_index.get(g["away_team"], {}).get(k) or "")
        if not c["gsis_id"]:
            unmatched.append({"game_id": c["game_id"], "book": c["book"], "market": c["market"],
                              "name": c["player_book_name"]})
            continue
        caps_by[(c["game_id"], c["gsis_id"], c["market"])].append(c)
    pull_rows = read_csv(PULL_LOG_PATH)
    pulls_by_game = defaultdict(list)
    for p in pull_rows:
        pulls_by_game[p["game_id"]].append(p)

    # Tracked players
    players = {}
    slot_by = {}
    for s in slots:
        g = s["gsis_id"]
        w = int(s["week"])
        slot_by[(g, w)] = s
        info = players.setdefault(g, {"id": g, "name": s["player"], "slots": {}})
        info["slots"][str(w)] = s["slot"]
        if w >= info.get("_w", -1):
            info.update({"_w": w, "team": s["team"], "pos": s["slot"][:2]})

    rows_out = {}
    analysis_out = {}
    leads = []
    for pid, info in players.items():
        pos = info["pos"]
        mkts = [m for m in MARKETS if pos in m[4]]
        prow = []
        for wk in sorted({int(g["week"]) for g in games}):
            # Which team was the player on this week?
            team = None
            s = slot_by.get((pid, wk))
            if s:
                team = s["team"]
            week_games = [g for g in games if int(g["week"]) == wk]
            if team is None:
                for g in week_games:
                    st = d.stats.get((g["game_id"], pid))
                    sn = d.snaps.get((g["game_id"], pid))
                    if st:
                        team = st["team"]
                    elif sn:
                        team = sn["team"]
                    if team:
                        break
            if team is None:
                rr = d.roster.get((wk, pid))
                team = rr["team"] if rr else None
            if team is None and wk > max(d.roster_weeks or [0]):
                team = info["team"]
            if team is None:
                continue
            g = next((x for x in week_games if team in (x["home_team"], x["away_team"])), None)
            if g is None:
                continue
            gid = g["game_id"]
            ko = parse_iso(g["kickoff_utc"])
            started = ko <= now
            if not started and next_game.get(team) != gid:
                continue
            final = g.get("result", "") != ""
            ha = "home" if g["home_team"] == team else "away"
            opp = g["away_team"] if ha == "home" else g["home_team"]
            st = d.stats.get((gid, pid))
            sn = d.snaps.get((gid, pid))
            snap_pct = d.snap_pct(gid, pid)
            off_snaps = to_float(sn.get("offense_snaps")) if sn else None
            stats_avail = gid in d.stats_games
            snaps_avail = gid in d.snap_games
            if not final:
                played = None
            elif st or (off_snaps or 0) > 0:
                played = True
            elif stats_avail and snaps_avail:
                played = False
            else:
                played = None
            inj = d.injuries.get((wk, team, pid))
            rr = d.roster.get((wk, pid))
            inj_txt = ""
            if inj and inj.get("report_status"):
                injury = inj.get("report_primary_injury") or inj.get("practice_primary_injury") or ""
                inj_txt = f"{inj['report_status']} on week {wk} injury report" + (f" ({injury})" if injury else "")
            dnp_reason = ""
            if played is False:
                parts = []
                if rr and rr.get("status") == "INA":
                    parts.append("Inactive (nflverse weekly roster)")
                elif rr and rr.get("status") == "RES":
                    parts.append("On reserve list (nflverse weekly roster)")
                if inj_txt:
                    parts.append(inj_txt + " (official NFL injury report via nflverse)")
                dnp_reason = "Did not play: " + ("; ".join(parts) if parts else "reason unknown")

            r = {"wk": wk, "gid": gid, "opp": opp, "ha": ha, "ko": g["kickoff_utc"], "final": final,
                 "slot": s["slot"] if s else "", "team": team,
                 "snap": round(snap_pct, 1) if snap_pct is not None else None,
                 "snaps_avail": snaps_avail, "stats_avail": stats_avail,
                 "tgt": stat_value(st, "targets"),
                 "tshare": round(stat_value(st, "target_share"), 3) if stat_value(st, "target_share") is not None else None,
                 "car": stat_value(st, "carries"), "inj": inj_txt,
                 "played": played, "dnp": dnp_reason, "m": {}}
            if played is True and not st:
                r["tgt"], r["car"] = 0.0, 0.0
                r["note"] = f"Played {int(off_snaps or 0)} offensive snaps; no stat line recorded (counted as 0)"

            pulls = pulls_by_game.get(gid, [])
            ok_pull = next((p for p in pulls if p["status"] == "ok"), None)
            for mid, okey, col, _label, _pos in mkts:
                m = as_fields(dranks.asof(g["kickoff_utc"], opp, pos, col))
                if played is True:
                    m["act"] = stat_value(st, col) if st else 0.0
                    if m["act"] is None:
                        m["act"] = 0.0
                if ko < COLLECTION_START_UTC:
                    m["lstat"] = "not_collected"
                else:
                    caps = caps_by.get((gid, pid, okey), [])
                    if caps:
                        main, alts = choose_main(caps)
                        m.update({"lstat": "ok", "line": to_float(main["line"]),
                                  "op": to_float(main["over_price"]), "up": to_float(main["under_price"]),
                                  "book": BOOK_NAMES.get(main["book"], main["book"]),
                                  "cap": main["captured_utc"], "mins": main["minutes_before_kickoff"],
                                  "inwin": main["in_window"]})
                        if alts:
                            m["alt"] = [{"book": BOOK_NAMES.get(a["book"], a["book"]), "line": to_float(a["line"]),
                                         "op": to_float(a["over_price"]), "up": to_float(a["under_price"])}
                                        for a in alts]
                    elif not started:
                        m["lstat"] = "pending"
                        m["lnote"] = "Pre-game pull scheduled 2.5-3.5 h before kickoff"
                        m["pull_open"] = iso(ko - WINDOW_OPEN)
                        m["pull_close"] = iso(ko - WINDOW_CLOSE)
                    elif ok_pull is None:
                        last = pulls[-1] if pulls else None
                        m["lstat"] = "no_pregame"
                        m["lnote"] = ("No pre-game line: " +
                                      (f"{last['status']} ({last.get('note', '')})" if last else "no pull logged"))
                    elif okey not in ok_pull.get("markets", "").split():
                        m["lstat"] = "not_requested"
                        m["lnote"] = "Optional market not requested for this game (API quota guard)"
                    else:
                        m["lstat"] = "not_offered"
                        books = ok_pull.get("note", "").split(";")[0].replace("books: ", "")
                        m["lnote"] = (f"Prop not offered by DraftKings/FanDuel in pull at {ok_pull['attempted_utc']}"
                                      + (f" (books returning props: {books})" if books else ""))
                        if inj_txt:
                            m["lnote"] += f"; {inj_txt}"
                if m.get("lstat") == "ok":
                    if played is True and m.get("act") is not None and m.get("line") is not None:
                        a, ln = m["act"], m["line"]
                        m["res"] = "over" if a > ln else "under" if a < ln else "push"
                    elif played is False:
                        m["res"] = "void"
                        m["rnote"] = dnp_reason
                    else:
                        m["res"] = "pending"
                r["m"][mid] = m
            prow.append(r)

        # Rolling stats (prior games only) and per-market summaries
        an = {}
        for mid, *_ in mkts:
            hist = []
            graded = {"over": 0, "under": 0, "push": 0}
            imp = []
            moves = []
            prev_line_row = None
            for r in prow:
                m = r["m"].get(mid)
                if m is None:
                    continue
                for n in (3, 5):
                    last = hist[-n:]
                    m[f"n{n}"] = len(last)
                    m[f"mean{n}"] = round(mean(last), 2) if last else None
                    m[f"med{n}"] = round(median(last), 2) if last else None
                if m.get("res") in graded:
                    graded[m["res"]] += 1
                    nv = novig_over(m.get("op"), m.get("up"))
                    if nv is not None:
                        imp.append(nv)
                if m.get("line") is not None:
                    if prev_line_row is not None:
                        pm = prev_line_row["m"][mid]
                        moves.append({"from_wk": prev_line_row["wk"], "to_wk": r["wk"], "line_prev": pm["line"],
                                      "line": m["line"], "dline": round(m["line"] - pm["line"], 2),
                                      "act_prev": pm.get("act"),
                                      "resid_prev": (round(pm["act"] - pm["line"], 2)
                                                     if pm.get("act") is not None else None)})
                    prev_line_row = r
                if m.get("act") is not None and r["played"] is True:
                    hist.append(m["act"])
                # Leads: upcoming lines vs recent production
                if (not r["final"] and m.get("line") is not None and parse_iso(r["ko"]) > now
                        and m.get("n5", 0) >= 3):
                    gap = m["line"] - m["mean5"]
                    leads.append({"pid": pid, "mid": mid, "wk": r["wk"], "gid": r["gid"], "line": m["line"],
                                  "book": m.get("book"), "cap": m.get("cap"),
                                  "mean3": m["mean3"], "n3": m["n3"], "mean5": m["mean5"], "n5": m["n5"],
                                  "med5": m["med5"], "gap5": round(gap, 2),
                                  "pct5": round(100 * gap / m["line"], 1) if m["line"] else None})
            n_dec = graded["over"] + graded["under"]
            an[mid] = {"over": graded["over"], "under": graded["under"], "push": graded["push"],
                       "n_graded": n_dec + graded["push"],
                       "over_rate": round(graded["over"] / n_dec, 3) if n_dec else None,
                       "implied_over": round(mean(imp), 3) if imp else None, "n_implied": len(imp),
                       "moves": moves, "n_games": len(hist)}
        rows_out[pid] = prow
        analysis_out[pid] = an

    leads.sort(key=lambda x: -abs(x["pct5"] or 0))

    for p in players.values():
        p.pop("_w", None)

    weeks_with_games = sorted({int(g["week"]) for g in games})
    cur = None
    for g in games:
        if g.get("result", "") == "":
            cur = int(g["week"])
            break
    sources = load_sources()
    caps_all = read_csv(CAPTURES_PATH)
    last_ok = [p for p in pull_rows if p["status"] == "ok"]
    credits = next((p["credits_remaining"] for p in reversed(pull_rows) if p.get("credits_remaining")), "")
    runs = []
    for f in sorted((DATA / "runs").glob("*.csv"))[-2:]:
        runs.extend(read_csv(f))
    slots_out = [{"wk": int(s["week"]), "team": s["team"], "slot": s["slot"], "pid": s["gsis_id"],
                  "name": s["player"], "basis": s["basis"], "change": s.get("change_note", ""),
                  "snapshot": s["depth_snapshot"], "frozen": s.get("frozen") == "1"} for s in slots]

    out = {
        "generated_utc": iso(now),
        "repo": os.environ.get("GITHUB_REPOSITORY", ""),
        "season": 2026,
        "collection_start_utc": iso(COLLECTION_START_UTC),
        "current_week": cur,
        "weeks": weeks_with_games,
        "markets": [{"id": m[0], "key": m[1], "stat": m[2], "label": m[3], "pos": list(m[4])} for m in MARKETS],
        "players": sorted(players.values(), key=lambda p: (p["team"], p["pos"], p["name"])),
        "rows": rows_out,
        "analysis": analysis_out,
        "slots": slots_out,
        "leads": leads[:40],
        "games": {g["game_id"]: {"wk": int(g["week"]), "home": g["home_team"], "away": g["away_team"],
                                 "ko": g["kickoff_utc"], "final": g.get("result", "") != "",
                                 "type": g.get("game_type", ""), "loc": g.get("location", "")} for g in games},
        "defrank": {pos: {mid: {t: list(v) for t, v in cur.get((pos, col), {}).items()}
                          for mid, _ok, col, _l, poss in MARKETS if pos in poss}
                    for pos in ("QB", "RB", "WR", "TE") for cur in [dranks.current()]},
        "sources": sources,
        "odds": {"captures": len(caps_all), "games_captured": len({p["game_id"] for p in last_ok}),
                 "last_capture_utc": max((p["attempted_utc"] for p in last_ok), default=""),
                 "credits_remaining": credits},
        "pull_log": pull_rows[-300:],
        "unmatched": unmatched[-100:],
        "runs": runs[-150:],
    }
    write_json(OUT_PATH, out, compact=True)
    log.append(f"build: {len(players)} players, {len(slots)} slot rows, {len(leads)} leads, "
               f"{len(unmatched)} unmatched lines, {d.unmapped_snaps} unmapped snap rows")
    return out

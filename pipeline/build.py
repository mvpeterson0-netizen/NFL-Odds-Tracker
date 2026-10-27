"""Grade props and build the site's data file (site/data/data.json).

Everything shown on the site comes from nflverse or a stored Odds API capture.
Missing values stay missing and carry a reason; nothing is estimated.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import timedelta
from statistics import mean, median

from .common import (COLLECTION_START_UTC, DATA, SITE, iso, norm_name, parse_iso, read_csv, read_json, to_float,
                     utcnow, write_json)
from .defense import DefenseRanks, as_fields
from .weather import load as load_weather
from .nflverse import Data, load_sources
from .odds import CAPTURES_PATH, LINKS_PATH, PULL_LOG_PATH, SNAPSHOTS, WINDOW_CLOSE, WINDOW_OPEN, ptype
from .slots import update_slots
from . import espn_box

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


def _int_or_none(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


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


def bet_links(name_index, games_by_id, now):
    """Bet-slip links for games that haven't kicked off: {player: {market id: {book: {o, u, point, cap, gid}}}}.
    One point per player/market/book (the one with both sides and prices closest to even money).
    Links come from the latest pull of each game (data/prop_links.csv); a missing link means none was returned."""
    okey_to_mid = {m[1]: m[0] for m in MARKETS}
    grouped = defaultdict(lambda: defaultdict(dict))  # (pid, mid, book) -> point -> side -> row
    for r in read_csv(LINKS_PATH):
        g = games_by_id.get(r.get("game_id"))
        ko = parse_iso(r.get("kickoff_utc", ""))
        mid = okey_to_mid.get(r.get("market"))
        if not g or not ko or ko <= now or not mid or not r.get("outcome_link") or r.get("side") not in ("over", "under"):
            continue
        pid = r.get("gsis_id")
        if not pid:
            k = norm_name(r.get("player_book_name", ""))
            pid = name_index.get(g["home_team"], {}).get(k) or name_index.get(g["away_team"], {}).get(k) or ""
        if not pid:
            continue
        grouped[(pid, mid, r["book"])][r.get("point", "")][r["side"]] = r
    out = defaultdict(lambda: defaultdict(dict))
    for (pid, mid, book), points in grouped.items():
        both = {pt: v for pt, v in points.items() if "over" in v and "under" in v}
        pool = both or points

        def balance(item):
            v = item[1]
            nv = novig_over(v.get("over", {}).get("price", ""), v.get("under", {}).get("price", ""))
            return abs(nv - 0.5) if nv is not None else 1.0

        pt, sides = sorted(pool.items(), key=balance)[0]
        any_row = sides.get("over") or sides.get("under")
        entry = {"point": to_float(pt), "cap": any_row["captured_utc"], "gid": any_row["game_id"]}
        for side, key in (("over", "o"), ("under", "u")):
            if side in sides:
                entry[key] = {"url": sides[side]["outcome_link"], "price": to_float(sides[side].get("price"))}
        out[pid][mid][book] = entry
    return out


UPDATES_SEEN_PATH = DATA / "updates_seen.json"
ESPN_PATH = DATA / "espn_news.json"
ESPN_NEWS_DAYS = 7   # headlines older than this are left out
ESPN_NEWS_MAX = 3    # at most this many headlines per player
ROLE_SNAP_PTS = 25    # role change: last game's snap share differs from his prior average by this many points
ROLE_TSHARE_PTS = 12   # ... or target share (WR/TE/RB) by this many points; needs 3+ prior games


def player_updates(d, slots, players, rows_out, cur, now, log):
    """Per-player updates for the current week (and the last game): official injury report and practice status,
    roster reserve/inactive status, slot / depth chart changes, and role changes seen in snap or target share.
    Each item gets the time Stix first saw it (data/updates_seen.json). Items present when tracking started have
    no time, so they never light the "new" icon."""
    if cur is None:
        return {}
    seen = read_json(UPDATES_SEEN_PATH, None)
    first_run = seen is None
    seen = seen or {}
    espn_first = not any("|espn|" in k for k in seen)
    items = defaultdict(list)

    def add(pid, key, kind, text, src, at="", url=""):
        k = f"{pid}|{key}"
        if k not in seen:
            # first run, or first run with ESPN items: existing items are not marked new
            seen[k] = "" if first_run or (espn_first and key.startswith("espn|")) else iso(now)
        it = {"k": key, "kind": kind, "text": text, "src": src, "t": seen[k]}
        if at:
            it["at"] = at  # when the source itself dated this item (ESPN)
        if url:
            it["url"] = url
        items[pid].append(it)

    espn = read_json(ESPN_PATH, None) or {}
    espn_status, espn_news = espn.get("status") or {}, espn.get("news") or {}
    news_cutoff = iso(now - timedelta(days=ESPN_NEWS_DAYS))

    for pid, p in players.items():
        rows = rows_out.get(pid) or []
        cur_row = next((r for r in rows if r["wk"] == cur), None)
        team = cur_row["team"] if cur_row else p.get("team")
        inj = d.injuries.get((cur, team, pid))
        if inj:
            if inj.get("practice_status"):
                pi = inj.get("practice_primary_injury") or ""
                add(pid, f"w{cur}|practice|{inj['practice_status']}|{pi}", "Practice",
                    f"Week {cur}: {inj['practice_status']}" + (f" ({pi})" if pi else ""), "Official NFL injury report via nflverse")
            if inj.get("report_status"):
                ri = inj.get("report_primary_injury") or ""
                add(pid, f"w{cur}|status|{inj['report_status']}|{ri}", "Injury",
                    f"Week {cur} game status: {inj['report_status']}" + (f" ({ri})" if ri else ""), "Official NFL injury report via nflverse")
        rr = d.roster.get((cur, pid))
        if rr and rr.get("status") in ("RES", "INA"):
            label = {"RES": "On a reserve list (IR/PUP/etc.)", "INA": "Inactive"}[rr["status"]]
            add(pid, f"w{cur}|roster|{rr['status']}", "Roster", f"Week {cur}: {label}", "nflverse weekly roster")
        sl = next((s_ for s_ in slots if s_["gsis_id"] == pid and int(s_["week"]) == cur), None)
        if sl and sl.get("change_note"):
            add(pid, f"w{cur}|slot|{sl['slot']}", "Slot", f"Week {cur} slot {sl['slot']}: {sl['change_note']}",
                "Stix slots (ESPN depth chart via nflverse + snap share + injury report)")
        rr_any = d.roster_row(cur, pid) or {}
        eid = str(rr_any.get("espn_id") or "").split(".")[0]
        if eid:
            st = espn_status.get(eid)
            if st and (st.get("note") or st.get("status")):
                text = (f"{st['status']}: " if st.get("status") else "") + (st.get("note") or "")
                add(pid, f"espn|status|{st.get('date')}|{st.get('status')}", "ESPN", text, "ESPN player note",
                    at=st.get("date") or "", url=st.get("url") or "")
            arts = sorted((a for a in espn_news.get(eid) or [] if (a.get("date") or "") >= news_cutoff),
                          key=lambda a: a.get("date") or "", reverse=True)[:ESPN_NEWS_MAX]
            for a in arts:
                add(pid, f"espn|news|{a['url']}", "ESPN news", a["headline"], "ESPN headline",
                    at=a.get("date") or "", url=a["url"])
        played = [r for r in rows if r.get("final") and r.get("played") is True]
        finals = [r for r in rows if r.get("final")]
        # role changes only from his team's most recent game (not an older game before an absence)
        if len(played) >= 4 and finals and played[-1] is finals[-1]:
            last, prior = played[-1], played[:-1]
            sn = [r["snap"] for r in prior if r.get("snap") is not None]
            if last.get("snap") is not None and len(sn) >= 3:
                avg = sum(sn) / len(sn)
                if abs(last["snap"] - avg) >= ROLE_SNAP_PTS:
                    add(pid, f"w{last['wk']}|snap", "Role",
                        f"Week {last['wk']} snap share {round(last['snap'])}% (prior average {round(avg)}%)",
                        "nflverse snap counts")
            ts = [r["tshare"] for r in prior if r.get("tshare") is not None]
            if p.get("pos") in ("WR", "TE", "RB") and last.get("tshare") is not None and len(ts) >= 3:
                avg = sum(ts) / len(ts)
                if abs(last["tshare"] - avg) * 100 >= ROLE_TSHARE_PTS:
                    from_espn = last["gid"] in getattr(d, "espn_games", set())
                    add(pid, f"w{last['wk']}|tshare", "Role",
                        f"Week {last['wk']} target share {round(last['tshare'] * 100)}% (prior average {round(avg * 100)}%)",
                        "ESPN box score" if from_espn else "nflverse player stats",
                        at=(d.stats.get((last["gid"], pid)) or {}).get("_fetched", "") if from_espn else "")
    # keep the seen-times only for items still current, so the file stays small
    live = {f"{pid}|{it['k']}" for pid, its in items.items() for it in its}
    write_json(UPDATES_SEEN_PATH, {k: v for k, v in seen.items() if k in live})
    out = {}
    for pid, its in items.items():
        # ESPN items first (newest first, by ESPN's own date), then the rest as before (newest first seen)
        its.sort(key=lambda x: x["t"] or "", reverse=True)
        its.sort(key=lambda x: x.get("at") or "", reverse=True)
        out[pid] = [{k: v for k, v in it.items() if k != "k"} for it in its]
    log.append(f"build: player updates for {len(out)} players" + (" (first run: existing items not marked new)" if first_run else ""))
    return out


def stat_value(row, col):
    v = to_float(row.get(col)) if row else None
    return v


def build(log):
    d = Data()
    try:  # ESPN box scores fill in finished games nflverse hasn't published; never stops a build
        d.espn_games = espn_box.merge_into(d, log)
    except Exception as ex:
        d.espn_games = set()
        log.append(f"espn box: not used ({type(ex).__name__}: {str(ex)[:80]})")
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
    snaps_by = defaultdict(list)  # (game, player, market, pull_type) -> captures (line-movement snapshots)
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
        if ptype(c) == "pregame":
            caps_by[(c["game_id"], c["gsis_id"], c["market"])].append(c)
        else:
            snaps_by[(c["game_id"], c["gsis_id"], c["market"], ptype(c))].append(c)
    pull_rows = read_csv(PULL_LOG_PATH)
    pulls_by_game = defaultdict(list)
    for p in pull_rows:
        if ptype(p) == "pregame":
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

    # Extra players, shown in the app only when its "All players" switch is on: QB/RB/WR/TE who had a
    # DraftKings/FanDuel line captured this season (pre-game or snapshot) but were never in a slot.
    # Display only: slots.csv and the odds pull triggers (fill-ins, sweeps) are not touched, so this adds no API calls.
    captured_ids = {k[1] for k in caps_by} | {k[1] for k in snaps_by}
    n_extra = 0
    for g in sorted(captured_ids - set(players)):
        pi = d.player_info.get(g) or {}
        pos = (pi.get("position") or "").upper()
        if pos not in ("QB", "RB", "WR", "TE") or not pi.get("team"):
            continue
        players[g] = {"id": g, "name": pi.get("name") or g, "slots": {}, "_w": -1,
                      "team": pi["team"], "pos": pos, "extra": True}
        n_extra += 1

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
                        # The graded line is each book's FIRST pre-game capture (the ~3 h pull). Later
                        # pre-kickoff sweeps only fill in players/markets that had no line yet.
                        first = {}
                        for c in caps:
                            if c["book"] not in first or c["captured_utc"] < first[c["book"]]:
                                first[c["book"]] = c["captured_utc"]
                        caps = [c for c in caps if c["captured_utc"] == first[c["book"]]]
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
                snaps = []
                for t, (label, *_r) in SNAPSHOTS.items():
                    sc = snaps_by.get((gid, pid, okey, t))
                    if sc:
                        # a snapshot type can be pulled more than once (Monday fill-ins): use each book's latest
                        latest = {}
                        for c in sc:
                            if c["captured_utc"] > latest.get(c["book"], ""):
                                latest[c["book"]] = c["captured_utc"]
                        sc = [c for c in sc if c["captured_utc"] == latest[c["book"]]]
                        sm, _alts = choose_main(sc)
                        snaps.append({"t": t, "label": label, "line": to_float(sm["line"]),
                                      "op": to_float(sm["over_price"]), "up": to_float(sm["under_price"]),
                                      "book": BOOK_NAMES.get(sm["book"], sm["book"]), "cap": sm["captured_utc"]})
                if snaps:
                    m["snaps"] = snaps
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

    # Headshot URL from nflverse (latest weekly roster row, else latest stats row). Images load from NFL's CDN.
    shots = {}
    for (gid, g), st in d.stats.items():
        if st.get("headshot_url"):
            shots[g] = (-1, st["headshot_url"])
    for (w, g), rr in d.roster.items():
        if rr.get("headshot_url") and (g not in shots or w > shots[g][0]):
            shots[g] = (w, rr["headshot_url"])

    def headshot(pid):
        url = shots.get(pid, (0, ""))[1]
        return url if url.startswith("https://") else ""

    for p in players.values():
        p.pop("_w", None)
        img = headshot(p["id"])
        if img:
            p["img"] = img

    weeks_with_games = sorted({int(g["week"]) for g in games})
    cur = None
    for g in games:
        if g.get("result", "") == "":
            cur = int(g["week"])
            break
    sources = load_sources()
    if getattr(d, "espn_games", None):
        sources = dict(sources)
        sources["espn_box"] = {"label": "ESPN box scores (finished games until nflverse stats arrive)",
                               "last_updated": "not published by ESPN",
                               "fetched_utc": espn_box.updated_utc() or "",
                               "url": "https://www.espn.com/nfl/scoreboard"}
    gs = read_json(DATA / "game_script.json", {}) or {}
    gs_games = gs.get("games") or {}
    if gs_games:
        sources = dict(sources)
        sources["script"] = {"label": "nflverse play-by-play (game script: time leading / trailing by 10+ and 13+)",
                             "last_updated": gs.get("source_updated", "unknown"), "fetched_utc": gs.get("fetched_utc", ""),
                             "url": gs.get("url", "https://github.com/nflverse/nflverse-data/releases/tag/pbp")}

    def scr_out(gid):
        x = gs_games.get(gid)
        if not x:
            return None
        h = x["h"]
        # minutes the home ("h") and away ("a") team led ("l") or trailed ("t") by 10+ / 13+
        return {"h": h, "a": {"l10": h["t10"], "t10": h["l10"], "l13": h["t13"], "t13": h["l13"]}, "min": x.get("min")}
    wx = load_weather()

    def wx_out(gid):
        w = wx.get(gid)
        if not w:
            return None
        keys = ["roof", "note", "fc_fetched_utc", "fc_temp_f", "fc_wind_mph", "fc_gust_mph", "fc_precip_in",
                "fc_precip_prob", "obs_temp_f", "obs_wind_mph", "obs_gust_mph", "obs_precip_in"]
        return {k: w.get(k, "") for k in keys if w.get(k, "") != ""}

    caps_all = read_csv(CAPTURES_PATH)

    # This week's pulls with the lines each one returned (Log tab). Lines are grouped by the exact
    # capture time, which equals the pull's logged time.
    wk_games = {g["game_id"] for g in games if cur is not None and int(g["week"]) == cur}
    wk_pulls = [p for p in pull_rows if p["game_id"] in wk_games]
    tracked = defaultdict(dict)  # game -> {gsis: [name, slot]}
    for s_ in slots:
        if cur is not None and int(s_["week"]) == cur:
            for g in games:
                if int(g["week"]) == cur and s_["team"] in (g["home_team"], g["away_team"]):
                    tracked[g["game_id"]][s_["gsis_id"]] = [s_["player"], s_["slot"]]
    pull_lines = defaultdict(list)
    for c in caps_all:
        if c["game_id"] in wk_games:
            key = f'{c["game_id"]}|{ptype(c)}|{c["captured_utc"]}'
            gs = c.get("gsis_id") or ""
            if not gs:
                g = games_by_id.get(c["game_id"])
                k = norm_name(c["player_book_name"])
                gs = (name_index.get(g["home_team"], {}).get(k) or name_index.get(g["away_team"], {}).get(k) or "") if g else ""
            pull_lines[key].append([c["player_book_name"], gs, c["market"], BOOK_NAMES.get(c["book"], c["book"]),
                                    to_float(c["line"]), to_float(c["over_price"]), to_float(c["under_price"])])
    last_ok = [p for p in pull_rows if p["status"] == "ok" and ptype(p) == "pregame"]
    credits = next((p["credits_remaining"] for p in reversed(pull_rows) if p.get("credits_remaining")), "")
    runs = []
    for f in sorted((DATA / "runs").glob("*.csv"))[-2:]:
        runs.extend(read_csv(f))
    slots_out = [{"wk": int(s["week"]), "team": s["team"], "slot": s["slot"], "pid": s["gsis_id"],
                  "name": s["player"], "basis": s["basis"], "change": s.get("change_note", ""),
                  "snapshot": s["depth_snapshot"], "frozen": s.get("frozen") == "1"} for s in slots]

    try:  # player updates are optional: a problem here must never stop the build
        updates_out = player_updates(d, slots, players, rows_out, cur, now, log)
    except Exception as ex:
        updates_out = {}
        log.append(f"build: player updates skipped ({type(ex).__name__}: {str(ex)[:80]})")
    try:  # bet-slip links are optional: a problem here must never stop the build
        links_out = bet_links(name_index, games_by_id, now)
    except Exception as ex:
        links_out = {}
        log.append(f"build: bet-slip links skipped ({type(ex).__name__}: {str(ex)[:80]})")
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
        # Top 40 for slotted players, plus up to 40 for extra players (shown only with "All players" on),
        # so extras never push a slotted player's lead off the list.
        "leads": sorted([l for l in leads if not players[l["pid"]].get("extra")][:40]
                        + [l for l in leads if players[l["pid"]].get("extra")][:40],
                        key=lambda x: -abs(x["pct5"] or 0)),
        "games": {g["game_id"]: {"wk": int(g["week"]), "home": g["home_team"], "away": g["away_team"],
                                 "ko": g["kickoff_utc"], "final": g.get("result", "") != "",
                                 "type": g.get("game_type", ""), "loc": g.get("location", ""),
                                 "stadium": g.get("stadium", ""), "wx": wx_out(g["game_id"]),
                                 # final score (nflverse schedule), only once the game is final; used for game-script research tabs
                                 "as": _int_or_none(g.get("away_score")) if g.get("result", "") != "" else None,
                                 "hs": _int_or_none(g.get("home_score")) if g.get("result", "") != "" else None,
                                 "scr": scr_out(g["game_id"])} for g in games},
        "defrank": {pos: {mid: {t: list(v) for t, v in cur.get((pos, col), {}).items()}
                          for mid, _ok, col, _l, poss in MARKETS if pos in poss}
                    for pos in ("QB", "RB", "WR", "TE") for cur in [dranks.current()]},
        "sources": sources,
        "odds": {"captures": sum(1 for c in caps_all if ptype(c) == "pregame"),
                 "snapshot_captures": sum(1 for c in caps_all if ptype(c) != "pregame"),
                 "games_captured": len({p["game_id"] for p in last_ok}),
                 "last_capture_utc": max((p["attempted_utc"] for p in last_ok), default=""),
                 "credits_remaining": credits},
        "pull_log": pull_rows[-300:],
        "week_pulls": {"week": cur, "pulls": wk_pulls, "lines": pull_lines,
                       "tracked": {g: [[pid, v[0], v[1]] for pid, v in t.items()] for g, t in tracked.items()}},
        "unmatched": unmatched[-100:],
        "runs": runs[-150:],
        "links": links_out,
        "updates": updates_out,
    }
    write_json(OUT_PATH, out, compact=True)
    log.append(f"build: {len(players)} players ({n_extra} extra, with lines but not slotted), {len(slots)} slot rows, {len(leads)} leads, "
               f"{len(unmatched)} unmatched lines, {d.unmapped_snaps} unmapped snap rows")
    return out

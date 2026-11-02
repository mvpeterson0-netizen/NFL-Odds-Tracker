"""College football (Power 4) player-prop lines from The Odds API, stored in Supabase (see cfb_store.py).

Michael's rules (2026-11-01):
  * Only passing, rushing and receiving yards (3 markets). DraftKings + FanDuel + the 8 extra books NFL uses.
  * Starting about 3.75 days before kickoff (around Wednesday for Saturday games) check every run until lines post.
    A check that comes back with no props costs 0 credits (same as NFL), so it is repeated every run.
  * Pull once when lines first post ("first"), then not again until about 1 hour before kickoff ("pregame").
    The pregame pull is the graded line.
Credits: one event-odds request costs 1 credit per market that returns data (3 at most, for one group of up to 10 books).
Stops for the run on a bad key, rate limit or low balance. Never touches the NFL logic.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta

from .common import http_get, iso, norm_name, parse_iso
from .cfb_store import Store
from .odds import API, BOOKS, EXTRA_BOOKS

SPORT = "americanfootball_ncaaf"
MARKETS = ["player_pass_yds", "player_rush_yds", "player_reception_yds"]
CHECK_HORIZON = timedelta(days=3, hours=18)
PREGAME_MIN, PREGAME_MAX = 45, 75            # minutes before kickoff in which the graded pull is made
CREDIT_FLOOR = 3000                          # never spend below this on any key (the monthly allowance is 20,000)
MATCH_TOLERANCE = timedelta(hours=6)


class Stop(Exception):
    pass


def _get(url, params):
    return http_get(url, params, timeout=60)


def match_event(game: dict, events: list[dict]) -> dict | None:
    ko = parse_iso(game["kickoff"])
    want = {norm_name(game["home_team"]), norm_name(game["away_team"])}
    for e in events:
        ct = parse_iso(e.get("commence_time", ""))
        if ct is None or abs(ct - ko) > MATCH_TOLERANCE:
            continue
        if {norm_name(e.get("home_team", "")), norm_name(e.get("away_team", ""))} == want:
            return e
    return None


def parse_lines(event: dict, game_id: str, pull_type: str, captured, mins: int) -> list[dict]:
    """One cfb_lines row per (book, market, player, line)."""
    rows = []
    for bk in event.get("bookmakers") or []:
        for m in bk.get("markets") or []:
            if m.get("key") not in MARKETS:
                continue
            grouped = defaultdict(dict)
            for o in m.get("outcomes") or []:
                player, point = (o.get("description") or "").strip(), o.get("point")
                side = (o.get("name") or "").lower()
                if player and point is not None and side in ("over", "under"):
                    grouped[(player, point)][side] = o.get("price")
            for (player, point), sides in grouped.items():
                rows.append({"game_id": game_id, "pull_type": pull_type, "captured_utc": iso(captured),
                             "minutes_before_kickoff": mins, "book": bk.get("key", ""), "market": m["key"],
                             "player_name": player, "line": point, "over_price": sides.get("over"),
                             "under_price": sides.get("under"), "book_last_update": m.get("last_update") or None,
                             "source": "The Odds API"})
    return rows


def choose_pull(game: dict, state: dict, now) -> tuple[str, int] | None:
    """('first' | 'pregame', minutes before kickoff) when a request should be made now, else None."""
    ko = parse_iso(game["kickoff"])
    mins = int((ko - now).total_seconds() // 60)
    if game["status"] != "scheduled" or mins < 5 or ko - now > CHECK_HORIZON:
        return None
    in_window = PREGAME_MIN <= mins <= PREGAME_MAX
    if not state.get("first_ok_utc"):
        return ("pregame" if in_window else "first"), mins
    if in_window and not state.get("pregame_ok_utc"):
        return "pregame", mins
    return None


def pick_key(keys: list[str], get=_get):
    """First key (free ones first) whose balance is above the floor. Returns (key, events, remaining)."""
    last_err = None
    for k in keys:
        body, h, status = get(f"{API}/sports/{SPORT}/events", {"apiKey": k, "dateFormat": "iso"})
        if status != 200:
            last_err = f"events HTTP {status}"
            continue
        try:
            left = int(h.get("x-requests-remaining", ""))
        except ValueError:
            continue    # unknown balance never authorises spending
        if left > CREDIT_FLOOR:
            return k, json.loads(body), left
    raise Stop(last_err or "no key above the credit floor")


def run(store: Store, keys: list[str], games: list[dict], log: list[str], now, get=_get) -> int:
    """Check/pull lines for upcoming games. Returns the number of lines stored."""
    todo = [g for g in games if g["status"] == "scheduled" and 0 < (parse_iso(g["kickoff"]) - now).total_seconds() <= CHECK_HORIZON.total_seconds()]
    if not todo or not keys:
        return 0
    ids = ",".join(g["game_id"] for g in todo)
    states = {r["game_id"]: r for r in store.select("cfb_pull_state", {"game_id": f"in.({ids})"})}
    plans = [(g, choose_pull(g, states.get(g["game_id"]) or {}, now)) for g in todo]
    plans = [(g, p) for g, p in plans if p]
    if not plans:
        return 0
    try:
        key, events, left = pick_key(keys, get)
    except Stop as ex:
        log.append(f"cfb odds: no pull ({ex})")
        return 0
    books = ",".join((BOOKS + EXTRA_BOOKS)[:10])
    stored = checked = empty = 0
    for g, (ptype, mins) in plans:
        ev = match_event(g, events)
        if ev is None:
            continue    # the books haven't listed this game yet; costs nothing to look again next run
        st = states.get(g["game_id"]) or {}
        base = {"game_id": g["game_id"], "empty_checks": st.get("empty_checks") or 0, "last_check_utc": st.get("last_check_utc"),
                "first_ok_utc": st.get("first_ok_utc"), "pregame_ok_utc": st.get("pregame_ok_utc"),
                "results_fetched_utc": st.get("results_fetched_utc")}
        if g.get("odds_event_id") != ev["id"]:
            g["odds_event_id"] = ev["id"]
            store.upsert("cfb_games", [{k: v for k, v in g.items()}], "game_id")
        if left <= CREDIT_FLOOR + 3:
            log.append("cfb odds: stopped at the credit floor")
            break
        body, h, status = get(f"{API}/sports/{SPORT}/events/{ev['id']}/odds", {
            "apiKey": key, "bookmakers": books, "markets": ",".join(MARKETS), "oddsFormat": "american", "dateFormat": "iso"})
        captured = now
        if status in (401, 403, 429):
            log.append(f"cfb odds: stopped (HTTP {status})")
            break
        used, remaining = h.get("x-requests-last", ""), h.get("x-requests-remaining", "")
        if status != 200:
            store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": ptype, "status": "error", "attempted_utc": iso(now),
                                        "minutes_before_kickoff": mins, "note": f"HTTP {status}"}])
            continue
        rows = parse_lines(json.loads(body), g["game_id"], ptype, captured, mins)
        checked += 1
        try:
            left = int(remaining)
        except ValueError:
            pass
        if not rows:
            empty += 1
            store.upsert("cfb_pull_state", [{**base, "empty_checks": base["empty_checks"] + 1, "last_check_utc": iso(now),
                                             "updated_at": iso(now)}], "game_id")
            continue
        store.insert_ignore("cfb_lines", rows, "game_id,pull_type,captured_utc,book,market,player_name,line")
        store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": ptype, "status": "ok", "attempted_utc": iso(now),
                                    "minutes_before_kickoff": mins, "outcomes": len(rows),
                                    "credits_last": int(used) if used.isdigit() else None,
                                    "credits_remaining": left}])
        upd = {**base, "last_check_utc": iso(now), "first_ok_utc": base["first_ok_utc"] or iso(now), "updated_at": iso(now)}
        if ptype == "pregame":
            upd["pregame_ok_utc"] = iso(now)
        store.upsert("cfb_pull_state", [upd], "game_id")
        stored += len(rows)
    if checked:
        log.append(f"cfb odds: {checked} request(s), {empty} empty, {stored} lines stored")
    return stored

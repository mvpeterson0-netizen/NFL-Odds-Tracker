"""Pre-game player prop pulls from The Odds API (https://the-odds-api.com).

One successful pull per game, targeted 2.5-3.5 hours before kickoff. If no run
lands in that window, the next run before kickoff takes it and the real capture
time is recorded. Nothing is ever pulled at or after kickoff.

Quota guard (free plan, 500 credits/month): the 5 core markets are always
requested. The 2 optional QB markets are added only when the remaining credits
still cover the core markets for every remaining game this month plus a reserve.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta

from .common import (DATA, TEAM_NAME_TO_ABBR, append_csv, http_get, iso, norm_name, parse_iso, read_csv,
                     redact, utcnow, COLLECTION_START_UTC)

API = "https://api.the-odds-api.com/v4"
SPORT = "americanfootball_nfl"
BOOKS = ["draftkings", "fanduel"]  # stored in this order of preference
CORE = ["player_pass_yds", "player_rush_attempts", "player_rush_yds", "player_receptions", "player_reception_yds"]
OPTIONAL = ["player_pass_attempts", "player_pass_completions"]
WINDOW_OPEN = timedelta(hours=3, minutes=30)
WINDOW_CLOSE = timedelta(hours=2, minutes=30)
RESERVE_CREDITS = 15
MAX_ATTEMPTS = 4

CAPTURES_PATH = DATA / "prop_captures.csv"
PULL_LOG_PATH = DATA / "pull_log.csv"
CAPTURE_FIELDS = ["game_id", "event_id", "pull_type", "captured_utc", "kickoff_utc", "minutes_before_kickoff",
                  "in_window", "book", "market", "player_book_name", "gsis_id", "line", "over_price",
                  "under_price", "book_last_update", "source"]
PULL_FIELDS = ["game_id", "event_id", "pull_type", "status", "attempted_utc", "kickoff_utc",
               "minutes_before_kickoff", "in_window", "markets", "outcomes", "credits_last", "credits_remaining",
               "note"]


def _pulls_by_game():
    out = defaultdict(list)
    for r in read_csv(PULL_LOG_PATH):
        out[r["game_id"]].append(r)
    return out


def _has_ok(rows):
    return any(r["status"] == "ok" for r in rows)


def plan(games, now=None):
    """Return (due_games, newly_missed_games)."""
    now = now or utcnow()
    pulls = _pulls_by_game()
    due, missed = [], []
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko is None or ko < COLLECTION_START_UTC:
            continue
        rows = pulls.get(g["game_id"], [])
        if _has_ok(rows):
            continue
        if ko <= now:
            if not any(r["status"] in ("missed", "no_props") for r in rows):
                missed.append(g)
            continue
        if ko - now <= WINDOW_OPEN:
            attempts = sum(1 for r in rows if r["status"] in ("empty", "error", "late", "quota"))
            if attempts < MAX_ATTEMPTS:
                due.append(g)
    return due, missed


def _headers_credits(h):
    return h.get("x-requests-last", ""), h.get("x-requests-remaining", "")


def fetch_events(key):
    body, h, status = http_get(f"{API}/sports/{SPORT}/events", {"apiKey": key, "dateFormat": "iso"})
    if status != 200:
        raise RuntimeError(f"Odds API events HTTP {status}: {body[:200]!r}")
    return json.loads(body), h


def match_event(game, events):
    ko = parse_iso(game["kickoff_utc"])
    for e in events:
        home = TEAM_NAME_TO_ABBR.get(e.get("home_team", ""))
        away = TEAM_NAME_TO_ABBR.get(e.get("away_team", ""))
        ct = parse_iso(e.get("commence_time", ""))
        if ct is None or abs((ct - ko).total_seconds()) > 6 * 3600:
            continue
        if {home, away} == {game["home_team"], game["away_team"]}:
            return e
    return None


def _main_line_rows(event, game_id, pull_type, captured, ko, mins, in_window, name_index):
    """Flatten bookmaker outcomes into one row per (book, market, player, line)."""
    rows = []
    for bk in event.get("bookmakers", []):
        for m in bk.get("markets", []):
            grouped = defaultdict(dict)
            for o in m.get("outcomes", []):
                player = o.get("description", "")
                point = o.get("point")
                side = (o.get("name") or "").lower()
                if not player or point is None or side not in ("over", "under"):
                    continue
                grouped[(player, point)][side] = o.get("price")
            for (player, point), sides in grouped.items():
                rows.append({
                    "game_id": game_id, "event_id": event.get("id", ""), "pull_type": pull_type,
                    "captured_utc": iso(captured), "kickoff_utc": iso(ko), "minutes_before_kickoff": mins,
                    "in_window": in_window, "book": bk.get("key", ""), "market": m.get("key", ""),
                    "player_book_name": player, "gsis_id": name_index.get(norm_name(player), ""),
                    "line": point, "over_price": sides.get("over", ""), "under_price": sides.get("under", ""),
                    "book_last_update": m.get("last_update", ""), "source": "The Odds API",
                })
    return rows


def run(key, games, name_index_for_game, log):
    """Execute due pulls. Returns True if any data/log rows were written."""
    if not key:
        log.append("odds: ODDS_API_KEY not set; skipped")
        return False
    now = utcnow()
    due, missed = plan(games, now)
    wrote = False
    for g in missed:
        append_csv(PULL_LOG_PATH, [{
            "game_id": g["game_id"], "pull_type": "pregame", "status": "missed", "attempted_utc": iso(now),
            "kickoff_utc": g["kickoff_utc"], "note": "no successful pull before kickoff",
        }], PULL_FIELDS)
        log.append(f"odds: {g['game_id']} kicked off with no pre-game line (logged as missed)")
        wrote = True
    if not due:
        return wrote

    events, h = fetch_events(key)
    ev_last, remaining = _headers_credits(h)
    log.append(f"odds: events call cost={ev_last or '?'} remaining={remaining or '?'}")
    remaining_n = int(remaining) if remaining.isdigit() else None
    pulls = _pulls_by_game()

    for g in sorted(due, key=lambda x: x["kickoff_utc"]):
        ko = parse_iso(g["kickoff_utc"])
        now = utcnow()
        if ko <= now:
            continue
        e = match_event(g, events)
        base = {"game_id": g["game_id"], "pull_type": "pregame", "attempted_utc": iso(now),
                "kickoff_utc": g["kickoff_utc"]}
        if e is None:
            append_csv(PULL_LOG_PATH, [{**base, "status": "error", "note": "event not found in Odds API events list"}],
                       PULL_FIELDS)
            log.append(f"odds: {g['game_id']} not found in events list")
            wrote = True
            continue

        # Quota guard
        markets = list(CORE)
        if remaining_n is not None:
            month = ko.strftime("%Y-%m")
            later = [x for x in games if x["game_id"] != g["game_id"] and x.get("kickoff_utc", "")[:7] == month
                     and parse_iso(x["kickoff_utc"]) > now and not _has_ok(pulls.get(x["game_id"], []))]
            need_core = len(CORE) * len(later) + RESERVE_CREDITS
            if remaining_n - (len(CORE) + len(OPTIONAL)) >= need_core:
                markets += OPTIONAL
            elif remaining_n < len(CORE):
                append_csv(PULL_LOG_PATH, [{**base, "event_id": e["id"], "status": "quota",
                                            "credits_remaining": remaining_n,
                                            "note": "not enough API credits left this month"}], PULL_FIELDS)
                log.append(f"odds: {g['game_id']} skipped, quota ({remaining_n} left)")
                wrote = True
                continue

        params = {"apiKey": key, "bookmakers": ",".join(BOOKS), "markets": ",".join(markets),
                  "oddsFormat": "american", "dateFormat": "iso"}
        body, h, status = http_get(f"{API}/sports/{SPORT}/events/{e['id']}/odds", params)
        captured = utcnow()
        last, remaining = _headers_credits(h)
        if remaining.isdigit():
            remaining_n = int(remaining)
        mins = round((ko - captured).total_seconds() / 60)
        in_window = "yes" if WINDOW_CLOSE <= (ko - captured) <= WINDOW_OPEN else "no"
        row = {**base, "event_id": e["id"], "markets": " ".join(markets), "credits_last": last,
               "credits_remaining": remaining, "minutes_before_kickoff": mins, "in_window": in_window,
               "attempted_utc": iso(captured)}
        if status != 200:
            append_csv(PULL_LOG_PATH, [{**row, "status": "error",
                                        "note": f"HTTP {status}: {body[:150].decode('utf-8', 'replace')}"}],
                       PULL_FIELDS)
            log.append(f"odds: {g['game_id']} HTTP {status}")
            wrote = True
            continue
        if captured >= ko:
            append_csv(PULL_LOG_PATH, [{**row, "status": "late", "note": "response arrived after kickoff; discarded"}],
                       PULL_FIELDS)
            wrote = True
            continue
        event = json.loads(body)
        caps = _main_line_rows(event, g["game_id"], "pregame", captured, ko, mins, in_window,
                               name_index_for_game(g))
        if not caps:
            append_csv(PULL_LOG_PATH, [{**row, "status": "empty", "outcomes": 0,
                                        "note": "no player prop outcomes returned"}], PULL_FIELDS)
            log.append(f"odds: {g['game_id']} returned no props (cost {last})")
            wrote = True
            continue
        append_csv(CAPTURES_PATH, caps, CAPTURE_FIELDS)
        books = sorted({c["book"] for c in caps})
        unmatched = sorted({c["player_book_name"] for c in caps if not c["gsis_id"]})
        note = f"books: {','.join(books)}"
        if unmatched:
            note += f"; unmatched names: {', '.join(unmatched)}"
        append_csv(PULL_LOG_PATH, [{**row, "status": "ok", "outcomes": len(caps), "note": note}], PULL_FIELDS)
        pulls[g["game_id"]].append({"status": "ok"})
        log.append(f"odds: {g['game_id']} captured {len(caps)} lines {mins} min before kickoff "
                   f"(cost {last}, remaining {remaining})")
        wrote = True
    return wrote

"""One-time back-fill of pre-game lines for games played before Stix's own collection began
(weeks 1-6, kickoff before COLLECTION_START_UTC), from The Odds API's historical endpoints
(paid plan; Michael approved 2026-10-28).

For each such game: one historical events lookup per kickoff time (1 credit) and one historical
event-odds request at the snapshot 3 h before kickoff (the live pre-game pull targets 2.5-3.5 h),
same books and markets as the live pulls. Cost per the API docs: 10 credits x markets returned
(probe 2026-10-28: 70 for a full game). Empty responses cost nothing.

Rows are APPENDED to prop_captures.csv (pull_type "pregame", source "The Odds API (historical)",
captured_utc = the snapshot's own time) and one row per game to pull_log.csv (attempted_utc = the
snapshot time; the note says it was a historical download and when). Existing rows are never touched.

Safety: at most MAX_GAMES_PER_RUN games per run (a run whose commit fails loses at most that much),
never on push-triggered runs (they race with scheduled runs), stops when the key's remaining credits
would fall below CREDIT_FLOOR, and per-game results are kept in data/history_backfill.json so a game
is never downloaded twice. Errors are retried on later runs, up to MAX_TRIES per game.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import timedelta

from .common import COLLECTION_START_UTC, DATA, append_csv, http_get, iso, parse_iso, read_csv, read_json, \
    utcnow, write_json
from .odds import (API, BOOKS, CAPTURE_FIELDS, CAPTURES_PATH, CORE, OPTIONAL, PULL_FIELDS, PULL_LOG_PATH, SPORT,
                   WINDOW_CLOSE, WINDOW_OPEN, _main_line_rows, match_event, ptype)

HIST = f"{API}/historical/sports/{SPORT}"
SNAP_BEFORE = timedelta(hours=3)
CREDIT_FLOOR = 12000
MAX_GAMES_PER_RUN = 16
MAX_TRIES = 3
SOURCE = "The Odds API (historical)"
STATE_PATH = DATA / "history_backfill.json"


def _credits(h):
    return h.get("x-requests-last", ""), h.get("x-requests-remaining", "")


def candidates(games, state):
    """Games before collection began, final, with no pre-game line logged and not finished in the state file."""
    have = {p["game_id"] for p in read_csv(PULL_LOG_PATH) if ptype(p) == "pregame" and p["status"] == "ok"}
    out = []
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko is None or ko >= COLLECTION_START_UTC or g.get("result", "") == "" or g["game_id"] in have:
            continue
        st = state.get(g["game_id"], {})
        if st.get("status") in ("ok", "empty", "not_found") or st.get("tries", 0) >= MAX_TRIES:
            continue
        out.append(g)
    return sorted(out, key=lambda g: (g["kickoff_utc"], g["game_id"]))


def run(key, games, name_index_for_game, log):
    """Download the next batch. Returns True if any data rows were written."""
    if not key:
        return False
    if os.environ.get("GITHUB_EVENT_NAME") == "push":
        return False
    raw = read_json(STATE_PATH, {}) or {}
    state = raw.get("games", {})
    todo = candidates(games, state)
    if not todo:
        return False
    batch = todo[:MAX_GAMES_PER_RUN]
    markets = CORE + OPTIONAL
    events_by_ko = {}
    remaining = None
    spent = 0
    stats = defaultdict(int)
    wrote = False
    for g in batch:
        if remaining is not None and remaining - 10 * len(markets) < CREDIT_FLOOR:
            log.append(f"history: stopped, {remaining} credits left (floor {CREDIT_FLOOR})")
            break
        gid = g["game_id"]
        ko = parse_iso(g["kickoff_utc"])
        date = iso(ko - SNAP_BEFORE)
        st = state.setdefault(gid, {"tries": 0})
        st["tries"] = st.get("tries", 0) + 1
        st["attempted_utc"] = iso(utcnow())
        if g["kickoff_utc"] not in events_by_ko:
            body, h, status = http_get(f"{HIST}/events", {
                "apiKey": key, "date": date, "dateFormat": "iso",
                "commenceTimeFrom": iso(ko - timedelta(hours=1)), "commenceTimeTo": iso(ko + timedelta(hours=1))})
            last, rem = _credits(h)
            spent += int(last) if last.isdigit() else 0
            remaining = int(rem) if rem.isdigit() else remaining
            if status != 200:
                st.update({"status": "error", "note": f"events HTTP {status}"})
                stats["error"] += 1
                if status in (401, 429):
                    log.append(f"history: events HTTP {status}; stopping this run")
                    break
                continue
            events_by_ko[g["kickoff_utc"]] = json.loads(body).get("data", [])
        e = match_event(g, events_by_ko[g["kickoff_utc"]])
        if e is None:
            st.update({"status": "not_found", "note": f"not in historical events at {date}"})
            stats["not_found"] += 1
            continue
        body, h, status = http_get(f"{HIST}/events/{e['id']}/odds", {
            "apiKey": key, "date": date, "bookmakers": ",".join(BOOKS), "markets": ",".join(markets),
            "oddsFormat": "american", "dateFormat": "iso"})
        last, rem = _credits(h)
        spent += int(last) if last.isdigit() else 0
        remaining = int(rem) if rem.isdigit() else remaining
        if status != 200:
            st.update({"status": "error", "note": f"odds HTTP {status}: {body[:120].decode('utf-8', 'replace')}"})
            stats["error"] += 1
            if status in (401, 429):
                log.append(f"history: odds HTTP {status}; stopping this run")
                break
            continue
        js = json.loads(body)
        snap = parse_iso(js.get("timestamp", "")) or (ko - SNAP_BEFORE)
        event = js.get("data") or {}
        mins = round((ko - snap).total_seconds() / 60)
        in_window = "yes" if WINDOW_CLOSE <= (ko - snap) <= WINDOW_OPEN else "no"
        caps = _main_line_rows(event, gid, "pregame", snap, ko, mins, in_window, name_index_for_game(g))
        for c in caps:
            c["source"] = SOURCE
        books = sorted({c["book"] for c in caps})
        unmatched = sorted({c["player_book_name"] for c in caps if not c["gsis_id"]})
        base = {"game_id": gid, "event_id": e["id"], "pull_type": "pregame", "attempted_utc": iso(snap),
                "kickoff_utc": g["kickoff_utc"], "minutes_before_kickoff": mins, "in_window": in_window,
                "markets": " ".join(markets), "credits_last": last, "credits_remaining": rem}
        hist_note = f"historical snapshot ({SOURCE}), downloaded {iso(utcnow())}"
        if caps:
            append_csv(CAPTURES_PATH, caps, CAPTURE_FIELDS)
            note = f"books: {','.join(books)}; {hist_note}"
            if unmatched:
                note += f"; unmatched names: {', '.join(unmatched)}"
            append_csv(PULL_LOG_PATH, [{**base, "status": "ok", "outcomes": len(caps), "note": note}], PULL_FIELDS)
            st.update({"status": "ok", "snapshot": iso(snap), "lines": len(caps), "credits": last, "note": ""})
            stats["ok"] += 1
        else:
            append_csv(PULL_LOG_PATH, [{**base, "status": "empty", "outcomes": 0,
                                        "note": f"no player prop outcomes in {hist_note}"}], PULL_FIELDS)
            st.update({"status": "empty", "snapshot": iso(snap), "lines": 0, "credits": last})
            stats["empty"] += 1
        wrote = True
    left = len(candidates(games, state))
    write_json(STATE_PATH, {"updated_utc": iso(utcnow()), "remaining_games": left, "games": state})
    log.append("history: " + ", ".join(f"{v} {k}" for k, v in sorted(stats.items())) +
               f"; {spent} credits used, {remaining if remaining is not None else '?'} left; {left} game(s) to go")
    return wrote

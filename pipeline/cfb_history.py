"""One-time back-fill of a past CFB week's graded line (the snapshot 1 hour before kickoff), from The Odds API's
historical endpoints. OFF unless CFB_BACKFILL_WEEKS is set (e.g. "9"); that is set only after Michael says Yes to the
spend (estimate ~30 credits per game: 10 x the 3 markets that return data, plus 1 per events lookup).

Per game: one historical events lookup at the snapshot time (1 credit) and one historical event-odds request.
Rows go to cfb_lines as pull_type 'pregame', source 'The Odds API (historical)'. A game is never downloaded twice
(cfb_pull_state.pregame_ok_utc); errors retry on later runs, up to MAX_TRIES. Skips push-triggered runs.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

from .common import http_get, iso, parse_iso
from .cfb_store import Store
from .cfb_odds import MARKETS, SPORT, match_event, parse_lines
from .odds import API, BOOKS, EXTRA_BOOKS

HIST = f"{API}/historical/sports/{SPORT}"
SNAP_BEFORE = timedelta(hours=1)
CREDIT_FLOOR = 15000
MAX_GAMES_PER_RUN = 8
MAX_TRIES = 3
SOURCE = "The Odds API (historical)"


def _get(url, params):
    return http_get(url, params, timeout=60)


def weeks_from_env() -> list[int]:
    out = []
    for p in os.environ.get("CFB_BACKFILL_WEEKS", "").replace(" ", "").split(","):
        if p.isdigit():
            out.append(int(p))
    return out


def run(store: Store, key: str, log: list[str], now, get=_get, weeks: list[int] | None = None) -> int:
    weeks = weeks_from_env() if weeks is None else weeks
    if not key or not weeks or os.environ.get("GITHUB_EVENT_NAME") == "push":
        return 0
    games = [g for w in weeks for g in store.select("cfb_games", {"week": f"eq.{w}", "status": "eq.final"})]
    if not games:
        return 0
    ids = ",".join(g["game_id"] for g in games)
    done = {r["game_id"] for r in store.select("cfb_pull_state", {"game_id": f"in.({ids})"}) if r.get("pregame_ok_utc")}
    errs: dict[str, int] = {}
    for r in store.select("cfb_pulls", {"game_id": f"in.({ids})", "status": "eq.error"}):
        if (r.get("note") or "").startswith("historical"):
            errs[r["game_id"]] = errs.get(r["game_id"], 0) + 1
    todo = sorted((g for g in games if g["game_id"] not in done and errs.get(g["game_id"], 0) < MAX_TRIES),
                  key=lambda g: (g["kickoff"], g["game_id"]))[:MAX_GAMES_PER_RUN]
    if not todo:
        return 0
    books = ",".join((BOOKS + EXTRA_BOOKS)[:10])
    remaining, stored = None, 0
    for g in todo:
        if remaining is not None and remaining - 31 < CREDIT_FLOOR:
            log.append(f"cfb history: stopped, {remaining} credits left (floor {CREDIT_FLOOR})")
            break
        ko = parse_iso(g["kickoff"])
        date = iso(ko - SNAP_BEFORE)

        def fail(note):
            store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": "pregame", "status": "error",
                                        "attempted_utc": iso(now), "note": ("historical: " + note)[:200]}])
        body, h, status = get(f"{HIST}/events", {"apiKey": key, "date": date, "dateFormat": "iso",
                                                  "commenceTimeFrom": iso(ko - timedelta(hours=1)),
                                                  "commenceTimeTo": iso(ko + timedelta(hours=1))})
        rem = h.get("x-requests-remaining", "")
        remaining = int(rem) if rem.isdigit() else remaining
        if status != 200:
            fail(f"events HTTP {status}")
            if status in (401, 403, 429):
                break
            continue
        if remaining is None or remaining - 31 < CREDIT_FLOOR:
            log.append("cfb history: stopped (balance unknown or at floor)")
            break
        ev = match_event(g, json.loads(body).get("data") or [])
        if ev is None:
            fail(f"not in historical events at {date}")
            continue
        body, h, status = get(f"{HIST}/events/{ev['id']}/odds", {
            "apiKey": key, "date": date, "bookmakers": books, "markets": ",".join(MARKETS),
            "oddsFormat": "american", "dateFormat": "iso"})
        used, rem = h.get("x-requests-last", ""), h.get("x-requests-remaining", "")
        remaining = int(rem) if rem.isdigit() else remaining
        if status != 200:
            fail(f"odds HTTP {status}")
            if status in (401, 403, 429):
                break
            continue
        js = json.loads(body)
        snap = parse_iso(js.get("timestamp", "")) or (ko - SNAP_BEFORE)
        mins = round((ko - snap).total_seconds() / 60)
        rows = parse_lines(js.get("data") or {}, g["game_id"], "pregame", snap, mins)
        for r in rows:
            r["source"] = SOURCE
        if rows:
            store.insert_ignore("cfb_lines", rows, "game_id,pull_type,captured_utc,book,market,player_name,line")
            store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": "pregame", "status": "ok",
                                        "attempted_utc": iso(snap), "minutes_before_kickoff": mins, "outcomes": len(rows),
                                        "credits_last": int(used) if used.isdigit() else None,
                                        "credits_remaining": remaining, "note": f"historical download {iso(now)}"}])
            st = (store.select("cfb_pull_state", {"game_id": f"eq.{g['game_id']}"}) or [{}])[0]
            store.upsert("cfb_pull_state", [{"game_id": g["game_id"], "empty_checks": st.get("empty_checks") or 0,
                                             "last_check_utc": st.get("last_check_utc"), "first_ok_utc": iso(snap),
                                             "pregame_ok_utc": iso(snap), "results_fetched_utc": st.get("results_fetched_utc"),
                                             "updated_at": iso(now)}], "game_id")
            stored += len(rows)
        else:
            fail("no props in snapshot")
    if stored:
        log.append(f"cfb history: {stored} lines stored")
    return stored

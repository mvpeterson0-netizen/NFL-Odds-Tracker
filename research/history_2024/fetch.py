"""One-off 2024 archive: rushing yards + receiving yards player props, kickoff minus 3 hours.

Approved by Michael in chat 2026-11-22 ("pull 2024 receiving yard and rushing yard props for all games").
Runs only from the history-2024 branch's own workflow; never touches live captures, site data or main.

Same layout as data/history_2025/ so existing research code can read it by changing the folder:
  data/history_2024/schedule.json   nflverse 2024 schedule (272 REG + 13 POST), kickoff_utc added
  data/history_2024/events/<snapshot>.json   historical events lookups (cached, 1 credit each)
  data/history_2024/odds/<game_id>.json      complete raw Odds API payload per game
  data/history_2024/state.json               per-game status, credits spent, balance

Credits: every billable request is preceded by a free balance check and refused if it would take the
balance below FLOOR (protects live NFL/CFB pulls for the rest of the month). No automatic retries on
billable calls (an uncertain response may have been charged); failed games are retried on a later run, max 3.
"""
from datetime import timedelta
import json
import os
import sys
from pathlib import Path

ROOT_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_REPO))

from pipeline.common import DATA, NFLVERSE, http_get, iso, kickoff_utc, parse_iso, read_csv_bytes, read_json, \
    utcnow, write_json  # noqa: E402
from pipeline.odds import API, SPORT, BOOKS, EXTRA_BOOKS, match_event  # noqa: E402

SEASON = "2024"
ROOT = DATA / "history_2024"
STATE = ROOT / "state.json"
HIST = f"{API}/historical/sports/{SPORT}"
MARKETS = ["player_rush_yds", "player_reception_yds"]
BOOKMAKERS = BOOKS + EXTRA_BOOKS  # same 10 books as the 2025 archive; 10 books = 1 region, same cost as DK+FD
FLOOR = int(os.environ.get("HISTORY_2024_FLOOR", "3500"))
MAX_ERRORS = 3
EXPECTED = {"REG": 272, "WC": 6, "DIV": 4, "CON": 2, "SB": 1}


class Stop(Exception):
    pass


class GameError(Exception):
    pass


def schedule():
    path = ROOT / "schedule.json"
    if path.exists():
        return read_json(path, [])
    body, _, status = http_get(f"{NFLVERSE}/schedules/games.csv", timeout=60)
    if status != 200:
        raise Stop(f"nflverse schedule HTTP {status}")
    games = []
    for r in read_csv_bytes(body):
        if r.get("season") != SEASON:
            continue
        ko = kickoff_utc(r["gameday"], r["gametime"])
        if ko is None:
            raise Stop(f"missing kickoff for {r['game_id']}")
        games.append({**r, "kickoff_utc": iso(ko)})
    counts = {}
    for g in games:
        counts[g["game_type"]] = counts.get(g["game_type"], 0) + 1
    if counts != EXPECTED:
        raise Stop(f"unexpected 2024 schedule counts {counts}")
    games.sort(key=lambda g: (g["kickoff_utc"], g["game_id"]))
    write_json(path, games)
    return games


def balance(key):
    body, h, status = http_get(f"{API}/sports", {"apiKey": key})  # free; does not use credits
    rem = h.get("x-requests-remaining", "")
    if status != 200 or not rem.isdigit():
        raise Stop(f"cannot verify balance (HTTP {status})")
    return int(rem)


def request(key, state, url, params, max_cost):
    bal = balance(key)
    prior = state.get("balance")
    if prior is not None and bal > prior + 5:
        raise Stop(f"balance rose {prior} -> {bal}: reset or plan change; needs a new decision")
    if bal - max_cost < FLOOR:
        raise Stop(f"floor {FLOOR} protected: balance {bal}, next request up to {max_cost}")
    body, h, status = http_get(url, {**params, "apiKey": key}, retries=1)
    rem = h.get("x-requests-remaining", "")
    if rem.isdigit():
        state["balance"] = int(rem)
    state["credits_spent"] = state.get("credits_spent", 0) + int(h.get("x-requests-last", "0") or "0")
    if status in (401, 403, 429):
        raise Stop(f"API refused request (HTTP {status})")
    if status != 200:
        raise GameError(f"HTTP {status}: {body[:200]!r}")
    return json.loads(body)


def run(key):
    state = read_json(STATE, {}) or {}
    state.update({"season": SEASON, "markets": MARKETS, "bookmakers": BOOKMAKERS, "snapshot": "kickoff - 3h",
                  "floor": FLOOR})
    state.setdefault("games", {})
    state.pop("stopped", None)
    log = []
    try:
        games = schedule()
        for g in games:
            gid = g["game_id"]
            st = state["games"].get(gid, {})
            if (ROOT / "odds" / f"{gid}.json").exists():
                if st.get("status") != "saved":
                    state["games"][gid] = {**st, "status": "saved"}
                continue
            if st.get("status") in ("not_found", "empty") or st.get("errors", 0) >= MAX_ERRORS:
                continue
            ko = parse_iso(g["kickoff_utc"])
            date = iso(ko - timedelta(hours=3))
            cache = ROOT / "events" / (date.replace(":", "-") + ".json")
            try:
                events = read_json(cache, None)
                if events is None:
                    events = request(key, state, f"{HIST}/events", {
                        "date": date, "dateFormat": "iso",
                        "commenceTimeFrom": iso(ko - timedelta(hours=1)),
                        "commenceTimeTo": iso(ko + timedelta(hours=1)),
                    }, 1)
                    write_json(cache, events)
                event = match_event(g, events.get("data", []))
                if event is None:
                    state["games"][gid] = {"status": "not_found", "requested_snapshot": date}
                    log.append(f"{gid}: not in historical events at {date}")
                    continue
                snap = request(key, state, f"{HIST}/events/{event['id']}/odds", {
                    "date": date, "dateFormat": "iso", "oddsFormat": "american", "regions": "us",
                    "bookmakers": ",".join(BOOKMAKERS), "markets": ",".join(MARKETS),
                }, 10 * len(MARKETS))
                books = (snap.get("data") or {}).get("bookmakers") or []
                write_json(ROOT / "odds" / f"{gid}.json", {
                    "game_id": gid, "game_type": g["game_type"], "event_id": event["id"],
                    "requested_snapshot": date, "downloaded_utc": iso(utcnow()),
                    "markets": MARKETS, "response": snap,
                })
                state["games"][gid] = {"status": "saved" if books else "saved_no_books",
                                       "snapshot": snap.get("timestamp"), "books": len(books)}
            except GameError as ex:
                errors = st.get("errors", 0) + 1
                state["games"][gid] = {"status": "error", "errors": errors, "note": str(ex)[:300]}
                log.append(f"{gid}: error {errors}: {ex}")
            finally:
                write_json(STATE, state)
        done = sum(1 for x in state["games"].values() if x.get("status") in ("saved", "saved_no_books"))
        state["complete"] = all(state["games"].get(g["game_id"], {}).get("status") in ("saved", "saved_no_books",
                                "not_found") for g in games)
        log.append(f"history 2024: {done}/{len(games)} saved; complete={state['complete']}")
    except Stop as ex:
        state["stopped"] = str(ex)
        log.append(f"history 2024: stopped — {ex}")
    finally:
        state["updated_utc"] = iso(utcnow())
        write_json(STATE, state)
    print("\n".join(log))
    print(f"credits spent so far: {state.get('credits_spent', 0)}; balance {state.get('balance', '?')}")


if __name__ == "__main__":
    key = os.environ.get("ODDS_API_KEY_20K", "")
    if not key:
        sys.exit("no key")
    run(key)
